import { useTradingStore } from "@/stores/tradingStore";
import type { MLPrediction, MLModelStats, ModelVote, TrainEvent } from "@/types";

/* ────────────────────────────────────────────────────────────────
 * Ω AUTONOMOUS ANALYST — the machine narrating itself, 24/7.
 *
 * A headless journal (module singleton) that watches the live
 * trading store and, in plain language, explains:
 *   • WHY each forecast was made (model votes, feature drivers,
 *     ensemble agreement, MC-dropout uncertainty)
 *   • HOW it was made (the full pipeline, step by step)
 *   • WHAT happened when forecasts resolve (HIT/MISS + what the
 *     machine does next: hard-example mining, weight updates)
 *   • System health: training runs, integrity audits, uncertainty
 *     guard transitions, and periodic market pulses.
 *
 * Zero network calls, zero cost — every sentence is derived from
 * real model internals. It starts with the app and keeps narrating
 * on every route, for as long as the tab is open.
 * ──────────────────────────────────────────────────────────────── */

export type AnalystKind =
  | "forecast"
  | "outcome"
  | "training"
  | "integrity"
  | "uncertainty"
  | "market"
  | "system";

export interface AnalystMessage {
  id: string;
  t: number;
  kind: AnalystKind;
  symbol?: string;
  title: string;
  body: string[];
  /** For forecast messages: per-model votes (name · direction · weight) */
  votes?: ModelVote[];
  /** For forecast messages: top signed feature drivers */
  drivers?: { name: string; score: number }[];
  agreement?: number;
  confidence?: number;
  uncertainty?: number;
}

const MAX_MESSAGES = 200;
const STORE_KEY = "omegatrade-analyst-v1";
const POLL_MS = 3_000;
const MARKET_PULSE_MS = 120_000;

const MODEL_DESCRIPTIONS: Record<string, string> = {
  "MLP-1": "dense network, ReLU layers",
  "MLP-2": "wider network, dropout regularised",
  "MLP-3": "deep network, momentum-aware inputs",
  LogReg: "logistic regression baseline",
  kNN: "k-nearest pattern matcher",
  GBT: "gradient-boosted trees",
  Momentum: "momentum / mean-reversion rule",
};

function modelDesc(name: string): string {
  return MODEL_DESCRIPTIONS[name] ?? "ensemble member";
}

function fmt(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pct(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function clockAt(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour12: false });
}

class AnalystJournal {
  private messages: AnalystMessage[] = [];
  private listeners = new Set<() => void>();
  private snapshot: AnalystMessage[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private lastPredictionKey = "";
  private lastEventKey = "";
  private lastIntegrityVerdict = "";
  private lastUncertaintyStatus = "";
  private nextId = 1;

  constructor() {
    this.restore();
  }

  /* ── React external-store surface ──────────────────────────── */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getMessages = (): AnalystMessage[] => this.snapshot;

  getStartedAt = (): number => this.startedAt;

  private emit() {
    this.snapshot = [...this.messages];
    this.listeners.forEach(l => l());
    this.persist();
  }

  private push(msg: Omit<AnalystMessage, "id" | "t"> & { t?: number }) {
    this.messages = [
      ...this.messages.slice(-(MAX_MESSAGES - 1)),
      { ...msg, id: `a${this.nextId++}`, t: msg.t ?? Date.now() } as AnalystMessage,
    ];
    this.emit();
  }

  private restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { messages: AnalystMessage[]; nextId: number };
        this.messages = (parsed.messages ?? []).slice(-MAX_MESSAGES);
        this.nextId = parsed.nextId ?? this.messages.length + 1;
      }
    } catch { /* corrupted state — start fresh */ }
    this.snapshot = [...this.messages];
  }

  private persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ messages: this.messages.slice(-100), nextId: this.nextId })
      );
    } catch { /* storage full / unavailable */ }
  }

  clear() {
    this.messages = [];
    this.emit();
  }

  /* ── Boot: 24/7 watching ───────────────────────────────────── */
  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.push({
      kind: "system",
      title: "ANALYST ONLINE",
      body: [
        `Autonomous reasoning journal started at ${clockAt(this.startedAt)}. I watch every live feed, every forecast, every resolution — and narrate why and how each one was made, non-stop.`,
        "Ask me things in the box below: “why”, “how”, “status”, or type a symbol (e.g. AAPL) to switch desks.",
      ],
    });

    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.pulseTimer = setInterval(() => this.marketPulse(), MARKET_PULSE_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.timer = null;
    this.pulseTimer = null;
  }

  /* ── Per-poll watcher ──────────────────────────────────────── */
  private tick() {
    const s = useTradingStore.getState();
    if (s.prediction) this.watchPrediction(s.prediction);
    if (s.mlStats) this.watchEvents(s.mlStats);
    this.watchIntegrity(s.integrity);
    this.watchUncertainty(s.uncertainty);
  }

  private watchPrediction(p: MLPrediction) {
    const key = `${p.symbol}:${p.timestamp}`;
    if (key === this.lastPredictionKey) return;
    this.lastPredictionKey = key;
    this.narrateForecast(p);
  }

  private watchEvents(stats: MLModelStats) {
    const events: TrainEvent[] = stats.trainEvents ?? [];
    const last = events[events.length - 1];
    if (!last) return;
    const key = `${last.t}:${last.note}`;
    if (key === this.lastEventKey) {
      // Multiple new events may arrive between polls; walk backwards over unseen ones.
    }
    // Replay any events newer than the last seen one.
    const seenIdx = events.findIndex(e => `${e.t}:${e.note}` === this.lastEventKey);
    const fresh = seenIdx === -1 ? events.slice(-3) : events.slice(seenIdx + 1);
    this.lastEventKey = key;
    for (const e of fresh) this.narrateEvent(e);
  }

  private watchIntegrity(report: { verdict: string; maxDevPct: number; sources: { name: string }[] } | null) {
    if (!report) return;
    const verdict = report.verdict;
    if (verdict === this.lastIntegrityVerdict) return;
    const prev = this.lastIntegrityVerdict;
    this.lastIntegrityVerdict = verdict;
    if (verdict === "de-sync") {
      this.push({
        kind: "integrity",
        title: `DATA DE-SYNC · ${report.sources.length} sources diverge ${report.maxDevPct.toFixed(2)}%`,
        body: [
          `Independent providers disagree beyond the 1% threshold on the active symbol. I paused autonomous ML updates so a bad quote can't teach me nonsense — training resumes the moment quotes re-converge.`,
        ],
      });
    } else if (verdict === "ok" && prev === "de-sync") {
      this.push({
        kind: "integrity",
        title: "INTEGRITY RESTORED",
        body: ["Provider quotes re-converged. The de-sync circuit released — forecasts and auto-training are live again."],
      });
    }
  }

  private watchUncertainty(u: { status: string; std: number; mcPasses: number } | null) {
    if (!u) return;
    if (u.status === this.lastUncertaintyStatus) return;
    const prev = this.lastUncertaintyStatus;
    this.lastUncertaintyStatus = u.status;
    if (u.status === "circuit") {
      this.push({
        kind: "uncertainty",
        title: `CIRCUIT BREAKER · σ=${u.std.toFixed(4)}`,
        body: [
          `Monte-Carlo dropout variance (${u.std.toFixed(4)} over ${u.mcPasses} passes) crossed the circuit threshold. Epistemic uncertainty is too high to trust the signal, so I halted auto-training until variance normalises. Honest silence beats a confident guess.`,
        ],
      });
    } else if (u.status === "elevated" && prev !== "elevated") {
      this.push({
        kind: "uncertainty",
        title: `UNCERTAINTY ELEVATED · σ=${u.std.toFixed(4)}`,
        body: ["Model disagreement rose above the comfort band. Forecasts continue but carry wider cones — treat confidence with extra skepticism."],
      });
    } else if (u.status === "stable" && (prev === "circuit" || prev === "elevated")) {
      this.push({
        kind: "uncertainty",
        title: "UNCERTAINTY NORMALISED",
        body: [`σ back to ${u.std.toFixed(4)}. Signals and auto-training fully re-armed.`],
      });
    }
  }

  /* ── Narration builders ────────────────────────────────────── */
  private narrateForecast(p: MLPrediction) {
    const topVotes = [...p.votes].sort((a, b) => b.weight - a.weight).slice(0, 3);
    const voteLines = topVotes.map(v =>
      `• ${v.name} (${modelDesc(v.name)}) — ${v.direction.toUpperCase()} @ p=${v.probability.toFixed(2)}, weight ${v.weight.toFixed(2)}`
    );
    const drivers = (p.attributionSummary ?? []).slice(0, 4);
    const driverLine = drivers.length
      ? `What tipped it: ${drivers.map(d => `${d.name} ${d.score >= 0 ? "+" : ""}${d.score.toFixed(2)}`).join(" · ")}`
      : undefined;
    const maxH = p.horizons.length ? Math.max(...p.horizons.map(h => h.h)) : 3;
    const sigma = p.uncertainty?.std ?? 0;
    const sigmaMood = sigma > 0.02 ? "wide — treat the cone seriously" : sigma > 0.008 ? "moderate" : "tight";

    this.push({
      kind: "forecast",
      symbol: p.symbol,
      title: `FORECAST · ${p.symbol} ${p.direction.toUpperCase()} @ ${Math.round(p.confidence)}% confidence`,
      body: [
        `I'm calling ${p.direction.toUpperCase()} over the next ${maxH} candles — target ${fmt(p.targetPrice)} (${pct(p.priceChangePct)} from ${fmt(p.currentPrice)}). Ensemble agreement: ${Math.round(p.agreement * 100)}% via ${p.method}.`,
        ...voteLines,
        ...(driverLine ? [driverLine] : []),
        `Monte-Carlo dropout ran ${p.uncertainty?.mcPasses ?? 10} forward passes: σ=${sigma.toFixed(4)} → ${sigmaMood}.`,
        `HOW it was made: live 1-min candles → ${p.features.length} engineered features (returns, RSI, MACD, Bollinger position, volume flow…) → 7 models score independently → votes weighted by each model's verified track record → Kalman-smoothed probability → T+1/T+3/T+5 targets with an uncertainty cone.`,
      ],
      votes: p.votes,
      drivers,
      agreement: p.agreement,
      confidence: p.confidence,
      uncertainty: sigma,
    });
  }

  private narrateEvent(e: TrainEvent) {
    if (e.type === "eval") {
      const hit = /HIT/.test(e.note);
      const miss = /MISS/.test(e.note);
      this.push({
        kind: "outcome",
        title: hit ? `RESOLVED · HIT ✓` : miss ? `RESOLVED · MISS ✗` : `RESOLVED`,
        body: [
          `${e.note}.`,
          hit
            ? "Forecast verified against the realized price — the ledger and model weights now reflect it."
            : "A miss becomes a hard example: it's replayed online immediately and over-sampled on the next retrain, so the model improves exactly where it was wrong.",
        ],
      });
      return;
    }
    if (e.type === "train" || e.type === "retrain" || e.type === "online") {
      this.push({
        kind: "training",
        title: e.type === "retrain" ? "RETRAINING" : e.type === "online" ? "ONLINE LEARNING" : "TRAINING",
        body: [e.note],
      });
    }
  }

  private marketPulse() {
    const s = useTradingStore.getState();
    const items = s.watchlist.filter(w => w.price > 0);
    if (items.length === 0) return;
    const movers = [...items].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 4);
    const line = movers.map(w => `${w.symbol} ${pct(w.changePct)}`).join(" · ");
    const stats = s.mlStats;
    const accLine = stats && stats.totalPredictions > 0
      ? ` Accuracy ledger: ${stats.correctPredictions}/${stats.totalPredictions} (${((stats.correctPredictions / stats.totalPredictions) * 100).toFixed(0)}%), walk-forward ${(stats.wfAccuracy * 100).toFixed(0)}%.`
      : "";
    this.push({
      kind: "market",
      title: `MARKET PULSE · ${clockAt(Date.now())}`,
      body: [`Biggest movers on the mesh right now: ${line}.${accLine}`],
    });
  }

  /** Echo a user question into the stream so the chat reads as a dialogue. */
  pushUserMessage(text: string) {
    this.push({
      kind: "system",
      title: `YOU · ${text.slice(0, 60)}`,
      body: [],
    });
    // Re-mark the newest entry with a distinct look via kind override is not
    // needed — the title prefix keeps authorship unambiguous.
  }

  /* ── User questions (answered from live state, zero network) ── */
  ask(text: string): { switchedSymbol?: string } {
    const q = text.trim().toLowerCase();
    const s = useTradingStore.getState();

    const symbolMatch = s.watchlist.find(w => w.symbol.toLowerCase() === q) ??
      [...s.watchlist].sort((a, b) => b.symbol.length - a.symbol.length)
        .find(w => q.includes(w.symbol.toLowerCase()));
    if (symbolMatch && q.replace(/[^a-z0-9/^]/g, "") === symbolMatch.symbol.toLowerCase()) {
      s.setActiveMarket(symbolMatch.market);
      s.setActiveSymbol(symbolMatch.symbol);
      this.push({
        kind: "system",
        title: `SWITCHED DESK → ${symbolMatch.symbol}`,
        body: [`Now watching ${symbolMatch.name || symbolMatch.symbol}. The next forecast on this desk will be narrated in full.`],
      });
      return { switchedSymbol: symbolMatch.symbol };
    }

    if (/why|reason|explain|made/.test(q)) {
      if (s.prediction) {
        this.narrateForecast(s.prediction);
      } else {
        this.push({
          kind: "system",
          title: "NO SIGNAL YET",
          body: ["The ensemble needs ~1 minute of live candles on this desk before it emits its first forecast. It will narrate itself the moment it does."],
        });
      }
      return {};
    }

    if (/how|pipeline|architecture|work/.test(q)) {
      this.push({
        kind: "system",
        title: "HOW THE MACHINE WORKS",
        body: [
          "Every forecast follows the same auditable pipeline: (1) live ticks aggregate into 1-minute candles; (2) 21 features are engineered — multi-horizon returns, RSI(14), MACD, Bollinger position, EMA distances, ATR-normalised range, volume flow; (3) seven models score the window independently — three MLPs, logistic regression, a kNN pattern matcher, gradient-boosted trees, and a momentum/mean-reversion rule; (4) votes are weighted by each model's own verified track record; (5) the blended probability is Kalman-smoothed so it doesn't flip between ticks; (6) Monte-Carlo dropout (10 stochastic passes) estimates epistemic uncertainty and arms a circuit breaker when σ spikes; (7) T+1/T+3/T+5 targets are published with an uncertainty cone and later resolved against the real price — misses are mined as hard examples.",
        ],
      });
      return {};
    }

    if (/status|health|accuracy|ledger/.test(q)) {
      const st = s.mlStats;
      const integ = s.integrity;
      this.push({
        kind: "system",
        title: "SYSTEM STATUS",
        body: [
          st && st.totalPredictions > 0
            ? `Accuracy ${st.correctPredictions}/${st.totalPredictions} (${((st.correctPredictions / st.totalPredictions) * 100).toFixed(0)}%) · walk-forward ${(st.wfAccuracy * 100).toFixed(0)}% vs baseline ${(st.wfBaseline * 100).toFixed(0)}% · Brier ${st.brierScore.toFixed(4)} · signal P&L ${pct(st.signalReturn)} vs buy-and-hold ${pct(st.buyHoldReturn)}.`
            : "No verified forecasts yet — the ledger fills as horizons resolve.",
          integ ? `Integrity audit: ${integ.verdict.toUpperCase()} across ${integ.sources.length} independent sources (max deviation ${integ.maxDevPct.toFixed(2)}%).` : "Integrity auditor warming up.",
          `Mesh: ${s.watchlist.filter(w => w.price > 0).length} symbols live. Uncertainty guard: ${(s.uncertainty?.status ?? "stable").toUpperCase()}.`,
        ],
      });
      return {};
    }

    this.push({
      kind: "system",
      title: "WHAT I CAN DO",
      body: [
        "Try: “why” (explain the current forecast), “how” (full pipeline), “status” (accuracy, integrity, mesh health), or type any symbol on the watchlist (e.g. BTC/USDT) to switch desks.",
        "Meanwhile I narrate automatically: every forecast, every resolution, every retrain, every integrity and uncertainty event — 24/7.",
      ],
    });
    return {};
  }
}

export const analyst = new AnalystJournal();
