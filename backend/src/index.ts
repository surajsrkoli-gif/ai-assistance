/* ============================================================================
   backend/src/index.ts
   ----------------------------------------------------------------------------
   Cloudflare Worker entry point for the AI Trading Assistant API.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   • Serverless. Runs on Cloudflare Workers. No local server required.
   • Stateless. No database, no KV, no cache, no session.
   • No secrets in this file. Future API keys live only in Cloudflare
     Worker Secrets, accessed via `env.MARKET_DATA_API_KEY` etc.
   • No market APIs are contacted. Only the demo asset registry is used.
   • All requests flow through `route()` so CORS, error handling, and future
     rate limiting are applied uniformly.

   Requests are matched against the versioned API base `/api/v1`.
   See router.ts for the endpoint table.
   ============================================================================ */

import { route } from './router';
import type { Env } from './types';

/* ----------------------------------------------------------------------------
   ExecutionContext
   ----------------------------------------------------------------------------
   Declared locally instead of importing from @cloudflare/workers-types
   so that `tsconfig.json` "types" alone is sufficient. If you later uncomment
   the rate-limiting / cache section, these signatures stay valid.
   -------------------------------------------------------------------------- */
interface ExecutionContext {
  /** Schedule work that may continue after the response has been returned. */
  waitUntil(promise: Promise<unknown>): void;

  /**
   * If the fetch handler throws, Cloudflare will fall back to the origin
   * (or, for Workers, return a 500) unless this is called.
   * Kept for parity with the standard Workers signature.
   */
  passThroughOnException(): void;
}

/* ----------------------------------------------------------------------------
   Default export — the Worker's `fetch` handler.
   ----------------------------------------------------------------------------
   Cloudflare calls this function for every HTTP request routed to the Worker.

   Phase 2 intentionally keeps the handler body to a single line so that:
     • middleware order is obvious (it all lives inside route()),
     • future additions (rate limiting, request ID, structured logs) have one
       clear place to live,
     • unit-testing route() is trivial without mocking Cloudflare internals.
   -------------------------------------------------------------------------- */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    /* -----------------------------------------------------------------------
       PHASE 3+ — request-scoped hooks will be added here, for example:

       const requestId = crypto.randomUUID();
       const startedAt = Date.now();

       try {
         const response = await route(request, env, requestId);
         response.headers.set('X-Request-Id', requestId);
         return response;
       } finally {
         // structured log visible only via `wrangler tail`
         console.log(JSON.stringify({
           requestId,
           method: request.method,
           url: request.url,
           durationMs: Date.now() - startedAt
         }));
       }

       None of the above is enabled in Phase 2 — no IDs, no logs, no timers.
       --------------------------------------------------------------------- */

    return route(request, env);
  }
};
