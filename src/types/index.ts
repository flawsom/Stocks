export type MarketType = "stocks" | "forex" | "crypto" | "futures" | "indices";
export type Timeframe = "1min" | "5min" | "15min" | "30min" | "1h" | "4h" | "1day";
export type PredictionDirection = "up" | "down" | "neutral";

export type DataSource =
  | "finnhub-ws"
  | "finnhub-rest"
  | "binance-ws"
  | "binance-rest"
  | "twelvedata-rest"
  | "twelvedata-ws"
  | "alpha-vantage"
  | "polygon"
  | "coingecko"
  | "coinbase"
  | "kraken"
  | "bybit"
  | "okx"
  | "bitstamp"
  | "bitget"
  | "htx"
  | "gemini"
  | "coinpaprika"
  | "bitrue"
  | "deribit"
  | "bitmart"
  | "floatrates"
  | "bitfinex"
  | "cryptodotcom"
  | "upbit"
  | "bitso"
  | "whitebit"
  | "lbank"
  | "blockchaininfo"
  | "coinlore"
  | "bithumb"
  | "coinone"
  | "bitvavo"
  | "xt"
  | "currencyapi"
  | "yahoo"
  | "exchangerate"
  | "frankfurter"
  | "hackernews"
  | "live-aggregate";

/** A verified quote from a single provider inside the multi-provider mesh. */
export interface ProviderQuote {
  price: number;
  change: number;
  changePct: number;
  volume: number;
  /** Winning provider label (e.g. "yahoo", "coingecko") */
  source: string;
  /** Time-to-valid-quote for the fastest path */
  latencyMs: number;
  at: number;
}

/** One source's quote inside an integrity audit. */
export interface IntegritySource {
  name: string;
  price: number;
  latencyMs: number;
  at: number;
}

/** Cross-modal integrity audit report (multi-provider cross-validation). */
export interface IntegrityReport {
  symbol: string;
  checkedAt: number;
  sources: IntegritySource[];
  /** Median of the audited quotes */
  median: number;
  /** Max deviation from the median across sources (%) */
  maxDevPct: number;
  verdict: "ok" | "degraded" | "de-sync";
}

/** Monte-Carlo dropout uncertainty state (epistemic variance guard). */
export interface UncertaintyState {
  variance: number;
  std: number;
  mcPasses: number;
  thresholdElevated: number;
  thresholdCircuit: number;
  status: "stable" | "elevated" | "circuit";
}

/** Per-candle model attribution (Grad-CAM style) — score -1..1. */
export interface AttributionPoint {
  time: number;
  score: number;
}

/** Named feature-level attribution (for the explainability panel). */
export interface AttributionSummary {
  name: string;
  score: number;
}

export interface OHLCV {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

export interface CandleSource {
  provider: DataSource | string;
  /** Whether the series is a live-built aggregation (no provider history) */
  streaming: boolean;
  /** Number of candles currently backed by a real provider history */
  historyCandles: number;
  cached: boolean;
  note?: string;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  market: MarketType;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  high24h: number;
  low24h: number;
  isActive?: boolean;
  lastUpdate?: number;
  /** Live data source feeding this row */
  source?: string;
  /** Price precision for display */
  decimals?: number;
  /** Day open for computing intraday change when tick change is unavailable */
  prevClose?: number;
}

export interface OrderBookEntry {
  price: number;
  size: number;
  total: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  midPrice: number;
  /** Real L2 depth stream (crypto) vs L1 market profile derived from real candles */
  realDepth: boolean;
  source: string;
  updatedAt: number;
}

export interface TechnicalIndicators {
  rsi14: number | null;
  macd: { value: number; signal: number; histogram: number } | null;
  ema20: number | null;
  ema50: number | null;
  sma200: number | null;
  bb: { upper: number; middle: number; lower: number } | null;
  atr14: number | null;
  stochastic: { k: number; d: number } | null;
  vwap: number | null;
  adx: number | null;
}

export interface ModelVote {
  name: string;
  direction: PredictionDirection;
  probability: number; // model's raw directional probability (0..1, up-bias)
  confidence: number; // 0-100
  /** Adaptive ensemble weight (from each model's verified track record) */
  weight: number;
  /** Number of verified outcomes this model's weight is based on */
  samples: number;
}

/** Per-horizon forecast target (candles ahead). Primary signal = max horizon. */
export interface HorizonTarget {
  h: number; // candles ahead
  target: number;
  changePct: number;
}

export interface MLPrediction {
  symbol: string;
  direction: PredictionDirection;
  confidence: number; // 0-100
  targetPrice: number;
  targetTime: number;
  currentPrice: number;
  priceChange: number;
  priceChangePct: number;
  upper: number;
  lower: number;
  features: number[];
  timestamp: number;
  /** Ensemble agreement 0-1 (fraction of models voting for the winning direction) */
  agreement: number;
  /** Per-model votes */
  votes: ModelVote[];
  /** Primary method that drove the signal (e.g. "Ensemble·3/5") */
  method: string;
  /** Forecast path across short horizons (candles ahead) */
  horizons: HorizonTarget[];
  /** Per-candle Grad-CAM-style attribution (-1 bearish … +1 bullish) */
  attribution: AttributionPoint[];
  /** Top contributing features and their signed scores */
  attributionSummary: AttributionSummary[];
  /** Monte-Carlo dropout epistemic uncertainty of this forecast */
  uncertainty: { variance: number; std: number; mcPasses: number };
}

export interface PredictionOutcome {
  id: string;
  symbol: string;
  direction: PredictionDirection;
  confidence: number;
  targetPrice: number;
  targetTime: number;
  currentPrice: number;
  createdAt: number;
  actualDirection: PredictionDirection | null;
  actualPrice: number | null;
  hit: boolean | null;
  resolvedAt: number | null;
}

export interface TrainEvent {
  t: number;
  type: "train" | "retrain" | "online" | "eval" | "persist";
  note: string;
}

/** One entry in the 24/7 live prediction journal — what / why / how. */
export interface DecisionEvent {
  t: number;
  kind: "signal" | "scan" | "verdict" | "learn" | "guard";
  symbol: string;
  /** WHAT — the decision or observation headline */
  headline: string;
  /** WHY — the market factors that drove it */
  why: string;
  /** HOW — the ensemble mechanics behind the number */
  how: string;
}

/** One point on the forecast track-record / equity curve. */
export interface PnLPoint {
  t: number;
  /** Cumulative % return of following the signal each forecast window */
  signal: number;
  /** Cumulative % return of buy-and-hold across the same windows */
  buyHold: number;
}

export interface MLModelStats {
  accuracy: number;
  totalPredictions: number;
  correctPredictions: number;
  trainingEpoch: number;
  loss: number;
  isTraining: boolean;
  lastTrainedAt: number;
  retrainCount: number;
  accuracy7d: number;
  accuracy24h: number;
  learningRate: number;
  /** Ensemble agreement of the latest prediction 0-1 */
  agreement: number;
  /** Failed windows retained for hard-example mining */
  hardExamples: number;
  /** Model count in the ensemble */
  modelCount: number;
  /** Events: training / retraining / outcome evaluation */
  trainEvents: TrainEvent[];
  /** Live 24/7 decision journal — what the model decided, why, and how */
  decisionEvents: DecisionEvent[];
  /** Rolling accuracy over recent resolved outcomes */
  rollingAccuracy: { t: number; v: number }[];
  /** Loss curve from the last training run */
  lossSeries: { t: number; v: number }[];
  /** Latency of the last inference */
  lastInferenceMs: number;
  /** Walk-forward (out-of-sample) accuracy of the last training run */
  wfAccuracy: number;
  /** Baseline accuracy on the same out-of-sample window (persistence + majority) */
  wfBaseline: number;
  /** Brier score (lower = better calibrated) on the out-of-sample window */
  brierScore: number;
  /** Log loss on the out-of-sample window */
  logLoss: number;
  /** Per-model adaptive weights (sum ≈ 1) */
  modelWeights: Record<string, number>;
  /** EWC memory lock armed (anchors + Fisher captured) */
  ewcLocked: boolean;
  /** Cumulative signal P&L vs buy-hold across verified forecast windows */
  pnlSeries: PnLPoint[];
  /** Total signal return % and buy-hold return % */
  signalReturn: number;
  buyHoldReturn: number;
}

export interface MarketSymbol {
  symbol: string;
  name: string;
  market: MarketType;
  exchange?: string;
  currency?: string;
  description?: string;
  decimals?: number;
  /** Custom Yahoo Finance ticker (e.g. "^GSPC" for the S&P 500 index level) —
   * used when the app symbol is not directly valid on Yahoo's chart API. */
  yahooTicker?: string;
}

export interface Alert {
  id: string;
  symbol: string;
  type: "price_above" | "price_below" | "ai_signal";
  value: number;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  datetime: number;
  url: string;
  image?: string;
  summary?: string;
  related?: string;
  /** Lexicon-derived sentiment */
  sentiment: "bullish" | "bearish" | "neutral";
  score: number; // -1 .. 1
}

export interface ProviderBudget {
  minuteUsed: number;
  minuteLimit: number;
  dayUsed: number;
  dayLimit: number;
  provider: string;
}

/* ── Paper trading ───────────────────────────────────────────── */

export type TradeSide = "long" | "short";

/** An open paper-trading position, marked to market from live prices. */
export interface Position {
  id: string;
  symbol: string;
  side: TradeSide;
  qty: number;
  avgPrice: number;
  openedAt: number;
  /** Latest live price (updated by the mark-to-market loop) */
  livePrice: number;
  /** Unrealized P&L in account currency */
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  /** Entry notional (qty × avgPrice) */
  notional: number;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: TradeSide;
  action: "open" | "close" | "partial_close";
  qty: number;
  price: number;
  fee: number;
  /** Realized P&L for closes, null for opens */
  realizedPnl: number | null;
  timestamp: number;
}

/** One point on the account equity curve. */
export interface EquityPoint {
  t: number;
  equity: number;
  cash: number;
}
