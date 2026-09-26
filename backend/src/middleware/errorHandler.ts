/* ============================================================================
   backend/src/middleware/errorHandler.ts
   ----------------------------------------------------------------------------
   Central error handler for the AI Trading Assistant API.

   PHASE 4A — updated to use the new `fail()` options shape.
   ----------------------------------------------------------------------------
   What changed
     `fail()` now accepts an options object as its fifth argument:

         fail(code, message, status, headers, { details, dataStatus })

     Previously the fifth parameter was `details` directly. This file is the
     only Phase 2/3 caller that passed a fifth argument, so it is the only
     place that needed updating. All other call sites pass four arguments and
     compile unchanged.

   What did NOT change
     • Behaviour on unknown errors: sanitised 500 with a generic message.
     • Behaviour on KnownError instances: pass through with the thrower's
       code, status, and message.
     • Logging: full detail to the Worker log stream only, never to the
       response body.
     • CORS headers: forwarded from the router unchanged, so a browser on an
       allow-listed origin can always read the error envelope.
     • No dependency on env, no secret access, no side effects beyond logging.

   Security invariants
     • Stack traces, error messages, env values, and provider URLs are never
       included in the HTTP response.
     • The response body always uses the same envelope shape as every other
       endpoint:
         { success: false, error: { code, message, details? }, dataStatus? }
   ============================================================================ */

import { fail } from '../utils/response';
import { ERROR_CODES } from '../config';

/* ============================================================================
   KnownError — the shape a caller can throw to opt in to a specific code
   and status.
   ============================================================================
   Usage (Phase 3+ service code, or tests):

       throw Object.assign(new Error('Asset not found'), {
         code: 'ASSET_NOT_FOUND',
         status: 404
       });

   Phase 4A handlers return `fail(...)` directly and do not throw KnownError
   instances. The path exists so future service-layer code can throw typed
   errors without each handler having to know how to serialise them.
   ============================================================================ */
interface KnownError {
  code: string;
  status: number;
  message: string;
  /** Optional structured payload. Forwarded to `fail()` as `error.details`. */
  details?: unknown;
  /**
   * Optional dataStatus. When present, forwarded to `fail()` so the response
   * carries a top-level freshness indicator. Phase 4A provider code could
   * use this if it ever decided to throw instead of returning an envelope.
   */
  dataStatus?: string;
}

/**
 * Structural type guard. Only accepts objects that have:
 *   • a non-empty string `code`
 *   • an integer `status` in the 4xx–5xx range
 *   • a non-empty string `message`
 *
 * Anything else is treated as an unknown error and sanitised to a 500.
 */
function isKnownError(value: unknown): value is KnownError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.status === 'number' &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status <= 599 &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0
  );
}

/* ============================================================================
   Logging
   ============================================================================
   Emit a compact, structured line to the Worker log stream. This is what
   `wrangler tail` shows. It is NOT returned to the client.

   Kept intentionally minimal — no timestamps (Cloudflare attaches them),
   no request bodies, no headers, no env values, no API keys.
   ============================================================================ */
function logError(err: unknown): void {
  if (err instanceof Error) {
    console.error(
      JSON.stringify({
        level: 'error',
        name: err.name,
        message: err.message,
        stack: err.stack
      })
    );
    return;
  }

  /* Non-Error throwables (string, number, arbitrary object).
     Stringify defensively so a circular structure cannot crash the logger. */
  let serialised: string;
  try {
    serialised = JSON.stringify(err);
  } catch {
    serialised = String(err);
  }

  console.error(
    JSON.stringify({
      level: 'error',
      name: 'NonErrorThrow',
      message: serialised
    })
  );
}

/* ============================================================================
   Public entry point
   ============================================================================
   Called from router.ts inside its single top-level try/catch:

       try {
         // ... routing logic ...
       } catch (err) {
         return handleError(err, headers);
       }

   Contract
     • ALWAYS returns a Response.
     • ALWAYS uses the standard failure envelope.
     • NEVER includes a stack trace or env value in the body.
     • Preserves the caller's CORS headers on the response.
   ============================================================================ */
export function handleError(
  err: unknown,
  headers: Record<string, string> = {}
): Response {
  /* Full detail goes to the Worker log stream only. Never to the response. */
  logError(err);

  /* --- Known error shape: honour its status, code, and message ----------- */
  if (isKnownError(err)) {
    const options: { details?: unknown; dataStatus?: string } = {};

    if (err.details !== undefined) {
      options.details = err.details;
    }
    if (typeof err.dataStatus === 'string' && err.dataStatus !== '') {
      options.dataStatus = err.dataStatus;
    }

    return fail(err.code, err.message, err.status, headers, options);
  }

  /* --- Anything else: generic 500 with a stable, non-revealing message --- */
  return fail(
    ERROR_CODES.INTERNAL_ERROR,
    'An unexpected error occurred. Please try again later.',
    500,
    headers
  );
}
