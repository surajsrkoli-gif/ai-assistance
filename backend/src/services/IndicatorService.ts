/* ============================================================================
   backend/src/services/IndicatorService.ts
   ----------------------------------------------------------------------------
   PHASE 5 — Deterministic technical indicators over normalized OHLCV.

   Guarantees
     • Pure functions. No I/O, no env, no logging.
     • Every result is aligned 1:1 with the input array, index-by-index.
     • Warm-up periods produce null, never a fabricated value.
     • Non-finite inputs are rejected (skipped, treated as gaps).
     • Input is expected to be the Phase 4B normalized series: complete OHLC,
       optional volume, sorted oldest-first, unique timestamps.

   Conventions
     • SMA/EMA/Bollinger use standard multipliers.
     • RSI, ATR, and ADX use Wilder-style smoothing.
     • EMA seeds with SMA(period) at index period-1.
     • All periods are integers ≥ 1.
     • Null propagates through derived calculations.

   Warm-up summary
     SMA(period)              → first valid at index period-1
     EMA(period)              → first valid at index period-1 (SMA seed)
     RSI(14)                  → first valid at index 14
     MACD(12,26,9) signal     → first valid at index 33
     Bollinger(20,2)          → first valid at index 19
     ATR(14)                  → first valid at index 14
     ADX(14)                  → first valid at index 27
     volumeSma(20)            → first valid at index 19
   ============================================================================ */

import type { NormalizedMarketData } from '../providers/MarketDataProvider';

/* ============================================================================
   Types
   ============================================================================ */

/** A candle with non-null OHLC. Volume may still be null. */
export interface ClosedCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface MacdResult {
  line: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  bandwidth: (number | null)[];
  percentB: (number | null)[];
}

export interface AtrResult {
  atr: (number | null)[];
  atrPercent: (number | null)[];
}

export interface AdxResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}

export interface IndicatorSeries {
  timestamp: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerMiddle: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  bollingerBandwidth: number | null;
  bollingerPercentB: number | null;
  atr14: number | null;
  atrPercent: number | null;
  vwap: number | null;
  adx14: number | null;
  plusDI14: number | null;
  minusDI14: number | null;
  volume: number | null;
  volumeSma20: number | null;
  volumeRatio: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface IndicatorSnapshot {
  timestamp: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;

  sma20: number | null;
  sma50: number | null;
  sma200: number | null;

  ema20: number | null;
  ema50: number | null;
  ema200: number | null;

  rsi14: number | null;

  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };

  bollinger: {
    middle: number | null;
    upper: number | null;
    lower: number | null;
    bandwidth: number | null;
    percentB: number | null;
  };

  atr14: number | null;
  atrPercent: number | null;

  vwap: number | null;

  adx14: number | null;
  plusDI14: number | null;
  minusDI14: number | null;

  volume: number | null;
  volumeSma20: number | null;
  volumeRatio: number | null;
}

/* ============================================================================
   Input coercion
   ============================================================================ */

/**
 * Filter NormalizedMarketData to rows with complete OHLC. Phase 4B already
 * enforces this, but the filter is a safety net so indicators never receive
 * a null mid-computation. Non-finite numbers are treated as missing.
 */
export function toClosedCandles(
  candles: NormalizedMarketData[]
): ClosedCandle[] {
  const out: ClosedCandle[] = [];
  for (const c of candles) {
    if (
      typeof c.open === 'number' && Number.isFinite(c.open) &&
      typeof c.high === 'number' && Number.isFinite(c.high) &&
      typeof c.low === 'number' && Number.isFinite(c.low) &&
      typeof c.close === 'number' && Number.isFinite(c.close)
    ) {
      const vol =
        typeof c.volume === 'number' && Number.isFinite(c.volume)
          ? c.volume
          : null;
      out.push({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: vol
      });
    }
  }
  return out;
}

/* ============================================================================
   1. Simple Moving Average
   ----------------------------------------------------------------------------
   SMA[i] valid when i >= period-1.
   ============================================================================ */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

/* ============================================================================
   2. Exponential Moving Average
   ----------------------------------------------------------------------------
   Standard multiplier k = 2 / (period + 1).
   Seeded with SMA(period). First valid value at index period-1.
   ============================================================================ */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  const firstEma = seed / period;
  out[period - 1] = firstEma;

  let prev = firstEma;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/* ============================================================================
   3. RSI (Wilder)
   ----------------------------------------------------------------------------
   First avgGain/avgLoss = SMA of the first `period` gains/losses.
   Subsequent: avg = (prevAvg * (period - 1) + current) / period.
   First valid RSI at index `period`.

   Edge cases
     • Only gains  → avgLoss = 0 → RSI = 100
     • Only losses → avgGain = 0 → RSI = 0
   ============================================================================ */
export function rsi(values: number[], period: number = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/* ============================================================================
   4. MACD
   ----------------------------------------------------------------------------
   line = EMA(fast) - EMA(slow), valid where both are valid.
   signal = EMA(signalPeriod) over the line's valid region.
   histogram = line - signal.
   With fast=12, slow=26, signal=9: first valid histogram at index 33.
   ============================================================================ */
export function macd(
  values: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): MacdResult {
  const empty: (number | null)[] = new Array(values.length).fill(null);
  if (fast < 1 || slow < 1 || signalPeriod < 1 || fast >= slow) {
    return {
      line: empty.slice(),
      signal: empty.slice(),
      histogram: empty.slice()
    };
  }

  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const line: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (f !== null && s !== null) line[i] = f - s;
  }

  const signal: (number | null)[] = new Array(values.length).fill(null);
  const firstValid = line.findIndex((v) => v !== null);
  if (firstValid !== -1) {
    const validLine: number[] = [];
    for (let i = firstValid; i < values.length; i++) {
      const v = line[i];
      if (v === null) break;
      validLine.push(v);
    }
    const signalOver = ema(validLine, signalPeriod);
    for (let j = 0; j < signalOver.length; j++) {
      signal[firstValid + j] = signalOver[j];
    }
  }

  const histogram: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const l = line[i];
    const s = signal[i];
    if (l !== null && s !== null) histogram[i] = l - s;
  }

  return { line, signal, histogram };
}

/* ============================================================================
   5. Bollinger Bands
   ----------------------------------------------------------------------------
   Population standard deviation over `period` closes.
   bandwidth = (upper - lower) / middle (null when middle <= 0).
   %B = (close - lower) / (upper - lower) (null when upper == lower).
   ============================================================================ */
export function bollinger(
  closes: number[],
  period: number = 20,
  multiplier: number = 2
): BollingerResult {
  const n = closes.length;
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  const bandwidth: (number | null)[] = new Array(n).fill(null);
  const percentB: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    const mid = middle[i];
    if (mid === null) continue;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - mid;
      variance += d * d;
    }
    const std = Math.sqrt(variance / period);

    const up = mid + multiplier * std;
    const lo = mid - multiplier * std;
    upper[i] = up;
    lower[i] = lo;

    bandwidth[i] = mid > 0 ? (up - lo) / mid : null;
    percentB[i] = up !== lo ? (closes[i] - lo) / (up - lo) : null;
  }

  return { middle, upper, lower, bandwidth, percentB };
}

/* ============================================================================
   6. ATR (Wilder)
   ----------------------------------------------------------------------------
   TR[i] = max(high-low, |high-prevClose|, |low-prevClose|).
   First ATR = SMA of TR[1..period]. Wilder smoothing thereafter.
   atrPercent = atr / close * 100.
   First valid ATR at index `period`.
   ============================================================================ */
export function atr(candles: ClosedCandle[], period: number = 14): AtrResult {
  const n = candles.length;
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  const atrArr: (number | null)[] = new Array(n).fill(null);
  if (n > period) {
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    let prev = sum / period;
    atrArr[period] = prev;

    for (let i = period + 1; i < n; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      atrArr[i] = prev;
    }
  }

  const atrPercent: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const a = atrArr[i];
    const c = candles[i].close;
    if (a !== null && c > 0) atrPercent[i] = (a / c) * 100;
  }

  return { atr: atrArr, atrPercent };
}

/* ============================================================================
   7. VWAP (UTC-day session)
   ----------------------------------------------------------------------------
   Session key is the UTC date prefix of the timestamp. VWAP resets at each
   UTC day boundary. Typical price = (high + low + close) / 3.
   Volume = 0 or null: session cumulative is not advanced; the value at that
   index is the running VWAP of prior candles in the session, or null if none.

   LIMITATION — NOT EXCHANGE-SESSION-AWARE.
     Exchange-specific session VWAP (NSE, NYSE, etc.) will be introduced in
     a later phase. This function must not be described as exact session VWAP
     for any exchange.
   ============================================================================ */
export function vwap(candles: ClosedCandle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);

  let currentDay: string | null = null;
  let cumPV = 0;
  let cumVol = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const day = c.timestamp.slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      cumPV = 0;
      cumVol = 0;
    }

    const typical = (c.high + c.low + c.close) / 3;

    if (c.volume === null || c.volume <= 0) {
      out[i] = cumVol > 0 ? cumPV / cumVol : null;
      continue;
    }

    cumPV += typical * c.volume;
    cumVol += c.volume;
    out[i] = cumPV / cumVol;
  }

  return out;
}

/* ============================================================================
   8. ADX (Wilder)
   ----------------------------------------------------------------------------
   +DM[i] = up if up > down and up > 0, else 0, where
     up = high[i] - high[i-1], down = low[i-1] - low[i].
   Smoothed +DM/-DM/TR: sum over indices 1..period, Wilder thereafter.
   +DI = 100 * smoothed(+DM) / smoothed(TR).
   -DI = 100 * smoothed(-DM) / smoothed(TR).
   DX  = 100 * |+DI - -DI| / (+DI + -DI)   (0 when sum is 0).
   ADX: SMA seed of first `period` DX values, Wilder thereafter.
   First valid ADX at index 2*period - 1.
   ============================================================================ */
export function adx(candles: ClosedCandle[], period: number = 14): AdxResult {
  const n = candles.length;
  const adxArr: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);

  if (n <= period * 2) return { adx: adxArr, plusDI, minusDI };

  const tr: number[] = new Array(n).fill(0);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));

    const up = h - candles[i - 1].high;
    const down = candles[i - 1].low - l;
    if (up > down && up > 0) plusDM[i] = up;
    else if (down > up && down > 0) minusDM[i] = down;
  }

  let strTR = 0;
  let strPlus = 0;
  let strMinus = 0;
  for (let i = 1; i <= period; i++) {
    strTR += tr[i];
    strPlus += plusDM[i];
    strMinus += minusDM[i];
  }

  const computeDI = (): { p: number; m: number } => {
    if (strTR === 0) return { p: 0, m: 0 };
    return {
      p: (100 * strPlus) / strTR,
      m: (100 * strMinus) / strTR
    };
  };

  const first = computeDI();
  plusDI[period] = first.p;
  minusDI[period] = first.m;

  const dx: (number | null)[] = new Array(n).fill(null);
  const sum0 = first.p + first.m;
  dx[period] = sum0 === 0 ? 0 : (100 * Math.abs(first.p - first.m)) / sum0;

  for (let i = period + 1; i < n; i++) {
    strTR = strTR - strTR / period + tr[i];
    strPlus = strPlus - strPlus / period + plusDM[i];
    strMinus = strMinus - strMinus / period + minusDM[i];

    const { p, m } = computeDI();
    plusDI[i] = p;
    minusDI[i] = m;
    const sum = p + m;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum;
  }

  const dxStart = period;
  const dxEnd = period + period - 1;
  if (dxEnd >= n) return { adx: adxArr, plusDI, minusDI };

  let dxSum = 0;
  for (let i = dxStart; i <= dxEnd; i++) {
    const v = dx[i];
    if (v !== null) dxSum += v;
  }
  let prevAdx = dxSum / period;
  adxArr[dxEnd] = prevAdx;

  for (let i = dxEnd + 1; i < n; i++) {
    const v = dx[i];
    if (v === null) continue;
    prevAdx = (prevAdx * (period - 1) + v) / period;
    adxArr[i] = prevAdx;
  }

  return { adx: adxArr, plusDI, minusDI };
}

/* ============================================================================
   9. Volume helpers
   ============================================================================ */

/**
 * Rolling volume SMA. A window containing any null volume yields null at
 * that index — never a partial mean.
 */
export function volumeSma(
  candles: ClosedCandle[],
  period: number = 20
): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period < 1 || n < period) return out;

  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < period; i++) {
    const v = candles[i].volume;
    if (v !== null) {
      sum += v;
      validCount++;
    }
  }
  out[period - 1] = validCount === period ? sum / period : null;

  for (let i = period; i < n; i++) {
    const drop = candles[i - period].volume;
    const add = candles[i].volume;
    if (drop !== null) {
      sum -= drop;
      validCount--;
    }
    if (add !== null) {
      sum += add;
      validCount++;
    }
    out[i] = validCount === period ? sum / period : null;
  }
  return out;
}

/**
 * volume / volumeSma when both are finite and the SMA is > 0. Null otherwise.
 */
export function volumeRatio(
  candles: ClosedCandle[],
  smaValues: (number | null)[]
): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const v = candles[i].volume;
    const avg = smaValues[i];
    if (v === null || avg === null || avg <= 0) continue;
    out[i] = v / avg;
  }
  return out;
}

/* ============================================================================
   10. Price change
   ============================================================================ */
export function priceChange(closes: number[]): {
  change: (number | null)[];
  changePercent: (number | null)[];
} {
  const n = closes.length;
  const change: (number | null)[] = new Array(n).fill(null);
  const changePercent: (number | null)[] = new Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    change[i] = closes[i] - closes[i - 1];
    if (closes[i - 1] !== 0) {
      changePercent[i] = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    }
  }
  return { change, changePercent };
}

/* ============================================================================
   11. Series and snapshot
   ============================================================================ */

/**
 * Compute every indicator for every candle. Output length equals the number
 * of candles that passed the `toClosedCandles` filter — the caller can align
 * by index or by timestamp, since both are preserved.
 */
export function computeIndicatorSeries(
  candles: NormalizedMarketData[]
): IndicatorSeries[] {
  const closed = toClosedCandles(candles);
  if (closed.length === 0) return [];

  const closes = closed.map((c) => c.close);

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r14 = rsi(closes, 14);
  const m = macd(closes, 12, 26, 9);
  const bb = bollinger(closes, 20, 2);
  const a = atr(closed, 14);
  const vw = vwap(closed);
  const ax = adx(closed, 14);
  const vsma20 = volumeSma(closed, 20);
  const vratio = volumeRatio(closed, vsma20);
  const pc = priceChange(closes);

  const out: IndicatorSeries[] = [];
  for (let i = 0; i < closed.length; i++) {
    out.push({
      timestamp: closed[i].timestamp,
      close: closed[i].close,
      sma20: s20[i],
      sma50: s50[i],
      sma200: s200[i],
      ema20: e20[i],
      ema50: e50[i],
      ema200: e200[i],
      rsi14: r14[i],
      macdLine: m.line[i],
      macdSignal: m.signal[i],
      macdHistogram: m.histogram[i],
      bollingerMiddle: bb.middle[i],
      bollingerUpper: bb.upper[i],
      bollingerLower: bb.lower[i],
      bollingerBandwidth: bb.bandwidth[i],
      bollingerPercentB: bb.percentB[i],
      atr14: a.atr[i],
      atrPercent: a.atrPercent[i],
      vwap: vw[i],
      adx14: ax.adx[i],
      plusDI14: ax.plusDI[i],
      minusDI14: ax.minusDI[i],
      volume: closed[i].volume,
      volumeSma20: vsma20[i],
      volumeRatio: vratio[i],
      change: pc.change[i],
      changePercent: pc.changePercent[i]
    });
  }
  return out;
}

/**
 * Latest indicator snapshot in the shape documented in the Phase 5 spec.
 * Returns null when the series is empty.
 */
export function latestSnapshot(
  candles: NormalizedMarketData[]
): IndicatorSnapshot | null {
  const series = computeIndicatorSeries(candles);
  if (series.length === 0) return null;

  const r = series[series.length - 1];
  return {
    timestamp: r.timestamp,
    price: r.close,
    change: r.change,
    changePercent: r.changePercent,
    sma20: r.sma20,
    sma50: r.sma50,
    sma200: r.sma200,
    ema20: r.ema20,
    ema50: r.ema50,
    ema200: r.ema200,
    rsi14: r.rsi14,
    macd: {
      line: r.macdLine,
      signal: r.macdSignal,
      histogram: r.macdHistogram
    },
    bollinger: {
      middle: r.bollingerMiddle,
      upper: r.bollingerUpper,
      lower: r.bollingerLower,
      bandwidth: r.bollingerBandwidth,
      percentB: r.bollingerPercentB
    },
    atr14: r.atr14,
    atrPercent: r.atrPercent,
    vwap: r.vwap,
    adx14: r.adx14,
    plusDI14: r.plusDI14,
    minusDI14: r.minusDI14,
    volume: r.volume,
    volumeSma20: r.volumeSma20,
    volumeRatio: r.volumeRatio
  };
}
