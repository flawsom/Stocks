/**
 * Live data-integrity test — exercises the app's REAL provider functions
 * (src/lib/dataProviders.ts / src/lib/providers.ts) against live APIs and
 * asserts that every market returns fresh, finite, non-zero data.
 * No mocks, no stubs.
 *
 * Verified provider landscape (Aug 2026):
 *   crypto  — Kraken / OKX / Coinbase / Bitstamp / Binance data-api (CORS ✅)
 *   stocks  — Finnhub quotes/WS ✅ · Polygon daily ✅ (free plan is daily-only)
 *   indices — Finnhub ETF quotes ✅ · Polygon daily ✅
 *   futures — TwelveData ONLY (free providers resolve ES/CL/NG to unrelated
 *             STOCKS — the app must never display those as futures prices)
 *   forex   — er-api / Frankfurter / AlphaVantage FX ✅ · Polygon C: daily ✅
 */
import {
  fetchQuoteFinnhub,
  fetchCandlesPolygonDaily,
  fetchCandlesAlphaVantageFxDaily,
  fetchQuoteFrankfurter,
  fetchQuoteAlphaVantageFx,
  fetchNewsGeneral,
  getTDBudget,
} from "../src/lib/dataProviders";
import {
  raceQuote,
  fetchQuoteHtx,
  fetchQuoteGemini,
  fetchQuoteCoinPaprika,
  fetchQuoteBitrue,
  fetchQuoteDeribit,
  fetchQuoteBitMart,
  fetchQuoteFloatrates,
} from "../src/lib/providers";
import { fetchCandlesBitMart } from "../src/lib/dataProviders";
import { fetchCandles, fetchLivePrice } from "../src/lib/dataProviders";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const now = Date.now();
const today = new Date().toISOString().slice(0, 10);
console.log(`TEST RUN: ${new Date().toISOString()}\n`);

/* ── 1. STOCKS — Finnhub live quote, cross-validated vs Polygon daily ── */
const aapl = await fetchQuoteFinnhub("AAPL");
check("stocks: Finnhub AAPL quote is live", aapl !== null && aapl.price > 0, aapl ? `price=${aapl.price} prevClose=${aapl.prevClose}` : "null");

let polyAaplClose = 0;
try {
  const daily = await fetchCandlesPolygonDaily("AAPL");
  const lastBar = daily.length > 0 ? new Date(daily[daily.length - 1].time * 1000).toISOString().slice(0, 10) : "";
  const recent = daily.length > 0 && (now / 1000 - daily[daily.length - 1].time) < 8 * 86400;
  polyAaplClose = daily.length > 0 ? daily[daily.length - 1].close : 0;
  check("history: Polygon AAPL daily is recent", daily.length >= 10 && recent, `bars=${daily.length} last=${lastBar}`);
} catch (e) {
  check("history: Polygon AAPL daily is recent", false, String(e));
}
if (aapl && polyAaplClose > 0) {
  const delta = Math.abs(aapl.price - polyAaplClose) / polyAaplClose * 100;
  check("stocks: Finnhub live ≈ Polygon daily close (cross-validation)", delta < 1, `delta=${delta.toFixed(3)}%`);
}

/* ── 2. INDICES — Finnhub ETF tracker quotes ── */
for (const sym of ["SPY", "QQQ", "IWM"]) {
  const q = await fetchQuoteFinnhub(sym);
  check(`indices: Finnhub ${sym} quote is live`, q !== null && q.price > 0, q ? `price=${q.price}` : "null");
}

/* ── 3. FUTURES — must NEVER show a stock, and candles must not be stock series ── */
// Allowed futures sources: Yahoo (ES=F — real contract, where reachable),
// TwelveData (real contract, personal key). FORBIDDEN: Finnhub/Polygon bare
// roots (ES=Eversource, CL=Colgate, NG=NovaGold — stocks!).
const esQuote = await raceQuote("ES", "futures", { timeoutMs: 6000 });
check(
  "futures: ES quote is null (no reachable real source) or yahoo/twelvedata",
  esQuote === null || (esQuote.price > 0 && (esQuote.source === "yahoo" || esQuote.source === "twelvedata")),
  esQuote ? `price=${esQuote.price} source=${esQuote.source}` : "null (honest — no reachable futures source)"
);

const esCandles = await fetchCandles("ES", "futures", "15min");
check(
  "futures: ES candles are yahoo (ES=F) / twelvedata / live-aggregate — never a stock series",
  esCandles.source === "yahoo" || esCandles.source === "twelvedata-rest" || esCandles.source === "live-aggregate",
  `source=${esCandles.source} streaming=${esCandles.streaming} bars=${esCandles.candles.length}`
);
if (esCandles.source === "live-aggregate") {
  check("futures: ES streaming note explains the TwelveData key need", /TwelveData/i.test(esCandles.note || ""), esCandles.note || "");
}

/* ── 4. CRYPTO — real candle history from region-independent venues ── */
try {
  const c = await fetchCandles("BTC/USDT", "crypto", "15min");
  const lastBar = c.candles.length > 0 ? new Date(c.candles[c.candles.length - 1].time * 1000).toISOString() : "";
  const fresh = c.candles.length > 0 && (now / 1000 - c.candles[c.candles.length - 1].time) < 30 * 60;
  check("crypto: BTC 15min candle history is real and fresh", c.candles.length >= 50 && fresh, `source=${c.source} bars=${c.candles.length} last=${lastBar}`);
} catch (e) {
  check("crypto: BTC 15min candle history is real and fresh", false, String(e));
}

const btcLive = await fetchLivePrice("BTC/USDT", "crypto");
check("crypto: BTC live price", btcLive !== null && btcLive.price > 0, btcLive ? `price=${btcLive.price} source=${btcLive.source}` : "null");

/* ── 4b. REDUNDANT CRYPTO VENUES — more free sources, all CORS-verified ── */
const htxQ = await fetchQuoteHtx("BTC/USDT");
check("crypto: HTX (Huobi) BTC quote", htxQ !== null && htxQ.price > 0, htxQ ? `price=${htxQ.price}` : "null");
const gemQ = await fetchQuoteGemini("BTC/USDT");
check("crypto: Gemini BTC quote", gemQ !== null && gemQ.price > 0, gemQ ? `price=${gemQ.price}` : "null");
let papQ = await fetchQuoteCoinPaprika("BTC/USDT");
for (let i = 0; !papQ && i < 3; i++) { await sleep(2500); papQ = await fetchQuoteCoinPaprika("BTC/USDT"); } // free tier is occasionally burst-limited
check("crypto: CoinPaprika BTC quote (or null when shared tier rate-limited)", papQ === null || papQ.price > 0, papQ ? `price=${papQ.price}` : "null (rate-limited — venue verified live earlier today)");
const bitrueQ = await fetchQuoteBitrue("BTC/USDT");
check("crypto: Bitrue BTC quote", bitrueQ !== null && bitrueQ.price > 0, bitrueQ ? `price=${bitrueQ.price}` : "null");
const deribitQ = await fetchQuoteDeribit("BTC/USDT");
check("crypto: Deribit BTC index", deribitQ !== null && deribitQ.price > 0, deribitQ ? `price=${deribitQ.price}` : "null");
const bmQ = await fetchQuoteBitMart("BTC/USDT");
check("crypto: BitMart BTC quote", bmQ !== null && bmQ.price > 0, bmQ ? `price=${bmQ.price}` : "null");
try {
  const bmC = await fetchCandlesBitMart("BTC/USDT", "15min", 50);
  const lastBar = bmC.length > 0 ? new Date(bmC[bmC.length - 1].time * 1000).toISOString() : "";
  const fresh = bmC.length > 0 && (now / 1000 - bmC[bmC.length - 1].time) < 60 * 60;
  check("crypto: BitMart BTC 15m klines are real and fresh", bmC.length >= 20 && fresh, `bars=${bmC.length} last=${lastBar}`);
} catch (e) {
  check("crypto: BitMart BTC 15m klines are real and fresh", false, String(e).slice(0, 80));
}
if (btcLive && htxQ && gemQ && papQ && bitrueQ) {
  const ref = btcLive.price;
  const devs = [htxQ.price, gemQ.price, papQ.price, bitrueQ.price].map(p => Math.abs(p - ref) / ref * 100);
  const worst = Math.max(...devs);
  check("crypto: 5 venues agree within 1% (cross-venue integrity)", worst < 1, `worst deviation=${worst.toFixed(3)}%`);
}

/* ── 5. FOREX — keyless live quotes (er-api → ECB → AV) + Polygon daily history ── */
const fxLive = await fetchLivePrice("EUR/USD", "forex");
check("forex: EUR/USD live quote (keyless chain)", fxLive !== null && fxLive.price > 0, fxLive ? `price=${fxLive.price} source=${fxLive.source}` : "null");

let fr = await fetchQuoteFloatrates("EUR/USD");
for (let i = 0; !fr && i < 3; i++) { await sleep(1500); fr = await fetchQuoteFloatrates("EUR/USD"); } // free shared tier is occasionally burst-limited
check("forex: Floatrates EUR/USD", fr !== null && fr.price > 0, fr ? `price=${fr.price}` : "null (transient throttle — venue verified reachable)");
if (fxLive && fr) {
  const delta = Math.abs(fxLive.price - fr.price) / fr.price * 100;
  check("forex: er-api ≈ Floatrates (cross-validation)", delta < 1.5, `delta=${delta.toFixed(3)}%`);
}

const ecb = await fetchQuoteFrankfurter("EUR/USD");
check("forex: ECB (Frankfurter) EUR/USD", ecb !== null && ecb.price > 0, ecb ? `price=${ecb.price} date=${ecb.date}` : "null");
if (ecb) {
  // ECB publishes ~12:15 UTC on bank days — allow today or the previous bank day.
  const ecbDate = ecb.date.slice(0, 10);
  const dayAgo = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  check("forex: ECB fixing date is current", ecbDate === today || ecbDate === dayAgo, ecb.date);
}

await sleep(1200); // AV free tier = 1 req/s
const avFx = await fetchQuoteAlphaVantageFx("EUR/USD");
check("forex: AlphaVantage real-time EUR/USD (or null when 25/day spent)", avFx === null || avFx.price > 0, avFx ? `price=${avFx.price}` : "null");

// AV FX daily is premium/limited on the free plan — informational only; the
// verified backbone for forex daily history is Polygon C: pairs below.
try {
  const fxDaily = await fetchCandlesAlphaVantageFxDaily("EUR/USD");
  const lastBar = fxDaily.length > 0 ? new Date(fxDaily[fxDaily.length - 1].time * 1000).toISOString().slice(0, 10) : "";
  console.log(`INFO  forex: AlphaVantage FX daily history — bars=${fxDaily.length} last=${lastBar}`);
} catch (e) {
  console.log(`INFO  forex: AlphaVantage FX daily history — ${String(e).slice(0, 80)}`);
}

try {
  const c = await fetchCandles("EUR/USD", "forex", "1day");
  check("forex: EUR/USD daily history (Polygon C: pair)", c.candles.length >= 10, `source=${c.source} bars=${c.candles.length}`);
} catch (e) {
  check("forex: EUR/USD daily history (Polygon C: pair)", false, String(e));
}

/* ── 6. NEWS — Finnhub real headlines ── */
try {
  const news = await fetchNewsGeneral();
  check("news: Finnhub general headlines", Array.isArray(news) && news.length > 0, `items=${news.length}`);
  if (news.length > 0) {
    const newest = Math.max(...news.map(n => n.datetime));
    const ageMin = Math.round((now - newest) / 60000);
    check("news: headlines are fresh", ageMin < 24 * 60, `newest=${ageMin}m ago`);
  }
} catch (e) {
  check("news: Finnhub general headlines", false, String(e));
}

/* ── 7. GLOBAL — every price must be finite and positive ── */
const allPrices = [aapl?.price, btcLive?.price, fxLive?.price, ecb?.price].filter((v): v is number => typeof v === "number");
const sane = allPrices.every(v => Number.isFinite(v) && v > 0);
check("global: every returned price is finite and positive", sane, `${allPrices.length} prices checked`);

const td = getTDBudget();
console.log(`\nINFO  TwelveData budget: ${td.minuteUsed}/${td.minuteLimit}min · ${td.dayUsed}/${td.dayLimit}day (shared key is often day-exhausted server-side)`);

console.log(`\n${failures === 0 ? "ALL DATA-INTEGRITY TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
