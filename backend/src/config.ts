/* ============================================================================
   backend/src/config.ts
   ----------------------------------------------------------------------------
   Static, non-secret configuration for the AI Trading Assistant backend.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Golden rules for this file:
     • NOTHING secret belongs here. No API keys, no tokens, no passwords.
     • Everything is a compile-time constant or a stable default.
     • Runtime values that vary by environment (ENVIRONMENT, ALLOWED_ORIGINS)
       come from `env` (wrangler.toml [vars]) and are resolved elsewhere.
     • This file has zero imports and zero side effects, so it is safe to
       import from anywhere — including tests, tooling, and future scripts.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   Service identity
   ----------------------------------------------------------------------------
   These values appear in /api/v1/health responses and in structured logs.
   Bump SERVICE_VERSION when the public API surface changes; keep API_PHASE
   aligned with the roadmap in the README.
   -------------------------------------------------------------------------- */
export const SERVICE_NAME = 'AI Trading Assistant API';
export const SERVICE_VERSION = '1.0.0';
export const API_PHASE = 2;

/* ----------------------------------------------------------------------------
   API versioning
   ----------------------------------------------------------------------------
   Every endpoint lives under a single versioned prefix. Adding /api/v2 later
   is a matter of introducing a second prefix and routing to a parallel table.
   -------------------------------------------------------------------------- */
export const API_PREFIX = '/api/v1';

/* ----------------------------------------------------------------------------
   Supported markets
   ----------------------------------------------------------------------------
   Ordering here is intentional: it drives the tab order in the frontend and
   the iteration order of /api/v1/market/status. Do not reorder casually.
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

   Wildcards ("*") are intentionally NEVER used here. If you need to add an
   origin, add it explicitly.
   -------------------------------------------------------------------------- */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  // Canonical GitHub Pages origin (Phase 1 deployment)
  'https://surajsrkoli-gif.github.io',

  // Common local development origins — safe to keep, they only apply
  // when someone is running `wrangler dev` on their own machine.
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
   -------------------------------------------------------------------------- */
export const ERROR_CODES = {
  INVALID_QUERY: 'INVALID_QUERY',
  INVALID_PATH: 'INVALID_PATH',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Reserved for future phases — declared so the contract is documented,
  // but never returned by Phase 2 code.
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/* ----------------------------------------------------------------------------
   Search defaults
   ----------------------------------------------------------------------------
   Used by /api/v1/assets/search. The handler clamps user input to these
   bounds so a single request can never ask for the whole universe.
   -------------------------------------------------------------------------- */
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;

/* ----------------------------------------------------------------------------
   Envelope headers applied to every response by utils/response.ts
   ----------------------------------------------------------------------------
   Centralised here so that tightening (or relaxing) a header is a one-line
   change and never requires touching individual handlers.
   -------------------------------------------------------------------------- */
export const COMMON_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

/* ----------------------------------------------------------------------------
   Environment names
   ----------------------------------------------------------------------------
   Matches the ENVIRONMENT var in wrangler.toml. Used by future code to gate
   behaviours (e.g. verbose logging in development only). Phase 2 does not
   read this yet, but having the constants means future checks cannot typo.
   -------------------------------------------------------------------------- */
export const ENVIRONMENTS = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production'
} as const;

export type EnvironmentName =
  (typeof ENVIRONMENTS)[keyof typeof ENVIRONMENTS];

/* ----------------------------------------------------------------------------
   Reserved secret names — DOCUMENTATION ONLY
   ----------------------------------------------------------------------------
   These are the names that will be used with `wrangler secret put` in future
   phases. They are listed here purely as a single source of truth so that
   nobody invents a different name in a different file.

   NOTHING reads these. They are typed as strings, not as values. There is no
   default, no fallback, no placeholder key. If any of them ever appears in a
   committed file with an actual value, that is a security incident.
   -------------------------------------------------------------------------- */
export const SECRET_NAMES = {
  MARKET_DATA_API_KEY: 'MARKET_DATA_API_KEY',
  NEWS_API_KEY: 'NEWS_API_KEY',
  AI_API_KEY: 'AI_API_KEY'
} as const;

export type SecretName = (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES];

/* ----------------------------------------------------------------------------
   Feature flags — Phase 2 state
   ----------------------------------------------------------------------------
   Explicitly documenting what is OFF right now, so the codebase cannot
   accidentally pretend a capability exists.
   -------------------------------------------------------------------------- */
export const FEATURES = {
  REAL_MARKET_DATA: false,
  AI_ANALYSIS: false,
  NEWS: false,
  AUTHENTICATION: false,
  TRADING_EXECUTION: false,
  RATE_LIMITING: false
} as const;
