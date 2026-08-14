import type { OHLCV, TechnicalIndicators } from "@/types";

/** Simple Moving Average */
export function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

/** Exponential Moving Average */
export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prevEma: number | null = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result[i] = null;
      continue;
    }
    if (i === period - 1) {
      const initSlice = values.slice(0, period);
      prevEma = initSlice.reduce((a, b) => a + b, 0) / period;
      result[i] = prevEma;
      continue;
    }
    prevEma = values[i] * k + prevEma! * (1 - k);
    result[i] = prevEma;
  }
  return result;
}

/** Relative Strength Index */
export function rsi(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < values.length; i++) {
    if (i === period) {
      const rs = avgGain / (avgLoss || 0.0001);
      result[i] = 100 - 100 / (1 + rs);
      continue;
    }
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgGain / (avgLoss || 0.0001);
    result[i] = 100 - 100 / (1 + rs);
  }
  return result;
}

/** MACD */
export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(values, fastPeriod);
  const emaSlow = ema(values, slowPeriod);

  const macdLine: (number | null)[] = values.map((_, i) => {
    if (emaFast[i] === null || emaSlow[i] === null) return null;
    return emaFast[i]! - emaSlow[i]!;
  });

  const macdValues = macdLine.filter((v) => v !== null) as number[];
  const signalEma = ema(macdValues, signalPeriod);

  const signal: (number | null)[] = new Array(values.length).fill(null);
  const histogram: (number | null)[] = new Array(values.length).fill(null);

  let macdIdx = 0;
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] !== null) {
      signal[i] = signalEma[macdIdx] ?? null;
      if (macdLine[i] !== null && signal[i] !== null) {
        histogram[i] = macdLine[i]! - signal[i]!;
      }
      macdIdx++;
    }
  }

  return { macd: macdLine, signal, histogram };
}

/** Bollinger Bands */
export function bollingerBands(
  values: number[],
  period = 20,
  stdDev = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i]!;
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = mean + stdDev * std;
    lower[i] = mean - stdDev * std;
  }

  return { upper, middle, lower };
}

/** Average True Range */
export function atr(candles: OHLCV[], period = 14): (number | null)[] {
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  const result: (number | null)[] = [null];
  let prevAtr: number | null = null;

  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (i === period - 1) {
      prevAtr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(prevAtr);
      continue;
    }
    prevAtr = (prevAtr! * (period - 1) + trueRanges[i]) / period;
    result.push(prevAtr);
  }
  return result;
}

/** Stochastic Oscillator */
export function stochastic(
  candles: OHLCV[],
  kPeriod = 14,
  dPeriod = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const k: (number | null)[] = new Array(candles.length).fill(null);

  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const lowest = Math.min(...slice.map((c) => c.low));
    const highest = Math.max(...slice.map((c) => c.high));
    const range = highest - lowest;
    k[i] = range === 0 ? 50 : ((candles[i].close - lowest) / range) * 100;
  }

  const kValid = k.filter((v) => v !== null) as number[];
  const dEma = sma(kValid, dPeriod);
  const d: (number | null)[] = new Array(candles.length).fill(null);

  let kIdx = 0;
  for (let i = 0; i < candles.length; i++) {
    if (k[i] !== null) {
      d[i] = dEma[kIdx] ?? null;
      kIdx++;
    }
  }

  return { k, d };
}

/** ADX (Average Directional Index) */
export function adx(candles: OHLCV[], period = 14): (number | null)[] {
  if (candles.length < period * 2) return new Array(candles.length).fill(null);

  const result: (number | null)[] = new Array(candles.length).fill(null);
  const trValues: number[] = [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    trValues.push(Math.max(hl, hc, lc));

    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let smoothTR = trValues.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothDMPlus = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothDMMinus = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let i = period; i < trValues.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trValues[i];
    smoothDMPlus = smoothDMPlus - smoothDMPlus / period + dmPlus[i];
    smoothDMMinus = smoothDMMinus - smoothDMMinus / period + dmMinus[i];

    const diPlus = smoothTR > 0 ? (smoothDMPlus / smoothTR) * 100 : 0;
    const diMinus = smoothTR > 0 ? (smoothDMMinus / smoothTR) * 100 : 0;
    const diSum = diPlus + diMinus;
    const dx = diSum > 0 ? (Math.abs(diPlus - diMinus) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  let adxVal = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period * 2 - 1 + 1] = adxVal;

  for (let i = period; i < dxValues.length; i++) {
    adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
    result[i + period + 1] = adxVal;
  }

  return result;
}

/** VWAP */
export function vwap(candles: OHLCV[]): (number | null)[] {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  return candles.map((c) => {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null;
  });
}

/** Compute all indicators from candle array */
export function computeIndicators(candles: OHLCV[]): TechnicalIndicators {
  if (candles.length < 26) {
    return {
      rsi14: null, macd: null, ema20: null, ema50: null,
      sma200: null, bb: null, atr14: null, stochastic: null,
      vwap: null, adx: null,
    };
  }

  const closes = candles.map((c) => c.close);
  const n = closes.length;

  const rsiValues = rsi(closes);
  const macdResult = macd(closes);
  const ema20Values = ema(closes, 20);
  const ema50Values = ema(closes, 50);
  const sma200Values = sma(closes, 200);
  const bbResult = bollingerBands(closes, 20);
  const atrValues = atr(candles);
  const stochResult = stochastic(candles);
  const vwapValues = vwap(candles);
  const adxValues = adx(candles);

  const getLastValid = <T>(arr: (T | null)[]): T | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null) return arr[i] as T;
    }
    return null;
  };

  const macdVal = getLastValid(macdResult.macd);
  const macdSig = getLastValid(macdResult.signal);
  const macdHist = getLastValid(macdResult.histogram);

  const bbUpper = getLastValid(bbResult.upper);
  const bbMiddle = getLastValid(bbResult.middle);
  const bbLower = getLastValid(bbResult.lower);

  const stochK = getLastValid(stochResult.k);
  const stochD = getLastValid(stochResult.d);

  return {
    rsi14: getLastValid(rsiValues),
    macd: macdVal !== null && macdSig !== null && macdHist !== null
      ? { value: macdVal, signal: macdSig, histogram: macdHist }
      : null,
    ema20: getLastValid(ema20Values),
    ema50: getLastValid(ema50Values),
    sma200: getLastValid(sma200Values),
    bb: bbUpper !== null && bbMiddle !== null && bbLower !== null
      ? { upper: bbUpper, middle: bbMiddle, lower: bbLower }
      : null,
    atr14: getLastValid(atrValues),
    stochastic: stochK !== null && stochD !== null
      ? { k: stochK, d: stochD }
      : null,
    vwap: getLastValid(vwapValues),
    adx: getLastValid(adxValues),
  };
}

/** Normalize value to 0-1 range */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** Extract ML feature vector from candles */
export function extractFeatures(candles: OHLCV[]): number[] {
  if (candles.length === 0) return [];
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;

  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const minVol = Math.min(...volumes);
  const maxVol = Math.max(...volumes);

  const features: number[] = [];
  for (const c of candles) {
    features.push(normalize(c.close, minClose, maxClose));
    features.push(normalize(c.open, minClose, maxClose));
    features.push(normalize(c.high, minClose, maxClose));
    features.push(normalize(c.low, minClose, maxClose));
    features.push(normalize(c.volume, minVol, maxVol));

    // Price action features
    const bodySize = Math.abs(c.close - c.open) / (maxClose - minClose + 0.0001);
    const upperWick = (c.high - Math.max(c.open, c.close)) / (maxClose - minClose + 0.0001);
    const lowerWick = (Math.min(c.open, c.close) - c.low) / (maxClose - minClose + 0.0001);
    features.push(bodySize);
    features.push(upperWick);
    features.push(lowerWick);
  }

  return features;
}
