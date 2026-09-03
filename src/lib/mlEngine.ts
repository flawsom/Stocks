import type { OHLCV, MLPrediction, MLModelStats, PredictionDirection, ModelVote, PredictionOutcome, TrainEvent, PnLPoint, AttributionPoint, AttributionSummary, DecisionEvent } from "@/types";
import { computeIndicators } from "@/lib/technicalAnalysis";
import { ML_CONFIG, TIMEFRAME_SECONDS } from "@/constants/config";

/* ── Deterministic PRNG (mulberry32) ─────────────────────────── */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Tiny linear-algebra helpers ─────────────────────────────── */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

/* ────────────────────────────────────────────────────────────────
 * MLP — feed-forward network with momentum SGD
 * ──────────────────────────────────────────────────────────────── */
interface MLPSpec {
  name: string;
  hidden: number[];
  seed: number;
}

class MLP {
  name: string;
  private hidden: number[];
  private featureSize = 0;
  private W: number[][][] = [];   // [layer][out][in]
  private B: number[][] = [];     // [layer][out]
  private vW: number[][][] = [];  // momentum
  private vB: number[][] = [];
  private rand: () => number;

  // ── EWC (Elastic Weight Consolidation) memory locks ────────────
  /** Anchor weights captured at the end of initial training (the "memory"). */
  anchorW: number[][][] = [];
  anchorB: number[][] = [];
  /** Path-based importance (accumulated |gradient|) — Fisher diagonal proxy. */
  fisherW: number[][][] = [];
  fisherB: number[][] = [];
  /** EWC penalty strength; > 0 only after the memory is locked. */
  ewcLambda = 0;
  /** Accumulate weight importance during the final initial-training epoch. */
  trackImportance = false;
  private importanceCount = 0;

  constructor(spec: MLPSpec) {
    this.name = spec.name;
    this.hidden = spec.hidden;
    this.rand = mulberry32(spec.seed);
  }

  init(featureSize: number) {
    this.featureSize = featureSize;
    const sizes = [featureSize, ...this.hidden, 1];
    this.W = [];
    this.B = [];
    this.vW = [];
    this.vB = [];
    this.fisherW = [];
    this.fisherB = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l];
      const fanOut = sizes[l + 1];
      const scale = Math.sqrt(2 / fanIn);
      const wl: number[][] = [];
      const bl: number[] = [];
      const vwl: number[][] = [];
      const vbl: number[] = [];
      const fwl: number[][] = [];
      const fbl: number[] = [];
      for (let o = 0; o < fanOut; o++) {
        const row: number[] = [];
        const vrow: number[] = [];
        const frow: number[] = [];
        for (let i = 0; i < fanIn; i++) {
          row.push((this.rand() * 2 - 1) * scale);
          vrow.push(0);
          frow.push(0);
        }
        wl.push(row);
        bl.push(0);
        vwl.push(vrow);
        vbl.push(0);
        fwl.push(frow);
        fbl.push(0);
      }
      this.W.push(wl);
      this.B.push(bl);
      this.vW.push(vwl);
      this.vB.push(vbl);
      this.fisherW.push(fwl);
      this.fisherB.push(fbl);
    }
  }

  forward(x: number[], dropout?: () => number): { acts: number[][]; out: number } {
    const acts: number[][] = [x];
    let cur = x;
    for (let l = 0; l < this.W.length; l++) {
      const next: number[] = [];
      const isLast = l === this.W.length - 1;
      for (let o = 0; o < this.W[l].length; o++) {
        const s = this.B[l][o] + dot(this.W[l][o], cur);
        next.push(isLast ? sigmoid(s) : Math.max(0, s));
      }
      acts.push(next);
      cur = next;
      // Monte-Carlo dropout: Bernoulli mask on hidden activations (inverted scaling)
      if (dropout && !isLast) {
        cur = cur.map(a => (dropout() < ML_CONFIG.DROPOUT ? 0 : a / (1 - ML_CONFIG.DROPOUT)));
      }
    }
    return { acts, out: cur[0] };
  }

  /** One SGD step with momentum + EWC penalty on a single sample. Returns squared error. */
  step(x: number[], label: number, lr: number): number {
    const { acts, out } = this.forward(x);
    const err = out - label;
    const loss = 0.5 * err * err;
    const beta = 0.9;
    const L = this.W.length;

    let delta: number | number[] = Math.max(-5, Math.min(5, err * out * (1 - out)));
    const ewcOn = this.ewcLambda > 0 && this.anchorW.length > 0;

    for (let l = L - 1; l >= 0; l--) {
      const prevActs = acts[l];
      const nextDelta: number[] = new Array(prevActs.length).fill(0);
      for (let o = 0; o < this.W[l].length; o++) {
        const dOut = typeof delta === "number" ? delta : Math.max(-5, Math.min(5, delta[o]));
        for (let i = 0; i < prevActs.length; i++) {
          const grad = dOut * prevActs[i];
          this.vW[l][o][i] = beta * this.vW[l][o][i] + (1 - beta) * grad;
          let update = lr * this.vW[l][o][i];
          if (ewcOn) {
            update += lr * this.ewcLambda * this.fisherW[l][o][i] * (this.W[l][o][i] - this.anchorW[l][o][i]);
          } else if (this.trackImportance) {
            this.fisherW[l][o][i] += Math.abs(grad);
          }
          this.W[l][o][i] -= update;
          nextDelta[i] += dOut * this.W[l][o][i];
        }
        const bGrad = dOut;
        this.vB[l][o] = beta * this.vB[l][o] + (1 - beta) * bGrad;
        let bUpdate = lr * this.vB[l][o];
        if (ewcOn) {
          bUpdate += lr * this.ewcLambda * this.fisherB[l][o] * (this.B[l][o] - this.anchorB[l][o]);
        } else if (this.trackImportance) {
          this.fisherB[l][o] += Math.abs(bGrad);
        }
        this.B[l][o] -= bUpdate;
        if (this.trackImportance) this.importanceCount++;
      }
      if (l > 0) {
        const nextDelta2 = new Array(prevActs.length).fill(0);
        for (let i = 0; i < prevActs.length; i++) {
          nextDelta2[i] = prevActs[i] > 0 ? nextDelta[i] : 0;
        }
        delta = nextDelta2;
      }
    }
    return loss;
  }

  predictProb(x: number[]): number {
    if (x.length !== this.featureSize) return 0.5;
    return this.forward(x).out;
  }

  /** Stochastic forward with MC dropout — used for epistemic uncertainty. */
  mcPredictProb(x: number[]): number {
    if (x.length !== this.featureSize) return 0.5;
    return this.forward(x, Math.random).out;
  }

  /** Lock the EWC memory: anchor = current weights, Fisher normalized from tracked importance. */
  captureAnchors() {
    this.anchorW = this.W.map(wl => wl.map(r => [...r]));
    this.anchorB = this.B.map(bl => [...bl]);
    // Path-importance → normalized Fisher diagonal (0..1 per layer), so λ acts
    // as a relative restoring strength: important weights bind, unimportant adapt.
    for (let l = 0; l < this.fisherW.length; l++) {
      for (let o = 0; o < this.fisherW[l].length; o++) {
        for (let i = 0; i < this.fisherW[l][o].length; i++) {
          this.fisherW[l][o][i] /= Math.max(1, this.importanceCount);
        }
        this.fisherB[l][o] /= Math.max(1, this.importanceCount);
      }
      let maxW = 0, maxB = 0;
      for (let o = 0; o < this.fisherW[l].length; o++) {
        for (let i = 0; i < this.fisherW[l][o].length; i++) maxW = Math.max(maxW, this.fisherW[l][o][i]);
        maxB = Math.max(maxB, this.fisherB[l][o]);
      }
      if (maxW > 0) {
        for (let o = 0; o < this.fisherW[l].length; o++) {
          for (let i = 0; i < this.fisherW[l][o].length; i++) this.fisherW[l][o][i] /= maxW;
        }
      }
      if (maxB > 0) {
        for (let o = 0; o < this.fisherB[l].length; o++) this.fisherB[l][o] /= maxB;
      }
    }
    this.importanceCount = 0;
    this.trackImportance = false;
  }

  /** Frobenius distance from the EWC anchor (drift introspection). */
  driftFromAnchor(): number {
    if (this.anchorW.length === 0) return 0;
    let d2 = 0;
    for (let l = 0; l < this.W.length; l++) {
      for (let o = 0; o < this.W[l].length; o++) {
        for (let i = 0; i < this.W[l][o].length; i++) {
          const d = this.W[l][o][i] - this.anchorW[l][o][i];
          d2 += d * d;
        }
      }
    }
    return Math.sqrt(d2);
  }

  serialize() {
    return {
      name: this.name, hidden: this.hidden, W: this.W, B: this.B,
      anchorW: this.anchorW, anchorB: this.anchorB, fisherW: this.fisherW, fisherB: this.fisherB,
      ewcLambda: this.ewcLambda,
    };
  }

  deserialize(d: { W: number[][][]; B: number[][]; anchorW?: number[][][]; anchorB?: number[][]; fisherW?: number[][][]; fisherB?: number[][]; ewcLambda?: number }) {
    this.W = d.W; this.B = d.B;
    this.vW = d.W.map((wl: number[][]) => wl.map((r: number[]) => r.map(() => 0)));
    this.vB = d.B.map((bl: number[]) => bl.map(() => 0));
    this.featureSize = d.W[0][0].length;
    if (Array.isArray(d.anchorW) && d.anchorW.length > 0) {
      this.anchorW = d.anchorW;
      this.anchorB = d.anchorB || [];
      this.fisherW = d.fisherW || this.W.map(wl => wl.map(r => r.map(() => 0)));
      this.fisherB = d.fisherB || this.B.map(bl => bl.map(() => 0));
      this.ewcLambda = d.ewcLambda || 0;
    }
  }
}

/* ────────────────────────────────────────────────────────────────
 * Logistic regression baseline
 * ──────────────────────────────────────────────────────────────── */
class Logistic {
  name = "Logistic";
  private w: number[] = [];
  private b = 0;
  private featureSize = 0;
  private rand: () => number;

  // ── EWC memory locks (same scheme as MLP) ─────────────────────
  anchorW: number[] = [];
  anchorB = 0;
  fisherW: number[] = [];
  fisherB = 0;
  ewcLambda = 0;
  trackImportance = false;
  private importanceCount = 0;

  constructor(seed: number) { this.rand = mulberry32(seed); }

  init(fs: number) {
    this.featureSize = fs;
    this.w = Array.from({ length: fs }, () => (this.rand() * 2 - 1) * 0.01);
    this.b = 0;
    this.fisherW = new Array(fs).fill(0);
    this.fisherB = 0;
  }

  predictProb(x: number[]): number {
    if (x.length !== this.featureSize) return 0.5;
    return sigmoid(dot(this.w, x) + this.b);
  }

  step(x: number[], label: number, lr: number): number {
    const p = this.predictProb(x);
    const err = p - label;
    const g = err * 2;
    const ewcOn = this.ewcLambda > 0 && this.anchorW.length > 0;
    for (let i = 0; i < x.length; i++) {
      const grad = g * x[i];
      let update = lr * grad;
      if (ewcOn) {
        update += lr * this.ewcLambda * this.fisherW[i] * (this.w[i] - this.anchorW[i]);
      } else if (this.trackImportance) {
        this.fisherW[i] += Math.abs(grad);
      }
      this.w[i] -= update;
    }
    const bGrad = g;
    let bUpdate = lr * bGrad;
    if (ewcOn) {
      bUpdate += lr * this.ewcLambda * this.fisherB * (this.b - this.anchorB);
    } else if (this.trackImportance) {
      this.fisherB += Math.abs(bGrad);
    }
    this.b -= bUpdate;
    if (this.trackImportance) this.importanceCount++;
    return 0.5 * err * err;
  }

  captureAnchors() {
    this.anchorW = [...this.w];
    this.anchorB = this.b;
    for (let i = 0; i < this.fisherW.length; i++) this.fisherW[i] /= Math.max(1, this.importanceCount);
    this.fisherB /= Math.max(1, this.importanceCount);
    const maxW = Math.max(...this.fisherW, 0);
    if (maxW > 0) for (let i = 0; i < this.fisherW.length; i++) this.fisherW[i] /= maxW;
    if (this.fisherB > 0) this.fisherB = 1;
    this.importanceCount = 0;
    this.trackImportance = false;
  }

  /** Frobenius distance from the EWC anchor. */
  driftFromAnchor(): number {
    if (this.anchorW.length === 0) return 0;
    let d2 = 0;
    for (let i = 0; i < this.w.length; i++) {
      const d = this.w[i] - this.anchorW[i];
      d2 += d * d;
    }
    d2 += (this.b - this.anchorB) ** 2;
    return Math.sqrt(d2);
  }

  serialize() {
    return {
      w: this.w, b: this.b,
      anchorW: this.anchorW, anchorB: this.anchorB, fisherW: this.fisherW, fisherB: this.fisherB,
      ewcLambda: this.ewcLambda,
    };
  }

  deserialize(d: { w: number[]; b: number; anchorW?: number[]; anchorB?: number; fisherW?: number[]; fisherB?: number; ewcLambda?: number }) {
    this.w = d.w; this.b = d.b; this.featureSize = d.w.length;
    if (Array.isArray(d.anchorW) && d.anchorW.length > 0) {
      this.anchorW = d.anchorW;
      this.anchorB = d.anchorB ?? 0;
      this.fisherW = d.fisherW || new Array(d.w.length).fill(0);
      this.fisherB = d.fisherB ?? 0;
      this.ewcLambda = d.ewcLambda || 0;
    }
  }
}

/* ────────────────────────────────────────────────────────────────
 * kNN pattern matcher — nearest historical windows
 * ──────────────────────────────────────────────────────────────── */
class PatternMatcher {
  name = "kNN-Patterns";
  private memory: { f: number[]; label: number }[] = [];
  private maxMem = 600;
  private k = 9;

  reset() { this.memory = []; }

  addSample(f: number[], label: number) {
    this.memory.push({ f, label });
    if (this.memory.length > this.maxMem) this.memory.shift();
  }

  getMemory() { return this.memory; }
  setMemory(m: { f: number[]; label: number }[]) { this.memory = m; }

  predictProb(x: number[]): number {
    if (this.memory.length < 20) return 0.5;
    const scored = this.memory
      .map(m => {
        let d2 = 0;
        for (let i = 0; i < x.length; i++) {
          const dd = m.f[i] - x[i];
          d2 += dd * dd;
        }
        return { label: m.label, d2 };
      })
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, this.k);

    let up = 0, down = 0;
    for (const s of scored) {
      if (s.label >= 0.75) up++;
      else if (s.label <= 0.25) down++;
    }
    const total = up + down;
    if (total === 0) return 0.5;
    return up / total;
  }
}

/* ────────────────────────────────────────────────────────────────
 * GBDT — gradient-boosted decision trees (regression stumps on
 * the squared-error loss of the label residual). Adds non-linear
 * feature interactions the MLPs/logistic can't express.
 * ──────────────────────────────────────────────────────────────── */

interface GBLeaf { value: number }
interface GBSplit { feat: number; thr: number; left: GBNode; right: GBNode }
type GBNode = GBLeaf | (GBSplit & { value?: never });

class GBTree {
  name = "GBDT";
  private featureSize = 0;
  private trees: GBNode[] = [];
  private base = 0;
  private lr = ML_CONFIG.GBDT_LR;
  private maxTrees = ML_CONFIG.GBDT_TREES;
  private maxDepth = 2;
  private rand: () => number;

  constructor(seed: number) { this.rand = mulberry32(seed); }

  init(fs: number) {
    this.featureSize = fs;
    this.trees = [];
    this.base = 0;
  }

  private treeValue(node: GBNode, x: number[]): number {
    if ("value" in node && node.value !== undefined) return node.value;
    const s = node as GBTree["trees"][number] & { feat: number; thr: number; left: GBNode; right: GBNode };
    return x[s.feat] <= s.thr ? this.treeValue(s.left, x) : this.treeValue(s.right, x);
  }

  predictProb(x: number[]): number {
    if (x.length !== this.featureSize || this.trees.length === 0) return 0.5;
    let score = this.base;
    for (const t of this.trees) score += this.lr * this.treeValue(t, x);
    return sigmoid(score);
  }

  step(): number { return 0; }

  fitBatch(samples: { f: number[]; label: number }[]) {
    if (samples.length < 12) return;
    const nTrees = Math.min(this.maxTrees, Math.max(8, Math.floor(samples.length / 4)));
    const scores = samples.map(() => this.base);
    const preds = samples.map(s => sigmoid(this.base));

    for (let t = 0; t < nTrees; t++) {
      const residuals = samples.map((s, i) => s.label - preds[i]);
      const tree = this.fitTree(samples.map((s, i) => ({ f: s.f, resid: residuals[i] })), this.maxDepth);
      this.trees.push(tree);
      for (let i = 0; i < samples.length; i++) {
        scores[i] += this.lr * this.treeValue(tree, samples[i].f);
        preds[i] = sigmoid(scores[i]);
      }
    }
  }

  /** Greedy depth-limited regression tree on residuals. */
  private fitTree(samples: { f: number[]; resid: number }[], depth: number): GBNode {
    if (depth === 0 || samples.length < 5) {
      return { value: mean(samples.map(s => s.resid)) };
    }

    const fs = samples[0].f.length;
    // Feature subsampling (diversity + speed): try up to 20 features per split
    const feats: number[] = [];
    for (let f = 0; f < fs; f++) feats.push(f);
    for (let i = feats.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [feats[i], feats[j]] = [feats[j], feats[i]];
    }
    const tryFeats = feats.slice(0, 20);

    let best: { feat: number; thr: number; left: { f: number[]; resid: number }[]; right: { f: number[]; resid: number }[] } | null = null;
    let bestSSE = Infinity;

    for (const f of tryFeats) {
      const sorted = [...samples].sort((a, b) => a.f[f] - b.f[f]);
      let total = 0, totalSq = 0;
      for (const s of sorted) { total += s.resid; totalSq += s.resid * s.resid; }
      let left = 0, leftSq = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const r = sorted[i].resid;
        left += r; leftSq += r * r;
        const thr = (sorted[i].f[f] + sorted[i + 1].f[f]) / 2;
        if (thr === sorted[i + 1].f[f]) continue;
        const nL = i + 1, nR = sorted.length - nL;
        const right = total - left, rightSq = totalSq - leftSq;
        const sse = (leftSq - left * left / nL) + (rightSq - right * right / nR);
        if (sse < bestSSE) {
          bestSSE = sse;
          best = { feat: f, thr, left: sorted.slice(0, nL), right: sorted.slice(nL) };
        }
      }
    }

    if (!best) return { value: mean(samples.map(s => s.resid)) };
    return {
      feat: best.feat,
      thr: best.thr,
      left: this.fitTree(best.left, depth - 1),
      right: this.fitTree(best.right, depth - 1),
    };
  }

  serialize() {
    return { trees: this.trees, base: this.base, featureSize: this.featureSize };
  }

  deserialize(d: unknown) {
    const dd = d as { trees?: GBNode[]; base?: number; featureSize?: number };
    if (!dd || !Array.isArray(dd.trees)) return;
    this.trees = dd.trees;
    this.base = dd.base ?? 0;
    this.featureSize = dd.featureSize ?? 0;
  }
}

/* ────────────────────────────────────────────────────────────────
 * Momentum — classical trend/momentum + mean-reversion + trend
 * filter. Deterministic, zero training, adds an orthogonal
 * inductive bias to the learned models.
 * ──────────────────────────────────────────────────────────────── */
class MomentumModel {
  name = "Momentum";
  private featureSize = 0;

  init(fs: number) { this.featureSize = fs; }

  predictProb(x: number[]): number {
    if (x.length !== this.featureSize) return 0.5;
    // Feature layout (see buildFeatures): [0..19] tanh log-returns,
    // [60] RSI/100, [67] ADX/100
    const rets = x.slice(0, 20);
    const short = mean(rets.slice(-5));          // short-term momentum (-1..1)
    const long = mean(rets);                     // medium-term momentum
    const rsi = x[60];
    const adx = x[67];

    // Blend momentum with RSI mean-reversion, gated by trend strength
    let score = 0.5 + (short * 0.65 + long * 0.35) * 0.32;
    score += (0.5 - rsi) * 0.18;                 // fade extremes
    const trendOk = adx > 0.25;                  // only trust momentum in trends
    if (!trendOk) score = 0.5 + (score - 0.5) * 0.35;
    return Math.min(1, Math.max(0, score));
  }

  step(): number { return 0; }
  serialize() { return {}; }
  deserialize() { /* stateless */ }
}

/* ────────────────────────────────────────────────────────────────
 * Feature engineering (shared by all models)
 * ──────────────────────────────────────────────────────────────── */
export function buildFeatures(candles: OHLCV[]): number[] {
  const closes = candles.map(c => c.close);
  const minP = Math.min(...closes);
  const maxP = Math.max(...closes);
  const range = maxP - minP || 1;

  const features: number[] = [];

  // Last 20 log-returns, tanh-squashed
  const rets: number[] = [];
  for (let i = Math.max(0, candles.length - 21); i < candles.length - 1; i++) {
    const r = Math.log(candles[i + 1].close / candles[i].close);
    rets.push(Math.tanh(r * 20));
  }
  while (rets.length < 20) rets.unshift(0);
  features.push(...rets.slice(-20));

  // Last 10 candles OHLC normalized
  for (let i = Math.max(0, candles.length - 10); i < candles.length; i++) {
    const c = candles[i];
    features.push((c.open - minP) / range, (c.high - minP) / range, (c.low - minP) / range, (c.close - minP) / range);
  }

  // Indicators
  const ind = computeIndicators(candles);
  features.push(ind.rsi14 !== null ? ind.rsi14 / 100 : 0.5);
  features.push(ind.macd !== null ? Math.tanh(ind.macd.histogram * 200) * 0.5 + 0.5 : 0.5);
  features.push(ind.macd !== null ? Math.tanh(ind.macd.value * 200) * 0.5 + 0.5 : 0.5);

  const lastClose = candles[candles.length - 1].close;
  features.push(ind.ema20 !== null ? Math.tanh((lastClose - ind.ema20) / range) * 0.5 + 0.5 : 0.5);
  features.push(ind.ema50 !== null ? Math.tanh((lastClose - ind.ema50) / range) * 0.5 + 0.5 : 0.5);

  if (ind.bb) {
    const bbRange = ind.bb.upper - ind.bb.lower;
    features.push(bbRange > 0 ? (lastClose - ind.bb.lower) / bbRange : 0.5);
  } else features.push(0.5);

  features.push(ind.stochastic ? ind.stochastic.k / 100 : 0.5);
  features.push(ind.adx !== null ? Math.min(ind.adx / 100, 1) : 0.5);

  // Volume momentum
  const vols = candles.slice(-5).map(c => c.volume);
  const avgVol = vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
  features.push(Math.min((candles[candles.length - 1].volume || 1) / (avgVol || 1), 3) / 3);

  // Realized volatility (20-bar)
  const window = candles.slice(-21);
  let sum = 0;
  for (let i = 1; i < window.length; i++) {
    sum += Math.pow(Math.log(window[i].close / window[i - 1].close), 2);
  }
  features.push(Math.tanh(Math.sqrt(sum / (window.length - 1)) * 40) * 0.5 + 0.5);

  // Time-of-day seasonality (intraday)
  const t = candles[candles.length - 1].time;
  const d = new Date(t * 1000);
  const hour = d.getHours() + d.getMinutes() / 60;
  features.push((Math.sin((hour / 24) * 2 * Math.PI) + 1) / 2);
  features.push((Math.cos((hour / 24) * 2 * Math.PI) + 1) / 2);

  return features;
}

function classify(p: number): { direction: PredictionDirection; confidence: number } {
  if (p > 0.58) return { direction: "up", confidence: Math.round((p - 0.5) * 200) };
  if (p < 0.42) return { direction: "down", confidence: Math.round((0.5 - p) * 200) };
  return { direction: "neutral", confidence: Math.round(50 - Math.abs(p - 0.5) * 100) };
}

/* ── 1D Kalman filter — smooths raw ensemble probabilities so the
 * live signal stops flip-flopping between ticks ──────────────── */
class Kalman1D {
  x = 0.5;
  v = 1;
  update(z: number, q: number, r: number): number {
    this.v += q;
    const k = this.v / (this.v + r);
    this.x += k * (z - this.x);
    this.v *= 1 - k;
    return this.x;
  }
  reset() { this.x = 0.5; this.v = 1; }
}

/* ────────────────────────────────────────────────────────────────
 * The engine
 * ──────────────────────────────────────────────────────────────── */
interface Sample { f: number[]; label: number }

const THRESHOLD = 0.0008; // 0.08% minimum move to count as directional

export class MLEngine {
  private mlps: MLP[] = [
    new MLP({ name: "MLP-64", hidden: [64, 32], seed: 101 }),
    new MLP({ name: "MLP-96", hidden: [96, 48], seed: 202 }),
    new MLP({ name: "MLP-32", hidden: [32, 16], seed: 303 }),
  ];
  private logistic = new Logistic(404);
  private matcher = new PatternMatcher();
  private gbdt = new GBTree(505);
  private momentum = new MomentumModel();

  private featureSize = 0;
  private initialized = false;
  private epoch = 0;
  private loss = 0;
  private isTraining = false;
  private retrainCount = 0;
  private lastTrainedAt = 0;
  private learningRate = ML_CONFIG.LEARNING_RATE;
  private hardExamples: Sample[] = [];
  private trainEvents: TrainEvent[] = [];
  /** Live 24/7 decision journal — what / why / how for every cycle. */
  private decisionEvents: DecisionEvent[] = [];
  private lastScanLogAt = 0;
  private lossSeries: { t: number; v: number }[] = [];
  private rollingAccuracy: { t: number; v: number }[] = [];
  private resolved: { predicted: PredictionDirection; actual: PredictionDirection; hit: boolean; t: number; confidence: number }[] = [];
  private pending: PredictionOutcome[] = [];
  private outcomes: PredictionOutcome[] = [];
  private lastInferenceMs = 0;
  private lastAgreement = 0;
  private symbol: string;
  private onStatsUpdate?: (stats: MLModelStats) => void;
  private symbolTfSeconds = 900;

  // Adaptive ensemble weights (per model, from verified track record)
  private modelRecent = new Map<string, number[]>(); // name -> recent 0/1 hits
  private modelWeights: Record<string, number> = {};
  /** True once the track record has been seeded from historical replay. */
  private trackSeeded = false;

  // Prediction smoothing
  private kalman = new Kalman1D();

  // EWC memory lock status (anchors + Fisher locked after first full train)
  private ewcArmed = false;
  // Autonomous learning gate — circuit breaker / integrity fault halts retraining
  private autonomous = true;

  // Walk-forward / calibration metrics from the last training run
  private wfAccuracy = 0;
  private wfBaseline = 0;
  private brierScore = 0;
  private logLoss = 0;

  // Signal P&L track record (per forecast window, % returns)
  private pnlSeries: PnLPoint[] = [];
  private signalCum = 0;
  private buyHoldCum = 0;

  constructor(symbol: string, onStatsUpdate?: (stats: MLModelStats) => void, opts?: { noPersist?: boolean }) {
    this.symbol = symbol;
    this.onStatsUpdate = onStatsUpdate;
    this.noPersist = opts?.noPersist ?? false;
    if (!this.noPersist) this.load();
  }

  private noPersist = false;

  get symbolName(): string { return this.symbol; }

  setStatsCallback(cb: (stats: MLModelStats) => void) { this.onStatsUpdate = cb; }

  setTimeframeSeconds(sec: number) { this.symbolTfSeconds = sec; }

  private allModels(): { name: string; predict: (x: number[]) => number; step: (x: number[], l: number, lr: number) => number; fitBatch?: (s: Sample[]) => void; serialize: () => unknown; deserialize: (d: unknown) => void }[] {
    return [
      ...this.mlps.map(m => ({ name: m.name, predict: (x: number[]) => m.predictProb(x), step: (x: number[], l: number, lr: number) => m.step(x, l, lr), serialize: () => m.serialize(), deserialize: (d: unknown) => m.deserialize(d as { W: number[][][]; B: number[][] }) })),
      { name: this.logistic.name, predict: (x: number[]) => this.logistic.predictProb(x), step: (x: number[], l: number, lr: number) => this.logistic.step(x, l, lr), serialize: () => this.logistic.serialize(), deserialize: (d: unknown) => this.logistic.deserialize(d as { w: number[]; b: number }) },
      { name: this.matcher.name, predict: (x: number[]) => this.matcher.predictProb(x), step: (x: number[], l: number) => { this.matcher.addSample(x, l); return 0; }, serialize: () => ({ memory: this.matcher.getMemory().slice(-400) }), deserialize: (d: unknown) => { const dd = d as { memory?: { f: number[]; label: number }[] }; if (dd.memory) this.matcher.setMemory(dd.memory); } },
      { name: this.gbdt.name, predict: (x: number[]) => this.gbdt.predictProb(x), step: () => 0, fitBatch: (s: Sample[]) => this.gbdt.fitBatch(s), serialize: () => this.gbdt.serialize(), deserialize: (d: unknown) => this.gbdt.deserialize(d) },
      { name: this.momentum.name, predict: (x: number[]) => this.momentum.predictProb(x), step: () => 0, serialize: () => ({}), deserialize: () => {} },
    ];
  }

  /* ── Persistence ─────────────────────────────────────────── */
  private persistKey() { return `${ML_CONFIG.PERSIST_KEY}:${this.symbol}`; }

  private save() {
    if (this.noPersist) return;
    try {
      const data = {
        mlps: this.mlps.map(m => m.serialize()),
        logistic: this.logistic.serialize(),
        gbdt: this.gbdt.serialize(),
        memory: this.matcher.getMemory().slice(-400),
        lr: this.learningRate,
        epoch: this.epoch,
        retrainCount: this.retrainCount,
        featureSize: this.featureSize,
        lastTrainedAt: this.lastTrainedAt,
        // Verified track record → adaptive ensemble weights survive reloads
        resolved: this.resolved.slice(-300),
        rollingAccuracy: this.rollingAccuracy.slice(-120),
        signalCum: this.signalCum,
        buyHoldCum: this.buyHoldCum,
        pnlSeries: this.pnlSeries.slice(-300),
        modelRecent: Object.fromEntries(this.modelRecent),
        modelWeights: { ...this.modelWeights },
        outcomes: this.outcomes.slice(0, 60),
        pending: this.pending.slice(0, 50),
      };
      localStorage.setItem(this.persistKey(), JSON.stringify(data));
      this.logEvent("persist", `Weights saved (${this.featureSize} features)`);
    } catch { /* storage may be full */ }
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.persistKey());
      if (!raw) return;
      const d = JSON.parse(raw) as {
        mlps?: { W?: number[][][] | null; B?: number[][] | null }[];
        logistic?: { w?: number[] | null; b?: number | null } | null;
        gbdt?: { trees?: unknown[]; base?: number; featureSize?: number } | null;
        memory?: { f: number[]; label: number }[];
        lr?: number; epoch?: number; retrainCount?: number;
        featureSize?: number; lastTrainedAt?: number;
        resolved?: { predicted: PredictionDirection; actual: PredictionDirection; hit: boolean; t: number; confidence: number }[];
        rollingAccuracy?: { t: number; v: number }[];
        signalCum?: number; buyHoldCum?: number;
        pnlSeries?: { t: number; signal: number; buyHold: number }[];
        modelRecent?: Record<string, number[]>;
        modelWeights?: Record<string, number>;
        outcomes?: PredictionOutcome[];
        pending?: PredictionOutcome[];
      };
      if (!d.mlps || !d.featureSize) return;
      d.mlps.forEach((m, i) => {
        if (m && m.W && m.B) this.mlps[i].deserialize({ W: m.W, B: m.B });
      });
      if (d.logistic?.w && d.logistic.b !== undefined) this.logistic.deserialize({ w: d.logistic.w, b: d.logistic.b });
      if (d.gbdt?.trees) this.gbdt.deserialize(d.gbdt);
      if (Array.isArray(d.memory)) this.matcher.setMemory(d.memory);
      this.learningRate = d.lr || this.learningRate;
      this.epoch = d.epoch || 0;
      this.retrainCount = d.retrainCount || 0;
      this.featureSize = d.featureSize;
      this.initialized = true;
      this.lastTrainedAt = d.lastTrainedAt || 0;
      // Restore the verified track record → adaptive ensemble weights
      if (Array.isArray(d.resolved)) this.resolved = d.resolved.slice(-300);
      if (Array.isArray(d.rollingAccuracy)) this.rollingAccuracy = d.rollingAccuracy.slice(-120);
      if (typeof d.signalCum === "number") this.signalCum = d.signalCum;
      if (typeof d.buyHoldCum === "number") this.buyHoldCum = d.buyHoldCum;
      if (Array.isArray(d.pnlSeries)) this.pnlSeries = d.pnlSeries.slice(-300);
      if (d.modelRecent && typeof d.modelRecent === "object") {
        for (const [k, v] of Object.entries(d.modelRecent)) {
          if (Array.isArray(v)) this.modelRecent.set(k, v.filter((x): x is number => typeof x === "number").slice(-30));
        }
      }
      if (d.modelWeights && typeof d.modelWeights === "object") this.modelWeights = { ...d.modelWeights };
      if (Array.isArray(d.outcomes)) this.outcomes = d.outcomes.slice(0, 60);
      if (Array.isArray(d.pending)) this.pending = d.pending.slice(0, 50);
      if (this.modelRecent.size > 0) this.recomputeWeights();
      // Restore the EWC lock if anchors survived persistence
      this.ewcArmed = this.mlps.some(m => m.anchorW.length > 0);
      this.logEvent("persist", "Model restored from memory");
    } catch { /* ignore */ }
  }

  /* ── Training samples ─────────────────────────────────────── */
  private buildSamples(candles: OHLCV[], horizon: number, window = ML_CONFIG.SEQ_LENGTH): Sample[] {
    const samples: Sample[] = [];
    for (let i = window; i < candles.length - horizon; i++) {
      const w = candles.slice(i - window, i);
      const f = buildFeatures(w);
      const change = (candles[i + horizon].close - candles[i].close) / candles[i].close;
      let label = 0.5;
      if (change > THRESHOLD) label = 1;
      else if (change < -THRESHOLD) label = 0;
      samples.push({ f, label });
    }
    return samples;
  }

  /* ── Training ─────────────────────────────────────────────── */
  async train(candles: OHLCV[], opts?: { retrain?: boolean; epochs?: number; lrScale?: number; isFirst?: boolean; quick?: boolean }): Promise<void> {
    const window = opts?.quick ? 30 : ML_CONFIG.SEQ_LENGTH;
    if (candles.length < (opts?.quick ? 34 : ML_CONFIG.MIN_DATA_POINTS)) return;
    if (this.isTraining) return;
    this.isTraining = true;

    try {
      const samples = this.buildSamples(candles, ML_CONFIG.PREDICTION_HORIZON, window);
      if (samples.length === 0) return;

      if (!this.initialized) {
        const fs = samples[0].f.length;
        this.featureSize = fs;
        this.mlps.forEach(m => m.init(fs));
        this.logistic.init(fs);
        this.matcher.reset();
        this.gbdt.init(fs);
        this.momentum.init(fs);
        this.initialized = true;
        this.logEvent("train", `Initialized ${this.allModels().length}-model ensemble on ${samples.length} samples`);
      }

      // Walk-forward split: train on the head, score honestly on the tail
      const wfSplit = Math.max(Math.floor(samples.length * 0.7), samples.length - 40);
      // Purged walk-forward: drop the train tail whose feature windows overlap
      // the validation window or whose forward-looking labels cross the split.
      // Without this embargo, information leaks from train into the "honest"
      // out-of-sample score (window + horizon bars of overlap).
      const embargo = window + ML_CONFIG.PREDICTION_HORIZON;
      this.lastPurgeGap = Math.min(embargo, wfSplit);
      const trainSet = samples.slice(0, Math.max(1, wfSplit - embargo));
      const valSet = samples.slice(wfSplit);

      // Failure-driven retrain: over-sample hard examples
      const effectiveTrain: Sample[] = [...trainSet];
      if (this.hardExamples.length > 0) {
        const reps = Math.min(6, Math.max(2, Math.floor(30 / Math.max(1, this.hardExamples.length))));
        for (let r = 0; r < reps; r++) effectiveTrain.push(...this.hardExamples);
        this.logEvent("retrain", `Including ${this.hardExamples.length} hard examples (x${reps})`);
      }

      const epochs = opts?.epochs ?? (opts?.retrain ? ML_CONFIG.RETRAIN_EPOCHS : ML_CONFIG.EPOCHS);
      const lr = this.learningRate * (opts?.lrScale ?? 1);

      const shuffled = [...effectiveTrain].sort(() => Math.random() - 0.5);
      this.lossSeries = [];

      // First full training run → track weight importance in the final epoch
      // so the EWC memory (anchors + Fisher diagonal) can be locked afterward.
      const lockMemory = !opts?.retrain && !this.ewcArmed;
      for (let ep = 0; ep < epochs; ep++) {
        const isLast = ep === epochs - 1;
        if (isLast && lockMemory) {
          for (const m of this.mlps) m.trackImportance = true;
          this.logistic.trackImportance = true;
        }
        let epochLoss = 0;
        for (const s of shuffled) {
          const elr = lr * (1 - (ep / epochs) * 0.5);
          for (const m of this.mlps) epochLoss += m.step(s.f, s.label, elr);
          epochLoss += this.logistic.step(s.f, s.label, elr);
          this.matcher.addSample(s.f, s.label);
        }
        const avg = epochLoss / (shuffled.length * 4);
        this.epoch++;
        this.loss = avg;
        this.lossSeries.push({ t: Date.now(), v: avg });
        if (ep % 4 === 0) await new Promise(r => setTimeout(r, 1));
        this.emitStats();
      }

      // Batch learners (gradient boosting) after the SGD epochs
      this.gbdt.fitBatch(effectiveTrain);

      // Lock the EWC memory after the first full training run
      if (lockMemory) this.captureEwcMemory();
      this.loss = this.lossSeries.length > 0 ? this.lossSeries[this.lossSeries.length - 1].v : this.loss;

      if (this.matcher.getMemory().length > 600) {
        this.matcher.setMemory(this.matcher.getMemory().slice(-600));
      }

      // Honest out-of-sample evaluation (walk-forward)
      this.runWalkForward(valSet);

      this.lastTrainedAt = Date.now();
      this.retrainCount += opts?.retrain ? 1 : 0;
      this.logEvent(opts?.retrain ? "retrain" : "train", `Trained ${epochs} epochs · loss ${this.loss.toFixed(5)} · ${effectiveTrain.length} samples` +
        (this.wfAccuracy > 0 ? ` · WF acc ${this.wfAccuracy.toFixed(0)}% (base ${this.wfBaseline.toFixed(0)}%)` : ""));
      if (opts?.retrain) {
        this.logDecision(
          "learn",
          `Autonomous retrain #${this.retrainCount} · ${epochs} epochs on ${effectiveTrain.length} samples`,
          `rolling accuracy ${this.wfAccuracy.toFixed(0)}% vs baseline ${this.wfBaseline.toFixed(0)}% · loss ${this.loss.toFixed(5)}`,
          `EWC ${this.ewcArmed ? "locked" : "arming"} · ${this.hardExamples.length} hard examples oversampled`
        );
      }
      this.save();
    } finally {
      this.isTraining = false;
      this.emitStats();
    }
  }

  /** Walk-forward (out-of-sample) scoring of the last training run.
   *  Also fits Platt calibration (a,b) on the out-of-sample probabilities and
   *  reports metrics through the calibrated map — the accuracy you see is what
   *  the calibrated live signal would have scored on unseen data. */
  private runWalkForward(valSet: Sample[]) {
    if (valSet.length < 10) { this.wfAccuracy = 0; this.wfBaseline = 0; this.brierScore = 0; this.logLoss = 0; return; }
    const models = this.allModels();
    let correct = 0;
    let brier = 0;
    let logloss = 0;
    let persistence = 0;

    const pairs: { p: number; label: number }[] = [];
    for (let i = 0; i < valSet.length; i++) {
      const s = valSet[i];
      let pSum = 0;
      for (const m of models) pSum += m.predict(s.f);
      const avg = pSum / models.length;
      pairs.push({ p: avg, label: s.label });
    }

    this.fitPlatt(pairs);

    for (let i = 0; i < valSet.length; i++) {
      const s = valSet[i];
      const avg = this.calibratedProb(pairs[i].p);
      const dir = classify(avg).direction;
      const labelDir: PredictionDirection = s.label >= 0.75 ? "up" : s.label <= 0.25 ? "down" : "neutral";
      if (dir !== "neutral" && dir === labelDir) correct++;

      brier += (avg - s.label) * (avg - s.label);
      const p = Math.min(0.999, Math.max(0.001, avg));
      logloss += -(s.label * Math.log(p) + (1 - s.label) * Math.log(1 - p));

      if (i > 0 && s.label === valSet[i - 1].label) persistence++;
    }

    this.wfAccuracy = (correct / valSet.length) * 100;
    this.brierScore = brier / valSet.length;
    this.logLoss = logloss / valSet.length;

    // Baselines on the same window: persistence of label + majority class
    const majority = valSet.reduce((acc, s) => {
      const k = s.label >= 0.75 ? "up" : s.label <= 0.25 ? "down" : "flat";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const majCount = Math.max(...Object.values(majority), 0);
    this.wfBaseline = Math.max((persistence / Math.max(1, valSet.length - 1)) * 100, (majCount / valSet.length) * 100);
  }

  /* ── Out-of-sample probability calibration (Platt scaling) ─────
   * Raw ensemble probabilities are fit to the realized outcomes on the
   * PURGED out-of-sample set: p̂ = σ(a·p + b). When a=1, b=0 is already
   * optimal the identity is kept — calibration can only make the stated
   * confidence more honest, never less. */
  private calA = 1;
  private calB = 0;
  private lastPurgeGap = 0;

  private fitPlatt(pairs: { p: number; label: number }[]) {
    const n = pairs.length;
    if (n < 10) return;
    const loglossOf = (a: number, b: number) => {
      let ll = 0;
      for (const { p, label } of pairs) {
        const q = Math.min(0.999, Math.max(0.001, 1 / (1 + Math.exp(-(a * p + b)))));
        ll -= label * Math.log(q) + (1 - label) * Math.log(1 - q);
      }
      return ll / n;
    };
    let a = 1, b = 0;
    for (let it = 0; it < 300; it++) {
      let ga = 0, gb = 0;
      for (const { p, label } of pairs) {
        const q = 1 / (1 + Math.exp(-(a * p + b)));
        const e = q - label;
        ga += e * p;
        gb += e;
      }
      a -= 0.5 * (ga / n);
      b -= 0.5 * (gb / n);
      if (!Number.isFinite(a) || !Number.isFinite(b)) { a = 1; b = 0; break; }
    }
    if (Number.isFinite(a) && Number.isFinite(b) && loglossOf(a, b) < loglossOf(1, 0)) {
      this.calA = a;
      this.calB = b;
    }
  }

  private calibratedProb(p: number): number {
    if (!(this.calA > 0)) return p;
    return 1 / (1 + Math.exp(-(this.calA * p + this.calB)));
  }

  /** Leakage-guard + calibration introspection (used by the test suite). */
  getLeakageGuards(): { purgeGap: number; calibrated: boolean } {
    return { purgeGap: this.lastPurgeGap, calibrated: this.calA !== 1 || this.calB !== 0 };
  }

  /* ── Failure-driven online learning ───────────────────────── */
  /** Fine-tune on a single failed window immediately after a miss. */
  async onlineLearnOnFailure(features: number[], actualLabel: number, candles: OHLCV[]): Promise<void> {
    if (!this.initialized || this.isTraining) return;

    // Deduplicate: skip if this exact window was already mined recently
    const dup = this.hardExamples.some(h => h.label === actualLabel && this.featureDist(h.f, features) < 1e-9);
    if (!dup) {
      const ex: Sample = { f: features, label: actualLabel };
      this.hardExamples.push(ex);
      if (this.hardExamples.length > ML_CONFIG.MAX_HARD_EXAMPLES) this.hardExamples.shift();
    }

    this.isTraining = true;
    try {
      const recent = this.buildSamples(candles, 3).slice(-30);
      const batch = [features, ...recent.map(r => r.f)].map((f, i) => ({
        f,
        label: i === 0 ? actualLabel : recent[i - 1] ? recent[i - 1].label : actualLabel,
      }));
      let loss = 0;
      for (let ep = 0; ep < ML_CONFIG.ONLINE_EPOCHS; ep++) {
        for (const s of batch) {
          for (const m of this.mlps) loss += m.step(s.f, s.label, this.learningRate * 1.5);
          loss += this.logistic.step(s.f, s.label, this.learningRate * 1.5);
          this.matcher.addSample(s.f, s.label);
        }
        this.epoch++;
      }
      this.gbdt.fitBatch(this.hardExamples);
      this.loss = loss / (batch.length * 4);
      this.logEvent("online", `Online update after failure · loss ${this.loss.toFixed(5)}`);
      this.logDecision(
        "learn",
        `Failure-driven update · rewrote weights on the missed window`,
        `learned the losing pattern at lr ${(this.learningRate * 1.5).toExponential(1)} · loss ${this.loss.toFixed(5)}`,
        `online SGD ×${ML_CONFIG.ONLINE_EPOCHS} epochs · GBDT refit on ${this.hardExamples.length} hard examples`
      );
      this.save();
    } finally {
      this.isTraining = false;
      this.emitStats();
    }
  }

  /** Lock EWC memory after initial training: anchors + normalized path-importance Fisher. */
  private captureEwcMemory() {
    for (const m of this.mlps) {
      m.captureAnchors();
      m.ewcLambda = ML_CONFIG.EWC_LAMBDA;
    }
    this.logistic.captureAnchors();
    this.logistic.ewcLambda = ML_CONFIG.EWC_LAMBDA;
    this.ewcArmed = true;
    this.logEvent("persist", "EWC memory locked — anchors + Fisher importance captured");
  }

  /** Gate autonomous learning (retrain + online failure updates). */
  setAutonomous(v: boolean) {
    if (this.autonomous && !v) {
      this.logDecision(
        "guard",
        "Circuit breaker engaged — autonomous learning frozen",
        "epistemic uncertainty above the safe threshold",
        "MC-dropout σ guard · resumes when variance normalizes"
      );
    }
    this.autonomous = v;
  }

  /** Frobenius distance of the parametric heads from the EWC anchor (introspection). */
  weightDriftFromAnchor(): number {
    let d2 = 0;
    for (const m of this.mlps) d2 += m.driftFromAnchor() ** 2;
    d2 += this.logistic.driftFromAnchor() ** 2;
    return Math.sqrt(d2);
  }

  private featureDist(a: number[], b: number[]): number {
    if (a.length !== b.length) return Infinity;
    let d = 0;
    for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) * (a[i] - b[i]);
    return d;
  }

  /* ── Adaptive weights from each model's verified track record ─ */
  totalModelSamples(): number {
    let n = 0;
    for (const arr of this.modelRecent.values()) n += arr.length;
    return n;
  }

  /**
   * One-time seeding: replay the recent historical windows through the
   * ensemble so adaptive weights start informed instead of at the flat 1/N
   * prior. Read-only evaluation on real candles - no training, no leakage
   * into the live nets; live verified outcomes accrue on top.
   */
  backfillTrackRecord(candles: OHLCV[]): number {
    if (!this.initialized) return 0;
    const H = ML_CONFIG.PREDICTION_HORIZON;
    const L = ML_CONFIG.SEQ_LENGTH;
    const start = Math.max(L, candles.length - 90);
    if (candles.length < start + H + 1) return 0;
    const models = this.allModels();
    let n = 0;
    for (let i = start; i < candles.length - H; i++) {
      const f = buildFeatures(candles.slice(i - L, i));
      if (f.length !== this.featureSize) continue;
      const change = (candles[i + H].close - candles[i].close) / candles[i].close;
      let actual: PredictionDirection = "neutral";
      if (change > THRESHOLD * 2) actual = "up";
      else if (change < -THRESHOLD * 2) actual = "down";
      for (const m of models) {
        const dir = classify(m.predict(f)).direction;
        const hit = dir !== "neutral" && dir === actual ? 1 : 0;
        const recent = this.modelRecent.get(m.name) || [];
        recent.push(hit);
        if (recent.length > 30) recent.shift();
        this.modelRecent.set(m.name, recent);
      }
      n++;
    }
    if (n > 0) {
      this.recomputeWeights();
      this.save();
      this.trackSeeded = true;
      this.logEvent("eval", `Track record seeded: replayed ${n} historical windows through the ensemble`);
      this.logDecision(
        "verdict",
        `Weights seeded from ${n} replayed historical windows`,
        "walk-forward replay on real candles · relative model accuracy drives the weights",
        "historical replay, read-only evaluation · live verified outcomes accrue on top"
      );
    }
    return n;
  }

  private recomputeWeights() {
    const names = this.allModels().map(m => m.name);
    const raw: Record<string, number> = {};
    for (const n of names) {
      const recent = this.modelRecent.get(n) || [];
      if (recent.length === 0) { raw[n] = 1; continue; }
      const hits = recent.reduce((a, b) => a + b, 0);
      // Bayesian-smoothed accuracy toward 50% to avoid over-trusting tiny samples
      const acc = (hits + 0.5 * 6) / (recent.length + 6);
      raw[n] = Math.max(0.01, acc - 0.5);
    }
    const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
    for (const n of names) this.modelWeights[n] = raw[n] / total;
  }

  private modelWeight(name: string): number {
    return this.modelWeights[name] ?? 1 / Math.max(1, this.allModels().length);
  }

  /** Weighted ensemble probability (used by uncertainty + attribution). */
  private ensembleProb(features: number[], models = this.allModels()): number {
    let sum = 0, wsum = 0;
    for (const m of models) {
      const w = this.modelWeight(m.name);
      sum += m.predict(features) * w;
      wsum += w;
    }
    return wsum > 0 ? sum / wsum : 0.5;
  }

  /** Epistemic uncertainty via Monte-Carlo dropout on the MLP heads. */
  mcUncertainty(features: number[]): { variance: number; std: number; mcPasses: number } {
    if (features.length !== this.featureSize) return { variance: 0, std: 0, mcPasses: 0 };
    const passes = ML_CONFIG.MC_PASSES;
    const ps: number[] = [];
    for (let i = 0; i < passes; i++) {
      let sum = 0, wsum = 0;
      for (const m of this.mlps) {
        const w = this.modelWeight(m.name);
        sum += m.mcPredictProb(features) * w;
        wsum += w;
      }
      ps.push(wsum > 0 ? sum / wsum : 0.5);
    }
    const mu = mean(ps);
    const variance = mean(ps.map(p => (p - mu) * (p - mu)));
    return { variance, std: Math.sqrt(variance), mcPasses: passes };
  }

  /**
   * Grad-CAM-style attribution: finite-difference gradient of the ensemble
   * probability w.r.t. every input feature, then signed contribution
   * (gradient × realized feature value) mapped back onto candles.
   */
  computeAttribution(
    features: number[],
    candles: OHLCV[]
  ): { attribution: AttributionPoint[]; summary: AttributionSummary[] } {
    const models = this.allModels();
    const baseP = this.ensembleProb(features, models);
    const eps = ML_CONFIG.ATTRIBUTION_EPS;
    const grads: number[] = new Array(features.length).fill(0);
    for (let k = 0; k < features.length; k++) {
      const xp = features.slice();
      xp[k] += eps;
      grads[k] = (this.ensembleProb(xp, models) - baseP) / eps;
    }
    const contrib = (k: number) => grads[k] * features[k];

    // Per-candle heatmap: return features [0..19] map to candles len-20..len-1,
    // OHLC-normalized features [20..59] (10 candles × 4) map to candles len-10..len-1.
    const scores = new Map<number, number>();
    for (let k = 0; k < 20; k++) {
      const ci = candles.length - 20 + k;
      if (ci >= 0 && ci < candles.length) {
        scores.set(candles[ci].time, (scores.get(candles[ci].time) || 0) + contrib(k));
      }
    }
    for (let j = 0; j < 10; j++) {
      const ci = candles.length - 10 + j;
      if (ci >= 0 && ci < candles.length) {
        let s = 0;
        for (let f = 0; f < 4; f++) s += contrib(20 + j * 4 + f);
        scores.set(candles[ci].time, (scores.get(candles[ci].time) || 0) + s);
      }
    }

    const all = [...scores.entries()];
    const maxAbs = Math.max(...all.map(([, s]) => Math.abs(s)), 1e-9);
    const attribution = all.map(([time, s]) => ({
      time,
      score: Math.max(-1, Math.min(1, s / maxAbs)),
    }));

    // Named feature-level summary (top contributors to THIS forecast)
    const named: { name: string; score: number }[] = [
      { name: "Momentum(20)", score: 0 },
      { name: "RSI(14)", score: contrib(60) },
      { name: "MACD hist", score: contrib(61) },
      { name: "MACD", score: contrib(62) },
      { name: "ΔEMA20", score: contrib(63) },
      { name: "ΔEMA50", score: contrib(64) },
      { name: "BB pos", score: contrib(65) },
      { name: "Stoch K", score: contrib(66) },
      { name: "ADX", score: contrib(67) },
      { name: "Vol mom", score: contrib(68) },
      { name: "RealVol", score: contrib(69) },
      { name: "Session", score: contrib(70) + contrib(71) },
    ];
    for (let k = 0; k < 20; k++) named[0].score += contrib(k);
    const summary = named
      .map(n => ({ name: n.name, score: n.score }))
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 5)
      .map(n => ({ name: n.name, score: n.score }));

    return { attribution, summary };
  }

  /* ── Prediction ───────────────────────────────────────────── */
  predict(candles: OHLCV[], tfSeconds = 900, livePrice?: number): MLPrediction | null {
    if (!this.initialized || candles.length < 12) return null;
    this.symbolTfSeconds = tfSeconds;

    const t0 = performance.now();
    const window = candles.slice(-Math.min(ML_CONFIG.SEQ_LENGTH, candles.length));
    const features = buildFeatures(window);
    if (features.length !== this.featureSize) return null;

    // Seed adaptive weights once from a walk-forward replay when no verified
    // outcomes exist yet (fresh browser or cleared storage). Real candles,
    // causal windows; live outcomes accrue on top from here.
    if (!this.trackSeeded && this.totalModelSamples() === 0 && candles.length >= ML_CONFIG.SEQ_LENGTH + 40) {
      this.backfillTrackRecord(candles);
    }

    // Epistemic uncertainty (MC dropout) + Grad-CAM-style attribution
    const mcU = this.mcUncertainty(features);
    const attr = this.computeAttribution(features, candles);

    const models = this.allModels();
    const votes: ModelVote[] = [];
    let upW = 0, downW = 0, neutralW = 0;
    let rawP = 0, rawW = 0;

    for (const m of models) {
      const p = m.predict(features);
      const c = classify(p);
      const w = this.modelWeight(m.name);
      votes.push({ name: m.name, direction: c.direction, probability: p, confidence: c.confidence, weight: w, samples: (this.modelRecent.get(m.name) || []).length });
      if (c.direction === "up") upW += w;
      else if (c.direction === "down") downW += w;
      else neutralW += w;
      rawP += p * w;
      rawW += w;
    }
    const rawEnsembleP = rawW > 0 ? rawP / rawW : 0.5;

    // Calibrated ensemble probability (out-of-sample fitted) — the Kalman
    // filter then smooths the honest number, not the raw one.
    const calibratedP = this.calibratedProb(rawEnsembleP);
    const smoothedP = this.kalman.update(calibratedP, ML_CONFIG.KALMAN_Q, ML_CONFIG.KALMAN_R);
    const { direction } = classify(smoothedP);

    const directional = upW + downW;
    const agreement = directional > 0 ? Math.max(upW, downW) / directional : 0;
    const method = directional > 0
      ? `Ensemble·${Math.max(upW, downW).toFixed(1)}/${directional.toFixed(1)}w`
      : "No consensus";

    // Confidence: agreement-scaled
    const avgAbs = votes.reduce((a, v) => a + Math.abs(v.probability - 0.5), 0) / votes.length;
    let confidence = Math.round(50 + agreement * 50 * (avgAbs * 2));
    confidence = Math.min(97, Math.max(40, confidence));

    // Live quote wins when provided: the forecast targets the *actual* current
    // price (features are computed from past candles, so this stays causal).
    const currentPrice = livePrice && livePrice > 0 ? livePrice : candles[candles.length - 1].close;
    const ind = computeIndicators(candles);

    // Localized volatility (ATR matched to the forecast granularity)
    const tfs = Math.max(tfSeconds, 60);
    let atrVal = ind.atr14;
    if (candles.length > 8) {
      const recent = candles.slice(-15);
      const matching: OHLCV[] = [];
      for (let i = 1; i < recent.length; i++) {
        const gap = recent[i].time - recent[i - 1].time;
        if (gap > 0 && gap <= tfs * 2) matching.push(recent[i]);
      }
      if (matching.length >= 3) {
        atrVal = matching.reduce((a, c) => a + (c.high - c.low), 0) / matching.length;
      } else if (ind.atr14) {
        atrVal = ind.atr14 * Math.sqrt(tfs / 86400);
      }
    }
    const useAtr = atrVal || currentPrice * 0.01;
    const confFactor = Math.max(0.4, confidence / 100);
    const H = ML_CONFIG.PREDICTION_HORIZON;
    const sign = direction === "up" ? 1 : direction === "down" ? -1 : 0;

    const magnitude = useAtr * H * confFactor;
    const targetPrice = currentPrice + sign * magnitude;
    const priceChange = targetPrice - currentPrice;

    // Multi-horizon forecast path (T+1, T+3, T+5)
    const horizons = ML_CONFIG.HORIZONS.map(h => {
      const target = currentPrice + sign * useAtr * h * confFactor;
      return {
        h,
        target,
        changePct: ((target - currentPrice) / currentPrice) * 100,
      };
    });

    const prediction: MLPrediction = {
      symbol: this.symbol,
      direction,
      confidence,
      targetPrice,
      targetTime: Date.now() + H * tfSeconds * 1000,
      currentPrice,
      priceChange,
      priceChangePct: (priceChange / currentPrice) * 100,
      upper: targetPrice + useAtr * 0.6,
      lower: targetPrice - useAtr * 0.6,
      features: features.slice(0, 10),
      timestamp: Date.now(),
      agreement,
      votes,
      method,
      horizons,
      attribution: attr.attribution,
      attributionSummary: attr.summary,
      uncertainty: mcU,
    };

    // Register pending outcome (dedupe against unresolved)
    const registeredNew = !this.pending.some(p => p.createdAt > Date.now() - tfSeconds * 1000);
    if (registeredNew) {
      const id = `p-${this.symbol}-${Date.now()}`;
      this.pending.push({
        id,
        symbol: this.symbol,
        direction,
        confidence,
        targetPrice,
        targetTime: prediction.targetTime,
        currentPrice,
        createdAt: Date.now(),
        actualDirection: null,
        actualPrice: null,
        hit: null,
        resolvedAt: null,
      });
      this.registerPendingFeatures(id, features);
      this.registerModelProbs(id, votes.map(v => ({ name: v.name, prob: v.probability })));
      if (this.pending.length > 50) this.pending.shift();
      this.save();
    }

    this.lastInferenceMs = performance.now() - t0;
    this.lastAgreement = agreement;

    // 24/7 decision journal — every live cycle logs WHAT / WHY / HOW
    this.lastAttribution = attr.summary;
    const px = (v: number) => v.toFixed(currentPrice < 1 ? 5 : 2);
    const pctStr = `${prediction.priceChangePct >= 0 ? "+" : ""}${prediction.priceChangePct.toFixed(3)}%`;
    const howLine = `${models.length} models · ${method} · σ=${mcU.std.toFixed(3)} · ${this.lastInferenceMs.toFixed(0)}ms infer`;
    if (registeredNew) {
      this.logDecision(
        "signal",
        `${direction.toUpperCase()} ${confidence}% → ${px(prediction.targetPrice)} (${pctStr}) · T+${ML_CONFIG.PREDICTION_HORIZON} bars`,
        this.whyLine(),
        howLine
      );
      this.lastScanLogAt = Date.now();
    } else if (Date.now() - this.lastScanLogAt > 15_000) {
      this.lastScanLogAt = Date.now();
      this.logDecision(
        "scan",
        `Holding ${direction.toUpperCase()} ${confidence}% · px ${px(currentPrice)}`,
        this.whyLine(),
        howLine
      );
    }

    this.emitStats();
    return prediction;
  }

  /* ── Outcome evaluation (the self-improvement loop) ───────── */
  evaluateOutcomes(currentPrice: number, candles: OHLCV[], now = Date.now()): { hit: boolean; direction: PredictionDirection; confidence: number }[] {
    const results: { hit: boolean; direction: PredictionDirection; confidence: number }[] = [];
    const stillPending: PredictionOutcome[] = [];

    for (const p of this.pending) {
      if (now < p.targetTime) {
        stillPending.push(p);
        continue;
      }
      const change = (currentPrice - p.currentPrice) / p.currentPrice;
      let actual: PredictionDirection = "neutral";
      if (change > THRESHOLD * 2) actual = "up";
      else if (change < -THRESHOLD * 2) actual = "down";

      const hit = p.direction !== "neutral" && p.direction === actual;
      p.actualDirection = actual;
      p.actualPrice = currentPrice;
      p.hit = hit;
      p.resolvedAt = now;

      this.outcomes.unshift({ ...p });
      if (this.outcomes.length > 60) this.outcomes.pop();

      this.resolved.push({ predicted: p.direction, actual, hit, t: now, confidence: p.confidence });
      if (this.resolved.length > 300) this.resolved.shift();

      // Rolling accuracy series
      const recent = this.resolved.slice(-20);
      const correct = recent.filter(r => r.hit).length;
      this.rollingAccuracy.push({ t: now, v: (correct / recent.length) * 100 });
      if (this.rollingAccuracy.length > 120) this.rollingAccuracy.shift();

      // Signal P&L vs buy-hold across the resolved window
      if (p.direction !== "neutral" && p.actualPrice) {
        const move = (p.actualPrice - p.currentPrice) / p.currentPrice;
        this.signalCum += (p.direction === "up" ? move : -move) * 100;
        this.buyHoldCum += move * 100;
        this.pnlSeries.push({ t: now, signal: this.signalCum, buyHold: this.buyHoldCum });
        if (this.pnlSeries.length > 300) this.pnlSeries.shift();
      }

      // Per-model accuracy update → adaptive weights
      this.updateModelHits(p.id, actual);

      this.logEvent("eval", `Prediction ${hit ? "HIT" : "MISS"} · predicted ${p.direction} vs actual ${actual} · rolling ${((correct / recent.length) * 100).toFixed(0)}%`);
      const movePct = ((p.actualPrice! - p.currentPrice) / p.currentPrice) * 100;
      this.logDecision(
        "verdict",
        `${hit ? "HIT" : p.direction === "neutral" ? "FLAT" : "MISS"} · called ${p.direction}, market went ${actual} (${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}%)`,
        `confidence ${p.confidence}% · rolling acc ${((correct / recent.length) * 100).toFixed(0)}%`,
        `outcome verified against live price · ensemble weights adapt from the track record`
      );

      // FAILURE-DRIVEN LEARNING: on a miss, immediately fine-tune on the failed window
      // (gated by the autonomous switch — circuit breaker / integrity fault halts it)
      if (this.autonomous && !hit && p.direction !== "neutral" && this.initialized && candles.length >= ML_CONFIG.SEQ_LENGTH) {
        const failedFeatures = this.pendingFeatures.get(p.id);
        const label = actual === "up" ? 1 : actual === "down" ? 0 : 0.5;
        if (failedFeatures && label !== 0.5) {
          this.onlineLearnOnFailure(failedFeatures, label, candles).catch(() => {});
        }
      }

      results.push({ hit, direction: p.direction, confidence: p.confidence });
    }

    this.pending = stillPending;
    if (results.length > 0) this.emitStats();
    return results;
  }

  /** Update each model's verified hit rate for a resolved outcome → drives adaptive weights. */
  private updateModelHits(outcomeId: string, actual: PredictionDirection) {
    const probs = this.modelProbs.get(outcomeId);
    if (!probs) return;
    for (const { name, prob } of probs) {
      const mDir = classify(prob).direction;
      const mHit = mDir !== "neutral" && mDir === actual ? 1 : 0;
      const recent = this.modelRecent.get(name) || [];
      recent.push(mHit);
      if (recent.length > 30) recent.shift();
      this.modelRecent.set(name, recent);
    }
    this.recomputeWeights();
    this.save();
  }

  /** Full PredictionOutcome objects for the UI (resolved, newest first) + pending. */
  getOutcomes(): PredictionOutcome[] {
    return [...this.outcomes, ...this.pending];
  }

  /** Store the feature vector at predict-time so failures can be replayed. */
  private pendingFeatures = new Map<string, number[]>();
  registerPendingFeatures(id: string, features: number[]) {
    this.pendingFeatures.set(id, features);
    if (this.pendingFeatures.size > 60) {
      const first = this.pendingFeatures.keys().next().value;
      if (first) this.pendingFeatures.delete(first);
    }
  }

  /** Store each model's probability at predict-time so misses can be attributed. */
  private modelProbs = new Map<string, { name: string; prob: number }[]>();
  private registerModelProbs(id: string, probs: { name: string; prob: number }[]) {
    this.modelProbs.set(id, probs);
    if (this.modelProbs.size > 60) {
      const first = this.modelProbs.keys().next().value;
      if (first) this.modelProbs.delete(first);
    }
  }

  getPending(): PredictionOutcome[] { return this.pending; }

  isInitialized(): boolean {
    return this.initialized;
  }

  needsRetrain(): boolean {
    if (!this.autonomous) return false;
    if (!this.initialized) return true;
    const resolved = this.resolved.slice(-15);
    if (resolved.length < 10) return false;
    const correct = resolved.filter(r => r.hit).length;
    return correct / resolved.length < ML_CONFIG.RETRAIN_THRESHOLD;
  }

  /* ── Stats ────────────────────────────────────────────────── */
  getStats(): MLModelStats {
    const resolved = this.resolved;
    const correct = resolved.filter(r => r.hit).length;
    const accuracy = resolved.length > 0 ? correct / resolved.length : 0;
    const now = Date.now();

    const recent24h = resolved.filter(r => now - r.t < 24 * 3600 * 1000);
    const recent7d = resolved.filter(r => now - r.t < 7 * 24 * 3600 * 1000);
    const c24 = recent24h.filter(r => r.hit).length;
    const c7 = recent7d.filter(r => r.hit).length;

    return {
      accuracy: accuracy * 100,
      totalPredictions: this.resolved.length + this.pending.length,
      correctPredictions: correct,
      trainingEpoch: this.epoch,
      loss: this.loss,
      isTraining: this.isTraining,
      lastTrainedAt: this.lastTrainedAt,
      retrainCount: this.retrainCount,
      accuracy7d: recent7d.length > 0 ? (c7 / recent7d.length) * 100 : 0,
      accuracy24h: recent24h.length > 0 ? (c24 / recent24h.length) * 100 : 0,
      learningRate: this.learningRate,
      agreement: this.lastAgreement,
      hardExamples: this.hardExamples.length,
      modelCount: this.allModels().length,
      trainEvents: this.trainEvents.slice(-30),
      decisionEvents: this.decisionEvents.slice(-60),
      rollingAccuracy: this.rollingAccuracy.slice(-120),
      lossSeries: this.lossSeries.slice(-200),
      lastInferenceMs: this.lastInferenceMs,
      wfAccuracy: this.wfAccuracy,
      wfBaseline: this.wfBaseline,
      brierScore: this.brierScore,
      logLoss: this.logLoss,
      modelWeights: { ...this.modelWeights },
      pnlSeries: this.pnlSeries.slice(-300),
      signalReturn: this.signalCum,
      buyHoldReturn: this.buyHoldCum,
      ewcLocked: this.ewcArmed,
    };
  }

  private logEvent(type: TrainEvent["type"], note: string) {
    this.trainEvents.push({ t: Date.now(), type, note });
    if (this.trainEvents.length > 60) this.trainEvents.shift();
  }

  /** Journal the model's decision — what it did, why, and how it got there. */
  private logDecision(kind: DecisionEvent["kind"], headline: string, why: string, how: string) {
    this.decisionEvents.push({ t: Date.now(), kind, symbol: this.symbol, headline, why, how });
    if (this.decisionEvents.length > 150) this.decisionEvents.shift();
  }

  /** Human-readable top contributors for the journal's WHY line. */
  private whyLine(): string {
    if (this.lastAttribution.length === 0) return "insufficient signal history";
    return this.lastAttribution
      .slice(0, 3)
      .map(a => `${a.name} ${a.score >= 0 ? "+" : "−"}${Math.abs(a.score).toFixed(2)}`)
      .join(" · ");
  }
  private lastAttribution: AttributionSummary[] = [];

  private emitStats() {
    this.onStatsUpdate?.(this.getStats());
  }
}

/* ── Per-symbol engine registry ─────────────────────────────── */
const engines = new Map<string, MLEngine>();

export function getEngine(symbol: string, onStats?: (stats: MLModelStats) => void): MLEngine {
  if (!engines.has(symbol)) {
    engines.set(symbol, new MLEngine(symbol, onStats));
  }
  const e = engines.get(symbol)!;
  if (onStats) e.setStatsCallback(onStats);
  return e;
}

export function getAllEngines(): MLEngine[] {
  return [...engines.values()];
}

/** Resolve pending outcomes for every engine (used on a global timer). */
export function evaluateAllOutcomes(prices: Map<string, number>, candlesBySymbol: Map<string, OHLCV[]>) {
  for (const e of engines.values()) {
    const price = prices.get(e.symbolName);
    if (price === undefined) continue;
    const candles = candlesBySymbol.get(e.symbolName);
    e.evaluateOutcomes(price, candles || []);
  }
}
