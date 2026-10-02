/* ============================================================================
   backend/src/services/TimeframeAggregator.ts
   ----------------------------------------------------------------------------
   PHASE 5 — Deterministic candle aggregation with explicit source validation.

   Aggregation rules (for every target bucket):
     open   = first candle's open
     high   = max high
     low    = min low
     close  = last candle's close
     volume = sum of available volumes, or null if every candle in the
              bucket has null volume

   Bucket alignment (all UTC)
     1h    — top of the hour (minute, second, ms = 0)
     4h    — 4-hour block, aligned to 0/4/8/12/16/20 UTC
     1day  — 00:00 UTC
     1week — Monday 00:00 UTC (ISO week start)

   Supported source → target transformations
     15min → 1h
     15min → 4h
     1h    → 4h
     1h    → 1day
     1day  → 1week
   Any other combination is rejected — do not invent aggregation chains.

   Limitations
     • No exchange-session semantics. 1day buckets are UTC days. VWAP and
       aggregation both ignore exchange sessions in Phase 5.
     • Partial buckets at the tail of the input are included as-is. Callers
       that require complete buckets must filter by expected count.
   ============================================================================ */

import type { NormalizedMarketData } from '../providers/MarketDataProvider';
import { toClosedCandles, type ClosedCandle } from './IndicatorService';

export type AggregateInterval = '1h' | '4h' | '1day' | '1week';
export type SourceInterval = '15min' | '1h' | '1day';

const HOUR_MS = 60 * 60 * 1000;

/* ----------------------------------------------------------------------------
   Supported transformations table
   ----------------------------------------------------------------------------
   Keyed by `${source}->${target}`. The presence of a key means the
   transformation is defined and deterministic. `ratio` is the number of
   source bars per target bar in the ideal case (used for diagnostics; the
   aggregator itself does not require exactly that many source bars).
   -------------------------------------------------------------------------- */
interface Transformation {
  source: SourceInterval;
  target: AggregateInterval;
  ratio: number;
}

const TRANSFORMATIONS: readonly Transformation[] = [
  { source: '15min', target: '1h',    ratio: 4 },
  { source: '15min', target: '4h',    ratio: 16 },
  { source: '1h',    target: '4h',    ratio: 4 },
  { source: '1h',    target: '1day',  ratio: 24 },
  { source: '1day',  target: '1week', ratio: 5 }
];

const TRANSFORMATION_INDEX: Record<string, Transformation> = (() => {
  const m: Record<string, Transformation> = {};
  for (const t of TRANSFORMATIONS) m[`${t.source}->${t.target}`] = t;
  return m;
})();

export const SUPPORTED_AGGREGATIONS: ReadonlyArray<{
  source: SourceInterval;
  target: AggregateInterval;
  ratio: number;
}> = TRANSFORMATIONS.map((t) => ({
  source: t.source,
  target: t.target,
  ratio: t.ratio
}));

/**
 * True when the source→target transformation is defined. Everything else is
 * unsupported and must be rejected before calling aggregateCandles.
 */
export function canAggregate(source: string, target: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    TRANSFORMATION_INDEX,
    `${source}->${target}`
  );
}

/**
 * Number of source bars per target bar, or null when the transformation is
 * unsupported. Used for planning and diagnostics only.
 */
export function aggregationRatio(source: string, target: string): number | null {
  const t = TRANSFORMATION_INDEX[`${source}->${target}`];
  return t ? t.ratio : null;
}

/* ----------------------------------------------------------------------------
   Bucket alignment
   -------------------------------------------------------------------------- */

export function bucketStart(timestampISO: string, target: AggregateInterval): Date {
  const d = new Date(timestampISO);
  if (target === '1h') {
    d.setUTCMinutes(0, 0, 0);
    return d;
  }
  if (target === '4h') {
    const hour = d.getUTCHours();
    d.setUTCHours(Math.floor(hour / 4) * 4, 0, 0, 0);
    return d;
  }
  if (target === '1day') {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  // 1week — Monday 00:00 UTC.
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday
  const daysFromMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return d;
}

/* ----------------------------------------------------------------------------
   Aggregate
   ----------------------------------------------------------------------------
   Aggregates `candles` from the declared `source` interval into `target`.
   Throws when the transformation is unsupported. Callers must check
   `canAggregate(source, target)` first.
   -------------------------------------------------------------------------- */
export function aggregateCandles(
  candles: NormalizedMarketData[],
  source: SourceInterval,
  target: AggregateInterval
): NormalizedMarketData[] {
  if (!canAggregate(source, target)) {
    throw new Error(
      `Unsupported aggregation: ${source} -> ${target}. ` +
      `Allowed: ${SUPPORTED_AGGREGATIONS.map((s) => `${s.source}->${s.target}`).join(', ')}`
    );
  }

  const closed = toClosedCandles(candles);
  if (closed.length === 0) return [];

  const buckets = new Map<number, ClosedCandle[]>();

  for (const c of closed) {
    const start = bucketStart(c.timestamp, target);
    const key = start.getTime();
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }

  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const out: NormalizedMarketData[] = [];

  for (const key of sortedKeys) {
    const group = buckets.get(key) as ClosedCandle[];
    const first = group[0];
    const last = group[group.length - 1];

    let high = first.high;
    let low = first.low;
    let volumeSum = 0;
    let volumeSeen = false;

    for (const c of group) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      if (c.volume !== null) {
        volumeSum += c.volume;
        volumeSeen = true;
      }
    }

    out.push({
      symbol: candles[0].symbol,
      market: candles[0].market,
      timestamp: new Date(key).toISOString(),
      price: null,
      open: first.open,
      high,
      low,
      close: last.close,
      volume: volumeSeen ? volumeSum : null,
      currency: candles[0].currency,
      source: 'aggregated',
      dataStatus: 'historical'
    });
  }

  return out;
}

/**
 * Length, in milliseconds, of one candle at the given interval.
 */
export function intervalMs(interval: AggregateInterval): number {
  switch (interval) {
    case '1h': return HOUR_MS;
    case '4h': return HOUR_MS * 4;
    case '1day': return HOUR_MS * 24;
    case '1week': return HOUR_MS * 24 * 7;
  }
}
