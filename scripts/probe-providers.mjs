// Probe the real provider modules (bun resolves tsconfig @/ aliases).
import { raceQuote, fetchQuoteBitstamp, fetchQuoteBitget } from "../src/lib/providers.ts";
import { fetchCandles, fetchNewsHackerNews } from "../src/lib/dataProviders.ts";

const t0 = Date.now();
const log = (label, v) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}: ${v}`);

// 1) Crypto mesh race (should now include bitstamp + bitget)
const q = await raceQuote("BTC/USDT", "crypto", { timeoutMs: 4000, ttlMs: 0 });
log("raceQuote BTC/USDT", q ? `${q.source} $${q.price.toFixed(2)} chg ${q.changePct.toFixed(2)}% (${q.latencyMs.toFixed(0)}ms)` : "NULL ❌");

// 2) Direct new providers
const bs = await fetchQuoteBitstamp("BTC/USDT");
log("bitstamp BTC/USDT", bs ? `$${bs.price.toFixed(2)}` : "NULL ❌");
const bg = await fetchQuoteBitget("BTC/USDT");
log("bitget BTC/USDT", bg ? `$${bg.price.toFixed(2)}` : "NULL ❌");

// 3) Crypto candles (kraken→okx→coinbase→bitstamp→binance)
const btc = await fetchCandles("BTC/USDT", "crypto", "15min");
log("candles BTC 15m", `${btc.candles.length} bars from ${btc.source}${btc.note ? " (" + btc.note + ")" : ""}`);

// 4) Stock candles (TD→Polygon→Yahoo→live)
const aapl = await fetchCandles("AAPL", "stocks", "15min");
log("candles AAPL 15m", `${aapl.candles.length} bars from ${aapl.source}${aapl.note ? " (" + aapl.note + ")" : ""}`);

// 5) Futures candles via Yahoo
const es = await fetchCandles("ES", "futures", "15min");
log("candles ES 15m", `${es.candles.length} bars from ${es.source}${es.note ? " (" + es.note + ")" : ""}`);

// 6) Forex candles via Yahoo
const eur = await fetchCandles("EUR/USD", "forex", "1day");
log("candles EUR/USD 1d", `${eur.candles.length} bars from ${eur.source}${eur.note ? " (" + eur.note + ")" : ""}`);

// 7) Hacker News keyless fallback
const hn = await fetchNewsHackerNews();
log("hacker news", Array.isArray(hn) ? `${hn.length} items (first: ${hn[0]?.headline?.slice(0, 60)})` : "NULL ❌");
