import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  MarketType, Timeframe, OHLCV, WatchlistItem,
  TechnicalIndicators, MLPrediction, MLModelStats, Alert,
  CandleSource, PredictionOutcome, ProviderBudget, NewsItem,
  IntegrityReport, UncertaintyState
} from "@/types";
import { ALL_SYMBOLS } from "@/constants/config";

interface TradingState {
  // Active selection
  activeMarket: MarketType;
  activeSymbol: string;
  activeTimeframe: Timeframe;

  // Chart data
  candles: OHLCV[];
  isLoadingCandles: boolean;
  candleError: string | null;
  candleSource: CandleSource | null;

  // Watchlist
  watchlist: WatchlistItem[];

  // Provider status (WS managers + every mesh provider)
  providerStatus: Record<string, string>;
  tdBudget: ProviderBudget;
  /** Fastest measured provider + avg latency (ms) */
  fastestProvider: { name: string; ms: number } | null;

  // EyeQuant safety systems
  integrity: IntegrityReport | null;
  integrityFault: boolean;
  circuitBreaker: boolean;
  uncertainty: UncertaintyState | null;
  showAttribution: boolean;

  // Indicators
  indicators: TechnicalIndicators | null;
  showIndicators: { rsi: boolean; macd: boolean; bb: boolean; ema: boolean; vwap: boolean };

  // ML
  prediction: MLPrediction | null;
  mlStats: MLModelStats | null;
  predictionHistory: { time: number; price: number; predicted: number; direction: string }[];
  outcomes: PredictionOutcome[];

  // Alerts
  alerts: Alert[];

  // News
  news: NewsItem[];
  newsLoading: boolean;

  // UI
  rightPanel: "ml" | "indicators" | "orderbook" | "news" | "portfolio" | "lab";
  scannerOpen: boolean;
  isConnected: boolean;
  lastTick: number;
  liveCandles: number;
  setLiveCandles: (n: number) => void;

  // Actions
  setActiveMarket: (market: MarketType) => void;
  setActiveSymbol: (symbol: string) => void;
  setActiveTimeframe: (tf: Timeframe) => void;
  setCandles: (candles: OHLCV[]) => void;
  appendCandle: (candle: OHLCV) => void;
  updateLastCandle: (candle: Partial<OHLCV>) => void;
  setIsLoadingCandles: (loading: boolean) => void;
  setCandleError: (err: string | null) => void;
  setCandleSource: (source: CandleSource | null) => void;
  setProviderStatus: (status: Record<string, string>) => void;
  setFastestProvider: (fp: { name: string; ms: number } | null) => void;
  setTdBudget: (budget: ProviderBudget) => void;
  setIntegrity: (report: IntegrityReport | null) => void;
  setIntegrityFault: (fault: boolean) => void;
  setCircuitBreaker: (on: boolean) => void;
  setUncertainty: (u: UncertaintyState | null) => void;
  toggleAttribution: () => void;
  setOutcomes: (outcomes: PredictionOutcome[]) => void;
  appendOutcome: (outcome: PredictionOutcome) => void;
  setWatchlistItem: (item: WatchlistItem) => void;
  setIndicators: (ind: TechnicalIndicators) => void;
  toggleIndicator: (key: keyof TradingState["showIndicators"]) => void;
  setPrediction: (p: MLPrediction | null) => void;
  setMLStats: (stats: MLModelStats) => void;
  appendPredictionHistory: (entry: { time: number; price: number; predicted: number; direction: string }) => void;
  setRightPanel: (panel: TradingState["rightPanel"]) => void;
  setScannerOpen: (open: boolean) => void;
  setIsConnected: (v: boolean) => void;
  setLastTick: (t: number) => void;
  setNews: (items: NewsItem[]) => void;
  setNewsLoading: (loading: boolean) => void;
  addAlert: (alert: Alert) => void;
  markAlertRead: (id: string) => void;
}

// Seed all symbols so prices can be updated regardless of active market
const defaultWatchlist: WatchlistItem[] = ALL_SYMBOLS.map(s => ({
  symbol: s.symbol,
  name: s.name,
  market: s.market,
  price: 0,
  change: 0,
  changePct: 0,
  volume: 0,
  high24h: 0,
  low24h: 0,
}));

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
      activeMarket: "stocks",
      activeSymbol: "AAPL",
      activeTimeframe: "15min",

      candles: [],
      isLoadingCandles: false,
      candleError: null,
      candleSource: null,

      watchlist: defaultWatchlist,

      providerStatus: {
        finnhub: "offline", binance: "offline", twelvedata: "offline",
        coingecko: "offline", coinbase: "offline", kraken: "offline",
        bybit: "offline", okx: "offline", bitstamp: "offline", bitget: "offline",
        htx: "offline", gemini: "offline", coinpaprika: "offline",
        bitrue: "offline", deribit: "offline", bitmart: "offline",
        kucoin: "offline", mexc: "offline", gateio: "offline", poloniex: "offline",
        yahoo: "offline", frankfurter: "offline", floatrates: "offline", exchangerate: "offline",
      },
      tdBudget: { minuteUsed: 0, minuteLimit: 8, dayUsed: 0, dayLimit: 800, provider: "TwelveData" },
      fastestProvider: null,

      integrity: null,
      integrityFault: false,
      circuitBreaker: false,
      uncertainty: null,
      showAttribution: false,

      indicators: null,
      showIndicators: { rsi: true, macd: true, bb: true, ema: true, vwap: false },

      prediction: null,
      mlStats: null,
      predictionHistory: [],
      outcomes: [],

      alerts: [],

      news: [],
      newsLoading: false,

      rightPanel: "ml",
      scannerOpen: false,
      isConnected: false,
      lastTick: 0,
      liveCandles: 0,
      setLiveCandles: (n) => set({ liveCandles: n }),

      setActiveMarket: (market) => set({ activeMarket: market }),
      setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),
      setActiveTimeframe: (tf) => set({ activeTimeframe: tf }),

      setCandles: (candles) => set({ candles }),
      appendCandle: (candle) => set(state => {
        const candles = [...state.candles, candle];
        // Keep last 500
        return { candles: candles.slice(-500) };
      }),
      updateLastCandle: (update) => set(state => {
        if (state.candles.length === 0) return {};
        const candles = [...state.candles];
        candles[candles.length - 1] = { ...candles[candles.length - 1], ...update };
        return { candles };
      }),

      setIsLoadingCandles: (loading) => set({ isLoadingCandles: loading }),
      setCandleError: (err) => set({ candleError: err }),
      setCandleSource: (source) => set({ candleSource: source }),
      setProviderStatus: (status) => set(state => ({ providerStatus: { ...state.providerStatus, ...status } })),
      setFastestProvider: (fp) => set({ fastestProvider: fp }),
      setTdBudget: (budget) => set({ tdBudget: budget }),
      setIntegrity: (report) => set({ integrity: report }),
      setIntegrityFault: (fault) => set({ integrityFault: fault }),
      setCircuitBreaker: (on) => set({ circuitBreaker: on }),
      setUncertainty: (u) => set({ uncertainty: u }),
      toggleAttribution: () => set(state => ({ showAttribution: !state.showAttribution })),
      setOutcomes: (outcomes) => set({ outcomes }),
      appendOutcome: (outcome) => set(state => ({
        outcomes: [outcome, ...state.outcomes].slice(0, 60)
      })),

      setWatchlistItem: (item) => set(state => ({
        watchlist: state.watchlist.map(w =>
          w.symbol === item.symbol ? { ...w, ...item, lastUpdate: Date.now() } : w
        ),
      })),

      setIndicators: (ind) => set({ indicators: ind }),
      toggleIndicator: (key) => set(state => ({
        showIndicators: { ...state.showIndicators, [key]: !state.showIndicators[key] }
      })),

      setPrediction: (p) => set({ prediction: p }),
      setMLStats: (stats) => set({ mlStats: stats }),
      appendPredictionHistory: (entry) => set(state => ({
        predictionHistory: [...state.predictionHistory.slice(-200), entry]
      })),

      setRightPanel: (panel) => set({ rightPanel: panel }),
      setScannerOpen: (open) => set({ scannerOpen: open }),
      setNews: (items) => set({ news: items }),
      setNewsLoading: (loading) => set({ newsLoading: loading }),
      setIsConnected: (v) => set({ isConnected: v }),
      setLastTick: (t) => set({ lastTick: t }),

      addAlert: (alert) => set(state => ({ alerts: [alert, ...state.alerts].slice(0, 50) })),
      markAlertRead: (id) => set(state => ({
        alerts: state.alerts.map(a => a.id === id ? { ...a, read: true } : a)
      })),
    }),
    {
      name: "omegatrade-state",
      partialize: (state) => ({
        activeMarket: state.activeMarket,
        activeSymbol: state.activeSymbol,
        activeTimeframe: state.activeTimeframe,
        showIndicators: state.showIndicators,
        showAttribution: state.showAttribution,
        rightPanel: state.rightPanel,
      }),
    }
  )
);
