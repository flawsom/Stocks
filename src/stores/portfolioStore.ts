import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Position, TradeRecord, EquityPoint, TradeSide } from "@/types";

/** Starting virtual capital */
export const STARTING_CASH = 100_000;
/** Commission per side (0.02% of notional) — realistic enough to matter, small enough to not dominate */
export const FEE_RATE = 0.0002;
/** Minimum equity-curve sample interval (ms) */
const SAMPLE_INTERVAL = 4000;
const MAX_EQUITY_POINTS = 1500;

interface PortfolioState {
  cash: number;
  positions: Position[];
  trades: TradeRecord[];
  equityCurve: EquityPoint[];
  realizedPnl: number;
  wins: number;
  losses: number;
  lastSample: number;

  openPosition: (
    symbol: string,
    side: TradeSide,
    qty: number,
    price: number
  ) => { ok: boolean; error?: string; position?: Position };
  closePosition: (
    positionId: string,
    qty: number,
    price: number
  ) => { ok: boolean; error?: string };
  /** Update live prices / unrealized P&L from a symbol → price map */
  markToMarket: (prices: Record<string, number>) => void;
  /** Append an equity-curve point (throttled unless forced) */
  sampleEquity: (forced?: boolean) => void;
  resetAccount: () => void;
}

function computeUnrealized(p: Position): { pnl: number; pct: number } {
  const price = p.livePrice > 0 ? p.livePrice : p.avgPrice;
  const pnl = p.side === "long"
    ? (price - p.avgPrice) * p.qty
    : (p.avgPrice - price) * p.qty;
  const cost = p.notional || p.avgPrice * p.qty;
  return { pnl, pct: cost > 0 ? (pnl / cost) * 100 : 0 };
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

export const usePortfolioStore = create<PortfolioState>()(
  persist(
    (set, get) => ({
      cash: STARTING_CASH,
      positions: [],
      trades: [],
      equityCurve: [{ t: Date.now(), equity: STARTING_CASH, cash: STARTING_CASH }],
      realizedPnl: 0,
      wins: 0,
      losses: 0,
      lastSample: Date.now(),

      openPosition: (symbol, side, qty, price) => {
        const state = get();
        if (!(qty > 0)) return { ok: false, error: "Quantity must be positive" };
        if (!(price > 0)) return { ok: false, error: "No live price available" };

        const notional = qty * price;
        const fee = notional * FEE_RATE;

        if (side === "long") {
          if (state.cash < notional + fee) {
            return { ok: false, error: "Insufficient buying power" };
          }
        }

        // Merge with an existing position on the same symbol/side (average up/down)
        const existing = state.positions.find(p => p.symbol === symbol && p.side === side);
        let positions: Position[];
        let position: Position;

        if (existing) {
          const newQty = existing.qty + qty;
          const avgPrice = (existing.avgPrice * existing.qty + price * qty) / newQty;
          position = {
            ...existing,
            qty: newQty,
            avgPrice,
            notional: newQty * avgPrice,
            livePrice: price,
          };
          const u = computeUnrealized(position);
          position.unrealizedPnl = u.pnl;
          position.unrealizedPnlPct = u.pct;
          positions = state.positions.map(p => (p.id === existing.id ? position : p));
        } else {
          position = {
            id: makeId("pos"),
            symbol,
            side,
            qty,
            avgPrice: price,
            openedAt: Date.now(),
            livePrice: price,
            unrealizedPnl: 0,
            unrealizedPnlPct: 0,
            notional,
          };
          positions = [...state.positions, position];
        }

        // Accounting
        const cash = side === "long"
          ? state.cash - notional - fee
          : state.cash + notional - fee; // short sale credits proceeds

        const trade: TradeRecord = {
          id: makeId("trd"),
          symbol,
          side,
          action: "open",
          qty,
          price,
          fee,
          realizedPnl: null,
          timestamp: Date.now(),
        };

        set({ cash, positions, trades: [trade, ...state.trades].slice(0, 200) });
        get().sampleEquity(true);
        return { ok: true, position };
      },

      closePosition: (positionId, qty, price) => {
        const state = get();
        const pos = state.positions.find(p => p.id === positionId);
        if (!pos) return { ok: false, error: "Position not found" };
        if (!(qty > 0) || qty > pos.qty) {
          return { ok: false, error: `Quantity must be between 0 and ${pos.qty}` };
        }
        if (!(price > 0)) return { ok: false, error: "No live price available" };

        const fee = qty * price * FEE_RATE;
        const realized = pos.side === "long"
          ? (price - pos.avgPrice) * qty
          : (pos.avgPrice - price) * qty;
        const realizedNet = realized - fee;

        // Long close: sell back → cash in. Short close: buy back → cash out.
        const cash = pos.side === "long"
          ? state.cash + qty * price - fee
          : state.cash - qty * price - fee;

        const remaining = pos.qty - qty;
        let positions: Position[];
        if (remaining <= 0) {
          positions = state.positions.filter(p => p.id !== positionId);
        } else {
          const updated: Position = { ...pos, qty: remaining };
          const u = computeUnrealized(updated);
          updated.unrealizedPnl = u.pnl;
          updated.unrealizedPnlPct = u.pct;
          positions = state.positions.map(p => (p.id === positionId ? updated : p));
        }

        const wins = state.wins + (realized > 0 ? 1 : 0);
        const losses = state.losses + (realized < 0 ? 1 : 0);

        const trade: TradeRecord = {
          id: makeId("trd"),
          symbol: pos.symbol,
          side: pos.side,
          action: remaining <= 0 ? "close" : "partial_close",
          qty,
          price,
          fee,
          realizedPnl: roundMoney(realizedNet),
          timestamp: Date.now(),
        };

        set({
          cash,
          positions,
          realizedPnl: state.realizedPnl + realizedNet,
          wins,
          losses,
          trades: [trade, ...state.trades].slice(0, 200),
        });
        get().sampleEquity(true);
        return { ok: true };
      },

      markToMarket: (prices) => {
        const state = get();
        if (state.positions.length === 0) return;
        let changed = false;
        const positions = state.positions.map(p => {
          const price = prices[p.symbol];
          if (!price || price <= 0 || price === p.livePrice) return p;
          const u = computeUnrealized({ ...p, livePrice: price });
          changed = true;
          return { ...p, livePrice: price, unrealizedPnl: u.pnl, unrealizedPnlPct: u.pct };
        });
        if (changed) set({ positions });
        get().sampleEquity(false);
      },

      sampleEquity: (forced) => {
        const state = get();
        const now = Date.now();
        if (!forced && now - state.lastSample < SAMPLE_INTERVAL) return;
        let equity = state.cash;
        for (const p of state.positions) {
          const price = p.livePrice > 0 ? p.livePrice : p.avgPrice;
          equity += p.side === "long" ? p.qty * price : -p.qty * price;
        }
        const curve = [...state.equityCurve, { t: now, equity: roundMoney(equity), cash: roundMoney(state.cash) }];
        set({
          equityCurve: curve.length > MAX_EQUITY_POINTS ? curve.slice(-MAX_EQUITY_POINTS) : curve,
          lastSample: now,
        });
      },

      resetAccount: () => set({
        cash: STARTING_CASH,
        positions: [],
        trades: [],
        equityCurve: [{ t: Date.now(), equity: STARTING_CASH, cash: STARTING_CASH }],
        realizedPnl: 0,
        wins: 0,
        losses: 0,
        lastSample: Date.now(),
      }),
    }),
    {
      name: "omegatrade-portfolio-v1",
      partialize: (state) => ({
        cash: state.cash,
        positions: state.positions,
        trades: state.trades,
        equityCurve: state.equityCurve,
        realizedPnl: state.realizedPnl,
        wins: state.wins,
        losses: state.losses,
        lastSample: state.lastSample,
      }),
    }
  )
);

/** Total unrealized P&L across all open positions. */
export function selectUnrealized(state: PortfolioState): number {
  return state.positions.reduce((acc, p) => acc + p.unrealizedPnl, 0);
}

/** Account equity = cash + Σ(long notional) − Σ(short notional), at live prices. */
export function selectEquity(state: PortfolioState): number {
  let equity = state.cash;
  for (const p of state.positions) {
    const price = p.livePrice > 0 ? p.livePrice : p.avgPrice;
    equity += p.side === "long" ? p.qty * price : -p.qty * price;
  }
  return roundMoney(equity);
}

/** Win rate over closed trades (percentage). */
export function selectWinRate(state: PortfolioState): number {
  const total = state.wins + state.losses;
  return total > 0 ? (state.wins / total) * 100 : 0;
}
