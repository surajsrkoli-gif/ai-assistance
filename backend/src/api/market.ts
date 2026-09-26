/* ============================================================================
   backend/src/api/market.ts
   ----------------------------------------------------------------------------
   Market data endpoints.

   PHASE 4A — corrections applied.
   ----------------------------------------------------------------------------
   Fixes vs. the previous draft
     1. No `as unknown as Response` casts anywhere. Every error path flows
        through `fail()`, which now accepts an options object as its fifth
        argument:
            fail(code, message, status, headers, { dataStatus })
        The flat error envelope supports a top-level `dataStatus` field
        without any unsafe casting.
     2. The /price handler returns the provider's honest status (typically
        'delayed'). It never invents 'realtime'.
     4. The /history handler requires explicit `from` and `to` query
        parameters, validates them, and calls
        `provider.getHistoricalData(asset, fromISO, toISO)`. It no longer
        masquerades as a generic OHLCV endpoint.
    10. Provider failures are surfaced as errors, not as empty successes.
        `null` from the provider → `fail(DATA_UNAVAILABLE, …)`.
        `[]` from the provider → successful response with `count: 0`.

   Endpoints
     GET /api/v1/market/status
     GET /api/v1/market/quote?symbol=RELIANCE
     GET /api/v1/market/price?symbol=RELIANCE
     GET /api/v1/market/ohlcv?symbol=RELIANCE&interval=1day&outputsize=100
     GET /api/v1/market/history?symbol=RELIANCE&from=2026-01-01&to=2026-09-26

   Security invariants
     • The provider's `errorCode` (internal) is mapped to a safe message and
       HTTP status. Raw upstream messages, URLs, and keys never surface.
     • No stack traces, no env values, no provider identifiers beyond
       `provider.name` (which is intentionally public: "twelve_data", "mock").

   Dependency direction
     router.ts → api/market.ts → services/ → providers/
   This file never imports a concrete provider.
   ============================================================================ */

import type { Env, Asset } from '../types';
import { ok, okFlat, fail } from '../utils/response';
import {
  ERROR_CODES,
  TD_ALLOWED_INTERVALS,
  TD_MAX_OUTPUT_SIZE,
  TD_DEFAULT_OUTPUT_SIZE
} from '../config';
import { resolveAsset } from '../services/AssetResolver';
import {
  getDefaultProvider,
  getProviderForAsset
} from '../services/MarketService';
import type {
  Timeframe,
  NormalizedMarketData
} from '../providers/MarketDataProvider';

/* ============================================================================
   Input parsing helpers
   ============================================================================ */

/**
 * Read a required query parameter. Returns `null` when the parameter is
 * absent, empty, or whitespace-only after trimming — so all three cases
 * produce the same `400 INVALID_QUERY` response.
 */
function readRequiredParam(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read the optional `interval` parameter, defaulting to '1day'. Returns
 * `null` when the value is present but not one of the allowed intervals.
 */
function readInterval(url: URL): Timeframe | null {
  const raw = url.searchParams.get('interval');
  if (raw === null) return '1day';
  const trimmed = raw.trim();
  if (!TD_ALLOWED_INTERVALS.includes(trimmed)) return null;
  return trimmed as Timeframe;
}

/**
 * Read the optional `outputsize` parameter. Defaults to TD_DEFAULT_OUTPUT_SIZE.
 * Returns `null` on invalid, non-numeric, non-positive, or over-limit values,
 * so the caller can respond with INVALID_OUTPUT_SIZE without making an
 * upstream call.
 */
function readOutputSize(url: URL): number | null {
  const raw = url.searchParams.get('outputsize');
  if (raw === null) return TD_DEFAULT_OUTPUT_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > TD_MAX_OUTPUT_SIZE) return null;
  return parsed;
}

/**
 * Read a `from` / `to` date parameter. Accepts 'YYYY-MM-DD' or any string
 * the JS Date constructor understands. Returns a canonical ISO 8601 string
 * (UTC) on success, `null` on missing or unparseable input.
 */
function readISODate(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/* ============================================================================
   Symbol resolution
   ============================================================================ */

type ResolveResult = { asset: Asset } | { error: Response };

/**
 * Resolve the `symbol` query parameter to an Asset via the local registry.
 * Returns either `{ asset }` or `{ error: Response }` — never throws.
 */
function resolveSymbol(
  url: URL,
  headers: Record<string, string>
): ResolveResult {
  const symbol = readRequiredParam(url, 'symbol');
  if (symbol === null) {
    return {
      error: fail(
        ERROR_CODES.INVALID_QUERY,
        'Query parameter "symbol" is required and must not be empty.',
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
   Error mapping — provider errorCode → HTTP status & safe message
   ============================================================================
   The provider's `errorCode` is an internal identifier. We map it to a safe
   message and HTTP status. Nothing from the upstream provider is passed
   through verbatim. Unknown codes fall back to DATA_UNAVAILABLE / 503.
   ============================================================================ */

function httpStatusForErrorCode(code: string): number {
  switch (code) {
    case ERROR_CODES.INVALID_SYMBOL:
      return 404;
    case ERROR_CODES.PROVIDER_RATE_LIMITED:
    case ERROR_CODES.PROVIDER_TIMEOUT:
    case ERROR_CODES.PROVIDER_ERROR:
    case ERROR_CODES.DATA_UNAVAILABLE:
    default:
      return 503;
  }
}

function messageForErrorCode(code: string): string {
  switch (code) {
    case ERROR_CODES.INVALID_SYMBOL:
      return 'Symbol is not recognized by the market data provider.';
    case ERROR_CODES.PROVIDER_RATE_LIMITED:
      return 'Market data provider rate limit reached. Please try again later.';
    case ERROR_CODES.PROVIDER_TIMEOUT:
      return 'Market data provider did not respond in time.';
    case ERROR_CODES.PROVIDER_ERROR:
      return 'Market data provider returned an error.';
    case ERROR_CODES.DATA_UNAVAILABLE:
    default:
      return 'Market data is unavailable for this symbol/provider.';
  }
}

/**
 * Convert a failed provider envelope into a Response via `fail()`.
 * Preserves the honest dataStatus so clients can branch on it, while
 * mapping the internal errorCode to a safe HTTP status and message.
 */
function responseFromEnvelope(
  data: NormalizedMarketData,
  headers: Record<string, string>
): Response {
  const code = data.errorCode || ERROR_CODES.DATA_UNAVAILABLE;
  return fail(
    code,
    messageForErrorCode(code),
    httpStatusForErrorCode(code),
    headers,
    { dataStatus: data.dataStatus }
  );
}

/**
 * Standard response when the provider could not produce a usable envelope
 * (e.g. method returned null, or an unexpected shape arrived).
 */
function unavailableResponse(headers: Record<string, string>): Response {
  return fail(
    ERROR_CODES.DATA_UNAVAILABLE,
    messageForErrorCode(ERROR_CODES.DATA_UNAVAILABLE),
    503,
    headers,
    { dataStatus: 'unavailable' }
  );
}

/* ============================================================================
   GET /api/v1/market/status
   ============================================================================
   Reports per-market availability. The `providerConfigured` field is an
   honest hint: it is true only when the active provider has everything it
   needs to attempt a request. `dataConnected` remains false in Phase 4A
   because no market has been verified end-to-end.
   ============================================================================ */
export async function marketStatusHandler(
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const provider = getDefaultProvider(env);
  const markets = await provider.getMarketStatus();

  return okFlat(
    {
      provider: provider.name,
      providerConfigured: provider.configured,
      markets
    },
    headers
  );
}

/* ============================================================================
   GET /api/v1/market/quote?symbol=RELIANCE
   ============================================================================ */
export async function marketQuoteHandler(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const resolved = resolveSymbol(url, headers);
  if ('error' in resolved) return resolved.error;

  const { asset } = resolved;
  const provider = getProviderForAsset(asset, env);
  const data = await provider.getQuote(asset);

  /* Provider returned no envelope at all → treat as unavailable. */
  if (data === null) {
    return unavailableResponse(headers);
  }

  /* Provider returned an envelope but flagged it as unusable. */
  if (data.dataStatus === 'error' || data.dataStatus === 'unavailable') {
    return responseFromEnvelope(data, headers);
  }

  /* Success: 'realtime' | 'delayed' | 'historical'. */
  return ok(data, headers);
}

/* ============================================================================
   GET /api/v1/market/price?symbol=RELIANCE
   ============================================================================
   Uses the interface method `getPrice()`. No duck-typing, no casts.
   Freshness is whatever the provider reports — typically 'delayed' for
   Twelve Data, never 'realtime' without proof.
   ============================================================================ */
export async function marketPriceHandler(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const resolved = resolveSymbol(url, headers);
  if ('error' in resolved) return resolved.error;

  const { asset } = resolved;
  const provider = getProviderForAsset(asset, env);
  const data = await provider.getPrice(asset);

  if (data === null) {
    return unavailableResponse(headers);
  }

  if (data.dataStatus === 'error' || data.dataStatus === 'unavailable') {
    return responseFromEnvelope(data, headers);
  }

  return ok(data, headers);
}

/* ============================================================================
   GET /api/v1/market/ohlcv?symbol=AAPL&interval=1day&outputsize=100
   ============================================================================
   Validates interval and outputsize BEFORE calling the provider, so invalid
   requests never consume an upstream credit.

   Result semantics (interface contract):
     null → provider failure → 503 DATA_UNAVAILABLE
     []   → successful empty result → 200 with count: 0
     rows → successful result → 200 with the array
   ============================================================================ */
export async function marketOhlcvHandler(
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

  const outputsize = readOutputSize(url);
  if (outputsize === null) {
    return fail(
      ERROR_CODES.INVALID_OUTPUT_SIZE,
      `outputsize must be a positive integer no greater than ${TD_MAX_OUTPUT_SIZE}.`,
      400,
      headers
    );
  }

  const { asset } = resolved;
  const provider = getProviderForAsset(asset, env);
  const rows = await provider.getOHLCV(asset, interval, outputsize);

  /* null means the provider was called and failed. Do not hide this as an
     empty success — report it honestly with a dataStatus of 'unavailable'. */
  if (rows === null) {
    return unavailableResponse(headers);
  }

  return ok(
    {
      symbol: asset.symbol,
      market: asset.market,
      interval,
      count: rows.length,
      values: rows
    },
    headers
  );
}

/* ============================================================================
   GET /api/v1/market/history?symbol=AAPL&from=2026-01-01&to=2026-09-26
   ============================================================================
   Explicit historical date range. Both `from` and `to` are required and
   must parse as dates. `from` must be on or before `to`. Uses the
   interface method `getHistoricalData(asset, fromISO, toISO)`.

   Same null/empty semantics as OHLCV:
     null → 503 DATA_UNAVAILABLE
     []   → 200 with count: 0
     rows → 200 with the array
   ============================================================================ */
export async function marketHistoryHandler(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const resolved = resolveSymbol(url, headers);
  if ('error' in resolved) return resolved.error;

  const from = readISODate(url, 'from');
  if (from === null) {
    return fail(
      ERROR_CODES.INVALID_QUERY,
      'Query parameter "from" is required and must be a valid date (YYYY-MM-DD or ISO 8601).',
      400,
      headers
    );
  }

  const to = readISODate(url, 'to');
  if (to === null) {
    return fail(
      ERROR_CODES.INVALID_QUERY,
      'Query parameter "to" is required and must be a valid date (YYYY-MM-DD or ISO 8601).',
      400,
      headers
    );
  }

  if (new Date(from).getTime() > new Date(to).getTime()) {
    return fail(
      ERROR_CODES.INVALID_QUERY,
      'Query parameter "from" must be earlier than or equal to "to".',
      400,
      headers
    );
  }

  const { asset } = resolved;
  const provider = getProviderForAsset(asset, env);
  const rows = await provider.getHistoricalData(asset, from, to);

  if (rows === null) {
    return unavailableResponse(headers);
  }

  return ok(
    {
      symbol: asset.symbol,
      market: asset.market,
      from,
      to,
      count: rows.length,
      values: rows
    },
    headers
  );
}
