/* ============================================================================
   PHASE 5 — Indicator unit tests (pure functions, no network, no secrets).

   Covers every public indicator in IndicatorService.ts:
     • toClosedCandles      — input coercion, null handling
     • SMA                  — warm-up, exact means, period > length
     • EMA                  — SMA seed, no NaN, finite values
     • RSI                  — warm-up boundary, all-gains = 100, all-losses = 0
     • MACD                 — signal warm-up at 33, histogram identity
     • Bollinger            — warm-up, null bandwidth when middle null
     • ATR                  — warm-up, no NaN, atrPercent
     • VWAP                 — UTC-day reset, null volume carry
     • ADX                  — warm-up at 2*period-1, +DI/-DI presence
     • volumeSma            — null-in-window → null, exact mean
     • volumeRatio          — null when SMA null or zero
     • priceChange          — first null, correct deltas and percents
     • computeIndicatorSeries / latestSnapshot
                            — no NaN, alignment, shape

   Every fixture is deterministic. No Date.now(), no randomness.
   ============================================================================ */

import { describe, it, expect } from 'vitest';
import {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  vwap,
  adx,
  volumeSma,
  volumeRatio,
  priceChange,
  toClosedCandles,
  computeIndicatorSeries,
  latestSnapshot
} from '../IndicatorService';
import type { NormalizedMarketData } from '../../providers/MarketDataProvider';

/* ============================================================================
   Fixtures
   ============================================================================ */

function candle(
  timestamp: string,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number | null = 1000
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

/**
 * Build `count` consecutive daily UTC candles with a deterministic pattern.
 * The pattern is sinusoidal so EMAs, RSI, MACD, etc. all produce
 * distinguishable non-degenerate values.
 */
function syntheticCandles(count: number): NormalizedMarketData[] {
  const out: NormalizedMarketData[] = [];
  for (let i = 0; i < count; i++) {
    const mid = 100 + Math.sin(i / 5) * 10;
    out.push(
      candle(
        new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
        mid,
        mid + 1,
        mid - 1,
        mid + 0.5,
        1000 + i
      )
    );
  }
  return out;
}

/* ============================================================================
   1. toClosedCandles
   ============================================================================ */
describe('toClosedCandles', () => {
  it('keeps rows with complete OHLC and null volume', () => {
    const input: NormalizedMarketData[] = [
      candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, null)
    ];
    const out = toClosedCandles(input);
    expect(out.length).toBe(1);
    expect(out[0].volume).toBeNull();
  });

  it('drops rows with any null OHLC component', () => {
    const bad = candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100);
    // Force a null mid-structure to simulate an upstream anomaly.
    (bad as unknown as { open: number | null }).open = null;
    expect(toClosedCandles([bad]).length).toBe(0);
  });

  it('drops rows with non-finite OHLC', () => {
    const bad = candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100);
    (bad as unknown as { high: number }).high = Number.NaN;
    expect(toClosedCandles([bad]).length).toBe(0);
  });

  it('treats null volume as null and finite volume as finite', () => {
    const a = candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 500);
    const b = candle('2026-01-02T00:00:00.000Z', 100, 101, 99, 100, null);
    const out = toClosedCandles([a, b]);
    expect(out[0].volume).toBe(500);
    expect(out[1].volume).toBeNull();
  });
});

/* ============================================================================
   2. SMA
   ============================================================================ */
describe('SMA', () => {
  it('produces nulls for warm-up and exact means afterwards', () => {
    const v = [1, 2, 3, 4, 5];
    const out = sma(v, 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it('handles period larger than input', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it('period 1 returns the original values', () => {
    expect(sma([10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it('handles empty input', () => {
    expect(sma([], 5)).toEqual([]);
  });
});

/* ============================================================================
   3. EMA
   ============================================================================ */
describe('EMA', () => {
  it('seeds with SMA at index period-1', () => {
    const v = [1, 2, 3, 4, 5, 6];
    const out = ema(v, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 6);
  });

  it('never emits NaN or Infinity for finite input', () => {
    const v = Array.from({ length: 50 }, (_, i) => 100 + i);
    const out = ema(v, 12);
    for (let i = 11; i < out.length; i++) {
      expect(Number.isFinite(out[i] as number)).toBe(true);
    }
  });

  it('period larger than input yields all nulls', () => {
    expect(ema([1, 2, 3], 10).every((v) => v === null)).toBe(true);
  });
});

/* ============================================================================
   4. RSI
   ============================================================================ */
describe('RSI', () => {
  it('returns nulls for the first `period` positions', () => {
    const v = Array.from({ length: 20 }, (_, i) => 100 + i);
    const out = rsi(v, 14);
    for (let i = 0; i < 14; i++) expect(out[i]).toBeNull();
    expect(out[14]).not.toBeNull();
  });

  it('is 100 when there are only gains', () => {
    const v = Array.from({ length: 20 }, (_, i) => 100 + i);
    const out = rsi(v, 14);
    expect(out[14]).toBeCloseTo(100, 6);
  });

  it('is 0 when there are only losses', () => {
    const v = Array.from({ length: 20 }, (_, i) => 200 - i);
    const out = rsi(v, 14);
    // avgGain = 0 → formula gives RSI = 100 - 100/(1 + 0) = 0.
    expect(out[14]).toBeCloseTo(0, 6);
  });

  it('never emits NaN for finite input', () => {
    const v = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
    const out = rsi(v, 14);
    for (const x of out) {
      if (x !== null) expect(Number.isFinite(x)).toBe(true);
    }
  });
});

/* ============================================================================
   5. MACD
   ============================================================================ */
describe('MACD', () => {
  it('produces null signal until enough MACD observations exist', () => {
    const v = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const m = macd(v, 12, 26, 9);
    // signal only valid from index (26-1) + (9-1) = 33
    for (let i = 0; i < 33; i++) expect(m.signal[i]).toBeNull();
    expect(m.signal[33]).not.toBeNull();
  });

  it('histogram = line - signal wherever both are defined', () => {
    const v = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(v, 12, 26, 9);
    for (let i = 0; i < v.length; i++) {
      const l = m.line[i];
      const s = m.signal[i];
      const h = m.histogram[i];
      if (l !== null && s !== null) {
        expect(h).toBeCloseTo(l - s, 6);
      } else {
        expect(h).toBeNull();
      }
    }
  });

  it('returns empty result for fast >= slow', () => {
    const v = [1, 2, 3];
    const m = macd(v, 26, 12, 9);
    expect(m.line.every((x) => x === null)).toBe(true);
    expect(m.signal.every((x) => x === null)).toBe(true);
    expect(m.histogram.every((x) => x === null)).toBe(true);
  });
});

/* ============================================================================
   6. Bollinger
   ============================================================================ */
describe('Bollinger', () => {
  it('middle band null during warm-up', () => {
    const v = Array.from({ length: 25 }, (_, i) => 100 + i);
    const b = bollinger(v, 20, 2);
    expect(b.middle[18]).toBeNull();
    expect(b.bandwidth[18]).toBeNull();
    expect(b.middle[19]).not.toBeNull();
  });

  it('percentB null when upper equals lower (std = 0)', () => {
    const v = Array.from({ length: 20 }, () => 100);
    const b = bollinger(v, 20, 2);
    expect(b.percentB[19]).toBeNull();
  });

  it('upper > middle > lower when std > 0', () => {
    const v = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const b = bollinger(v, 20, 2);
    for (let i = 19; i < v.length; i++) {
      const m = b.middle[i];
      const u = b.upper[i];
      const l = b.lower[i];
      if (m !== null && u !== null && l !== null) {
        expect(u).toBeGreaterThan(m);
        expect(m).toBeGreaterThan(l);
      }
    }
  });

  it('never emits NaN for finite input', () => {
    const v = syntheticCandles(60).map((c) => c.close as number);
    const b = bollinger(v, 20, 2);
    for (const arr of [b.middle, b.upper, b.lower, b.bandwidth, b.percentB]) {
      for (const x of arr) {
        if (x !== null) expect(Number.isFinite(x)).toBe(true);
      }
    }
  });
});

/* ============================================================================
   7. ATR
   ============================================================================ */
describe('ATR', () => {
  it('respects warm-up (first valid index = period)', () => {
    const closed = toClosedCandles(
      Array.from({ length: 30 }, (_, i) =>
        candle(
          new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
          100 + i,
          102 + i,
          99 + i,
          101 + i
        )
      )
    );
    const a = atr(closed, 14);
    for (let i = 0; i < 14; i++) expect(a.atr[i]).toBeNull();
    expect(a.atr[14]).not.toBeNull();
  });

  it('atrPercent = atr / close * 100', () => {
    const closed = toClosedCandles(syntheticCandles(60));
    const a = atr(closed, 14);
    for (let i = 0; i < closed.length; i++) {
      const x = a.atr[i];
      const p = a.atrPercent[i];
      if (x !== null && p !== null) {
        expect(p).toBeCloseTo((x / closed[i].close) * 100, 6);
      }
    }
  });

  it('never emits NaN or Infinity', () => {
    const closed = toClosedCandles(syntheticCandles(60));
    const a = atr(closed, 14);
    for (const x of a.atr) {
      if (x !== null) expect(Number.isFinite(x)).toBe(true);
    }
  });
});

/* ============================================================================
   8. VWAP
   ============================================================================ */
describe('VWAP', () => {
  it('resets at each UTC day boundary', () => {
    const c = [
      candle('2026-01-01T10:00:00.000Z', 100, 101, 99, 100, 10),
      candle('2026-01-01T11:00:00.000Z', 100, 102, 100, 101, 20),
      candle('2026-01-02T10:00:00.000Z', 200, 201, 199, 200, 5)
    ];
    const out = vwap(toClosedCandles(c));
    // Day 1, first candle: typical = (101 + 99 + 100)/3 = 100 → VWAP 100.
    expect(out[0]).toBeCloseTo(100, 6);
    // Day 1, second: typical = (102 + 100 + 101)/3 = 101
    // VWAP = (100*10 + 101*20) / 30 = 100.666…
    expect(out[1]).toBeCloseTo((100 * 10 + 101 * 20) / 30, 6);
    // Day 2 resets: typical = (201 + 199 + 200)/3 = 200 → VWAP 200.
    expect(out[2]).toBeCloseTo(200, 6);
  });

  it('carries running VWAP when a candle has null volume', () => {
    const c = [
      candle('2026-01-01T10:00:00.000Z', 100, 101, 99, 100, 10),
      candle('2026-01-01T11:00:00.000Z', 100, 102, 100, 101, null)
    ];
    const out = vwap(toClosedCandles(c));
    // Second candle contributes nothing; VWAP remains the prior value.
    expect(out[1]).toBeCloseTo(100, 6);
  });

  it('carries running VWAP when a candle has zero volume', () => {
    const c = [
      candle('2026-01-01T10:00:00.000Z', 100, 101, 99, 100, 10),
      candle('2026-01-01T11:00:00.000Z', 100, 102, 100, 101, 0)
    ];
    const out = vwap(toClosedCandles(c));
    expect(out[1]).toBeCloseTo(100, 6);
  });

  it('first candle with null volume yields null', () => {
    const c = [
      candle('2026-01-01T10:00:00.000Z', 100, 101, 99, 100, null)
    ];
    const out = vwap(toClosedCandles(c));
    expect(out[0]).toBeNull();
  });
});

/* ============================================================================
   9. ADX
   ============================================================================ */
describe('ADX', () => {
  it('produces null until 2*period-1 positions', () => {
    const closed = toClosedCandles(
      Array.from({ length: 40 }, (_, i) =>
        candle(
          new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
          100 + i,
          102 + i,
          99 + i,
          101 + i
        )
      )
    );
    const a = adx(closed, 14);
    for (let i = 0; i < 27; i++) expect(a.adx[i]).toBeNull();
    expect(a.adx[27]).not.toBeNull();
  });

  it('returns all nulls when input is too short', () => {
    const closed = toClosedCandles(
      Array.from({ length: 20 }, (_, i) =>
        candle(
          new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
          100 + i,
          102 + i,
          99 + i,
          101 + i
        )
      )
    );
    const a = adx(closed, 14);
    expect(a.adx.every((x) => x === null)).toBe(true);
  });

  it('exposes +DI and -DI alongside ADX after warm-up', () => {
    const closed = toClosedCandles(syntheticCandles(60));
    const a = adx(closed, 14);
    for (let i = 27; i < closed.length; i++) {
      expect(a.plusDI[i]).not.toBeNull();
      expect(a.minusDI[i]).not.toBeNull();
    }
  });

  it('never emits NaN for finite input', () => {
    const closed = toClosedCandles(syntheticCandles(60));
    const a = adx(closed, 14);
    for (const arr of [a.adx, a.plusDI, a.minusDI]) {
      for (const x of arr) {
        if (x !== null) expect(Number.isFinite(x)).toBe(true);
      }
    }
  });
});

/* ============================================================================
   10. Volume
   ============================================================================ */
describe('volumeSma', () => {
  it('null in the SMA window yields null for that index', () => {
    const c = [
      candle('2026-01-01T00:00:00.000Z', 1, 1, 1, 1, 10),
      candle('2026-01-02T00:00:00.000Z', 1, 1, 1, 1, null),
      candle('2026-01-03T00:00:00.000Z', 1, 1, 1, 1, 20)
    ];
    const closed = toClosedCandles(c);
    const out = volumeSma(closed, 3);
    expect(out[2]).toBeNull(); // window contains a null
  });

  it('computes exact mean when every volume in the window is finite', () => {
    const c = [
      candle('2026-01-01T00:00:00.000Z', 1, 1, 1, 1, 10),
      candle('2026-01-02T00:00:00.000Z', 1, 1, 1, 1, 20),
      candle('2026-01-03T00:00:00.000Z', 1, 1, 1, 1, 30)
    ];
    const closed = toClosedCandles(c);
    const out = volumeSma(closed, 3);
    expect(out[2]).toBe(20);
  });
});

describe('volumeRatio', () => {
  it('null when SMA is null', () => {
    const c = [
      candle('2026-01-01T00:00:00.000Z', 1, 1, 1, 1, 10),
      candle('2026-01-02T00:00:00.000Z', 1, 1, 1, 1, 20)
    ];
    const closed = toClosedCandles(c);
    const smaVals = volumeSma(closed, 5); // too few candles → all null
    const ratio = volumeRatio(closed, smaVals);
    expect(ratio[0]).toBeNull();
    expect(ratio[1]).toBeNull();
  });

  it('null when SMA is zero', () => {
    const c = [
      candle('2026-01-01T00:00:00.000Z', 1, 1, 1, 1, 0),
      candle('2026-01-02T00:00:00.000Z', 1, 1, 1, 1, 0)
    ];
    const closed = toClosedCandles(c);
    const smaVals = volumeSma(closed, 2);
    const ratio = volumeRatio(closed, smaVals);
    expect(ratio[1]).toBeNull();
  });

  it('equals volume / SMA when both are finite and SMA > 0', () => {
    const c = [
      candle('2026-01-01T00:00:00.000Z', 1, 1, 1, 1, 10),
      candle('2026-01-02T00:00:00.000Z', 1, 1, 1, 1, 20)
    ];
    const closed = toClosedCandles(c);
    const smaVals = volumeSma(closed, 2);
    const ratio = volumeRatio(closed, smaVals);
    expect(ratio[1]).toBeCloseTo(20 / 15, 6);
  });
});

/* ============================================================================
   11. priceChange
   ============================================================================ */
describe('priceChange', () => {
  it('first value null; later values are absolute deltas', () => {
    const c = priceChange([100, 105, 100]);
    expect(c.change).toEqual([null, 5, -5]);
  });

  it('changePercent relative to previous close', () => {
    const c = priceChange([100, 105, 100]);
    expect(c.changePercent[1]).toBeCloseTo(5, 6);
    expect(c.changePercent[2]).toBeCloseTo(-4.76190476, 6);
  });

  it('null changePercent when previous close is zero', () => {
    const c = priceChange([0, 5]);
    expect(c.change[1]).toBe(5);
    expect(c.changePercent[1]).toBeNull();
  });
});

/* ============================================================================
   12. computeIndicatorSeries + latestSnapshot
   ============================================================================ */
describe('computeIndicatorSeries', () => {
  it('returns one row per input candle and never produces NaN or Infinity', () => {
    const candles = syntheticCandles(250);
    const series = computeIndicatorSeries(candles);
    expect(series.length).toBe(250);
    for (const row of series) {
      for (const value of Object.values(row)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it('preserves timestamp order', () => {
    const candles = syntheticCandles(50);
    const series = computeIndicatorSeries(candles);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].timestamp >= series[i - 1].timestamp).toBe(true);
    }
  });

  it('empty input → empty output', () => {
    expect(computeIndicatorSeries([])).toEqual([]);
  });

  it('drops candles with invalid OHLC before computing', () => {
    const good = candle('2026-01-01T00:00:00.000Z', 100, 101, 99, 100, 10);
    const bad = candle('2026-01-02T00:00:00.000Z', 100, 101, 99, 100, 10);
    (bad as unknown as { close: number | null }).close = null;
    const series = computeIndicatorSeries([good, bad]);
    expect(series.length).toBe(1);
  });
});

describe('latestSnapshot', () => {
  it('returns null for empty input', () => {
    expect(latestSnapshot([])).toBeNull();
  });

  it('returns the last row shaped as IndicatorSnapshot', () => {
    const candles = syntheticCandles(250);
    const snap = latestSnapshot(candles);
    expect(snap).not.toBeNull();
    if (!snap) return;
    expect(typeof snap.timestamp).toBe('string');
    expect(typeof snap.price === 'number' || snap.price === null).toBe(true);
    expect(snap.macd).toBeDefined();
    expect(snap.bollinger).toBeDefined();
    expect('rsi14' in snap).toBe(true);
    expect('adx14' in snap).toBe(true);
    expect('vwap' in snap).toBe(true);
  });

  it('numeric fields are finite when present', () => {
    const candles = syntheticCandles(250);
    const snap = latestSnapshot(candles);
    if (!snap) return;
    const check = (v: unknown) => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    };
    check(snap.price);
    check(snap.sma20);
    check(snap.sma50);
    check(snap.sma200);
    check(snap.ema20);
    check(snap.ema50);
    check(snap.ema200);
    check(snap.rsi14);
    check(snap.atr14);
    check(snap.atrPercent);
    check(snap.vwap);
    check(snap.adx14);
    check(snap.plusDI14);
    check(snap.minusDI14);
    check(snap.volume);
    check(snap.volumeSma20);
    check(snap.volumeRatio);
    check(snap.macd.line);
    check(snap.macd.signal);
    check(snap.macd.histogram);
    check(snap.bollinger.middle);
    check(snap.bollinger.upper);
    check(snap.bollinger.lower);
    check(snap.bollinger.bandwidth);
    check(snap.bollinger.percentB);
  });
});
