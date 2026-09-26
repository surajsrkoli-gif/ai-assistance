/* ============================================================================
   backend/src/types.ts
   ----------------------------------------------------------------------------
   Shared domain and runtime types for the AI Trading Assistant backend.

   PHASE 4A — Twelve Data key + dataStatus on error envelope added.
   ----------------------------------------------------------------------------
   Design rules:
     • This file contains TYPES ONLY. No logic, no constants, no side effects.
       (Runtime constants like MARKET_IDS live in config.ts.)
     • Every type here is exported so individual modules can import only what
       they need. `import type` is used elsewhere to guarantee no runtime cost.
     • Env declares FUTURE secret names as optional strings. Nothing reads
       them unless the active code path requires them.
   ============================================================================ */

/* ============================================================================
   1. Market identity
   ============================================================================ */

/**
 * Canonical set of supported market identifiers.
 *
 * Structurally identical to `MarketId` exported from `config.ts` (which
 * derives its union from the runtime `MARKET_IDS` array). Having both lets
 * the domain layer stay independent of configuration concerns while
 * remaining assignment-compatible with anything typed against the other.
 */
export type MarketId =
  | 'stocks'
  | 'forex'
  | 'crypto'
  | 'indices'
  | 'commodities';

/**
 * Higher-level asset classification, distinct from the market.
 */
export type AssetType =
  | 'equity'
  | 'crypto'
  | 'forex'
  | 'index'
  | 'commodity';

/* ============================================================================
   2. Asset
   ============================================================================ */

/**
 * A single instrument in the registry.
 *
 * This is an IDENTITY record only — no price, no OHLCV, no timestamp.
 * Market data lives in `NormalizedMarketData` (see providers).
 */
export interface Asset {
  /** Primary display symbol, e.g. "RELIANCE", "BTC/USDT", "NIFTY 50". */
  symbol: string;

  /** Human-readable name, e.g. "Reliance Industries", "Bitcoin / Tether". */
  name: string;

  /** Which market this instrument belongs to. */
  market: MarketId;

  /** Exchange or venue code, e.g. "NSE", "NASDAQ", "FX", "generic", "OTC". */
  exchange: string;

  /** Country of the primary listing, or `null` when not tied to one. */
  country: string | null;

  /** Quote currency, e.g. "INR", "USD", "USDT". */
  currency: string;

  /** Coarse classification (see AssetType). */
  assetType: AssetType;

  /** Optional lowercase alternate spellings used ONLY by the resolver. */
  aliases?: string[];
}

/* ============================================================================
   3. Environment bindings
   ============================================================================ */

/**
 * Cloudflare Worker environment bindings.
 *
 * Populated from `wrangler.toml` ([vars]) and, for anything sensitive, from
 * `wrangler secret put …`. The optional secret fields are declared so
 * Phase 4A+ code can read them without a type change.
 */
export interface Env {
  /** "development" | "production" | "test". Set via wrangler.toml [vars]. */
  ENVIRONMENT?: string;

  /**
   * Comma-separated CORS allow-list, e.g.
   *   "https://surajsrkoli-gif.github.io,http://localhost:8787"
   * When omitted, `middleware/cors.ts` falls back to DEFAULT_ALLOWED_ORIGINS.
   */
  ALLOWED_ORIGINS?: string;

  /* ------------------------------------------------------------------------
     Secrets — never appear in source code.
     Set via:  wrangler secret put <NAME>
     Local:    place in .dev.vars (git-ignored)
     ---------------------------------------------------------------------- */

  /** Phase 3+ — generic market data key (reserved). */
  MARKET_DATA_API_KEY?: string;

  /** Phase 4A — Twelve Data API key. REQUIRED for real market data. */
  TWELVE_DATA_API_KEY?: string;

  /** Phase 4/5 — news / sentiment feed key. */
  NEWS_API_KEY?: string;

  /** Phase 6 — AI analysis engine key. */
  AI_API_KEY?: string;
}

/* ============================================================================
   4. HTTP API envelopes
   ============================================================================ */

/** Envelope used by endpoints that wrap a single `data` payload. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/**
 * Envelope used by endpoints that return a flat object:
 *   { "success": true, "service": "…", "version": "…", ... }
 * Used by /health, /assets/resolve, /market/status.
 */
export interface ApiSuccessFlat {
  success: true;
  [key: string]: unknown;
}

/** Envelope for every failure response. */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    /** Never populated by Phase 4A provider code. Reserved for structured
        validation errors. */
    details?: unknown;
  };
  /**
   * Optional top-level freshness indicator, e.g. 'unavailable' or 'error'.
   * Present only when a provider failure carries a dataStatus through the
   * error path. Consumers must treat its absence as "not applicable".
   */
  dataStatus?: string;
}

/** Convenience alias for anything that crosses the wire. */
export type ApiResponse<T = unknown> =
  | ApiSuccess<T>
  | ApiSuccessFlat
  | ApiError;

/* ============================================================================
   5. Request context
   ============================================================================ */

/**
 * Everything a route handler needs. Passed explicitly so handlers never
 * reach into globals.
 */
export interface RequestContext {
  /** Parsed URL of the current request. */
  url: URL;

  /** Cloudflare Worker env bindings. */
  env: Env;

  /** CORS headers computed once in router.ts and reused on every response. */
  headers: Record<string, string>;
}

/* ============================================================================
   6. ExecutionContext
   ============================================================================ */

/**
 * Minimal structural type for Cloudflare's ExecutionContext.
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/* ============================================================================
   7. Utility types
   ============================================================================ */

/**
 * Deep-readonly helper. Useful when a function promises not to mutate data
 * it receives (e.g. the asset registry).
 */
export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/**
 * Generic result type for service functions that can fail without throwing.
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
