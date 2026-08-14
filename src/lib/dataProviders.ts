import { API_KEYS, ENDPOINTS, FINNHUB_RESOLUTION, BINANCE_INTERVAL, TWELVE_DATA_BUDGET, getSymbolMeta } from "@/constants/config";
import type { OHLCV, MarketType, DataSource, NewsItem } from "@/types";
import { fetchJson } from "@/lib/net";

/* ────────────────────────────────────────────────────────────────
 * Twelve Data free-tier budget tracking (8 credits/min, 800/day).
 * Minute counter is in-memory; day counter persists across reloads.
 * ──────────────────────────────────────────────────────────────── */

const TD_STORE_KEY = "omegatrade-td-budget";
interface TDBudgetState { day: string; dayUsed: number }

function loadDayBudget(): number {
  try {
    const raw = localStorage.getItem(TD_STORE_KEY);
    if (raw) {
      const s: TDBudgetState = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      if (s.day === today) return s.dayUsed;
    }
  } catch { /* ignore */ }
  return 0;
}

function saveDayBudget(used: number) {
  try {
    const s: TDBudgetState = { day: new Date().toISOString().slice(0, 10), dayUsed: used };
    localStorage.setItem(TD_STORE_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

const tdBudget = {
  minute: { windowStart: Date.now(), used: 0 },
  dayUsed: loadDayBudget(),
};

/* ─── TwelveData server-side day-exhaustion flag ────────────────
 * The shared free key can be exhausted SERVER-side (429 “out of API
 * credits for the day” — currently at 5,801/800 used) even when the local
 * minute/day counters look fine. Remember that state until the next UTC
 * day so the app stops burning calls, and stops the WebSocket from
 * reconnecting forever against a dead key. A personal VITE_TWELVE_DATA_KEY
 * clears it naturally (fresh key, fresh budget).
 * ──────────────────────────────────────────────────────────────── */

const TD_EXHAUSTED_KEY = "omegatrade-td-day-exhausted";
const TD_KEY_FP_KEY = "omegatrade-td-key-fp";
let tdDayExhaustedUntil = loadTdExhaustedFlag();

function loadTdExhaustedFlag(): number {
  try {
    return parseInt(localStorage.getItem(TD_EXHAUSTED_KEY) || "0", 10) || 0;
  } catch { /* non-browser */ }
  return 0;
}

/* When the TwelveData key CHANGES (e.g. a fresh personal VITE_TWELVE_DATA_KEY
 * after a rebuild), clear the stale day-exhaustion flag and local day counter —
 * a new key has a fresh server-side budget. */
(function initTdKeyFingerprint() {
  try {
    const prev = localStorage.getItem(TD_KEY_FP_KEY) || "";
    const cur = API_KEYS.TWELVE_DATA || "";
    if (prev !== cur) {
      localStorage.removeItem(TD_EXHAUSTED_KEY);
      localStorage.removeItem(TD_STORE_KEY);
      tdDayExhaustedUntil = 0;
      tdBudget.dayUsed = 0;
      localStorage.setItem(TD_KEY_FP_KEY, cur);
    }
  } catch { /* storage unavailable */ }
})();

function persistTdExhaustedFlag(until: number) {
  tdDayExhaustedUntil = until;
  try { localStorage.setItem(TD_EXHAUSTED_KEY, String(until)); } catch { /* storage unavailable */ }
}

/** True while the server has confirmed the TwelveData day budget is spent. */
export function isTdDayExhausted(): boolean {
  if (tdDayExhaustedUntil > 0 && Date.now() > tdDayExhaustedUntil) {
    tdDayExhaustedUntil = 0;
    try { localStorage.removeItem(TD_EXHAUSTED_KEY); } catch { /* ignore */ }
  }
  return Date.now() < tdDayExhaustedUntil;
}

/** Remember the server-side 429 until 23:59:59 UTC today. */
function markTdDayExhausted() {
  const d = new Date();
  persistTdExhaustedFlag(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function getTDBudget(): { minuteUsed: number; minuteLimit: number; dayUsed: number; dayLimit: number } {
  const now = Date.now();
  if (now - tdBudget.minute.windowStart >= 60_000) {
    tdBudget.minute = { windowStart: now, used: 0 };
  }
  return {
    minuteUsed: tdBudget.minute.used,
    minuteLimit: TWELVE_DATA_BUDGET.minuteLimit,
    dayUsed: tdBudget.dayUsed,
    dayLimit: TWELVE_DATA_BUDGET.dayLimit,
  };
}

/** Reserve a TD credit; returns false when the minute or day budget is exhausted */
function takeTDCredit(): boolean {
  const now = Date.now();
  if (now - tdBudget.minute.windowStart >= 60_000) {
    tdBudget.minute = { windowStart: now, used: 0 };
  }
  if (tdBudget.minute.used >= TWELVE_DATA_BUDGET.minuteLimit) return false;
  if (tdBudget.dayUsed >= TWELVE_DATA_BUDGET.dayLimit) return false;
  tdBudget.minute.used++;
  tdBudget.dayUsed++;
  saveDayBudget(tdBudget.dayUsed);
  return true;
}

/* ─── Candle series cache (per symbol + interval) ─────────────── */

const candleCache = new Map<string, { candles: OHLCV[]; at: number }>();

function cacheKey(symbol: string, interval: string): string {
  return `${symbol}|${interval}`;
}

function getCached(symbol: string, interval: string): OHLCV[] | null {
  const hit = candleCache.get(cacheKey(symbol, interval));
  if (!hit) return null;
  if (Date.now() - hit.at > TWELVE_DATA_BUDGET.candleCacheTtl * 1000) {
    candleCache.delete(cacheKey(symbol, interval));
    return null;
  }
  return hit.candles;
}

function setCache(symbol: string, interval: string, candles: OHLCV[]) {
  candleCache.set(cacheKey(symbol, interval), { candles, at: Date.now() });
  // Bound cache size
  if (candleCache.size > 120) {
    const first = candleCache.keys().next().value;
    if (first) candleCache.delete(first);
  }
}

/* ─── Twelve Data REST ─────────────────────────────────────────── */

export async function fetchCandlesTwelveData(
  symbol: string,
  interval: string,
  outputsize = 200
): Promise<OHLCV[]> {
  if (isTdDayExhausted()) {
    throw new Error("TwelveData day credits exhausted server-side (add a personal VITE_TWELVE_DATA_KEY)");
  }
  if (!takeTDCredit()) {
    throw new Error("TwelveData budget exhausted (minute or daily cap)");
  }
  const cleanSymbol = symbol.replace("/", "");
  const url = `${ENDPOINTS.TWELVE_DATA_REST}/time_series?symbol=${encodeURIComponent(cleanSymbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEYS.TWELVE_DATA}`;

  const data = await fetchJson(url);
  if (data?.code === 429 || (data?.message && String(data.message).includes("out of API credits for the day"))) {
    markTdDayExhausted();
    throw new Error("TwelveData day credits exhausted server-side (add a personal VITE_TWELVE_DATA_KEY)");
  }
  if (!data || data.status === "error" || !data.values) {
    throw new Error(data?.message || "No data from Twelve Data");
  }

  interface TDValue { datetime: string; open: string; high: string; low: string; close: string; volume?: string }
  return (data.values as TDValue[])
    .reverse()
    .map((v) => ({
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume || "0"),
    }));
}

export async function fetchQuoteTwelveData(symbol: string): Promise<{
  price: number; change: number; changePct: number;
  high: number; low: number; volume: number;
} | null> {
  if (isTdDayExhausted()) return null;
  if (!takeTDCredit()) return null;
  const cleanSymbol = symbol.replace("/", "");
  const url = `${ENDPOINTS.TWELVE_DATA_REST}/quote?symbol=${encodeURIComponent(cleanSymbol)}&apikey=${API_KEYS.TWELVE_DATA}`;

  try {
    const data = await fetchJson(url);
    if (data?.code === 429 || (data?.message && String(data.message).includes("out of API credits for the day"))) {
      markTdDayExhausted();
      return null;
    }
    if (!data || data.status === "error" || !data.close) return null;
    return {
      price: parseFloat(data.close),
      change: parseFloat(data.change || "0"),
      changePct: parseFloat(data.percent_change || "0"),
      high: parseFloat(data.fifty_two_week?.high || data.high || "0"),
      low: parseFloat(data.fifty_two_week?.low || data.low || "0"),
      volume: parseFloat(data.volume || "0"),
    };
  } catch {
    return null;
  }
}

/* ─── Finnhub Quote ────────────────────────────────────────────── */

/** Crypto quotes via Finnhub (BINANCE: prefix) — a geo-independent fallback to the Binance API. */
export async function fetchQuoteFinnhubCrypto(symbol: string) {
  const clean = symbol.replace("/", "");
  return fetchQuoteFinnhub(`BINANCE:${clean}`);
}

export async function fetchQuoteFinnhub(symbol: string): Promise<{
  price: number; open: number; high: number; low: number;
  prevClose: number; change: number; changePct: number; volume: number;
} | null> {
  try {
    const url = `${ENDPOINTS.FINNHUB_REST}/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEYS.FINNHUB}`;
    const data = await fetchJson(url);
    if (!data || !data.c || data.c === 0) return null;

    // Finnhub can return a broken prev-close (esp. for BINANCE: crypto prefixes),
    // which produces absurd dp values (e.g. +2,000,000%). Sanity-guard it: if the
    // reported change% is not finite or is wildly out of range, recompute from the
    // previous close and drop the quote entirely when that is also unusable.
    let changePct = data.dp;
    if (!Number.isFinite(changePct) || Math.abs(changePct) > 500) {
      changePct = data.pc > 0 ? ((data.c - data.pc) / data.pc) * 100 : 0;
    }

    return {
      price: data.c,
      open: data.o,
      high: data.h,
      low: data.l,
      prevClose: data.pc,
      change: Number.isFinite(data.d) ? data.d : data.pc > 0 ? data.c - data.pc : 0,
      changePct,
      volume: 0,
    };
  } catch {
    return null;
  }
}

/* ─── Alpha Vantage (daily candles — free tier, 25 req/day) ───── */

export async function fetchCandlesAlphaVantageDaily(symbol: string): Promise<OHLCV[]> {
  const params = new URLSearchParams({
    function: "TIME_SERIES_DAILY",
    symbol: symbol.replace("/", ""),
    apikey: API_KEYS.ALPHA_VANTAGE,
    outputsize: "compact",
  });

  const data = await fetchJson(`${ENDPOINTS.ALPHA_VANTAGE_REST}?${params}`);
  if (!data) throw new Error("No daily data from Alpha Vantage");
  const seriesKey = Object.keys(data).find(k => k.includes("Time Series"));
  if (!seriesKey || !data[seriesKey]) throw new Error("No daily data from Alpha Vantage");

  interface AVValue { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume"?: string }
  const series = data[seriesKey] as Record<string, AVValue>;
  return Object.entries(series)
    .map(([date, vals]) => ({
      time: Math.floor(new Date(date).getTime() / 1000),
      open: parseFloat(vals["1. open"]),
      high: parseFloat(vals["2. high"]),
      low: parseFloat(vals["3. low"]),
      close: parseFloat(vals["4. close"]),
      volume: parseFloat(vals["5. volume"] || "0"),
    }))
    .sort((a, b) => a.time - b.time);
}

/* ─── Forex live fallbacks (used when the TwelveData budget is exhausted) ─── */

/** Alpha Vantage real-time exchange rate (25 req/day — callers must cache aggressively). */
export async function fetchQuoteAlphaVantageFx(symbol: string): Promise<{ price: number; refreshedAt: string } | null> {
  const [from, to] = symbol.split("/");
  if (!from || !to) return null;
  try {
    const params = new URLSearchParams({
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: from,
      to_currency: to,
      apikey: API_KEYS.ALPHA_VANTAGE,
    });
    const data = await fetchJson(`${ENDPOINTS.ALPHA_VANTAGE_REST}?${params}`);
    if (!data) return null;
    const d = data["Realtime Currency Exchange Rate"];
    if (!d || !d["5. Exchange Rate"]) return null;
    const price = parseFloat(d["5. Exchange Rate"]);
    if (!(price > 0)) return null;
    return { price, refreshedAt: d["6. Last Refreshed"] || "" };
  } catch {
    return null;
  }
}

/** ECB reference rate via Frankfurter (free, no key — real daily ECB fixings, updated every bank day).
 * frankfurter.app 301s to frankfurter.dev; the free tier occasionally returns
 * empty bodies, so both hosts are tried before giving up. */
export async function fetchQuoteFrankfurter(symbol: string): Promise<{ price: number; date: string } | null> {
  const [from, to] = symbol.split("/");
  if (!from || !to) return null;
  const urls = [
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    `https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ];
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      const price = data?.rates?.[to];
      if (price > 0) return { price, date: data.date || "" };
    } catch { /* try next host */ }
  }
  return null;
}

/* ─── Alpha Vantage FX daily (forex — free tier, 25 req/day) ─── */

export async function fetchCandlesAlphaVantageFxDaily(symbol: string): Promise<OHLCV[]> {
  const [from, to] = symbol.split("/");
  if (!from || !to) throw new Error("Invalid FX symbol");
  const params = new URLSearchParams({
    function: "FX_DAILY",
    from_symbol: from,
    to_symbol: to,
    apikey: API_KEYS.ALPHA_VANTAGE,
    outputsize: "compact",
  });
  const data = await fetchJson(`${ENDPOINTS.ALPHA_VANTAGE_REST}?${params}`);
  if (!data) throw new Error("No FX daily data");
  const seriesKey = Object.keys(data).find(k => k.includes("Time Series FX"));
  if (!seriesKey || !data[seriesKey]) throw new Error("No FX daily data");

  interface AVFxValue { "1. open": string; "2. high": string; "3. low": string; "4. close": string }
  return Object.entries(data[seriesKey] as Record<string, AVFxValue>)
    .map(([date, vals]) => ({
      time: Math.floor(new Date(date).getTime() / 1000),
      open: parseFloat(vals["1. open"]),
      high: parseFloat(vals["2. high"]),
      low: parseFloat(vals["3. low"]),
      close: parseFloat(vals["4. close"]),
      volume: 0,
    }))
    .sort((a, b) => a.time - b.time);
}

/* ─── Polygon (free tier: 5 calls/min) ──────────────────────────── */

const POLYGON_STORE_KEY = "omegatrade-polygon-budget";
interface PolygonBudgetState { day: string; dayUsed: number }

function loadPolygonDay(): number {
  try {
    const raw = localStorage.getItem(POLYGON_STORE_KEY);
    if (raw) {
      const s: PolygonBudgetState = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      if (s.day === today) return s.dayUsed;
    }
  } catch { /* ignore */ }
  return 0;
}

function savePolygonDay(used: number) {
  try {
    const s: PolygonBudgetState = { day: new Date().toISOString().slice(0, 10), dayUsed: used };
    localStorage.setItem(POLYGON_STORE_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

const polygonBudget = {
  minute: { windowStart: Date.now(), used: 0 },
  dayUsed: loadPolygonDay(),
};

/** Polygon free-tier guard: 5 calls/min, 300/day (monthly caps are far higher). */
function takePolygonCredit(): boolean {
  const now = Date.now();
  if (now - polygonBudget.minute.windowStart >= 60_000) {
    polygonBudget.minute = { windowStart: now, used: 0 };
  }
  if (polygonBudget.minute.used >= 4) return false;
  if (polygonBudget.dayUsed >= 300) return false;
  polygonBudget.minute.used++;
  polygonBudget.dayUsed++;
  savePolygonDay(polygonBudget.dayUsed);
  return true;
}

export function getPolygonBudget(): { minuteUsed: number; minuteLimit: number; dayUsed: number; dayLimit: number } {
  const now = Date.now();
  if (now - polygonBudget.minute.windowStart >= 60_000) {
    polygonBudget.minute = { windowStart: now, used: 0 };
  }
  return {
    minuteUsed: polygonBudget.minute.used,
    minuteLimit: 4,
    dayUsed: polygonBudget.dayUsed,
    dayLimit: 300,
  };
}

/** Map Timeframe -> Polygon aggs spec + how far back to look. */
const POLYGON_TIMESPAN: Record<string, { multiplier: number; timespan: string; days: number }> = {
  "1min": { multiplier: 1, timespan: "minute", days: 5 },
  "5min": { multiplier: 5, timespan: "minute", days: 10 },
  "15min": { multiplier: 15, timespan: "minute", days: 30 },
  "30min": { multiplier: 30, timespan: "minute", days: 40 },
  "1h": { multiplier: 1, timespan: "hour", days: 90 },
  "4h": { multiplier: 4, timespan: "hour", days: 180 },
  "1day": { multiplier: 1, timespan: "day", days: 180 },
};

/** Intraday/daily aggregates for a symbol (stocks, indices, forex C: pairs, crypto X: pairs).
 * The free tier returns DELAYED but real bars — verified live (AAPL 15m in ~200ms,
 * CORS-enabled). When `market` is given, forex pairs map to Polygon's C: tickers.
 *
 * sort=desc is REQUIRED: the free tier paginates intraday in small chunks (the
 * first page of sort=asc starts at the BEGINNING of the range, so a 30-day chart
 * ended a month ago). desc returns the most recent bars first, and following
 * next_url keeps the series current. The live aggregator tops up from there. */
export async function fetchCandlesPolygon(symbol: string, interval: string, market?: MarketType): Promise<OHLCV[]> {
  const spec = POLYGON_TIMESPAN[interval] || POLYGON_TIMESPAN["15min"];
  const to = new Date();
  const from = new Date(to.getTime() - spec.days * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const ticker = market === "forex"
    ? (POLYGON_FOREX[symbol] || `C:${symbol.replace("/", "")}`)
    : symbol;

  interface PolygonResult { t: number; o: number; h: number; l: number; c: number; v: number }
  const rows: PolygonResult[] = [];
  let url = `${ENDPOINTS.POLYGON_REST}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${spec.multiplier}/${spec.timespan}/${fmt(from)}/${fmt(to)}?adjusted=true&sort=desc&limit=50000&apiKey=${API_KEYS.POLYGON}`;

  // Follow the opaque next_url cursor (free tier chunks intraday responses). Each
  // page costs one credit against the 5/min budget; desc-first means we always
  // capture the most recent bars before the budget runs out. 3 pages ≈ 200+ bars.
  for (let page = 0; page < 3; page++) {
    if (!takePolygonCredit()) {
      if (rows.length > 0) break;
      throw new Error("Polygon budget exhausted (minute or daily cap)");
    }
    const data = await fetchJson(url);
    // Note: the free plan flags responses as "DELAYED" — results are still real bars.
    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
      if (rows.length > 0) break;
      throw new Error("No data from Polygon");
    }
    rows.push(...(data.results as PolygonResult[]));
    const nextUrl = typeof data.next_url === "string" ? data.next_url : null;
    if (!nextUrl) break;
    // The cursor URL does not always carry the key — re-append it explicitly.
    url = nextUrl.includes("apiKey") ? nextUrl : `${nextUrl}&apiKey=${API_KEYS.POLYGON}`;
  }
  if (rows.length === 0) throw new Error("No data from Polygon");

  // desc → ascending so charts render oldest→newest.
  rows.sort((a, b) => a.t - b.t);
  return rows.map((r) => ({
    time: Math.floor(r.t / 1000),
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
  }));
}

/** Map app forex pairs to Polygon's C: currency pairs (verified live on the free plan). */
const POLYGON_FOREX: Record<string, string> = {
  "EUR/USD": "C:EURUSD", "GBP/USD": "C:GBPUSD", "USD/JPY": "C:USDJPY",
  "AUD/USD": "C:AUDUSD", "USD/CHF": "C:USDCHF", "USD/CAD": "C:USDCAD",
  "NZD/USD": "C:NZDUSD", "EUR/GBP": "C:EURGBP", "EUR/JPY": "C:EURJPY",
  "GBP/JPY": "C:GBPJPY", "AUD/JPY": "C:AUDJPY", "EUR/CHF": "C:EURCHF",
};

/** Daily aggregates for stocks/indices/futures/forex/crypto. Forex pairs use Polygon's C: tickers. */
export async function fetchCandlesPolygonDaily(symbol: string, market?: MarketType): Promise<OHLCV[]> {
  if (!takePolygonCredit()) throw new Error("Polygon budget exhausted (minute or daily cap)");
  const ticker = market === "forex"
    ? (POLYGON_FOREX[symbol] || `C:${symbol.replace("/", "")}`)
    : symbol;
  const today = new Date();
  const from = new Date(today.getTime() - 90 * 86400_000).toISOString().slice(0, 10);
  const url = `${ENDPOINTS.POLYGON_REST}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${today.toISOString().slice(0, 10)}?adjusted=true&sort=asc&limit=120&apiKey=${API_KEYS.POLYGON}`;

  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.results) || data.results.length === 0) throw new Error("No daily data from Polygon");

  interface PolygonResult { t: number; o: number; h: number; l: number; c: number; v: number }
  return (data.results as PolygonResult[]).map((r) => ({
    time: Math.floor(r.t / 1000),
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
  }));
}

/** Map an app symbol to the Polygon ticker format (crypto → X:BASEQUOTE). */
function toPolygonSymbol(symbol: string, market: MarketType): string {
  if (market === "crypto") {
    const [base, quote] = symbol.split("/");
    return `X:${base}${quote}`;
  }
  return symbol;
}

/* ─── Crypto candles — region-independent venues (free, no key) ──
 * Binance is geo-blocked from several regions (incl. US); these
 * peers keep crypto history live everywhere.                      */

const KRAKEN_NAME_MAP: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };
const KRAKEN_TIMEFRAME: Record<string, string> = {
  "1min": "1", "5min": "5", "15min": "15", "30min": "30",
  "1h": "60", "4h": "240", "1day": "1440",
};

/** Kraken OHLC — free, CORS-enabled, real candle history (newest last). */
export async function fetchCandlesKraken(
  symbol: string,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const [base, quote] = symbol.split("/");
  const pair = `${KRAKEN_NAME_MAP[base] || base}${quote === "USDT" ? "USD" : quote}`;
  const tf = KRAKEN_TIMEFRAME[interval] || "15";
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${tf}`;

  const data = await fetchJson(url);
  if (!data) throw new Error("No data from Kraken");
  if (data.error?.length) throw new Error(`Kraken: ${data.error[0]}`);
  const key = Object.keys(data.result || {})[0];
  const rows: unknown[] = data.result?.[key] || [];
  if (!rows.length) throw new Error("No data from Kraken");

  // rows: [time, open, high, low, close, vwap, volume, count]
  return (rows as number[][])
    .slice(-limit)
    .map(r => ({
      time: r[0],
      open: parseFloat(String(r[1])),
      high: parseFloat(String(r[2])),
      low: parseFloat(String(r[3])),
      close: parseFloat(String(r[4])),
      volume: parseFloat(String(r[6])) || 0,
    }));
}

const OKX_TIMEFRAME: Record<string, string> = {
  "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m",
  "1h": "1H", "4h": "4H", "1day": "1D",
};

/** OKX candles — free, CORS-enabled, real candle history (newest first). */
export async function fetchCandlesOkx(
  symbol: string,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const instId = symbol.replace("/", "-");
  const bar = OKX_TIMEFRAME[interval] || "15m";
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${Math.min(limit, 300)}`;

  const data = await fetchJson(url);
  if (!data || data.code !== "0" || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("No data from OKX");
  }

  // data: [ts(ms), o, h, l, c, vol, volCcy, volCcyQuote, confirm] — newest first
  return (data.data as string[][])
    .slice(0, limit)
    .reverse()
    .map(r => ({
      time: Math.floor(parseFloat(r[0]) / 1000),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]) || 0,
    }));
}

const COINBASE_GRANULARITY: Record<string, number> = {
  "1min": 60, "5min": 300, "15min": 900, "30min": 1800,
  "1h": 3600, "4h": 14400, "1day": 86400,
};

/** Coinbase Exchange candles — free, CORS-enabled, real history (newest first). */
export async function fetchCandlesCoinbase(
  symbol: string,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const [base, quote] = symbol.split("/");
  const product = `${base}-${quote === "USDT" ? "USD" : quote}`;
  const granularity = COINBASE_GRANULARITY[interval] || 900;
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`;

  const data = await fetchJson(url);
  if (!data || !Array.isArray(data) || data.length === 0) throw new Error("No data from Coinbase");

  // rows: [time(s), low, high, open, close, volume] — newest first
  return (data as number[][])
    .slice(0, limit)
    .reverse()
    .map(r => ({
      time: r[0],
      open: parseFloat(String(r[3])),
      high: parseFloat(String(r[2])),
      low: parseFloat(String(r[1])),
      close: parseFloat(String(r[4])),
      volume: parseFloat(String(r[5])) || 0,
    }));
}

const BITSTAMP_TIMEFRAME: Record<string, number> = {
  "1min": 60, "5min": 300, "15min": 900, "30min": 1800,
  "1h": 3600, "4h": 14400, "1day": 86400,
};

/** Bitstamp OHLC — free, no key, CORS-enabled (oldest first). */
export async function fetchCandlesBitstamp(
  symbol: string,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const [base, quote] = symbol.split("/");
  const pair = `${base}${quote === "USDT" ? "USD" : quote}`.toLowerCase();
  const step = BITSTAMP_TIMEFRAME[interval] || 900;
  const data = await fetchJson(`https://www.bitstamp.net/api/v2/ohlc/${pair}/?step=${step}&limit=${Math.min(limit, 1000)}`);
  const ohlc = data?.data?.ohlc;
  if (!Array.isArray(ohlc) || ohlc.length === 0) throw new Error("No data from Bitstamp");

  return (ohlc as { timestamp: string; open: string; high: string; low: string; close: string; volume: string }[])
    .slice(-limit)
    .map(o => ({
      time: parseInt(o.timestamp, 10),
      open: parseFloat(o.open),
      high: parseFloat(o.high),
      low: parseFloat(o.low),
      close: parseFloat(o.close),
      volume: parseFloat(o.volume) || 0,
    }));
}

/* ─── Binance Candles (Crypto) ───────────────────────────────────
 * NOTE: HTX (Huobi) klines are NOT used for history — its /market/history/
 * kline response lags by ~size×interval on this network path (size=300 ends
 * ~3 days ago), which makes it unreliable for charts. HTX stays in the
 * quote mesh (merged ticker is current and CORS-enabled).
 * ──────────────────────────────────────────────────────────────── */

const BITMART_TIMEFRAME: Record<string, number> = {
  "1min": 1, "5min": 5, "15min": 15, "30min": 30,
  "1h": 60, "4h": 240, "1day": 1440,
};

/** BitMart v3 klines — free, CORS-enabled (ACAO echoes origin), no key.
 * Verified live: rows are [ts(s), open, high, low, close, baseVol, quoteVol],
 * oldest first, current to the minute. */
export async function fetchCandlesBitMart(
  symbol: string,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const inst = symbol.replace("/", "_");
  const step = BITMART_TIMEFRAME[interval] || 15;
  const url = `https://api-cloud.bitmart.com/spot/quotation/v3/klines?symbol=${inst}&step=${step}&limit=${Math.min(limit, 300)}`;

  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("No data from BitMart");
  }

  return (data.data as string[][])
    .slice(-limit)
    .map(r => ({
      time: parseInt(r[0], 10),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]) || 0,
    }));
}

export async function fetchCandlesBinance(
  symbol: string,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const binanceInterval = BINANCE_INTERVAL[interval] || "15m";
  const binanceSymbol = symbol.replace("/", "").toUpperCase();
  const url = `${ENDPOINTS.BINANCE_REST}/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${limit}`;

  const data = (await fetchJson(url)) as [number, string, string, string, string, string][] | null;
  if (!data) throw new Error("No data from Binance");

  return data.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function fetchPriceBinance(symbol: string): Promise<{
  price: number; volume: number; change: number; changePct: number;
} | null> {
  try {
    const binanceSymbol = symbol.replace("/", "").toUpperCase();
    const [ticker, stats] = await Promise.all([
      fetchJson(`${ENDPOINTS.BINANCE_REST}/ticker/price?symbol=${binanceSymbol}`),
      fetchJson(`${ENDPOINTS.BINANCE_REST}/ticker/24hr?symbol=${binanceSymbol}`),
    ]);

    if (!ticker?.price) return null;

    return {
      price: parseFloat(ticker.price),
      volume: stats ? parseFloat(stats.volume) : 0,
      change: stats ? parseFloat(stats.priceChange || "0") : 0,
      changePct: stats ? parseFloat(stats.priceChangePercent || "0") : 0,
    };
  } catch {
    return null;
  }
}

/* ─── Yahoo Finance chart API (free, no key, CORS-enabled) ──────
 * Intraday + daily OHLC for stocks, indices, futures and forex.
 * Rate-limits aggressively per IP; when it responds it is real
 * market data. Used as a no-key fallback AFTER the keyed/budgeted
 * providers so it never eats a limited credit unnecessarily.       */

/* ─── Yahoo fast-fail cache ─────────────────────────────────────
 * Yahoo's chart API sends NO CORS headers, so browsers reach it
 * only through a relay. Verified working relays (Aug 2026):
 *   allorigins (flaky — Yahoo 429s its shared IPs intermittently)
 *   Jina reader r.jina.ai (reliable, CORS-echoes, JSON-wrapped in
 *     markdown — parsed in net.ts). fetchJson proxy:"yahoo" tries
 *     direct → allorigins → jina, and only if ALL three fail do we
 *     remember the block for 10 minutes (avoids freezing charts). */
let yahooBlockedUntil = 0;
let yahooFails = 0;

/* Only remember the block after TWO consecutive failures (a single flaky
 * relay response must not freeze charts for minutes), and for 5 minutes. */
function blockYahoo() {
  yahooBlockedUntil = Date.now() + 5 * 60_000;
}

function noteYahooFailure() {
  yahooFails++;
  if (yahooFails >= 2) blockYahoo();
}

function noteYahooSuccess() {
  yahooFails = 0;
}

export function isYahooBlocked(): boolean {
  return Date.now() < yahooBlockedUntil;
}

const YAHOO_SPEC: Record<string, { interval: string; range: string }> = {
  "1min": { interval: "1m", range: "5d" },
  "5min": { interval: "5m", range: "1mo" },
  "15min": { interval: "15m", range: "1mo" },
  "30min": { interval: "30m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
  "4h": { interval: "60m", range: "6mo" },
  "1day": { interval: "1d", range: "1y" },
};

const YAHOO_FUTURES: Record<string, string> = {
  ES: "ES=F", CL: "CL=F", NG: "NG=F", SI: "SI=F", HG: "HG=F", ZS: "ZS=F",
  RB: "RB=F", BZ: "BZ=F", KC: "KC=F", SB: "SB=F", ZM: "ZM=F", GF: "GF=F", MGC: "MGC=F",
};

function toYahooChartSymbol(symbol: string, market: MarketType): string {
  // Explicit per-symbol Yahoo ticker (real index levels: ^GSPC, ^IXIC, ^VIX …)
  const meta = getSymbolMeta(symbol);
  if (meta?.yahooTicker) return meta.yahooTicker;
  if (market === "forex") {
    const [b, q] = symbol.split("/");
    return `${b}${q}=X`;
  }
  if (market === "crypto") {
    const [b, q] = symbol.split("/");
    return `${b}-${q === "USDT" ? "USD" : q}`;
  }
  if (market === "futures") return YAHOO_FUTURES[symbol] || `${symbol}=F`;
  return symbol;
}

/** Real OHLC from Yahoo's chart API (newest last, oldest first after dedupe). */
export async function fetchCandlesYahoo(
  symbol: string,
  market: MarketType,
  interval: string,
  limit = 300
): Promise<OHLCV[]> {
  const spec = YAHOO_SPEC[interval] || YAHOO_SPEC["15min"];
  const y = toYahooChartSymbol(symbol, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=${spec.interval}&range=${spec.range}`;

  const data = await fetchJson(url, { timeoutMs: 4000, proxy: "yahoo" });
  if (data === null) {
    // Browser CORS-blocked (no ACAO header) or endpoint unreachable.
    noteYahooFailure();
    throw new Error("Yahoo unreachable from this origin");
  }
  if (!data) {
    noteYahooFailure();
    throw new Error("No data from Yahoo");
  }
  const r = data?.chart?.result?.[0];
  if (!r?.timestamp || !r?.indicators?.quote?.[0]) {
    // 429 rate-limit and other errors — only fatal after consecutive failures.
    noteYahooFailure();
    throw new Error("No data from Yahoo");
  }
  noteYahooSuccess();

  const ts = r.timestamp as number[];
  const q = r.indicators.quote[0] as {
    open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[];
    close?: (number | null)[]; volume?: (number | null)[];
  };

  const out: OHLCV[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null || !(c > 0)) continue;
    out.push({
      time: ts[i],
      open: o, high: h, low: l, close: c,
      volume: q.volume?.[i] || 0,
    });
  }
  if (out.length === 0) throw new Error("No data from Yahoo");
  // Timestamps are ascending (oldest first) — take the LAST `limit` bars so the
  // chart always ends at the most recent market close, never a month ago.
  return out.slice(-limit);
}

/* ─── Smart candle fetcher with fallbacks + provenance ─────────── */

export interface CandleResult {
  candles: OHLCV[];
  source: DataSource;
  streaming: boolean;
  note?: string;
}

export async function fetchCandles(
  symbol: string,
  market: MarketType,
  interval: string
): Promise<CandleResult> {
  // Cache hit (no credit cost)
  const cached = getCached(symbol, interval);
  if (cached && cached.length > 0) {
    return { candles: cached, source: "live-aggregate" as DataSource, streaming: false, note: "cached" };
  }

  const errors: string[] = [];

  // Crypto → region-independent venues (Kraken → OKX → Coinbase → Bitstamp
  // → HTX → Binance data-api.vision). Binance REST is geo-blocked from several
  // regions (incl. US) — the peers keep it live everywhere.
  if (market === "crypto") {
    const cryptoAttempts: [DataSource, () => Promise<OHLCV[]>][] = [
      ["kraken", () => fetchCandlesKraken(symbol, interval)],
      ["okx", () => fetchCandlesOkx(symbol, interval)],
      ["coinbase", () => fetchCandlesCoinbase(symbol, interval)],
      ["bitstamp", () => fetchCandlesBitstamp(symbol, interval)],
      ["bitmart", () => fetchCandlesBitMart(symbol, interval)],
      ["binance-rest", () => fetchCandlesBinance(symbol, interval)],
    ];
    for (const [source, fn] of cryptoAttempts) {
      try {
        const data = await fn();
        if (data.length > 0) {
          setCache(symbol, interval, data);
          return { candles: data, source, streaming: false };
        }
      } catch (e) { errors.push(`${source}: ${e}`); }
    }
    // Every venue failed — build candles from the live tick stream (Binance /
    // Coinbase / Kraken WS + the REST mesh). Never falls through to providers
    // that do not carry these pairs (TwelveData/Finnhub USDT symbols, Polygon
    // daily roots — Polygon's free plan is daily-only for non-crypto anyway).
    return {
      candles: [],
      source: "live-aggregate",
      streaming: true,
      note: `Crypto history unavailable (${errors[0]?.split(":")[0] || "all venues"}) — building from live stream`,
    };
  }

  // Stocks / forex / futures / indices → Twelve Data (budget-aware, cached)
  try {
    const data = await fetchCandlesTwelveData(symbol, interval);
    if (data.length > 0) {
      setCache(symbol, interval, data);
      return { candles: data, source: "twelvedata-rest", streaming: false };
    }
  } catch (e) { errors.push(`TwelveData: ${e}`); }

  // Intraday for non-crypto: TwelveData (personal key) → Yahoo (full current
  // history in one call via the relay chain — stocks, index ETFs, forex =X and
  // REAL futures contracts =F) → Polygon intraday (fallback; its free tier
  // paginates in small chunks so it is only used when Yahoo is unreachable)
  // → the live tick/quote stream. The aggregator tops up from the live stream
  // on top of whichever history lands.
  if (interval !== "1day") {
    if (!isYahooBlocked()) {
      try {
        const data = await fetchCandlesYahoo(symbol, market, interval);
        if (data.length > 0) {
          setCache(symbol, interval, data);
          return { candles: data, source: "yahoo", streaming: false };
        }
      } catch (e) { errors.push(`Yahoo: ${e}`); }
    } else {
      errors.push("Yahoo: skipped (blocked this session)");
    }

    // Polygon intraday: stocks, index ETFs and forex C: pairs only. FUTURES ARE
    // EXCLUDED — bare roots (ES, CL, NG…) resolve to unrelated STOCKS on Polygon
    // (ES=Eversource, CL=Colgate), so a futures chart must never come from here.
    if (market === "stocks" || market === "indices" || market === "forex") {
      try {
        const data = await fetchCandlesPolygon(symbol, interval, market);
        if (data.length > 0) {
          setCache(symbol, interval, data);
          return { candles: data, source: "polygon", streaming: false, note: "delayed intraday" };
        }
      } catch (e) { errors.push(`Polygon: ${e}`); }
    }

    const note = market === "futures"
      ? "Futures intraday history unavailable right now (Yahoo relay unreachable and the free TwelveData key is out of credits) — building candles from live quotes"
      : "Intraday history unavailable on free tier — building candles from the live stream";
    return { candles: [], source: "live-aggregate", streaming: true, note };
  }

  // Daily: TwelveData (budget) → Polygon (free tier, CORS, delayed daily bars —
  // verified live for stocks, index ETFs and forex C: pairs) → AlphaVantage
  // (25/day) → Yahoo (ES=F/CL=F … for REAL futures contracts, which no other
  // free provider carries without mapping bare roots to unrelated stocks).
  if (interval === "1day") {
    // Polygon/AlphaVantage NEVER for futures: bare roots (ES, CL, NG…) resolve
    // to unrelated STOCKS there (ES=Eversource, CL=Colgate, NG=NovaGold, HG=Hamilton,
    // ZS=Zscaler) — a futures chart must never show those. Yahoo maps the roots
    // to real contracts (ES=F …), so it is the futures daily path.
    if (market !== "futures") {
      try {
        const data = await fetchCandlesPolygonDaily(symbol, market);
        if (data.length > 0) {
          setCache(symbol, interval, data);
          return { candles: data, source: "polygon", streaming: false, note: "delayed daily" };
        }
      } catch (e) { errors.push(`Polygon: ${e}`); }

      try {
        const data = market === "forex"
          ? await fetchCandlesAlphaVantageFxDaily(symbol)
          : await fetchCandlesAlphaVantageDaily(symbol);
        if (data.length > 0) {
          setCache(symbol, interval, data);
          return { candles: data, source: "alpha-vantage", streaming: false };
        }
      } catch (e) { errors.push(`AlphaVantage: ${e}`); }
    }

    if (!isYahooBlocked()) {
      try {
        const data = await fetchCandlesYahoo(symbol, market, interval);
        if (data.length > 0) {
          setCache(symbol, interval, data);
          return { candles: data, source: "yahoo", streaming: false };
        }
      } catch (e) { errors.push(`Yahoo: ${e}`); }
    } else {
      errors.push("Yahoo: skipped (blocked this session)");
    }
  }

  // Nothing available → the live aggregator will build history from real ticks.
  // Return empty so the UI switches to "streaming history" mode honestly.
  return {
    candles: [],
    source: "live-aggregate",
    streaming: true,
    note: errors.length > 0 ? `Provider history unavailable (${errors[0].split(":")[0]}) — building from live stream` : "Building history from live stream",
  };
}

/** Best-effort real daily history (used to seed charts/backtests when intraday is unavailable). */
export async function fetchDailySeed(symbol: string, market: MarketType): Promise<OHLCV[]> {
  if (market === "crypto") return [];
  // NEVER seed futures from Polygon/AlphaVantage: bare roots (ES/CL/NG) resolve
  // to unrelated STOCKS there — training on Eversource/Colgate bars would
  // silently teach the model the wrong instrument. Yahoo maps roots to real
  // contracts (ES=F …), so it is the ONLY daily path for futures.
  if (market === "futures") {
    if (isYahooBlocked()) return [];
    try {
      const d = await fetchCandlesYahoo(symbol, "futures", "1day");
      if (d.length > 0) return d;
    } catch { /* next */ }
    return [];
  }
  // Polygon daily is the reliable backbone (stocks, index ETFs, forex C: pairs)
  try {
    const d = await fetchCandlesPolygonDaily(symbol, market);
    if (d.length > 0) return d;
  } catch { /* next */ }
  try {
    if (market === "forex") return await fetchCandlesAlphaVantageFxDaily(symbol);
  } catch { /* next */ }
  try {
    const d = await fetchCandlesAlphaVantageDaily(symbol);
    if (d.length > 0) return d;
  } catch { /* next */ }
  if (!isYahooBlocked()) {
    try {
      const d = await fetchCandlesYahoo(symbol, market, "1day");
      if (d.length > 0) return d;
    } catch { /* next */ }
  }
  return [];
}

/* ─── News (Finnhub, free tier) ────────────────────────────────── */

/** Small market lexicon used to tag real headlines with a sentiment score. */
const SENTIMENT_LEXICON: [string, number][] = [
  ["beat", 0.8], ["beats", 0.8], ["surge", 0.8], ["surges", 0.8], ["soar", 0.7], ["soars", 0.7],
  ["rally", 0.7], ["rallies", 0.7], ["record", 0.6], ["all-time high", 0.8], ["ath", 0.6],
  ["upgrade", 0.6], ["upgraded", 0.6], ["buy", 0.5], ["bullish", 0.7], ["bull", 0.5],
  ["growth", 0.5], ["grows", 0.5], ["gain", 0.5], ["gains", 0.5], ["profit", 0.5],
  ["profitable", 0.6], ["strong", 0.5], ["strength", 0.5], ["jump", 0.6], ["jumps", 0.6],
  ["climb", 0.5], ["climbs", 0.5], ["rise", 0.5], ["rises", 0.5], ["outperform", 0.6],
  ["positive", 0.4], ["optimism", 0.5], ["opportunity", 0.4], ["momentum", 0.4],
  ["breakout", 0.6], ["bounce", 0.4], ["rebound", 0.5], ["recovery", 0.4],

  ["drop", -0.7], ["drops", -0.7], ["plunge", -0.8], ["plunges", -0.8], ["crash", -0.9],
  ["crumbles", -0.8], ["slump", -0.7], ["slumps", -0.7], ["fall", -0.6], ["falls", -0.6],
  ["tumble", -0.7], ["tumbles", -0.7], ["selloff", -0.7], ["sell-off", -0.7], ["slide", -0.5],
  ["slides", -0.5], ["downgrade", -0.6], ["downgraded", -0.6], ["bearish", -0.7], ["bear", -0.5],
  ["weak", -0.5], ["weakness", -0.5], ["loss", -0.5], ["losses", -0.5], ["miss", -0.6],
  ["misses", -0.6], ["below expectations", -0.7], ["warning", -0.6], ["warns", -0.6],
  ["lawsuit", -0.6], ["probe", -0.5], ["investigation", -0.5], ["fraud", -0.9], ["scandal", -0.8],
  ["layoff", -0.5], ["layoffs", -0.5], ["cut", -0.4], ["cuts", -0.4], ["recall", -0.5],
  ["fear", -0.5], ["worries", -0.5], ["risk", -0.4], ["volatility", -0.3], ["turmoil", -0.6],
  ["resign", -0.5], ["resigns", -0.5], ["bankruptcy", -0.9], ["default", -0.7], ["recession", -0.7],
];

/** Score a headline/summary with the lexicon → -1..1. */
export function scoreSentiment(text: string): { sentiment: NewsItem["sentiment"]; score: number } {
  const lower = ` ${text.toLowerCase()} `;
  let score = 0;
  let hits = 0;
  for (const [word, w] of SENTIMENT_LEXICON) {
    if (lower.includes(` ${word} `) || lower.includes(word + ",") || lower.includes(word + ".") || lower.includes(word + "'")) {
      score += w;
      hits++;
    }
  }
  if (hits === 0) return { sentiment: "neutral", score: 0 };
  score /= Math.max(1, Math.sqrt(hits));
  const clamped = Math.max(-1, Math.min(1, score));
  const sentiment: NewsItem["sentiment"] = clamped > 0.15 ? "bullish" : clamped < -0.15 ? "bearish" : "neutral";
  return { sentiment, score: clamped };
}

interface FinnhubNewsRaw {
  id: number;
  headline: string;
  source: string;
  datetime: number;
  url: string;
  image?: string;
  summary?: string;
  related?: string;
}

function mapNews(raw: FinnhubNewsRaw[]): NewsItem[] {
  return raw.slice(0, 14).map(r => {
    const text = `${r.headline} ${r.summary || ""}`;
    const { sentiment, score } = scoreSentiment(text);
    return {
      id: String(r.id),
      headline: r.headline,
      source: r.source,
      datetime: r.datetime * 1000,
      url: r.url,
      image: r.image,
      summary: r.summary,
      related: r.related,
      sentiment,
      score,
    };
  });
}

/** General market news (Finnhub free tier, real headlines). */
export async function fetchNewsGeneral(): Promise<NewsItem[]> {
  try {
    const url = `${ENDPOINTS.FINNHUB_REST}/news?category=general&token=${API_KEYS.FINNHUB}`;
    const data = (await fetchJson(url)) as FinnhubNewsRaw[] | null;
    return mapNews(Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

/** Company news for a symbol (Finnhub free tier). */
export async function fetchNewsCompany(symbol: string): Promise<NewsItem[]> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${ENDPOINTS.FINNHUB_REST}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${API_KEYS.FINNHUB}`;
    const data = (await fetchJson(url)) as FinnhubNewsRaw[] | null;
    return mapNews(Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

/** Hacker News top stories — free, no key, CORS-enabled. A keyless fallback
 * for the news feed when Finnhub news is unavailable or quota'd out. */
export async function fetchNewsHackerNews(): Promise<NewsItem[]> {
  try {
    const top = await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json", { timeoutMs: 6000 });
    if (!Array.isArray(top)) return [];
    const ids = (top as number[]).slice(0, 18);
    const items = await Promise.all(
      ids.map(id => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeoutMs: 5000 }))
    );
    const out: NewsItem[] = [];
    for (const it of items) {
      if (!it || typeof it.title !== "string" || !it.title) continue;
      const text = `${it.title} ${typeof it.text === "string" ? it.text : ""}`;
      const { sentiment, score } = scoreSentiment(text);
      out.push({
        id: `hn-${it.id}`,
        headline: it.title,
        source: "Hacker News",
        datetime: (it.time || 0) * 1000,
        url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
        summary: (typeof it.text === "string" ? it.text : "").slice(0, 160),
        sentiment,
        score,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/* ─── Smart live price fetcher with fallbacks + provenance ─────── */

export async function fetchLivePrice(
  symbol: string,
  market: MarketType
): Promise<{ price: number; change: number; changePct: number; volume: number; source: string } | null> {
  if (market === "crypto") {
    const data = await fetchPriceBinance(symbol);
    if (data) return { ...data, source: "Binance" };
  }

  if (market === "futures" || market === "stocks" || market === "indices") {
    const data = await fetchQuoteFinnhub(symbol);
    if (data) return { price: data.price, change: data.change, changePct: data.changePct, volume: data.volume, source: "Finnhub" };
    // Finnhub does not carry real index LEVELS (^GSPC…) — Yahoo does (inline
    // fetch keeps dataProviders → providers acyclic).
    if (!isYahooBlocked()) {
      try {
        const y = toYahooChartSymbol(symbol, market);
        const yd = await fetchJson(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=1d`,
          { timeoutMs: 4000, proxy: "yahoo" }
        );
        const meta = yd?.chart?.result?.[0]?.meta;
        const price = parseFloat(meta?.regularMarketPrice);
        if (price > 0) {
          const prev = parseFloat(meta?.chartPreviousClose) || parseFloat(meta?.previousClose) || price;
          noteYahooSuccess();
          return {
            price,
            change: prev > 0 ? price - prev : 0,
            changePct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
            volume: parseFloat(meta?.regularMarketVolume) || 0,
            source: "Yahoo",
          };
        }
        noteYahooFailure();
      } catch { noteYahooFailure(); }
    }
  }

  if (market === "forex") {
    // TwelveData free key is often exhausted (shared key, 800/day) — fall through
    // to keyless live sources so the price never goes blank.
    const data = await fetchQuoteTwelveData(symbol);
    if (data) return { price: data.price, change: data.change, changePct: data.changePct, volume: data.volume, source: "TwelveData" };

    const [from, to] = symbol.split("/");
    if (from && to) {
      try {
        const er = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, { timeoutMs: 3000 });
        const p = parseFloat(er?.rates?.[to]);
        if (p > 0) return { price: p, change: 0, changePct: 0, volume: 0, source: "exchangerate" };
      } catch { /* next */ }
      try {
        const fr = await fetchQuoteFrankfurter(symbol);
        if (fr) return { price: fr.price, change: 0, changePct: 0, volume: 0, source: "ecb" };
      } catch { /* next */ }
      const av = await fetchQuoteAlphaVantageFx(symbol);
      if (av) return { price: av.price, change: 0, changePct: 0, volume: 0, source: "alpha-vantage" };
    }
  }

  return null;
}

/* ─── Finnhub candle fetch (locked on this key — kept for future keys) ── */

export async function fetchCandlesFinnhub(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<OHLCV[]> {
  const resMap: Record<string, string> = FINNHUB_RESOLUTION;
  const r = resMap[resolution] || "D";
  const url = `${ENDPOINTS.FINNHUB_REST}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${r}&from=${from}&to=${to}&token=${API_KEYS.FINNHUB}`;
  const data = await fetchJson(url);
  if (!data || data.s !== "ok" || !data.t) throw new Error("No candle data from Finnhub");

  const t = data.t as number[];
  const o = data.o as number[];
  const h = data.h as number[];
  const l = data.l as number[];
  const c = data.c as number[];
  const v = data.v as number[];
  return t.map((_, i) => ({
    time: t[i],
    open: o[i],
    high: h[i],
    low: l[i],
    close: data.c[i],
    volume: data.v[i],
  }));
}

/** Live candlestick update pushed by Binance kline stream */
export function binanceKlineToOHLCV(k: { t: number; o: string; h: string; l: string; c: string; v: string }): OHLCV {
  return {
    time: Math.floor(k.t / 1000),
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
  };
}
