import { runBacktest, computeSignals, DEFAULT_BACKTEST_PARAMS } from "../src/lib/backtest";
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

/** Oscillating (mean-reverting) series — regime changes so crossover/RSO strategies fire. */
function makeOscillator(n: number, period: number, amp: number, seed: number): OHLCV[] {
  const rand = mulberry(seed);
  const out: OHLCV[] = [];
  let price = 100;
  const t0 = Math.floor(Date.now() / 1000) - n * 300;
  for (let i = 0; i < n; i++) {
    const open = price;
    const drift = amp * Math.sin((2 * Math.PI * i) / period) + (rand() - 0.5) * 0.004;
    const close = open * (1 + drift);
    const high = Math.max(open, close) * (1 + rand() * 0.003);
    const low = Math.min(open, close) * (1 - rand() * 0.003);
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

// Oscillating regime series — exercises every strategy
const series = makeOscillator(300, 45, 0.006, 42);

// 1) MA crossover produces a valid result on a trending series
const r = runBacktest(series, { ...DEFAULT_BACKTEST_PARAMS, strategy: "ma_cross" }, 300, "test data");
check("ma_cross produced result", r !== null);
if (r) {
  const m = r.metrics;
  check("metrics all finite", Object.values(m).every(v => Number.isFinite(v)));
  check("equity curve recorded", r.equityCurve.length === series.length);
  check("trades recorded", m.tradeCount > 0);
  check("buy-hold return matches price move", Math.abs(m.buyHoldReturn - (r.endPrice / r.startPrice - 1) * 100) < 1e-6);
  check("total return finite range", Math.abs(m.totalReturn) < 500);
  check("win rate in [0,100]", m.winRate >= 0 && m.winRate <= 100);
  check("max drawdown >= 0", m.maxDrawdown >= 0);
  check("exposure in [0,100]", m.exposure >= 0 && m.exposure <= 100);
  check("sharpe finite", Number.isFinite(m.sharpe));
  check("equity starts at 1", Math.abs(r.equityCurve[0].equity - 1) < 1e-9);
}

// 2) Each strategy produces signals/trades on the same series
for (const s of ["ma_cross", "rsi_revert", "momentum_break"] as const) {
  const sigs = computeSignals(series, { ...DEFAULT_BACKTEST_PARAMS, strategy: s });
  const hasSignal = sigs.some(v => v !== 0);
  const res = runBacktest(series, { ...DEFAULT_BACKTEST_PARAMS, strategy: s }, 300);
  check(`${s} produces signals`, hasSignal);
  check(`${s} runs end-to-end`, res !== null && (res?.metrics.tradeCount ?? 0) >= 0);
}

// 3) Fee impact: higher fees cannot produce better returns on a flat series
const flat = makeSeries(200, 0, 7);
const feeLow = runBacktest(flat, { ...DEFAULT_BACKTEST_PARAMS, feeRate: 0.0001 }, 300);
const feeHigh = runBacktest(flat, { ...DEFAULT_BACKTEST_PARAMS, feeRate: 0.02 }, 300);
if (feeLow && feeHigh) {
  check("lower fees ≥ higher fees on flat series", feeLow.metrics.totalReturn >= feeHigh.metrics.totalReturn - 1e-6);
}

// 4) allowShort=false never takes short positions
const longOnly = runBacktest(series, { ...DEFAULT_BACKTEST_PARAMS, allowShort: false }, 300);
if (longOnly) {
  check("long-only has no short trades", longOnly.trades.every(t => t.side === "long"));
}

// 5) Insufficient data returns null
const tiny = runBacktest(series.slice(0, 10), DEFAULT_BACKTEST_PARAMS, 300);
check("insufficient data returns null", tiny === null);

// 6) A monotonic series (no signals) returns a VALID result with zero trades —
//    the lab must show the buy-and-hold comparison + "no signals" notice, never a silent no-op
const monotonic = makeSeries(120, 0.002, 99);
const zeroTrade = runBacktest(monotonic, { ...DEFAULT_BACKTEST_PARAMS, strategy: "ma_cross" }, 300);
check("zero-signal window returns a result (not null)", zeroTrade !== null);
if (zeroTrade) {
  check("zero-signal result has 0 trades", zeroTrade.metrics.tradeCount === 0);
  check("zero-signal metrics all finite", Object.values(zeroTrade.metrics).every(v => Number.isFinite(v)));
  check("zero-signal buy-hold still reported", Math.abs(zeroTrade.metrics.buyHoldReturn - (zeroTrade.endPrice / zeroTrade.startPrice - 1) * 100) < 1e-6);
  check("zero-signal exposure is 0", zeroTrade.metrics.exposure === 0);
}

console.log(failures === 0 ? "\nALL BACKTEST TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
