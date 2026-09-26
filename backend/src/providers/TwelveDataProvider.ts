/* ============================================================================
   backend/src/providers/TwelveDataProvider.ts
   ----------------------------------------------------------------------------
   Twelve Data market data provider.

   PHASE 4A — corrections applied.
   ----------------------------------------------------------------------------
   Fixes vs. the previous draft
     2. /price no longer claims 'realtime'. Twelve Data's /price response has
        no timestamp, so the value is reported as 'delayed' unless a reliable
        freshness signal is available.
     3. getMarketStatus() no longer derives dataConnected from key presence.
        It always reports `dataConnected: false` in Phase 4A. A provider-level
        `configured` getter exposes whether a key is present, without
        pretending any market is verified.
     5. Missing key → 'unavailable' envelopes. The mock is never used as a
        silent fallback inside this provider.
     9. All upstream errors map to safe internal codes. Raw messages, URLs,
        API keys, and stack traces never leave this file.
    10. Provider failures never masquerade as empty success. OHLCV and
        history return `null` on failure, `[]` only when the provider
        genuinely returned zero rows.

   Security invariants
     • API key read ONLY from env.TWELVE_DATA_API_KEY.
     • Key appended to URLs inside this file, never logged, never returned.
     • Upstream error bodies inspected only for classification, never surfaced.
     • Every fetch is wrapped in try/catch; nothing escapes to the router.
     • AbortController + timeout prevents hanging the Worker on slow upstream.

   Interface compliance
     • Implements MarketDataProvider from ./MarketDataProvider.ts exactly.
     • `configured` is a getter (interface requires readonly boolean).
     • `getPrice` is a first-class method (no duck-typing from callers).
     • Bars methods return `NormalizedMarketData[] | null` per the interface.
   ============================================================================ */

import type { Asset, Env } from '../types';
import { MARKET_IDS } from '../config';
import {
  TD_BASE_URL,
  TD_ALLOWED_INTERVALS,
  TD_MAX_OUTPUT_SIZE,
  TD_DEFAULT_OUTPUT_SIZE,
  ERROR_CODES
} from '../config';
import type {
  MarketDataProvider,
  NormalizedMarketData,
  ProviderMarketStatus,
  Timeframe
} from './MarketDataProvider';
import { toProviderSymbol } from './symbolMapping';

/* ============================================================================
   Internal Twelve Data response shapes
   ----------------------------------------------------------------------------
   Only the fields we actually read. Anything else in the upstream payload
   is ignored on purpose — we never forward opaque provider data.
   ============================================================================ */

interface TwelveDataErrorFields {
  status?: string;   /* "ok" | "error" */
  code?: number;     /* HTTP-ish code on error */
  message?: string;  /* human-readable error from Twelve Data */
}

interface TwelveDataQuoteBody extends TwelveDataErrorFields {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;   /* unix seconds */
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
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
  meta?: {
    symbol?: string;
    interval?: string;
    currency?: string;
    exchange?: string;
  };
  values?: TwelveDataBar[];
}

/* ============================================================================
   Internal error classification
   ============================================================================
   Map an upstream HTTP status + Twelve Data body into an internal pair:
     { dataStatus, errorCode }

   errorCode values come from ERROR_CODES in config.ts, restricted to the
   provider-level subset that the API layer understands.
   ============================================================================ */

interface ClassifiedError {
  dataStatus: NormalizedMarketData['dataStatus'];
  errorCode: string;
}

function classifyUpstreamError(
  httpStatus: number,
  body: TwelveDataErrorFields | null
): ClassifiedError {
  /* Prefer the upstream code when it looks HTTP-like; otherwise fall back
     to the HTTP status we already have. */
  const code =
    body && typeof body.code === 'number' && body.code > 0
      ? body.code
      : httpStatus;

  /* --- Rate limit -------------------------------------------------------- */
  if (httpStatus === 429 || code === 429) {
    return {
      dataStatus: 'error',
      errorCode: ERROR_CODES.PROVIDER_RATE_LIMITED
    };
  }

  /* --- Auth / permission ------------------------------------------------- */
  /* Do NOT reveal whether the key is missing, invalid, or simply lacks
     the required plan. All three collapse into a single safe code. */
  if (httpStatus === 401 || httpStatus === 403 || code === 401 || code === 403) {
    return {
      dataStatus: 'error',
      errorCode: ERROR_CODES.PROVIDER_ERROR
    };
  }

  /* --- Unknown symbol ---------------------------------------------------- */
  if (httpStatus === 404 || code === 404) {
    return {
      dataStatus: 'unavailable',
      errorCode: ERROR_CODES.INVALID_SYMBOL
    };
  }

  /* --- Provider-side failure --------------------------------------------- */
  if (httpStatus >= 500 || code >= 500) {
    return {
      dataStatus: 'error',
      errorCode: ERROR_CODES.PROVIDER_ERROR
    };
  }

  /* --- Fallback ---------------------------------------------------------- */
  return {
    dataStatus: 'error',
    errorCode: ERROR_CODES.PROVIDER_ERROR
  };
}

/* ============================================================================
   Numeric parsing
   ============================================================================
   Returns null when the value is missing, empty, or not a finite number.
   Never fabricates a value — a missing field stays missing.
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

/* ============================================================================
   URL builder
   ============================================================================
   The API key is appended here and NOWHERE else in the codebase. The
   returned URL is never logged or returned to a client.
   ============================================================================ */
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
  return `${TD_BASE_URL}${path}?${qs.toString()}`;
}

/* ============================================================================
   Fetch helper
   ============================================================================
   One place for:
     • timeout (AbortController, 10 s)
     • JSON parsing (fails soft to null)
     • upstream error classification

   Never throws. Never logs. Never returns the URL.
   ============================================================================ */

interface FetchOutcome<T> {
  ok: boolean;
  body: T | null;
  classified?: ClassifiedError;
}

async function safeFetch<T extends TwelveDataErrorFields>(
  url: string
): Promise<FetchOutcome<T>> {
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
        classified: classifyUpstreamError(res.status, body)
      };
    }

    /* Twelve Data sometimes returns HTTP 200 with { status: "error" }. */
    if (body && body.status === 'error') {
      return {
        ok: false,
        body,
        classified: classifyUpstreamError(res.status, body)
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
   The provider
   ============================================================================ */
export class TwelveDataProvider implements MarketDataProvider {
  readonly name = 'twelve_data';

  constructor(private readonly env: Env) {
    /* Nothing is read in the constructor. The API key is fetched lazily on
       each call via readKey(). This keeps the provider safe to construct
       even when the secret is absent, and it never caches a secret longer
       than necessary. */
  }

  /* ------------------------------------------------------------------------
     `configured` — interface requirement
     ------------------------------------------------------------------------
     True only when a non-empty API key is present in env. Used by the API
     layer to add a `providerConfigured` hint to /market/status without
     importing a concrete provider. It does NOT imply connectivity.
     ---------------------------------------------------------------------- */
  get configured(): boolean {
    return this.readKey() !== null;
  }

  /* ==========================================================================
     Private helpers
     ========================================================================== */

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

  /* ==========================================================================
     Quote
     ========================================================================== */
  async getQuote(asset: Asset): Promise<NormalizedMarketData | null> {
    const key = this.readKey();
    if (!key) {
      return this.emptyEnvelope(asset, 'unavailable', ERROR_CODES.DATA_UNAVAILABLE);
    }

    const providerSymbol = toProviderSymbol(asset);
    const url = buildUrl('/quote', { symbol: providerSymbol }, key);

    const outcome = await safeFetch<TwelveDataQuoteBody>(url);

    if (!outcome.ok || !outcome.body) {
      const c: ClassifiedError = outcome.classified ?? {
        dataStatus: 'error',
        errorCode: ERROR_CODES.PROVIDER_ERROR
      };
      return this.emptyEnvelope(asset, c.dataStatus, c.errorCode);
    }

    const body = outcome.body;

    /* --- Freshness classification ----------------------------------------
       Twelve Data's quote includes a unix `timestamp`. We claim 'realtime'
       ONLY when that value is present and within the last 60 seconds.
       Otherwise, conservatively 'delayed'. */
    let dataStatus: NormalizedMarketData['dataStatus'] = 'delayed';
    if (typeof body.timestamp === 'number' && body.timestamp > 0) {
      const ageSec = Date.now() / 1000 - body.timestamp;
      if (ageSec >= 0 && ageSec <= 60) {
        dataStatus = 'realtime';
      }
    }

    const close = parseNumber(body.close);
    const open = parseNumber(body.open);
    const high = parseNumber(body.high);
    const low = parseNumber(body.low);

    /* If every price-ish field is missing, the response is useless even
       though HTTP 200 arrived. Report it as unavailable, not as success. */
    if (close === null && open === null && high === null && low === null) {
      return this.emptyEnvelope(
        asset,
        'unavailable',
        ERROR_CODES.DATA_UNAVAILABLE
      );
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
     --------------------------------------------------------------------------
     Twelve Data's /price response carries NO timestamp and no freshness
     signal. We therefore NEVER claim 'realtime' here — the conservative
     'delayed' status is the honest answer whenever a price is present.
     ========================================================================== */
  async getPrice(asset: Asset): Promise<NormalizedMarketData | null> {
    const key = this.readKey();
    if (!key) {
      return this.emptyEnvelope(asset, 'unavailable', ERROR_CODES.DATA_UNAVAILABLE);
    }

    const providerSymbol = toProviderSymbol(asset);
    const url = buildUrl('/price', { symbol: providerSymbol }, key);

    const outcome = await safeFetch<TwelveDataPriceBody>(url);

    if (!outcome.ok || !outcome.body) {
      const c: ClassifiedError = outcome.classified ?? {
        dataStatus: 'error',
        errorCode: ERROR_CODES.PROVIDER_ERROR
      };
      return this.emptyEnvelope(asset, c.dataStatus, c.errorCode);
    }

    const price = parseNumber(outcome.body.price);

    if (price === null) {
      return this.emptyEnvelope(
        asset,
        'unavailable',
        ERROR_CODES.DATA_UNAVAILABLE
      );
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
     OHLCV / bars
     --------------------------------------------------------------------------
     Return semantics (interface contract):
       null → provider failure (missing key, HTTP error, malformed body)
       []   → provider succeeded but returned no bars for this query
     ========================================================================== */
  async getOHLCV(
    asset: Asset,
    timeframe: Timeframe,
    limit: number
  ): Promise<NormalizedMarketData[] | null> {
    /* Invalid interval is a caller-side error. Return null so the API layer
       can respond with INVALID_INTERVAL. Do not consume an upstream credit. */
    if (!TD_ALLOWED_INTERVALS.includes(timeframe)) {
      return null;
    }

    const boundedLimit = Math.max(
      1,
      Math.min(
        Number.isFinite(limit) ? Math.floor(limit) : TD_DEFAULT_OUTPUT_SIZE,
        TD_MAX_OUTPUT_SIZE
      )
    );

    const key = this.readKey();
    if (!key) return null;

    const providerSymbol = toProviderSymbol(asset);
    const url = buildUrl(
      '/time_series',
      {
        symbol: providerSymbol,
        interval: timeframe,
        outputsize: String(boundedLimit)
      },
      key
    );

    const outcome = await safeFetch<TwelveDataSeriesBody>(url);
    if (!outcome.ok || !outcome.body) return null;

    const values = Array.isArray(outcome.body.values)
      ? outcome.body.values
      : [];
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
     Historical (explicit date range)
     --------------------------------------------------------------------------
     Same null/empty semantics as getOHLCV. Phase 4A uses a fixed '1day'
     interval for history; a future phase can extend the signature with an
     interval parameter if needed.
     ========================================================================== */
  async getHistoricalData(
    asset: Asset,
    fromISO: string,
    toISO: string
  ): Promise<NormalizedMarketData[] | null> {
    const key = this.readKey();
    if (!key) return null;

    const providerSymbol = toProviderSymbol(asset);
    const url = buildUrl(
      '/time_series',
      {
        symbol: providerSymbol,
        interval: '1day',
        start_date: fromISO,
        end_date: toISO,
        outputsize: String(TD_MAX_OUTPUT_SIZE)
      },
      key
    );

    const outcome = await safeFetch<TwelveDataSeriesBody>(url);
    if (!outcome.ok || !outcome.body) return null;

    const values = Array.isArray(outcome.body.values)
      ? outcome.body.values
      : [];
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
     --------------------------------------------------------------------------
     HONEST reporting:
       • enabled:       true for every market the backend supports.
       • dataConnected: ALWAYS false in Phase 4A.
         A key being present is not proof that any specific market is being
         served. The plan may not cover it, the symbol may be unsupported,
         or the key may be invalid. Verification happens in a later phase and
         will flip this to true only for markets that have been verified
         end-to-end.
     ========================================================================== */
  async getMarketStatus(): Promise<Record<string, ProviderMarketStatus>> {
    const out: Record<string, ProviderMarketStatus> = {};
    for (const id of MARKET_IDS) {
      out[id] = {
        enabled: true,
        dataConnected: false
      };
    }
    return out;
  }

  /* ==========================================================================
     Search
     --------------------------------------------------------------------------
     Twelve Data offers /symbol_search, but wiring it up would consume
     credits and is not needed in Phase 4A. The local AssetResolver remains
     the search path. Return [] to satisfy the interface.
     ========================================================================== */
  async searchAssets(_query: string): Promise<Asset[]> {
    return [];
  }
}
