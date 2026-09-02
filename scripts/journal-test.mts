// Decision-journal unit test: engine must emit signal → scan → verdict entries
// from synthetic-but-realistic candles, all with what/why/how text.
import { MLEngine } from "../src/lib/mlEngine";
import type { OHLCV } from "../src/types";

let fails = 0;
const check = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!c) fails++; };

// Oscillating series so predictions register and resolve
function makeSeries(n: number): OHLCV[] {
  const out: OHLCV[] = [];
  let price = 100;
  const t0 = Math.floor(Date.now() / 1000) - n * 60;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * (1 + 0.004 * Math.sin((2 * Math.PI * i) / 40) + (Math.sin(i * 7.3) * 0.001));
    out.push({ time: t0 + i * 60, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close, volume: 1000 + i });
    price = close;
  }
  return out;
}

const candles = makeSeries(300);
const engine = new MLEngine("TEST", () => {}, { noPersist: true });
await engine.train(candles, { quick: true });

// 1) First predict registers a SIGNAL entry
const p1 = engine.predict(candles, 60);
check("predict returns a forecast", p1 !== null);

let stats = engine.getStats();
const kinds1 = stats.decisionEvents.map(e => e.kind);
check("signal entry journaled", kinds1.includes("signal"), kinds1.join(","));
const sig = stats.decisionEvents.find(e => e.kind === "signal");
check("signal has what/why/how text", !!sig && sig.headline.length > 0 && sig.why.length > 0 && sig.how.length > 0,
  sig ? `${sig.headline} | why:${sig.why} | how:${sig.how}` : "");

// 2) Repeated predicts do NOT flood — no second signal inside the same window
engine.predict(candles, 60);
stats = engine.getStats();
check("no duplicate signal inside the same horizon", stats.decisionEvents.filter(e => e.kind === "signal").length === 1);

// 3) Outcome resolution journals a VERDICT
// Fast-forward: force resolution by predicting, then waiting past horizon with moved price
const before = engine.getStats().decisionEvents.length;
engine.evaluateOutcomes(candles[candles.length - 1].close * 1.05, candles, Date.now() + 10 * 60 * 1000);
stats = engine.getStats();
const kinds = stats.decisionEvents.slice(before).map(e => e.kind);
check("verdict entry journaled on resolution", kinds.includes("verdict"), kinds.join(","));

console.log(fails === 0 ? "\nJOURNAL TEST PASSED ✅" : `\n${fails} JOURNAL CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
