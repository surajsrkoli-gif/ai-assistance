/* ============================================================================
   backend/src/providers/MarketDataProvider.ts
   ----------------------------------------------------------------------------
   The provider CONTRACT. Every market-data source in this project implements
   this interface.

   PHASE 4A — ResolvedProviderSymbol added.

   Changes vs. the previous revision
     • Exports `ResolvedProviderSymbol`, the canonical shape returned by a
       provider's symbol-resolution method. Both SymbolResolver.ts and
       TwelveDataProvider.ts import it from here.
     • DataStatus, NormalizedMarketData, ProviderMarketStatus, Timeframe,
       and the interface method list are unchanged.

   Design rules
     • Types and interfaces only. No runtime logic.
     • No env access, no network, no side effects.
     • All methods async.
   ============================================================================ */

import type { Asset, MarketId } from '../types';

/* ============================================================================
   Data freshness
   ============================================================================ */
export type DataStatus =
  | 'realtime'
  | 'delayed'
  | 'historical'
  | 'unavailable'
  | 'error';

/* ============================================================================
   Normalised market data
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
  source: string | null;
  dataStatus: DataStatus;

  /**
   * Internal error identifier. Set only when dataStatus is 'error' or
   * 'unavailable'. One of:
   *   'DATA_UNAVAILABLE' | 'INVALID_SYMBOL' | 'PROVIDER_ERROR'
   *   | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_TIMEOUT'
   * Never surfaced to API clients as-is.
   */
  errorCode?: string;
}

/* ============================================================================
   Market status
   ============================================================================ */
export interface ProviderMarketStatus {
  enabled: boolean;
  dataConnected: boolean;
}

/* ============================================================================
   Resolved provider symbol
   ============================================================================
   The canonical shape returned by any provider's resolveSymbol() method and
   consumed by services/SymbolResolver.ts. Internal to the backend.

   Adding this type here — rather than in a new module — keeps the provider
   contract self-contained: everything a caller needs to talk to a provider
   lives in this one file.
   ============================================================================ */
export interface ResolvedProviderSymbol {
  /** Exact symbol string to send to the provider, e.g. "RELIANCE:NSE". */
  providerSymbol: string;
  /** Exchange code where relevant, e.g. "NSE". May be null. */
  exchange: string | null;
  /** Human-readable instrument name when known. */
  name: string | null;
  /** Quote currency when known. */
  currency: string | null;
}

/* ============================================================================
   Timeframe
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
   ============================================================================
   `resolveSymbol` is intentionally NOT a required method. Providers that
   support dynamic discovery (TwelveDataProvider) declare it as an extra
   public method; providers that do not (MockMarketDataProvider) simply omit
   it. Nothing in the type system forces either choice, and the resolver
   service degrades gracefully when the method is absent.
   ============================================================================ */
export interface MarketDataProvider {
  readonly name: string;
  readonly configured: boolean;

  /* --- Quotes ------------------------------------------------------------ */
  getQuote(asset: Asset): Promise<NormalizedMarketData | null>;
  getPrice(asset: Asset): Promise<NormalizedMarketData | null>;

  /* --- Bars -------------------------------------------------------------- */
  getOHLCV(
    asset: Asset,
    timeframe: Timeframe,
    limit: number
  ): Promise<NormalizedMarketData[] | null>;

  getHistoricalData(
    asset: Asset,
    fromISO: string,
    toISO: string
  ): Promise<NormalizedMarketData[] | null>;

  /* --- Status ------------------------------------------------------------ */
  getMarketStatus(): Promise<Record<string, ProviderMarketStatus>>;

  /* --- Search ------------------------------------------------------------ */
  searchAssets(query: string): Promise<Asset[]>;
}
