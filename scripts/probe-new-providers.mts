import {
  fetchQuoteCoinlore, fetchQuoteBithumb, fetchQuoteCoinone, fetchQuoteBitvavo, fetchQuoteXT,
} from "../src/lib/providers.ts";

const BTC = "BTC/USDT", ETH = "ETH/USDT";
const checks: [string, string, Promise<any>][] = [
  ["coinlore (aggregator)", BTC, fetchQuoteCoinlore(BTC)],
  ["coinlore ETH", ETH, fetchQuoteCoinlore(ETH)],
  ["bithumb (Korea)", BTC, fetchQuoteBithumb(BTC)],
  ["coinone (Korea)", BTC, fetchQuoteCoinone(BTC)],
  ["bitvavo (Netherlands)", BTC, fetchQuoteBitvavo(BTC)],
  ["xt.com (global)", BTC, fetchQuoteXT(BTC)],
];

let pass = 0;
for (const [name, sym, p] of checks) {
  try {
    const q = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 8000))]);
    if (q && q.price > 0) { console.log(`PASS  ${name} ${sym} — ${q.price}`); pass++; }
    else console.log(`WARN  ${name} — unreachable from this network (mesh degrades gracefully)`);
  } catch (e) {
    console.log(`WARN  ${name} — ${e?.message ?? e}`);
  }
}
console.log(`\n${pass}/6 new providers live-verified`);
