/* ============================================================================
   backend/src/services/AssetResolver.ts
   ----------------------------------------------------------------------------
   AssetResolver — normalises free-form user input and maps it to an entry in
   the asset registry.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Turn "reliance", "RELIANCE", "Reliance Industries", and
       "reliance industries ltd" into the same canonical Asset.
     • Rank matches so the best candidate is always first.
     • Keep matching logic in ONE place so a future swap of the registry
       (KV, D1, external index) does not require touching the API layer.

   Design rules
     • Pure functions only. No I/O, no env access, no console output.
     • The registry is INJECTED at call time (defaults to the static demo
       registry). This makes unit-testing trivial and lets later phases pass
       a KV/D1-backed array without changing the API.
     • Zero dependencies on Cloudflare runtime APIs — this file compiles and
       runs anywhere (Workers, Node, tests).

   What this file is NOT
     • Not a search engine over millions of rows. Phase 2 ships ~17 demo
       assets. The scoring function is intentionally simple and readable.
       Phase 3+ can replace it with an indexed lookup without touching the
       callers, because the public surface is just searchAssets/resolveAsset.
   ============================================================================ */

import { ASSET_REGISTRY } from '../data/assetRegistry';
import type { Asset } from '../types';

/* ----------------------------------------------------------------------------
   Score thresholds
   ----------------------------------------------------------------------------
   Named constants instead of magic numbers. The numbers encode an ordering:
   an exact symbol match must always outrank an alias match, which must
   always outrank a substring match. Tune the gaps, not the individual
   values, when changing behaviour.
   -------------------------------------------------------------------------- */
const SCORE = {
  SYMBOL_EXACT: 100,
  NAME_EXACT: 90,
  ALIAS_EXACT: 95,
  SYMBOL_PREFIX: 85,
  ALIAS_PREFIX: 75,
  NAME_PREFIX: 70,
  SUBSTRING: 40,
  NO_MATCH: 0
} as const;

/* ----------------------------------------------------------------------------
   Normalisation
   ----------------------------------------------------------------------------
   Two forms are produced for every comparison:

     normalize(x)  → lowercase, punctuation collapsed to single spaces
     compact(x)    → same as normalize, with spaces removed entirely

   Two forms because users type symbols in inconsistent ways:
     "BTC/USDT"  →  normalize: "btc usdt"   compact: "btcusdt"
     "btc-usdt"  →  normalize: "btc usdt"   compact: "btcusdt"
     "btc usdt"  →  normalize: "btc usdt"   compact: "btcusdt"
     "BTCUSDT"   →  normalize: "btcusdt"    compact: "btcusdt"

   All four inputs must match the same asset. Comparing both forms catches
   every case without a combinatorial list of regex patterns.
   -------------------------------------------------------------------------- */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')   // punctuation → single space
    .replace(/\s+/g, ' ')          // collapse repeated spaces
    .trim();
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, '');
}

/* ----------------------------------------------------------------------------
   Scoring
   ----------------------------------------------------------------------------
   Given an asset and the pre-normalised query (both forms), return a score
   in the range [SCORE.NO_MATCH .. SCORE.SYMBOL_EXACT].

   The function is total: it never throws and always returns a number, so
   the caller can filter/sort without try/catch.
   -------------------------------------------------------------------------- */
function scoreAsset(asset: Asset, q: string, qc: string): number {
  const symbol = normalize(asset.symbol);
  const symbolC = compact(asset.symbol);
  const name = normalize(asset.name);
  const nameC = compact(asset.name);

  const aliasList = Array.isArray(asset.aliases) ? asset.aliases : [];
  const aliases = aliasList.map(normalize);
  const aliasesC = aliasList.map(compact);

  /* --- exact matches (highest priority) --------------------------------- */
  if (symbol === q || symbolC === qc) return SCORE.SYMBOL_EXACT;
  if (aliases.some((a) => a === q) || aliasesC.some((a) => a === qc)) {
    return SCORE.ALIAS_EXACT;
  }
  if (name === q || nameC === qc) return SCORE.NAME_EXACT;

  /* --- prefix matches ---------------------------------------------------- */
  if (symbol.startsWith(q) || symbolC.startsWith(qc)) {
    return SCORE.SYMBOL_PREFIX;
  }
  if (
    aliases.some((a) => a.startsWith(q)) ||
    aliasesC.some((a) => a.startsWith(qc))
  ) {
    return SCORE.ALIAS_PREFIX;
  }
  if (name.startsWith(q) || nameC.startsWith(qc)) {
    return SCORE.NAME_PREFIX;
  }

  /* --- substring matches ------------------------------------------------- */
  if (
    symbol.includes(q) ||
    symbolC.includes(qc) ||
    name.includes(q) ||
    nameC.includes(qc) ||
    aliases.some((a) => a.includes(q)) ||
    aliasesC.some((a) => a.includes(qc))
  ) {
    return SCORE.SUBSTRING;
  }

  return SCORE.NO_MATCH;
}

/* ----------------------------------------------------------------------------
   Public API — search
   ----------------------------------------------------------------------------
   Return up to `limit` assets ranked by score, best first.

   Tie-breaking: when two assets have the same score, sort by symbol
   alphabetically. Deterministic output means the same query always returns
   the same order — important for caching and for tests.
   -------------------------------------------------------------------------- */
export function searchAssets(
  query: string,
  limit: number = 10,
  registry: readonly Asset[] = ASSET_REGISTRY
): Asset[] {
  const raw = typeof query === 'string' ? query.trim() : '';
  if (raw.length === 0) return [];

  const q = normalize(raw);
  const qc = compact(raw);
  if (q.length === 0 && qc.length === 0) return [];

  // Clamp defensively even though api/assets.ts already does this.
  // Belt and braces: AssetResolver must be safe to call from any context.
  const boundedLimit = Math.max(
    1,
    Math.min(Number.isFinite(limit) ? Math.floor(limit) : 10, 50)
  );

  const scored: Array<{ asset: Asset; score: number }> = [];
  for (const asset of registry) {
    const score = scoreAsset(asset, q, qc);
    if (score > SCORE.NO_MATCH) {
      scored.push({ asset, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.asset.symbol.localeCompare(b.asset.symbol);
  });

  return scored.slice(0, boundedLimit).map((entry) => entry.asset);
}

/* ----------------------------------------------------------------------------
   Public API — resolve
   ----------------------------------------------------------------------------
   Return the single best match for a query, or `null` when nothing matches.

   Semantics: "best match" means the top result of searchAssets(..., 1).
   Callers (api/assets.ts) translate `null` into a 404 ASSET_NOT_FOUND.
   -------------------------------------------------------------------------- */
export function resolveAsset(
  query: string,
  registry: readonly Asset[] = ASSET_REGISTRY
): Asset | null {
  const results = searchAssets(query, 1, registry);
  return results.length > 0 ? results[0] : null;
}
