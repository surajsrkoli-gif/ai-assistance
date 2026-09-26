/* ============================================================================
   backend/src/services/MarketService.ts
   ----------------------------------------------------------------------------
   MarketService — the single place that decides WHICH provider answers a
   given market-data request.

   PHASE 4A — corrections applied.
   ----------------------------------------------------------------------------
   Fix 5 — No silent mock fallback.

   Selection rules
     • ENVIRONMENT === 'test'  → MockMarketDataProvider
       (only explicit test mode uses the mock)
     • Otherwise               → TwelveDataProvider
       The Twelve Data provider handles a missing API key honestly by
       returning 'unavailable' envelopes for every request. It never
       substitutes fake data, and it never falls back to the mock.

   This guarantees:
     • Production never returns mock prices, even if the key is missing.
     • Local development without a key sees honest 'unavailable' responses.
     • Tests can still exercise the mock via ENVIRONMENT=test.
     • A future aggregation provider can be slotted in without touching
       any handler or route — only this file changes.

   Dependency direction
       api/  →  services/  →  providers/

   Nothing outside this file constructs a concrete provider. That invariant
   is what keeps the abstraction real rather than cosmetic.
   ============================================================================ */

import { MockMarketDataProvider } from '../providers/MockMarketDataProvider';
import { TwelveDataProvider } from '../providers/TwelveDataProvider';
import type { MarketDataProvider } from '../providers/MarketDataProvider';
import type { Asset, Env } from '../types';

/* ----------------------------------------------------------------------------
   Explicit test mode
   ----------------------------------------------------------------------------
   Set ENVIRONMENT=test in .dev.vars or in wrangler.toml [vars] to opt in.
   Production must never have this set — the check is exact-string equality
   so a typo like "Testing" or "TEST " does not silently enable the mock in
   production.
   -------------------------------------------------------------------------- */
function isTestMode(env: Env): boolean {
  return env.ENVIRONMENT === 'test';
}

/* ----------------------------------------------------------------------------
   Per-asset provider selection
   ----------------------------------------------------------------------------
   Phase 4A: always TwelveDataProvider (outside test mode).

   Phase 4B+ will switch on `asset.market` once multiple real providers are
   wired up:

       switch (asset.market) {
         case 'stocks': return new StockMarketDataProvider(env);
         case 'crypto': return new CryptoMarketDataProvider(env);
         ...
       }

   The public signature is intentionally identical to that future shape, so
   callers do not change when the switch is introduced.
   -------------------------------------------------------------------------- */
export function getProviderForAsset(
  _asset: Asset | null,
  env: Env
): MarketDataProvider {
  if (isTestMode(env)) {
    return new MockMarketDataProvider(env);
  }
  return new TwelveDataProvider(env);
}

/* ----------------------------------------------------------------------------
   Default provider selection
   ----------------------------------------------------------------------------
   Used when there is no asset in scope — for example /api/v1/market/status,
   which reports on all markets at once.

   Phase 4A: always TwelveDataProvider (outside test mode). The provider
   itself reports honest `dataConnected: false` for every market until
   connectivity is verified.
   -------------------------------------------------------------------------- */
export function getDefaultProvider(env: Env): MarketDataProvider {
  if (isTestMode(env)) {
    return new MockMarketDataProvider(env);
  }
  return new TwelveDataProvider(env);
}
