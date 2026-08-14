// Deep probe: every crypto quote provider + Finnhub candles + TD behavior.
import {
  fetchQuoteCoinGecko, fetchQuoteCoinbase, fetchQuoteKraken, fetchQuoteBybit,
  fetchQuoteOkx, fetchQuoteBitstamp, fetchQuoteBitget, fetchQuoteHtx,
  fetchQuoteGemini, fetchQuoteCoinPaprika, fetchQuoteBitrue, fetchQuoteDeribit,
  fetchQuoteBitMart, fetchQuoteKuCoin, fetchQuoteMexc, fetchQuoteGateio,
  fetchQuotePoloniex,
} from "../src/lib/providers.ts";
import { fetchCandlesFinnhub, fetchCandlesTwelveData, fetchCandlesYahoo } from "../src/lib/dataProviders.ts";

const t0 = Date.now();
const log = (label, v) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}: ${v}`);

const providers = [
  ["coingecko", () => fetchQuoteCoinGecko("BTC/USDT")],
  ["coinbase", () => fetchQuoteCoinbase("BTC/USDT")],
  ["kraken", () => fetchQuoteKraken("BTC/USDT")],
  ["bybit", () => fetchQuoteBybit("BTC/USDT")],
  ["okx", () => fetchQuoteOkx("BTC/USDT")],
  ["bitstamp", () => fetchQuoteBitstamp("BTC/USDT")],
  ["bitget", () => fetchQuoteBitget("BTC/USDT")],
  ["htx", () => fetchQuoteHtx("BTC/USDT")],
  ["gemini", () => fetchQuoteGemini("BTC/USDT")],
  ["coinpaprika", () => fetchQuoteCoinPaprika("BTC/USDT")],
  ["bitrue", () => fetchQuoteBitrue("BTC/USDT")],
  ["deribit", () => fetchQuoteDeribit("BTC/USDT")],
  ["bitmart", () => fetchQuoteBitMart("BTC/USDT")],
  ["kucoin", () => fetchQuoteKuCoin("BTC/USDT")],
  ["mexc", () => fetchQuoteMexc("BTC/USDT")],
  ["gateio", () => fetchQuoteGateio("BTC/USDT")],
  ["poloniex", () => fetchQuotePoloniex("BTC/USDT")],
];

for (const [name, fn] of providers) {
  const start = performance.now();
  try {
    const q = await fn();
    const ms = (performance.now() - start).toFixed(0);
    if (q && q.price > 0) {
      log(`${name}`, `$${q.price.toFixed(4)} chg ${q.changePct.toFixed(2)}% vol ${Math.round(q.volume)} (${ms}ms)`);
    } else {
      log(`${name}`, `NULL (${ms}ms)`);
    }
  } catch (e) {
    log(`${name}`, `ERROR ${String(e).slice(0, 80)}`);
  }
}

// Finnhub candles — do they work with the shared key?
try {
  const now = Math.floor(Date.now() / 1000);
  const c = await fetchCandlesFinnhub("AAPL", "15", now - 86400 * 30, now);
  log("finnhub candles AAPL 15m", `${c.length} bars, last close ${c[c.length - 1]?.close}`);
} catch (e) {
  log("finnhub candles AAPL 15m", `ERROR ${String(e).slice(0, 120)}`);
}

// TwelveData candles — expected 429?
try {
  const c = await fetchCandlesTwelveData("AAPL", "15min", 100);
  log("twelvedata candles AAPL 15m", `${c.length} bars`);
} catch (e) {
  log("twelvedata candles AAPL 15m", `ERROR ${String(e).slice(0, 120)}`);
}

// Yahoo candles direct from Node
try {
  const c = await fetchCandlesYahoo("AAPL", "stocks", "15min", 100);
  log("yahoo candles AAPL 15m", `${c.length} bars, last close ${c[c.length - 1]?.close}`);
} catch (e) {
  log("yahoo candles AAPL 15m", `ERROR ${String(e).slice(0, 120)}`);
}
