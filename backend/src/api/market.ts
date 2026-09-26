/* ============================================================================
   backend/src/api/market.ts
   ----------------------------------------------------------------------------
   GET /api/v1/market/status

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Report per-market availability to the frontend.
     • Make the "no live data yet" state explicit and machine-readable so the
       UI can render an honest "not connected" indicator.
     • Prove the provider abstraction is wired up end-to-end without
       contacting any external service.

   Contract
     200 {
       success: true,
       markets: {
         stocks:      { enabled: true,  dataConnected: false },
         forex:       { enabled: true,  dataConnected: false },
         crypto:      { enabled: true,  dataConnected: false },
         indices:     { enabled: true,  dataConnected: false },
         commodities: { enabled: true,  dataConnected: false }
       }
     }

   Notes
     • This handler does NOT know about MockMarketDataProvider directly. It
       asks MarketService for the default provider and calls the interface
       method. When Phase 3 wires real providers, this file does not change.
     • `enabled` means "supported by this backend in this phase".
       `dataConnected` means "a real upstream provider is answering".
       In Phase 2, every market is enabled but none is connected.
     • dataConnected is intentionally NOT hard-coded to a boolean here —
       it is whatever the provider reports. That is the whole point of the
       abstraction.
   ============================================================================ */

import { getDefaultProvider } from '../services/MarketService';
import { okFlat } from '../utils/response';
import type { Env } from '../types';

/**
 * Handle GET /api/v1/market/status.
 *
 * @param env     Cloudflare Worker env bindings. Forwarded to the service
 *                layer so that Phase 3 can select a provider based on
 *                env vars / secrets without changing this signature.
 * @param headers CORS headers computed once in router.ts.
 * @returns 200 with a flat success envelope containing a `markets` object
 *          keyed by market id.
 */
export async function marketStatusHandler(
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  /* ------------------------------------------------------------------------
     Provider resolution
     ------------------------------------------------------------------------
     getDefaultProvider() is the single decision point for "which provider
     answers status queries". In Phase 2 it always returns the mock. In
     Phase 3 it will branch on env (e.g. presence of MARKET_DATA_API_KEY)
     and possibly route per market. Either way, this handler is untouched.
     ---------------------------------------------------------------------- */
  const provider = getDefaultProvider(env);

  /* ------------------------------------------------------------------------
     Provider call
     ------------------------------------------------------------------------
     Interface contract: returns a Record<string, ProviderMarketStatus>
     covering every supported market id. The mock implementation builds it
     from MARKET_IDS in config.ts, so the shape is guaranteed to match the
     frontend's expectations.
     ---------------------------------------------------------------------- */
  const markets = await provider.getMarketStatus();

  /* ------------------------------------------------------------------------
     Envelope
     ------------------------------------------------------------------------
     Flat response — no `data` wrapper — because the frontend reads
     body.markets directly. Same pattern as /health and /assets/resolve.
     ---------------------------------------------------------------------- */
  return okFlat({ markets }, headers);
}
