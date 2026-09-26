/* ============================================================================
   backend/src/router.ts
   ----------------------------------------------------------------------------
   The single place that knows about URL shapes.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Responsibilities
     • Attach CORS headers to every response (success or failure).
     • Short-circuit OPTIONS preflight.
     • Enforce the versioned API prefix `/api/v1`.
     • Reject non-GET methods with a 405.
     • Dispatch to the correct handler.
     • Catch every uncaught error and return a sanitised 500.

   Not responsible for
     • Reading secrets.
     • Contacting providers directly (that is MarketService's job).
     • Knowing about asset resolution (that is AssetResolver's job).

   Rate limiting will be added HERE in a later phase (see hook below).
   ============================================================================ */

import type { Env } from './types';
import { API_PREFIX } from './config';
import { corsHeaders, handlePreflight } from './middleware/cors';
import { handleError } from './middleware/errorHandler';
import { fail } from './utils/response';

import { healthHandler } from './api/health';
import { assetsSearchHandler, assetsResolveHandler } from './api/assets';
import { marketStatusHandler } from './api/market';

/* ----------------------------------------------------------------------------
   Route table
   ----------------------------------------------------------------------------
   Keeping the table literal (rather than regex-scanning) makes the API surface
   auditable at a glance. Add new entries here when new endpoints arrive.
   -------------------------------------------------------------------------- */
interface RouteContext {
  url: URL;
  env: Env;
  headers: Record<string, string>;
}

type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

const ROUTES: Record<string, RouteHandler> = {
  '/health': ({ headers }) => healthHandler(headers),

  '/assets/search': ({ url, headers }) => assetsSearchHandler(url, headers),

  '/assets/resolve': ({ url, headers }) => assetsResolveHandler(url, headers),

  '/market/status': ({ env, headers }) => marketStatusHandler(env, headers)
};

/* ----------------------------------------------------------------------------
   Path normalisation
   ----------------------------------------------------------------------------
   Rules:
     • Strip the `/api/v1` prefix so the switch table stays short.
     • Collapse duplicate slashes  ("//foo///bar" → "/foo/bar").
     • Drop a single trailing slash, but keep "/" itself meaningful.
     • Reject encoded traversal ("%2e%2e") defensively.
   -------------------------------------------------------------------------- */
function normalisePath(rawPath: string): string | null {
  let path = rawPath || '/';

  // decode once so "%2e%2e" cannot bypass prefix checks
  try {
    path = decodeURIComponent(path);
  } catch {
    return null; // malformed percent-encoding
  }

  // collapse repeated slashes
  path = path.replace(/\/{2,}/g, '/');

  // strip trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/* ----------------------------------------------------------------------------
   Public entry point
   ----------------------------------------------------------------------------
   Every Worker request funnels through this function. Order matters:

     1. Compute CORS headers  (attached even to errors)
     2. Handle OPTIONS        (preflight short-circuit)
     3. Try/catch the rest    (never leak stack traces)
     4. Enforce API prefix
     5. Enforce method
     6. Dispatch by exact path
     7. Fall through to 404
   -------------------------------------------------------------------------- */
export async function route(request: Request, env: Env): Promise<Response> {
  // (1) CORS headers are computed once and reused on every branch below.
  const headers = corsHeaders(request, env);

  // (2) Preflight — handled by middleware so handlers never see OPTIONS.
  const preflight = handlePreflight(request, env);
  if (preflight) return preflight;

  try {
    const rawUrl = new URL(request.url);
    const normalised = normalisePath(rawUrl.pathname);

    if (normalised === null) {
      return fail(
        'INVALID_PATH',
        'The request path could not be parsed.',
        400,
        headers
      );
    }

    // (3) Static root — a tiny friendly response so humans hitting the Worker
    //     URL in a browser do not see a 404.
    if (normalised === '/') {
      return fail(
        'NOT_FOUND',
        `Root path is not part of the API. Use ${API_PREFIX}/health.`,
        404,
        headers
      );
    }

    // (4) Everything under the API prefix.
    if (!normalised.startsWith(API_PREFIX)) {
      return fail(
        'NOT_FOUND',
        `Route "${rawUrl.pathname}" not found. API base is ${API_PREFIX}.`,
        404,
        headers
      );
    }

    const subpath = normalised.slice(API_PREFIX.length) || '/';

    /* -----------------------------------------------------------------------
       PHASE 3+ — RATE LIMIT HOOK
       -----------------------------------------------------------------------
       Insert before method check once rate limiting exists, for example:

         const limited = await rateLimit(request, env);
         if (limited) return limited;

       The middleware/service that implements rateLimit() will live in
       src/middleware/rateLimit.ts and read from KV or Durable Objects.
       Not implemented in Phase 2 — no counter store, no cost, no lock-in.
       --------------------------------------------------------------------- */

    // (5) Phase 2 accepts GET only (OPTIONS already handled above).
    if (request.method !== 'GET') {
      return fail(
        'METHOD_NOT_ALLOWED',
        `Method ${request.method} is not allowed on ${API_PREFIX}${subpath}.`,
        405,
        headers
      );
    }

    // (6) Exact-match dispatch.
    const handler = ROUTES[subpath];
    if (handler) {
      return await handler({ url: rawUrl, env, headers });
    }

    // (7) Unknown endpoint under a valid prefix.
    return fail(
      'NOT_FOUND',
      `Endpoint "${API_PREFIX}${subpath}" not found.`,
      404,
      headers
    );
  } catch (err) {
    // Every uncaught error becomes a sanitised 500. Full detail goes to the
    // Worker log stream (`wrangler tail`), never to the client.
    return handleError(err, headers);
  }
}
