/* ============================================================================
   backend/src/middleware/cors.ts
   ----------------------------------------------------------------------------
   CORS handling for the AI Trading Assistant API.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Design rules
     • Never use wildcard "*". The allow-list is explicit and evaluated
       per-request.
     • The allow-list is configurable via `env.ALLOWED_ORIGINS`
       (wrangler.toml [vars]). When unset, the defaults from
       src/config.ts (DEFAULT_ALLOWED_ORIGINS) are used.
     • CORS headers are attached to EVERY response — success or failure — so
       the browser can read the error body when a request is rejected.
     • OPTIONS preflight is short-circuited here so route handlers never
       need to know about it.
     • The `Vary: Origin` header is always emitted so intermediaries do not
       cache one origin's response for another.

   Note on credentials
     • We do NOT send `Access-Control-Allow-Credentials: true`. Phase 2 has
       no authentication and no cookies, so credentials are not needed.
       If a future phase adds auth, revisit this file deliberately rather
       than bolting it on.
   ============================================================================ */

import { DEFAULT_ALLOWED_ORIGINS } from '../config';
import type { Env } from '../types';

/* ----------------------------------------------------------------------------
   Allow-list resolution
   ----------------------------------------------------------------------------
   Read `env.ALLOWED_ORIGINS` as a comma-separated list. Trim each entry.
   Drop empty strings. Fall back to DEFAULT_ALLOWED_ORIGINS when the env var
   is absent or contains nothing usable.

   This function never throws — a malformed env value simply degrades to the
   default allow-list, which is the safest failure mode.
   -------------------------------------------------------------------------- */
export function getAllowedOrigins(env: Env): readonly string[] {
  const raw = typeof env?.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '';

  if (raw.trim().length > 0) {
    const parsed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (parsed.length > 0) {
      return parsed;
    }
  }

  return DEFAULT_ALLOWED_ORIGINS;
}

/* ----------------------------------------------------------------------------
   Origin resolution
   ----------------------------------------------------------------------------
   Return the request's Origin header if and only if it is in the allow-list.
   Return `null` when:
     • the request has no Origin header (same-origin, curl, server-to-server),
     • the Origin is present but not allow-listed.

   A `null` return means "do not emit CORS headers". That is the correct
   behaviour for a disallowed origin: the browser will block the response.
   -------------------------------------------------------------------------- */
export function resolveOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;

  const allowed = getAllowedOrigins(env);
  return allowed.includes(origin) ? origin : null;
}

/* ----------------------------------------------------------------------------
   Response header builder
   ----------------------------------------------------------------------------
   Build the CORS headers to merge into a response. When the origin is
   allow-listed, this returns:

       Access-Control-Allow-Origin : <the origin>
       Vary                        : Origin
       Access-Control-Allow-Methods: GET, POST, OPTIONS
       Access-Control-Allow-Headers: Content-Type, Authorization
       Access-Control-Max-Age      : 86400

   When the origin is absent or disallowed, this returns an empty object.

   Why still advertise POST in Allow-Methods even though Phase 2 is GET-only?
     Because OPTIONS preflight must succeed for future write endpoints, and
     advertising the method does not enable anything on its own — the router
     still rejects non-GET calls with 405. Keeping the header stable avoids
     a cache-invalidation dance when POST is introduced later.
   -------------------------------------------------------------------------- */
export function corsHeaders(
  request: Request,
  env: Env
): Record<string, string> {
  const origin = resolveOrigin(request, env);

  // No Origin header (curl, same-origin fetch, server-to-server) — no CORS
  // headers needed and no `Vary` either.
  if (origin === null) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

/* ----------------------------------------------------------------------------
   Preflight handler
   ----------------------------------------------------------------------------
   Return a Response for OPTIONS requests and `null` for everything else,
   so the router can write:

       const preflight = handlePreflight(request, env);
       if (preflight) return preflight;

   Behaviour
     • Allow-listed origin  → 204 No Content with the full CORS header set.
     • Disallowed origin    → 204 No Content with NO CORS headers. The
                              browser will then block the actual request,
                              which is exactly what we want.
     • Never returns a body — preflight responses must be empty.
   -------------------------------------------------------------------------- */
export function handlePreflight(
  request: Request,
  env: Env
): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
}
