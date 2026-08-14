import { MLEngine, buildFeatures } from "../src/lib/mlEngine";
import { judgeIntegrity } from "../src/lib/providers";
import { ML_CONFIG } from "../src/constants/config";
import type { OHLCV } from "../src/types";

/* ────────────────────────────────────────────────────────────────
 * EyeQuant safety-systems test suite:
 *   1. MC-dropout epistemic uncertainty
 *   2. Grad-CAM-style attribution (sign correctness + mapping)
 *   3. EWC memory locks (anchors + Fisher — drift constraint)
 *   4. Autonomous-learning gate (circuit breaker)
 *   5. Cross-modal integrity auditor verdicts
 * ──────────────────────────────────────────────────────────────── */

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
    const drift = trend + (rand() - 0.5) * 0.006;
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
  const up = makeSeries(240, 0.0016, 11);
  const down = makeSeries(240, -0.0016, 23);

  /* ── 1) MC-dropout epistemic uncertainty ─────────────────── */
  const engine = new MLEngine("EYEQ.T1", undefined, { noPersist: true });
  await engine.train(up, { quick: true });
  const mu = engine.mcUncertainty(engineLastFeatures(engine, up));
  check("MC uncertainty: passes = MC_PASSES", mu.mcPasses === ML_CONFIG.MC_PASSES, `${mu.mcPasses}`);
  check("MC uncertainty: variance >= 0 and finite", Number.isFinite(mu.variance) && mu.variance >= 0);
  check("MC uncertainty: std finite and sane (< 0.5)", Number.isFinite(mu.std) && mu.std < 0.5, `std=${mu.std.toFixed(4)}`);
  const pred = engine.predict(up.slice(0, 200), 300);
  check("prediction carries uncertainty object", !!pred && pred.uncertainty.mcPasses === ML_CONFIG.MC_PASSES);
  check("prediction carries attribution", !!pred && pred.attribution.length > 0, `candles=${pred?.attribution.length}`);
  check("prediction carries attribution summary (<=5)", !!pred && pred.attributionSummary.length > 0 && pred.attributionSummary.length <= 5);

  /* ── 2) Grad-CAM-style attribution sign correctness ──────── */
  const upEngine = new MLEngine("EYEQ.T2", undefined, { noPersist: true });
  await upEngine.train(up, { quick: true });
  const upPred = upEngine.predict(up.slice(0, 200), 300);
  const upMean = upPred ? meanScores(upPred.attribution) : 0;
  check("uptrend attribution: recent candles bullish (mean > 0)", upMean > 0, `mean=${upMean.toFixed(3)}`);

  const downEngine = new MLEngine("EYEQ.T3", undefined, { noPersist: true });
  await downEngine.train(down, { quick: true });
  const downPred = downEngine.predict(down.slice(0, 200), 300);
  const downMean = downPred ? meanScores(downPred.attribution) : 0;
  check("downtrend attribution: recent candles bearish (mean < 0)", downMean < 0, `mean=${downMean.toFixed(3)}`);

  // Attribution times must map onto real candle buckets
  const times = new Set(up.slice(160, 200).map(c => c.time));
  const mapped = upPred?.attribution.every(a => times.has(a.time));
  check("attribution maps to candle timestamps", !!mapped);

  // Summary should list named features with finite scores
  const allFinite = upPred?.attributionSummary.every(a => Number.isFinite(a.score) && a.name.length > 0);
  check("attribution summary names + finite scores", !!allFinite);

  /* ── 3) EWC memory locks ─────────────────────────────────── */
  // Constrained run: EWC armed with the production λ
  const ewcOn = new MLEngine("EYEQ.T4", undefined, { noPersist: true });
  await ewcOn.train(up, { quick: true });
  check("EWC locked after initial train", ewcOn.getStats().ewcLocked === true);
  check("EWC drift ~ 0 right after capture", ewcOn.weightDriftFromAnchor() < 1e-9);
  await ewcOn.train(down, { retrain: true, quick: true });
  const driftConstrained = ewcOn.weightDriftFromAnchor();

  // Unconstrained run: same pipeline with λ = 0 (memory captured but no restoring force)
  const savedLambda = ML_CONFIG.EWC_LAMBDA;
  ML_CONFIG.EWC_LAMBDA = 0;
  const ewcOff = new MLEngine("EYEQ.T5", undefined, { noPersist: true });
  await ewcOff.train(up, { quick: true });
  await ewcOff.train(down, { retrain: true, quick: true });
  const driftUnconstrained = ewcOff.weightDriftFromAnchor();
  ML_CONFIG.EWC_LAMBDA = savedLambda;

  check("EWC constrains weight drift on regime shift",
    driftConstrained < driftUnconstrained && driftConstrained < driftUnconstrained * 0.95,
    `with-EWC=${driftConstrained.toFixed(5)} vs without=${driftUnconstrained.toFixed(5)}`);

  /* ── 4) Autonomous-learning gate (circuit breaker) ───────── */
  const gated = new MLEngine("EYEQ.T6", undefined, { noPersist: true });
  await gated.train(up, { quick: true });
  gated.setAutonomous(false);
  check("autonomous=false → needsRetrain() = false", gated.needsRetrain() === false);
  gated.setAutonomous(true);
  check("autonomous=true restores retrain check", typeof gated.needsRetrain() === "boolean");

  /* ── 5) Cross-modal integrity auditor ────────────────────── */
  const ok = judgeIntegrity([{ name: "a", price: 100 }, { name: "b", price: 100.02 }]);
  check("integrity: tight agreement → ok", ok.verdict === "ok", `dev=${ok.maxDevPct.toFixed(3)}%`);
  const degraded = judgeIntegrity([{ name: "a", price: 100 }, { name: "b", price: 100.6 }]);
  check("integrity: moderate divergence → degraded", degraded.verdict === "degraded", `dev=${degraded.maxDevPct.toFixed(3)}%`);
  const desync = judgeIntegrity([{ name: "a", price: 100 }, { name: "b", price: 103.5 }]);
  check("integrity: large divergence → de-sync", desync.verdict === "de-sync", `dev=${desync.maxDevPct.toFixed(3)}%`);
  const median = judgeIntegrity([{ name: "a", price: 99 }, { name: "b", price: 100 }, { name: "c", price: 101 }]);
  check("integrity: median computed correctly", Math.abs(median.median - 100) < 1e-9, `median=${median.median}`);

  console.log("");
  if (failures > 0) {
    console.error(`${failures} EYEQUANT TEST(S) FAILED`);
    process.exit(1);
  }
  console.log("All EyeQuant safety-system tests passed ✅");
}

function engineLastFeatures(_engine: MLEngine, series: OHLCV[]): number[] {
  return buildFeatures(series.slice(-Math.min(ML_CONFIG.SEQ_LENGTH, series.length)));
}

function meanScores(points: { score: number }[]): number {
  if (points.length === 0) return 0;
  return points.reduce((a, p) => a + p.score, 0) / points.length;
}

main();
