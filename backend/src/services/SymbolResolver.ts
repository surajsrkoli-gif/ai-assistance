/* ============================================================================
   backend/src/services/SymbolResolver.ts
   ----------------------------------------------------------------------------
   Provider-agnostic symbol-resolution helpers.

   PHASE 4A — diagnostic version.

   Key behaviours
     • Cache keyed by normalized user input (UPPERCASE, trimmed, collapsed).
       Positive TTL 60 min, negative 5 min.
     • selectBestMatch() requires an exact symbol match for crypto and forex.
       Pair-based markets must not silently fall back to a different pair.
       For stocks/indices/commodities the priority order is:
         exact symbol+exchange → exact symbol (NSE preferred when several)
         → exact name → market-compatible → null.
     • toResolvedSymbol() emits a bare pair for crypto/forex and
       SYMBOL:EXCHANGE for the rest, using only values returned by Twelve Data.

   This file never performs HTTP, never reads env, and never touches secrets.
   ============================================================================ */

import type { Asset, MarketId } from '../types';
import type { ResolvedProviderSymbol } from '../providers/MarketDataProvider';

/* ============================================================================
   1. Twelve Data /symbol_search response shape
   ============================================================================ */
export interface TwelveDataSymbolSearchResult {
  symbol?: string;
  instrument_name?: string;
  exchange?: string;
  mic_code?: string;
  exchange_timezone?: string;
  instrument_type?: string;
  country?: string;
  currency?: string;
}

export interface TwelveDataSymbolSearchResponse {
  data?: TwelveDataSymbolSearchResult[];
  status?: string;
  code?: number;
  message?: string;
}

/* ============================================================================
   2. Cache
   ============================================================================ */

interface PositiveCacheEntry {
  kind: 'positive';
  resolved: ResolvedProviderSymbol;
  expiresAt: number;
}

interface NegativeCacheEntry {
  kind: 'negative';
  expiresAt: number;
}

type CacheEntry = PositiveCacheEntry | NegativeCacheEntry;

const POSITIVE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const NEGATIVE_TTL_MS = 5 * 60 * 1000;  //  5 minutes

const cache = new Map<string, CacheEntry>();

let stats = { hits: 0, misses: 0 };

function readEntry(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function getCachedResolution(key: string): ResolvedProviderSymbol | null {
  const entry = readEntry(key);
  if (!entry || entry.kind !== 'positive') return null;
  stats.hits++;
  return entry.resolved;
}

export function isNegativeCached(key: string): boolean {
  const entry = readEntry(key);
  return entry !== null && entry.kind === 'negative';
}

export function cacheResolved(
  key: string,
  resolved: ResolvedProviderSymbol
): void {
  cache.set(key, {
    kind: 'positive',
    resolved,
    expiresAt: Date.now() + POSITIVE_TTL_MS
  });
}

export function cacheNegative(key: string): void {
  cache.set(key, {
    kind: 'negative',
    expiresAt: Date.now() + NEGATIVE_TTL_MS
  });
}

export function clearCache(): void {
  cache.clear();
  stats = { hits: 0, misses: 0 };
}

export function getCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits: stats.hits, misses: stats.misses };
}

/* ============================================================================
   3. Result selection
   ============================================================================ */

function isMarketCompatible(
  market: MarketId,
  result: TwelveDataSymbolSearchResult
): boolean {
  const t = (result.instrument_type || '').toLowerCase().trim();
  if (!t) return true;

  switch (market) {
    case 'crypto':
      return t.includes('crypto') || t.includes('digital');
    case 'forex':
      return (
        t.includes('forex') ||
        t.includes('currency') ||
        t.includes('physical')
      );
    case 'stocks':
      return t.includes('stock') || t.includes('equity');
    case 'indices':
      return t.includes('index') || t.includes('indice');
    case 'commodities':
      return t.includes('commodit') || t.includes('physical');
    default:
      return true;
  }
}

/**
 * Selection priority.
 *
 * crypto, forex (pair-based):
 *   1. Exact symbol match. Otherwise null. No fallback to a different pair.
 *
 * stocks, indices, commodities:
 *   1. Exact symbol + exact exchange (when the Asset declares one).
 *   2. Exact symbol matches; when several, prefer NSE.
 *   3. Exact name match.
 *   4. First market-compatible result.
 *
 * No exchange component is fabricated.
 */
export function selectBestMatch(
  results: TwelveDataSymbolSearchResult[],
  asset: Asset
): TwelveDataSymbolSearchResult | null {
  if (!Array.isArray(results) || results.length === 0) return null;

  const targetSymbol = asset.symbol.toUpperCase();
  const targetName = asset.name.toLowerCase();
  const targetExchange = (asset.exchange || '').toUpperCase();

  /* Pair-based markets require an exact symbol match. */
  if (asset.market === 'crypto' || asset.market === 'forex') {
    const exact = results.find(
      (r) => (r.symbol || '').toUpperCase() === targetSymbol
    );
    return exact ?? null;
  }

  /* (1) Exact symbol + exact exchange. */
  if (targetExchange) {
    const exactBoth = results.find((r) => {
      const s = (r.symbol || '').toUpperCase();
      const e = (r.exchange || '').toUpperCase();
      return s === targetSymbol && e === targetExchange;
    });
    if (exactBoth) return exactBoth;
  }

  /* (2) Exact symbol matches; prefer NSE when several. */
  const exactSymbolMatches = results.filter(
    (r) => (r.symbol || '').toUpperCase() === targetSymbol
  );
  if (exactSymbolMatches.length > 0) {
    if (exactSymbolMatches.length > 1) {
      const nse = exactSymbolMatches.find(
        (r) => (r.exchange || '').toUpperCase() === 'NSE'
      );
      if (nse) return nse;
    }
    return exactSymbolMatches[0];
  }

  /* (3) Exact name match. */
  const exactName = results.find(
    (r) => (r.instrument_name || '').toLowerCase() === targetName
  );
  if (exactName) return exactName;

  /* (4) First market-compatible result. */
  const compatible = results.find((r) => isMarketCompatible(asset.market, r));
  if (compatible) return compatible;

  return null;
}

/**
 * Convert a selected search result into ResolvedProviderSymbol.
 *
 * crypto, forex → bare pair ("BTC/USDT"). No exchange suffix.
 * otherwise     → "SYMBOL:EXCHANGE" when exchange is present, else bare.
 *
 * No component is fabricated.
 */
export function toResolvedSymbol(
  result: TwelveDataSymbolSearchResult,
  market: MarketId
): ResolvedProviderSymbol | null {
  const symbol = (result.symbol || '').trim();
  if (!symbol) return null;

  const exchange = (result.exchange || '').trim();

  let providerSymbol: string;
  if (market === 'crypto' || market === 'forex') {
    providerSymbol = symbol;
  } else {
    providerSymbol = exchange ? `${symbol}:${exchange}` : symbol;
  }

  return {
    providerSymbol,
    exchange: exchange || null,
    name: result.instrument_name ? result.instrument_name : null,
    currency: result.currency ? result.currency : null
  };
}
