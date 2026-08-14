import type { MarketSymbol, Timeframe, MarketType } from "@/types";

/**
 * Read a Vite env var (set as VITE_* in the environment) safely
 * in both the browser bundle and the Node test runner. Returns undefined when
 * unset so each key falls back to its bundled shared key below.
 */
function envKey(name: string): string | undefined {
  try {
    const env = (import.meta as any)?.env;
    if (env && typeof env[name] === "string" && env[name].length > 0) return env[name];
  } catch { /* non-browser / build-time */ }
  return undefined;
}

/**
 * Provider keys — every one is overridable via the Keys tab (VITE_* env vars)
 * so the app keeps running forever on personal free keys when a shared key is
 * exhausted or geo-blocked:
 *   VITE_TWELVE_DATA_KEY  → free twelvedata.com key (8 credits/min, 800/day) —
 *                           the only free source for REAL futures quotes/candles
 *                           (ES/CL/NG/...) and intraday stock history.
 *   VITE_FINNHUB_KEY      → free finnhub.io key (60 REST calls/min, live quotes)
 *   VITE_POLYGON_KEY      → free polygon.io key (5 calls/min, delayed daily bars)
 *   VITE_ALPHA_VANTAGE_KEY→ free alphavantage.co key (25 req/day, daily + FX)
 */
export const API_KEYS = {
  FINNHUB: envKey("VITE_FINNHUB_KEY") || "d9uun91r01qv408i8b70d9uun91r01qv408i8b7g",
  TWELVE_DATA: envKey("VITE_TWELVE_DATA_KEY") || "a6f2e6d4cf2243d488b9beee0139d84c",
  ALPHA_VANTAGE: envKey("VITE_ALPHA_VANTAGE_KEY") || "W4JD6FF4JWEY95BY",
  POLYGON: envKey("VITE_POLYGON_KEY") || "LewTPkq95q0rPx_zuQckQaY0aNCm9GA4",
};

export const ENDPOINTS = {
  FINNHUB_WS: "wss://ws.finnhub.io",
  FINNHUB_REST: "https://finnhub.io/api/v1",
  TWELVE_DATA_REST: "https://api.twelvedata.com",
  TWELVE_DATA_WS: "wss://ws.twelvedata.com/v1/quotes/price",
  ALPHA_VANTAGE_REST: "https://www.alphavantage.co/query",
  POLYGON_REST: "https://api.polygon.io",
  BINANCE_WS: "wss://stream.binance.com:9443/stream",
  // data-api.binance.vision is Binance's official public market-data domain:
  // same /api/v3 endpoints (quotes, 24hr stats, klines), but CORS-enabled
  // (ACAO: *) and NOT geo-blocked, unlike api.binance.com (451 in many regions).
  BINANCE_REST: "https://data-api.binance.vision/api/v3",
};

/** Twelve Data free-plan budget (verified): 8 REST credits/minute, 800/day */
export const TWELVE_DATA_BUDGET = {
  minuteLimit: 8,
  dayLimit: 800,
  /** Cache TTL for candle series (seconds) — re-fetch only after expiry */
  candleCacheTtl: 10 * 60,
};

/** Finnhub free-plan budget: 60 REST calls / minute. All polling is scheduled under this. */
export const FINNHUB_BUDGET = {
  minuteLimit: 58, // leave headroom for retries / one-off calls
  /** Default polling cadence per symbol (ms) for quote-polled markets (futures). */
  pollIntervalMs: 20_000,
};

export const TIMEFRAMES: { label: string; value: Timeframe; interval: string }[] = [
  { label: "1M", value: "1min", interval: "1min" },
  { label: "5M", value: "5min", interval: "5min" },
  { label: "15M", value: "15min", interval: "15min" },
  { label: "30M", value: "30min", interval: "30min" },
  { label: "1H", value: "1h", interval: "1h" },
  { label: "4H", value: "4h", interval: "4h" },
  { label: "1D", value: "1day", interval: "1day" },
];

/** Map Timeframe -> bucket size in seconds (for live candle aggregation) */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "30min": 1800,
  "1h": 3600,
  "4h": 14400,
  "1day": 86400,
};

/** Map Timeframe -> Finnhub candle resolution */
export const FINNHUB_RESOLUTION: Record<string, string> = {
  "1min": "1", "5min": "5", "15min": "15", "30min": "30",
  "1h": "60", "4h": "240", "1day": "D",
};

/** Map Timeframe -> Binance kline interval */
export const BINANCE_INTERVAL: Record<string, string> = {
  "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m",
  "1h": "1h", "4h": "4h", "1day": "1d",
};

export const STOCK_SYMBOLS: MarketSymbol[] = [
  { symbol: "AAPL", name: "Apple Inc.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "MSFT", name: "Microsoft Corp.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "GOOGL", name: "Alphabet Inc.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "NVDA", name: "NVIDIA Corp.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "AMZN", name: "Amazon.com Inc.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "META", name: "Meta Platforms", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "TSLA", name: "Tesla Inc.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "AMD", name: "Advanced Micro Devices", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "NFLX", name: "Netflix Inc.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "AVGO", name: "Broadcom Inc.", market: "stocks", exchange: "NASDAQ", decimals: 2 },
  { symbol: "CRM", name: "Salesforce Inc.", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "ORCL", name: "Oracle Corp.", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "JPM", name: "JPMorgan Chase", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "BAC", name: "Bank of America", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "V", name: "Visa Inc.", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "WMT", name: "Walmart Inc.", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "XOM", name: "Exxon Mobil", market: "stocks", exchange: "NYSE", decimals: 2 },
  { symbol: "KO", name: "Coca-Cola Co.", market: "stocks", exchange: "NYSE", decimals: 2 },
];

/** Real index LEVELS first (^GSPC, ^IXIC, ^DJI, ^RUT, ^VIX — served by the
 * Yahoo relay, which maps them to the true index prints), then the index-
 * tracking ETFs traded live on the equity feeds (SPY/QQQ/DIA/IWM…). */
export const INDICES_SYMBOLS: MarketSymbol[] = [
  { symbol: "^GSPC", name: "S&P 500", market: "indices", exchange: "S&P", description: "Real S&P 500 index level", decimals: 2, yahooTicker: "^GSPC" },
  { symbol: "^IXIC", name: "Nasdaq Composite", market: "indices", exchange: "NASDAQ", description: "Real Nasdaq Composite index level", decimals: 2, yahooTicker: "^IXIC" },
  { symbol: "^DJI", name: "Dow Jones Industrial", market: "indices", exchange: "DJIA", description: "Real Dow Jones Industrial Average level", decimals: 2, yahooTicker: "^DJI" },
  { symbol: "^RUT", name: "Russell 2000", market: "indices", exchange: "RUSSELL", description: "Real Russell 2000 small-cap index level", decimals: 2, yahooTicker: "^RUT" },
  { symbol: "^VIX", name: "CBOE Volatility Index", market: "indices", exchange: "CBOE", description: "The VIX 'fear gauge' — real implied volatility level", decimals: 2, yahooTicker: "^VIX" },
  { symbol: "SPY", name: "S&P 500 (SPY ETF)", market: "indices", exchange: "NYSE", description: "Tracks the S&P 500 index", decimals: 2 },
  { symbol: "QQQ", name: "Nasdaq-100 (QQQ ETF)", market: "indices", exchange: "NASDAQ", description: "Tracks the Nasdaq-100 index", decimals: 2 },
  { symbol: "DIA", name: "Dow Jones (DIA ETF)", market: "indices", exchange: "NYSE", description: "Tracks the Dow Jones Industrial Average", decimals: 2 },
  { symbol: "IWM", name: "Russell 2000 (IWM ETF)", market: "indices", exchange: "NYSE", description: "Tracks the Russell 2000 small-cap index", decimals: 2 },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", market: "indices", exchange: "NYSE", description: "Tracks the S&P 500 index", decimals: 2 },
  { symbol: "VTI", name: "Vanguard Total Market ETF", market: "indices", exchange: "NYSE", description: "Tracks the entire US equity market", decimals: 2 },
];

export const FOREX_SYMBOLS: MarketSymbol[] = [
  { symbol: "EUR/USD", name: "Euro / US Dollar", market: "forex", currency: "USD", decimals: 5 },
  { symbol: "GBP/USD", name: "British Pound / USD", market: "forex", decimals: 5 },
  { symbol: "USD/JPY", name: "US Dollar / Japanese Yen", market: "forex", decimals: 3 },
  { symbol: "AUD/USD", name: "Australian Dollar / USD", market: "forex", decimals: 5 },
  { symbol: "USD/CHF", name: "US Dollar / Swiss Franc", market: "forex", decimals: 5 },
  { symbol: "USD/CAD", name: "US Dollar / Canadian Dollar", market: "forex", decimals: 5 },
  { symbol: "NZD/USD", name: "New Zealand Dollar / USD", market: "forex", decimals: 5 },
  { symbol: "EUR/GBP", name: "Euro / British Pound", market: "forex", decimals: 5 },
  { symbol: "EUR/JPY", name: "Euro / Japanese Yen", market: "forex", decimals: 3 },
  { symbol: "GBP/JPY", name: "British Pound / Japanese Yen", market: "forex", decimals: 3 },
  { symbol: "AUD/JPY", name: "Australian Dollar / Yen", market: "forex", decimals: 3 },
  { symbol: "EUR/CHF", name: "Euro / Swiss Franc", market: "forex", decimals: 5 },
];

export const CRYPTO_SYMBOLS: MarketSymbol[] = [
  { symbol: "BTC/USDT", name: "Bitcoin / USDT", market: "crypto", decimals: 1 },
  { symbol: "ETH/USDT", name: "Ethereum / USDT", market: "crypto", decimals: 1 },
  { symbol: "SOL/USDT", name: "Solana / USDT", market: "crypto", decimals: 2 },
  { symbol: "BNB/USDT", name: "BNB / USDT", market: "crypto", decimals: 1 },
  { symbol: "XRP/USDT", name: "Ripple / USDT", market: "crypto", decimals: 4 },
  { symbol: "ADA/USDT", name: "Cardano / USDT", market: "crypto", decimals: 4 },
  { symbol: "DOGE/USDT", name: "Dogecoin / USDT", market: "crypto", decimals: 4 },
  { symbol: "AVAX/USDT", name: "Avalanche / USDT", market: "crypto", decimals: 2 },
  { symbol: "LTC/USDT", name: "Litecoin / USDT", market: "crypto", decimals: 2 },
  { symbol: "LINK/USDT", name: "Chainlink / USDT", market: "crypto", decimals: 3 },
  { symbol: "DOT/USDT", name: "Polkadot / USDT", market: "crypto", decimals: 3 },
  { symbol: "SUI/USDT", name: "Sui / USDT", market: "crypto", decimals: 3 },
  { symbol: "NEAR/USDT", name: "NEAR Protocol / USDT", market: "crypto", decimals: 3 },
  { symbol: "ARB/USDT", name: "Arbitrum / USDT", market: "crypto", decimals: 3 },
];

/** Futures verified live on Finnhub REST quotes (free tier) — financials, energy, metals, softs, grains. */
export const FUTURES_SYMBOLS: MarketSymbol[] = [
  { symbol: "ES", name: "E-mini S&P 500", market: "futures", exchange: "CME", decimals: 2 },
  { symbol: "CL", name: "Crude Oil WTI", market: "futures", exchange: "NYMEX", decimals: 2 },
  { symbol: "SI", name: "Silver Futures", market: "futures", exchange: "COMEX", decimals: 3 },
  { symbol: "NG", name: "Natural Gas", market: "futures", exchange: "NYMEX", decimals: 3 },
  { symbol: "HG", name: "Copper Futures", market: "futures", exchange: "COMEX", decimals: 3 },
  { symbol: "ZS", name: "Soybean Futures", market: "futures", exchange: "CBOT", decimals: 2 },
  { symbol: "RB", name: "RBOB Gasoline", market: "futures", exchange: "NYMEX", decimals: 3 },
  { symbol: "BZ", name: "Brent Crude", market: "futures", exchange: "ICE", decimals: 2 },
  { symbol: "KC", name: "Coffee Futures", market: "futures", exchange: "ICE", decimals: 2 },
  { symbol: "SB", name: "Sugar Futures", market: "futures", exchange: "ICE", decimals: 2 },
  { symbol: "ZM", name: "Soybean Meal", market: "futures", exchange: "CBOT", decimals: 2 },
  { symbol: "GF", name: "Feeder Cattle", market: "futures", exchange: "CME", decimals: 2 },
  { symbol: "MGC", name: "Micro Gold", market: "futures", exchange: "COMEX", decimals: 2 },
];

export const ALL_SYMBOLS: MarketSymbol[] = [
  ...STOCK_SYMBOLS,
  ...FOREX_SYMBOLS,
  ...CRYPTO_SYMBOLS,
  ...FUTURES_SYMBOLS,
  ...INDICES_SYMBOLS,
];

export const getSymbolsByMarket = (market: MarketType | string): MarketSymbol[] => {
  switch (market) {
    case "stocks": return STOCK_SYMBOLS;
    case "forex": return FOREX_SYMBOLS;
    case "crypto": return CRYPTO_SYMBOLS;
    case "futures": return FUTURES_SYMBOLS;
    case "indices": return INDICES_SYMBOLS;
    default: return STOCK_SYMBOLS;
  }
};

export const getSymbolMeta = (symbol: string): MarketSymbol | undefined =>
  ALL_SYMBOLS.find(s => s.symbol === symbol);

export const MARKET_ORDER: MarketType[] = ["stocks", "forex", "crypto", "indices", "futures"];

export const ML_CONFIG = {
  SEQ_LENGTH: 60,          // Input sequence length (candles)
  PREDICTION_HORIZON: 5,   // How many candles ahead the primary forecast targets
  HORIZONS: [1, 3, 5],     // Forecast path shown in the UI (candles ahead)
  RETRAIN_THRESHOLD: 0.45, // Retrain when rolling accuracy drops below this
  MIN_DATA_POINTS: 60,     // Minimum candles before first training
  BATCH_SIZE: 16,
  EPOCHS: 20,              // Initial full-training epochs
  RETRAIN_EPOCHS: 10,      // Epochs for failure-driven retrains
  ONLINE_EPOCHS: 3,        // Epochs for quick online fine-tune on a failure
  LEARNING_RATE: 0.001,
  LSTM_UNITS: 64,
  DROPOUT: 0.2,
  MAX_HARD_EXAMPLES: 40,   // Cap for failure-window buffer
  PERSIST_KEY: "omegatrade-models-v3",
  GBDT_TREES: 48,          // Gradient-boosted trees in the ensemble
  GBDT_LR: 0.12,
  KALMAN_Q: 0.002,         // Process noise for prediction smoothing
  KALMAN_R: 0.06,          // Measurement noise for prediction smoothing
  EWC_LAMBDA: 10,          // EWC penalty for online/retrain updates (Fisher normalized to 0..1, so λ is a relative strength)
  MC_PASSES: 10,           // Monte-Carlo dropout forward passes for epistemic uncertainty
  UNCERTAINTY_ELEVATED: 0.08, // Prediction std threshold → elevated uncertainty
  UNCERTAINTY_CIRCUIT: 0.14,  // Prediction std threshold → circuit breaker (halt auto-training)
  ATTRIBUTION_EPS: 0.05,   // Finite-difference epsilon for Grad-CAM-style attribution
};
