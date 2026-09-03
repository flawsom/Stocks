import { useTradingStore } from "@/stores/tradingStore";
import { usePortfolioStore } from "@/stores/portfolioStore";
import { Brain, Zap, Target, RefreshCw, CheckCircle2, XCircle, Clock, Layers, Flame, Cpu, Gauge, TrendingUp, Activity, ArrowUpRight, ArrowDownRight, ShieldCheck, Lock } from "lucide-react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, Cell } from "recharts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ML_CONFIG } from "@/constants/config";
import type { PredictionOutcome } from "@/types";

const dirColorOf = (dir?: string) =>
  dir === "up" ? "#0a9c36" : dir === "down" ? "#d43b36" : "#55635a";

function ModelVoteRow({ name, direction, confidence, probability, weight, samples }: {
  name: string; direction: string; confidence: number; probability: number; weight: number; samples: number;
}) {
  const color = dirColorOf(direction);
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs font-mono text-slate-500 w-[4.2rem] shrink-0 truncate" title={name}>{name}</span>
      <div className="flex-1 h-2 bg-terminal-border/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(4, probability * 100)}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
          }}
        />
      </div>
      <span className="text-xs font-mono font-bold w-8 text-right" style={{ color }}>{direction.toUpperCase()}</span>
      <span className="text-[10px] font-mono text-slate-500 text-right">{weight.toFixed(2)}w</span>
      <span className="text-[9px] font-mono text-slate-400 w-8 text-right" title="verified outcomes this weight is based on">×{samples}</span>
    </div>
  );
}

function OutcomesList() {
  const { outcomes, activeSymbol } = useTradingStore();
  const rows = outcomes.filter(o => o.symbol === activeSymbol).slice(0, 6);

  if (rows.length === 0) {
    return (
      <div className="text-xs font-mono text-slate-600 py-1">
        No verified predictions yet — outcomes appear after the forecast horizon elapses.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map(o => {
        const t = new Date(o.createdAt);
        const time = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
        const status = o.hit === null
          ? (<span className="flex items-center gap-1 text-slate-500"><Clock size={9} /> pending</span>)
          : o.hit
            ? (<span className="flex items-center gap-1 text-bull"><CheckCircle2 size={9} /> HIT</span>)
            : (<span className="flex items-center gap-1 text-bear"><XCircle size={9} /> MISS</span>);
        return (
          <div key={o.id} className="flex items-center justify-between text-xs font-mono px-2 py-1 rounded bg-terminal-bg/40 border border-terminal-border/40">
            <span className="text-slate-600">{time}</span>
            <span className="font-bold" style={{ color: dirColorOf(o.direction) }}>{o.direction.toUpperCase()}</span>
            <span className="text-slate-500">{o.confidence}%</span>
            {o.hit !== null && o.actualPrice !== null && (
              <span className="text-slate-500">→ {o.actualPrice.toFixed(o.actualPrice < 1 ? 5 : 2)}</span>
            )}
            {status}
          </div>
        );
      })}
    </div>
  );
}

/** Forecast-vs-actual bar chart over resolved outcomes (predicted % vs realized %). */
function TrackRecordChart({ rows }: { rows: PredictionOutcome[] }) {
  if (rows.length === 0) {
    return <div className="text-xs font-mono text-slate-600 py-2">Waiting for verified outcomes…</div>;
  }
  const data = rows.slice(0, 12).reverse().map((o, i) => {
    const predPct = o.direction === "up"
      ? Math.abs(((o.targetPrice - o.currentPrice) / o.currentPrice) * 100)
      : o.direction === "down"
        ? -Math.abs(((o.targetPrice - o.currentPrice) / o.currentPrice) * 100)
        : 0;
    const actualPct = o.actualPrice ? ((o.actualPrice - o.currentPrice) / o.currentPrice) * 100 : 0;
    const t = new Date(o.createdAt);
    return {
      name: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
      pred: Number(predPct.toFixed(3)),
      actual: Number(actualPct.toFixed(3)),
      hit: o.hit,
    };
  });

  return (
    <div>
      <ResponsiveContainer width="100%" height={70}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: -32, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} interval={1} />
          <YAxis tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} />
          <Tooltip
            contentStyle={{ background: "#ffffff", border: "1px solid #c8d2c8", borderRadius: 4, fontSize: 10, fontFamily: "JetBrains Mono", color: "#121613" }}
            formatter={(v: number, n: string) => [`${v}%`, n === "pred" ? "Forecast" : "Actual"]}
          />
          <Bar dataKey="pred" fill="#7c3aed66" radius={[2, 2, 0, 0]} barSize={6} />
          <Bar dataKey="actual" barSize={6} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.hit ? "#0a9c36" : "#d43b36"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-3 text-[9px] font-mono text-slate-600">
        <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-sm bg-[#7c3aed66]" /> Forecast</span>
        <span className="flex items-center gap-1"><span className="w-2 h-1.5 rounded-sm bg-bull" /> Realized (green = hit)</span>
      </div>
    </div>
  );
}

/** EyeQuant safety systems: MC-dropout uncertainty, EWC memory lock, integrity audit, XAI. */
function SafetySystems() {
  const { uncertainty, integrity, circuitBreaker, integrityFault, mlStats, prediction } = useTradingStore();
  const statusColor =
    uncertainty?.status === "circuit" ? "#d43b36" :
    uncertainty?.status === "elevated" ? "#a16207" :
    "#0a9c36";
  const statusLabel = uncertainty?.status ? uncertainty.status.toUpperCase() : "—";
  const std = uncertainty?.std ?? 0;
  const circuitThresh = uncertainty?.thresholdCircuit ?? ML_CONFIG.UNCERTAINTY_CIRCUIT;
  const arc = Math.min(100, (std / circuitThresh) * 75.4);

  return (
    <div className="terminal-panel p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
          <ShieldCheck size={10} /> SAFETY SYSTEMS
        </span>
        <div className="flex gap-1">
          {circuitBreaker && (
            <span className="text-[9px] font-mono font-bold text-bear bg-bear/15 px-1.5 py-0.5 rounded border border-bear/40">BREAKER</span>
          )}
          {integrityFault && (
            <span className="text-[9px] font-mono font-bold text-predict bg-predict/15 px-1.5 py-0.5 rounded border border-predict/40">DE-SYNC</span>
          )}
        </div>
      </div>

      {/* MC-dropout epistemic uncertainty gauge */}
      <div className="flex items-center gap-2">
        <div className="relative w-16 h-8 flex-none">
          <svg viewBox="0 0 64 32" className="w-full h-full">
            <path d="M 8 28 A 24 24 0 0 1 56 28" fill="none" stroke="#c8d2c8" strokeWidth="4" />
            <path d="M 8 28 A 24 24 0 0 1 56 28" fill="none" stroke={statusColor} strokeWidth="4" strokeDasharray={`${arc} 75.4`} style={{ filter: `drop-shadow(0 0 3px ${statusColor}66)` }} />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-xs font-mono font-bold" style={{ color: statusColor }}>σ = {std.toFixed(4)}</div>
          <div className="text-[9px] font-mono text-slate-600">MC DROPOUT · {uncertainty?.mcPasses ?? 0} PASSES</div>
        </div>
        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ color: statusColor, borderColor: `${statusColor}40`, backgroundColor: `${statusColor}12` }}>
          {statusLabel}
        </span>
      </div>
      <div className="flex justify-between text-[9px] font-mono text-slate-600">
        <span>elevated &gt; {uncertainty?.thresholdElevated?.toFixed(2) ?? ML_CONFIG.UNCERTAINTY_ELEVATED.toFixed(2)}</span>
        <span>circuit &gt; {circuitThresh.toFixed(2)}</span>
      </div>

      {/* EWC memory lock */}
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="flex items-center gap-1.5 text-slate-500"><Lock size={9} /> EWC MEMORY</span>
        <span className={mlStats?.ewcLocked ? "text-bull" : "text-slate-600"}>
          {mlStats?.ewcLocked ? `LOCKED λ=${ML_CONFIG.EWC_LAMBDA}` : "arming on first train"}
        </span>
      </div>

      {/* Cross-modal integrity audit */}
      {integrity && (
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="flex items-center gap-1.5 text-slate-500"><Activity size={9} /> INTEGRITY</span>
          <span style={{ color: integrity.verdict === "ok" ? "#0a9c36" : integrity.verdict === "degraded" ? "#a16207" : "#d43b36" }}>
            {integrity.verdict.toUpperCase()} · {integrity.sources.length} src · Δ{integrity.maxDevPct.toFixed(3)}%
          </span>
        </div>
      )}

      {/* Grad-CAM-style attribution summary */}
      {prediction && prediction.attributionSummary.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-600 mb-1">
            <Flame size={8} /> WHY — TOP CONTRIBUTORS
          </div>
          <div className="flex flex-wrap gap-1">
            {prediction.attributionSummary.map(a => (
              <span key={a.name} className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                style={{ color: a.score >= 0 ? "#0a9c36" : "#d43b36", borderColor: (a.score >= 0 ? "#0a9c36" : "#d43b36") + "40", backgroundColor: (a.score >= 0 ? "#0a9c36" : "#d43b36") + "12" }}>
                {a.name} {a.score >= 0 ? "+" : ""}{a.score.toFixed(2)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Kind badge colors for the prediction journal. */
const kindStyle: Record<string, string> = {
  signal: "#0a9c36",
  scan: "#516254",
  verdict: "#16a034",
  learn: "#a16207",
  guard: "#d43b36",
};

/** The 24/7 live prediction journal — what the model decided, why, and how. */
function PredictionJournal() {
  const { mlStats } = useTradingStore();
  const events = mlStats?.decisionEvents ?? [];

  return (
    <div className="terminal-panel p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Cpu size={10} className="text-brand-cyan" />
        <span className="text-xs font-mono text-slate-500">PREDICTION LOG</span>
        <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-bull">
          <span className="indicator-dot bg-bull" /> LIVE 24/7
        </span>
      </div>
      {events.length === 0 ? (
        <div className="text-xs font-mono text-slate-600 py-1">
          Journal boots with the first live forecast — what / why / how on every cycle.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-44 overflow-y-auto">
          {events.slice(-14).reverse().map((e, i) => (
            <div key={`${e.t}-${i}`} className="flex items-start gap-2 text-[10px] font-mono">
              <span className="text-slate-600 shrink-0">
                {new Date(e.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
              </span>
              <span className="shrink-0 font-bold" style={{ color: kindStyle[e.kind] ?? "#516254" }}>
                [{e.kind.toUpperCase()}]
              </span>
              <div className="min-w-0">
                <div className="text-slate-400 leading-tight">{e.headline}</div>
                <div className="text-slate-600 leading-tight">why: {e.why}</div>
                <div className="text-slate-600 leading-tight">how: {e.how}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {mlStats && mlStats.hardExamples > 0 && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono text-bear/80">
          <Flame size={9} />
          {mlStats.hardExamples} failed windows retained for failure-driven retraining
        </div>
      )}
    </div>
  );
}
/** Execute a $1,000-notional paper order in the given direction at the live price. */
function tradeOnSignal(side: "long" | "short") {
  const state = useTradingStore.getState();
  const price = state.watchlist.find(w => w.symbol === state.activeSymbol)?.price;
  if (!price || price <= 0) {
    toast("No live price available yet");
    return;
  }
  const qty = 1000 / price;
  const res = usePortfolioStore.getState().openPosition(state.activeSymbol, side, qty, price);
  if (res.ok) {
    toast.success(
      `Paper fill · ${side.toUpperCase()} ${state.activeSymbol} ${qty.toFixed(4)} @ ${price.toFixed(price < 1 ? 5 : 2)}`
    );
  } else {
    toast.error(res.error || "Order rejected");
  }
}

export default function MLPredictionPanel() {
  const { prediction, mlStats, activeSymbol, liveCandles, outcomes } = useTradingStore();

  const dirColor = dirColorOf(prediction?.direction);
  const resolvedRows = outcomes.filter(o => o.symbol === activeSymbol && o.resolvedAt !== null);
  const chartTooltipStyle = {
    background: "#ffffff",
    border: "1px solid #c8d2c8",
    borderRadius: 4,
    fontSize: 10,
    fontFamily: "JetBrains Mono",
    color: "#121613",
  };

  const pnlData = (mlStats?.pnlSeries || []).map(p => ({
    t: new Date(p.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    signal: Number(p.signal.toFixed(2)),
    buyHold: Number(p.buyHold.toFixed(2)),
  }));

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-neural" />
          <span className="text-xs font-mono font-semibold text-neural text-glow-purple">
            OmegaPredict AI
          </span>
        </div>
        {mlStats?.isTraining ? (
          <div className="flex items-center gap-1.5">
            <RefreshCw size={10} className="text-neural animate-spin" />
            <span className="text-xs font-mono text-neural">Training...</span>
          </div>
        ) : (
          <div className="live-indicator">
            <div className="indicator-dot bg-bull" />
            <span className="text-slate-400">LIVE</span>
          </div>
        )}
      </div>

      {/* Ensemble + engine stats */}
      <div className="terminal-panel p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
            <Layers size={10} /> ENSEMBLE
          </span>
          <span className="text-xs font-mono text-neural">{mlStats?.modelCount ?? 7} models</span>
        </div>
        <div className="grid grid-cols-4 gap-1 text-center">
          <div className="rounded bg-terminal-bg/50 border border-terminal-border/50 py-1">
            <div className="text-xs font-mono font-semibold text-slate-200">{mlStats?.trainingEpoch ?? 0}</div>
            <div className="text-[9px] font-mono text-slate-600">EPOCHS</div>
          </div>
          <div className="rounded bg-terminal-bg/50 border border-terminal-border/50 py-1">
            <div className="text-xs font-mono font-semibold text-neural">{mlStats?.hardExamples ?? 0}</div>
            <div className="text-[9px] font-mono text-slate-600">HARD</div>
          </div>
          <div className="rounded bg-terminal-bg/50 border border-terminal-border/50 py-1">
            <div className="text-xs font-mono font-semibold text-slate-200">
              {mlStats?.lastInferenceMs?.toFixed(0) ?? "—"}
            </div>
            <div className="text-[9px] font-mono text-slate-600">INFER ms</div>
          </div>
          <div className="rounded bg-terminal-bg/50 border border-terminal-border/50 py-1">
            <div className="text-xs font-mono font-semibold text-brand-cyan">{mlStats?.retrainCount ?? 0}</div>
            <div className="text-[9px] font-mono text-slate-600">RETRAINS</div>
          </div>
        </div>
        {mlStats && (
          <div className="flex justify-between text-xs font-mono text-slate-600 pt-1">
            <span>LR {mlStats.learningRate.toExponential(1)}</span>
            <span>Loss {mlStats.loss.toFixed(5)}</span>
          </div>
        )}
      </div>

      {/* EyeQuant safety systems */}
      <SafetySystems />

      {/* Accuracy gauge + walk-forward */}
      <div className="grid grid-cols-2 gap-2">
        <div className="terminal-panel p-3 flex items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <div className="relative w-20 h-10 overflow-hidden">
              <svg viewBox="0 0 80 40" className="w-full h-full">
                <path d="M 10 40 A 30 30 0 0 1 70 40" fill="none" stroke="#c8d2c8" strokeWidth="6" />
                <path
                  d="M 10 40 A 30 30 0 0 1 70 40"
                  fill="none"
                  stroke={(mlStats?.accuracy ?? 0) >= 60 ? "#0a9c36" : (mlStats?.accuracy ?? 0) >= 45 ? "#a16207" : "#d43b36"}
                  strokeWidth="6"
                  strokeDasharray={`${((mlStats?.accuracy ?? 0) / 100) * 94.2} 94.2`}
                  style={{ filter: "drop-shadow(0 0 4px #0a9c3644)" }}
                />
              </svg>
            </div>
            <span className="text-lg font-mono font-bold" style={{ color: (mlStats?.accuracy ?? 0) >= 60 ? "#0a9c36" : (mlStats?.accuracy ?? 0) >= 45 ? "#a16207" : "#d43b36" }}>
              {(mlStats?.accuracy ?? 0).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-500 font-mono">verified accuracy</span>
          </div>
        </div>
        <div className="terminal-panel p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Gauge size={10} className="text-brand-cyan" />
            <span className="metric-label" style={{ fontSize: 9 }}>WALK-FORWARD</span>
          </div>
          <div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-500">Model</span>
              <span className="font-semibold text-brand-cyan">
                {mlStats?.wfAccuracy ? `${mlStats.wfAccuracy.toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-500">Baseline</span>
              <span className="font-semibold text-slate-400">
                {mlStats?.wfBaseline ? `${mlStats.wfBaseline.toFixed(1)}%` : "—"}
              </span>
            </div>
          </div>
          <div>
            <div className="metric-label" style={{ fontSize: 9 }}>BRIER</div>
            <div className="text-xs font-mono font-semibold text-slate-200">
              {mlStats?.brierScore ? mlStats.brierScore.toFixed(4) : "—"}
            </div>
          </div>
          <div>
            <div className="metric-label" style={{ fontSize: 9 }}>ACCURACY 24H</div>
            <div className="text-sm font-mono font-semibold" style={{ color: (mlStats?.accuracy24h ?? 0) >= 60 ? "#0a9c36" : "#d43b36" }}>
              {mlStats?.accuracy24h?.toFixed(1) ?? "—"}%
            </div>
          </div>
        </div>
      </div>

      {/* Signal P&L vs buy & hold */}
      {mlStats && mlStats.pnlSeries.length > 1 && (
        <div className="terminal-panel p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
              <TrendingUp size={10} /> SIGNAL P&L
            </span>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className={mlStats.signalReturn >= 0 ? "text-bull" : "text-bear"}>
                Sig {mlStats.signalReturn >= 0 ? "+" : ""}{mlStats.signalReturn.toFixed(2)}%
              </span>
              <span className="text-slate-500">Hold {mlStats.buyHoldReturn >= 0 ? "+" : ""}{mlStats.buyHoldReturn.toFixed(2)}%</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={58}>
            <LineChart data={pnlData} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
              <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} interval={4} />
              <YAxis tick={{ fontSize: 8, fill: "#516254", fontFamily: "JetBrains Mono" }} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <ReferenceLine y={0} stroke="#c8d2c8" />
              <Line type="monotone" dataKey="signal" stroke="#16a034" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="buyHold" stroke="#516254" strokeWidth={1.2} strokeDasharray="3 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-3 text-[9px] font-mono text-slate-600">
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-brand-cyan" /> Signal</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-slate-500" style={{ borderTop: "1px dashed #516254", height: 0 }} /> Buy &amp; hold</span>
          </div>
        </div>
      )}

      {/* Current prediction */}
      {prediction ? (
        <div className="terminal-panel p-3 border" style={{ borderColor: `${dirColor}44`, boxShadow: `0 0 12px ${dirColor}15` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target size={12} style={{ color: dirColor }} />
              <span className="text-xs font-mono text-slate-400">NEXT SIGNAL</span>
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${dirColor}20`, color: dirColor, border: `1px solid ${dirColor}40` }}>
              {prediction.method}
            </span>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xl font-mono font-bold" style={{ color: dirColor, textShadow: `0 0 10px ${dirColor}60` }}>
                {prediction.direction.toUpperCase()}
              </div>
              <div className="text-xs font-mono text-slate-500">
                {prediction.priceChange >= 0 ? "+" : ""}{prediction.priceChange.toFixed(4)} ({prediction.priceChangePct >= 0 ? "+" : ""}{prediction.priceChangePct.toFixed(3)}%)
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-slate-600">TARGET</div>
              <div className="text-sm font-mono font-bold" style={{ color: dirColor }}>{prediction.targetPrice.toFixed(4)}</div>
              <div className="text-xs font-mono text-slate-600">from {prediction.currentPrice.toFixed(4)}</div>
            </div>
          </div>

          {/* Multi-horizon path */}
          {prediction.horizons.length > 0 && (
            <div className="grid grid-cols-3 gap-1 mb-3">
              {prediction.horizons.map(h => (
                <div key={h.h} className="rounded bg-terminal-bg/60 border border-terminal-border/50 px-1.5 py-1 text-center">
                  <div className="text-[9px] font-mono text-slate-600">T+{h.h}</div>
                  <div className="text-[11px] font-mono font-semibold" style={{ color: dirColor }}>{h.target.toFixed(4)}</div>
                  <div className="text-[9px] font-mono text-slate-500">{h.changePct >= 0 ? "+" : ""}{h.changePct.toFixed(3)}%</div>
                </div>
              ))}
            </div>
          )}

          {/* Confidence bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs font-mono text-slate-600 mb-1">
              <span>Confidence</span>
              <span>{prediction.confidence}%</span>
            </div>
            <div className="h-1.5 bg-terminal-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${prediction.confidence}%`, background: `linear-gradient(90deg, ${dirColor}88, ${dirColor})`, boxShadow: `0 0 6px ${dirColor}60` }}
              />
            </div>
          </div>

          {/* One-click paper execution */}
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <button
              onClick={() => tradeOnSignal("long")}
              className={cn(
                "flex items-center justify-center gap-1.5 py-2 rounded text-[11px] font-mono font-bold transition-all",
                prediction.direction === "up"
                  ? "bg-bull text-terminal-bg hover:bg-bull-dim shadow-green-glow"
                  : "bg-bull/10 text-bull border border-bull/30 hover:bg-bull/20"
              )}
            >
              <ArrowUpRight size={11} /> TRADE LONG $1K
            </button>
            <button
              onClick={() => tradeOnSignal("short")}
              className={cn(
                "flex items-center justify-center gap-1.5 py-2 rounded text-[11px] font-mono font-bold transition-all",
                prediction.direction === "down"
                  ? "bg-bear text-terminal-bg hover:bg-bear-dim shadow-red-glow"
                  : "bg-bear/10 text-bear border border-bear/30 hover:bg-bear/20"
              )}
            >
              <ArrowDownRight size={11} /> TRADE SHORT $1K
            </button>
          </div>

          {/* Model votes */}
          <div className="mb-1 flex items-center gap-1.5">
            <Zap size={10} className="text-slate-500" />
            <span className="text-xs font-mono text-slate-500">MODEL VOTES · WEIGHTED</span>
            <span className="text-[9px] font-mono text-slate-400 ml-auto">{prediction.votes.reduce((a, v) => a + (v.samples || 0), 0)} VERIFIED</span>
          </div>
          {prediction.votes.map(v => (
            <ModelVoteRow key={v.name} name={v.name} direction={v.direction} confidence={v.confidence} probability={v.probability} weight={v.weight} samples={v.samples || 0} />
          ))}
        </div>
      ) : (
        <div className="terminal-panel p-4 flex flex-col items-center gap-2 text-center">
          <Brain size={20} className="text-neural/40" />
          <span className="text-xs font-mono text-slate-600">
            {mlStats?.isTraining ? "Training ensemble on live data..." : "Collecting live candles for first forecast..."}
          </span>
          {!mlStats?.isTraining && (
            <>
              <div className="w-full h-1.5 bg-terminal-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (liveCandles / 12) * 100)}%`,
                    background: "linear-gradient(90deg, #16a03488, #16a034)",
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-600">
                {Math.min(liveCandles, 12)}/12 live candles · model primed, forecasting when window is full
              </span>
            </>
          )}
        </div>
      )}

      {/* Track record (forecast vs realized) */}
      <div className="terminal-panel p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Activity size={10} className="text-slate-500" />
          <span className="text-xs font-mono text-slate-500">TRACK RECORD</span>
          <span className="text-[9px] font-mono text-slate-600 ml-auto">forecast vs realized %</span>
        </div>
        <TrackRecordChart rows={resolvedRows} />
      </div>

      {/* Rolling accuracy */}
      {mlStats && mlStats.rollingAccuracy.length > 3 && (
        <div className="terminal-panel p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-slate-500">ROLLING ACCURACY</span>
            <span className="text-xs font-mono text-slate-600">last {mlStats.rollingAccuracy.length}</span>
          </div>
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={mlStats.rollingAccuracy.map(p => ({ t: new Date(p.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }), v: p.v }))} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#516254", fontFamily: "JetBrains Mono" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#516254", fontFamily: "JetBrains Mono" }} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <ReferenceLine y={50} stroke="#c8d2c8" strokeDasharray="2 2" />
              <Area type="monotone" dataKey="v" stroke="#7c3aed" strokeWidth={1.5} fill="#7c3aed11" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Loss curve */}
      {mlStats && mlStats.lossSeries.length > 2 && (
        <div className="terminal-panel p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-slate-500">TRAINING LOSS</span>
            <span className="text-xs font-mono text-neural">{mlStats.loss.toFixed(6)}</span>
          </div>
          <ResponsiveContainer width="100%" height={50}>
            <LineChart data={mlStats.lossSeries.map(p => ({ t: new Date(p.t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }), v: p.v }))} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#516254", fontFamily: "JetBrains Mono" }} />
              <YAxis tick={{ fontSize: 9, fill: "#516254", fontFamily: "JetBrains Mono" }} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Line type="monotone" dataKey="v" stroke="#7c3aed" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Verified outcomes */}
      <div className="terminal-panel p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <CheckCircle2 size={10} className="text-slate-500" />
          <span className="text-xs font-mono text-slate-500">VERIFIED OUTCOMES</span>
        </div>
        <OutcomesList />
      </div>

      {/* Prediction journal — live 24/7 what/why/how */}
      <PredictionJournal />
    </div>
  );
}
