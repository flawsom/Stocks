import { useTradingStore } from "@/stores/tradingStore";
import { getSymbolMeta } from "@/constants/config";
import {
  usePortfolioStore,
  selectEquity,
  selectUnrealized,
  selectWinRate,
} from "@/stores/portfolioStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Wallet, TrendingUp, RotateCcw, XCircle, ArrowUpRight, ArrowDownRight, Activity, History } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from "recharts";

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #c8d2c8",
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "JetBrains Mono",
  color: "#121613",
};

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded bg-terminal-bg/50 border border-terminal-border/50 py-1.5 px-2">
      <div className="text-[9px] font-mono text-slate-600 uppercase tracking-wide">{label}</div>
      <div className="text-xs font-mono font-bold" style={{ color: color || "#121613" }}>{value}</div>
    </div>
  );
}

export default function PortfolioPanel() {
  const { activeSymbol, setActiveSymbol, setActiveMarket } = useTradingStore();
  const portfolio = usePortfolioStore();

  const equity = selectEquity(portfolio);
  const unrealized = selectUnrealized(portfolio);
  const winRate = selectWinRate(portfolio);
  const start = portfolio.equityCurve[0]?.equity || 100000;
  const totalReturn = ((equity - start) / start) * 100;

  const curveData = portfolio.equityCurve.map(p => ({
    t: new Date(p.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    equity: Number(p.equity.toFixed(2)),
  }));

  const closePosition = (id: string, symbol: string, qty: number, price: number, side: string, avg: number) => {
    const res = portfolio.closePosition(id, qty, price);
    if (res.ok) {
      const pnl = (side === "long"
        ? (price - avg) * qty
        : (avg - price) * qty) - qty * price * 0.0002;
      toast.success(`Closed ${symbol} · ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`);
    } else {
      toast.error(res.error || "Could not close position");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={14} className="text-brand-cyan" />
          <span className="text-xs font-mono font-semibold text-brand-cyan text-glow-cyan">
            PAPER ACCOUNT
          </span>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Reset the paper account to $100,000? All positions and history will be cleared.")) {
              portfolio.resetAccount();
              toast("Paper account reset to $100,000");
            }
          }}
          className="flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-bear transition-colors"
        >
          <RotateCcw size={10} /> RESET
        </button>
      </div>

      {/* Equity + return */}
      <div className="terminal-panel p-3">
        <div className="flex items-end justify-between mb-1">
          <div>
            <div className="text-[9px] font-mono text-slate-600 uppercase">Account Equity</div>
            <div className="text-xl font-mono font-bold text-slate-100">
              ${equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className={cn("text-sm font-mono font-bold", totalReturn >= 0 ? "text-bull" : "text-bear")}>
            {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%
          </div>
        </div>
        {curveData.length > 1 && (
          <ResponsiveContainer width="100%" height={70}>
            <AreaChart data={curveData} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a034" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#16a034" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} interval={5} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} />
              <CartesianGrid stroke="#e4ebe2" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, "Equity"]} />
              <ReferenceLine y={start} stroke="#c8d2c8" strokeDasharray="2 2" />
              <Area type="monotone" dataKey="equity" stroke="#16a034" strokeWidth={1.5} fill="url(#eqGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Cash" value={`$${portfolio.cash.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <Stat
          label="Open P&L"
          value={`${unrealized >= 0 ? "+" : ""}$${unrealized.toFixed(2)}`}
          color={unrealized >= 0 ? "#0a9c36" : "#d43b36"}
        />
        <Stat
          label="Realized"
          value={`${portfolio.realizedPnl >= 0 ? "+" : ""}$${portfolio.realizedPnl.toFixed(2)}`}
          color={portfolio.realizedPnl >= 0 ? "#0a9c36" : "#d43b36"}
        />
        <Stat
          label="Win rate"
          value={`${winRate.toFixed(0)}% · ${portfolio.wins}W/${portfolio.losses}L`}
          color={winRate >= 50 ? "#0a9c36" : "#a16207"}
        />
      </div>

      {/* Positions */}
      <div className="terminal-panel p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Activity size={10} className="text-slate-500" />
          <span className="text-xs font-mono text-slate-500">OPEN POSITIONS</span>
          <span className="text-[9px] font-mono text-slate-600 ml-auto">{portfolio.positions.length}</span>
        </div>
        {portfolio.positions.length === 0 ? (
          <div className="text-xs font-mono text-slate-600 py-1">
            No open positions. Use the order bar below the chart, or the AI signal buttons.
          </div>
        ) : (
          <div className="space-y-1.5">
            {portfolio.positions.map(p => {
              const up = p.unrealizedPnl >= 0;
              return (
                <div
                  key={p.id}
                  className="rounded border border-terminal-border/50 bg-terminal-bg/40 p-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <button
                      onClick={() => {
                        setActiveSymbol(p.symbol);
                        const meta = getSymbolMeta(p.symbol);
                        if (meta) setActiveMarket(meta.market);
                      }}
                      className="text-xs font-mono font-bold text-slate-200 hover:text-brand-cyan transition-colors"
                    >
                      {p.symbol}
                    </button>
                    <span className={cn(
                      "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded",
                      p.side === "long" ? "text-bull bg-bull/10 border border-bull/30" : "text-bear bg-bear/10 border border-bear/30"
                    )}>
                      {p.side.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>{p.qty} @ {p.avgPrice.toFixed(p.avgPrice < 1 ? 5 : 2)}</span>
                    <span className={up ? "text-bull" : "text-bear"}>
                      {p.unrealizedPnl >= 0 ? "+" : ""}{p.unrealizedPnl.toFixed(2)} ({p.unrealizedPnlPct >= 0 ? "+" : ""}{p.unrealizedPnlPct.toFixed(2)}%)
                    </span>
                  </div>
                  <button
                    onClick={() => closePosition(p.id, p.symbol, p.qty, p.livePrice, p.side, p.avgPrice)}
                    className="w-full mt-1.5 py-1 rounded border border-terminal-border text-[10px] font-mono font-semibold text-slate-500 hover:text-predict hover:border-predict/40 transition-colors"
                  >
                    CLOSE ALL
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trade history */}
      <div className="terminal-panel p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <History size={10} className="text-slate-500" />
          <span className="text-xs font-mono text-slate-500">ORDER LOG</span>
          <span className="text-[9px] font-mono text-slate-600 ml-auto">last {portfolio.trades.length}</span>
        </div>
        {portfolio.trades.length === 0 ? (
          <div className="text-xs font-mono text-slate-600 py-1">No orders yet.</div>
        ) : (
          <div className="space-y-0.5">
            {portfolio.trades.slice(0, 10).map(t => {
              const t2 = new Date(t.timestamp);
              const time = `${String(t2.getHours()).padStart(2, "0")}:${String(t2.getMinutes()).padStart(2, "0")}:${String(t2.getSeconds()).padStart(2, "0")}`;
              return (
                <div key={t.id} className="flex items-center gap-1.5 text-[10px] font-mono border-b border-terminal-border/30 last:border-0 py-1">
                  <span className="text-slate-600 shrink-0">{time}</span>
                  {t.side === "long" ? (
                    <ArrowUpRight size={9} className="text-bull shrink-0" />
                  ) : (
                    <ArrowDownRight size={9} className="text-bear shrink-0" />
                  )}
                  <span className="text-slate-400 font-semibold">{t.symbol}</span>
                  <span className={cn(
                    t.action === "open" ? "text-brand-cyan" : "text-predict"
                  )}>{t.action === "open" ? "OPEN" : t.action === "close" ? "CLOSE" : "PRT"}</span>
                  <span className="text-slate-500 ml-auto">
                    {t.qty} @ {t.price.toFixed(t.price < 1 ? 5 : 2)}
                  </span>
                  {t.realizedPnl !== null && (
                    <span className={cn("font-bold", t.realizedPnl >= 0 ? "text-bull" : "text-bear")}>
                      {t.realizedPnl >= 0 ? "+" : ""}{t.realizedPnl.toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="text-[9px] font-mono text-slate-700 leading-relaxed border border-terminal-border/40 rounded p-2 bg-terminal-bg/30">
        PAPER TRADING — no real funds. Orders fill instantly at the live feed price. Commission 0.02% per side. Shorts require no margin; proceeds are credited to cash.
      </div>
    </div>
  );
}
