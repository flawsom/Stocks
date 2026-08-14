import { useTradingStore } from "@/stores/tradingStore";
import { aggregator, finnhubTradeWS, binanceStreamWS, coinbaseStreamWS, krakenStreamWS, twelvedataQuoteWS } from "@/lib/realtime";
import type { KlineEvent } from "@/lib/realtime";
import { fetchQuoteFinnhub, fetchQuoteFinnhubCrypto, fetchQuoteTwelveData, fetchQuoteAlphaVantageFx, fetchQuoteFrankfurter, getTDBudget, isTdDayExhausted, fetchCandles } from "@/lib/dataProviders";
import { raceQuote, crossValidate, getFastestProvider, fetchQuoteExchangerate } from "@/lib/providers";
import { getSymbolsByMarket, FINNHUB_BUDGET } from "@/constants/config";

/* ────────────────────────────────────────────────────────────────
 * Global live feed bootstrap.
 *
 * The WebSocket managers and REST pollers are module singletons.
 * startLiveFeeds() is idempotent — call it once at the app root so
 * every route (landing + terminal) receives the same live stream.
 * ──────────────────────────────────────────────────────────────── */

let started = false;

/** Session-cached previous closes (for computing day-change from ticks) */
const prevCloseCache = new Map<string, number>();
/** Per-symbol throttling for watchlist row pushes */
const lastWatchPush = new Map<string, number>();
/** Stock/index symbols primed with a session quote */
const primed = new Set<string>();

/* ── Quote integrity guard ──────────────────────────────────────
 * Free providers occasionally emit a wrong-scale price (a 24h change%
 * or a percent fraction served as "last"). One bad quote must never
 * paint a fake level on the watchlist or corrupt the live candle series.
 *
 * Rule: a quote is accepted when it is within ±MAX_DEV of the last
 * accepted price (the baseline). A larger deviation is SUSPECT: it is
 * only accepted when a SECOND consecutive quote agrees with it (a real
 * fast market move). Otherwise it is dropped and the baseline stands.
 * A stale baseline (> STALE_MS) re-opens acceptance, and the baseline
 * seeds from the real candle series when no quote has been seen yet —
 * the app never freezes on an old price, and a cold-start glitch
 * self-corrects within two good quotes. */
const MAX_DEV = 0.25;          // ±25% from the baseline
const STALE_MS = 15 * 60_000;  // re-open acceptance after 15 min of silence
const baselineCache = new Map<string, { price: number; at: number }>();
let suspectQuote: { symbol: string; price: number } | null = null;

function seedBaseline(symbol: string): number | null {
  const candles = aggregator.getSeries(symbol, "1min");
  if (candles.length > 0) {
    const last = candles[candles.length - 1].close;
    if (last > 0) return last;
  }
  return null;
}

/** True when the quote is sane enough to paint / ingest into candles. */
function quoteIsSane(symbol: string, price: number): boolean {
  if (!(price > 0) || !Number.isFinite(price)) return false;
  let b = baselineCache.get(symbol);
  if (!b || Date.now() - b.at > STALE_MS) {
    // First quote for the symbol (or stale baseline): seed from real candle
    // history when available, else accept this quote as the new baseline.
    const seed = b ? b.price : seedBaseline(symbol);
    b = { price: seed ?? price, at: Date.now() };
    baselineCache.set(symbol, b);
    suspectQuote = null;
    return true;
  }
  const dev = Math.abs(price - b.price) / b.price;
  if (dev <= MAX_DEV) {
    baselineCache.set(symbol, { price, at: Date.now() });
    suspectQuote = null;
    return true;
  }
  // Deviates from the baseline → suspect. Accept only when the PREVIOUS
  // quote was also suspect for this symbol and agrees with this one (a real
  // move), otherwise drop the glitch and keep the baseline standing.
  if (suspectQuote && suspectQuote.symbol === symbol) {
    const sDev = Math.abs(price - suspectQuote.price) / suspectQuote.price;
    if (sDev <= MAX_DEV) {
      baselineCache.set(symbol, { price, at: Date.now() });
      suspectQuote = null;
      return true;
    }
  }
  suspectQuote = { symbol, price };
  return false;
}

/* ── Tick handler: watchlist + candle aggregation ─────────── */
function handleTick(symbol: string, price: number, vol: number, ts: number) {
  if (!quoteIsSane(symbol, price)) return;

  aggregator.ingestTick(symbol, price, vol, ts);

  const state = useTradingStore.getState();
  const item = state.watchlist.find(w => w.symbol === symbol);
  if (!item) return;

  // Throttle watchlist row updates (~2/sec per symbol)
  const now = Date.now();
  const lastPush = lastWatchPush.get(symbol) || 0;
  if (now - lastPush < 500) return;
  lastWatchPush.set(symbol, now);

  const prevClose = prevCloseCache.get(symbol) ?? item.prevClose;
  let change = item.change;
  let changePct = item.changePct;
  if (prevClose && prevClose > 0 && symbol.indexOf("/") === -1) {
    change = price - prevClose;
    changePct = (change / prevClose) * 100;
  }

  state.setWatchlistItem({ ...item, price, change, changePct, lastUpdate: now });
  state.setLastTick(now);
  state.setIsConnected(true);
}

/* ── Binance kline handler: authoritative live candle ─────── */
function handleKline(e: KlineEvent) {
  const state = useTradingStore.getState();
  if (e.symbol !== state.activeSymbol) return;
  aggregator.applyKline(e.symbol, state.activeTimeframe, e.candle);

  const item = state.watchlist.find(w => w.symbol === e.symbol);
  const now = Date.now();
  if (item) {
    if (now - (lastWatchPush.get(e.symbol) || 0) > 1500) {
      lastWatchPush.set(e.symbol, now);
      state.setWatchlistItem({ ...item, price: e.candle.close, lastUpdate: now });
    }
  }
  // A live kline is a real market heartbeat
  state.setLastTick(now);
  state.setIsConnected(true);
}

function applyQuote(
  symbol: string,
  q: { price: number; change: number; changePct: number; prevClose?: number; high?: number; low?: number; volume?: number },
  ts = Date.now(),
  source?: string
) {
  if (!quoteIsSane(symbol, q.price)) return;
  // Belt-and-suspenders sanity guard: never paint an absurd change% on the UI.
  // Real 24h moves for these majors stay well under ±100%; anything beyond that
  // is a provider glitch. Recompute from the prev close when that is usable,
  // otherwise drop the change entirely (price alone is still applied).
  if (!Number.isFinite(q.changePct) || Math.abs(q.changePct) > 100) {
    const pc = q.prevClose && q.prevClose > 0 ? q.prevClose : null;
    const derived = pc ? ((q.price - pc) / pc) * 100 : 0;
    if (pc && Number.isFinite(derived) && Math.abs(derived) <= 100) {
      q.changePct = derived;
      q.change = q.price - pc;
    } else {
      q.changePct = 0;
      q.change = 0;
    }
  }
  // Only cache a prev close that is sane relative to the quote price — a broken
  // provider pc (e.g. 0.003 for BTC) would otherwise poison the session cache.
  if (q.prevClose && q.prevClose > 0) {
    const pcPct = ((q.price - q.prevClose) / q.prevClose) * 100;
    if (Number.isFinite(pcPct) && Math.abs(pcPct) <= 100) {
      prevCloseCache.set(symbol, q.prevClose);
    }
  }
  aggregator.ingestTick(symbol, q.price, q.volume || 0, ts);
  const state = useTradingStore.getState();
  const item = state.watchlist.find(w => w.symbol === symbol);
  if (item) {
    state.setWatchlistItem({
      ...item,
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      ...(q.prevClose ? { prevClose: q.prevClose } : {}),
      ...(q.high ? { high24h: q.high } : {}),
      ...(q.low ? { low24h: q.low } : {}),
      ...(q.volume !== undefined ? { volume: q.volume } : {}),
      ...(source ? { source } : {}),
      lastUpdate: Date.now(),
    });
  }
  // Every applied quote is a heartbeat — keeps the freshness readout honest
  state.setLastTick(Date.now());
  state.setIsConnected(true);
}

/** Apply a bare FX price (fallback sources) — derives change from the session-cached previous close. */
function applyFxQuote(symbol: string, price: number, source: string) {
  if (!(price > 0)) return;
  let prevClose = prevCloseCache.get(symbol);
  if (!prevClose || prevClose <= 0) {
    prevCloseCache.set(symbol, price);
    prevClose = price;
  }
  const change = price - prevClose;
  const changePct = (change / prevClose) * 100;
  applyQuote(symbol, { price, change, changePct, prevClose }, Date.now(), source);
}

/* ────────────────────────────────────────────────────────────────
 * Finnhub budget-aware quote scheduler.
 * Polls stocks, indices and crypto (via the BINANCE: prefix —
 * geo-independent) round-robin while giving the ACTIVE symbol a
 * faster cadence. NEVER polls futures here — Finnhub's free feed
 * resolves ES/CL/NG to unrelated stocks; futures use the separate
 * TwelveData poller. Never exceeds the 60 calls/min budget.
 * ──────────────────────────────────────────────────────────────── */
interface PollTarget { app: string; fh: string }

class FinnhubQuoteScheduler {
  private targets: PollTarget[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private idx = 0;
  private tickCount = 0;
  private callTimes: number[] = [];

  start(targets: PollTarget[]) {
    this.targets = targets;
    if (this.timer) clearInterval(this.timer);
    this.tick();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  private budgetAvailable(): boolean {
    const now = Date.now();
    this.callTimes = this.callTimes.filter(t => now - t < 60_000);
    return this.callTimes.length < FINNHUB_BUDGET.minuteLimit;
  }

  private async fetchOne(target: PollTarget) {
    this.callTimes.push(Date.now());
    try {
      const q = await fetchQuoteFinnhub(target.fh);
      if (q && q.price > 0) {
        applyQuote(target.app, {
          price: q.price, change: q.change, changePct: q.changePct,
          prevClose: q.prevClose, high: q.high, low: q.low, volume: q.volume,
        });
      }
    } catch { /* transient */ }
  }

  private async tick() {
    if (this.targets.length === 0) return;
    if (!this.budgetAvailable()) return;

    const state = useTradingStore.getState();
    // Priority to the symbol the user is actually looking at (futures/crypto)
    const active = (state.activeMarket === "futures" || state.activeMarket === "crypto")
      ? state.activeSymbol
      : null;
    const activeIdx = active ? this.targets.findIndex(t => t.app === active) : -1;

    this.tickCount++;
    let target: PollTarget;
    if (this.tickCount % 2 === 1 && activeIdx >= 0) {
      target = this.targets[activeIdx];
    } else {
      target = this.targets[this.idx % this.targets.length];
      this.idx++;
    }
    await this.fetchOne(target);
  }
}

const finnhubScheduler = new FinnhubQuoteScheduler();

/* ── Start everything once ─────────────────────────────────── */
export function startLiveFeeds() {
  if (started) return;
  started = true;

  // Finnhub carries equities and index ETFs but NOT real index LEVELS (^GSPC,
  // ^IXIC, ^VIX…) — those are served by the Yahoo relay only, so they stay off
  // the Finnhub WS / prime / scheduler (which would otherwise burn budget
  // polling a symbol Finnhub cannot price).
  const stockSymbols = [
    ...getSymbolsByMarket("stocks").map(s => s.symbol),
    ...getSymbolsByMarket("indices").map(s => s.symbol),
  ].filter(s => !s.startsWith("^"));
  const cryptoSymbols = getSymbolsByMarket("crypto").map(s => s.symbol);

  // WebSocket feeds — crypto has three independent venues so it stays
  // live even where Binance is geo-blocked (Coinbase + Kraken are free,
  // no key, and reachable from every region).
  finnhubTradeWS.connect(handleTick);
  stockSymbols.forEach(s => finnhubTradeWS.subscribe(s));
  binanceStreamWS.connect(cryptoSymbols, handleTick, handleKline);
  coinbaseStreamWS.connect(cryptoSymbols, handleTick);
  krakenStreamWS.connect(cryptoSymbols, handleTick);
  // TwelveData WS only when the key's day budget is not spent server-side.
  if (!isTdDayExhausted()) twelvedataQuoteWS.connect(handleTick);

  // Session prime: previous close for stocks/indices (Finnhub quote, once).
  // Staggered to avoid a startup burst tripping provider rate limits.
  stockSymbols.forEach((s, i) => {
    if (primed.has(s)) return;
    primed.add(s);
    setTimeout(() => {
      fetchQuoteFinnhub(s).then(q => {
        if (q && q.price > 0) {
          applyQuote(s, {
            price: q.price, change: q.change, changePct: q.changePct,
            prevClose: q.prevClose, high: q.high, low: q.low,
          });
        }
      }).catch(() => {});
    }, i * 250);
  });

  // Quote polling: stocks + indices + crypto (BINANCE: prefix) with active-symbol priority.
  // FUTURES ARE NOT POLLED VIA FINNHUB — its free feed resolves ES/CL/NG to unrelated
  // STOCKS (Eversource, Colgate, NovaGold). Real futures come from the TwelveData
  // poller below (personal key), or are honestly marked unavailable.
  // This is the resilient live layer — it keeps every market fresh even when a WebSocket
  // is blocked, within the Finnhub free-tier 58/min budget (2s tick = 30 calls/min max).
  finnhubScheduler.start([
    ...getSymbolsByMarket("stocks").map(s => ({ app: s.symbol, fh: s.symbol })),
    ...getSymbolsByMarket("indices").filter(s => !s.symbol.startsWith("^")).map(s => ({ app: s.symbol, fh: s.symbol })),
    ...cryptoSymbols.map(s => ({ app: s, fh: `BINANCE:${s.replace("/", "")}` })),
  ]);

  // Crypto: continuous mesh refresh — round-robin in batches of 4 at ~6s,
  // with the ACTIVE symbol always in the next batch (so the pair on screen
  // re-quotes every few seconds through whichever free provider answers
  // fastest: CoinGecko → Coinbase → Kraken → OKX). The result feeds the
  // watchlist row AND the live candle aggregator.
  const cryptoSyms = getSymbolsByMarket("crypto");
  let cryptoIdx = 0;
  const refreshCrypto = async () => {
    const state = useTradingStore.getState();
    const activeFirst = state.activeMarket === "crypto"
      && cryptoSyms.some(c => c.symbol === state.activeSymbol)
      ? state.activeSymbol
      : null;
    const order = activeFirst
      ? [activeFirst, ...cryptoSyms.map(c => c.symbol).filter(s => s !== activeFirst)]
      : cryptoSyms.map(c => c.symbol);
    const batch = order.slice(cryptoIdx, cryptoIdx + 4);
    cryptoIdx = (cryptoIdx + 4) % order.length;

    await Promise.all(batch.map(async (sym) => {
      const q = await raceQuote(sym, "crypto", { timeoutMs: 3000, ttlMs: 1500 });
      if (q && q.price > 0) {
        // Same integrity guard as every other path: a glitchy provider winner
        // must never corrupt the live candle series.
        if (!quoteIsSane(sym, q.price)) return;
        aggregator.ingestTick(sym, q.price, q.volume || 0, Date.now());
        const st = useTradingStore.getState();
        const item = st.watchlist.find(w => w.symbol === sym);
        if (item) {
          st.setWatchlistItem({
            ...item, change: q.change, changePct: q.changePct, volume: q.volume,
            source: q.source, lastUpdate: Date.now(),
          });
        }
        st.setProviderStatus({ [q.source]: "live" });
        // Every mesh quote is a real market heartbeat
        st.setLastTick(Date.now());
      }
    }));
    useTradingStore.getState().setProviderStatus({
      coinbase: coinbaseStreamWS.status === "connected" ? "live" : "connecting",
      kraken: krakenStreamWS.status === "connected" ? "live" : "connecting",
      binance: binanceStreamWS.status === "connected" ? "live" : "connecting",
    });
  };
  refreshCrypto();
  setInterval(refreshCrypto, 6000);

  // Futures: REAL contract sources only (ES/CL/NG … — never Finnhub/Polygon
  // bare roots, which resolve to unrelated stocks). Sources in order:
  //   TwelveData (personal key; the shared free key is often day-exhausted)
  //   Yahoo ES=F / CL=F … via the relay chain (works in the browser now)
  // The raceQuote mesh applies the provider blacklist + budget gates and
  // shares its cache with the 2s active fast-path, so total Yahoo traffic
  // stays gentle (Yahoo 429s aggressive polling). Round-robin with
  // active-symbol priority, 15s tick.
  const futuresSyms = getSymbolsByMarket("futures");
  let futuresIdx = 0;
  let futuresRaceInFlight = false;
  const pollFutures = async () => {
    if (futuresRaceInFlight) return; // never stack slow relay races
    futuresRaceInFlight = true;
    try {
      const st = useTradingStore.getState();
      const active = st.activeMarket === "futures" ? st.activeSymbol : null;
      const sym = active || futuresSyms[futuresIdx++ % futuresSyms.length].symbol;
      const q = await raceQuote(sym, "futures", { timeoutMs: 11000, ttlMs: 9000 });
      if (q && q.price > 0) {
        applyQuote(sym, {
          price: q.price, change: q.change, changePct: q.changePct,
          prevClose: q.change !== 0 ? q.price - q.change : undefined,
          volume: q.volume,
        }, Date.now(), q.source);
      }
    } finally {
      futuresRaceInFlight = false;
    }
  };
  pollFutures();
  setInterval(pollFutures, 10_000);

  // Futures boot prime — warms the ENTIRE FUT watchlist so prices are already
  // on screen the moment the tab is opened (ES first, then CL, NG, …). Shares
  // the raceQuote cache with the fast path, so total Yahoo/relay traffic stays
  // gentle: each symbol is fetched once here, then kept fresh by the poller.
  futuresSyms.forEach((s, i) => {
    setTimeout(async () => {
      const q = await raceQuote(s.symbol, "futures", { timeoutMs: 11000, ttlMs: 9000 });
      if (q && q.price > 0) {
        applyQuote(s.symbol, {
          price: q.price, change: q.change, changePct: q.changePct,
          prevClose: q.change !== 0 ? q.price - q.change : undefined,
          volume: q.volume,
        }, Date.now(), q.source);
      }
    }, 1200 + i * 1300);
  });

  // Warm the DEFAULT futures chart (ES 15m) while the user is still on stocks,
  // so the FUT tab paints real Yahoo ES=F history immediately instead of
  // waiting for the cold relay chain (~5-10s) on first open. Cached 10 min.
  setTimeout(() => {
    fetchCandles("ES", "futures", "15min").catch(() => {});
  }, 5000);

  // Fast-path quotes for the ACTIVE symbol: every eligible free provider races
  // in parallel and the fastest valid quote lands within milliseconds — for
  // ALL markets including crypto (crypto is no longer hostage to the Binance
  // WS, which is geo-blocked from several regions). Runs immediately on boot
  // and every 2.5s so the active symbol's candles build from real quotes fast.
  // Futures get a longer budget: their only browser path is Yahoo through a
  // CORS relay (~3-6s), so a 2.5s timeout would always lose — and a longer
  // TTL shares the 15s poller's cache so Jina's free rate limit is never
  // hammered.
  let fastPathInFlight = false;
  const pollActiveFastPath = async () => {
    if (fastPathInFlight) return; // never stack slow relay races
    fastPathInFlight = true;
    try {
      const state = useTradingStore.getState();
      const { activeMarket, activeSymbol } = state;
      const isFutures = activeMarket === "futures";
      const q = await raceQuote(activeSymbol, activeMarket, {
        // Futures race through CORS relays (Yahoo ES=F/CL=F …) which can take
        // 4-10s — the race must not truncate a slow-but-working relay path.
        timeoutMs: isFutures ? 11000 : 2500,
        ttlMs: isFutures ? 8000 : 1200,
      });
      if (q && q.price > 0) {
        useTradingStore.getState().setProviderStatus({ [q.source]: "live" });
        if (activeMarket === "forex") {
          if (q.change !== 0) {
            applyQuote(activeSymbol, {
              price: q.price, change: q.change, changePct: q.changePct,
              prevClose: q.price - q.change,
            }, Date.now(), q.source);
          } else {
            applyFxQuote(activeSymbol, q.price, q.source);
          }
        } else {
          applyQuote(activeSymbol, {
            price: q.price, change: q.change, changePct: q.changePct,
            prevClose: q.change !== 0 ? q.price - q.change : undefined,
            volume: q.volume,
          }, Date.now(), q.source);
        }
      }
      const fp = getFastestProvider();
      if (fp) useTradingStore.getState().setFastestProvider(fp);
    } finally {
      fastPathInFlight = false;
    }
  };
  pollActiveFastPath();
  setInterval(pollActiveFastPath, 2000);

  // Cross-modal integrity auditor: independent providers cross-validated every
  // 20s for the active symbol. Persistent de-sync (≥2 consecutive audits) flags
  // an API fault that halts autonomous ML updates until quotes re-converge.
  let deSyncStreak = 0;
  setInterval(async () => {
    const state = useTradingStore.getState();
    const report = await crossValidate(state.activeSymbol, state.activeMarket);
    if (!report) return;
    state.setIntegrity(report);
    for (const s of report.sources) state.setProviderStatus({ [s.name]: "live" });
    if (report.verdict === "de-sync") {
      deSyncStreak++;
      if (deSyncStreak >= 2) state.setIntegrityFault(true);
    } else {
      deSyncStreak = 0;
      if (report.verdict === "ok") state.setIntegrityFault(false);
    }
  }, 20_000);

  // Forex: TwelveData primary → er-api (free, no key) → AlphaVantage real-time (active pair, cached 60s)
  // → ECB reference (watchlist fallback). Never goes stale: when the TD budget is exhausted the active
  // pair still updates via er-api/AV and the rest of the watchlist via er-api/ECB (real rates, labeled).
  const forex = getSymbolsByMarket("forex");
  let fxIdx = 0;
  const avFxCache = new Map<string, { price: number; at: number }>();
  const erFxCache = new Map<string, { price: number; at: number }>();
  /** AlphaVantage free tier = 1 req/sec: back off for 2 min after a failure so we never hammer it. */
  let avFxBlockedUntil = 0;

  /** er-api quote for a pair, cached 60s — keyless live FX. */
  const erQuote = async (pair: string): Promise<{ price: number; source: string } | null> => {
    const nowMs = Date.now();
    const cached = erFxCache.get(pair);
    if (cached && nowMs - cached.at < 60_000) return { price: cached.price, source: "exchangerate (cached)" };
    const er = await fetchQuoteExchangerate(pair);
    if (er && er.price > 0) {
      erFxCache.set(pair, { price: er.price, at: Date.now() });
      return { price: er.price, source: "exchangerate" };
    }
    return null;
  };

  /** Chain: TwelveData (budgeted) → er-api → AlphaVantage real-time → ECB reference. */
  const quoteFxPair = async (pair: string): Promise<boolean> => {
    const budget = getTDBudget();
    const tdAvailable = budget.minuteUsed < budget.minuteLimit && budget.dayUsed < budget.dayLimit;
    // 1) TwelveData when the budget allows — the shared free key is often
    //    exhausted server-side (429), so treat a failure as "not available".
    if (tdAvailable) {
      try {
        const q = await fetchQuoteTwelveData(pair);
        if (q && q.price > 0) {
          applyQuote(pair, {
            price: q.price, change: q.change, changePct: q.changePct,
            prevClose: q.price - q.change, high: q.high, low: q.low,
          }, Date.now(), "twelvedata");
          return true;
        }
      } catch { /* fall through — TD exhausted or transient */ }
    }
    // 2) er-api — free, no key, CORS-enabled, updated through the day
    const er = await erQuote(pair);
    if (er) {
      applyFxQuote(pair, er.price, er.source);
      return true;
    }
    // 3) AlphaVantage real-time exchange rate (cached 60s, 1 req/s guard)
    const nowMs = Date.now();
    const cached = avFxCache.get(pair);
    if (cached && nowMs - cached.at < 60_000) {
      applyFxQuote(pair, cached.price, "alpha-vantage (cached)");
      return true;
    }
    if (nowMs >= avFxBlockedUntil) {
      const q = await fetchQuoteAlphaVantageFx(pair);
      if (q && q.price > 0) {
        avFxCache.set(pair, { price: q.price, at: Date.now() });
        applyFxQuote(pair, q.price, "alpha-vantage");
        return true;
      }
      avFxBlockedUntil = nowMs + 120_000;
    }
    // 4) ECB daily fixing (Frankfurter) — real reference rates
    const ecb = await fetchQuoteFrankfurter(pair);
    if (ecb && ecb.price > 0) {
      applyFxQuote(pair, ecb.price, `ecb ${ecb.date}`);
      return true;
    }
    return false;
  };

  const pollForex = async () => {
    const state = useTradingStore.getState();
    const activeFx = state.activeMarket === "forex" ? state.activeSymbol : null;

    // 1) Active pair — freshest source available (never left blank when TD is dead)
    if (activeFx) {
      await quoteFxPair(activeFx);
    }

    // 2) Watchlist round-robin — same resilient chain, one pair per tick
    const symbol = forex[fxIdx % forex.length].symbol;
    fxIdx++;
    if (symbol !== activeFx) {
      await quoteFxPair(symbol);
    }
  };
  pollForex();
  setInterval(pollForex, 8_000);

  useTradingStore.getState().setIsConnected(true);
}

