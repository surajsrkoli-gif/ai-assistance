/* ============================================================================
   backend/src/services/MultiTimeframeService.ts
   ----------------------------------------------------------------------------
   PHASE 5 — Descriptive multi-timeframe alignment.

   OUTPUT IS DESCRIPTIVE ONLY.
     • Vocabulary is limited to: bullish | bearish | mixed | unknown,
       low | normal | high, and low | medium | high (confidence).
     • This module does NOT emit BUY, SELL, LONG, SHORT, ENTRY, TARGET,
       STOP LOSS, or any other trade-instruction term. Those belong to a
       future Strategy/Risk phase and must not appear here.

   Each TimeframeAnalysis carries a `source` field:
     'provider'   — bars came directly from the market data provider
     'aggregated' — bars were derived by TimeframeAggregator from a finer
                    timeframe in the same request
   ============================================================================ */

import type { NormalizedMarketData } from '../providers/MarketDataProvider';
import { computeIndicatorSeries } from './IndicatorService';

export type MtfTimeframe = '15min' | '1h' | '4h' | '1day';

export const MTF_TIMEFRAMES: readonly MtfTimeframe[] = ['15min', '1h', '4h', '1day'];

export type TrendState = 'bullish' | 'bearish' | 'mixed' | 'unknown';
export type MomentumState = 'bullish' | 'bearish' | 'mixed' | 'unknown';
export type VolatilityState = 'low' | 'normal' | 'high' | 'unknown';
export type VolumeState = 'low' | 'normal' | 'high' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';
export type BarSource = 'provider' | 'aggregated';

export interface TimeframeAnalysis {
  interval: MtfTimeframe;
  source: BarSource;
  barCount: number;
  latest: {
    timestamp: string;
    price: number | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    rsi14: number | null;
    macdLine: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    adx14: number | null;
    atrPercent: number | null;
    volumeRatio: number | null;
  };
  trend: TrendState;
  momentum: MomentumState;
  volatility: VolatilityState;
  volumeCondition: VolumeState;
}

export interface AlignmentSummary {
  trend: TrendState;
  momentum: MomentumState;
  confidence: Confidence;
}

export interface MtfAnalysis {
  symbol: string;
  market: string;
  timeframes: Record<string, TimeframeAnalysis>;
  alignment: AlignmentSummary;
}

/* ============================================================================
   Per-timeframe interpretation
   ============================================================================ */

function classifyTrend(
  price: number | null,
  ema20: number | null,
  ema50: number | null,
  ema200: number | null
): TrendState {
  if (price === null || ema20 === null) return 'unknown';
  const above20 = price > ema20;
  const above50 = ema50 === null ? null : price > ema50;
  const above200 = ema200 === null ? null : price > ema200;

  if (above20 && above50 !== false && above200 !== false) return 'bullish';
  if (!above20 && above50 !== true && above200 !== true) return 'bearish';
  return 'mixed';
}

function classifyMomentum(
  macdLine: number | null,
  macdSignal: number | null,
  histogram: number | null,
  rsi14: number | null
): MomentumState {
  if (macdLine === null || macdSignal === null || histogram === null) {
    if (rsi14 === null) return 'unknown';
    if (rsi14 >= 55) return 'bullish';
    if (rsi14 <= 45) return 'bearish';
    return 'mixed';
  }
  const macdUp = macdLine > macdSignal && histogram > 0;
  const macdDown = macdLine < macdSignal && histogram < 0;
  if (macdUp && (rsi14 === null || rsi14 >= 50)) return 'bullish';
  if (macdDown && (rsi14 === null || rsi14 <= 50)) return 'bearish';
  return 'mixed';
}

function classifyVolatility(atrPercent: number | null): VolatilityState {
  if (atrPercent === null) return 'unknown';
  if (atrPercent < 1) return 'low';
  if (atrPercent > 4) return 'high';
  return 'normal';
}

function classifyVolume(volumeRatio: number | null): VolumeState {
  if (volumeRatio === null) return 'unknown';
  if (volumeRatio < 0.7) return 'low';
  if (volumeRatio > 1.5) return 'high';
  return 'normal';
}

export function analyseTimeframe(
  interval: MtfTimeframe,
  candles: NormalizedMarketData[],
  source: BarSource = 'provider'
): TimeframeAnalysis {
  const series = computeIndicatorSeries(candles);
  const latest = series.length > 0 ? series[series.length - 1] : null;

  if (!latest) {
    return {
      interval,
      source,
      barCount: 0,
      latest: {
        timestamp: '',
        price: null,
        ema20: null,
        ema50: null,
        ema200: null,
        rsi14: null,
        macdLine: null,
        macdSignal: null,
        macdHistogram: null,
        adx14: null,
        atrPercent: null,
        volumeRatio: null
      },
      trend: 'unknown',
      momentum: 'unknown',
      volatility: 'unknown',
      volumeCondition: 'unknown'
    };
  }

  return {
    interval,
    source,
    barCount: series.length,
    latest: {
      timestamp: latest.timestamp,
      price: latest.close,
      ema20: latest.ema20,
      ema50: latest.ema50,
      ema200: latest.ema200,
      rsi14: latest.rsi14,
      macdLine: latest.macdLine,
      macdSignal: latest.macdSignal,
      macdHistogram: latest.macdHistogram,
      adx14: latest.adx14,
      atrPercent: latest.atrPercent,
      volumeRatio: latest.volumeRatio
    },
    trend: classifyTrend(latest.close, latest.ema20, latest.ema50, latest.ema200),
    momentum: classifyMomentum(
      latest.macdLine,
      latest.macdSignal,
      latest.macdHistogram,
      latest.rsi14
    ),
    volatility: classifyVolatility(latest.atrPercent),
    volumeCondition: classifyVolume(latest.volumeRatio)
  };
}

/* ============================================================================
   Alignment summary
   ============================================================================ */

function majority(values: string[]): string {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  let best = 'unknown';
  let bestCount = 0;
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestCount) { best = k; bestCount = c; }
  }
  return best;
}

export function summariseAlignment(
  analyses: Record<string, TimeframeAnalysis>
): AlignmentSummary {
  const entries = Object.values(analyses);
  if (entries.length === 0) {
    return { trend: 'unknown', momentum: 'unknown', confidence: 'low' };
  }

  const knownTrend = entries.filter((e) => e.trend !== 'unknown').map((e) => e.trend);
  const knownMom = entries.filter((e) => e.momentum !== 'unknown').map((e) => e.momentum);

  const trendMajority = knownTrend.length === 0
    ? 'unknown'
    : (majority(knownTrend) as TrendState);

  const momentumMajority = knownMom.length === 0
    ? 'unknown'
    : (majority(knownMom) as MomentumState);

  const trendAgree = knownTrend.filter((t) => t === trendMajority).length;
  const momAgree = knownMom.filter((m) => m === momentumMajority).length;
  const agreementRatio =
    (trendAgree + momAgree) /
    Math.max(1, knownTrend.length + knownMom.length);

  let confidence: Confidence = 'low';
  if (knownTrend.length + knownMom.length >= 6 && agreementRatio >= 0.75) {
    confidence = 'high';
  } else if (knownTrend.length + knownMom.length >= 4 && agreementRatio >= 0.6) {
    confidence = 'medium';
  }

  return {
    trend: trendMajority,
    momentum: momentumMajority,
    confidence
  };
}
