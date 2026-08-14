import { useEffect, useRef, useCallback } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import {
  fetchCandles, fetchDailySeed, getTDBudget,
} from "@/lib/dataProviders";
import { computeIndicators } from "@/lib/technicalAnalysis";
import { getEngine, evaluateAllOutcomes } from "@/lib/mlEngine";
import { finnhubTradeWS, binanceStreamWS, twelvedataQuoteWS, aggregator } from "@/lib/realtime";
import { startLiveFeeds } from "@/lib/feeds";
import { TIMEFRAME_SECONDS, ML_CONFIG } from "@/constants/config";
import type { OHLCV, Timeframe, MarketType } from "@/types";

/** Map Timeframe -> provider interval string */
function getIntervalStr(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    "1min": "1min", "5min": "5min", "15min": "15min",
    "30min": "30min", "1h": "1h", "4h": "4h", "1day": "1day",
  };
  return map[tf] || "15min";
}

/** Daily seeds fetched once per session per symbol (ML priming + chart fallback) */
const dailySeedFetched = new Set<string>();

export function useMarketData() {
  const mlBusyRef = useRef(false);
  const lastChartKeyRef = useRef("");

  /* ── Ensure global live feeds are running (idempotent) ───── */
  useEffect(() => {
    startLiveFeeds();
  }, []);

  /* ── Load candle history for the active symbol ────────────── */
  const loadCandles = useCallback(async () => {
    const state = useTradingStore.getState();
    const { activeSymbol, activeMarket, activeTimeframe } = state;

    state.setIsLoadingCandles(true);
    state.setCandleError(null);
    aggregator.setActive(activeSymbol, activeTimeframe);

    try {
      const result = await fetchCandles(activeSymbol, activeMarket, getIntervalStr(activeTimeframe));

      if (result.candles.length > 0) {
        aggregator.setHistory(activeSymbol, activeTimeframe, result.candles);
        const series = aggregator.getActiveSeries();
        // Copy the array: the aggregator mutates its internal buffer in place,
        // so a fresh reference is required for selector subscribers to re-render.
        state.setCandles([...series]);
        state.setIndicators(computeIndicators(series));
        state.setCandleSource({
          provider: result.source,
          streaming: false,
          historyCandles: result.candles.length,
          cached: result.note === "cached",
        });
      } else {
        // No provider history available → live aggregation builds it (real ticks only)
        state.setCandles([...aggregator.getActiveSeries()]);
        state.setCandleSource({
          provider: "live-aggregate",
          streaming: true,
          historyCandles: 0,
          cached: false,
          note: result.note,
        });

        // Prime the ML engine with real daily history (stocks/indices/forex, once per session)
        if (activeMarket !== "crypto" && activeTimeframe !== "1day" && !dailySeedFetched.has(activeSymbol)) {
          dailySeedFetched.add(activeSymbol);
          try {
            const seed = await fetchDailySeed(activeSymbol, activeMarket);
            if (seed.length >= 30) {
              const engine = getEngine(activeSymbol, s => useTradingStore.getState().setMLStats(s));
              engine.train(seed, { quick: true }).catch(() => {});
              state.setCandleSource({
                provider: "live-aggregate",
                streaming: true,
                historyCandles: 0,
                cached: false,
                note: `${result.note} · model primed on ${seed.length} daily bars`,
              });
            }
          } catch { /* ignore */ }
        }
      }
      state.setIsLoadingCandles(false);
    } catch (err: unknown) {
      console.error("[MarketData] Load candles error:", err);
      state.setCandleError(err instanceof Error ? err.message : "Failed to load chart data");
      state.setIsLoadingCandles(false);
    }
  }, []);

  /* ── ML loop: predict + evaluate outcomes + failure retrain ── */
  const runML = useCallback(() => {
    const state = useTradingStore.getState();
    const tfSeconds = TIMEFRAME_SECONDS[state.activeTimeframe] || 900;
    const engine = getEngine(state.activeSymbol, s => useTradingStore.getState().setMLStats(s));
    engine.setTimeframeSeconds(tfSeconds);

    // Prefer the active-TF series; fall back to the denser 1-minute series while history builds
    const series = aggregator.getActiveSeries();
    const minSeries = aggregator.getMinuteSeries();
    const mlSeries = series.length >= 12 ? series : minSeries.length >= 12 ? minSeries : series;

    if (mlSeries.length >= 12 && !mlBusyRef.current) {
      if (!engine.isInitialized() && mlSeries.length >= 34) {
        mlBusyRef.current = true;
        engine.train(mlSeries, { quick: true }).finally(() => { mlBusyRef.current = false; });
      } else if (engine.isInitialized()) {
        const pred = engine.predict(mlSeries, tfSeconds);
        if (pred) {
          state.setPrediction({ ...pred, symbol: state.activeSymbol });
          state.appendPredictionHistory({
            time: Date.now(),
            price: mlSeries[mlSeries.length - 1].close,
            predicted: pred.targetPrice,
            direction: pred.direction,
          });

          // Epistemic uncertainty (Monte-Carlo dropout) → circuit breaker guard.
          // A breaker halts autonomous learning (retrain + online updates) until
          // prediction variance drops back below the safe threshold.
          const { variance, std, mcPasses } = pred.uncertainty;
          const status = std >= ML_CONFIG.UNCERTAINTY_CIRCUIT
            ? "circuit"
            : std >= ML_CONFIG.UNCERTAINTY_ELEVATED
              ? "elevated"
              : "stable";
          state.setUncertainty({
            variance, std, mcPasses,
            thresholdElevated: ML_CONFIG.UNCERTAINTY_ELEVATED,
            thresholdCircuit: ML_CONFIG.UNCERTAINTY_CIRCUIT,
            status,
          });
          const breaker = status === "circuit";
          state.setCircuitBreaker(breaker);
          // Circuit breaker / data-integrity fault → freeze autonomous learning
          engine.setAutonomous(!breaker && !state.integrityFault);

          // Autonomous retraining when the model's rolling accuracy degrades
          if (engine.needsRetrain() && !mlBusyRef.current) {
            mlBusyRef.current = true;
            engine.train(mlSeries, { retrain: true, quick: true })
              .finally(() => { mlBusyRef.current = false; });
          }
        }
      }
    }

    // Resolve pending predictions for ALL symbols against real prices
    const prices = new Map<string, number>();
    const candlesBySymbol = new Map<string, OHLCV[]>();
    for (const w of state.watchlist) {
      if (w.price > 0) prices.set(w.symbol, w.price);
      candlesBySymbol.set(w.symbol, aggregator.getSeries(w.symbol, "1min"));
    }
    evaluateAllOutcomes(prices, candlesBySymbol);

    // Sync verified outcomes to the UI
    state.setOutcomes(engine.getOutcomes());
  }, []);

  /* ── React to symbol / market / timeframe changes ─────────── */
  const { activeSymbol, activeMarket, activeTimeframe } = useTradingStore();
  useEffect(() => {
    if (activeMarket === "stocks" || activeMarket === "indices") finnhubTradeWS.subscribe(activeSymbol);
    if (activeMarket === "crypto") binanceStreamWS.setActiveKline(activeSymbol, activeTimeframe);
    if (activeMarket === "forex") twelvedataQuoteWS.setSymbol(activeSymbol);
    else twelvedataQuoteWS.setSymbol(null);

    loadCandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol, activeMarket, activeTimeframe]);

  /* ── Sync loop: push aggregated candles + provider status ─── */
  useEffect(() => {
    const iv = setInterval(() => {
      const state = useTradingStore.getState();
      const series = aggregator.getActiveSeries();
      if (series.length > 0) {
        const last = series[series.length - 1];
        const key = `${last.time}:${last.close}:${last.volume}:${series.length}`;
        if (key !== lastChartKeyRef.current) {
          lastChartKeyRef.current = key;
          // Fresh array reference → store subscribers re-render on every live bar
          state.setCandles([...series]);
          state.setIndicators(computeIndicators(series));
          runML();
        }
      }

      state.setLiveCandles(aggregator.getMinuteSeries().length);
      state.setProviderStatus({
        finnhub: finnhubTradeWS.status,
        binance: binanceStreamWS.status,
        twelvedata: twelvedataQuoteWS.status,
      });
      const b = getTDBudget();
      state.setTdBudget({ minuteUsed: b.minuteUsed, minuteLimit: b.minuteLimit, dayUsed: b.dayUsed, dayLimit: b.dayLimit, provider: "TwelveData" });
    }, 400);
    return () => clearInterval(iv);
  }, [runML]);

  /* ── Background outcome resolution (every 60s) ────────────── */
  useEffect(() => {
    const iv = setInterval(() => {
      const state = useTradingStore.getState();
      const prices = new Map<string, number>();
      const candlesBySymbol = new Map<string, OHLCV[]>();
      for (const w of state.watchlist) {
        if (w.price > 0) prices.set(w.symbol, w.price);
        candlesBySymbol.set(w.symbol, aggregator.getSeries(w.symbol, "1min"));
      }
      evaluateAllOutcomes(prices, candlesBySymbol);
      state.setOutcomes(getEngine(state.activeSymbol).getOutcomes());
    }, 60000);
    return () => clearInterval(iv);
  }, []);

  return { loadCandles };
}
