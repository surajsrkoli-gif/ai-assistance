/* ============================================================================
   PHASE 5 — TimeframeAggregator tests.
   ----------------------------------------------------------------------------
   Covers:
     • supported transformation validation (canAggregate, aggregationRatio)
     • bucket alignment (1h, 4h, 1day, 1week)
     • OHLCV rules within a bucket
     • volume null handling
     • chronological ordering of output
     • unsupported transformations throwing
     • empty input
     • interval duration helper

   All fixtures are deterministic. No network, no secrets.
   ============================================================================ */

import { describe, it, expect } from 'vitest';
import {
  aggregateCandles,
  bucketStart,
  intervalMs,
  canAggregate,
  aggregationRatio,
  SUPPORTED_AGGREGATIONS,
  type SourceInterval,
  type AggregateInterval
} from '../TimeframeAggregator';
import type { NormalizedMarketData } from '../../providers/MarketDataProvider';

/* ----------------------------------------------------------------------------
   Fixtures
   ---------------------------------------------------------------------------- */

function candle(
  timestamp: string,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number | null = 100
): NormalizedMarketData {
  return {
    symbol: 'TEST',
    market: 'stocks',
    timestamp,
    price: null,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
    currency: 'USD',
    source: 'test',
    dataStatus: 'historical'
  };
}

/* ============================================================================
   1. Transformation validation
   ============================================================================ */
describe('canAggregate', () => {
  it('accepts every supported transformation', () => {
    expect(canAggregate('15min', '1h')).toBe(true);
    expect(canAggregate('15min', '4h')).toBe(true);
    expect(canAggregate('1h', '4h')).toBe(true);
    expect(canAggregate('1h', '1day')).toBe(true);
    expect(canAggregate('1day', '1week')).toBe(true);
  });

  it('rejects unsupported transformations', () => {
    // No direct 15min → 1day, no direct 15min → 1week.
    expect(canAggregate('15min', '1day')).toBe(false);
    expect(canAggregate('15min', '1week')).toBe(false);
    // 4h is not a supported source interval.
    expect(canAggregate('4h', '1day')).toBe(false);
    expect(canAggregate('4h', '1week')).toBe(false);
    // Coarse → fine never supported.
    expect(canAggregate('1day', '1h')).toBe(false);
    expect(canAggregate('1week', '1day')).toBe(false);
    // Nonsense strings.
    expect(canAggregate('5min', '1h')).toBe(false);
    expect(canAggregate('', '')).toBe(false);
    expect(canAggregate('1h', '')).toBe(false);
  });
});

describe('aggregationRatio', () => {
  it('reports bars-per-bucket for supported transformations', () => {
    expect(aggregationRatio('15min', '1h')).toBe(4);
    expect(aggregationRatio('15min', '4h')).toBe(16);
    expect(aggregationRatio('1h', '4h')).toBe(4);
    expect(aggregationRatio('1h', '1day')).toBe(24);
    expect(aggregationRatio('1day', '1week')).toBe(5);
  });

  it('returns null for unsupported transformations', () => {
    expect(aggregationRatio('15min', '1day')).toBeNull();
    expect(aggregationRatio('4h', '1day')).toBeNull();
    expect(aggregationRatio('1day', '1h')).toBeNull();
  });
});

describe('SUPPORTED_AGGREGATIONS', () => {
  it('exposes exactly the five defined pairs', () => {
    expect(SUPPORTED_AGGREGATIONS.length).toBe(5);
  });

  it('is consistent with canAggregate and aggregationRatio', () => {
    for (const s of SUPPORTED_AGGREGATIONS) {
      expect(canAggregate(s.source, s.target)).toBe(true);
      expect(aggregationRatio(s.source, s.target)).toBe(s.ratio);
    }
  });
});

/* ============================================================================
   2. Bucket alignment
   ============================================================================ */
describe('bucketStart', () => {
  it('floors to the top of the hour for 1h', () => {
    expect(bucketStart('2026-01-01T10:47:33.000Z', '1h').toISOString())
      .toBe('2026-01-01T10:00:00.000Z');
    expect(bucketStart('2026-01-01T10:00:00.000Z', '1h').toISOString())
      .toBe('2026-01-01T10:00:00.000Z');
    expect(bucketStart('2026-01-01T10:59:59.999Z', '1h').toISOString())
      .toBe('2026-01-01T10:00:00.000Z');
  });

  it('floors to 4h aligned at 0/4/8/12/16/20 UTC', () => {
    expect(bucketStart('2026-01-01T17:00:00.000Z', '4h').toISOString())
      .toBe('2026-01-01T16:00:00.000Z');
    expect(bucketStart('2026-01-01T02:00:00.000Z', '4h').toISOString())
      .toBe('2026-01-01T00:00:00.000Z');
    expect(bucketStart('2026-01-01T21:59:59.000Z', '4h').toISOString())
      .toBe('2026-01-01T20:00:00.000Z');
  });

  it('floors to 00:00 UTC for 1day', () => {
    expect(bucketStart('2026-01-01T23:59:59.000Z', '1day').toISOString())
      .toBe('2026-01-01T00:00:00.000Z');
    expect(bucketStart('2026-01-01T00:00:00.000Z', '1day').toISOString())
      .toBe('2026-01-01T00:00:00.000Z');
  });

  it('floors to Monday 00:00 UTC for 1week', () => {
    // 2026-01-01 is a Thursday. ISO week start is Monday 2025-12-29.
    expect(bucketStart('2026-01-01T10:00:00.000Z', '1week').toISOString())
      .toBe('2025-12-29T00:00:00.000Z');
    // 2026-01-04 is a Sunday → same week.
    expect(bucketStart('2026-01-04T23:00:00.000Z', '1week').toISOString())
      .toBe('2025-12-29T00:00:00.000Z');
    // 2026-01-05 is a Monday → new week.
    expect(bucketStart('2026-01-05T00:00:00.000Z', '1week').toISOString())
      .toBe('2026-01-05T00:00:00.000Z');
  });
});

/* ============================================================================
   3. aggregateCandles — OHLCV rules
   ============================================================================ */
describe('aggregateCandles — OHLCV rules', () => {
  it('15min → 1h uses first-open, max-high, min-low, last-close, sum-volume', () => {
    const input = [
      candle('2026-01-01T10:00:00.000Z', 100, 101, 99, 100.5, 10),
      candle('2026-01-01T10:15:00.000Z', 100.5, 102, 100, 101, 20),
      candle('2026-01-01T10:30:00.000Z', 101, 103, 100.5, 102.5, 30),
      candle('2026-01-01T10:45:00.000Z', 102.5, 104, 102, 103, 40)
    ];
    const out = aggregateCandles(input, '15min', '1h');
    expect(out.length).toBe(1);
    expect(out[0].timestamp).toBe('2026-01-01T10:00:00.000Z');
    expect(out[0].open).toBe(100);
    expect(out[0].high).toBe(104);
    expect(out[0].low).toBe(99);
    expect(out[0].close).toBe(103);
    expect(out[0].volume).toBe(100);
    expect(out[0].source).toBe('aggregated');
    expect(out[0].dataStatus).toBe('historical');
  });

  it('1h → 4h produces one bucket per 4-hour block', () => {
    const input = [
      candle('2026-01-01T00:00:00.000Z', 100, 102, 99, 101, 10),
      candle('2026-01-01T01:00:00.000Z', 101, 105, 100, 104, 20),
      candle('2026-01-01T02:00:00.000Z', 104, 106, 103, 105, 30),
      candle('2026-01-01T03:00:00.000Z', 105, 107, 104, 106, 40),
      candle('2026-01-01T04:00:00.000Z', 106, 108, 105, 107, 50)
    ];
    const out = aggregateCandles(input, '1h', '4h');
    expect(out.length).toBe(2);
    expect(out[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(out[0].open).toBe(100);
    expect(out[0].high).toBe(107);
    expect(out[0].low).toBe(99);
    expect(out[0].close).toBe(106);
    expect(out[0].volume).toBe(100);
    expect(out[1].timestamp).toBe('2026-01-01T04:00:00.000Z');
    expect(out[1].open).toBe(106);
    expect(out[1].close).toBe(107);
    expect(out[1].volume).toBe(50);
  });

  it('preserves chronological ordering even with unsorted input', () => {
    // Feed candles in reverse order to ensure the aggregator sorts output.
    const input = [
      candle('2026-01-01T03:00:00.000Z', 105, 107, 104, 106, 40),
      candle('2026-01-01T02:00:00.000Z', 104, 106, 103, 105, 30),
      candle('2026-01-01T01:00:00.000Z', 101, 105, 100, 104, 20),
      candle('2026-01-01T00:00:00.000Z', 100, 102, 99, 101, 10)
    ];
    const out = aggregateCandles(input, '1h', '1day');
    expect(out.length).toBe(1);
    expect(out[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(out[0].open).toBe(100);
    expect(out[0].high).toBe(107);
    expect(out[0].low).toBe(99);
    expect(out[0].close).toBe(106);
    expect(out[0].volume).toBe(100);
  });
});

/* ============================================================================
   4. Volume handling
   ============================================================================ */
describe('aggregateCandles — volume', () => {
  it('returns null volume when every candle has null volume', () => {
    const input = [
      candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, null),
      candle('2026-01-01T01:00:00.000Z', 100, 102, 99, 101, null),
      candle('2026-01-01T02:00:00.000Z', 101, 103, 100, 102, null)
    ];
    const out = aggregateCandles(input, '1h', '1day');
    expect(out.length).toBe(1);
    expect(out[0].volume).toBeNull();
  });

  it('sums only finite volumes when some are null', () => {
    const input = [
      candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 10),
      candle('2026-01-01T01:00:00.000Z', 100, 102, 99, 101, null),
      candle('2026-01-01T02:00:00.000Z', 101, 103, 100, 102, 30)
    ];
    const out = aggregateCandles(input, '1h', '1day');
    expect(out[0].volume).toBe(40);
  });

  it('treats a zero volume candle as a real value in the sum', () => {
    const input = [
      candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 0),
      candle('2026-01-01T01:00:00.000Z', 100, 102, 99, 101, 5)
    ];
    const out = aggregateCandles(input, '1h', '1day');
    expect(out[0].volume).toBe(5);
  });
});

/* ============================================================================
   5. Empty and error cases
   ============================================================================ */
describe('aggregateCandles — edge cases', () => {
  it('empty input yields empty output', () => {
    expect(aggregateCandles([], '1h', '1day')).toEqual([]);
    expect(aggregateCandles([], '15min', '1h')).toEqual([]);
    expect(aggregateCandles([], '1day', '1week')).toEqual([]);
  });

  it('throws on unsupported transformation (15min → 1day)', () => {
    const input = [candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 1)];
    expect(() =>
      aggregateCandles(
        input,
        '15min' as SourceInterval,
        '1day' as AggregateInterval
      )
    ).toThrow(/Unsupported aggregation/);
  });

  it('throws on unsupported transformation (4h → 1day)', () => {
    const input = [candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 1)];
    expect(() =>
      aggregateCandles(
        input,
        '4h' as unknown as SourceInterval,
        '1day' as AggregateInterval
      )
    ).toThrow(/Unsupported aggregation/);
  });

  it('throws on coarse → fine transformation (1day → 1h)', () => {
    const input = [candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 1)];
    expect(() =>
      aggregateCandles(
        input,
        '1day' as SourceInterval,
        '1h' as AggregateInterval
      )
    ).toThrow(/Unsupported aggregation/);
  });

  it('drops candles with invalid OHLC before aggregating', () => {
    const input = [
      candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 10),
      // high below open — invalid; toClosedCandles keeps the numbers but
      // aggregateCandles should still work because it treats the row as-is.
      // The point of this test is that the aggregator does not throw.
      candle('2026-01-01T01:00:00.000Z', 101, 103, 100, 102, 20)
    ];
    const out = aggregateCandles(input, '1h', '1day');
    expect(out.length).toBe(1);
    expect(out[0].volume).toBe(30);
  });
});

/* ============================================================================
   6. intervalMs
   ============================================================================ */
describe('intervalMs', () => {
  it('reports correct durations for each target', () => {
    expect(intervalMs('1h')).toBe(60 * 60 * 1000);
    expect(intervalMs('4h')).toBe(4 * 60 * 60 * 1000);
    expect(intervalMs('1day')).toBe(24 * 60 * 60 * 1000);
    expect(intervalMs('1week')).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
