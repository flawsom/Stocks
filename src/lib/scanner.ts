import type { WatchlistItem, MarketType } from "@/types";

/* ────────────────────────────────────────────────────────────────
 * Live market scanner.
 *
 * Every metric below is derived from REAL data already in memory:
 * watchlist quotes (live feed prices) + the aggregator's per-symbol
 * tick buffers (real trades/quotes). Nothing is simulated.
 * ──────────────────────────────────────────────────────────────── */

export interface Tick { ts: number; price: number; vol: number }

export interface ScanRow {
  symbol: string;
  name: string;
  market: MarketType;
  price: number;
  change: number;
  changePct: number;
  /** 20-tick log-return (%) — short-term momentum from the live tick stream */
  momentum20: number;
  /** Swing of the tick window (%) — (max−min)/mid over the last 30 ticks */
  swing: number;
  /** RSI(14) computed on tick prices (live microstructure) */
  rsi: number | null;
  /** Signed volume flow −1..1 (up-tick vol − down-tick vol) / total vol */
  flow: number;
  /** Composite score −100..100 */
  score: number;
  /** Ticks observed in the window */
  ticks: number;
}

/** RSI(14) over a sequence of prices (Wilder's smoothing). */
export function rsiOnPrices(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch > 0) avgGain += ch;
    else avgLoss += Math.abs(ch);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
  }
  const rs = avgGain / (avgLoss || 1e-9);
  return 100 - 100 / (1 + rs);
}

function tanh(x: number): number {
  return Math.tanh(Math.max(-30, Math.min(30, x)));
}

/** Build one scanner row for a symbol from its live watchlist quote + tick buffer. */
export function buildScanRow(
  item: WatchlistItem,
  ticks: Tick[]
): ScanRow {
  const prices = ticks.map(t => t.price);

  let momentum20 = 0;
  if (prices.length >= 3) {
    const first = prices[Math.max(0, prices.length - 21)];
    if (first > 0) momentum20 = (Math.log(prices[prices.length - 1] / first)) * 100;
  }

  let swing = 0;
  const window = prices.slice(-30);
  if (window.length >= 3) {
    const hi = Math.max(...window);
    const lo = Math.min(...window);
    const mid = (hi + lo) / 2;
    if (mid > 0) swing = ((hi - lo) / mid) * 100;
  }

  const rsi = rsiOnPrices(prices.slice(-30));

  let upVol = 0;
  let downVol = 0;
  const flowWindow = ticks.slice(-40);
  for (let i = 1; i < flowWindow.length; i++) {
    const vol = flowWindow[i].vol || 0;
    if (flowWindow[i].price >= flowWindow[i - 1].price) upVol += vol;
    else downVol += vol;
  }
  const totalVol = upVol + downVol;
  const flow = totalVol > 0 ? (upVol - downVol) / totalVol : 0;

  // Composite: momentum (50%) + session change (30%) + volume flow (20%)
  const momScore = tanh(momentum20 * 6);
  const chgScore = tanh((item.changePct || 0) / 4);
  const score = (momScore * 0.5 + chgScore * 0.3 + flow * 0.2) * 100;

  return {
    symbol: item.symbol,
    name: item.name,
    market: item.market,
    price: item.price,
    change: item.change,
    changePct: item.changePct,
    momentum20,
    swing,
    rsi,
    flow,
    score,
    ticks: prices.length,
  };
}

export type ScanSortKey = "score" | "changePct" | "momentum20" | "swing" | "rsi" | "flow" | "price";

export function sortScanRows(rows: ScanRow[], key: ScanSortKey, dir: 1 | -1): ScanRow[] {
  return [...rows].sort((a, b) => {
    const va = a[key] ?? -Infinity;
    const vb = b[key] ?? -Infinity;
    return (va - vb) * dir;
  });
}
