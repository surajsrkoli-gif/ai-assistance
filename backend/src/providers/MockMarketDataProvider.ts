/* ============================================================================
   backend/src/providers/MockMarketDataProvider.ts
   ----------------------------------------------------------------------------
   The mock provider. Kept for local development and unit testing.

   PHASE 4A — updated to the new interface.
   ----------------------------------------------------------------------------
   • dataStatus is now 'unavailable' (was 'not_connected' in Phase 2).
   • `configured` is true — the mock is always ready.
   • `getPrice()` implemented (required by the Phase 4A interface).
   • getOHLCV / getHistoricalData return `[]` (success, empty) rather than
     `null`, because the mock never "fails" — it simply has no bars.
   • Never returns fake prices. Every numeric field is null.

   Usage
     • ENVIRONMENT=test               → selected by MarketService
     • Unit tests                     → constructed directly
     • NOT used as a production fallback. Production uses TwelveDataProvider,
       which returns honest 'unavailable' envelopes when its key is missing.
   ============================================================================ */

import type { Asset, Env } from '../types';
import { MARKET_IDS } from '../config';
import type {
  MarketDataProvider,
  NormalizedMarketData,
  ProviderMarketStatus,
  Timeframe
} from './MarketDataProvider';

/* ----------------------------------------------------------------------------
   Helper — build an empty envelope for a given asset
   ----------------------------------------------------------------------------
   All numeric fields are null. dataStatus is 'unavailable'. A fresh
   timestamp is generated so callers can see "the provider was consulted".
   -------------------------------------------------------------------------- */
function emptyEnvelope(asset: Asset): NormalizedMarketData {
  return {
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
    source: null,
    dataStatus: 'unavailable'
  };
}

/* ----------------------------------------------------------------------------
   The provider
   -------------------------------------------------------------------------- */
export class MockMarketDataProvider implements MarketDataProvider {
  /**
   * Identifier surfaced in responses when the mock is the active provider.
   * Kept short and lowercase by convention.
   */
  readonly name = 'mock';

  /**
   * The mock is always ready — it has no external dependency.
   */
  readonly configured = true;

  /**
   * Accepted for signature parity with real providers that read
   * `env.MARKET_DATA_API_KEY` / `env.TWELVE_DATA_API_KEY` in their
   * constructor. The mock reads nothing — the underscore documents intent.
   */
  constructor(private readonly _env?: Env) {
    /* Intentionally empty. */
  }

  /* ==========================================================================
     Quotes
     ========================================================================== */

  /**
   * Return a "no data" envelope for the asset. Never null — the mock
   * accepts every asset and reports honestly that no live data exists.
   */
  async getQuote(asset: Asset): Promise<NormalizedMarketData | null> {
    return emptyEnvelope(asset);
  }

  /**
   * Same as getQuote. Present so the price endpoint can call a method on
   * the interface rather than duck-typing the concrete class.
   */
  async getPrice(asset: Asset): Promise<NormalizedMarketData | null> {
    return emptyEnvelope(asset);
  }

  /* ==========================================================================
     Candles / bars
     ========================================================================== */

  /**
   * Return an empty series. The caller sees a valid array of length zero,
   * which is unambiguous: "this provider does not supply bars".
   *
   * Note: `[]` means success-with-no-rows, NOT failure. The mock never
   * fails, so it never returns `null`.
   */
  async getOHLCV(
    _asset: Asset,
    _timeframe: Timeframe,
    _limit: number
  ): Promise<NormalizedMarketData[] | null> {
    return [];
  }

  /**
   * Same semantics as getOHLCV — empty success, never failure.
   */
  async getHistoricalData(
    _asset: Asset,
    _fromISO: string,
    _toISO: string
  ): Promise<NormalizedMarketData[] | null> {
    return [];
  }

  /* ==========================================================================
     Market status
     ========================================================================== */

  /**
   * Every market is `enabled: true` (the backend supports it) but
   * `dataConnected: false` (no live provider is answering).
   *
   * The keys are drawn from MARKET_IDS in config.ts so this method cannot
   * drift out of sync — adding a market there automatically includes it here.
   */
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
     Asset search
     ========================================================================== */

  /**
   * Return an empty result set. The authoritative search path in Phase 2/3/4
   * is AssetResolver, which queries the local registry. This method exists
   * to satisfy the interface; a future provider will implement real
   * server-side symbol lookup here.
   */
  async searchAssets(_query: string): Promise<Asset[]> {
    return [];
  }
}
