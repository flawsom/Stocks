import { fetchQuoteFinnhub, fetchQuoteAlphaVantageFx, fetchQuoteTwelveData } from "../src/lib/dataProviders";

const orig = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const res = await orig(input, init);
  if (url.includes("finnhub") || url.includes("alphavantage") || url.includes("twelvedata")) {
    try {
      const clone = res.clone();
      const text = await clone.text();
      console.log(`\n>>> ${res.status} ${url.slice(0, 120)}`);
      console.log(`    body: ${text.slice(0, 220)}`);
    } catch { /* ignore */ }
  }
  return res;
};

const q = await fetchQuoteFinnhub("AAPL");
console.log("\nRESULT fetchQuoteFinnhub(AAPL):", JSON.stringify(q));
const fx = await fetchQuoteAlphaVantageFx("EUR/USD");
console.log("RESULT fetchQuoteAlphaVantageFx(EUR/USD):", JSON.stringify(fx));
const td = await fetchQuoteTwelveData("EUR/USD");
console.log("RESULT fetchQuoteTwelveData(EUR/USD):", JSON.stringify(td));
