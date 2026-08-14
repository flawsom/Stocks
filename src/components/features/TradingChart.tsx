import { useEffect, useRef, useCallback, memo } from "react";
import { useTradingStore } from "@/stores/tradingStore";
import { usePortfolioStore } from "@/stores/portfolioStore";
import { ema as calcEma, bollingerBands, vwap as calcVwap } from "@/lib/technicalAnalysis";
import { TIMEFRAME_SECONDS } from "@/constants/config";
import type { IChartApi, ISeriesApi, LineStyle, ColorType, CrosshairMode, UTCTimestamp, LineWidth } from "lightweight-charts";

const toTime = (t: number) => t as UTCTimestamp;

let lwc: typeof import("lightweight-charts") | null = null;

async function getLWC() {
  if (lwc) return lwc;
  lwc = await import("lightweight-charts");
  return lwc;
}

const CHART_COLORS = {
  bg: "#fafffa",
  grid: "#e4ebe2",
  text: "#516254",
  border: "#c8d2c8",
  crosshair: "#93a08f",
  up: "#0a9c36",
  upWick: "#0b8a31",
  down: "#d43b36",
  downWick: "#bb352f",
  ema20: "#16a034",
  ema50: "#a16207",
  bbUpper: "#7c3aed88",
  bbLower: "#7c3aed88",
  vwap: "#0e7490",
  predict: "#a16207",
  predictUpper: "#a1620788",
  predictLower: "#a1620788",
  volUp: "#0a9c3640",
  volDown: "#d43b3640",
};

interface TradingChartProps {
  height?: number;
}

const TradingChart = memo(({ height = 400 }: TradingChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle?: ISeriesApi<"Candlestick">;
    vol?: ISeriesApi<"Histogram">;
    ema20?: ISeriesApi<"Line">;
    ema50?: ISeriesApi<"Line">;
    bbUpper?: ISeriesApi<"Line">;
    bbLower?: ISeriesApi<"Line">;
    vwap?: ISeriesApi<"Line">;
    predict?: ISeriesApi<"Line">;
    predictUpper?: ISeriesApi<"Line">;
    predictLower?: ISeriesApi<"Line">;
  }>({});
  const initializedRef = useRef(false);
  const appliedSigRef = useRef<string | null>(null);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);

  const { candles, showIndicators, prediction, activeTimeframe, outcomes, showAttribution } = useTradingStore();

  const initChart = useCallback(async () => {
    if (!containerRef.current || initializedRef.current) return;

    try {
      const lib = await getLWC();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      const chartHeight = Math.max(300, height - 80);
      const chart = lib.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: chartHeight,
        layout: {
          background: { type: "solid" as ColorType, color: CHART_COLORS.bg },
          textColor: CHART_COLORS.text,
          fontSize: 11,
          fontFamily: "JetBrains Mono, monospace",
        },
        grid: {
          vertLines: { color: CHART_COLORS.grid, style: lib.LineStyle?.Dashed ?? 1 },
          horzLines: { color: CHART_COLORS.grid, style: lib.LineStyle?.Dashed ?? 1 },
        },
        crosshair: {
          mode: lib.CrosshairMode?.Normal ?? 1,
          vertLine: {
            color: CHART_COLORS.crosshair, width: 1,
            style: lib.LineStyle?.Dashed ?? 1, labelBackgroundColor: "#121613",
          },
          horzLine: {
            color: CHART_COLORS.crosshair, width: 1,
            style: lib.LineStyle?.Dashed ?? 1, labelBackgroundColor: "#121613",
          },
        },
        rightPriceScale: {
          borderColor: CHART_COLORS.border,
          textColor: CHART_COLORS.text,
          scaleMargins: { top: 0.08, bottom: 0.25 },
        },
        timeScale: {
          borderColor: CHART_COLORS.border,
          timeVisible: true,
          secondsVisible: false,
          fixLeftEdge: false,
          fixRightEdge: false,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });

      chartRef.current = chart;

      const volSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      seriesRef.current.vol = volSeries;

      const candleSeries = chart.addCandlestickSeries({
        upColor: CHART_COLORS.up,
        downColor: CHART_COLORS.down,
        borderUpColor: CHART_COLORS.up,
        borderDownColor: CHART_COLORS.down,
        wickUpColor: CHART_COLORS.upWick,
        wickDownColor: CHART_COLORS.downWick,
      });
      seriesRef.current.candle = candleSeries;

      const makeLine = (color: string, style: LineStyle, width: LineWidth = 1) =>
        chart.addLineSeries({
          color, lineWidth: width, lineStyle: style,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });

      seriesRef.current.ema20 = makeLine(CHART_COLORS.ema20, lib.LineStyle?.Solid ?? 0);
      seriesRef.current.ema50 = makeLine(CHART_COLORS.ema50, lib.LineStyle?.Solid ?? 0);
      seriesRef.current.bbUpper = makeLine(CHART_COLORS.bbUpper, lib.LineStyle?.Dashed ?? 1);
      seriesRef.current.bbLower = makeLine(CHART_COLORS.bbLower, lib.LineStyle?.Dashed ?? 1);
      seriesRef.current.vwap = makeLine(CHART_COLORS.vwap, lib.LineStyle?.Dotted ?? 2);

      const predictLine = chart.addLineSeries({
        color: CHART_COLORS.predict, lineWidth: 2,
        lineStyle: lib.LineStyle?.Dashed ?? 1,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        title: "AI Target",
      });
      seriesRef.current.predict = predictLine;

      seriesRef.current.predictUpper = makeLine(CHART_COLORS.predictUpper, lib.LineStyle?.Dotted ?? 2, 1);
      seriesRef.current.predictLower = makeLine(CHART_COLORS.predictLower, lib.LineStyle?.Dotted ?? 2, 1);

      const resizeObserver = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      if (containerRef.current) resizeObserver.observe(containerRef.current);

      initializedRef.current = true;
      return () => resizeObserver.disconnect();
    } catch (err) {
      console.error("[TradingChart] Init error:", err);
    }
  }, [height]);

  const updateData = useCallback(() => {
    if (!chartRef.current || !initializedRef.current || candles.length === 0) return;

    const s = seriesRef.current;
    const closes = candles.map(c => c.close);
    const last = candles[candles.length - 1];

    // Grad-CAM-style XAI: color candles by the model's per-candle attribution
    // (green glow = bullish-attributed candle, red = bearish-attributed).
    const activeSym = useTradingStore.getState().activeSymbol;
    const attrMap = new Map<number, number>();
    if (showAttribution && prediction?.symbol === activeSym && prediction.attribution) {
      for (const a of prediction.attribution) attrMap.set(a.time, a.score);
    }
    const candleData: {
      time: UTCTimestamp; open: number; high: number; low: number; close: number;
      color?: string; borderColor?: string; wickColor?: string;
    }[] = candles.map(c => {
      const base = { time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close };
      const sc = attrMap.get(c.time);
      if (sc === undefined) return base;
      const alpha = 0.28 + Math.min(0.6, Math.abs(sc) * 0.62);
      const color = sc >= 0 ? `rgba(10,156,54,${alpha.toFixed(2)})` : `rgba(212,59,54,${alpha.toFixed(2)})`;
      return { ...base, color, borderColor: color, wickColor: color };
    });

    // Efficient live path: update the last bar; full setData when the series is replaced.
    // The symbol is part of the signature so switching symbols can never collide with
    // the live-update fast path and render the wrong series.
    const sig = `${activeSym}:${candleData[0]?.time}:${last.time}:${candleData.length}:${showAttribution}`;
    const liveUpdate = appliedSigRef.current === sig;

    try {
      if (liveUpdate) {
        const bar = candleData[candleData.length - 1];
        s.candle?.update(bar);
        s.vol?.update({ time: bar.time, value: last.volume, color: last.close >= last.open ? CHART_COLORS.volUp : CHART_COLORS.volDown });
      } else {
        s.candle?.setData(candleData);
        s.vol?.setData(candles.map(c => ({
          time: toTime(c.time), value: c.volume,
          color: c.close >= c.open ? CHART_COLORS.volUp : CHART_COLORS.volDown,
        })));
        appliedSigRef.current = sig;
      }
    } catch { /* transient */ }

    const setLine = (series: ISeriesApi<"Line"> | undefined, data: { time: UTCTimestamp; value: number }[]) => {
      try { series?.setData(data); } catch { /* ignore */ }
    };

    if (showIndicators.ema) {
      const e20 = calcEma(closes, 20);
      const e50 = calcEma(closes, 50);
      setLine(s.ema20, candles.map((c, i) => e20[i] !== null ? { time: toTime(c.time), value: e20[i]! } : null).filter(Boolean) as { time: UTCTimestamp; value: number }[]);
      setLine(s.ema50, candles.map((c, i) => e50[i] !== null ? { time: toTime(c.time), value: e50[i]! } : null).filter(Boolean) as { time: UTCTimestamp; value: number }[]);
    } else {
      setLine(s.ema20, []); setLine(s.ema50, []);
    }

    if (showIndicators.bb) {
      const bb = bollingerBands(closes, 20, 2);
      setLine(s.bbUpper, candles.map((c, i) => bb.upper[i] !== null ? { time: toTime(c.time), value: bb.upper[i]! } : null).filter(Boolean) as { time: UTCTimestamp; value: number }[]);
      setLine(s.bbLower, candles.map((c, i) => bb.lower[i] !== null ? { time: toTime(c.time), value: bb.lower[i]! } : null).filter(Boolean) as { time: UTCTimestamp; value: number }[]);
    } else {
      setLine(s.bbUpper, []); setLine(s.bbLower, []);
    }

    if (showIndicators.vwap) {
      const vw = calcVwap(candles);
      setLine(s.vwap, candles.map((c, i) => vw[i] !== null ? { time: toTime(c.time), value: vw[i]! } : null).filter(Boolean) as { time: UTCTimestamp; value: number }[]);
    } else {
      setLine(s.vwap, []);
    }

    // AI prediction cone: current → target with upper/lower uncertainty band
    const tfSeconds = TIMEFRAME_SECONDS[activeTimeframe] || 900;
    if (prediction && prediction.symbol === useTradingStore.getState().activeSymbol) {
      const predTime = Math.floor(prediction.targetTime / 1000);
      if (predTime > last.time) {
        setLine(s.predict, [
          { time: toTime(last.time), value: last.close },
          { time: toTime(predTime), value: prediction.targetPrice },
        ]);
        setLine(s.predictUpper, [
          { time: toTime(last.time), value: last.close },
          { time: toTime(predTime), value: prediction.upper },
        ]);
        setLine(s.predictLower, [
          { time: toTime(last.time), value: last.close },
          { time: toTime(predTime), value: prediction.lower },
        ]);
      } else {
        setLine(s.predict, []); setLine(s.predictUpper, []); setLine(s.predictLower, []);
      }

      // Verified hit/miss markers aligned to candle buckets
      const markers = outcomes
        .filter(o => o.resolvedAt !== null && o.symbol === useTradingStore.getState().activeSymbol)
        .slice(-8)
        .map(o => {
          const bucket = Math.floor((o.resolvedAt! / 1000) / tfSeconds) * tfSeconds;
          return {
            time: toTime(bucket),
            position: (o.hit ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
            color: o.hit ? "#0a9c36" : "#d43b36",
            shape: (o.hit ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
            text: o.hit ? "✓" : "✗",
          };
        });
      try { s.candle?.setMarkers(markers); } catch { /* ignore */ }
    } else {
      setLine(s.predict, []); setLine(s.predictUpper, []); setLine(s.predictLower, []);
      try { s.candle?.setMarkers([]); } catch { /* ignore */ }
    }

    // Paper-trading entry lines: open position averages for the active symbol
    const positions = usePortfolioStore.getState().positions.filter(p => p.symbol === activeSym);
    const candleSeries = s.candle;
    if (candleSeries) {
      // Remove stale lines, then redraw current positions
      for (const pl of priceLinesRef.current) {
        try { candleSeries.removePriceLine(pl); } catch { /* ignore */ }
      }
      priceLinesRef.current = [];
      for (const p of positions) {
        try {
          priceLinesRef.current.push(candleSeries.createPriceLine({
            price: p.avgPrice,
            color: p.side === "long" ? "#0a9c36" : "#d43b36",
            lineWidth: 1 as LineWidth,
            lineStyle: 2 as LineStyle, // Dashed
            axisLabelVisible: true,
            title: `${p.side === "long" ? "L" : "S"} ${p.qty} @`,
          }));
        } catch { /* ignore */ }
      }
    }

    try { chartRef.current?.timeScale().scrollToRealTime(); } catch { /* ignore */ }
  }, [candles, showIndicators, prediction, outcomes, activeTimeframe, showAttribution]);

  useEffect(() => {
    initChart();
    return () => {
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* ignore */ }
        chartRef.current = null;
        initializedRef.current = false;
        seriesRef.current = {};
        appliedSigRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chart created once on mount
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      try { chartRef.current.applyOptions({ height: Math.max(300, height - 80) }); } catch { /* ignore */ }
    }
  }, [height]);

  useEffect(() => {
    if (!initializedRef.current) {
      const timer = setTimeout(updateData, 500);
      return () => clearTimeout(timer);
    }
    updateData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateData closes over store state via getState
  }, [candles, showIndicators, prediction, outcomes, activeTimeframe, showAttribution]);

  return (
    <div
      ref={containerRef}
      className="w-full bg-terminal-bg"
      style={{ height: Math.max(300, height - 80) }}
    />
  );
});

TradingChart.displayName = "TradingChart";
export default TradingChart;
