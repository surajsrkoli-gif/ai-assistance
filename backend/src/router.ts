/* ============================================================================
   backend/src/router.ts
   ----------------------------------------------------------------------------
   Router — the ONLY place that knows about URL shapes.

   PHASE 4A — market data routes wired up.

   Responsibilities
     • Attach CORS headers to every response (success or failure).
     • Short-circuit OPTIONS preflight.
     • Enforce the versioned API prefix `/api/v1`.
     • Reject non-GET methods with a 405.
     • Dispatch to the correct handler by exact path match.
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

/* --- Handlers -------------------------------------------------------------- */
import { healthHandler } from './api/health';
import { assetsSearchHandler, assetsResolveHandler } from './api/assets';
import {
  marketStatusHandler,
  marketQuoteHandler,
  marketPriceHandler,
  marketOhlcvHandler,
  marketHistoryHandler
} from './api/market';

/* ----------------------------------------------------------------------------
   Route context
   ----------------------------------------------------------------------------
   Every handler receives the same shape, so a route entry is always a
   one-liner. Extending the context in a later phase (request ID, caller
   identity) is a one-place change.
   -------------------------------------------------------------------------- */
interface RouteContext {
  url: URL;
  env: Env;
  headers: Record<string, string>;
}

type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

/* ----------------------------------------------------------------------------
   Route table
   ----------------------------------------------------------------------------
   Exact-match dispatch. Adding a new endpoint is a single entry here.
   Keeping the table literal makes the API surface auditable at a glance.
   -------------------------------------------------------------------------- */
const ROUTES: Record<string, RouteHandler> = {
  /* --- Phase 2/3 — health and asset resolution --------------------------- */
  '/health': ({ headers }) => healthHandler(headers),

  '/assets/search': ({ url, headers }) => assetsSearchHandler(url, headers),
  '/assets/resolve': ({ url, headers }) => assetsResolveHandler(url, headers),

  /* --- Phase 4A — market data ------------------------------------------- */
  '/market/status': ({ env, headers }) =>
    marketStatusHandler(env, headers),

  '/market/quote': ({ url, env, headers }) =>
    marketQuoteHandler(url, env, headers),

  '/market/price': ({ url, env, headers }) =>
    marketPriceHandler(url, env, headers),

  '/market/ohlcv': ({ url, env, headers }) =>
    marketOhlcvHandler(url, env, headers),

  '/market/history': ({ url, env, headers }) =>
    marketHistoryHandler(url, env, headers)
};

/* ----------------------------------------------------------------------------
   Path normalisation
   ----------------------------------------------------------------------------
   Rules:
     • Decode once so "%2e%2e" cannot bypass prefix checks.
     • Collapse duplicate slashes  ("//foo///bar" → "/foo/bar").
     • Drop a single trailing slash (except root).
     • Return null on malformed percent-encoding so the caller can respond 400.
   -------------------------------------------------------------------------- */
function normalisePath(rawPath: string): string | null {
  let path = rawPath || '/';

  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }

  path = path.replace(/\/{2,}/g, '/');

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
  /* (1) CORS headers are computed once and reused on every branch below. */
  const headers = corsHeaders(request, env);

  /* (2) Preflight — handled by middleware so handlers never see OPTIONS. */
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

    /* (3) Friendly root response for humans hitting the Worker URL. */
    if (normalised === '/') {
      return fail(
        'NOT_FOUND',
        `Root path is not part of the API. Use ${API_PREFIX}/health.`,
        404,
        headers
      );
    }

    /* (4) Everything must live under the versioned API prefix. */
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
       PHASE 4B — RATE LIMIT HOOK
       -----------------------------------------------------------------------
       Insert before method check once rate limiting exists, for example:

         const limited = await rateLimit(request, env);
         if (limited) return limited;

       Not implemented in Phase 4A — no counter store, no cost, no lock-in.
       --------------------------------------------------------------------- */

    /* (5) Phase 4A accepts GET only (OPTIONS already handled above). */
    if (request.method !== 'GET') {
      return fail(
        'METHOD_NOT_ALLOWED',
        `Method ${request.method} is not allowed on ${API_PREFIX}${subpath}.`,
        405,
        headers
      );
    }

    /* (6) Exact-match dispatch. */
    const handler = ROUTES[subpath];
    if (handler) {
      return await handler({ url: rawUrl, env, headers });
    }

    /* (7) Unknown endpoint under a valid prefix. */
    return fail(
      'NOT_FOUND',
      `Endpoint "${API_PREFIX}${subpath}" not found.`,
      404,
      headers
    );
  } catch (err) {
    /* Every uncaught error becomes a sanitised 500. Full detail goes to the
       Worker log stream (`wrangler tail`), never to the client. */
    return handleError(err, headers);
  }
}
