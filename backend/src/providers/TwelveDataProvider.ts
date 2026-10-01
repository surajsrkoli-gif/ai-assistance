/* ============================================================================
   backend/src/providers/TwelveDataProvider.ts
   ----------------------------------------------------------------------------
   Twelve Data market data provider with layered symbol resolution.

   PHASE 4A — diagnostic version.

   Key changes
     1. classifyUpstreamError() takes an `isQuoteLikeEndpoint` flag. On
        quote-like endpoints (/quote, /price, /time_series), HTTP 200 with
        body.code === 400 is classified as INVALID_SYMBOL. Twelve Data uses
        that exact shape for "Symbol is invalid or not found". Without this,
        the recovery branch was unreachable.
     2. fetchWithResolution() logs every stage of recovery with logEvent().
        Visible only via `wrangler tail`. The API key and the full URL are
        never logged.
     3. When a resolution succeeds but the retry still fails with
        INVALID_SYMBOL, the failure is remapped to DATA_UNAVAILABLE — the
        symbol was found; the plan cannot serve it.
     4. Crypto/forex require exact pair matching (handled in SymbolResolver).
     5. No mock fallback. No fabricated symbols. No secret exposure.

   Guarantees
     • At most 3 upstream calls per unresolved request: quote + search + retry.
     • AAPL, EUR/USD, INFY succeed on the first attempt, zero searches.
     • All failures map to the same envelope shape as before.
   ============================================================================ */

import type { Asset, Env } from '../types';
import { MARKET_IDS, ERROR_CODES } from '../config';
import {
  TD_BASE_URL,
  TD_ALLOWED_INTERVALS,
  TD_MAX_OUTPUT_SIZE,
  TD_DEFAULT_OUTPUT_SIZE
} from '../config';
import type {
  MarketDataProvider,
  NormalizedMarketData,
  ProviderMarketStatus,
  ResolvedProviderSymbol,
  Timeframe
} from './MarketDataProvider';
import { toProviderSymbol, normalizeUserInput } from './symbolMapping';
import {
  getCachedResolution,
  isNegativeCached,
  cacheResolved,
  cacheNegative,
  selectBestMatch,
  toResolvedSymbol,
  type TwelveDataSymbolSearchResponse
} from '../services/SymbolResolver';
import { resolveAsset } from '../services/AssetResolver';

/* ============================================================================
   1. Response shapes
   ============================================================================ */

interface TwelveDataErrorFields {
  status?: string;
  code?: number;
  message?: string;
}

interface TwelveDataQuoteBody extends TwelveDataErrorFields {
  symbol?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TwelveDataPriceBody extends TwelveDataErrorFields {
  price?: string;
}

interface TwelveDataBar {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TwelveDataSeriesBody extends TwelveDataErrorFields {
  meta?: { currency?: string };
  values?: TwelveDataBar[];
}

/* ============================================================================
   2. Diagnostic logging
   ----------------------------------------------------------------------------
   Structured JSON lines. Visible only via `wrangler tail`. The API key and
   the full upstream URL are never included.
   ============================================================================ */
function logEvent(event: string, fields: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ event, ...fields }));
  } catch {
    console.log('[ata] ' + event);
  }
}

/* ============================================================================
   3. Error classification
   ============================================================================ */
interface ClassifiedError {
  dataStatus: NormalizedMarketData['dataStatus'];
  errorCode: string;
}

function classifyUpstreamError(
  httpStatus: number,
  body: TwelveDataErrorFields | null,
  isQuoteLikeEndpoint: boolean
): ClassifiedError {
  const code =
    body && typeof body.code === 'number' && body.code > 0
      ? body.code
      : httpStatus;

  if (httpStatus === 429 || code === 429) {
    return { dataStatus: 'error', errorCode: ERROR_CODES.PROVIDER_RATE_LIMITED };
  }

  if (httpStatus === 401 || code === 401) {
    return { dataStatus: 'error', errorCode: ERROR_CODES.PROVIDER_ERROR };
  }

  if (httpStatus === 403 || code === 403) {
    return { dataStatus: 'unavailable', errorCode: ERROR_CODES.DATA_UNAVAILABLE };
  }

  if (httpStatus === 404 || code === 404) {
    return { dataStatus: 'unavailable', errorCode: ERROR_CODES.INVALID_SYMBOL };
  }

  /* Twelve Data returns HTTP 200 with code 400 for unrecognised symbols on
     quote-like endpoints. Classify as INVALID_SYMBOL so the recovery path
     runs. On /symbol_search, a 400 keeps its meaning as a provider error. */
  if (isQuoteLikeEndpoint && (httpStatus === 400 || code === 400)) {
    return { dataStatus: 'unavailable', errorCode: ERROR_CODES.INVALID_SYMBOL };
  }

  if (httpStatus >= 500 || code >= 500) {
    return { dataStatus: 'error', errorCode: ERROR_CODES.PROVIDER_ERROR };
  }

  return { dataStatus: 'error', errorCode: ERROR_CODES.PROVIDER_ERROR };
}

/* ============================================================================
   4. Helpers
   ============================================================================ */
function parseNumber(
  value: string | number | undefined | null
): number | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (str === '') return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function buildUrl(
  path: string,
  params: Record<string, string>,
  apiKey: string
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    qs.set(key, value);
  }
  qs.set('apikey', apiKey);
  return TD_BASE_URL + path + '?' + qs.toString();
}

interface FetchOutcome<T> {
  ok: boolean;
  body: T | null;
  classified?: ClassifiedError;
}

interface SafeFetchOptions {
  isQuoteLikeEndpoint?: boolean;
}

async function safeFetch<T extends TwelveDataErrorFields>(
  url: string,
  options: SafeFetchOptions = {}
): Promise<FetchOutcome<T>> {
  const isQuoteLikeEndpoint = options.isQuoteLikeEndpoint === true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const body = (await res.json().catch(() => null)) as T | null;

    if (!res.ok) {
      return {
        ok: false,
        body,
        classified: classifyUpstreamError(res.status, body, isQuoteLikeEndpoint)
      };
    }

    if (body && body.status === 'error') {
      return {
        ok: false,
        body,
        classified: classifyUpstreamError(res.status, body, isQuoteLikeEndpoint)
      };
    }

    return { ok: true, body };
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    return {
      ok: false,
      body: null,
      classified: {
        dataStatus: 'error',
        errorCode: isAbort
          ? ERROR_CODES.PROVIDER_TIMEOUT
          : ERROR_CODES.PROVIDER_ERROR
      }
    };
  }
}

/* ============================================================================
   5. Provider
   ============================================================================ */
export class TwelveDataProvider implements MarketDataProvider {
  readonly name = 'twelve_data';

  constructor(private readonly env: Env) {}

  get configured(): boolean {
    return this.readKey() !== null;
  }

  private readKey(): string | null {
    const key = this.env.TWELVE_DATA_API_KEY;
    if (typeof key !== 'string') return null;
    const trimmed = key.trim();
    return trimmed === '' ? null : trimmed;
  }

  private emptyEnvelope(
    asset: Asset,
    dataStatus: NormalizedMarketData['dataStatus'],
    errorCode?: string
  ): NormalizedMarketData {
    const envelope: NormalizedMarketData = {
      symbol: asset.symbol,
      market: asset.market,
      timestamp: new Date().toISOString(),
      price: null,
      open: null,
      high: null,
      low: null,
      close: null,
      volume: null,
      currency: asset.currency,
      source: this.name,
      dataStatus
    };
    if (errorCode) envelope.errorCode = errorCode;
    return envelope;
  }

  /* ------------------------------------------------------------------------
     Private: cached resolution via /symbol_search
     ------------------------------------------------------------------------ */
  private async resolveProviderSymbol(
    cacheKey: string,
    asset: Asset,
    apiKey: string
  ): Promise<ResolvedProviderSymbol | null> {
    const positive = getCachedResolution(cacheKey);
    if (positive) {
      logEvent('symbol_resolution_cache_hit', {
        query: cacheKey,
        providerSymbol: positive.providerSymbol
      });
      return positive;
    }

    if (isNegativeCached(cacheKey)) {
      logEvent('symbol_resolution_cache_hit_negative', { query: cacheKey });
      return null;
    }

    logEvent('symbol_search_start', {
      query: cacheKey,
      market: asset.market
    });

    const url = buildUrl(
      '/symbol_search',
      { symbol: cacheKey, outputsize: '10' },
      apiKey
    );

    const outcome = await safeFetch<TwelveDataSymbolSearchResponse>(url, {
      isQuoteLikeEndpoint: false
    });

    if (!outcome.ok || !outcome.body) {
      logEvent('symbol_search_failed', {
        query: cacheKey,
        errorCode: outcome.classified?.errorCode ?? 'UNKNOWN',
        dataStatus: outcome.classified?.dataStatus ?? 'error'
      });
      /* Do NOT cache a negative here. The search itself failed — a later
         request may succeed. */
      return null;
    }

    const results = Array.isArray(outcome.body.data) ? outcome.body.data : [];
    logEvent('symbol_search_result', {
      query: cacheKey,
      resultCount: results.length
    });

    const best = selectBestMatch(results, asset);
    if (!best) {
      logEvent('symbol_search_no_match', {
        query: cacheKey,
        market: asset.market
      });
      cacheNegative(cacheKey);
      return null;
    }

    const resolved = toResolvedSymbol(best, asset.market);
    if (!resolved) {
      logEvent('symbol_resolution_empty', {
        query: cacheKey,
        matchedSymbol: best.symbol ?? null
      });
      cacheNegative(cacheKey);
      return null;
    }

    logEvent('symbol_resolution_ok', {
      query: cacheKey,
      providerSymbol: resolved.providerSymbol,
      exchange: resolved.exchange
    });

    cacheResolved(cacheKey, resolved);
    return resolved;
  }

  /* ------------------------------------------------------------------------
     Private: fetch with one-shot resolution retry
     ------------------------------------------------------------------------ */
  private async fetchWithResolution<T extends TwelveDataErrorFields>(
    asset: Asset,
    endpoint: string,
    extraParams: Record<string, string>,
    apiKey: string
  ): Promise<FetchOutcome<T>> {
    const cacheKey = normalizeUserInput(asset.symbol);
    const firstSymbol = toProviderSymbol(asset);

    const firstUrl = buildUrl(
      endpoint,
      { ...extraParams, symbol: firstSymbol },
      apiKey
    );
    const first = await safeFetch<T>(firstUrl, { isQuoteLikeEndpoint: true });

    if (first.ok) return first;

    if (first.classified?.errorCode !== ERROR_CODES.INVALID_SYMBOL) {
      /* Non-symbol failures are terminal for the request. */
      return first;
    }

    logEvent('symbol_recovery_start', {
      endpoint,
      query: cacheKey,
      attemptedSymbol: firstSymbol
    });

    const resolved = await this.resolveProviderSymbol(cacheKey, asset, apiKey);
    if (!resolved) return first;

    if (resolved.providerSymbol === firstSymbol) {
      /* Search confirmed the same symbol we already tried. No point in
         retrying — the outcome will not change. */
      logEvent('symbol_recovery_same_symbol', {
        endpoint,
        query: cacheKey,
        providerSymbol: resolved.providerSymbol
      });
      return first;
    }

    const retryUrl = buildUrl(
      endpoint,
      { ...extraParams, symbol: resolved.providerSymbol },
      apiKey
    );
    const retry = await safeFetch<T>(retryUrl, { isQuoteLikeEndpoint: true });

    if (retry.ok) {
      logEvent('symbol_recovery_ok', {
        endpoint,
        query: cacheKey,
        resolvedSymbol: resolved.providerSymbol
      });
      return retry;
    }

    /* Symbol was found by search but the endpoint still rejected it.
       That is a plan limitation on the resolved exchange — DATA_UNAVAILABLE
       is the honest classification. Do not let it look like INVALID_SYMBOL. */
    if (retry.classified?.errorCode === ERROR_CODES.INVALID_SYMBOL) {
      logEvent('symbol_recovery_plan_limited', {
        endpoint,
        query: cacheKey,
        resolvedSymbol: resolved.providerSymbol
      });
      return {
        ok: false,
        body: retry.body,
        classified: {
          dataStatus: 'unavailable',
          errorCode: ERROR_CODES.DATA_UNAVAILABLE
        }
      };
    }

    logEvent('symbol_recovery_retry_failed', {
      endpoint,
      query: cacheKey,
      resolvedSymbol: resolved.providerSymbol,
      errorCode: retry.classified?.errorCode ?? 'UNKNOWN'
    });

    return retry.classified ? retry : first;
  }

  /* ==========================================================================
     resolveSymbol — public interface method
     ========================================================================== */
  async resolveSymbol(query: string): Promise<ResolvedProviderSymbol | null> {
    const key = this.readKey();
    if (!key) return null;

    const normalized = normalizeUserInput(query);
    if (!normalized) return null;

    const registryAsset = resolveAsset(query);
    const asset: Asset = registryAsset ?? {
      symbol: normalized,
      name: normalized,
      market: 'stocks',
      exchange: '',
      country: null,
      currency: 'USD',
      assetType: 'equity'
    };

    return this.resolveProviderSymbol(normalized, asset, key);
  }

  /* ==========================================================================
     Quote
     ========================================================================== */
  async getQuote(asset: Asset): Promise<NormalizedMarketData | null> {
    const key = this.readKey();
    if (!key) {
      return this.emptyEnvelope(asset, 'unavailable', ERROR_CODES.DATA_UNAVAILABLE);
    }

    const outcome = await this.fetchWithResolution<TwelveDataQuoteBody>(
      asset,
      '/quote',
      {},
      key
    );

    if (!outcome.ok || !outcome.body) {
      const c: ClassifiedError = outcome.classified ?? {
        dataStatus: 'error',
        errorCode: ERROR_CODES.PROVIDER_ERROR
      };
      return this.emptyEnvelope(asset, c.dataStatus, c.errorCode);
    }

    const body = outcome.body;

    let dataStatus: NormalizedMarketData['dataStatus'] = 'delayed';
    if (typeof body.timestamp === 'number' && body.timestamp > 0) {
      const ageSec = Date.now() / 1000 - body.timestamp;
      if (ageSec >= 0 && ageSec <= 60) dataStatus = 'realtime';
    }

    const close = parseNumber(body.close);
    const open = parseNumber(body.open);
    const high = parseNumber(body.high);
    const low = parseNumber(body.low);

    if (close === null && open === null && high === null && low === null) {
      return this.emptyEnvelope(asset, 'unavailable', ERROR_CODES.DATA_UNAVAILABLE);
    }

    const timestamp = body.datetime
      ? new Date(body.datetime).toISOString()
      : new Date().toISOString();

    return {
      symbol: asset.symbol,
      market: asset.market,
      timestamp,
      price: close,
      open,
      high,
      low,
      close,
      volume: parseNumber(body.volume),
      currency: body.currency || asset.currency,
      source: this.name,
      dataStatus
    };
  }

  /* ==========================================================================
     Price
     ========================================================================== */
  async getPrice(asset: Asset): Promise<NormalizedMarketData | null> {
    const key = this.readKey();
    if (!key) {
      return this.emptyEnvelope(asset, 'unavailable', ERROR_CODES.DATA_UNAVAILABLE);
    }

    const outcome = await this.fetchWithResolution<TwelveDataPriceBody>(
      asset,
      '/price',
      {},
      key
    );

    if (!outcome.ok || !outcome.body) {
      const c: ClassifiedError = outcome.classified ?? {
        dataStatus: 'error',
        errorCode: ERROR_CODES.PROVIDER_ERROR
      };
      return this.emptyEnvelope(asset, c.dataStatus, c.errorCode);
    }

    const price = parseNumber(outcome.body.price);
    if (price === null) {
      return this.emptyEnvelope(asset, 'unavailable', ERROR_CODES.DATA_UNAVAILABLE);
    }

    return {
      symbol: asset.symbol,
      market: asset.market,
      timestamp: new Date().toISOString(),
      price,
      open: null,
      high: null,
      low: null,
      close: price,
      volume: null,
      currency: asset.currency,
      source: this.name,
      dataStatus: 'delayed'
    };
  }

  /* ==========================================================================
     OHLCV
     ========================================================================== */
  async getOHLCV(
    asset: Asset,
    timeframe: Timeframe,
    limit: number
  ): Promise<NormalizedMarketData[] | null> {
    if (!TD_ALLOWED_INTERVALS.includes(timeframe)) return null;

    const boundedLimit = Math.max(
      1,
      Math.min(
        Number.isFinite(limit) ? Math.floor(limit) : TD_DEFAULT_OUTPUT_SIZE,
        TD_MAX_OUTPUT_SIZE
      )
    );

    const key = this.readKey();
    if (!key) return null;

    const outcome = await this.fetchWithResolution<TwelveDataSeriesBody>(
      asset,
      '/time_series',
      { interval: timeframe, outputsize: String(boundedLimit) },
      key
    );

    if (!outcome.ok || !outcome.body) return null;

    const values = Array.isArray(outcome.body.values) ? outcome.body.values : [];
    const currency = outcome.body.meta?.currency || asset.currency;

    return values.map((v) => ({
      symbol: asset.symbol,
      market: asset.market,
      timestamp: v.datetime
        ? new Date(v.datetime).toISOString()
        : new Date().toISOString(),
      price: null,
      open: parseNumber(v.open),
      high: parseNumber(v.high),
      low: parseNumber(v.low),
      close: parseNumber(v.close),
      volume: parseNumber(v.volume),
      currency,
      source: this.name,
      dataStatus: 'historical' as const
    }));
  }

  /* ==========================================================================
     Historical
     ========================================================================== */
  async getHistoricalData(
    asset: Asset,
    fromISO: string,
    toISO: string
  ): Promise<NormalizedMarketData[] | null> {
    const key = this.readKey();
    if (!key) return null;

    const outcome = await this.fetchWithResolution<TwelveDataSeriesBody>(
      asset,
      '/time_series',
      {
        interval: '1day',
        start_date: fromISO,
        end_date: toISO,
        outputsize: String(TD_MAX_OUTPUT_SIZE)
      },
      key
    );

    if (!outcome.ok || !outcome.body) return null;

    const values = Array.isArray(outcome.body.values) ? outcome.body.values : [];
    const currency = outcome.body.meta?.currency || asset.currency;

    return values.map((v) => ({
      symbol: asset.symbol,
      market: asset.market,
      timestamp: v.datetime
        ? new Date(v.datetime).toISOString()
        : new Date().toISOString(),
      price: null,
      open: parseNumber(v.open),
      high: parseNumber(v.high),
      low: parseNumber(v.low),
      close: parseNumber(v.close),
      volume: parseNumber(v.volume),
      currency,
      source: this.name,
      dataStatus: 'historical' as const
    }));
  }

  /* ==========================================================================
     Market status
     ========================================================================== */
  async getMarketStatus(): Promise<Record<string, ProviderMarketStatus>> {
    const out: Record<string, ProviderMarketStatus> = {};
    for (const id of MARKET_IDS) {
      out[id] = { enabled: true, dataConnected: false };
    }
    return out;
  }

  /* ==========================================================================
     searchAssets — interface-compat shim
     ========================================================================== */
  async searchAssets(_query: string): Promise<Asset[]> {
    return [];
  }
}
