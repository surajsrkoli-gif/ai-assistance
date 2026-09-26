/* ============================================================================
   backend/src/config.ts
   ----------------------------------------------------------------------------
   Static, non-secret configuration for the AI Trading Assistant backend.

   PHASE 4A — Twelve Data provider configuration added.
   ----------------------------------------------------------------------------
   Golden rules for this file:
     • NOTHING secret belongs here. No API keys, no tokens, no passwords.
     • Everything is a compile-time constant or a stable default.
     • Runtime values that vary by environment (ENVIRONMENT, ALLOWED_ORIGINS)
       come from `env` (wrangler.toml [vars]) and are resolved elsewhere.
     • This file has zero imports and zero side effects.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   Service identity
   -------------------------------------------------------------------------- */
export const SERVICE_NAME = 'AI Trading Assistant API';
export const SERVICE_VERSION = '1.0.0';
export const API_PHASE = 4;

/* ----------------------------------------------------------------------------
   API versioning
   -------------------------------------------------------------------------- */
export const API_PREFIX = '/api/v1';

/* ----------------------------------------------------------------------------
   Supported markets
   -------------------------------------------------------------------------- */
export type MarketId =
  | 'stocks'
  | 'forex'
  | 'crypto'
  | 'indices'
  | 'commodities';

export const MARKET_IDS: readonly MarketId[] = [
  'stocks',
  'forex',
  'crypto',
  'indices',
  'commodities'
] as const;

/* ----------------------------------------------------------------------------
   CORS defaults
   ----------------------------------------------------------------------------
   Used only when ALLOWED_ORIGINS is not provided via `env` (wrangler.toml).
   In production, wrangler.toml sets ALLOWED_ORIGINS to a strict single value:
       https://surajsrkoli-gif.github.io

   Wildcards ("*") are intentionally NEVER used here.
   -------------------------------------------------------------------------- */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  /* Canonical GitHub Pages origin (Phase 1 deployment) */
  'https://surajsrkoli-gif.github.io',

  /* Common local development origins */
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
] as const;

/* ----------------------------------------------------------------------------
   HTTP
   -------------------------------------------------------------------------- */
export const HTTP_STATUS = {
  OK: 200,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_SERVER_ERROR: 500
} as const;

/* ----------------------------------------------------------------------------
   Response envelope — canonical error codes
   ----------------------------------------------------------------------------
   The frontend can branch on these strings. Keep them stable. Add new codes
   at the end, never rename existing ones without a version bump.

   Phase 2 codes are preserved. Phase 4A codes are appended.
   -------------------------------------------------------------------------- */
export const ERROR_CODES = {
  /* --- Phase 2 — preserved unchanged ------------------------------------- */
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_PATH: 'INVALID_PATH',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  /* --- Reserved from Phase 2 (declared, not emitted) --------------------- */
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',

  /* --- Phase 4A — market data ------------------------------------------- */
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  INVALID_SYMBOL: 'INVALID_SYMBOL',
  INVALID_INTERVAL: 'INVALID_INTERVAL',
  INVALID_OUTPUT_SIZE: 'INVALID_OUTPUT_SIZE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/* ----------------------------------------------------------------------------
   Search defaults
   -------------------------------------------------------------------------- */
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;

/* ----------------------------------------------------------------------------
   Twelve Data provider configuration (Phase 4A)
   ----------------------------------------------------------------------------
   No secrets here. The API key is read from env.TWELVE_DATA_API_KEY inside
   the provider. These are public constants.
   -------------------------------------------------------------------------- */

/** Official Twelve Data API base URL. */
export const TD_BASE_URL = 'https://api.twelvedata.com';

/**
 * Intervals supported by Twelve Data's /time_series endpoint.
 * Kept as a readonly array so the provider and the API layer can validate
 * input against exactly the same list.
 */
export const TD_ALLOWED_INTERVALS: readonly string[] = [
  '1min',
  '5min',
  '15min',
  '30min',
  '1h',
  '4h',
  '1day',
  '1week',
  '1month'
] as const;

/** Hard ceiling on outputsize. Rejects excessive requests before they hit
    Twelve Data, so an invalid request never consumes an upstream credit. */
export const TD_MAX_OUTPUT_SIZE = 500;

/** Default outputsize when the caller does not specify one. */
export const TD_DEFAULT_OUTPUT_SIZE = 100;

/* ----------------------------------------------------------------------------
   Envelope headers applied to every response by utils/response.ts
   -------------------------------------------------------------------------- */
export const COMMON_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

/* ----------------------------------------------------------------------------
   Environment names
   -------------------------------------------------------------------------- */
export const ENVIRONMENTS = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
  TEST: 'test'
} as const;

export type EnvironmentName =
  (typeof ENVIRONMENTS)[keyof typeof ENVIRONMENTS];

/* ----------------------------------------------------------------------------
   Reserved secret names — DOCUMENTATION ONLY
   ----------------------------------------------------------------------------
   These are the names used with `wrangler secret put` in later phases.
   Listed here as a single source of truth so nobody invents a different name.

   NOTHING reads these as values. There is no default, no fallback, no
   placeholder key. If any of them ever appears in a committed file with an
   actual value, that is a security incident.
   -------------------------------------------------------------------------- */
export const SECRET_NAMES = {
  MARKET_DATA_API_KEY: 'MARKET_DATA_API_KEY',
  NEWS_API_KEY: 'NEWS_API_KEY',
  AI_API_KEY: 'AI_API_KEY',
  TWELVE_DATA_API_KEY: 'TWELVE_DATA_API_KEY'
} as const;

export type SecretName = (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES];

/* ----------------------------------------------------------------------------
   Feature flags — Phase 4A state
   -------------------------------------------------------------------------- */
export const FEATURES = {
  REAL_MARKET_DATA: true,
  AI_ANALYSIS: false,
  NEWS: false,
  AUTHENTICATION: false,
  TRADING_EXECUTION: false,
  RATE_LIMITING: false
} as const;
