/* ============================================================================
   backend/src/utils/response.ts
   ----------------------------------------------------------------------------
   Central response builders for the AI Trading Assistant API.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Every response that leaves the Worker is constructed through one of the
   helpers below. This guarantees:

     • a single, stable JSON envelope across all endpoints
     • CORS headers merged in exactly once, from one place
     • security headers (nosniff) applied consistently
     • Cache-Control: no-store on every response (no accidental caching)
     • no code path can accidentally emit a raw Response with missing headers

   Envelopes
     Success with payload : { success: true, data: {...} }      (ok)
     Success, flat fields : { success: true, ...fields }        (okFlat)
     Failure              : { success: false, error: {...} }    (fail)

   Nothing in this file reads env, contacts the network, logs to console,
   or imports a provider. It is pure formatting.
   ============================================================================ */

import type { ApiError, ApiSuccess } from '../types';
import { COMMON_RESPONSE_HEADERS } from '../config';

/* ----------------------------------------------------------------------------
   Primitive builder
   ----------------------------------------------------------------------------
   The single place where `new Response(...)` is called. Everything else
   composes on top of this. If response behaviour ever needs to change
   (headers, status handling, encoding), it changes here and only here.
   -------------------------------------------------------------------------- */
export function jsonResponse(
  body: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      // Common security / caching headers first, so a caller-supplied
      // extra header can deliberately override them if a future phase
      // ever needs to (e.g. caching a public reference endpoint).
      ...COMMON_RESPONSE_HEADERS,
      ...extraHeaders
    }
  });
}

/* ----------------------------------------------------------------------------
   Success with a data payload
   ----------------------------------------------------------------------------
   Shape:  { "success": true, "data": <T> }
   Used by endpoints whose spec is documented with a `data` wrapper, e.g.
   /assets/search.
   -------------------------------------------------------------------------- */
export function ok<T>(
  data: T,
  headers: Record<string, string> = {}
): Response {
  const body: ApiSuccess<T> = {
    success: true,
    data
  };
  return jsonResponse(body, 200, headers);
}

/* ----------------------------------------------------------------------------
   Success with flat fields
   ----------------------------------------------------------------------------
   Shape:  { "success": true, ...fields }
   Used by endpoints whose spec is documented as a flat object, e.g.
   /health, /assets/resolve, /market/status.

   If a caller accidentally tries to override `success`, the explicit
   `success: true` spread last wins — that field cannot be spoofed.
   -------------------------------------------------------------------------- */
export function okFlat(
  fields: Record<string, unknown>,
  headers: Record<string, string> = {}
): Response {
  return jsonResponse(
    {
      ...fields,
      success: true
    },
    200,
    headers
  );
}

/* ----------------------------------------------------------------------------
   Failure
   ----------------------------------------------------------------------------
   Shape:  { "success": false, "error": { code, message, details? } }
   `details` is optional and deliberately typed as `unknown` so that a future
   validation layer can attach structured field errors without changing the
   envelope shape. Phase 2 never populates it.

   The `message` field is always safe for clients: no stack traces, no env
   values, no internal identifiers. Detailed diagnostics go to the Worker
   log stream via `console.error` inside errorHandler.ts, never here.
   -------------------------------------------------------------------------- */
export function fail(
  code: string,
  message: string,
  status: number = 400,
  headers: Record<string, string> = {},
  details?: unknown
): Response {
  const error: ApiError['error'] = { code, message };
  if (details !== undefined) {
    error.details = details;
  }

  const body: ApiError = {
    success: false,
    error
  };

  return jsonResponse(body, status, headers);
}
