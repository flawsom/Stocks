import { useMemo, useState } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import { runBacktest, DEFAULT_BACKTEST_PARAMS, type BacktestParams, type StrategyId } from "@/lib/backtest";
import { downloadCSV } from "@/lib/export";
import { cn } from "@/lib/utils";
import { FlaskConical, Play, Download, TrendingUp, TrendingDown, Percent, Gauge, Activity, Layers } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from "recharts";

const STRATEGIES: { id: StrategyId; label: string; desc: string }[] = [
  { id: "ma_cross", label: "MA CROSSOVER", desc: "EMA fast × slow — golden/death cross" },
  { id: "rsi_revert", label: "RSI REVERSION", desc: "Fade oversold/overbought extremes" },
  { id: "momentum_break", label: "MOMENTUM BREAK", desc: "Close breaks N-bar high/low" },
];

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #c8d2c8",
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "JetBrains Mono",
  color: "#121613",
};

function NumInput({ label, value, onChange, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; step?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono text-slate-600 uppercase">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-2 py-1 rounded border border-terminal-border bg-terminal-surface text-xs font-mono text-slate-200 outline-none focus:border-brand-cyan/50"
      />
    </label>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded bg-terminal-bg/50 border border-terminal-border/50 py-1.5 px-2">
      <div className="text-[9px] font-mono text-slate-600 uppercase tracking-wide">{label}</div>
      <div className="text-xs font-mono font-bold" style={{ color: color || "#121613" }}>{value}</div>
    </div>
  );
}

export default function StrategyLab() {
  const { activeSymbol, activeTimeframe, candles, candleSource } = useTradingStore();

  const [params, setParams] = useState<BacktestParams>({ ...DEFAULT_BACKTEST_PARAMS });
  const [runId, setRunId] = useState(0);

  const set = <K extends keyof BacktestParams>(key: K, value: BacktestParams[K]) =>
    setParams(p => ({ ...p, [key]: value }));

  const result = useMemo(() => {
    if (runId === 0 || candles.length < 40) return null;
    const tfMap: Record<string, number> = {
      "1min": 60, "5min": 300, "15min": 900, "30min": 1800, "1h": 3600, "4h": 14400, "1day": 86400,
    };
    const sourceNote = candleSource?.provider === "live-aggregate"
      ? "live-built stream (real ticks)"
      : `${candleSource?.provider ?? "provider"} history`;
    return runBacktest(candles, params, tfMap[activeTimeframe] || 900, sourceNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, activeSymbol, activeTimeframe]);

  const activeStrategy = STRATEGIES.find(s => s.id === params.strategy)!;

  const equityData = result?.equityCurve.map(p => ({
    t: new Date(p.t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    equity: Number((p.equity * 100).toFixed(2)),
  })) ?? [];

  const exportTrades = () => {
    if (!result) return;
    downloadCSV(
      `omegatrade-backtest-${activeSymbol}-${params.strategy}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`,
      [
        ["Strategy", params.strategy, "Symbol", activeSymbol, "Timeframe", activeTimeframe, "Fee", `${params.feeRate * 100}%`],
        ["EntryTime", "ExitTime", "Side", "Entry", "Exit", "NetReturn%"],
        ...result.trades.map(t => [
          new Date(t.entryTime * 1000).toISOString(),
          new Date(t.exitTime * 1000).toISOString(),
          t.side, t.entry, t.exit, t.retPct,
        ]),
      ]
    );
  };

  const m = result?.metrics;

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-predict" />
          <span className="text-xs font-mono font-semibold text-predict text-glow-gold">STRATEGY LAB</span>
        </div>
        <span className="text-[9px] font-mono text-slate-600">
          {activeSymbol} · {activeTimeframe}
        </span>
      </div>

      {/* Strategy selector */}
      <div className="flex flex-col gap-1">
        {STRATEGIES.map(s => (
          <button
            key={s.id}
            onClick={() => set("strategy", s.id)}
            className={cn(
              "text-left px-2.5 py-2 rounded border transition-all",
              params.strategy === s.id
                ? "border-predict/40 bg-predict/10"
                : "border-terminal-border bg-terminal-surface/40 hover:border-terminal-borderLight"
            )}
          >
            <div className={cn("text-[11px] font-mono font-bold", params.strategy === s.id ? "text-predict" : "text-slate-300")}>
              {s.label}
            </div>
            <div className="text-[9px] font-mono text-slate-600 mt-0.5">{s.desc}</div>
          </button>
        ))}
      </div>

      {/* Parameters */}
      <div className="terminal-panel p-2.5 grid grid-cols-2 gap-1.5">
        {params.strategy === "ma_cross" && (
          <>
            <NumInput label="Fast EMA" value={params.fast} onChange={v => set("fast", Math.max(2, Math.round(v)))} />
            <NumInput label="Slow EMA" value={params.slow} onChange={v => set("slow", Math.max(3, Math.round(v)))} />
          </>
        )}
        {params.strategy === "rsi_revert" && (
          <>
            <NumInput label="RSI Buy <" value={params.rsiLow} onChange={v => set("rsiLow", Math.min(50, v))} />
            <NumInput label="RSI Sell >" value={params.rsiHigh} onChange={v => set("rsiHigh", Math.max(50, v))} />
          </>
        )}
        {params.strategy === "momentum_break" && (
          <NumInput label="Lookback bars" value={params.lookback} onChange={v => set("lookback", Math.max(2, Math.round(v)))} />
        )}
        <NumInput label="Fee %" value={Number((params.feeRate * 100).toFixed(3))} step={0.01} onChange={v => set("feeRate", v / 100)} />
        <label className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            checked={params.allowShort}
            onChange={e => set("allowShort", e.target.checked)}
            className="accent-[#16a034]"
          />
          <span className="text-[10px] font-mono text-slate-400">Allow shorts</span>
        </label>
      </div>

      {/* Run */}
      <button
        onClick={() => setRunId(r => r + 1)}
        disabled={candles.length < 40}
        className="flex items-center justify-center gap-2 py-2.5 rounded text-xs font-mono font-bold bg-predict text-terminal-bg hover:bg-predict-dim transition-colors shadow-gold-glow disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Play size={12} /> RUN BACKTEST ON {candles.length} REAL BARS
      </button>
      {candles.length < 40 && (
        <div className="text-[9px] font-mono text-slate-600 text-center -mt-1">
          Need ≥ 40 candles in the chart series ({activeSymbol} · {candleSource?.provider ?? "live"})
        </div>
      )}

      {result && m && (
        <>
          {result.trades.length === 0 && (
            <div className="text-[10px] font-mono text-predict/90 bg-predict/10 border border-predict/30 rounded px-2.5 py-2">
              ⚠ No signals in this window — {activeStrategy.label} found no setup across {result.bars} real bars.
              Try another strategy, a shorter timeframe, or lower thresholds.
            </div>
          )}
          {/* Metrics */}
          <div className="grid grid-cols-2 gap-1.5">
            <Metric
              label="Strategy"
              value={`${m.totalReturn >= 0 ? "+" : ""}${m.totalReturn.toFixed(2)}%`}
              color={m.totalReturn >= 0 ? "#0a9c36" : "#d43b36"}
            />
            <Metric
              label="Buy & hold"
              value={`${m.buyHoldReturn >= 0 ? "+" : ""}${m.buyHoldReturn.toFixed(2)}%`}
              color={m.buyHoldReturn >= 0 ? "#0a9c36" : "#d43b36"}
            />
            <Metric label="Max drawdown" value={`−${m.maxDrawdown.toFixed(2)}%`} color="#d43b36" />            <Metric
              label="Win rate"
              value={`${m.winRate.toFixed(0)}% · ${m.tradeCount} trades`} color="#a16207"
            />
            <Metric label="Profit factor" value={m.profitFactor >= 99 ? "∞" : m.profitFactor.toFixed(2)} color="#16a034" />
            <Metric label="Sharpe (yr)" value={m.sharpe.toFixed(2)} color={m.sharpe >= 1 ? "#0a9c36" : "#55635a"} />
          </div>

          {/* Equity curve */}
          <div className="terminal-panel p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                <TrendingUp size={10} /> EQUITY CURVE
              </span>
              <span className="text-[9px] font-mono text-slate-600">normalized to 100</span>
            </div>
            <ResponsiveContainer width="100%" height={90}>
              <AreaChart data={equityData} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
                <defs>
                  <linearGradient id="btGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a16207" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#a16207" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e4ebe2" />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} interval={4} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toFixed(2), "Equity"]} />
                <ReferenceLine y={100} stroke="#c8d2c8" strokeDasharray="2 2" />
                <Area type="monotone" dataKey="equity" stroke="#a16207" strokeWidth={1.5} fill="url(#btGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Trade list */}
          <div className="terminal-panel p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Layers size={10} className="text-slate-500" />
              <span className="text-xs font-mono text-slate-500">TRADES</span>
              <button
                onClick={exportTrades}
                className="ml-auto flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-brand-cyan transition-colors"
              >
                <Download size={9} /> CSV
              </button>
            </div>
            <div className="space-y-0.5 max-h-36 overflow-y-auto">
              {result.trades.slice(-12).reverse().map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono border-b border-terminal-border/30 last:border-0 py-1">
                  {t.side === "long" ? <TrendingUp size={9} className="text-bull shrink-0" /> : <TrendingDown size={9} className="text-bear shrink-0" />}
                  <span className="text-slate-600 shrink-0">
                    {new Date(t.entryTime * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                  <span className="text-slate-400">{t.side.toUpperCase()}</span>
                  <span className="text-slate-600 ml-auto">{t.entry.toFixed(2)} → {t.exit.toFixed(2)}</span>
                  <span className={cn("font-bold", t.retPct >= 0 ? "text-bull" : "text-bear")}>
                    {t.retPct >= 0 ? "+" : ""}{t.retPct.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="text-[9px] font-mono text-slate-700 leading-relaxed border border-terminal-border/40 rounded p-2 bg-terminal-bg/30">
            {activeStrategy.label} on {result.bars} bars ({result.dataSourceNote}) · fee {(params.feeRate * 100).toFixed(2)}%/side ·
            exposure {m.exposure.toFixed(0)}% · avg trade {m.avgTrade >= 0 ? "+" : ""}{m.avgTrade.toFixed(2)}% ·
            annualized Sharpe uses {(m.periodsPerYear).toLocaleString()} periods/yr.
          </div>
        </>
      )}
    </div>
  );
}
