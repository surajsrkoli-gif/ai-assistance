/* ============================================================================
   backend/src/providers/MockMarketDataProvider.ts
   ----------------------------------------------------------------------------
   The ONLY concrete provider wired up in Phase 2.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Satisfy the MarketDataProvider interface so the rest of the backend
       (routing, services, handlers) can be built and tested end-to-end.
     • Prove the abstraction works without contacting any external service.
     • Return STRUCTURALLY CORRECT but EMPTY data — no fake prices, no
       invented OHLCV, no synthetic quotes.

   Core rule
     • Every numeric field is `null`. Every timestamp is the current UTC
       instant (a real value — the provider "spoke" now). `dataStatus` is
       always `'not_connected'` or, when a caller asks for something the
       mock cannot satisfy, `'error'` at the row level is NOT used — the
       mock simply returns an empty array or null. It never throws.

   What this file is NOT
     • Not a simulator. It does not generate random prices, walk a series,
       or pretend to be a market. That would be a lie and would eventually
       leak into the UI as fake "live" data.
     • Not a stub that throws "not implemented". That would force every
       caller to special-case Phase 2.
     • Not a cache. It holds no state between calls.

   Design rules
     • Implements MarketDataProvider exactly. No extra public methods.
     • Reads nothing from `env` — there is nothing to read yet.
     • Never throws. Every method resolves to a valid response.
     • Pure functions of their inputs (plus `Date.now()` for timestamps).
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
   Helper — empty normalised envelope
   ----------------------------------------------------------------------------
   Builds the canonical "no data" row for a given asset. Centralised so that
   every method returns a byte-identical shape for the numeric fields.
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
    dataStatus: 'not_connected'
  };
}

/* ----------------------------------------------------------------------------
   The provider
   ---------------------------------------------------------------------------- */
export class MockMarketDataProvider implements MarketDataProvider {
  /**
   * Identifier surfaced in responses when a caller needs to know which
   * provider answered. Kept short and lowercase by convention.
   */
  readonly name = 'mock';

  /**
   * Accepted for signature parity with future providers that will read
   * `env.MARKET_DATA_API_KEY` etc. in their constructor. Phase 2 reads
   * nothing — the underscore prefix documents intent.
   */
  constructor(private readonly _env?: Env) {
    /* Intentionally empty. */
  }

  /* ==========================================================================
     Quotes
     ========================================================================== */

  /**
   * Return a "no data" envelope for the asset.
   *
   * The contract allows returning `null` when an asset is unknown to the
   * provider. Phase 2 has no concept of "unknown" — the mock accepts every
   * asset it is handed — so we always return an envelope and let the caller
   * inspect `dataStatus`.
   */
  async getQuote(asset: Asset): Promise<NormalizedMarketData | null> {
    return emptyEnvelope(asset);
  }

  /* ==========================================================================
     Candles / bars
     ========================================================================== */

  /**
   * Return an empty series. The caller sees a valid array of length zero,
   * which is unambiguous: "this provider does not (yet) supply bars".
   */
  async getOHLCV(
    _asset: Asset,
    _timeframe: Timeframe,
    _limit: number
  ): Promise<NormalizedMarketData[]> {
    return [];
  }

  /**
   * Return an empty series for an explicit range. Same reasoning as
   * getOHLCV — no partial truth, no fabricated rows.
   */
  async getHistoricalData(
    _asset: Asset,
    _fromISO: string,
    _toISO: string
  ): Promise<NormalizedMarketData[]> {
    return [];
  }

  /* ==========================================================================
     Market status
     ========================================================================== */

  /**
   * Every market in MARKET_IDS is reported as:
   *   enabled:       true   — the backend supports it in this phase
   *   dataConnected: false  — no upstream provider is answering
   *
   * The keys are drawn from MARKET_IDS so this method cannot drift out of
   * sync with config.ts. If a new market is added there, this method
   * automatically includes it.
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
   * Return an empty result set. The authoritative search path in Phase 2 is
   * AssetResolver, which queries the local registry. This method exists to
   * satisfy the interface and will return real results only when a future
   * provider offers server-side symbol lookup.
   */
  async searchAssets(_query: string): Promise<Asset[]> {
    return [];
  }
}
