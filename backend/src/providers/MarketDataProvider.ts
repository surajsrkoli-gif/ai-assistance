/* ============================================================================
   backend/src/providers/MarketDataProvider.ts
   ----------------------------------------------------------------------------
   The provider CONTRACT. Every market-data source in this project implements
   this interface.

   PHASE 4A — real-provider ready.
   ----------------------------------------------------------------------------
   Changes in Phase 4A
     • DataStatus aligned with the Phase 4 lifecycle:
         'realtime' | 'delayed' | 'historical' | 'unavailable' | 'error'
       ('not_connected' is intentionally removed; 'unavailable' replaces it.)
     • Timeframe uses the exact interval strings accepted by Twelve Data.
     • `getPrice()` added to the interface so the price endpoint reuses the
       abstraction instead of duck-typing.
     • `getOHLCV` and `getHistoricalData` return `NormalizedMarketData[] | null`.
         null  → provider failure / unavailable
         []    → provider succeeded but returned no rows
       This lets the API layer distinguish "no data" from "provider error".
     • `configured` boolean added so the API layer can tell whether the
       active provider is ready to serve requests (e.g. API key present)
       without importing a concrete provider.
     • `errorCode` added to `NormalizedMarketData`. Internal only — used by
       the API layer to pick a safe HTTP error code. Never shown to clients.

   Design rules
     • This file contains types and interfaces only.
     • No runtime logic, no imports from Cloudflare, no network calls.
     • All methods async — future providers may need network I/O.
     • No method accepts or returns a secret. Keys live in the concrete
       provider's private scope, read from `env` at call time.
   ============================================================================ */

import type { Asset, MarketId } from '../types';

/* ============================================================================
   Data freshness — the ONLY vocabulary this project uses to describe
   whether a row is real, delayed, historical, or missing.
   ============================================================================ */
export type DataStatus =
  /** Freshly observed and verified recent. */
  | 'realtime'
  /** Returned by the provider but not confirmed fresh. Conservative default. */
  | 'delayed'
  /** Historical bar from a completed interval. */
  | 'historical'
  /** Provider cannot serve this request (no key, symbol unsupported, plan
      limitation). All numeric fields must be null. */
  | 'unavailable'
  /** Provider was called and failed (network, HTTP error, malformed body). */
  | 'error';

/* ============================================================================
   Normalised market data envelope — the shape every provider returns.
   ============================================================================ */
export interface NormalizedMarketData {
  symbol: string;
  market: MarketId;
  timestamp: string;

  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;

  currency: string;

  /** Provider identifier, e.g. "twelve_data", "mock". Null only if truly unknown. */
  source: string | null;

  /** Truth about this row. */
  dataStatus: DataStatus;

  /**
   * Internal error identifier used ONLY by the API layer to map provider
   * failures to a safe HTTP error code. One of:
   *   'DATA_UNAVAILABLE' | 'INVALID_SYMBOL' | 'PROVIDER_ERROR'
   *   | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_TIMEOUT'
   *
   * Set only when `dataStatus` is 'error' or 'unavailable'.
   * MUST NOT be surfaced to API clients.
   */
  errorCode?: string;
}

/* ============================================================================
   Market status
   ============================================================================ */
export interface ProviderMarketStatus {
  /** The backend supports this market. */
  enabled: boolean;
  /**
   * The provider can currently serve data for this market AND that fact has
   * been verified. In Phase 4A this is `false` for every market until the
   * provider has been pinged. It is NEVER true merely because a key exists.
   */
  dataConnected: boolean;
}

/* ============================================================================
   Timeframe — exact strings accepted by Twelve Data's /time_series endpoint.
   ============================================================================ */
export type Timeframe =
  | '1min'
  | '5min'
  | '15min'
  | '30min'
  | '1h'
  | '4h'
  | '1day'
  | '1week'
  | '1month';

/* ============================================================================
   The interface
   ============================================================================ */
export interface MarketDataProvider {
  /** Short identifier surfaced in responses, e.g. "twelve_data", "mock". */
  readonly name: string;

  /**
   * True when the provider has everything it needs to attempt a request
   * (e.g. an API key). False otherwise. Used by the API layer to add a
   * `providerConfigured` hint without knowing provider internals.
   */
  readonly configured: boolean;

  /* --- Quotes ------------------------------------------------------------ */

  /** Latest full quote for a single instrument. */
  getQuote(asset: Asset): Promise<NormalizedMarketData | null>;

  /**
   * Latest price only. Lighter than getQuote. Returns an envelope whose
   * `dataStatus` reflects honest freshness — 'delayed' unless the provider
   * can prove otherwise.
   */
  getPrice(asset: Asset): Promise<NormalizedMarketData | null>;

  /* --- Bars ------------------------------------------------------------- */

  /**
   * Most recent OHLCV bars.
   *   null → provider failure / unavailable
   *   []   → provider succeeded but returned no rows
   */
  getOHLCV(
    asset: Asset,
    timeframe: Timeframe,
    limit: number
  ): Promise<NormalizedMarketData[] | null>;

  /**
   * Historical OHLCV over an explicit inclusive range. Same null/empty
   * semantics as getOHLCV.
   */
  getHistoricalData(
    asset: Asset,
    fromISO: string,
    toISO: string
  ): Promise<NormalizedMarketData[] | null>;

  /* --- Status ----------------------------------------------------------- */

  /** Per-market availability. Always returns an entry for every MARKET_IDS. */
  getMarketStatus(): Promise<Record<string, ProviderMarketStatus>>;

  /* --- Search ----------------------------------------------------------- */

  /** Provider-side symbol search (not implemented in Phase 4A). */
  searchAssets(query: string): Promise<Asset[]>;
}
