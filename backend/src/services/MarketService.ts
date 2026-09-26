/* ============================================================================
   backend/src/services/MarketService.ts
   ----------------------------------------------------------------------------
   MarketService — the single place that decides WHICH provider answers a
   given market-data request.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Decouple the API layer from any specific data provider.
     • Provide exactly one function the rest of the codebase calls when it
       needs a MarketDataProvider: `getDefaultProvider(env)`.
     • Provide a per-asset variant `getProviderForAsset(asset, env)` so that
       Phase 3 can route stocks → StockProvider, crypto → CryptoProvider,
       etc., without touching any handler.

   Design rules
     • Handlers import from THIS file, never from a concrete provider module.
       That is the entire point of the abstraction.
     • `env` is passed in but NOT read in Phase 2. It is accepted now so the
       signature is stable when Phase 3 starts branching on
       `env.MARKET_DATA_API_KEY`, `env.ENVIRONMENT`, etc.
     • No secrets are read, logged, or returned. When Phase 3 needs a key,
       it will read `env.MARKET_DATA_API_KEY` inside the concrete provider,
       never here.
     • Returns a NEW provider instance per call in Phase 2. Providers are
       stateless, so this is fine; when a provider needs per-request state
       (rate limit tokens, cached auth), the constructor stays cheap.

   What this file is NOT
     • Not a data cache. Caching arrives later, layered on top of providers.
     • Not a factory pattern for its own sake. There is exactly ONE provider
       wired up in Phase 2, and this file makes that fact obvious in one line.
   ============================================================================ */

import { MockMarketDataProvider } from '../providers/MockMarketDataProvider';
import type { MarketDataProvider } from '../providers/MarketDataProvider';
import type { Asset, Env } from '../types';

/* ----------------------------------------------------------------------------
   Per-asset provider selection
   ----------------------------------------------------------------------------
   Phase 2: ALWAYS returns the mock provider.

   Phase 3+ will switch on `asset.market`, e.g.:

       switch (asset.market) {
         case 'stocks':      return new StockMarketDataProvider(env);
         case 'forex':       return new ForexMarketDataProvider(env);
         case 'crypto':      return new CryptoMarketDataProvider(env);
         case 'indices':     return new IndicesMarketDataProvider(env);
         case 'commodities': return new CommodityMarketDataProvider(env);
         default:            return new MockMarketDataProvider();
       }

   The public signature is intentionally identical to the Phase 3 version,
   so callers do not change when the switch is introduced.
   -------------------------------------------------------------------------- */
export function getProviderForAsset(
  _asset: Asset | null,
  _env: Env
): MarketDataProvider {
  // Phase 2 — only mock is wired up. `_asset` and `_env` are accepted but
  // not yet used; the leading underscore documents that intent to readers
  // and to the TypeScript compiler.
  return new MockMarketDataProvider();
}

/* ----------------------------------------------------------------------------
   Default provider selection
   ----------------------------------------------------------------------------
   Used when there is no asset in hand yet — for example when answering
   /api/v1/market/status, which reports on ALL markets at once.

   Phase 2: ALWAYS returns the mock provider.

   Phase 3+ will branch on env presence, e.g.:

       if (env.MARKET_DATA_API_KEY) {
         return new AggregatedMarketDataProvider(env);
       }
       return new MockMarketDataProvider();

   The signature stays `(env: Env) => MarketDataProvider` either way.
   -------------------------------------------------------------------------- */
export function getDefaultProvider(_env: Env): MarketDataProvider {
  return new MockMarketDataProvider();
}
