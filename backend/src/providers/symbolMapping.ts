/* ============================================================================
   backend/src/providers/symbolMapping.ts
   ----------------------------------------------------------------------------
   Provider symbol mapping layer.

   PHASE 4A — Twelve Data integration.
   ----------------------------------------------------------------------------
   Purpose
     • Translate an internal Asset into the symbol string expected by a
       specific external provider.
     • Keep the mapping logic in one place so additional providers (Polygon,
       Alpha Vantage, etc.) can have their own mapping modules without
       polluting the provider implementations.

   Design rules
     • Pure functions only. No I/O, no env access, no side effects.
     • The internal registry (assetRegistry.ts) remains the source of truth
       for asset identity. This module only translates.
     • Any symbol without an explicit mapping returns the internal symbol
       unchanged. The provider is responsible for handling an upstream
       404/error for an unknown symbol — this module never guesses.
     • Conservative by design: a symbol is only added here when its upstream
       mapping is documented by the provider. Do not speculate.

   Scope in Phase 4A
     • Twelve Data is the only target provider.
     • The mapping below covers only the instruments where the internal
       symbol differs from Twelve Data's expected form.
   ============================================================================ */

import type { Asset } from '../types';

/* ----------------------------------------------------------------------------
   Twelve Data symbol table
   ----------------------------------------------------------------------------
   Only assets whose internal symbol differs from the Twelve Data symbol
   appear here. Everything else passes through unchanged via the fallback
   in `toProviderSymbol()`.

   Format notes
     • NSE-listed stocks use the "SYMBOL:NSE" form, e.g. "RELIANCE:NSE".
     • US-listed stocks (AAPL, TSLA) and crypto pairs (BTC/USDT, ETH/USDT)
       and FX pairs (EUR/USD, GBP/USD, USD/JPY) are already valid Twelve
       Data symbols, so they are NOT listed here.
     • Indices use their widely-recognised provider codes:
         S&P 500    → SPX
         NASDAQ 100 → NDX
       NIFTY 50 and BANK NIFTY are passed through with their internal form;
       the provider decides whether the plan supports them.
     • Commodities use spot-metal / futures codes where the provider has a
       well-known symbol:
         GOLD      → XAU/USD
         SILVER    → XAG/USD
         CRUDE OIL → WTI/USD
   -------------------------------------------------------------------------- */
const TD_SYMBOL_MAP: Readonly<Record<string, string>> = {
  /* ------------------------------ STOCKS (NSE) --------------------------- */
  RELIANCE: 'RELIANCE:NSE',
  TCS: 'TCS:NSE',
  INFY: 'INFY:NSE',

  /* ------------------------------ STOCKS (US) --------------------------- */
  /* AAPL, TSLA — no mapping needed; internal symbol matches Twelve Data. */

  /* -------------------------------- CRYPTO ------------------------------ */
  /* BTC/USDT, ETH/USDT — no mapping needed. */

  /* -------------------------------- FOREX ------------------------------- */
  /* EUR/USD, GBP/USD, USD/JPY — no mapping needed. */

  /* ------------------------------- INDICES ------------------------------ */
  'S&P 500': 'SPX',
  'NASDAQ 100': 'NDX'

  /* NIFTY 50 and BANK NIFTY — no explicit mapping in Phase 4A. The provider
     will return an honest "unavailable" if the plan cannot serve them. */

  /* ----------------------------- COMMODITIES ---------------------------- */
  /* GOLD, SILVER, CRUDE OIL are mapped below as a second block to keep the
     table readable. Object literal order does not matter. */
};

/* Second block kept separate for readability — see comment above. */
const TD_SYMBOL_MAP_COMMODITIES: Readonly<Record<string, string>> = {
  GOLD: 'XAU/USD',
  SILVER: 'XAG/USD',
  'CRUDE OIL': 'WTI/USD'
};

/* Merge the two blocks into one lookup. Frozen so no caller can mutate it. */
const TD_SYMBOL_LOOKUP: Readonly<Record<string, string>> = Object.freeze({
  ...TD_SYMBOL_MAP,
  ...TD_SYMBOL_MAP_COMMODITIES
});

/* ----------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

/**
 * Translate an internal Asset into the Twelve Data symbol string.
 *
 * Returns the mapped symbol when an explicit mapping exists, otherwise
 * returns `asset.symbol` unchanged. The caller does not need to know
 * whether a mapping was applied — the returned string is always the value
 * that should be sent to the provider.
 *
 * @param asset Any Asset from the internal registry.
 * @returns The provider symbol, never empty.
 */
export function toProviderSymbol(asset: Asset): string {
  const symbol = asset.symbol;
  if (
    typeof symbol === 'string' &&
    Object.prototype.hasOwnProperty.call(TD_SYMBOL_LOOKUP, symbol)
  ) {
    return TD_SYMBOL_LOOKUP[symbol];
  }
  return symbol;
}

/**
 * Report whether an asset has an explicit Twelve Data mapping.
 *
 * Assets without a mapping may still work — Twelve Data accepts many symbols
 * directly. A `false` return means "no explicit translation was needed",
 * NOT "this asset is unsupported".
 */
export function hasExplicitMapping(asset: Asset): boolean {
  return (
    typeof asset.symbol === 'string' &&
    Object.prototype.hasOwnProperty.call(TD_SYMBOL_LOOKUP, asset.symbol)
  );
}

/**
 * Read-only view of the mapping table, for diagnostics and tests.
 * Do not mutate the returned object.
 */
export function getSymbolMap(): Readonly<Record<string, string>> {
  return TD_SYMBOL_LOOKUP;
}
