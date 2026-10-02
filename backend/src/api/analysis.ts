/* ============================================================================
   backend/src/api/analysis.ts
   ----------------------------------------------------------------------------
   PHASE 5 — Analysis endpoints.

   GET /api/v1/analysis/indicators
     symbol | query       required
     interval             optional, default 1day
     limit | outputsize   optional, default 250, max 500
     indicators           optional, comma-separated list. Default: all.

   GET /api/v1/analysis/mtf
     symbol | query       required
     timeframes           optional, comma-separated, default 15min,1h,4h,1day
     limit                optional, default 200, max 500

   MTF aggregation strategy
     The requested timeframes are sorted from finest to coarsest. The finest
     timeframe is fetched directly from the provider. Each subsequent
     timeframe is derived by the TimeframeAggregator from the finest already
     available source that supports the transformation. If no supported
     transformation exists from any available source, that timeframe is
     fetched directly.

     Example: [15min, 1h, 4h, 1day] with any limit produces a plan with
     ONE direct fetch (15min) and THREE derived timeframes (1h from 15min,
     4h from 1h, 1day from 1h).

     Requesting a coarser timeframe that cannot be derived (e.g. [1day]
     alone, or [15min, 1day] where no supported chain connects them) will
     fetch it directly.

   This module does NOT modify market.ts. It reuses AssetResolver, the
   provider layer, and the response helpers.
   ============================================================================ */

import type { Env, Asset } from '../types';
import { ok, fail } from '../utils/response';
import {
  ERROR_CODES,
  TD_ALLOWED_INTERVALS,
  TD_MAX_OUTPUT_SIZE
} from '../config';
import { resolveAsset } from '../services/AssetResolver';
import { getProviderForAsset } from '../services/MarketService';
import type {
  Timeframe,
  NormalizedMarketData
} from '../providers/MarketDataProvider';
import {
  computeIndicatorSeries,
  latestSnapshot,
  type IndicatorSeries,
  type IndicatorSnapshot
} from '../services/IndicatorService';
import {
  analyseTimeframe,
  summariseAlignment,
  MTF_TIMEFRAMES,
  type MtfTimeframe,
  type TimeframeAnalysis,
  type AlignmentSummary,
  type BarSource
} from '../services/MultiTimeframeService';
import {
  aggregateCandles,
  canAggregate,
  type AggregateInterval,
  type SourceInterval
} from '../services/TimeframeAggregator';

/* ============================================================================
   Input parsing
   ============================================================================ */

function readRequiredParam(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function readSymbolOrQuery(url: URL): string | null {
  const s = readRequiredParam(url, 'symbol');
  if (s !== null) return s;
  return readRequiredParam(url, 'query');
}

function readInterval(url: URL): Timeframe | null {
  const raw = url.searchParams.get('interval');
  if (raw === null) return '1day';
  const trimmed = raw.trim();
  if (!TD_ALLOWED_INTERVALS.includes(trimmed)) return null;
  return trimmed as Timeframe;
}

function readOutputSize(url: URL, fallback: number): number | null {
  const raw =
    url.searchParams.get('limit') ?? url.searchParams.get('outputsize');
  if (raw === null) return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > TD_MAX_OUTPUT_SIZE) return null;
  return parsed;
}

function readIndicators(url: URL): Set<string> | null {
  const raw = url.searchParams.get('indicators');
  if (raw === null) return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
  if (parts.length === 0) return null;
  return new Set(parts);
}

function readTimeframes(url: URL): MtfTimeframe[] | null {
  const raw = url.searchParams.get('timeframes');
  if (raw === null) return MTF_TIMEFRAMES.slice();
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
  if (parts.length === 0 || parts.length > 4) return null;
  const out: MtfTimeframe[] = [];
  for (const p of parts) {
    if (!MTF_TIMEFRAMES.includes(p as MtfTimeframe)) return null;
    out.push(p as MtfTimeframe);
  }
  return out;
}

/* ============================================================================
   Symbol resolution — reuses AssetResolver exactly like api/market.ts.
   ============================================================================ */

type ResolveResult = { asset: Asset } | { error: Response };

function resolveSymbol(
  url: URL,
  headers: Record<string, string>
): ResolveResult {
  const symbol = readSymbolOrQuery(url);
  if (symbol === null) {
    return {
      error: fail(
        ERROR_CODES.INVALID_QUERY,
        'Query parameter "symbol" (or "query") is required and must not be empty.',
        400,
        headers
      )
    };
  }
  const asset = resolveAsset(symbol);
  if (asset === null) {
    return {
      error: fail(
        ERROR_CODES.INVALID_SYMBOL,
        `No asset matched the symbol "${symbol}".`,
        404,
        headers
      )
    };
  }
  return { asset };
}

/* ============================================================================
   GET /api/v1/analysis/indicators
   ============================================================================ */

export async function analysisIndicatorsHandler(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const resolved = resolveSymbol(url, headers);
  if ('error' in resolved) return resolved.error;

  const interval = readInterval(url);
  if (interval === null) {
    return fail(
      ERROR_CODES.INVALID_INTERVAL,
      `Interval must be one of: ${TD_ALLOWED_INTERVALS.join(', ')}.`,
      400,
      headers
    );
  }

  const limit = readOutputSize(url, 250);
  if (limit === null) {
    return fail(
      ERROR_CODES.INVALID_OUTPUT_SIZE,
      `limit/outputsize must be a positive integer no greater than ${TD_MAX_OUTPUT_SIZE}.`,
      400,
      headers
    );
  }

  const indicatorFilter = readIndicators(url);

  const { asset } = resolved;
  const provider = getProviderForAsset(asset, env);
  const candles = await provider.getOHLCV(asset, interval, limit);

  if (candles === null) {
    return fail(
      ERROR_CODES.DATA_UNAVAILABLE,
      'Market data is unavailable for this symbol/provider.',
      503,
      headers,
      { dataStatus: 'unavailable' }
    );
  }

  const series: IndicatorSeries[] = computeIndicatorSeries(candles);
  const latest: IndicatorSnapshot | null = latestSnapshot(candles);

  const values = indicatorFilter
    ? series.map((row) => filterSeriesRow(row, indicatorFilter))
    : series;

  const latestFiltered = indicatorFilter && latest
    ? filterSnapshot(latest, indicatorFilter)
    : latest;

  return ok(
    {
      symbol: asset.symbol,
      market: asset.market,
      interval,
      count: values.length,
      values,
      latest: latestFiltered,
      metadata: {
        vwap:
          'VWAP is computed on UTC-day session boundaries. It is NOT ' +
          'exchange-session-aware and must not be described as exact ' +
          'NSE/NYSE session VWAP. Exchange-specific session VWAP will be ' +
          'introduced in a later phase.',
        aggregation:
          'Analysis runs on the exact interval requested. No multi-timeframe ' +
          'aggregation is applied to this endpoint.'
      }
    },
    headers
  );
}

/* ============================================================================
   GET /api/v1/analysis/mtf
   ============================================================================ */

interface MtfPlanDirect {
  tf: MtfTimeframe;
  limit: number;
}

interface MtfPlanDerived {
  tf: MtfTimeframe;
  source: MtfTimeframe;
}

interface MtfPlan {
  direct: MtfPlanDirect[];
  derived: MtfPlanDerived[];
}

const GRANULARITY_ORDER: readonly MtfTimeframe[] = ['15min', '1h', '4h', '1day'];

function granularityIndex(tf: MtfTimeframe): number {
  return GRANULARITY_ORDER.indexOf(tf);
}

/**
 * Build a plan that minimises upstream calls.
 *
 * Algorithm
 *   Sort requested timeframes by granularity (finest first).
 *   For each target in that order:
 *     Find the finest already-available source (direct or derived) for
 *     which canAggregate(source, target) is true. If found, derive.
 *     Otherwise fetch the target directly.
 *
 * Because a derived timeframe is itself available as a source, chains
 * naturally form (e.g. 15min → 1h → 4h → 1day when the whole set is
 * requested). Only supported transformations are used.
 */
function buildMtfPlan(
  requested: MtfTimeframe[],
  limit: number
): MtfPlan {
  const sorted = [...requested].sort(
    (a, b) => granularityIndex(a) - granularityIndex(b)
  );

  const available = new Set<MtfTimeframe>();
  const direct: MtfPlanDirect[] = [];
  const derived: MtfPlanDerived[] = [];

  for (const target of sorted) {
    let bestSource: MtfTimeframe | null = null;

    for (const candidate of GRANULARITY_ORDER) {
      if (!available.has(candidate)) continue;
      if (candidate === target) continue;
      if (canAggregate(candidate, target)) {
        bestSource = candidate;
        break;
      }
    }

    if (bestSource !== null) {
      derived.push({ tf: target, source: bestSource });
      available.add(target);
    } else {
      direct.push({ tf: target, limit });
      available.add(target);
    }
  }

  return { direct, derived };
}

export async function analysisMtfHandler(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const resolved = resolveSymbol(url, headers);
  if ('error' in resolved) return resolved.error;

  const timeframes = readTimeframes(url);
  if (timeframes === null) {
    return fail(
      ERROR_CODES.INVALID_QUERY,
      `timeframes must be a comma-separated subset of: ${MTF_TIMEFRAMES.join(', ')}.`,
      400,
      headers
    );
  }

  const limit = readOutputSize(url, 200);
  if (limit === null) {
    return fail(
      ERROR_CODES.INVALID_OUTPUT_SIZE,
      `limit must be a positive integer no greater than ${TD_MAX_OUTPUT_SIZE}.`,
      400,
      headers
    );
  }

  const { asset } = resolved;
  const provider = getProviderForAsset(asset, env);
  const plan = buildMtfPlan(timeframes, limit);

  /* --- Step 1: execute direct fetches in parallel ----------------------- */
  const seriesByTf = new Map<MtfTimeframe, NormalizedMarketData[]>();

  const directResults = await Promise.all(
    plan.direct.map(async (item) => {
      const data = await provider.getOHLCV(
        asset,
        item.tf as Timeframe,
        item.limit
      );
      return { tf: item.tf, data: data ?? [] };
    })
  );

  for (const r of directResults) {
    seriesByTf.set(r.tf, r.data);
  }

  /* --- Step 2: apply derivations in plan order (chains allowed) --------- */
  for (const item of plan.derived) {
    const sourceData = seriesByTf.get(item.source) ?? [];
    if (sourceData.length === 0) {
      seriesByTf.set(item.tf, []);
      continue;
    }
    try {
      const derived = aggregateCandles(
        sourceData,
        item.source as SourceInterval,
        item.tf as AggregateInterval
      );
      seriesByTf.set(item.tf, derived);
    } catch {
      /* Unsupported transformation should be impossible here because
         buildMtfPlan checks canAggregate. If it ever happens, fall back to
         empty data rather than fabricating. */
      seriesByTf.set(item.tf, []);
    }
  }

  /* --- Step 3: build per-timeframe analyses ----------------------------- */
  const perTimeframe: Record<string, TimeframeAnalysis> = {};
  for (const tf of timeframes) {
    const candles = seriesByTf.get(tf) ?? [];
    const isDerived = plan.derived.some((d) => d.tf === tf);
    const source: BarSource = isDerived ? 'aggregated' : 'provider';
    perTimeframe[tf] = analyseTimeframe(tf, candles, source);
  }

  const alignment: AlignmentSummary = summariseAlignment(perTimeframe);

  return ok(
    {
      symbol: asset.symbol,
      market: asset.market,
      timeframes: perTimeframe,
      alignment,
      plan: {
        direct: plan.direct.map((d) => ({ tf: d.tf, limit: d.limit })),
        derived: plan.derived.map((d) => ({ tf: d.tf, source: d.source }))
      },
      metadata: {
        vwap:
          'VWAP in the underlying indicators is UTC-day session VWAP. Not ' +
          'exchange-session-aware.',
        aggregation:
          'Timeframes marked source="aggregated" were derived from a finer ' +
          'timeframe in the same request. Aggregated bars may be fewer than ' +
          'the requested limit if the source series is short.',
        vocabulary:
          'Values are descriptive only (bullish/bearish/mixed/unknown, ' +
          'low/normal/high). No trade instruction is produced in Phase 5.'
      }
    },
    headers
  );
}

/* ============================================================================
   Indicator filtering
   ============================================================================ */

function filterSeriesRow(
  row: IndicatorSeries,
  keep: Set<string>
): Partial<IndicatorSeries> & { timestamp: string; close: number } {
  const out: Record<string, unknown> = {
    timestamp: row.timestamp,
    close: row.close
  };
  const map: Record<string, keyof IndicatorSeries> = {
    sma20: 'sma20',
    sma50: 'sma50',
    sma200: 'sma200',
    ema20: 'ema20',
    ema50: 'ema50',
    ema200: 'ema200',
    rsi: 'rsi14',
    rsi14: 'rsi14',
    macd: 'macdLine',
    macdline: 'macdLine',
    macdsignal: 'macdSignal',
    macdhistogram: 'macdHistogram',
    bollinger: 'bollingerMiddle',
    bollingermiddle: 'bollingerMiddle',
    bollingerupper: 'bollingerUpper',
    bollingerlower: 'bollingerLower',
    bollingerbandwidth: 'bollingerBandwidth',
    bollingerpercentb: 'bollingerPercentB',
    atr: 'atr14',
    atr14: 'atr14',
    atrpercent: 'atrPercent',
    vwap: 'vwap',
    adx: 'adx14',
    adx14: 'adx14',
    plusdi: 'plusDI14',
    minusdi: 'minusDI14',
    volume: 'volume',
    volumesma20: 'volumeSma20',
    volumeratio: 'volumeRatio',
    change: 'change',
    changepercent: 'changePercent'
  };
  for (const key of keep) {
    const field = map[key];
    if (field) out[field] = row[field];
  }
  return out as Partial<IndicatorSeries> & { timestamp: string; close: number };
}

function filterSnapshot(
  snap: IndicatorSnapshot,
  keep: Set<string>
): Partial<IndicatorSnapshot> {
  const out: Partial<IndicatorSnapshot> = {
    timestamp: snap.timestamp,
    price: snap.price,
    change: snap.change,
    changePercent: snap.changePercent
  };
  const direct: Array<keyof IndicatorSnapshot> = [
    'sma20', 'sma50', 'sma200',
    'ema20', 'ema50', 'ema200',
    'rsi14', 'atr14', 'atrPercent',
    'vwap', 'adx14', 'plusDI14', 'minusDI14',
    'volume', 'volumeSma20', 'volumeRatio'
  ];
  for (const field of direct) {
    const name = String(field).toLowerCase();
    if (keep.has(name) || keep.has(name.replace(/14$/, ''))) {
      (out as Record<string, unknown>)[field] = snap[field];
    }
  }
  if (keep.has('macd') || keep.has('macdline') || keep.has('macdsignal')) {
    out.macd = snap.macd;
  }
  if (keep.has('bollinger') || keep.has('bollingerbands')) {
    out.bollinger = snap.bollinger;
  }
  return out;
}
