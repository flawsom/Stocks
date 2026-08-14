import type { MarketType, ProviderQuote, IntegrityReport } from "@/types";
import { fetchPriceBinance, fetchQuoteFrankfurter, fetchQuoteFinnhub, fetchQuoteTwelveData, isTdDayExhausted } from "@/lib/dataProviders";
import { getSymbolMeta } from "@/constants/config";
import { fetchJson } from "@/lib/net";

/* ────────────────────────────────────────────────────────────────
 * MULTI-PROVIDER MESH
 *
 * Every eligible free provider for a market is queried in parallel
 * and the FASTEST valid quote wins (Promise.race + timeout) — no
 * single provider can stall the terminal. Every success feeds a
 * latency registry so the system learns which providers are fastest
 * from this network location. The same fetchers feed the cross-
 * modal integrity auditor (independent-source cross-validation).
 *
 * Providers (all free, no key required unless noted):
 *   Crypto  — Binance, CoinGecko, Coinbase, Kraken, Bybit, OKX, Bitstamp,
 *             Bitget, HTX (Huobi), Gemini, CoinPaprika, Bitrue, Deribit, BitMart
 *   Stocks  — Yahoo Finance, Finnhub (key, budget-guarded)
 *   Indices — Yahoo Finance, Finnhub (key, budget-guarded)
 *   Futures — Yahoo (ES=F — real contracts, where reachable) + TwelveData
 *             (key). NEVER Finnhub/Polygon bare roots: those resolve to
 *             unrelated STOCKS (ES=Eversource, CL=Colgate, NG=NovaGold).
 *   Forex   — Yahoo Finance, Frankfurter (ECB), Floatrates, open.er-api
 * ──────────────────────────────────────────────────────────────── */

interface MeshQuote { price: number; change: number; changePct: number; volume: number }

/* ── Latency registry ────────────────────────────────────────── */
const latencyLog = new Map<string, number[]>();

export function recordLatency(name: string, ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const arr = latencyLog.get(name) || [];
  arr.push(ms);
  if (arr.length > 8) arr.shift();
  latencyLog.set(name, arr);
}

export function getProviderLatency(name: string): number | null {
  const arr = latencyLog.get(name);
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Fastest measured provider right now (footer readout). */
export function getFastestProvider(): { name: string; ms: number } | null {
  let best: { name: string; ms: number } | null = null;
  for (const [name, arr] of latencyLog) {
    if (arr.length === 0) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (!best || avg < best.ms) best = { name, ms: avg };
  }
  return best;
}

export function getLatencies(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, arr] of latencyLog) {
    if (arr.length > 0) out[name] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  return out;
}

/* ── Helpers ─────────────────────────────────────────────────── */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(timer); resolve(v); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

async function jsonFetch(url: string, ms = 4000): Promise<any | null> {
  return fetchJson(url, { timeoutMs: ms });
}

/* ── Symbol maps ─────────────────────────────────────────────── */
const COINGECKO_IDS: Record<string, string> = {
  "BTC/USDT": "bitcoin", "ETH/USDT": "ethereum", "SOL/USDT": "solana",
  "BNB/USDT": "binancecoin", "XRP/USDT": "ripple", "ADA/USDT": "cardano",
  "DOGE/USDT": "dogecoin", "AVAX/USDT": "avalanche-2", "LTC/USDT": "litecoin",
  "LINK/USDT": "chainlink", "DOT/USDT": "polkadot", "SUI/USDT": "sui",
  "NEAR/USDT": "near", "ARB/USDT": "arbitrum",
};

const KRAKEN_NAMES: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

const FUTURES_YAHOO: Record<string, string> = {
  ES: "ES=F", CL: "CL=F", NG: "NG=F", SI: "SI=F", HG: "HG=F", ZS: "ZS=F",
  RB: "RB=F", BZ: "BZ=F", KC: "KC=F", SB: "SB=F", ZM: "ZM=F", GF: "GF=F", MGC: "MGC=F",
};

function baseQuote(symbol: string): [string, string] {
  const [base, quote] = symbol.split("/");
  return [base || symbol, quote || "USD"];
}

function toYahooSymbol(symbol: string, market: MarketType): string {
  // Explicit per-symbol Yahoo ticker (real index levels: ^GSPC, ^IXIC, ^VIX …)
  const meta = getSymbolMeta(symbol);
  if (meta?.yahooTicker) return meta.yahooTicker;
  if (market === "forex") {
    const [b, q] = baseQuote(symbol);
    return `${b}${q}=X`;
  }
  if (market === "crypto") {
    const [b, q] = baseQuote(symbol);
    return `${b}-${q === "USDT" ? "USD" : q}`;
  }
  if (market === "futures") return FUTURES_YAHOO[symbol] || `${symbol}=F`;
  return symbol; // stocks + indices ETFs use plain tickers
}

/* ── Crypto providers ────────────────────────────────────────── */

/** CoinGecko — free, no key, CORS-enabled, ~30 req/min. */
export async function fetchQuoteCoinGecko(symbol: string): Promise<MeshQuote | null> {
  const id = COINGECKO_IDS[symbol];
  if (!id) return null;
  const data = await jsonFetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
  );
  const d = data?.[id];
  if (!d || !(d.usd > 0)) return null;
  return {
    price: d.usd,
    change: 0,
    changePct: d.usd_24h_change ?? 0,
    volume: d.usd_24h_vol ?? 0,
  };
}

/** Coinbase Exchange — free, CORS-enabled. Quote is USD-based. */
export async function fetchQuoteCoinbase(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const pair = `${b}-${q === "USDT" ? "USD" : q}`;
  const [ticker, stats] = await Promise.all([
    jsonFetch(`https://api.exchange.coinbase.com/products/${pair}/ticker`),
    jsonFetch(`https://api.exchange.coinbase.com/products/${pair}/stats`),
  ]);
  const price = parseFloat(ticker?.price);
  if (!(price > 0)) return null;
  const open = parseFloat(stats?.open);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(ticker?.volume) || parseFloat(stats?.volume) || 0,
  };
}

/** Kraken public — free, CORS-enabled. Pair keys are normalized server-side
 * (XBT→XXBT, DOGE→XDG), so take the first result entry. */
export async function fetchQuoteKraken(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const pair = `${KRAKEN_NAMES[b] || b}${q === "USDT" ? "USD" : q}`;
  const data = await jsonFetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  const entries = data?.result ? Object.entries(data.result as Record<string, unknown>) : [];
  const d = entries.length > 0 ? (entries[0][1] as { c?: string[]; o?: string[]; v?: string[] } | null) : null;
  if (!d?.c?.[0]) return null;
  const price = parseFloat(d.c[0]);
  const open = parseFloat(d.o?.[1]);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d.v?.[1]) || 0,
  };
}

/** Bybit v5 spot — free. api.bybit.com is CloudFront-region-blocked from many
 * locations (403), so after one failed direct probe this fetcher switches to
 * region-independent paths: a one-shot WebSocket quote (stream.bybit.com is
 * reachable where the REST edge is blocked, and WS bypasses CORS entirely),
 * then a relay whose egress sits outside restricted regions (cors.lol). The
 * probe result persists in localStorage: blocked regions never spam CORS
 * errors, allowed regions keep the fast direct path. Attempts are throttled
 * (free shared infra) and the last good quote is served in between. */
let bybitDirectOk: boolean | null = null;
let lastBybitAttemptAt = 0;
let bybitCache: { q: MeshQuote; at: number } | null = null;
const BYBIT_DIRECT_FLAG = "omegatrade:bybitDirectOk";

function loadBybitFlag(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(BYBIT_DIRECT_FLAG);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch { /* non-browser */ }
  return null;
}

function saveBybitFlag(ok: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(BYBIT_DIRECT_FLAG, ok ? "1" : "0");
  } catch { /* storage unavailable */ }
}

function parseBybitTick(d: any): MeshQuote | null {
  if (!d?.lastPrice) return null;
  const price = parseFloat(d.lastPrice);
  if (!(price > 0)) return null;
  return {
    price,
    change: 0,
    changePct: parseFloat(d.price24hPcnt) * 100 || 0,
    volume: parseFloat(d.volume24h) || 0,
  };
}

/** One-shot Bybit ticker via WebSocket — no CORS, no REST geo-block. */
function bybitWsQuote(pair: string, timeoutMs: number): Promise<any | null> {
  return new Promise(resolve => {
    let ws: WebSocket | null = null;
    let settled = false;
    const done = (v: any) => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      ws = new WebSocket("wss://stream.bybit.com/v5/public/spot");
    } catch {
      done(null);
      return;
    }
    ws.onopen = () => {
      try { ws?.send(JSON.stringify({ op: "subscribe", args: [`tickers.${pair}`] })); } catch { done(null); }
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        const d = m?.data;
        if (d && d.lastPrice) { clearTimeout(timer); done(d); }
      } catch { /* keep waiting for a valid ticker */ }
    };
    ws.onerror = () => { clearTimeout(timer); done(null); };
  });
}

export async function fetchQuoteBybit(symbol: string): Promise<MeshQuote | null> {
  if (bybitDirectOk === null) bybitDirectOk = loadBybitFlag();
  const pair = symbol.replace("/", "");
  const url = `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${pair}`;

  if (bybitDirectOk !== false) {
    const direct = await fetchJson(url, { timeoutMs: 3000, proxy: false });
    if (direct) {
      bybitDirectOk = true;
      saveBybitFlag(true);
      return parseBybitTick(direct?.result?.list?.[0]);
    }
    bybitDirectOk = false;
    saveBybitFlag(false);
  }

  const now = Date.now();
  if (now - lastBybitAttemptAt < 4000) {
    // Throttled — serve the last real quote while it is still fresh.
    return bybitCache && now - bybitCache.at < 6000 ? bybitCache.q : null;
  }
  lastBybitAttemptAt = now;

  let q = parseBybitTick(await bybitWsQuote(pair, 6000));
  if (!q) q = parseBybitTick((await fetchJson(url, { timeoutMs: 4000, proxy: "lol-only" }))?.result?.list?.[0]);
  if (q) bybitCache = { q, at: Date.now() };
  return q;
}

/** OKX public — free, CORS-enabled. */
export async function fetchQuoteOkx(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const data = await jsonFetch(`https://www.okx.com/api/v5/market/ticker?instId=${b}-${q}`);
  const d = data?.data?.[0];
  if (!d?.last) return null;
  const price = parseFloat(d.last);
  const open = parseFloat(d.open24h);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d.vol24h) || 0,
  };
}

/** Bitstamp — free, no key, CORS-enabled (ACAO: *). */
export async function fetchQuoteBitstamp(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const pair = `${b}${q === "USDT" ? "USD" : q}`.toLowerCase();
  const data = await jsonFetch(`https://www.bitstamp.net/api/v2/ticker/${pair}/`);
  const price = parseFloat(data?.last);
  if (!(price > 0)) return null;
  const open = parseFloat(data?.open);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(data?.volume) || 0,
  };
}

/** Bitget — free, no key, CORS-enabled (ACAO: *). */
export async function fetchQuoteBitget(symbol: string): Promise<MeshQuote | null> {
  const inst = symbol.replace("/", "");
  const data = await jsonFetch(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${inst}`);
  const d = data?.data?.[0];
  const price = parseFloat(d?.lastPr);
  if (!(price > 0)) return null;
  const open = parseFloat(d?.open);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d?.baseVolume) || 0,
  };
}

/** HTX (Huobi) — free, CORS-enabled (ACAO echoes origin), USDT pairs. */
export async function fetchQuoteHtx(symbol: string): Promise<MeshQuote | null> {
  const pair = symbol.replace("/", "").toLowerCase();
  const data = await jsonFetch(`https://api.huobi.pro/market/detail/merged?symbol=${pair}`);
  const tick = data?.tick;
  const price = parseFloat(tick?.close);
  if (!(price > 0)) return null;
  const open = parseFloat(tick?.open);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(tick?.amount) || 0,
  };
}

/** Gemini — free, CORS-enabled (ACAO echoes origin). USD pairs only. */
export async function fetchQuoteGemini(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const pair = `${b}${q === "USDT" ? "USD" : q}`.toLowerCase();
  const data = await jsonFetch(`https://api.gemini.com/v1/pubticker/${pair}`);
  const price = parseFloat(data?.last);
  if (!(price > 0)) return null;
  return {
    price,
    change: 0,
    changePct: 0,
    volume: parseFloat(data?.volume?.[b]) || 0,
  };
}

/** CoinPaprika — free, CORS-enabled (ACAO *), no key. Uses the symbols= query
 * (CoinPaprika ids differ from CoinGecko's: btc-bitcoin vs bitcoin). */
export async function fetchQuoteCoinPaprika(symbol: string): Promise<MeshQuote | null> {
  const [b] = baseQuote(symbol);
  if (!b) return null;
  const data = await jsonFetch(`https://api.coinpaprika.com/v1/tickers?symbols=${encodeURIComponent(b)}&quotes=USD`);
  const t = Array.isArray(data) ? (data as { symbol?: string; quotes?: { USD?: Record<string, unknown> } }[]).find(x => x?.symbol === b) : undefined;
  const q = t?.quotes?.USD;
  const price = parseFloat(q?.price as string);
  if (!(price > 0)) return null;
  return {
    price,
    change: 0,
    changePct: parseFloat(q?.percent_change_24h as string) || 0,
    volume: parseFloat(q?.volume_24h as string) || 0,
  };
}

/** Bitrue — free, CORS-enabled (ACAO *), no key. Binance-style 24h ticker. */
export async function fetchQuoteBitrue(symbol: string): Promise<MeshQuote | null> {
  const inst = symbol.replace("/", "").toUpperCase();
  const data = await jsonFetch(`https://openapi.bitrue.com/api/v1/ticker/24hr?symbol=${inst}`);
  const d = Array.isArray(data) ? data[0] : data;
  const price = parseFloat(d?.lastPrice);
  if (!(price > 0)) return null;
  const open = parseFloat(d?.openPrice);
  const changePct = parseFloat(d?.priceChangePercent);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: Number.isFinite(changePct) ? changePct : open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d?.volume) || 0,
  };
}

/** Deribit — free, CORS-enabled (ACAO echoes origin). BTC/ETH index prices. */
export async function fetchQuoteDeribit(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  if (b !== "BTC" && b !== "ETH") return null;
  const idx = `${b.toLowerCase()}_${q === "USDT" ? "usd" : q.toLowerCase()}`;
  const data = await jsonFetch(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${idx}`);
  const price = parseFloat(data?.result?.index_price);
  if (!(price > 0)) return null;
  return { price, change: 0, changePct: 0, volume: 0 };
}

/** BitMart — free, CORS-enabled (ACAO echoes origin), no key. v3 quotation API
 * (v1/v2 endpoints are deprecated). Real-time USDT pairs. */
export async function fetchQuoteBitMart(symbol: string): Promise<MeshQuote | null> {
  const inst = symbol.replace("/", "_");
  const data = await jsonFetch(`https://api-cloud.bitmart.com/spot/quotation/v3/ticker?symbol=${inst}`);
  const d = data?.data;
  const price = parseFloat(d?.last);
  if (!(price > 0)) return null;
  const open = parseFloat(d?.open_24h);
  const fluctuation = parseFloat(d?.fluctuation);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: Number.isFinite(fluctuation) ? fluctuation * 100 : open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d?.v_24h) || 0,
  };
}

/** KuCoin — free, no key, CORS-enabled. */
export async function fetchQuoteKuCoin(symbol: string): Promise<MeshQuote | null> {
  const pair = symbol.replace("/", "-");
  const data = await jsonFetch(`https://api.kucoin.com/api/v1/market/stats?symbol=${pair}`);
  const d = data?.data;
  const price = parseFloat(d?.last);
  if (!(price > 0)) return null;
  const open = parseFloat(d?.open);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d?.volValue) || 0,
  };
}

/** MEXC — free, no key, Binance-style 24h ticker. */
export async function fetchQuoteMexc(symbol: string): Promise<MeshQuote | null> {
  const inst = symbol.replace("/", "").toUpperCase();
  const data = await jsonFetch(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${inst}`);
  const price = parseFloat(data?.lastPrice);
  if (!(price > 0)) return null;
  const open = parseFloat(data?.openPrice);
  const chg = parseFloat(data?.priceChangePercent);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: Number.isFinite(chg) ? chg : open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(data?.volume) || 0,
  };
}

/** Gate.io — free, no key, CORS-enabled. */
export async function fetchQuoteGateio(symbol: string): Promise<MeshQuote | null> {
  const pair = symbol.replace("/", "_");
  const data = await jsonFetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`);
  const d = Array.isArray(data) ? data[0] : undefined;
  const price = parseFloat(d?.last);
  if (!(price > 0)) return null;
  const open = parseFloat(d?.open_24h);
  return {
    price,
    change: open > 0 ? price - open : 0,
    changePct: open > 0 ? ((price - open) / open) * 100 : 0,
    volume: parseFloat(d?.base_volume) || 0,
  };
}

/** Poloniex — free, no key, CORS-enabled. */
export async function fetchQuotePoloniex(symbol: string): Promise<MeshQuote | null> {
  const pair = symbol.replace("/", "_");
  const data = await jsonFetch(`https://api.poloniex.com/markets/${pair}/price`);
  const price = parseFloat(data?.price);
  if (!(price > 0)) return null;
  return { price, change: 0, changePct: 0, volume: 0 };
}

/* ── Equities / indices / futures providers ──────────────────── */

/** Yahoo Finance chart API — free, no key. Sends NO CORS headers, so the
 * browser reaches it via the relay chain (allorigins → Jina reader); the
 * Node test runner and some regions hit it directly. */
export async function fetchQuoteYahoo(symbol: string, market: MarketType): Promise<MeshQuote | null> {
  const y = toYahooSymbol(symbol, market);
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=1d`,
    { timeoutMs: 4000, proxy: "yahoo" }
  );
  const meta = data?.chart?.result?.[0]?.meta;
  const price = parseFloat(meta?.regularMarketPrice);
  if (!(price > 0)) return null;
  const prev = parseFloat(meta?.chartPreviousClose) || parseFloat(meta?.previousClose) || price;
  return {
    price,
    change: prev > 0 ? price - prev : 0,
    changePct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
    volume: parseFloat(meta?.regularMarketVolume) || 0,
  };
}

/* ── Forex providers ─────────────────────────────────────────── */

/** open.er-api (exchangerate-api free tier) — no key, CORS-enabled, updated daily. */
export async function fetchQuoteExchangerate(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const data = await jsonFetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(b)}`);
  const price = parseFloat(data?.rates?.[q]);
  if (!(price > 0)) return null;
  return { price, change: 0, changePct: 0, volume: 0 };
}

/** Floatrates — free, CORS-enabled (ACAO *), keyless daily reference rates. */
export async function fetchQuoteFloatrates(symbol: string): Promise<MeshQuote | null> {
  const [b, q] = baseQuote(symbol);
  const data = await jsonFetch(`https://www.floatrates.com/daily/${encodeURIComponent(b.toLowerCase())}.json`);
  const price = parseFloat(data?.[q.toLowerCase()]?.rate);
  if (!(price > 0)) return null;
  return { price, change: 0, changePct: 0, volume: 0 };
}

/* ── Finnhub supplementary budget guard (race path only) ─────── */
const finnhubRace = { windowStart: Date.now(), used: 0 };

function finnhubRaceAllowed(): boolean {
  const now = Date.now();
  if (now - finnhubRace.windowStart >= 60_000) {
    finnhubRace.windowStart = now;
    finnhubRace.used = 0;
  }
  if (finnhubRace.used >= 12) return false; // scheduler owns the rest of the 58/min
  finnhubRace.used++;
  return true;
}

/* ── Provider selection ──────────────────────────────────────── */
interface MeshProvider { name: string; fetch: () => Promise<MeshQuote | null> }

function meshProvidersFor(symbol: string, market: MarketType): MeshProvider[] {
  switch (market) {
    case "crypto":
      return [
        { name: "binance", fetch: () => fetchPriceBinance(symbol) },
        { name: "coingecko", fetch: () => fetchQuoteCoinGecko(symbol) },
        { name: "coinbase", fetch: () => fetchQuoteCoinbase(symbol) },
        { name: "kraken", fetch: () => fetchQuoteKraken(symbol) },
        { name: "bybit", fetch: () => fetchQuoteBybit(symbol) },
        { name: "okx", fetch: () => fetchQuoteOkx(symbol) },
        { name: "bitstamp", fetch: () => fetchQuoteBitstamp(symbol) },
        { name: "bitget", fetch: () => fetchQuoteBitget(symbol) },
        { name: "htx", fetch: () => fetchQuoteHtx(symbol) },
        { name: "gemini", fetch: () => fetchQuoteGemini(symbol) },
        { name: "coinpaprika", fetch: () => fetchQuoteCoinPaprika(symbol) },
        { name: "bitrue", fetch: () => fetchQuoteBitrue(symbol) },
        { name: "deribit", fetch: () => fetchQuoteDeribit(symbol) },
        { name: "bitmart", fetch: () => fetchQuoteBitMart(symbol) },
        { name: "kucoin", fetch: () => fetchQuoteKuCoin(symbol) },
        { name: "mexc", fetch: () => fetchQuoteMexc(symbol) },
        { name: "gateio", fetch: () => fetchQuoteGateio(symbol) },
        { name: "poloniex", fetch: () => fetchQuotePoloniex(symbol) },
      ];
    case "stocks":
    case "indices": {
      const providers: MeshProvider[] = [
        { name: "yahoo", fetch: () => fetchQuoteYahoo(symbol, market) },
      ];
      if (finnhubRaceAllowed()) {
        providers.push({ name: "finnhub", fetch: () => fetchQuoteFinnhub(symbol) });
      }
      return providers;
    }
    case "futures": {
      // NEVER poll Finnhub/Polygon with bare futures roots: they resolve to
      // unrelated STOCKS (ES=Eversource, CL=Colgate, NG=NovaGold, HG=Hamilton,
      // ZS=Zscaler). The only real-contract sources are Yahoo (ES=F, CL=F, …
      // — works where the browser can reach it; CORS-blocked in many regions,
      // fails fast and is blacklisted after 3 misses) and TwelveData (needs a
      // personal VITE_TWELVE_DATA_KEY when the shared key is day-exhausted).
      // No reachable source → honest null, never a wrong price.
      const providers: MeshProvider[] = [
        { name: "yahoo", fetch: () => fetchQuoteYahoo(symbol, market) },
      ];
      if (!isTdDayExhausted()) {
        providers.push({ name: "twelvedata", fetch: () => fetchQuoteTwelveData(symbol) });
      }
      return providers;
    }
    case "forex":
      return [
        { name: "yahoo", fetch: () => fetchQuoteYahoo(symbol, market) },
        {
          name: "frankfurter",
          fetch: async () => {
            const q = await fetchQuoteFrankfurter(symbol);
            return q ? { price: q.price, change: 0, changePct: 0, volume: 0 } : null;
          },
        },
        { name: "floatrates", fetch: () => fetchQuoteFloatrates(symbol) },
        { name: "exchangerate", fetch: () => fetchQuoteExchangerate(symbol) },
      ];
    default:
      return [];
  }
}

/* ── Provider blacklist ────────────────────────────────────────
 * Some public endpoints are geo-blocked (Binance 451, Bybit 403)
 * or CORS-blocked from certain origins. After 3 consecutive nulls
 * for a (provider, symbol) pair we stop calling it for a few
 * minutes — the race then resolves from the working providers in
 * milliseconds instead of waiting on blocked ones. A success
 * clears the streak immediately.
 * ────────────────────────────────────────────────────────────── */
const providerNullStreak = new Map<string, number>();
const providerBlacklist = new Map<string, number>();
const BLACKLIST_MS = 3 * 60_000;

function providerKey(name: string, symbol: string) {
  return `${name}|${symbol}`;
}

function isProviderBlocked(key: string): boolean {
  return (providerBlacklist.get(key) || 0) > Date.now();
}

function recordProviderResult(name: string, symbol: string, ok: boolean) {
  const key = providerKey(name, symbol);
  if (ok) {
    providerNullStreak.delete(key);
    providerBlacklist.delete(key);
    return;
  }
  const streak = (providerNullStreak.get(key) || 0) + 1;
  providerNullStreak.set(key, streak);
  if (streak >= 3) {
    providerBlacklist.set(key, Date.now() + BLACKLIST_MS);
    providerNullStreak.delete(key);
  }
}

/* ── Fastest-wins quote race ─────────────────────────────────── */
const QUOTE_CACHE = new Map<string, { q: ProviderQuote; at: number }>();

export async function raceQuote(
  symbol: string,
  market: MarketType,
  opts?: { timeoutMs?: number; ttlMs?: number }
): Promise<ProviderQuote | null> {
  const cacheKey = `${symbol}|${market}`;
  const ttl = opts?.ttlMs ?? (market === "crypto" ? 2500 : 5000);
  const hit = QUOTE_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl) return hit.q;

  const t0 = performance.now();
  const providers = meshProvidersFor(symbol, market)
    .filter(p => !isProviderBlocked(providerKey(p.name, symbol)));
  if (providers.length === 0) return null;

  const timeoutMs = opts?.timeoutMs ?? 2500;
  const winner = await new Promise<ProviderQuote | null>(resolve => {
    let done = false;
    const finish = (q: ProviderQuote) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(q);
    };
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);

    for (const p of providers) {
      p.fetch()
        .then(q => {
          const ok = !!(q && q.price > 0 && Number.isFinite(q.price));
          recordProviderResult(p.name, symbol, ok);
          if (ok) {
            const quote: ProviderQuote = {
              ...q!, source: p.name, latencyMs: performance.now() - t0, at: Date.now(),
            };
            // Sanity guard: some free endpoints (e.g. Coinbase /stats, Finnhub crypto
            // prefixes) occasionally report a broken 24h open that yields absurd
            // change%. Never let a provider glitch paint a fake move on the UI.
            if (!Number.isFinite(quote.changePct) || Math.abs(quote.changePct) > 100) {
              quote.changePct = 0;
              quote.change = 0;
            }
            recordLatency(p.name, quote.latencyMs);
            finish(quote);
          }
        })
        .catch(() => {});
    }
  });

  if (winner) QUOTE_CACHE.set(cacheKey, { q: winner, at: Date.now() });
  return winner;
}

/* ── Cross-modal integrity auditor ───────────────────────────── */
export function judgeIntegrity(
  prices: { name: string; price: number }[]
): { median: number; maxDevPct: number; verdict: IntegrityReport["verdict"] } {
  const valid = prices.filter(p => p.price > 0);
  const sorted = valid.map(p => p.price).sort((a, b) => a - b);
  if (sorted.length === 0) return { median: 0, maxDevPct: Infinity, verdict: "de-sync" };
  const median = sorted.length % 2 === 1
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const maxDevPct = Math.max(...valid.map(p => (Math.abs(p.price - median) / median) * 100));
  const verdict: IntegrityReport["verdict"] =
    maxDevPct <= 0.15 ? "ok" : maxDevPct <= 1 ? "degraded" : "de-sync";
  return { median, maxDevPct, verdict };
}

/** Query independent providers in parallel and audit agreement. */
export async function crossValidate(
  symbol: string,
  market: MarketType,
  opts?: { timeoutMs?: number }
): Promise<IntegrityReport | null> {
  const providers = meshProvidersFor(symbol, market)
    .filter(p => !isProviderBlocked(providerKey(p.name, symbol)))
    .slice(0, 4);
  if (providers.length < 2) return null;
  const timeoutMs = opts?.timeoutMs ?? 4000;
  const t0 = performance.now();

  const results = await Promise.all(
    providers.map(async p => {
      const q = await withTimeout(p.fetch(), timeoutMs);
      if (!q || !(q.price > 0)) return null;
      recordLatency(p.name, performance.now() - t0);
      return { name: p.name, price: q.price, latencyMs: performance.now() - t0, at: Date.now() };
    })
  );
  const sources = results.filter(Boolean) as { name: string; price: number; latencyMs: number; at: number }[];
  if (sources.length < 2) return null;

  const judged = judgeIntegrity(sources);
  return {
    symbol,
    checkedAt: Date.now(),
    sources,
    median: judged.median,
    maxDevPct: judged.maxDevPct,
    verdict: judged.verdict,
  };
}
