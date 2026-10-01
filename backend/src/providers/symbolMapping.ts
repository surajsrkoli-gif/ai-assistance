/* ============================================================================
   backend/src/providers/symbolMapping.ts
   ----------------------------------------------------------------------------
   Static symbol mapping and normalization helpers.

   PHASE 4A — normalizeUserInput added.

   Responsibilities
     • Provide the static mapping table used as Layer 2 of resolution.
     • Report whether a symbol has an explicit mapping.
     • Normalize free-form user input for the resolver cache key.

   What this file is NOT
     • Not a symbol-discovery mechanism. That lives in SymbolResolver.ts
       and TwelveDataProvider.resolveSymbol().
     • Not the source of truth for asset identity. The registry is.

   The map is intentionally minimal. Entries appear only when the internal
   symbol differs materially from the provider symbol, or when the provider
   form has been verified to work on the active plan (e.g. INFY).
   Direct-passthrough symbols (AAPL, EUR/USD, BTC/USDT) do NOT appear here.
   ============================================================================ */

import type { Asset } from '../types';

/* ----------------------------------------------------------------------------
   Static mapping table — Layer 2 of resolution
   ----------------------------------------------------------------------------
   Do not remove INFY:NSE — it is verified to work on the current plan.
   Do not add more colon-form entries speculatively; the resolver's search
   layer handles discovery for symbols the plan may or may not cover.
   -------------------------------------------------------------------------- */
const TD_SYMBOL_MAP: Readonly<Record<string, string>> = Object.freeze({
  /* --- NSE stocks (only the ones verified to work on the plan) ----------- */
  INFY: 'INFY:NSE',

  /* --- Indices ----------------------------------------------------------- */
  'S&P 500': 'SPX',
  'NASDAQ 100': 'NDX',

  /* --- Commodities ------------------------------------------------------- */
  GOLD: 'XAU/USD',
  SILVER: 'XAG/USD',
  'CRUDE OIL': 'WTI/USD'
});

/* ----------------------------------------------------------------------------
   Normalization
   ----------------------------------------------------------------------------
   Canonical form used as the resolver cache key and for comparisons:
   trimmed, uppercased, single spaces between tokens.

   Exported here so both the resolver cache (services/SymbolResolver.ts) and
   the provider (providers/TwelveDataProvider.ts) share one definition. Do
   not reimplement this anywhere else.
   -------------------------------------------------------------------------- */
export function normalizeUserInput(input: string): string {
  if (typeof input !== 'string') return '';
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

/* ----------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

/**
 * Return the mapped provider symbol for an asset, or asset.symbol unchanged
 * when no mapping exists.
 */
export function toProviderSymbol(asset: Asset): string {
  const symbol = asset.symbol;
  if (
    typeof symbol === 'string' &&
    Object.prototype.hasOwnProperty.call(TD_SYMBOL_MAP, symbol)
  ) {
    return TD_SYMBOL_MAP[symbol];
  }
  return symbol;
}

/**
 * Report whether an asset has an explicit mapping.
 */
export function hasExplicitMapping(asset: Asset): boolean {
  return (
    typeof asset.symbol === 'string' &&
    Object.prototype.hasOwnProperty.call(TD_SYMBOL_MAP, asset.symbol)
  );
}

/**
 * Read-only view of the mapping table. For diagnostics and tests.
 */
export function getSymbolMap(): Readonly<Record<string, string>> {
  return TD_SYMBOL_MAP;
}
