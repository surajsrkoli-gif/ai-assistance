/* ============================================================================
   backend/src/utils/response.ts
   ----------------------------------------------------------------------------
   Central response builders for the AI Trading Assistant API.

   PHASE 4A — corrections applied.
   ----------------------------------------------------------------------------
   `fail()` now accepts an options object as its fifth argument:

       fail(code, message, status, headers, {
         details?: unknown,
         dataStatus?: string
       })

   `dataStatus` is emitted at the top level of the error envelope, matching
   the Phase 4A spec:

       {
         "success": false,
         "error": { "code": "...", "message": "..." },
         "dataStatus": "unavailable"
       }

   Backward compatibility
     The old fifth parameter was `details?: unknown`. The new options object
     is a strict superset: passing `{ details: x }` behaves exactly as before.
     All existing call sites in Phase 2/3 code continue to compile unchanged.

   Design rules
     • `jsonResponse` is the ONLY place that calls `new Response(...)`.
       Everything else composes on top of it. If response behaviour ever
       needs to change (headers, status handling, encoding), it changes in
       one place.
     • Common security headers (nosniff, no-store, JSON content-type) are
       applied to every response via COMMON_RESPONSE_HEADERS.
     • CORS headers computed by the router are merged in as the last spread,
       so a caller can override a common header if a future endpoint needs
       to (e.g. caching a public reference dataset deliberately).
     • `success` in okFlat is spread last, so a caller cannot accidentally
       emit `success: false` alongside success-shaped data.
     • No logging, no env access, no side effects. Safe to call from tests.
   ============================================================================ */

import type { ApiError, ApiSuccess } from '../types';
import { COMMON_RESPONSE_HEADERS } from '../config';

/* ============================================================================
   Options for `fail()`
   ============================================================================
   Optional bag of extra fields to attach to the error envelope.
     • `details`    — structured payload for validation errors. Emitted as
                      `error.details` when present. Unchanged from Phase 2.
     • `dataStatus` — Phase 4A freshness indicator. Emitted at the TOP LEVEL
                      of the envelope, next to `error`, so clients can branch
                      on it regardless of the error code. Only emitted when
                      it is a non-empty string.
   ============================================================================ */
export interface FailOptions {
  details?: unknown;
  dataStatus?: string;
}

/* ============================================================================
   Primitive builder — the only `new Response(...)` in the codebase
   ============================================================================
   Merges COMMON_RESPONSE_HEADERS with caller-supplied headers, giving
   caller-supplied headers priority. In practice, the caller is the router
   passing CORS headers computed by `middleware/cors.ts`.
   ============================================================================ */
export function jsonResponse(
  body: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...COMMON_RESPONSE_HEADERS,
      ...extraHeaders
    }
  });
}

/* ============================================================================
   Success with a data payload
   ============================================================================
   Shape:  { "success": true, "data": <T> }
   Used by endpoints whose spec is documented with a `data` wrapper, e.g.
   /assets/search, /market/quote, /market/price, /market/ohlcv, /market/history.
   ============================================================================ */
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

/* ============================================================================
   Success with flat fields
   ============================================================================
   Shape:  { "success": true, ...fields }
   Used by endpoints whose spec is documented as a flat object, e.g.
   /health, /assets/resolve, /market/status.

   `success: true` is spread last so it cannot be spoofed by the caller.
   ============================================================================ */
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

/* ============================================================================
   Failure
   ============================================================================
   Shape:  { "success": false, "error": { code, message, details? }, dataStatus? }

   `error.details`   — populated only when options.details is not undefined.
   `body.dataStatus` — populated only when options.dataStatus is a non-empty
                       string. Emitted at the top level, next to `error`, so
                       the freshness signal is independent of the error code.

   The `message` field must always be safe for clients: no stack traces, no
   env values, no internal identifiers, no provider URLs, no API keys. All
   diagnostic detail goes to the Worker log stream via errorHandler.ts, which
   never routes through this function.
   ============================================================================ */
export function fail(
  code: string,
  message: string,
  status: number = 400,
  headers: Record<string, string> = {},
  options?: FailOptions
): Response {
  const error: ApiError['error'] = { code, message };

  if (options && options.details !== undefined) {
    error.details = options.details;
  }

  const body: ApiError = {
    success: false,
    error
  };

  if (
    options &&
    typeof options.dataStatus === 'string' &&
    options.dataStatus !== ''
  ) {
    body.dataStatus = options.dataStatus;
  }

  return jsonResponse(body, status, headers);
}
