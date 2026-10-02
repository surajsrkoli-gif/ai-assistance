/* ============================================================================
   PHASE 5 — MultiTimeframeService tests.
   ----------------------------------------------------------------------------
   Covers:
     • per-timeframe trend classification (bullish/bearish/mixed/unknown)
     • momentum classification with MACD + RSI
     • volatility classification from ATR%
     • volume condition classification from volume ratio
     • warm-up nulls producing 'unknown'
     • empty input handling
     • `source` flag propagation ('provider' vs 'aggregated')
     • alignment summary (majority vote + confidence)
     • the descriptive-only vocabulary invariant: no BUY/SELL/LONG/SHORT/
       ENTRY/TARGET/STOP LOSS strings can appear anywhere in the output

   All fixtures are deterministic. No network, no secrets.
   ============================================================================ */

import { describe, it, expect } from 'vitest';
import {
  analyseTimeframe,
  summariseAlignment,
  MTF_TIMEFRAMES,
  type TimeframeAnalysis,
  type MtfTimeframe,
  type TrendState,
  type MomentumState
} from '../MultiTimeframeService';
import type { NormalizedMarketData } from '../../providers/MarketDataProvider';

/* ============================================================================
   Fixtures
   ============================================================================ */

/**
 * Build a series of N candles trending up or down. Price moves linearly so
 * EMA-based classifications are unambiguous.
 */
function trendingCandles(
  count: number,
  direction: 1 | -1
): NormalizedMarketData[] {
  const start = direction === 1 ? 100 : 200;
  const out: NormalizedMarketData[] = [];
  for (let i = 0; i < count; i++) {
    const base = start + direction * i * 0.5;
    out.push({
      symbol: 'TEST',
      market: 'stocks',
      timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      price: null,
      open: base,
      high: base + 1,
      low: base - 0.5,
      close: base + direction * 0.8,
      volume: 1000,
      currency: 'USD',
      source: 'test',
      dataStatus: 'historical'
    });
  }
  return out;
}

/**
 * Build a flat series — price is constant, volatility is 0. Useful for
 * checking that classifications do not crash and return sensible values.
 */
function flatCandles(count: number): NormalizedMarketData[] {
  const out: NormalizedMarketData[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      symbol: 'TEST',
      market: 'stocks',
      timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      price: null,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1000,
      currency: 'USD',
      source: 'test',
      dataStatus: 'historical'
    });
  }
  return out;
}

/* ============================================================================
   1. analyseTimeframe — trend
   ============================================================================ */
describe('analyseTimeframe — trend', () => {
  it('classifies a sustained uptrend as bullish', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, 1), 'provider');
    expect(a.trend).toBe('bullish');
    expect(a.barCount).toBe(250);
    expect(a.source).toBe('provider');
  });

  it('classifies a sustained downtrend as bearish', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, -1), 'provider');
    expect(a.trend).toBe('bearish');
  });

  it('returns unknown trend when EMA20 has not warmed up', () => {
    const a = analyseTimeframe('1day', trendingCandles(5, 1), 'provider');
    expect(a.trend).toBe('unknown');
    expect(a.barCount).toBe(5);
  });

  it('returns unknown for exactly 19 bars (EMA20 warm-up boundary)', () => {
    const a = analyseTimeframe('1day', trendingCandles(19, 1), 'provider');
    expect(a.trend).toBe('unknown');
  });

  it('produces a trend at 20 bars (EMA20 first valid index)', () => {
    const a = analyseTimeframe('1day', trendingCandles(20, 1), 'provider');
    // At 20 bars EMA20 is valid, EMA50 and EMA200 are null. The classifier
    // returns 'bullish' or 'bearish' from price vs EMA20 alone.
    expect(['bullish', 'bearish', 'mixed']).toContain(a.trend);
    expect(a.trend).not.toBe('unknown');
  });
});

/* ============================================================================
   2. analyseTimeframe — momentum
   ============================================================================ */
describe('analyseTimeframe — momentum', () => {
  it('classifies momentum as bullish on a sustained uptrend after warm-up', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, 1), 'provider');
    expect(a.momentum).toBe('bullish');
  });

  it('classifies momentum as bearish on a sustained downtrend after warm-up', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, -1), 'provider');
    expect(a.momentum).toBe('bearish');
  });

  it('returns unknown when even RSI has not warmed up', () => {
    const a = analyseTimeframe('1day', trendingCandles(5, 1), 'provider');
    expect(a.momentum).toBe('unknown');
  });

  it('falls back to RSI-only classification when MACD is not warmed up', () => {
    // 30 bars: RSI is valid (14+), MACD line valid (26+) but signal not yet
    // (33+). The fallback to RSI-only kicks in.
    const a = analyseTimeframe('1day', trendingCandles(30, 1), 'provider');
    expect(['bullish', 'bearish', 'mixed']).toContain(a.momentum);
  });
});

/* ============================================================================
   3. analyseTimeframe — volatility
   ============================================================================ */
describe('analyseTimeframe — volatility', () => {
  it('returns unknown before ATR has warmed up', () => {
    const a = analyseTimeframe('1day', trendingCandles(10, 1), 'provider');
    expect(a.volatility).toBe('unknown');
  });

  it('classifies flat low-range series as low volatility', () => {
    const a = analyseTimeframe('1day', flatCandles(250), 'provider');
    // ATR on a nearly flat series is very small relative to price → low.
    expect(a.volatility).toBe('low');
  });

  it('produces a classification once ATR warms up', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, 1), 'provider');
    expect(['low', 'normal', 'high']).toContain(a.volatility);
  });
});

/* ============================================================================
   4. analyseTimeframe — volume condition
   ============================================================================ */
describe('analyseTimeframe — volume condition', () => {
  it('returns normal when volume is constant (ratio = 1)', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, 1), 'provider');
    expect(a.volumeCondition).toBe('normal');
  });

  it('returns unknown when volume series is too short for SMA20', () => {
    const a = analyseTimeframe('1day', trendingCandles(10, 1), 'provider');
    expect(a.volumeCondition).toBe('unknown');
  });
});

/* ============================================================================
   5. analyseTimeframe — empty input, source flag, vocabulary
   ============================================================================ */
describe('analyseTimeframe — edge cases', () => {
  it('empty input → all unknown, barCount 0, null latest values', () => {
    const a = analyseTimeframe('1h', [], 'provider');
    expect(a.trend).toBe('unknown');
    expect(a.momentum).toBe('unknown');
    expect(a.volatility).toBe('unknown');
    expect(a.volumeCondition).toBe('unknown');
    expect(a.barCount).toBe(0);
    expect(a.latest.price).toBeNull();
    expect(a.latest.ema20).toBeNull();
    expect(a.latest.rsi14).toBeNull();
    expect(a.latest.macdLine).toBeNull();
  });

  it('propagates source="aggregated" verbatim', () => {
    const a = analyseTimeframe('4h', trendingCandles(250, 1), 'aggregated');
    expect(a.source).toBe('aggregated');
  });

  it('propagates source="provider" verbatim', () => {
    const a = analyseTimeframe('4h', trendingCandles(250, 1), 'provider');
    expect(a.source).toBe('provider');
  });

  it('never emits trade-instruction vocabulary', () => {
    const a = analyseTimeframe('1day', trendingCandles(250, 1), 'provider');
    const json = JSON.stringify(a).toUpperCase();
    const banned = [
      'BUY',
      'SELL',
      'LONG',
      'SHORT',
      'ENTRY',
      'TARGET',
      'STOP LOSS',
      'STOPLOSS',
      'TAKE PROFIT',
      'TAKEPROFIT'
    ];
    for (const term of banned) {
      expect(json).not.toContain(term);
    }
  });
});

/* ============================================================================
   6. summariseAlignment
   ============================================================================ */
describe('summariseAlignment', () => {
  function makeAnalysis(
    tf: MtfTimeframe,
    trend: TrendState,
    momentum: MomentumState,
    source: 'provider' | 'aggregated' = 'provider'
  ): TimeframeAnalysis {
    return {
      interval: tf,
      source,
      barCount: 250,
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
      trend,
      momentum,
      volatility: 'normal',
      volumeCondition: 'normal'
    };
  }

  it('high confidence when all timeframes agree', () => {
    const analyses: Record<string, TimeframeAnalysis> = {};
    for (const tf of MTF_TIMEFRAMES) {
      analyses[tf] = makeAnalysis(tf, 'bullish', 'bullish');
    }
    const s = summariseAlignment(analyses);
    expect(s.trend).toBe('bullish');
    expect(s.momentum).toBe('bullish');
    expect(s.confidence).toBe('high');
  });

  it('low confidence when split evenly', () => {
    const analyses: Record<string, TimeframeAnalysis> = {
      '15min': makeAnalysis('15min', 'bullish', 'bearish'),
      '1h': makeAnalysis('1h', 'bearish', 'bullish'),
      '4h': makeAnalysis('4h', 'bullish', 'bearish'),
      '1day': makeAnalysis('1day', 'bearish', 'bullish')
    };
    const s = summariseAlignment(analyses);
    expect(s.confidence).toBe('low');
  });

  it('majority bullish with medium or high confidence at 3-of-4 agreement', () => {
    const analyses: Record<string, TimeframeAnalysis> = {
      '15min': makeAnalysis('15min', 'bullish', 'bullish'),
      '1h': makeAnalysis('1h', 'bullish', 'bullish'),
      '4h': makeAnalysis('4h', 'bullish', 'bearish'),
      '1day': makeAnalysis('1day', 'bearish', 'bearish')
    };
    const s = summariseAlignment(analyses);
    expect(s.trend).toBe('bullish');
    expect(['medium', 'high']).toContain(s.confidence);
  });

  it('ignores unknown classifications when computing majority', () => {
    const analyses: Record<string, TimeframeAnalysis> = {
      '15min': makeAnalysis('15min', 'unknown', 'unknown'),
      '1h': makeAnalysis('1h', 'unknown', 'unknown'),
      '4h': makeAnalysis('4h', 'bullish', 'bullish'),
      '1day': makeAnalysis('1day', 'bullish', 'bullish')
    };
    const s = summariseAlignment(analyses);
    expect(s.trend).toBe('bullish');
    expect(s.momentum).toBe('bullish');
  });

  it('empty input → unknown/unknown/low', () => {
    const s = summariseAlignment({});
    expect(s.trend).toBe('unknown');
    expect(s.momentum).toBe('unknown');
    expect(s.confidence).toBe('low');
  });

  it('all-unknown input → unknown/unknown/low', () => {
    const analyses: Record<string, TimeframeAnalysis> = {
      '15min': makeAnalysis('15min', 'unknown', 'unknown'),
      '1h': makeAnalysis('1h', 'unknown', 'unknown')
    };
    const s = summariseAlignment(analyses);
    expect(s.trend).toBe('unknown');
    expect(s.momentum).toBe('unknown');
    expect(s.confidence).toBe('low');
  });
});

/* ============================================================================
   7. summariseAlignment — descriptive-only vocabulary
   ============================================================================ */
describe('summariseAlignment — vocabulary invariant', () => {
  it('never emits trade-instruction vocabulary in the summary', () => {
    const analyses: Record<string, TimeframeAnalysis> = {};
    for (const tf of MTF_TIMEFRAMES) {
      analyses[tf] = {
        interval: tf,
        source: 'provider',
        barCount: 250,
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
        trend: 'bullish',
        momentum: 'bullish',
        volatility: 'normal',
        volumeCondition: 'normal'
      };
    }
    const s = summariseAlignment(analyses);
    const json = JSON.stringify(s).toUpperCase();
    for (const term of [
      'BUY',
      'SELL',
      'LONG',
      'SHORT',
      'ENTRY',
      'TARGET',
      'STOP LOSS',
      'STOPLOSS'
    ]) {
      expect(json).not.toContain(term);
    }
  });
});

/* ============================================================================
   8. MTF_TIMEFRAMES constant
   ============================================================================ */
describe('MTF_TIMEFRAMES', () => {
  it('contains exactly the four supported timeframes in finest-first order', () => {
    expect(MTF_TIMEFRAMES).toEqual(['15min', '1h', '4h', '1day']);
  });
});
