import { useEffect, useMemo, useState } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import {
  usePortfolioStore,
  FEE_RATE,
  selectEquity,
  selectUnrealized,
} from "@/stores/portfolioStore";
import { getSymbolMeta } from "@/constants/config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Wallet, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Minus, Plus } from "lucide-react";
import type { TradeSide } from "@/types";

function fmtPrice(price: number, decimals = 2): string {
  if (price < 0.01) return price.toFixed(5);
  return price.toFixed(decimals);
}

export default function TradingTicket() {
  const { activeSymbol, watchlist } = useTradingStore();
  const {
    cash, positions, openPosition, closePosition,
  } = usePortfolioStore();

  const [side, setSide] = useState<TradeSide>("long");
  const [qty, setQty] = useState("1");

  const meta = getSymbolMeta(activeSymbol);
  const decimals = meta?.decimals ?? 2;
  const live = watchlist.find(w => w.symbol === activeSymbol);
  const price = live?.price || 0;
  const position = positions.find(p => p.symbol === activeSymbol);
  const equity = selectEquity(usePortfolioStore.getState());
  const unrealized = selectUnrealized(usePortfolioStore.getState());

  // Reset the ticket when the symbol changes
  useEffect(() => {
    setQty("1");
    setSide(position ? position.side : "long");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol]);

  const qtyNum = useMemo(() => {
    const n = parseFloat(qty);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [qty]);

  const notional = qtyNum * price;
  const fee = notional * FEE_RATE;
  const maxQtyLong = price > 0 ? (cash - fee) / price : 0;

  const setPct = (pct: number) => {
    if (price <= 0) return;
    const q = side === "long"
      ? ((cash * pct) / 100) / price
      : ((cash * pct) / 100) / price;
    setQty(q <= 0 ? "1" : q.toFixed(4).replace(/\.?0+$/, ""));
  };

  const execute = (s: TradeSide) => {
    if (price <= 0) {
      toast("No live price — waiting for the feed");
      return;
    }
    if (qtyNum <= 0) {
      toast("Enter a quantity");
      return;
    }
    const res = openPosition(activeSymbol, s, qtyNum, price);
    if (res.ok) {
      const dir = s === "long" ? "▲ LONG" : "▼ SHORT";
      toast.success(
        `${dir} ${activeSymbol} · ${qtyNum} @ ${fmtPrice(price, decimals)} · est. fee $${fee.toFixed(2)}`
      );
      setQty("1");
    } else {
      toast.error(res.error || "Order rejected");
    }
  };

  const closeAll = () => {
    if (!position || price <= 0) return;
    const res = closePosition(position.id, position.qty, price);
    if (res.ok) {
      const pnl = (position.side === "long"
        ? (price - position.avgPrice) * position.qty
        : (position.avgPrice - price) * position.qty) - position.qty * price * FEE_RATE;
      toast.success(
        `Closed ${position.symbol} · realized ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`
      );
    } else {
      toast.error(res.error || "Could not close position");
    }
  };

  const sideColor = side === "long" ? "#0a9c36" : "#d43b36";
  const positionUp = (position?.unrealizedPnl ?? 0) >= 0;

  return (
    <div className="flex-none border-t border-terminal-border bg-terminal-bg flex items-stretch h-14">
      {/* Account strip */}
      <div className="flex items-center gap-4 px-3 border-r border-terminal-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Wallet size={11} className="text-brand-cyan" />
          <span className="text-[10px] font-mono text-slate-600 uppercase">Equity</span>
          <span className="text-xs font-mono font-bold text-slate-100">
            ${equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-slate-600 uppercase">Cash</span>
          <span className="text-xs font-mono font-semibold text-slate-300">
            ${cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-slate-600 uppercase">Open P&L</span>
          <span className={cn("text-xs font-mono font-bold", unrealized >= 0 ? "text-bull" : "text-bear")}>
            {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Symbol + price */}
      <div className="flex items-center gap-3 px-3 border-r border-terminal-border shrink-0">
        <div className="flex flex-col">
          <span className="text-xs font-mono font-bold text-slate-200">{activeSymbol}</span>
          <span className="text-[9px] font-mono text-slate-600 uppercase">{meta?.name ?? ""}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className={cn(
            "text-sm font-mono font-bold",
            (live?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"
          )}>
            {price > 0 ? fmtPrice(price, decimals) : "—"}
          </span>
          <span className={cn(
            "text-[9px] font-mono",
            (live?.changePct ?? 0) >= 0 ? "text-bull/70" : "text-bear/70"
          )}>
            {(live?.changePct ?? 0) >= 0 ? "▲" : "▼"}{Math.abs(live?.changePct ?? 0).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Side toggle */}
      <div className="flex items-center gap-0.5 px-3 shrink-0">
        <button
          onClick={() => setSide("long")}
          className={cn(
            "px-3 h-7 rounded text-[11px] font-mono font-bold transition-all",
            side === "long"
              ? "bg-bull/15 text-bull border border-bull/40 shadow-green-glow"
              : "bg-terminal-surface text-slate-500 border border-terminal-border hover:text-slate-300"
          )}
        >
          <ArrowUpRight size={10} className="inline -mt-0.5 mr-0.5" /> LONG
        </button>
        <button
          onClick={() => setSide("short")}
          className={cn(
            "px-3 h-7 rounded text-[11px] font-mono font-bold transition-all",
            side === "short"
              ? "bg-bear/15 text-bear border border-bear/40 shadow-red-glow"
              : "bg-terminal-surface text-slate-500 border border-terminal-border hover:text-slate-300"
          )}
        >
          <ArrowDownRight size={10} className="inline -mt-0.5 mr-0.5" /> SHORT
        </button>
      </div>

      {/* Quantity */}
      <div className="flex items-center gap-1.5 px-3 border-l border-terminal-border shrink-0">
        <span className="text-[10px] font-mono text-slate-600 uppercase">Qty</span>
        <div className="flex items-center rounded border border-terminal-border bg-terminal-surface">
          <button
            onClick={() => setQty(String(Math.max(0, qtyNum - (qtyNum >= 10 ? 1 : 0.1))).replace(/\.?0+$/, "") || "0")}
            className="px-1.5 py-1 text-slate-500 hover:text-slate-200 transition-colors"
          >
            <Minus size={10} />
          </button>
          <input
            value={qty}
            onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-16 bg-transparent text-center text-xs font-mono font-semibold text-slate-100 outline-none"
            inputMode="decimal"
          />
          <button
            onClick={() => setQty(String(qtyNum + (qtyNum >= 10 ? 1 : 0.1)).replace(/\.?0+$/, ""))}
            className="px-1.5 py-1 text-slate-500 hover:text-slate-200 transition-colors"
          >
            <Plus size={10} />
          </button>
        </div>
        {[25, 50, 100].map(pct => (
          <button
            key={pct}
            onClick={() => setPct(pct)}
            className="px-1.5 py-1 rounded border border-terminal-border text-[9px] font-mono text-slate-500 hover:text-brand-cyan hover:border-brand-cyan/40 transition-colors"
          >
            {pct}%
          </button>
        ))}
      </div>

      {/* Estimated cost */}
      <div className="hidden lg:flex flex-col justify-center px-3 border-l border-terminal-border shrink-0">
        <span className="text-[9px] font-mono text-slate-600 uppercase">
          Est. cost {side === "short" ? "credit" : "debit"}
        </span>
        <span className="text-xs font-mono font-semibold text-slate-200">
          ${notional.toFixed(2)} <span className="text-slate-600">· fee ${fee.toFixed(2)}</span>
        </span>
        {side === "long" && price > 0 && (
          <span className="text-[9px] font-mono text-slate-600">
            max {maxQtyLong > 0 ? maxQtyLong.toFixed(decimals) : 0}
          </span>
        )}
      </div>

      {/* Position for active symbol */}
      {position && (
        <div className="flex items-center gap-2 px-3 border-l border-terminal-border shrink-0">
          <span className={cn(
            "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
            position.side === "long" ? "text-bull bg-bull/10 border border-bull/30" : "text-bear bg-bear/10 border border-bear/30"
          )}>
            {position.side.toUpperCase()} {position.qty}
          </span>
          <div className="flex flex-col">
            <span className="text-[9px] font-mono text-slate-600">@ {position.avgPrice.toFixed(decimals)}</span>
            <span className={cn("text-[10px] font-mono font-bold", positionUp ? "text-bull" : "text-bear")}>
              {position.unrealizedPnl >= 0 ? "+" : ""}{position.unrealizedPnl.toFixed(2)}
            </span>
          </div>
          <button
            onClick={closeAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-mono font-bold bg-predict/15 text-predict border border-predict/40 hover:bg-predict/25 transition-colors"
          >
            <ArrowLeftRight size={10} /> CLOSE
          </button>
        </div>
      )}

      {/* Execute */}
      <div className="ml-auto flex items-center gap-2 px-3 shrink-0">
        {side === "long" ? (
          <button
            onClick={() => execute("long")}
            className="px-6 h-8 rounded text-xs font-mono font-bold bg-bull text-terminal-bg hover:bg-bull-dim transition-colors shadow-green-glow"
          >
            BUY
          </button>
        ) : (
          <button
            onClick={() => execute("short")}
            className="px-6 h-8 rounded text-xs font-mono font-bold bg-bear text-terminal-bg hover:bg-bear-dim transition-colors shadow-red-glow"
          >
            SELL
          </button>
        )}
      </div>
    </div>
  );
}
