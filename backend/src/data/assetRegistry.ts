/* ============================================================================
   backend/src/data/assetRegistry.ts
   ----------------------------------------------------------------------------
   Static demo asset registry for Phase 2.

   PHASE 2 — Secure backend foundation.
   ----------------------------------------------------------------------------
   Purpose
     • Provide a small, curated set of instruments covering all five markets
       so that AssetResolver can be exercised end-to-end.
     • Prove the resolve/search pipeline works for the exact examples in the
       Phase 2 spec: RELIANCE, BTC/USDT, EUR/USD, GOLD, NIFTY 50, AAPL, TSLA,
       ETH/USDT, and more.
     • Act as the reference data set for tests and local development.

   What this file is NOT
     • Not a complete instrument catalogue. Phase 3+ will move the universe
       to KV / D1 / an external index. This array stays useful as the
       deterministic fixture for tests and as the fallback for offline dev.
     • Not a source of market data. Every entry is an IDENTITY record only:
       symbol, name, market, exchange, country, currency, assetType. No
       price, no OHLCV, no timestamp.
     • Not sorted. The resolver ranks by match quality, not by array order.
       Keeping the file grouped by market (rather than alphabetised) makes it
       easier to review for coverage and to add new instruments.

   Design rules
     • `aliases` are lowercase, contain only words users plausibly type, and
       exist purely for matching. They are never shown in responses outside
       /assets/search and /assets/resolve.
     • `country` is `null` when the instrument is not tied to a single
       jurisdiction — crypto, most forex pairs, most commodities.
     • `currency` is the quote currency (ISO 4217 where applicable; USDT and
       similar are kept as-is because that is the market convention).
     • `exchange` is a free-form string because venue taxonomy differs across
       markets and changes faster than a union would tolerate.
     • Every entry MUST satisfy the `Asset` type from ../types.
   ============================================================================ */

import type { Asset } from '../types';

/* ============================================================================
   The registry
   ============================================================================
   Grouped by market. Within a market, India-listed instruments come first
   where relevant, then US-listed, then the rest. This ordering is a
   readability aid only — the resolver ignores array order.
   ============================================================================ */
export const ASSET_REGISTRY: readonly Asset[] = [

  /* ==========================================================================
     STOCKS
     ========================================================================== */

  /* ------------------------------ India (NSE) ---------------------------- */
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    market: 'stocks',
    exchange: 'NSE',
    country: 'India',
    currency: 'INR',
    assetType: 'equity',
    aliases: [
      'reliance industries limited',
      'reliance industries ltd',
      'ril'
    ]
  },
  {
    symbol: 'TCS',
    name: 'Tata Consultancy Services',
    market: 'stocks',
    exchange: 'NSE',
    country: 'India',
    currency: 'INR',
    assetType: 'equity',
    aliases: [
      'tata consultancy',
      'tata consultancy services limited',
      'tata consultancy services ltd'
    ]
  },
  {
    symbol: 'INFY',
    name: 'Infosys',
    market: 'stocks',
    exchange: 'NSE',
    country: 'India',
    currency: 'INR',
    assetType: 'equity',
    aliases: [
      'infosys limited',
      'infosys ltd'
    ]
  },

  /* ----------------------------- United States --------------------------- */
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    market: 'stocks',
    exchange: 'NASDAQ',
    country: 'United States',
    currency: 'USD',
    assetType: 'equity',
    aliases: [
      'apple',
      'apple incorporated',
      'apple inc'
    ]
  },
  {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    market: 'stocks',
    exchange: 'NASDAQ',
    country: 'United States',
    currency: 'USD',
    assetType: 'equity',
    aliases: [
      'tesla',
      'tesla motors',
      'tesla inc'
    ]
  },

  /* ==========================================================================
     CRYPTO
     ========================================================================== */
  {
    symbol: 'BTC/USDT',
    name: 'Bitcoin / Tether',
    market: 'crypto',
    exchange: 'generic',
    country: null,
    currency: 'USDT',
    assetType: 'crypto',
    aliases: [
      'bitcoin',
      'btc',
      'btcusdt',
      'xbt',
      'bitcoin tether'
    ]
  },
  {
    symbol: 'ETH/USDT',
    name: 'Ethereum / Tether',
    market: 'crypto',
    exchange: 'generic',
    country: null,
    currency: 'USDT',
    assetType: 'crypto',
    aliases: [
      'ethereum',
      'eth',
      'ethusdt',
      'ether',
      'ethereum tether'
    ]
  },

  /* ==========================================================================
     FOREX
     ========================================================================== */
  {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    market: 'forex',
    exchange: 'FX',
    country: null,
    currency: 'USD',
    assetType: 'forex',
    aliases: [
      'euro',
      'eurusd',
      'eur usd',
      'euro dollar',
      'fiber'
    ]
  },
  {
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    market: 'forex',
    exchange: 'FX',
    country: null,
    currency: 'USD',
    assetType: 'forex',
    aliases: [
      'pound',
      'sterling',
      'cable',
      'gbpusd',
      'gbp usd',
      'british pound'
    ]
  },
  {
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    market: 'forex',
    exchange: 'FX',
    country: null,
    currency: 'JPY',
    assetType: 'forex',
    aliases: [
      'yen',
      'jpy',
      'usdjpy',
      'usd jpy',
      'dollar yen'
    ]
  },

  /* ==========================================================================
     INDICES
     ========================================================================== */

  /* ------------------------------ India (NSE) ---------------------------- */
  {
    symbol: 'NIFTY 50',
    name: 'Nifty 50',
    market: 'indices',
    exchange: 'NSE',
    country: 'India',
    currency: 'INR',
    assetType: 'index',
    aliases: [
      'nifty',
      'nifty50',
      'nifty fifty',
      'nifty 50 index'
    ]
  },
  {
    symbol: 'BANK NIFTY',
    name: 'Nifty Bank',
    market: 'indices',
    exchange: 'NSE',
    country: 'India',
    currency: 'INR',
    assetType: 'index',
    aliases: [
      'banknifty',
      'bank nifty index',
      'nifty bank index'
    ]
  },

  /* ----------------------------- United States --------------------------- */
  {
    symbol: 'S&P 500',
    name: 'S&P 500 Index',
    market: 'indices',
    exchange: 'CME',
    country: 'United States',
    currency: 'USD',
    assetType: 'index',
    aliases: [
      'sp500',
      'spx',
      's and p 500',
      'sandp500',
      's&p 500',
      's&p500',
      'sp 500'
    ]
  },
  {
    symbol: 'NASDAQ 100',
    name: 'Nasdaq 100 Index',
    market: 'indices',
    exchange: 'NASDAQ',
    country: 'United States',
    currency: 'USD',
    assetType: 'index',
    aliases: [
      'ndx',
      'nasdaq',
      'nasdaq100',
      'nasdaq 100 index'
    ]
  },

  /* ==========================================================================
     COMMODITIES
     ========================================================================== */
  {
    symbol: 'GOLD',
    name: 'Gold Spot',
    market: 'commodities',
    exchange: 'OTC',
    country: null,
    currency: 'USD',
    assetType: 'commodity',
    aliases: [
      'xau',
      'xauusd',
      'gold spot',
      'gold oz',
      'spot gold'
    ]
  },
  {
    symbol: 'SILVER',
    name: 'Silver Spot',
    market: 'commodities',
    exchange: 'OTC',
    country: null,
    currency: 'USD',
    assetType: 'commodity',
    aliases: [
      'xag',
      'xagusd',
      'silver spot',
      'spot silver'
    ]
  },
  {
    symbol: 'CRUDE OIL',
    name: 'Crude Oil WTI',
    market: 'commodities',
    exchange: 'NYMEX',
    country: null,
    currency: 'USD',
    assetType: 'commodity',
    aliases: [
      'wti',
      'oil',
      'crude',
      'wti crude',
      'wti crude oil',
      'us crude'
    ]
  }
];
