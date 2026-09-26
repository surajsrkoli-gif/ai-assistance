/* ============================================================================
   AI Trading Assistant — Phase 3 frontend ⇄ backend bridge
   ----------------------------------------------------------------------------
   Loaded AFTER app.js. Responsibilities:

     1. Expose a small reusable API helper on `window.ATA.api` so future
        phases can call /assets/search, /assets/resolve, /market/status
        without re-implementing fetch logic.
     2. Perform a one-shot health probe against the live Cloudflare Worker
        and reflect the result in a status pill in the topbar:
             Backend: checking…
             Backend: Connected
             Backend: Offline
     3. Never throw. Never expose secrets. Never use localhost in production.

   Phase 3 scope: connectivity only. No market data, no AI, no trading.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. Configuration
     ==========================================================================
     Production URL is hard-coded to the deployed Cloudflare Worker.
     `window.__ATA_API_BASE_URL` is honoured as an override so a developer
     can point the page at a local `wrangler dev` instance from the browser
     console without editing this file. In normal production use the override
     is never set, so the constant below is authoritative.
     ========================================================================== */

  var PRODUCTION_API_BASE_URL =
    'https://ai-trading-assistant-api-production.suraj-ai-trading.workers.dev';

  var API_BASE_URL =
    (typeof window !== 'undefined' && window.__ATA_API_BASE_URL) ||
    PRODUCTION_API_BASE_URL;

  var API_PREFIX = '/api/v1';

  /* Health probe tuning — short and forgiving. */
  var HEALTH_TIMEOUT_MS = 6000;
  var HEALTH_RETRY_MS = 30000;

  /* ==========================================================================
     2. Reusable API helper
     ==========================================================================
     `api.get(path, params)` returns a Promise that resolves to the parsed
     JSON body — or rejects with a structured error:

         { code: 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'PARSE', status?, body? }

     Every backend endpoint in Phase 2/3 uses the same envelope, so callers
     can branch on `body.success` and, on failure, on `body.error.code`.

     Convenience methods for the three Phase 3 endpoints are attached below.
     ========================================================================== */

  function buildUrl(path, params) {
    var url = API_BASE_URL.replace(/\/+$/, '') + API_PREFIX + path;
    if (params && typeof params === 'object') {
      var qs = [];
      Object.keys(params).forEach(function (key) {
        var value = params[key];
        if (value === undefined || value === null) return;
        qs.push(
          encodeURIComponent(key) + '=' + encodeURIComponent(String(value))
        );
      });
      if (qs.length > 0) {
        url += (url.indexOf('?') === -1 ? '?' : '&') + qs.join('&');
      }
    }
    return url;
  }

  function apiGet(path, params, options) {
    var opts = options || {};
    var timeout = typeof opts.timeout === 'number' ? opts.timeout : 10000;

    return new Promise(function (resolve, reject) {
      var controller =
        typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;

      if (controller) {
        timer = window.setTimeout(function () {
          controller.abort();
        }, timeout);
      }

      var fetchOptions = {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      };
      if (controller) fetchOptions.signal = controller.signal;

      fetch(buildUrl(path, params), fetchOptions)
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              /* Not JSON — treat as a protocol error but keep the status. */
              var err = new Error('Invalid JSON in response.');
              err.code = 'PARSE';
              err.status = res.status;
              throw err;
            })
            .then(function (body) {
              if (!res.ok) {
                var err = new Error(
                  'HTTP ' + res.status + ' from ' + path
                );
                err.code = 'HTTP';
                err.status = res.status;
                err.body = body;
                throw err;
              }
              return body;
            });
        })
        .then(function (body) {
          if (timer) window.clearTimeout(timer);
          resolve(body);
        })
        .catch(function (err) {
          if (timer) window.clearTimeout(timer);
          /* AbortError → surface as a uniform TIMEOUT code. */
          if (err && err.name === 'AbortError') {
            var timeoutErr = new Error('Request timed out.');
            timeoutErr.code = 'TIMEOUT';
            return reject(timeoutErr);
          }
          if (!err.code) err.code = 'NETWORK';
          reject(err);
        });
    });
  }

  /* --------------------------------------------------------------------------
     Public API surface
     --------------------------------------------------------------------------
     Future phases will call:

         window.ATA.api.health()
         window.ATA.api.searchAssets('RELIANCE', { limit: 5 })
         window.ATA.api.resolveAsset('reliance')
         window.ATA.api.marketStatus()

     Each returns a Promise. Never throws synchronously.
     -------------------------------------------------------------------------- */

  var api = {
    baseUrl: API_BASE_URL,
    prefix: API_PREFIX,

    get: apiGet,

    health: function () {
      return apiGet('/health');
    },

    searchAssets: function (q, options) {
      var params = { q: q };
      if (options && options.limit) params.limit = options.limit;
      return apiGet('/assets/search', params);
    },

    resolveAsset: function (query) {
      return apiGet('/assets/resolve', { query: query });
    },

    marketStatus: function () {
      return apiGet('/market/status');
    }
  };

  /* Attach to a single global namespace. Using one object avoids polluting
     the global scope and gives future phases one clear entry point. */
  window.ATA = window.ATA || {};
  window.ATA.api = api;

  /* ==========================================================================
     3. Backend status pill
     ==========================================================================
     The topbar already contains a `.topbar-right` container in Phase 1's
     markup. We inject one pill into it — the same element is reused for
     every state transition (checking → connected / offline), so the UI
     never accumulates duplicate indicators.

     Visual language matches Phase 1's existing `pill` variants:
         pill-muted  → neutral / checking
         pill-demo   → success (blue accent, same as "Demo data")
         pill-warn   → failure (amber, same as "Phase 2")
     ========================================================================== */

  var PILL_ID = 'backendStatus';

  var LABELS = {
    checking: 'Backend: checking…',
    connected: 'Backend: Connected',
    disconnected: 'Backend: Offline'
  };

  function ensurePill() {
    var existing = document.getElementById(PILL_ID);
    if (existing) return existing;

    var host = document.querySelector('.topbar-right');
    if (!host) return null;

    var pill = document.createElement('span');
    pill.id = PILL_ID;
    pill.className = 'pill pill-muted';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.title = 'Connection status to the Cloudflare backend';
    pill.textContent = LABELS.checking;

    /* Insert as the first child of `.topbar-right` so it sits next to the
       search box, before the theme button and avatar. */
    host.insertBefore(pill, host.firstChild);
    return pill;
  }

  function setPill(state) {
    var pill = ensurePill();
    if (!pill) return;

    pill.classList.remove('pill-muted', 'pill-demo', 'pill-warn');

    if (state === 'connected') {
      pill.classList.add('pill-demo');
      pill.textContent = LABELS.connected;
      pill.title = 'Backend responded to /api/v1/health';
    } else if (state === 'disconnected') {
      pill.classList.add('pill-warn');
      pill.textContent = LABELS.disconnected;
      pill.title = 'Backend did not respond. Phase 1 UI remains fully usable.';
    } else {
      pill.classList.add('pill-muted');
      pill.textContent = LABELS.checking;
      pill.title = 'Contacting backend…';
    }
  }

  /* ==========================================================================
     4. Health probe
     ==========================================================================
     Called once on load, then periodically. Each call is independent; a
     failure never disables the page. On success we check both the HTTP
     status and the envelope's `success: true` flag — the backend always
     returns the latter on a healthy response.
     ========================================================================== */

  var healthTimer = null;

  function probeHealth() {
    setPill('checking');

    api
      .health()
      .then(function (body) {
        if (body && body.success === true) {
          setPill('connected');
        } else {
          setPill('disconnected');
        }
      })
      .catch(function () {
        setPill('disconnected');
      });
  }

  function startHealthLoop() {
    probeHealth();
    if (healthTimer === null) {
      healthTimer = window.setInterval(probeHealth, HEALTH_RETRY_MS);
    }
  }

  /* ==========================================================================
     5. Bootstrap
     ==========================================================================
     Wait for DOM ready so `.topbar-right` exists. app.js runs first (it is
     referenced before backend.js in index.html) and does not remove the
     topbar, so by DOMContentLoaded the container is stable.
     ========================================================================== */

  function boot() {
    /* Ensure the pill exists immediately, so the first paint already shows
       "checking…" rather than nothing. */
    ensurePill();
    startHealthLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Manual refresh hook, useful during development:
         window.__ataBackendProbe()
     Also exposed so a future "retry" button can call it. */
  window.__ataBackendProbe = probeHealth;

})();
