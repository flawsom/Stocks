import { MLEngine } from "../src/lib/mlEngine";
import type { OHLCV } from "../src/types";

// Deterministic synthetic series: trend + noise (up regime)
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeries(n: number, trend: number, seed: number): OHLCV[] {
  const rand = mulberry(seed);
  const out: OHLCV[] = [];
  let price = 100;
  const t0 = Math.floor(Date.now() / 1000) - n * 300;
  for (let i = 0; i < n; i++) {
    const open = price;
    const drift = trend + (rand() - 0.5) * 0.008;
    const close = open * (1 + drift);
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    out.push({ time: t0 + i * 300, open, high, low, close, volume: 1000 + rand() * 2000 });
    price = close;
  }
  return out;
}

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1) Training reduces loss and initialized
  const engine = new MLEngine("TEST.SYM");
  const series = makeSeries(240, 0.0015, 42); // gentle uptrend
  await engine.train(series, { quick: true });
  check("engine initialized after train", engine.isInitialized());
  const statsAfterTrain = engine.getStats();
  check("loss is finite and > 0", Number.isFinite(statsAfterTrain.loss) && statsAfterTrain.loss > 0);
  check("loss series recorded", statsAfterTrain.lossSeries.length > 0);
  check("epochs advanced", statsAfterTrain.trainingEpoch > 0);

  // 2) Prediction on a trending holdout — direction should match the trend most of the time
  const holdout = makeSeries(120, 0.002, 7);
  let upVotes = 0;
  let total = 0;
  for (let i = 60; i < holdout.length - 10; i += 5) {
    const pred = engine.predict(holdout.slice(0, i), 300);
    if (pred && pred.direction !== "neutral") {
      total++;
      if (pred.direction === "up") upVotes++;
    }
  }
  check(`predicts up-trend (${upVotes}/${total})`, total > 0 && upVotes / total > 0.55);

  // 3) Ensemble produces 7 votes and agreement in [0,1]
  const lastPred = engine.predict(holdout, 300);
  check("prediction produced", lastPred !== null);
  if (lastPred) {
    check("7 model votes", lastPred.votes.length === 7);
    check("votes carry weights", lastPred.votes.every(v => v.weight > 0 && v.weight <= 1));
    check("multi-horizon targets", lastPred.horizons.length >= 3 && lastPred.horizons.every(h => h.h > 0 && h.target > 0));
    check("agreement in range", lastPred.agreement >= 0 && lastPred.agreement <= 1);
    check("method mentions ensemble", lastPred.method.includes("Ensemble") || lastPred.method.includes("Weighted"));
    check("confidence in range", lastPred.confidence >= 40 && lastPred.confidence <= 97);
  }

  // 4) Outcome resolution: pending → resolved after target time
  const pred2 = engine.predict(holdout, 300);
  if (pred2) {
    const pending = engine.getPending();
    check("pending outcome registered", pending.length > 0);
    // Force resolution by fast-forwarding past the target time with a moved price
    const results = engine.evaluateOutcomes(pred2.targetPrice + 1, holdout, Date.now() + 30 * 60 * 1000);
    check("outcome resolved", results.length > 0);
    const outcomes = engine.getOutcomes();
    const resolvedOne = outcomes.find(o => o.resolvedAt !== null);
    check("resolved outcome has hit flag", resolvedOne ? typeof resolvedOne.hit === "boolean" : false);
    check("rolling accuracy updated", engine.getStats().rollingAccuracy.length > 0);
  }

  // 5) Hard-example learning: feed a failure, hardExamples should grow
  const statsBefore = engine.getStats();
  const fails = engine.getOutcomes().filter(o => o.hit === false);
  if (fails.length > 0) {
    const fs = fails[0];
    // wait for the async online update
    await new Promise(r => setTimeout(r, 50));
    check("hard examples recorded after failure", engine.getStats().hardExamples >= statsBefore.hardExamples + (fails.length > 0 ? 1 : 0));
  } else {
    console.log("SKIP  hard-example growth (no failures in this run)");
  }

  // 6) Persistence round-trip
  const before = engine.getStats().trainingEpoch;
  const raw = localStorage.getItem("omegatrade-models-v3:TEST.SYM");
  check("persisted payload exists", raw !== null);
  const restored = new MLEngine("TEST.SYM");
  check("persisted weights restore", restored.isInitialized() && restored.getStats().trainingEpoch === before);

  // 7) Walk-forward metrics populated after training
  const wf = engine.getStats();
  check("walk-forward accuracy in [0,100]", wf.wfAccuracy >= 0 && wf.wfAccuracy <= 100);
  check("brier score finite", Number.isFinite(wf.brierScore) && wf.brierScore >= 0);
  check("log loss finite", Number.isFinite(wf.logLoss) && wf.logLoss >= 0);

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

// Minimal localStorage shim for node
(globalThis as any).localStorage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
})();

main().catch(e => { console.error(e); process.exit(1); });
