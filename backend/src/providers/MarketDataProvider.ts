/* ============================================================================
   backend/src/providers/MarketDataProvider.ts
   ----------------------------------------------------------------------------
   The provider CONTRACT. Every market-data source in this project — mock,
   real, aggregated, cached — implements this interface.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Why this file exists
     • The rest of the backend must never import a concrete provider.
       Handlers talk to `MarketService`, and `MarketService` returns
       something that satisfies this interface.
     • The interface is the ONE thing that will remain stable across all
       future phases. Concrete providers will be added, swapped, or removed;
       this file will not.
     • Every method returns a normalised shape so downstream code (technical
       analysis, strategy, risk, AI) does not care which vendor supplied
       the data.

   Phase 2 implementations
     • MockMarketDataProvider  — the only one wired up
     • (future) StockMarketDataProvider
     • (future) CryptoMarketDataProvider
     • (future) ForexMarketDataProvider
     • (future) IndicesMarketDataProvider
     • (future) CommodityMarketDataProvider
     • (future) AggregatedMarketDataProvider

   Design rules
     • This file contains TYPES AND INTERFACES ONLY. No runtime logic, no
       concrete classes, no imports from Cloudflare or from the network.
     • All methods are async, even where a Phase 2 implementation is
       synchronous, so that adding a network call later is not a breaking
       change to any caller.
     • All methods return normalised envelopes (`NormalizedMarketData`,
       `Asset[]`, `Record<…>`) — never vendor-shaped objects.
     • No method accepts secrets. Keys are read inside the concrete
       provider's constructor from `env`, never passed through the interface.
   ============================================================================ */

import type { Asset, MarketId } from '../types';

/* ============================================================================
   Data status — the single source of truth for "is this real?"
   ============================================================================
   Every NormalizedMarketData envelope carries this value so downstream code
   can make correct decisions (e.g. do not run a strategy on `not_connected`
   data). Phase 2 always produces `'not_connected'`.
   ============================================================================ */
export type DataStatus =
  /** No upstream provider is wired up. All numeric fields are null. */
  | 'not_connected'
  /** A provider returned data successfully. */
  | 'ok'
  /** A provider was called but failed (timeout, HTTP error, parse error). */
  | 'error'
  /** Data was returned but is stale according to the provider's own rules. */
  | 'stale';

/* ============================================================================
   Normalised market data
   ============================================================================
   The canonical shape every provider must return, regardless of vendor.
   Downstream code depends on THIS shape, not on any vendor's payload.

   All numeric fields are nullable on purpose:
     • A Phase 2 mock returns nulls everywhere.
     • A Phase 3 real provider fills them in.
     • Downstream code MUST branch on `dataStatus` before consuming numbers.
   ============================================================================ */
export interface NormalizedMarketData {
  /** Instrument symbol, echoing the Asset that produced this row. */
  symbol: string;

  /** Market id ('stocks' | 'forex' | 'crypto' | 'indices' | 'commodities'). */
  market: MarketId;

  /** ISO 8601 timestamp of the observation (provider's clock, UTC). */
  timestamp: string;

  /** Latest trade price, or null if unavailable. */
  price: number | null;

  /** Candlestick fields, or null if unavailable. */
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;

  /** Traded volume for the interval, or null if unavailable. */
  volume: number | null;

  /** Quote currency, e.g. "INR", "USD", "USDT". Echoes asset.currency. */
  currency: string;

  /** Provider identifier, e.g. "mock", "polygon", "binance". Null in Phase 2. */
  source: string | null;

  /** Truth about whether this row is real. Always 'not_connected' in Phase 2. */
  dataStatus: DataStatus;
}

/* ============================================================================
   Market status
   ============================================================================
   Per-market availability report. Returned by `getMarketStatus()` and
   consumed by /api/v1/market/status.
   ============================================================================ */
export interface ProviderMarketStatus {
  /** The backend supports this market in this phase. */
  enabled: boolean;

  /** An upstream provider is currently answering requests for this market. */
  dataConnected: boolean;
}

/* ============================================================================
   Supported timeframes
   ============================================================================
   Declared as a union so a Phase 3 implementation cannot silently accept
   an unbounded string. Extend deliberately when a provider supports more.
   ============================================================================ */
export type Timeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d'
  | '1w'
  | '1M';

/* ============================================================================
   The interface
   ============================================================================
   Every concrete provider implements exactly this. The methods are grouped
   by concept (quotes, bars, history, status, search) so that future
   implementations know which concerns belong together.
   ============================================================================ */
export interface MarketDataProvider {
  /** Short identifier used in responses and logs, e.g. "mock". */
  readonly name: string;

  /* ------------------------------------------------------------------------
     Quotes
     ------------------------------------------------------------------------ */

  /**
   * Latest price snapshot for a single instrument.
   *
   * Phase 2 mock: returns a fully-shaped envelope with all numeric fields
   * null and `dataStatus: 'not_connected'`.
   *
   * Phase 3 real: returns the most recent trade or top-of-book quote,
   * with `dataStatus: 'ok'` (or `'stale'` if the provider flags it).
   *
   * Return `null` only when the asset is genuinely unknown to the provider.
   * Prefer returning an envelope with `dataStatus: 'error'` over throwing.
   */
  getQuote(asset: Asset): Promise<NormalizedMarketData | null>;

  /* ------------------------------------------------------------------------
     Candles / bars
     ------------------------------------------------------------------------ */

  /**
   * OHLCV bars for a single instrument, most recent `limit` bars first
   * (or in ascending time order — the provider must document which, and
   * downstream code must not assume). Phase 2 mock returns an empty array.
   */
  getOHLCV(
    asset: Asset,
    timeframe: Timeframe,
    limit: number
  ): Promise<NormalizedMarketData[]>;

  /**
   * Historical OHLCV over an explicit range. Both bounds are ISO 8601
   * strings (UTC). Phase 2 mock returns an empty array.
   */
  getHistoricalData(
    asset: Asset,
    fromISO: string,
    toISO: string
  ): Promise<NormalizedMarketData[]>;

  /* ------------------------------------------------------------------------
     Market status
     ------------------------------------------------------------------------ */

  /**
   * Report availability for every supported market. The returned object
   * MUST contain an entry for each id in MARKET_IDS.
   *
   * Phase 2 mock: all markets enabled, none connected.
   */
  getMarketStatus(): Promise<Record<string, ProviderMarketStatus>>;

  /* ------------------------------------------------------------------------
     Asset search
     ------------------------------------------------------------------------ */

  /**
   * Provider-side search for instruments matching a free-form query.
   * Complements the local AssetResolver — used in later phases when the
   * asset universe grows beyond what fits in a static registry.
   *
   * Phase 2 mock returns an empty array.
   */
  searchAssets(query: string): Promise<Asset[]>;
}
