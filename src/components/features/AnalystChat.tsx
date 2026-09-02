import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { analyst, type AnalystKind, type AnalystMessage } from "@/lib/analyst";
import { useTradingStore } from "@/stores/tradingStore";
import { cn } from "@/lib/utils";
import { Brain, CircleCheck, CircleX, Activity, ShieldAlert, Radio, SendHorizontal, Trash2, Gauge, Newspaper } from "lucide-react";

/* ────────────────────────────────────────────────────────────────
 * Ω ANALYST CHAT — the machine explaining itself, live.
 * Renders the autonomous journal: forecasts (why + how), outcomes,
 * training, integrity, uncertainty, market pulses — plus an ask box
 * answered entirely from live model internals (zero network).
 * ──────────────────────────────────────────────────────────────── */

const KIND_META: Record<AnalystKind, { label: string; icon: typeof Brain; color: string; border: string }> = {
  forecast: { label: "FORECAST", icon: Brain, color: "text-brand-cyan", border: "border-l-brand-cyan" },
  outcome: { label: "RESOLVED", icon: CircleCheck, color: "text-bull", border: "border-l-bull" },
  training: { label: "TRAINING", icon: Activity, color: "text-predict", border: "border-l-predict" },
  integrity: { label: "INTEGRITY", icon: ShieldAlert, color: "text-bear", border: "border-l-bear" },
  uncertainty: { label: "GUARD", icon: Gauge, color: "text-predict", border: "border-l-predict" },
  market: { label: "PULSE", icon: Newspaper, color: "text-slate-400", border: "border-l-slate-400/50" },
  system: { label: "SYSTEM", icon: Radio, color: "text-slate-300", border: "border-l-terminal-border" },
};

type Filter = "all" | "forecast" | "outcome" | "system";

function Uptime({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  if (!startedAt) return null;
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    <span className="font-mono text-[10px] text-slate-400">
      {h > 0 ? `${h}h ` : ""}{String(m).padStart(2, "0")}:{String(sec).padStart(2, "0")}
    </span>
  );
}

function MessageCard({ msg }: { msg: AnalystMessage }) {
  const meta = KIND_META[msg.kind];
  const Icon = meta.icon;
  const votes = msg.votes ?? [];
  const drivers = msg.drivers ?? [];
  return (
    <div className={cn("border-l-2 pl-3 py-2 pr-2", meta.border)}>
      <div className="flex items-center gap-2">
        <Icon size={12} className={meta.color} />
        <span className={cn("text-[10px] font-mono font-semibold tracking-wider", meta.color)}>{msg.title}</span>
        <span className="ml-auto font-mono text-[9px] text-slate-500">
          {new Date(msg.t).toLocaleTimeString("en-US", { hour12: false })}
        </span>
      </div>
      <div className="mt-1 space-y-1">
        {msg.body.map((line, i) => (
          <p key={i} className={cn("text-[11px] leading-relaxed text-slate-300", line.startsWith("HOW") && "text-slate-400 border-t border-terminal-border/40 pt-1 mt-1")}>
            {line}
          </p>
        ))}
      </div>
      {votes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {votes.map(v => (
            <span
              key={v.name}
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-mono border",
                v.direction === "up" ? "bg-bull-dark text-bull border-bull/30"
                  : v.direction === "down" ? "bg-bear-dark text-bear border-bear/30"
                  : "bg-terminal-surface text-slate-400 border-terminal-border"
              )}
            >
              {v.name} w={v.weight.toFixed(2)}
            </span>
          ))}
        </div>
      )}
      {drivers.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {drivers.map(d => (
            <div key={d.name} className="flex items-center gap-1.5">
              <span className="w-24 shrink-0 truncate font-mono text-[9px] text-slate-400">{d.name}</span>
              <div className="h-1 flex-1 rounded-full bg-terminal-border/60 relative overflow-hidden">
                <div
                  className={cn("absolute top-0 h-full rounded-full", d.score >= 0 ? "bg-bull" : "bg-bear")}
                  style={{
                    left: d.score >= 0 ? "50%" : `${50 - Math.min(50, Math.abs(d.score) * 50)}%`,
                    width: `${Math.min(50, Math.abs(d.score) * 50)}%`,
                  }}
                />
                <div className="absolute left-1/2 top-0 h-full w-px bg-terminal-border" />
              </div>
              <span className={cn("w-10 text-right font-mono text-[9px]", d.score >= 0 ? "text-bull" : "text-bear")}>
                {d.score >= 0 ? "+" : ""}{d.score.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnalystChat() {
  const messages = useSyncExternalStore(analyst.subscribe, analyst.getMessages);
  const startedAt = analyst.getStartedAt();
  const [filter, setFilter] = useState<Filter>("all");
  const [input, setInput] = useState("");
  const [hovering, setHovering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSymbol = useTradingStore(s => s.activeSymbol);

  const filtered = filter === "all"
    ? messages
    : filter === "system"
      ? messages.filter(m => m.kind === "system" || m.kind === "market" || m.kind === "integrity" || m.kind === "uncertainty" || m.kind === "training")
      : messages.filter(m => m.kind === filter);

  useEffect(() => {
    if (!hovering && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, hovering]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    analyst.pushUserMessage(text);
    analyst.ask(text);
  };

  return (
    <div className="flex h-full flex-col bg-terminal-bg">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-terminal-border px-3 py-2 flex-none">
        <Brain size={13} className="text-brand-cyan" />
        <span className="font-mono text-[11px] font-bold tracking-wider text-slate-200">Ω ANALYST</span>
        <span className="flex items-center gap-1 rounded bg-bull-dark px-1.5 py-0.5 text-[9px] font-mono font-bold text-bull border border-bull/30">
          <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulse-glow" />
          LIVE 24/7
        </span>
        <Uptime startedAt={startedAt} />
        <button
          onClick={() => analyst.clear()}
          title="Clear journal"
          className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 border-b border-terminal-border/60 px-3 py-1.5 flex-none">
        {(["all", "forecast", "outcome", "system"] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-wider transition-colors",
              filter === f ? "bg-terminal-surface text-brand-cyan border border-brand-cyan/40" : "text-slate-500 border border-transparent hover:text-slate-300"
            )}
          >
            {f === "outcome" ? "resolved" : f}
          </button>
        ))}
        <span className="ml-auto font-mono text-[9px] text-slate-500 truncate max-w-16">{activeSymbol}</span>
      </div>

      {/* Stream */}
      <div
        ref={scrollRef}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-2"
      >
        {filtered.length === 0 ? (
          <p className="mt-6 text-center font-mono text-[10px] text-slate-500">
            Journal empty for this filter — the machine narrates as events happen.
          </p>
        ) : (
          filtered.map(m => <MessageCard key={m.id} msg={m} />)
        )}
      </div>

      {/* Ask box */}
      <div className="flex items-center gap-2 border-t border-terminal-border px-3 py-2 flex-none">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Ask: why · how · status · or a symbol…"
          className="flex-1 bg-terminal-surface/60 border border-terminal-border rounded px-2 py-1.5 font-mono text-[10px] text-slate-200 placeholder:text-slate-500 outline-none focus:border-brand-cyan/60"
        />
        <button
          onClick={submit}
          className="btn-terminal flex items-center gap-1"
        >
          <SendHorizontal size={11} />
          Ask
        </button>
      </div>
    </div>
  );
}
