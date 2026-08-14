import type { OHLCV } from "@/types";
import { ema, rsi } from "@/lib/technicalAnalysis";

/* ────────────────────────────────────────────────────────────────
 * Strategy backtester — runs deterministic simulations on REAL
 * candle history (provider data or live-built bars) with per-side
 * commission, long/short support, and full analytics.
 * ──────────────────────────────────────────────────────────────── */

export type StrategyId = "ma_cross" | "rsi_revert" | "momentum_break";

export interface BacktestParams {
  strategy: StrategyId;
  /** MA crossover: fast & slow periods */
  fast: number;
  slow: number;
  /** RSI mean reversion thresholds */
  rsiLow: number;
  rsiHigh: number;
  /** Momentum breakout lookback (bars) */
  lookback: number;
  /** Commission per side, fraction of notional (e.g. 0.0002) */
  feeRate: number;
  /** Allow short positions (mirror signal below zero-cross) */
  allowShort: boolean;
}

export const DEFAULT_BACKTEST_PARAMS: BacktestParams = {
  strategy: "ma_cross",
  fast: 9,
  slow: 21,
  rsiLow: 30,
  rsiHigh: 70,
  lookback: 20,
  feeRate: 0.0002,
  allowShort: true,
};

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: "long" | "short";
  entry: number;
  exit: number;
  /** Net return % of this trade (fees included) */
  retPct: number;
}

export interface BacktestResult {
  equityCurve: { t: number; equity: number }[];
  trades: BacktestTrade[];
  metrics: {
    totalReturn: number;      // strategy net return %
    buyHoldReturn: number;    // buy-and-hold over same window %
    maxDrawdown: number;      // worst peak-to-trough %
    winRate: number;          // winning trades / closed trades %
    profitFactor: number;     // gross wins / gross losses (∞ → large)
    sharpe: number;           // annualized, per-bar returns
    tradeCount: number;
    exposure: number;         // % of bars in a position
    avgTrade: number;         // avg net return per closed trade %
    periodsPerYear: number;
  };
  startPrice: number;
  endPrice: number;
  bars: number;
  dataSourceNote: string;
}

/** Signals at each bar: 1 = long, 0 = flat, -1 = short. */
export function computeSignals(
  candles: OHLCV[],
  p: BacktestParams
): number[] {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const signals: number[] = new Array(n).fill(0);

  if (p.strategy === "ma_cross") {
    const fastEma = ema(closes, Math.max(2, p.fast));
    const slowEma = ema(closes, Math.max(2, p.slow));
    for (let i = 1; i < n; i++) {
      const f = fastEma[i];
      const s = slowEma[i];
      const fPrev = fastEma[i - 1];
      const sPrev = slowEma[i - 1];
      if (f == null || s == null || fPrev == null || sPrev == null) continue;
      if (fPrev <= sPrev && f > s) signals[i] = 1;                 // golden cross
      else if (fPrev >= sPrev && f < s) signals[i] = p.allowShort ? -1 : 0; // death cross
    }
  } else if (p.strategy === "rsi_revert") {
    const rsiVals = rsi(closes, 14);
    for (let i = 1; i < n; i++) {
      const r = rsiVals[i];
      const rPrev = rsiVals[i - 1];
      if (r == null || rPrev == null) continue;
      if (rPrev < p.rsiLow && r >= p.rsiLow) signals[i] = 1;       // recovering from oversold
      else if (rPrev > p.rsiHigh && r <= p.rsiHigh) signals[i] = p.allowShort ? -1 : 0;
    }
  } else {
    // momentum_break: close breaks the lookback high/low
    const lb = Math.max(2, p.lookback);
    for (let i = lb; i < n; i++) {
      const window = candles.slice(i - lb, i);
      const hi = Math.max(...window.map(c => c.high));
      const lo = Math.min(...window.map(c => c.low));
      if (candles[i].close > hi) signals[i] = 1;
      else if (candles[i].close < lo) signals[i] = p.allowShort ? -1 : 0;
    }
  }

  return signals;
}

export function runBacktest(
  candles: OHLCV[],
  p: BacktestParams,
  tfSeconds = 900,
  dataSourceNote = "live chart series"
): BacktestResult | null {
  if (candles.length < 40) return null;

  const n = candles.length;
  const closes = candles.map(c => c.close);
  const signals = computeSignals(candles, p);

  let equity = 1;
  let position: "long" | "short" | null = null;
  let entryPrice = 0;
  let entryBar = 0;
  let investedBars = 0;

  const equityCurve: { t: number; equity: number }[] = [];
  const trades: BacktestTrade[] = [];

  for (let i = 0; i < n; i++) {
    const price = closes[i];
    const sig = signals[i];

    // Exit first (signal flip or flat)
    if (position && sig !== (position === "long" ? 1 : -1)) {
      const gross = position === "long"
        ? (price - entryPrice) / entryPrice
        : (entryPrice - price) / entryPrice;
      const fee = p.feeRate; // one side on exit
      const ret = gross - fee;
      equity *= 1 + ret;
      trades.push({
        entryTime: candles[entryBar].time,
        exitTime: candles[i].time,
        side: position,
        entry: entryPrice,
        exit: price,
        retPct: ret * 100,
      });
      position = null;
    }

    // Enter
    if (!position && sig !== 0) {
      position = sig === 1 ? "long" : "short";
      entryPrice = price;
      entryBar = i;
      equity *= 1 - p.feeRate; // entry fee
    }

    if (position) investedBars++;
    equityCurve.push({ t: candles[i].time, equity });
  }

  // Close any open position at the last close
  if (position) {
    const price = closes[n - 1];
    const gross = position === "long"
      ? (price - entryPrice) / entryPrice
      : (entryPrice - price) / entryPrice;
    const ret = gross - p.feeRate;
    equity *= 1 + ret;
    trades.push({
      entryTime: candles[entryBar].time,
      exitTime: candles[n - 1].time,
      side: position,
      entry: entryPrice,
      exit: price,
      retPct: ret * 100,
    });
    investedBars++;
    equityCurve[equityCurve.length - 1] = { t: candles[n - 1].time, equity };
  }

  // Metrics (a signal-less window is a valid result — the UI shows the
  // buy-and-hold comparison plus a "no signals" notice instead of a silent no-op)
  if (trades.length === 0) {
    return {
      equityCurve,
      trades,
      metrics: {
        totalReturn: 0,
        buyHoldReturn: ((closes[n - 1] / closes[0]) - 1) * 100,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        sharpe: 0,
        tradeCount: 0,
        exposure: 0,
        avgTrade: 0,
        periodsPerYear: tfSeconds > 0 ? Math.round((365 * 24 * 3600) / tfSeconds) : 252,
      },
      startPrice: closes[0],
      endPrice: closes[n - 1],
      bars: n,
      dataSourceNote,
    };
  }

  // Metrics
  const totalReturn = (equity - 1) * 100;
  const buyHoldReturn = ((closes[n - 1] / closes[0]) - 1) * 100;

  let peak = 1;
  let maxDD = 0;
  for (const pt of equityCurve) {
    peak = Math.max(peak, pt.equity);
    maxDD = Math.max(maxDD, (peak - pt.equity) / peak);
  }

  const wins = trades.filter(t => t.retPct > 0);
  const losses = trades.filter(t => t.retPct <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((a, t) => a + t.retPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.retPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  // Per-bar returns → annualized Sharpe
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push(equityCurve[i].equity / equityCurve[i - 1].equity - 1);
  }
  const meanR = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const varR = returns.length > 1
    ? returns.reduce((a, r) => a + (r - meanR) * (r - meanR), 0) / (returns.length - 1)
    : 0;
  const stdR = Math.sqrt(varR);
  const periodsPerYear = tfSeconds > 0 ? (365 * 24 * 3600) / tfSeconds : 252;
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(periodsPerYear) : 0;

  const avgTrade = trades.reduce((a, t) => a + t.retPct, 0) / trades.length;

  return {
    equityCurve,
    trades,
    metrics: {
      totalReturn,
      buyHoldReturn,
      maxDrawdown: maxDD * 100,
      winRate,
      profitFactor,
      sharpe,
      tradeCount: trades.length,
      exposure: (investedBars / n) * 100,
      avgTrade,
      periodsPerYear: Math.round(periodsPerYear),
    },
    startPrice: closes[0],
    endPrice: closes[n - 1],
    bars: n,
    dataSourceNote,
  };
}
