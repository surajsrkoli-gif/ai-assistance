/* ============================================================================
   backend/src/types.ts
   ----------------------------------------------------------------------------
   Shared domain and runtime types for the AI Trading Assistant backend.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Design rules:
     • This file contains TYPES ONLY. No logic, no constants, no side effects.
       (Runtime constants like MARKET_IDS live in config.ts.)
     • Every type here is exported so individual modules can import only what
       they need. `import type` is used elsewhere to guarantee no runtime cost.
     • Env declares the FUTURE secret names as optional strings. Nothing in
       Phase 2 reads them. When Phase 3 begins, they become required where
       needed without changing this file's shape.
   ============================================================================ */


/* ============================================================================
   1. Market identity
   ============================================================================ */

/**
 * Canonical set of supported market identifiers.
 *
 * Kept structurally identical to `MarketId` exported from `config.ts`
 * (which derives its union from the runtime `MARKET_IDS` array). Having both
 * lets the domain layer stay independent of configuration concerns while
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
 * One market can carry several asset types in future (e.g. an index future
 * inside `indices`, a spot and a perpetual inside `crypto`).
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

  /**
   * Exchange or venue code, e.g. "NSE", "NASDAQ", "FX", "generic", "OTC".
   * Kept as a free string because the taxonomy differs per market and
   * changes faster than a union would tolerate.
   */
  exchange: string;

  /**
   * ISO-style country name of the primary listing, or `null` when the
   * instrument is not tied to a single jurisdiction (crypto, forex,
   * many commodities).
   */
  country: string | null;

  /** Quote currency, e.g. "INR", "USD", "USDT". ISO 4217 where applicable. */
  currency: string;

  /** Coarse classification (see AssetType). */
  assetType: AssetType;

  /**
   * Optional lowercase alternate spellings used ONLY by the resolver and
   * search. Never returned in API responses outside `/assets/search` and
   * `/assets/resolve` — the primary fields are authoritative.
   */
  aliases?: string[];
}


/* ============================================================================
   3. Environment bindings
   ============================================================================ */

/**
 * Cloudflare Worker environment bindings.
 *
 * Populated from `wrangler.toml` ([vars]) and, for anything sensitive, from
 * `wrangler secret put …`. The optional secret fields are declared here so
 * future phases can read `env.MARKET_DATA_API_KEY` without a type change —
 * but no code in Phase 2 reads them.
 */
export interface Env {
  /** "development" | "production". Set via wrangler.toml [vars]. */
  ENVIRONMENT?: string;

  /**
   * Comma-separated CORS allow-list, e.g.
   *   "https://surajsrkoli-gif.github.io,http://localhost:8787"
   * When omitted, `middleware/cors.ts` falls back to DEFAULT_ALLOWED_ORIGINS.
   */
  ALLOWED_ORIGINS?: string;

  /* ------------------------------------------------------------------------
     FUTURE SECRETS — declared for typing only.

     Populate with:
         wrangler secret put MARKET_DATA_API_KEY
         wrangler secret put NEWS_API_KEY
         wrangler secret put AI_API_KEY

     These values are encrypted at rest by Cloudflare and never appear in
     the repository. Nothing below is read in Phase 2.
     ---------------------------------------------------------------------- */

  /** Phase 3 — real market data provider key(s). */
  MARKET_DATA_API_KEY?: string;

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
    /** Never populated in Phase 2. Reserved for structured validation errors. */
    details?: unknown;
  };
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
 * reach into globals. Extend this object (not the handler signatures) when
 * future phases need request IDs, caller identity, etc.
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
 *
 * Declared locally instead of importing from @cloudflare/workers-types so
 * that `tsconfig.json` "types" alone is sufficient and this file can be
 * consumed by unit tests that mock the Worker runtime.
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
 * it receives (e.g. the asset registry). Defined here so no module needs to
 * reimplement it.
 */
export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/**
 * Generic result type for service functions that can fail without throwing.
 * Providers in Phase 3+ will use this to avoid exceptions crossing module
 * boundaries.
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
