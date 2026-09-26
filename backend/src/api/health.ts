/* ============================================================================
   backend/src/api/health.ts
   ----------------------------------------------------------------------------
   GET /api/v1/health

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Liveness probe for the frontend connection pill ("Backend: Connected").
     • Confirms which phase the deployed Worker is running.
     • Zero dependencies on providers, registry, or env vars — always cheap,
       always safe to call, never touches the network.

   Contract
     200 { success: true, service, version, phase, status }

   Notes
     • No secrets, no env values, no timestamps that could leak server clock
       drift. Response is deterministic given a deployment.
     • Kept trivial on purpose. If health checks ever grow (DB ping, provider
       ping), add those as SEPARATE endpoints (e.g. /health/ready) so this
       one remains an always-up signal.
   ============================================================================ */

import { SERVICE_NAME, SERVICE_VERSION, API_PHASE } from '../config';
import { okFlat } from '../utils/response';

/**
 * Handle GET /api/v1/health.
 *
 * @param headers CORS headers computed once in router.ts. Passed through so
 *                the response is readable from the GitHub Pages origin.
 * @returns 200 with the flat success envelope described above.
 */
export function healthHandler(headers: Record<string, string>): Response {
  return okFlat(
    {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      phase: API_PHASE,
      status: 'online'
    },
    headers
  );
}
