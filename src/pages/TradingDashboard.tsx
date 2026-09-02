import { useEffect, useRef, useState, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import TradingChart from "@/components/features/TradingChart";
import MLPredictionPanel from "@/components/features/MLPredictionPanel";
import TechnicalIndicators from "@/components/features/TechnicalIndicators";
import OrderBook from "@/components/features/OrderBook";
import NewsPanel from "@/components/features/NewsPanel";
import TradingTicket from "@/components/features/TradingTicket";
import PortfolioPanel from "@/components/features/PortfolioPanel";
import StrategyLab from "@/components/features/StrategyLab";
import AnalystChat from "@/components/features/AnalystChat";
import MarketScanner from "@/components/features/MarketScanner";
import { useMarketData } from "@/hooks/useMarketData";
import { useTradingStore } from "@/stores/tradingStore";
import { usePortfolioStore, selectEquity } from "@/stores/portfolioStore";
import { getPolygonBudget } from "@/lib/dataProviders";
import { Brain, BarChart2, BookOpen, Newspaper, Wallet, FlaskConical, MessageSquareText, AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice, formatVolume } from "@/lib/utils";
import { toast } from "sonner";

type RightPanelType = "ml" | "analyst" | "indicators" | "orderbook" | "news" | "portfolio" | "lab";

const RIGHT_PANEL_TABS: { id: RightPanelType; label: string; icon: typeof Brain }[] = [
  { id: "ml", label: "AI", icon: Brain },
  { id: "analyst", label: "CHAT", icon: MessageSquareText },
  { id: "indicators", label: "TA", icon: BarChart2 },
  { id: "orderbook", label: "DEPTH", icon: BookOpen },
  { id: "news", label: "NEWS", icon: Newspaper },
  { id: "portfolio", label: "PORT", icon: Wallet },
  { id: "lab", label: "LAB", icon: FlaskConical },
];

const INDICATOR_COLORS: Record<string, string> = {
  ema: "#16a034",
  bb: "#7c3aed",
  rsi: "#a16207",
  macd: "#0a9c36",
  vwap: "#0e7490",
};

function TickAge() {
  const lastTick = useTradingStore(s => s.lastTick);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);
  const age = lastTick > 0 ? now - lastTick : -1;
  const secs = age / 1000;
  const color = age < 0 ? "text-slate-700" : secs < 5 ? "text-bull" : secs < 20 ? "text-predict" : "text-bear";
  const label = age < 0 ? "TICK —" : secs < 1 ? `TICK ${(Math.round(secs * 10) / 10).toFixed(1)}s` : `TICK ${Math.round(secs)}s`;
  return (
    <span className={cn("text-xs font-mono", color)} title="Seconds since the last real market heartbeat">
      {label}
    </span>
  );
}

function MarketStats() {
  const { candles, indicators, prediction, activeSymbol, watchlist } = useTradingStore();

  if (candles.length === 0) return null;

  const last = candles[candles.length - 1];
  const high24h = Math.max(...candles.map(c => c.high));
  const low24h = Math.min(...candles.map(c => c.low));
  const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);

  const stats = [
    { label: "OPEN", value: formatPrice(last.open), color: "text-slate-300" },
    { label: "HIGH", value: formatPrice(high24h), color: "text-bull" },
    { label: "LOW", value: formatPrice(low24h), color: "text-bear" },
    { label: "VOLUME", value: formatVolume(totalVolume), color: "text-slate-300" },
    {
      label: "EMA 20",
      value: indicators?.ema20 ? formatPrice(indicators.ema20) : "—",
      color: "text-brand-cyan",
    },
    {
      label: "EMA 50",
      value: indicators?.ema50 ? formatPrice(indicators.ema50) : "—",
      color: "text-predict",
    },
    {
      label: "RSI",
      value: indicators?.rsi14 ? indicators.rsi14.toFixed(1) : "—",
      color: indicators?.rsi14
        ? indicators.rsi14 > 70 ? "text-bear" : indicators.rsi14 < 30 ? "text-bull" : "text-slate-300"
        : "text-slate-600",
    },
    {
      label: "ATR",
      value: indicators?.atr14 ? formatPrice(indicators.atr14) : "—",
      color: "text-neural",
    },
    ...(prediction ? [{
      label: "AI TARGET",
      value: formatPrice(prediction.targetPrice),
      color: prediction.direction === "up" ? "text-bull" : prediction.direction === "down" ? "text-bear" : "text-predict",
    }] : []),
  ];

  return (
    <div className="flex items-center gap-0 border-b border-terminal-border bg-terminal-surface/50 overflow-x-auto flex-none">
      {stats.map((stat, i) => (
        <div key={i} className="flex items-center gap-2 px-4 py-2 border-r border-terminal-border/50 shrink-0">
          <span className="text-xs font-mono text-slate-600">{stat.label}</span>
          <span className={cn("text-xs font-mono font-semibold", stat.color)}>
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function AlertBanner() {
  const { alerts, markAlertRead } = useTradingStore();
  const unread = alerts.filter(a => !a.read);
  if (unread.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-predict/10 border-b border-predict/30 flex-none">
      <AlertTriangle size={12} className="text-predict shrink-0" />
      <span className="text-xs font-mono text-predict flex-1">{unread[0].message}</span>
      <button
        onClick={() => markAlertRead(unread[0].id)}
        className="text-predict/50 hover:text-predict transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 bg-terminal-bg/90 backdrop-blur-sm flex flex-col items-center justify-center z-20 gap-3">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-brand-cyan/20" />
        <div className="absolute inset-0 rounded-full border-2 border-t-brand-cyan animate-spin" />
        <div className="absolute inset-2 rounded-full border border-neural/20" />
        <div className="absolute inset-2 rounded-full border border-t-neural animate-spin" style={{ animationDuration: "0.6s" }} />
      </div>
      <div className="text-center">
        <div className="text-sm font-mono font-semibold text-brand-cyan text-glow-cyan mb-1">
          Loading Market Data
        </div>
        <div className="text-xs font-mono text-slate-500">Connecting to live providers...</div>
      </div>
    </div>
  );
}

function SafetyBanner() {
  const { circuitBreaker, integrityFault, uncertainty, integrity } = useTradingStore();
  if (circuitBreaker) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-bear/15 border-b border-bear/40 flex-none">
        <AlertTriangle size={12} className="text-bear shrink-0" />
        <span className="text-xs font-mono text-bear flex-1">
          CIRCUIT BREAKER — MC uncertainty σ={uncertainty?.std.toFixed(3) ?? "—"} above {uncertainty?.thresholdCircuit.toFixed(2) ?? 0.14}. Auto-training halted until variance normalizes.
        </span>
      </div>
    );
  }
  if (integrityFault && integrity) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-predict/15 border-b border-predict/40 flex-none">
        <AlertTriangle size={12} className="text-predict shrink-0" />
        <span className="text-xs font-mono text-predict flex-1">
          DATA DE-SYNC — {integrity.sources.length} providers disagree by {integrity.maxDevPct.toFixed(2)}%. Autonomous ML updates paused pending re-convergence.
        </span>
      </div>
    );
  }
  return null;
}

function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 bg-terminal-bg/95 flex flex-col items-center justify-center z-20 gap-4">
      <div className="w-12 h-12 rounded-full bg-bear/10 border border-bear/30 flex items-center justify-center">
        <AlertTriangle size={20} className="text-bear" />
      </div>
      <div className="text-center px-8">
        <div className="text-sm font-mono font-semibold text-bear mb-1">Data Feed Error</div>
        <div className="text-xs font-mono text-slate-500 mb-3 max-w-xs">{error}</div>
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded border border-brand-cyan/40 text-brand-cyan text-xs font-mono hover:bg-brand-cyan/10 transition-colors mx-auto"
        >
          <RefreshCw size={12} />
          Retry Connection
        </button>
      </div>
    </div>
  );
}

function IndicatorToggles() {
  const { showIndicators, toggleIndicator, showAttribution, toggleAttribution } = useTradingStore();
  const keys = ["ema", "bb", "vwap"] as const;

  return (
    <div className="absolute bottom-3 left-3 flex gap-1 z-10">
      {keys.map(key => {
        const active = showIndicators[key];
        const color = INDICATOR_COLORS[key];
        return (
          <button
            key={key}
            onClick={() => toggleIndicator(key)}
            className={cn(
              "px-2 py-1 text-xs font-mono rounded border transition-all",
              !active && "border-terminal-border text-slate-600 bg-terminal-bg/80"
            )}
            style={active ? {
              borderColor: `${color}60`,
              backgroundColor: `${color}15`,
              color,
            } : {}}
          >
            {key.toUpperCase()}
          </button>
        );
      })}
      <button
        onClick={toggleAttribution}
        className={cn(
          "px-2 py-1 text-xs font-mono rounded border transition-all",
          !showAttribution && "border-terminal-border text-slate-600 bg-terminal-bg/80"
        )}
        style={showAttribution ? { borderColor: "#7c3aed60", backgroundColor: "#7c3aed15", color: "#7c3aed" } : {}}
        title="Grad-CAM attribution heatmap — candles colored by what drove the AI signal"
      >
        XAI
      </button>
    </div>
  );
}

export default function TradingDashboard() {
  const {
    isLoadingCandles,
    candleError,
    candles,
    candleSource,
    rightPanel,
    setRightPanel,
    activeSymbol,
    prediction,
    mlStats,
    indicators,
    addAlert,
    providerStatus,
    tdBudget,
    scannerOpen,
    fastestProvider,
  } = useTradingStore();

  const [polygonBudget, setPolygonBudget] = useState({ minuteUsed: 0, minuteLimit: 4, dayUsed: 0, dayLimit: 300 });

  // Re-render when the portfolio is marked to market (footer equity stays live)
  usePortfolioStore(state => state.lastSample);

  const { loadCandles } = useMarketData();
  const [containerHeight, setContainerHeight] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const prevPredictionRef = useRef<string>("");
  const prevRsiRef = useRef<number | null>(null);

  // Measure container height for chart
  useEffect(() => {
    const update = () => {
      if (mainRef.current) {
        setContainerHeight(mainRef.current.clientHeight);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (mainRef.current) observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, []);

  // Toast on new AI prediction
  useEffect(() => {
    if (!prediction) return;
    const key = `${prediction.symbol}-${prediction.direction}-${Math.round(prediction.confidence)}`;
    if (key !== prevPredictionRef.current) {
      prevPredictionRef.current = key;
      const emoji = prediction.direction === "up" ? "▲" : prediction.direction === "down" ? "▼" : "◆";
      toast(
        `${emoji} AI Signal: ${activeSymbol} ${prediction.direction.toUpperCase()} — ${prediction.confidence}% confidence`,
        { duration: 5000 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on signal identity, not object identity
  }, [prediction?.direction, prediction?.confidence, activeSymbol]);

  // Refresh Polygon budget display (state changes with each credit)
  useEffect(() => {
    const iv = setInterval(() => setPolygonBudget(getPolygonBudget()), 2000);
    return () => clearInterval(iv);
  }, []);

  // Mark-to-market loop: push live watchlist prices into the paper portfolio
  useEffect(() => {
    const iv = setInterval(() => {
      const prices: Record<string, number> = {};
      for (const w of useTradingStore.getState().watchlist) {
        if (w.price > 0) prices[w.symbol] = w.price;
      }
      usePortfolioStore.getState().markToMarket(prices);
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  // Alert on RSI crossings
  useEffect(() => {
    if (!indicators?.rsi14) return;
    const rsi = indicators.rsi14;
    const prev = prevRsiRef.current;
    prevRsiRef.current = rsi;

    if (prev !== null) {
      if (rsi > 70 && prev <= 70) {
        addAlert({
          id: `rsi-ob-${Date.now()}`,
          symbol: activeSymbol,
          type: "price_above",
          value: rsi,
          message: `RSI Overbought: ${activeSymbol} RSI = ${rsi.toFixed(1)} — Consider short bias`,
          timestamp: Date.now(),
          read: false,
        });
      } else if (rsi < 30 && prev >= 30) {
        addAlert({
          id: `rsi-os-${Date.now()}`,
          symbol: activeSymbol,
          type: "price_below",
          value: rsi,
          message: `RSI Oversold: ${activeSymbol} RSI = ${rsi.toFixed(1)} — Consider long bias`,
          timestamp: Date.now(),
          read: false,
        });
      }
    }
  }, [indicators?.rsi14, activeSymbol, addAlert]);

  return (
    <div className="flex flex-col h-screen bg-terminal-bg overflow-hidden">
      <Helmet>
        <title>Live Trading Terminal — Free Real-Time Charts & AI Forecasts — OmegaTrade Ultra</title>
        <meta name="description" content="Open the live trading terminal — real-time charts, order books, technical analysis and AI forecasts across stocks, crypto, forex, indices and futures. Free, no account." />
        <link rel="canonical" href="https://stock.unifies.codes/terminal" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://stock.unifies.codes/terminal" />
        <meta property="og:title" content="Live Trading Terminal — OmegaTrade Ultra" />
        <meta property="og:description" content="Free real-time multi-market trading terminal with AI forecasts, technical analysis and paper trading." />
        <meta property="og:image" content="https://stock.unifies.codes/og-image.png" />
      </Helmet>
      {scannerOpen && <MarketScanner />}
      <Header />
      <SafetyBanner />
      <AlertBanner />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left sidebar */}
        <Sidebar />

        {/* Center chart column */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-terminal-border overflow-hidden">
          <MarketStats />

          <div className="flex-1 min-h-0 relative" ref={mainRef}>
            {isLoadingCandles && <LoadingOverlay />}
            {candleError && !isLoadingCandles && (
              <ErrorPanel error={candleError} onRetry={loadCandles} />
            )}

            {/* Honest empty state: history is being built from the live stream,
                or a market has no free provider without a personal key. */}
            {candles.length === 0 && !isLoadingCandles && !candleError && candleSource && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none px-10">
                <div className="text-center max-w-md">
                  <div className="text-xs font-mono font-semibold text-brand-cyan text-glow-cyan mb-2 tracking-wider">
                    {candleSource.streaming ? "STREAMING HISTORY" : "AWAITING DATA"}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 leading-relaxed">
                    {candleSource.note || "Candles are built from the live market stream — they appear as real trades and quotes arrive."}
                  </div>
                </div>
              </div>
            )}

            <TradingChart height={containerHeight || 400} />

            {/* Indicator toggles */}
            <IndicatorToggles />

            {/* Symbol watermark */}
            <div className="absolute top-3 left-3 pointer-events-none select-none z-10">
              <span className="text-2xl font-mono font-bold text-editorial-ink/5">
                {activeSymbol}
              </span>
            </div>

            {/* AI badge */}
            {prediction && (
              <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 items-end">
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded glass-panel text-xs font-mono"
                  style={{
                    borderColor: prediction.direction === "up"
                      ? "rgba(10,156,54,0.3)"
                      : prediction.direction === "down"
                      ? "rgba(212,59,54,0.3)"
                      : "rgba(85,99,90,0.2)",
                    boxShadow: prediction.direction === "up"
                      ? "0 0 12px rgba(10,156,54,0.12)"
                      : prediction.direction === "down"
                      ? "0 0 12px rgba(212,59,54,0.12)"
                      : "none",
                  }}
                >
                  <Brain size={11} className="text-neural" />
                  <span className="text-slate-400">AI</span>
                  <span
                    className="font-bold"
                    style={{
                      color:
                        prediction.direction === "up" ? "#0a9c36" :
                        prediction.direction === "down" ? "#d43b36" : "#55635a",
                    }}
                  >
                    {prediction.direction.toUpperCase()}
                  </span>
                  <span className="text-slate-500">{prediction.confidence}%</span>
                </div>
                {mlStats?.isTraining && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded glass-panel text-xs font-mono text-neural">
                    <Loader2 size={10} className="animate-spin" />
                    <span>Retraining model...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Order ticket */}
          <TradingTicket />
        </div>

        {/* Right panel */}
        <div className="w-72 flex flex-col flex-none bg-terminal-bg overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-terminal-border flex-none">
            {RIGHT_PANEL_TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = rightPanel === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setRightPanel(tab.id)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-mono",
                    "border-r border-terminal-border/50 last:border-0",
                    "hover:bg-terminal-surface/50 transition-colors",
                    isActive ? "text-brand-cyan bg-terminal-surface/60" : "text-slate-600"
                  )}
                  style={isActive ? {
                    borderBottom: "2px solid #16a034",
                    boxShadow: "inset 0 -2px 8px rgba(22,160,52,0.12)",
                  } : {}}
                >
                  <Icon size={13} />
                  <span style={{ fontSize: 10 }}>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {rightPanel === "ml" && <MLPredictionPanel />}
            {rightPanel === "analyst" && <AnalystChat />}
            {rightPanel === "indicators" && <TechnicalIndicators />}
            {rightPanel === "orderbook" && <OrderBook />}
            {rightPanel === "news" && <NewsPanel />}
            {rightPanel === "portfolio" && <PortfolioPanel />}
            {rightPanel === "lab" && <StrategyLab />}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex-none h-6 border-t border-terminal-border bg-terminal-bg flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-slate-700">Ω OmegaTrade Ultra</span>
          <TickAge />
          <span className="text-xs font-mono text-slate-600 flex items-center gap-1.5 whitespace-nowrap">
            <span>Mesh:</span>
            {(["finnhub", "binance", "twelvedata", "yahoo", "coingecko", "coinbase", "kraken", "bybit", "okx", "bitstamp", "bitget", "htx", "gemini", "coinpaprika", "bitrue", "deribit", "bitmart", "kucoin", "mexc", "gateio", "poloniex", "frankfurter", "floatrates", "exchangerate"] as const).map(p => (
              <span key={p} title={p} className={providerStatus[p] === "live" || providerStatus[p] === "connected" ? "text-bull" : "text-slate-700"}>●</span>
            ))}
            {fastestProvider && (
              <span className="text-brand-cyan">FASTEST: {fastestProvider.name} {fastestProvider.ms.toFixed(0)}ms</span>
            )}
          </span>
          <span className="text-xs font-mono text-slate-600">
            TD {tdBudget.minuteUsed}/{tdBudget.minuteLimit}min · {tdBudget.dayUsed}/{tdBudget.dayLimit}day
          </span>
          <span className="text-xs font-mono text-slate-600">
            POLY {polygonBudget.minuteUsed}/{polygonBudget.minuteLimit}min · {polygonBudget.dayUsed}/{polygonBudget.dayLimit}day
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-slate-700">
          {mlStats && (
            <span>Model: Epoch {mlStats.trainingEpoch} · Loss {mlStats.loss.toFixed(5)} · Hard {mlStats.hardExamples}</span>
          )}
          <span>Paper Equity ${selectEquity(usePortfolioStore.getState()).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          <span>© 2026 OmegaTrade</span>
        </div>
      </footer>
    </div>
  );
}
