/* ============================================================================
   backend/src/middleware/errorHandler.ts
   ----------------------------------------------------------------------------
   Central error handler for the AI Trading Assistant API.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Design rules
     • Never leak stack traces, error messages, or env values to the client.
     • Every unhandled error becomes a sanitised 500 with a stable envelope:
         { success: false, error: { code: "INTERNAL_ERROR", message: "..." } }
     • Full diagnostics go to the Worker log stream (`wrangler tail`), never
       to the HTTP response.
     • CORS headers passed in by the router are preserved, so the browser
       can still read the error body.
     • This file depends only on utils/response.ts and config.ts — no
       provider, no service, no env access.

   Why a separate module
     • Handlers should not wrap themselves in try/catch. One place handles
       failures for the whole API.
     • Phase 3+ can enrich this file (request IDs, structured logging,
       error-reporting sinks) without touching any handler.
   ============================================================================ */

import { fail } from '../utils/response';
import { ERROR_CODES } from '../config';

/* ----------------------------------------------------------------------------
   Shape of a "known" error
   ----------------------------------------------------------------------------
   Any error that carries an explicit `code` and `status` can pass through
   with its message intact, because the caller has opted into exposing it.
   Everything else is treated as internal and reduced to a generic 500.

   Use this by throwing a plain object (or a subclass) shaped like:

       throw Object.assign(new Error('Asset not found'), {
         code: 'ASSET_NOT_FOUND',
         status: 404
       });

   Phase 2 does not throw any such errors — handlers return `fail(...)`
   directly. This path exists so Phase 3 service code can throw typed errors
   without each handler having to know how to serialise them.
   -------------------------------------------------------------------------- */
interface KnownError {
  code: string;
  status: number;
  message: string;
  /** Optional structured payload. Never emitted in Phase 2. */
  details?: unknown;
}

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

/* ----------------------------------------------------------------------------
   Logging
   ----------------------------------------------------------------------------
   Emit a compact, structured line to the Worker log stream. This is what
   `wrangler tail` shows. It is NOT returned to the client.

   Kept intentionally minimal — no timestamps (Cloudflare attaches them),
   no request bodies, no headers, no env values.
   -------------------------------------------------------------------------- */
function logError(err: unknown): void {
  if (err instanceof Error) {
    // name / message / stack are all safe to log server-side.
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

  // Non-Error throwables (string, number, arbitrary object).
  // Stringify defensively so a circular structure cannot crash the logger.
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

/* ----------------------------------------------------------------------------
   Public entry point
   ----------------------------------------------------------------------------
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
   -------------------------------------------------------------------------- */
export function handleError(
  err: unknown,
  headers: Record<string, string> = {}
): Response {
  // Full detail goes to the Worker log stream only.
  logError(err);

  // Known error shape → honour its status and code.
  // The message is exposed because the thrower deliberately opted in.
  if (isKnownError(err)) {
    return fail(err.code, err.message, err.status, headers, err.details);
  }

  // Anything else → generic 500 with a stable, non-revealing message.
  return fail(
    ERROR_CODES.INTERNAL_ERROR,
    'An unexpected error occurred. Please try again later.',
    500,
    headers
  );
}
