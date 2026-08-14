import { useTradingStore } from "@/stores/tradingStore";
import { BarChart2, Activity, TrendingUp } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { rsi as calcRsi, macd as calcMacd } from "@/lib/technicalAnalysis";

function RSIMeter({ value }: { value: number | null }) {
  if (value === null) return <div className="text-xs font-mono text-slate-600">Calculating...</div>;

  const color = value > 70 ? "#d43b36" : value < 30 ? "#0a9c36" : "#a16207";
  const label = value > 70 ? "OVERBOUGHT" : value < 30 ? "OVERSOLD" : "NEUTRAL";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-slate-500">RSI (14)</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold" style={{ color }}>
            {value.toFixed(1)}
          </span>
          <span
            className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
          >
            {label}
          </span>
        </div>
      </div>
      <div className="relative h-3 bg-terminal-border rounded-full overflow-hidden">
        {/* Zones */}
        <div className="absolute top-0 bottom-0 left-[30%] right-[30%] bg-bull/10" />
        <div className="absolute top-0 bottom-0 left-0 w-[30%] bg-bull/20" />
        <div className="absolute top-0 bottom-0 right-0 w-[30%] bg-bear/20" />
        {/* Indicator */}
        <div
          className="absolute top-0 bottom-0 w-1 rounded"
          style={{
            left: `${value}%`,
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      </div>
      <div className="flex justify-between text-xs font-mono text-slate-600">
        <span>0</span>
        <span className="text-bull">30 OS</span>
        <span className="text-bear">70 OB</span>
        <span>100</span>
      </div>
    </div>
  );
}

function IndicatorBadge({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 rounded bg-terminal-bg/50 border border-terminal-border/50">
      <span className="text-xs font-mono text-slate-500">{label}</span>
      <span className="text-xs font-mono font-semibold" style={{ color: color || "#121613" }}>
        {value}
      </span>
    </div>
  );
}

function SignalDot({ bullish }: { bullish: boolean | null }) {
  if (bullish === null) return <div className="w-2 h-2 rounded-full bg-slate-700" />;
  return (
    <div
      className="w-2 h-2 rounded-full"
      style={{
        backgroundColor: bullish ? "#0a9c36" : "#d43b36",
        boxShadow: `0 0 6px ${bullish ? "#0a9c36" : "#d43b36"}`,
      }}
    />
  );
}

export default function TechnicalIndicators() {
  const { indicators, candles } = useTradingStore();

  if (!indicators) {
    return (
      <div className="p-4 flex items-center justify-center h-full">
        <span className="text-xs font-mono text-slate-600">Loading indicators...</span>
      </div>
    );
  }

  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;

  // MACD signal
  const macdBullish = indicators.macd ? indicators.macd.histogram > 0 : null;
  const rsiBullish = indicators.rsi14 !== null
    ? indicators.rsi14 < 50 ? false : true
    : null;
  const emaBullish = indicators.ema20 && indicators.ema50
    ? indicators.ema20 > indicators.ema50
    : null;

  // Overall signal
  const signals = [macdBullish, rsiBullish, emaBullish].filter(s => s !== null);
  const bullCount = signals.filter(Boolean).length;
  const overallSignal = signals.length > 0
    ? bullCount > signals.length / 2 ? "BULLISH" : "BEARISH"
    : "NEUTRAL";
  const signalColor = overallSignal === "BULLISH" ? "#0a9c36" : overallSignal === "BEARISH" ? "#d43b36" : "#55635a";

  // Mini MACD chart data
  const macdChartData = candles.length > 0 ? (() => {
    const closes = candles.map(c => c.close);
    const macdResult = calcMacd(closes);
    return candles.slice(-30).map((c, i) => {
      const idx = candles.length - 30 + i;
      const hist = macdResult.histogram[idx];
      return { time: i, histogram: hist };
    }).filter(d => d.histogram !== null);
  })() : [];

  // Mini RSI chart
  const rsiChartData = candles.length > 0 ? (() => {
    const closes = candles.map(c => c.close);
    const rsiValues = calcRsi(closes);
    return candles.slice(-30).map((c, i) => {
      const idx = candles.length - 30 + i;
      return { time: i, rsi: rsiValues[idx] };
    }).filter(d => d.rsi !== null);
  })() : [];

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Overall Signal */}
      <div
        className="terminal-panel p-3 flex items-center justify-between"
        style={{ borderColor: `${signalColor}40`, boxShadow: `0 0 10px ${signalColor}10` }}
      >
        <div>
          <div className="text-xs font-mono text-slate-500 mb-0.5">COMPOSITE SIGNAL</div>
          <div className="text-base font-mono font-bold" style={{ color: signalColor }}>
            {overallSignal}
          </div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <div className="flex items-center gap-1.5">
            <SignalDot bullish={macdBullish} />
            <span className="text-xs font-mono text-slate-500">MACD</span>
          </div>
          <div className="flex items-center gap-1.5">
            <SignalDot bullish={rsiBullish} />
            <span className="text-xs font-mono text-slate-500">RSI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <SignalDot bullish={emaBullish} />
            <span className="text-xs font-mono text-slate-500">EMA</span>
          </div>
        </div>
      </div>

      {/* RSI */}
      <div className="terminal-panel p-3">
        <RSIMeter value={indicators.rsi14} />
        {rsiChartData.length > 5 && (
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={50}>
              <LineChart data={rsiChartData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                <YAxis domain={[0, 100]} tick={false} />
                <ReferenceLine y={70} stroke="#d43b3640" strokeDasharray="2 2" />
                <ReferenceLine y={30} stroke="#0a9c3640" strokeDasharray="2 2" />
                <Line
                  type="monotone"
                  dataKey="rsi"
                  stroke="#a16207"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* MACD */}
      <div className="terminal-panel p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-slate-500">MACD (12,26,9)</span>
          {indicators.macd && (
            <span className={`text-xs font-mono font-bold ${indicators.macd.histogram > 0 ? "text-bull" : "text-bear"}`}>
              {indicators.macd.histogram > 0 ? "▲" : "▼"} {Math.abs(indicators.macd.histogram).toFixed(4)}
            </span>
          )}
        </div>
        {macdChartData.length > 5 && (
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={macdChartData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
              <XAxis dataKey="time" hide />
              <YAxis tick={false} />
              <ReferenceLine y={0} stroke="#c8d2c8" />
              <Bar dataKey="histogram" radius={1}>
                {macdChartData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={(entry.histogram as number) > 0 ? "#0a9c3688" : "#d43b3688"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {indicators.macd && (
          <div className="grid grid-cols-3 gap-1 mt-1">
            <div>
              <div className="text-xs font-mono text-slate-600" style={{ fontSize: 10 }}>MACD</div>
              <div className="text-xs font-mono text-brand-cyan">{indicators.macd.value.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs font-mono text-slate-600" style={{ fontSize: 10 }}>Signal</div>
              <div className="text-xs font-mono text-predict">{indicators.macd.signal.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs font-mono text-slate-600" style={{ fontSize: 10 }}>Hist</div>
              <div className={`text-xs font-mono ${indicators.macd.histogram > 0 ? "text-bull" : "text-bear"}`}>
                {indicators.macd.histogram.toFixed(4)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Key Levels */}
      <div className="terminal-panel p-3 space-y-1.5">
        <div className="text-xs font-mono text-slate-500 mb-2">KEY LEVELS</div>
        {indicators.ema20 && (
          <IndicatorBadge label="EMA 20" value={indicators.ema20.toFixed(4)} color="#16a034" />
        )}
        {indicators.ema50 && (
          <IndicatorBadge label="EMA 50" value={indicators.ema50.toFixed(4)} color="#a16207" />
        )}
        {indicators.bb && (
          <>
            <IndicatorBadge label="BB Upper" value={indicators.bb.upper.toFixed(4)} color="#7c3aed" />
            <IndicatorBadge label="BB Middle" value={indicators.bb.middle.toFixed(4)} color="#7c3aed80" />
            <IndicatorBadge label="BB Lower" value={indicators.bb.lower.toFixed(4)} color="#7c3aed" />
          </>
        )}
        {indicators.vwap && (
          <IndicatorBadge label="VWAP" value={indicators.vwap.toFixed(4)} color="#0e7490" />
        )}
        {indicators.atr14 && (
          <IndicatorBadge label="ATR (14)" value={indicators.atr14.toFixed(4)} color="#b45309" />
        )}
        {indicators.stochastic && (
          <>
            <IndicatorBadge
              label="Stoch %K"
              value={indicators.stochastic.k.toFixed(1)}
              color={indicators.stochastic.k > 80 ? "#d43b36" : indicators.stochastic.k < 20 ? "#0a9c36" : "#55635a"}
            />
            <IndicatorBadge
              label="Stoch %D"
              value={indicators.stochastic.d.toFixed(1)}
              color="#55635a"
            />
          </>
        )}
        {indicators.adx !== null && indicators.adx !== undefined && (
          <IndicatorBadge
            label="ADX"
            value={indicators.adx.toFixed(1)}
            color={indicators.adx > 25 ? "#a16207" : "#55635a"}
          />
        )}
      </div>
    </div>
  );
}
