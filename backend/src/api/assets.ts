/* ============================================================================
   backend/src/api/assets.ts
   ----------------------------------------------------------------------------
   GET /api/v1/assets/search?q=<query>[&limit=<n>]
   GET /api/v1/assets/resolve?query=<query>

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Expose the demo asset registry via two read-only endpoints.
     • Normalise user input so "reliance", "RELIANCE", "Reliance Industries",
       and "reliance industries ltd" all resolve to the same asset.
     • Prove the resolution pipeline end-to-end without touching any real
       market data provider.

   Contract
     /assets/search   → 200 { success: true, data: { query, count, results[] } }
     /assets/resolve  → 200 { success: true, query, resolved, asset, dataProvider, dataStatus }
     Both endpoints:
       400 INVALID_QUERY   → missing or empty required parameter
       404 ASSET_NOT_FOUND → (resolve only) query did not match anything

   Notes
     • All matching logic lives in ../services/AssetResolver.ts. This file
       only validates input, calls the resolver, and shapes the response.
     • No env vars, no secrets, no network. The registry is a static array.
     • dataStatus is always the literal string "not_connected" — never fake
       a live status.
   ============================================================================ */

import { searchAssets, resolveAsset } from '../services/AssetResolver';
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  ERROR_CODES
} from '../config';
import { ok, okFlat, fail } from '../utils/response';
import type { Asset } from '../types';

/* ----------------------------------------------------------------------------
   Input parsing
   ----------------------------------------------------------------------------
   Both endpoints accept a single required string parameter. Everything else
   is a plain query-string value. Centralised helpers keep validation consistent
   and make the security posture auditable in one place.
   -------------------------------------------------------------------------- */

/**
 * Read and trim a required string parameter from the query string.
 * Returns `null` when the parameter is absent or blank after trimming, so
 * the caller can respond with 400 INVALID_QUERY uniformly.
 */
function readRequiredParam(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Parse the optional `limit` parameter with hard safety bounds.
 * - Missing / invalid / non-positive → SEARCH_DEFAULT_LIMIT
 * - Above SEARCH_MAX_LIMIT            → SEARCH_MAX_LIMIT
 * - Otherwise                         → parsed value
 */
function readLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return SEARCH_DEFAULT_LIMIT;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return SEARCH_DEFAULT_LIMIT;

  return Math.min(parsed, SEARCH_MAX_LIMIT);
}

/* ----------------------------------------------------------------------------
   GET /api/v1/assets/search?q=RELIANCE[&limit=10]
   ----------------------------------------------------------------------------
   Fuzzy search across symbol, name and aliases. Ranking is performed inside
   AssetResolver; this handler does not re-sort.
   -------------------------------------------------------------------------- */
export function assetsSearchHandler(
  url: URL,
  headers: Record<string, string>
): Response {
  const query = readRequiredParam(url, 'q');

  if (query === null) {
    return fail(
      ERROR_CODES.INVALID_QUERY,
      'Query parameter "q" is required and must not be empty.',
      400,
      headers
    );
  }

  const limit = readLimit(url);
  const results: Asset[] = searchAssets(query, limit);

  return ok(
    {
      query,
      count: results.length,
      results
    },
    headers
  );
}

/* ----------------------------------------------------------------------------
   GET /api/v1/assets/resolve?query=RELIANCE
   ----------------------------------------------------------------------------
   Resolve a single query to exactly one asset. Returns 404 when the query
   does not match any registry entry.

   The response intentionally includes:
     dataProvider: null          — no upstream provider is wired up
     dataStatus:   'not_connected' — the literal string, never a boolean
   These two fields give the frontend a stable contract to branch on and a
   visible signal that no live data is present.
   -------------------------------------------------------------------------- */
export function assetsResolveHandler(
  url: URL,
  headers: Record<string, string>
): Response {
  const query = readRequiredParam(url, 'query');

  if (query === null) {
    return fail(
      ERROR_CODES.INVALID_QUERY,
      'Query parameter "query" is required and must not be empty.',
      400,
      headers
    );
  }

  const asset: Asset | null = resolveAsset(query);

  if (asset === null) {
    return fail(
      ERROR_CODES.ASSET_NOT_FOUND,
      `No asset matched the query "${query}".`,
      404,
      headers
    );
  }

  return okFlat(
    {
      query,
      resolved: true,
      asset,
      dataProvider: null,
      dataStatus: 'not_connected'
    },
    headers
  );
}
