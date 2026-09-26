/* ============================================================================
   AI Trading Assistant — Phase 1 application logic
   ----------------------------------------------------------------------------
   Vanilla JavaScript. No frameworks. No build step. No network calls.
   Everything rendered here comes from the static DEMO dataset defined below.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. Storage helpers (localStorage is optional — failures are swallowed)
     ========================================================================== */

  var K_SETTINGS = 'ata.settings.v1';
  var K_WATCH = 'ata.watchlist.v1';

  var store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (err) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        /* storage unavailable (private mode, quota) — ignore */
      }
    },
    remove: function (key) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        /* ignore */
      }
    }
  };

  /* ==========================================================================
     2. Settings
     ========================================================================== */

  var DEFAULT_SETTINGS = {
    theme: 'dark',
    density: 'comfortable',
    reduceMotion: false,
    showSparklines: true,
    showStatusStrip: true,
    defaultMarket: 'all'
  };

  var settings = Object.assign({}, DEFAULT_SETTINGS, store.get(K_SETTINGS, {}));

  /* sanitise whatever came out of storage */
  if (settings.theme !== 'dark' && settings.theme !== 'light') settings.theme = 'dark';
  if (settings.density !== 'comfortable' && settings.density !== 'compact') settings.density = 'comfortable';
  settings.reduceMotion = !!settings.reduceMotion;
  settings.showSparklines = settings.showSparklines !== false;
  settings.showStatusStrip = settings.showStatusStrip !== false;
  if (typeof settings.defaultMarket !== 'string') settings.defaultMarket = 'all';

  function applySettings() {
    var root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-density', settings.density);
    root.setAttribute('data-motion', settings.reduceMotion ? 'reduced' : 'normal');
    root.setAttribute('data-sparklines', settings.showSparklines ? 'on' : 'off');
    root.setAttribute('data-status-strip', settings.showStatusStrip ? 'on' : 'off');
    store.set(K_SETTINGS, settings);
  }

  /* ==========================================================================
     3. Static DEMO market data
     --------------------------------------------------------------------------
     Every number below is hard-coded sample data. Nothing is fetched, streamed
     or computed from a live source. This is intentional for Phase 1.
     ========================================================================== */

  var MARKETS = [
    { id: 'stocks', label: 'Stocks', short: 'Stocks' },
    { id: 'forex', label: 'Forex', short: 'Forex' },
    { id: 'crypto', label: 'Crypto', short: 'Crypto' },
    { id: 'indices', label: 'Indices', short: 'Indices' },
    { id: 'commodities', label: 'Commodities', short: 'Commod.' }
  ];

  var MARKET_BY_ID = {};
  MARKETS.forEach(function (m) { MARKET_BY_ID[m.id] = m; });

  var INSTRUMENTS = [
    /* ---------------- Stocks ---------------- */
    { symbol: 'AAPL', name: 'Apple Inc.', market: 'stocks', price: 227.52, change: 1.84, changePct: 0.82, volume: '54.2M' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', market: 'stocks', price: 431.18, change: -2.36, changePct: -0.54, volume: '21.7M' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', market: 'stocks', price: 128.94, change: 3.12, changePct: 2.48, volume: '312.4M' },
    { symbol: 'TSLA', name: 'Tesla Inc.', market: 'stocks', price: 248.60, change: -6.45, changePct: -2.53, volume: '98.1M' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market: 'stocks', price: 218.33, change: 0.94, changePct: 0.43, volume: '9.6M' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', market: 'stocks', price: 186.47, change: 1.22, changePct: 0.66, volume: '41.3M' },

    /* ---------------- Forex ---------------- */
    { symbol: 'EUR/USD', name: 'Euro / US Dollar', market: 'forex', price: 1.0842, change: 0.0018, changePct: 0.17, volume: '—', digits: 4 },
    { symbol: 'GBP/USD', name: 'British Pound / US Dollar', market: 'forex', price: 1.2715, change: -0.0024, changePct: -0.19, volume: '—', digits: 4 },
    { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', market: 'forex', price: 152.36, change: 0.42, changePct: 0.28, volume: '—' },
    { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', market: 'forex', price: 0.6584, change: -0.0011, changePct: -0.17, volume: '—', digits: 4 },
    { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar', market: 'forex', price: 1.3572, change: 0.0009, changePct: 0.07, volume: '—', digits: 4 },
    { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', market: 'forex', price: 0.8914, change: -0.0006, changePct: -0.07, volume: '—', digits: 4 },

    /* ---------------- Crypto ---------------- */
    { symbol: 'BTC/USD', name: 'Bitcoin', market: 'crypto', price: 63482.15, change: 1245.30, changePct: 2.00, volume: '28.4B' },
    { symbol: 'ETH/USD', name: 'Ethereum', market: 'crypto', price: 3128.44, change: -42.18, changePct: -1.33, volume: '14.1B' },
    { symbol: 'SOL/USD', name: 'Solana', market: 'crypto', price: 148.72, change: 6.35, changePct: 4.46, volume: '3.9B' },
    { symbol: 'XRP/USD', name: 'XRP', market: 'crypto', price: 0.5412, change: -0.0084, changePct: -1.53, volume: '1.7B', digits: 4 },
    { symbol: 'ADA/USD', name: 'Cardano', market: 'crypto', price: 0.3871, change: 0.0042, changePct: 1.10, volume: '612M', digits: 4 },
    { symbol: 'DOGE/USD', name: 'Dogecoin', market: 'crypto', price: 0.1204, change: -0.0021, changePct: -1.71, volume: '845M', digits: 4 },

    /* ---------------- Indices ---------------- */
    { symbol: 'SPX', name: 'S&P 500', market: 'indices', price: 5712.30, change: 12.44, changePct: 0.22, volume: '—' },
    { symbol: 'NDX', name: 'Nasdaq 100', market: 'indices', price: 19884.75, change: -35.20, changePct: -0.18, volume: '—' },
    { symbol: 'DJI', name: 'Dow Jones Industrial Average', market: 'indices', price: 42118.90, change: 88.15, changePct: 0.21, volume: '—' },
    { symbol: 'FTSE', name: 'FTSE 100', market: 'indices', price: 8274.60, change: -14.30, changePct: -0.17, volume: '—' },
    { symbol: 'DAX', name: 'DAX 40', market: 'indices', price: 18932.10, change: 46.80, changePct: 0.25, volume: '—' },
    { symbol: 'N225', name: 'Nikkei 225', market: 'indices', price: 38142.55, change: -212.40, changePct: -0.55, volume: '—' },

    /* ---------------- Commodities ---------------- */
    { symbol: 'XAU/USD', name: 'Gold Spot', market: 'commodities', price: 2648.30, change: 8.90, changePct: 0.34, volume: '—' },
    { symbol: 'XAG/USD', name: 'Silver Spot', market: 'commodities', price: 31.24, change: -0.18, changePct: -0.57, volume: '—' },
    { symbol: 'WTI', name: 'Crude Oil WTI', market: 'commodities', price: 71.48, change: 0.62, changePct: 0.88, volume: '—' },
    { symbol: 'NATGAS', name: 'Natural Gas', market: 'commodities', price: 2.684, change: -0.041, changePct: -1.50, volume: '—', digits: 3 },
    { symbol: 'COPPER', name: 'Copper', market: 'commodities', price: 4.312, change: 0.017, changePct: 0.40, volume: '—', digits: 3 },
    { symbol: 'CORN', name: 'Corn', market: 'commodities', price: 412.25, change: -3.75, changePct: -0.90, volume: '—' }
  ];

  var INSTRUMENT_BY_SYMBOL = {};
  INSTRUMENTS.forEach(function (i) { INSTRUMENT_BY_SYMBOL[i.symbol] = i; });

  var DEFAULT_WATCHLIST = ['AAPL', 'NVDA', 'BTC/USD', 'EUR/USD', 'XAU/USD', 'SPX'];

  /* ==========================================================================
     4. Watchlist persistence
     ========================================================================== */

  function getWatchlist() {
    var stored = store.get(K_WATCH, null);
    if (!Array.isArray(stored)) return DEFAULT_WATCHLIST.slice();
    var cleaned = stored.filter(function (s) {
      return typeof s === 'string' && Object.prototype.hasOwnProperty.call(INSTRUMENT_BY_SYMBOL, s);
    });
    return cleaned;
  }

  function setWatchlist(list) {
    store.set(K_WATCH, list);
  }

  /* ==========================================================================
     5. Small utilities
     ========================================================================== */

  var ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) { return ESCAPE_MAP[c]; });
  }

  function decimals(inst) {
    if (typeof inst.digits === 'number') return inst.digits;
    return inst.price < 5 ? 4 : 2;
  }

  function fmt(number, digits) {
    var negative = number < 0;
    var parts = Math.abs(number).toFixed(digits).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (negative ? '-' : '') + parts.join('.');
  }

  function signed(number, digits) {
    return (number >= 0 ? '+' : '') + fmt(number, digits);
  }

  function signedPct(number) {
    return (number >= 0 ? '+' : '') + number.toFixed(2) + '%';
  }

  /* deterministic pseudo-random generator seeded from a string */
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 32-point walk, biased by the instrument's daily direction */
  function series(symbol, length, up) {
    var rnd = mulberry32(hashSeed(symbol));
    var drift = up ? 0.42 : -0.42;
    var value = 100;
    var out = [];
    for (var i = 0; i < length; i++) {
      value += (rnd() - 0.5) * 4.2 + drift;
      out.push(value);
    }
    return out;
  }

  function sparkline(inst) {
    var w = 118;
    var h = 34;
    var points = series(inst.symbol, 32, inst.changePct >= 0);
    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var span = (max - min) || 1;
    var step = w / (points.length - 1);

    var coords = points.map(function (p, i) {
      var x = (i * step).toFixed(2);
      var y = (h - 3 - ((p - min) / span) * (h - 6)).toFixed(2);
      return x + ',' + y;
    }).join(' ');

    var cls = inst.changePct >= 0 ? 'up' : 'down';

    return '<svg class="spark ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" ' +
           'preserveAspectRatio="none" role="img" aria-hidden="true" focusable="false">' +
           '<polyline points="' + coords + '"></polyline></svg>';
  }

  /* ==========================================================================
     6. Indicative market sessions (America/New_York)
     ========================================================================== */

  function etParts() {
    try {
      var formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      var map = {};
      formatter.formatToParts(new Date()).forEach(function (part) {
        map[part.type] = part.value;
      });
      var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      var hour = parseInt(map.hour, 10);
      if (isNaN(hour) || hour === 24) hour = 0;
      var minute = parseInt(map.minute, 10);
      if (isNaN(minute)) minute = 0;
      var day = Object.prototype.hasOwnProperty.call(days, map.weekday) ? days[map.weekday] : new Date().getDay();
      return { day: day, minutes: hour * 60 + minute };
    } catch (err) {
      var d = new Date();
      return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
    }
  }

  function marketStatus(id) {
    var et = etParts();
    var day = et.day;
    var minutes = et.minutes;
    var weekday = day >= 1 && day <= 5;

    switch (id) {
      case 'crypto':
        return { open: true, label: '24 / 7' };

      case 'forex': {
        var fxOpen = (day >= 1 && day <= 4) ||
                     (day === 5 && minutes < 1020) ||
                     (day === 0 && minutes >= 1020);
        return { open: fxOpen, label: 'Sun 17:00 – Fri 17:00 ET' };
      }

      case 'stocks':
      case 'indices': {
        var cashOpen = weekday && minutes >= 570 && minutes < 960;
        return { open: cashOpen, label: '09:30 – 16:00 ET' };
      }

      case 'commodities': {
        var cmdOpen = weekday && (minutes >= 1080 || minutes < 1020);
        return { open: cmdOpen, label: '18:00 – 17:00 ET' };
      }

      default:
        return { open: false, label: '—' };
    }
  }

  function renderStatusStrip() {
    var host = document.getElementById('statusStrip');
    if (!host) return;

    var html = MARKETS.map(function (m) {
      var status = marketStatus(m.id);
      return '<span class="status-chip ' + (status.open ? 'is-open' : 'is-closed') + '" ' +
             'title="' + esc(m.label + ' · ' + status.label + ' · sample data') + '">' +
             '<i class="dot"></i>' + esc(m.short) +
             '</span>';
    }).join('');

    host.innerHTML = html;
  }

  /* ==========================================================================
     7. Router state
     ========================================================================== */

  var ROUTES = ['dashboard', 'markets', 'watchlist', 'insights', 'journal', 'settings'];

  var TITLES = {
    dashboard: 'Dashboard',
    markets: 'Markets',
    watchlist: 'Watchlist',
    insights: 'AI Insights',
    journal: 'Journal',
    settings: 'Settings'
  };

  var state = {
    view: 'dashboard',
    marketFilter: settings.defaultMarket || 'all',
    query: ''
  };

  if (state.marketFilter !== 'all' && !MARKET_BY_ID[state.marketFilter]) {
    state.marketFilter = 'all';
  }

  function currentRoute() {
    var raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim();
    return ROUTES.indexOf(raw) !== -1 ? raw : 'dashboard';
  }

  function navigate(view) {
    var target = '#/' + view;
    if (window.location.hash === target) {
      render();
    } else {
      window.location.hash = target;
    }
  }

  function filteredInstruments() {
    var q = state.query.trim().toLowerCase();
    return INSTRUMENTS.filter(function (inst) {
      var okMarket = state.marketFilter === 'all' || inst.market === state.marketFilter;
      if (!okMarket) return false;
      if (!q) return true;
      return inst.symbol.toLowerCase().indexOf(q) !== -1 ||
             inst.name.toLowerCase().indexOf(q) !== -1;
    });
  }

  /* ==========================================================================
     8. Views
     ========================================================================== */

  /* ------------------------------ Dashboard ------------------------------ */

  function viewDashboard() {
    var openCount = MARKETS.filter(function (m) { return marketStatus(m.id).open; }).length;
    var watchCount = getWatchlist().length;

    var kpis = [
      {
        label: 'Markets covered',
        value: String(MARKETS.length),
        sub: 'Stocks · Forex · Crypto · Indices · Commodities',
        cls: ''
      },
      {
        label: 'Instruments tracked',
        value: String(INSTRUMENTS.length),
        sub: 'Static sample universe',
        cls: ''
      },
      {
        label: 'Watchlist items',
        value: String(watchCount),
        sub: 'Saved locally in this browser',
        cls: ''
      },
      {
        label: 'Markets open now',
        value: openCount + ' / ' + MARKETS.length,
        sub: 'Indicative hours, America/New_York',
        cls: openCount > 0 ? 'is-up' : 'is-down'
      }
    ].map(function (k) {
      return '<article class="kpi ' + k.cls + '">' +
               '<span class="kpi-label">' + esc(k.label) + '</span>' +
               '<strong class="kpi-value">' + esc(k.value) + '</strong>' +
               '<span class="kpi-sub">' + esc(k.sub) + '</span>' +
             '</article>';
    }).join('');

    var marketRows = MARKETS.map(function (m) {
      var items = INSTRUMENTS.filter(function (i) { return i.market === m.id; });
      var status = marketStatus(m.id);

      var best = items[0];
      items.forEach(function (i) {
        if (Math.abs(i.changePct) > Math.abs(best.changePct)) best = i;
      });

      var up = best.changePct >= 0;

      return '<tr>' +
               '<td><span class="tag tag-' + m.id + '">' + esc(m.label) + '</span></td>' +
               '<td class="num">' + items.length + '</td>' +
               '<td><span class="dot-label ' + (status.open ? 'is-open' : 'is-closed') + '">' +
                 '<i class="dot"></i>' + (status.open ? 'Open' : 'Closed') +
               '</span></td>' +
               '<td class="small muted">' + esc(status.label) + '</td>' +
               '<td class="num"><span class="sym">' + esc(best.symbol) + '</span></td>' +
               '<td class="num ' + (up ? 'up' : 'down') + '">' + signedPct(best.changePct) + '</td>' +
             '</tr>';
    }).join('');

    return '' +
      '<section class="view">' +

        '<header class="view-head">' +
          '<div>' +
            '<h1>Dashboard</h1>' +
            '<p class="muted">Multi-market research overview · static sample data</p>' +
          '</div>' +
          '<div class="head-actions">' +
            '<span class="pill pill-demo">Demo data</span>' +
          '</div>' +
        '</header>' +

        '<div class="kpi-grid">' + kpis + '</div>' +

        '<div class="panel-grid">' +

          '<section class="panel">' +
            '<div class="panel-head">' +
              '<h2>Market overview</h2>' +
              '<span class="pill pill-muted">Static</span>' +
            '</div>' +
            '<div class="table-wrap">' +
              '<table class="data">' +
                '<thead>' +
                  '<tr>' +
                    '<th>Market</th>' +
                    '<th class="num">Instruments</th>' +
                    '<th>Session</th>' +
                    '<th>Indicative hours</th>' +
                    '<th class="num">Largest mover</th>' +
                    '<th class="num">Move</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>' + marketRows + '</tbody>' +
              '</table>' +
            '</div>' +
          '</section>' +

          '<aside class="panel">' +
            '<div class="panel-head">' +
              '<h2>AI Insights</h2>' +
              '<span class="pill pill-warn">Phase 2</span>' +
            '</div>' +
            '<div class="empty">' +
              '<div class="empty-ico" aria-hidden="true">✦</div>' +
              '<p><strong>No AI provider connected.</strong></p>' +
              '<p class="muted">This panel is a layout placeholder. Model integration, ' +
                'signal generation and natural-language analysis arrive in a later phase.</p>' +
            '</div>' +
            '<ul class="check-list">' +
              '<li>Cross-market correlation summaries</li>' +
              '<li>Volatility and regime detection</li>' +
              '<li>Watchlist narrative briefings</li>' +
              '<li>Journal pattern review</li>' +
            '</ul>' +
          '</aside>' +

        '</div>' +

      '</section>';
  }

  /* ------------------------------- Markets ------------------------------- */

  function viewMarkets() {
    var tabIds = ['all'].concat(MARKETS.map(function (m) { return m.id; }));

    var tabs = tabIds.map(function (id) {
      var label = id === 'all' ? 'All markets' : MARKET_BY_ID[id].label;
      var count = id === 'all'
        ? INSTRUMENTS.length
        : INSTRUMENTS.filter(function (i) { return i.market === id; }).length;
      var active = state.marketFilter === id ? ' active' : '';
      return '<button type="button" class="tab' + active + '" data-action="filter-market" ' +
             'data-market="' + esc(id) + '">' + esc(label) +
             '<span class="tab-count">' + count + '</span></button>';
    }).join('');

    var rows = filteredInstruments();

    var body = rows.length
      ? rows.map(function (inst) {
          var d = decimals(inst);
          var up = inst.changePct >= 0;
          return '<tr>' +
                   '<td class="cell-sym">' +
                     '<span class="sym">' + esc(inst.symbol) + '</span>' +
                     '<span class="sub">' + esc(inst.name) + '</span>' +
                   '</td>' +
                   '<td><span class="tag tag-' + inst.market + '">' +
                     esc(MARKET_BY_ID[inst.market].label) + '</span></td>' +
                   '<td class="num">' + fmt(inst.price, d) + '</td>' +
                   '<td class="num ' + (up ? 'up' : 'down') + '">' + signed(inst.change, d) + '</td>' +
                   '<td class="num ' + (up ? 'up' : 'down') + '">' + signedPct(inst.changePct) + '</td>' +
                   '<td class="num muted">' + esc(inst.volume) + '</td>' +
                   '<td class="col-spark">' + sparkline(inst) + '</td>' +
                 '</tr>';
        }).join('')
      : '<tr><td colspan="7"><div class="empty-row">' +
        'No instruments match the current filter.</div></td></tr>';

    var queryChip = state.query
      ? '<button type="button" class="chip" data-action="clear-query">' +
        'Filter: “' + esc(state.query) + '” <span aria-hidden="true">×</span></button>'
      : '';

    return '' +
      '<section class="view">' +

        '<header class="view-head">' +
          '<div>' +
            '<h1>Markets</h1>' +
            '<p class="muted">' + rows.length + ' of ' + INSTRUMENTS.length +
              ' sample instruments shown · no live feed</p>' +
          '</div>' +
          '<div class="head-actions">' +
            '<span class="pill pill-demo">Demo data</span>' +
            queryChip +
          '</div>' +
        '</header>' +

        '<div class="tabs" role="tablist" aria-label="Market filter">' + tabs + '</div>' +

        '<section class="panel">' +
          '<div class="table-wrap">' +
            '<table class="data">' +
              '<thead>' +
                '<tr>' +
                  '<th>Instrument</th>' +
                  '<th>Market</th>' +
                  '<th class="num">Price</th>' +
                  '<th class="num">Change</th>' +
                  '<th class="num">Change %</th>' +
                  '<th class="num">Volume</th>' +
                  '<th class="col-spark">Trend</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + body + '</tbody>' +
            '</table>' +
          '</div>' +
        '</section>' +

      '</section>';
  }

  /* ------------------------------ Watchlist ------------------------------ */

  function viewWatchlist() {
    var list = getWatchlist();
    var items = list.map(function (sym) { return INSTRUMENT_BY_SYMBOL[sym]; })
                    .filter(function (i) { return !!i; });

    var options = INSTRUMENTS
      .filter(function (i) { return list.indexOf(i.symbol) === -1; })
      .map(function (i) {
        return '<option value="' + esc(i.symbol) + '">' +
               esc(i.symbol + ' — ' + i.name) + '</option>';
      }).join('');

    var cards = items.length
      ? items.map(function (inst) {
          var d = decimals(inst);
          var up = inst.changePct >= 0;
          return '<article class="watch-card">' +
                   '<header class="watch-card-head">' +
                     '<div>' +
                       '<span class="sym">' + esc(inst.symbol) + '</span>' +
                       '<span class="name">' + esc(inst.name) + '</span>' +
                     '</div>' +
                     '<button type="button" class="icon-btn sm" data-action="watch-remove" ' +
                       'data-symbol="' + esc(inst.symbol) + '" ' +
                       'aria-label="Remove ' + esc(inst.symbol) + ' from watchlist">×</button>' +
                   '</header>' +
                   '<div class="watch-price">' + fmt(inst.price, d) + '</div>' +
                   '<div class="watch-chg ' + (up ? 'up' : 'down') + '">' +
                     signed(inst.change, d) + ' (' + signedPct(inst.changePct) + ')' +
                   '</div>' +
                   sparkline(inst) +
                   '<footer class="watch-foot">' +
                     '<span class="tag tag-' + inst.market + '">' +
                       esc(MARKET_BY_ID[inst.market].label) + '</span>' +
                     '<span>Vol ' + esc(inst.volume) + '</span>' +
                   '</footer>' +
                 '</article>';
        }).join('')
      : '<div class="empty" style="grid-column:1/-1">' +
          '<div class="empty-ico" aria-hidden="true">★</div>' +
          '<p><strong>Your watchlist is empty.</strong></p>' +
          '<p class="muted">Add an instrument from the selector above.</p>' +
        '</div>';

    return '' +
      '<section class="view">' +

        '<header class="view-head">' +
          '<div>' +
            '<h1>Watchlist</h1>' +
            '<p class="muted">' + items.length +
              ' instruments · saved locally in this browser</p>' +
          '</div>' +
          '<div class="head-actions">' +
            '<span class="pill pill-demo">Demo data</span>' +
          '</div>' +
        '</header>' +

        '<section class="panel">' +
          '<div class="panel-head">' +
            '<h2>Manage</h2>' +
            '<span class="pill pill-muted">localStorage only</span>' +
          '</div>' +
          '<div class="watch-toolbar">' +
            '<select class="select" data-role="watch-add-select" aria-label="Choose an instrument to add"' +
              (options ? '' : ' disabled') + '>' +
              (options || '<option value="">All instruments already added</option>') +
            '</select>' +
            '<button type="button" class="chip" data-action="watch-add">Add to watchlist</button>' +
            '<button type="button" class="chip" data-action="reset-watchlist">Reset defaults</button>' +
          '</div>' +
        '</section>' +

        '<div class="watch-grid">' + cards + '</div>' +

      '</section>';
  }

  /* ------------------------------- Insights ------------------------------ */

  function viewInsights() {
    var cards = [
      {
        title: 'Cross-market correlation',
        body: 'Surface relationships between equities, FX, crypto, indices and commodities ' +
              'so you can see when risk is moving as one block.'
      },
      {
        title: 'Volatility & regime detection',
        body: 'Classify each market as trending, chopping or expanding so position sizing ' +
              'decisions are made with context.'
      },
      {
        title: 'Watchlist briefings',
        body: 'Generate a short natural-language summary of what changed across your saved ' +
              'instruments during the session.'
      },
      {
        title: 'Journal pattern review',
        body: 'Compare your written trade notes against realised outcomes to highlight ' +
              'repeatable strengths and recurring mistakes.'
      },
      {
        title: 'Scenario sketching',
        body: 'Draft "what if" levels and invalidation points for a setup before you commit ' +
              'to a plan.'
      },
      {
        title: 'Risk exposure map',
        body: 'Show where the same underlying theme is duplicated across several of your ' +
              'instruments.'
      }
    ].map(function (c) {
      return '<article class="insight-card">' +
               '<h3>' + esc(c.title) + '<span class="pill pill-warn">Phase 2</span></h3>' +
               '<p>' + esc(c.body) + '</p>' +
             '</article>';
    }).join('');

    return '' +
      '<section class="view">' +

        '<header class="view-head">' +
          '<div>' +
            '<h1>AI Insights</h1>' +
            '<p class="muted">Planned capability map · nothing is running yet</p>' +
          '</div>' +
          '<div class="head-actions">' +
            '<span class="pill pill-warn">Not connected</span>' +
          '</div>' +
        '</header>' +

        '<div class="banner">' +
          '<span class="banner-ico" aria-hidden="true">⚠</span>' +
          '<div><strong>No AI model is connected in Phase 1.</strong> ' +
          'There are no API keys, no requests and no generated output anywhere on this page. ' +
          'The cards below describe intended functionality only.</div>' +
        '</div>' +

        '<div class="insight-grid">' + cards + '</div>' +

      '</section>';
  }

  /* -------------------------------- Journal ------------------------------ */

  function viewJournal() {
    var demoEntries = [
      { date: '2026-09-22', symbol: 'NVDA', side: 'Long',  note: 'Breakout above prior day high, sized at half risk.', tag: 'Followed plan' },
      { date: '2026-09-23', symbol: 'EUR/USD', side: 'Short', note: 'Faded the London push into resistance.', tag: 'Followed plan' },
      { date: '2026-09-24', symbol: 'BTC/USD', side: 'Long',  note: 'Entered late after the move had already extended.', tag: 'Chased' },
      { date: '2026-09-25', symbol: 'XAU/USD', side: 'Long',  note: 'Held through the session, no exit criteria written down.', tag: 'No plan' }
    ];

    var rows = demoEntries.map(function (e) {
      return '<tr>' +
               '<td class="num muted">' + esc(e.date) + '</td>' +
               '<td><span class="sym">' + esc(e.symbol) + '</span></td>' +
               '<td>' + esc(e.side) + '</td>' +
               '<td class="small muted">' + esc(e.note) + '</td>' +
               '<td><span class="tag">' + esc(e.tag) + '</span></td>' +
             '</tr>';
    }).join('');

    return '' +
      '<section class="view">' +

        '<header class="view-head">' +
          '<div>' +
            '<h1>Journal</h1>' +
            '<p class="muted">Trading notes and review · sample entries only</p>' +
          '</div>' +
          '<div class="head-actions">' +
            '<span class="pill pill-demo">Demo data</span>' +
          '</div>' +
        '</header>' +

        '<div class="banner">' +
          '<span class="banner-ico" aria-hidden="true">✎</span>' +
          '<div><strong>Entries are not saved yet.</strong> ' +
          'Writing and persisting journal entries is planned for a later phase. ' +
          'The rows below are hard-coded examples that show the intended layout.</div>' +
        '</div>' +

        '<section class="panel">' +
          '<div class="panel-head">' +
            '<h2>Recent entries</h2>' +
            '<span class="pill pill-muted">Read-only</span>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data">' +
              '<thead>' +
                '<tr>' +
                  '<th>Date</th>' +
                  '<th>Instrument</th>' +
                  '<th>Side</th>' +
                  '<th>Note</th>' +
                  '<th>Review</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</section>' +

      '</section>';
  }

  /* -------------------------------- Settings ----------------------------- */

  function viewSettings() {
    var marketOptions = ['all'].concat(MARKETS.map(function (m) { return m.id; }))
      .map(function (id) {
        var label = id === 'all' ? 'All markets' : MARKET_BY_ID[id].label;
        var selected = settings.defaultMarket === id ? ' selected' : '';
        return '<option value="' + esc(id) + '"' + selected + '>' + esc(label) + '</option>';
      }).join('');

    var watchCount = getWatchlist().length;

    return '' +
      '<section class="view">' +

        '<header class="view-head">' +
          '<div>' +
            '<h1>Settings</h1>' +
            '<p class="muted">Preferences are stored in this browser only</p>' +
          '</div>' +
          '<div class="head-actions">' +
            '<span class="pill pill-muted">localStorage</span>' +
          '</div>' +
        '</header>' +

        '<div class="settings-grid">' +

          '<section class="panel">' +
            '<div class="panel-head"><h2>Appearance</h2></div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label for="set-theme">Colour theme</label>' +
                '<p class="hint">Applies instantly and is remembered on this device.</p>' +
              '</div>' +
              '<div class="control">' +
                '<select id="set-theme" class="select" data-setting="theme">' +
                  '<option value="dark"' + (settings.theme === 'dark' ? ' selected' : '') + '>Dark</option>' +
                  '<option value="light"' + (settings.theme === 'light' ? ' selected' : '') + '>Light</option>' +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label for="set-density">Layout density</label>' +
                '<p class="hint">Compact reduces padding to fit more rows on screen.</p>' +
              '</div>' +
              '<div class="control">' +
                '<select id="set-density" class="select" data-setting="density">' +
                  '<option value="comfortable"' + (settings.density === 'comfortable' ? ' selected' : '') + '>Comfortable</option>' +
                  '<option value="compact"' + (settings.density === 'compact' ? ' selected' : '') + '>Compact</option>' +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label for="set-motion">Reduce motion</label>' +
                '<p class="hint">Disables view transitions and hover animations.</p>' +
              '</div>' +
              '<div class="control">' +
                '<label class="switch">' +
                  '<input id="set-motion" type="checkbox" data-setting="reduceMotion"' +
                    (settings.reduceMotion ? ' checked' : '') + '>' +
                  '<span aria-hidden="true"></span>' +
                '</label>' +
              '</div>' +
            '</div>' +

          '</section>' +

          '<section class="panel">' +
            '<div class="panel-head"><h2>Dashboard</h2></div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label for="set-spark">Show trend sparklines</label>' +
                '<p class="hint">Hides the trend column and watchlist charts.</p>' +
              '</div>' +
              '<div class="control">' +
                '<label class="switch">' +
                  '<input id="set-spark" type="checkbox" data-setting="showSparklines"' +
                    (settings.showSparklines ? ' checked' : '') + '>' +
                  '<span aria-hidden="true"></span>' +
                '</label>' +
              '</div>' +
            '</div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label for="set-status">Show market status strip</label>' +
                '<p class="hint">Indicative session hours in the header bar.</p>' +
              '</div>' +
              '<div class="control">' +
                '<label class="switch">' +
                  '<input id="set-status" type="checkbox" data-setting="showStatusStrip"' +
                    (settings.showStatusStrip ? ' checked' : '') + '>' +
                  '<span aria-hidden="true"></span>' +
                '</label>' +
              '</div>' +
            '</div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label for="set-market">Default market filter</label>' +
                '<p class="hint">Applied when you open the Markets view.</p>' +
              '</div>' +
              '<div class="control">' +
                '<select id="set-market" class="select" data-setting="defaultMarket">' +
                  marketOptions +
                '</select>' +
              '</div>' +
            '</div>' +

          '</section>' +

          '<section class="panel">' +
            '<div class="panel-head"><h2>Data &amp; storage</h2></div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label>Watchlist entries</label>' +
                '<p class="hint">' + watchCount + ' instrument(s) stored locally.</p>' +
              '</div>' +
              '<div class="control">' +
                '<button type="button" class="chip" data-action="reset-watchlist">Reset</button>' +
              '</div>' +
            '</div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label>Preferences</label>' +
                '<p class="hint">Restore theme, density and display defaults.</p>' +
              '</div>' +
              '<div class="control">' +
                '<button type="button" class="chip" data-action="reset-settings">Reset</button>' +
              '</div>' +
            '</div>' +

            '<div class="setting-row">' +
              '<div class="label-wrap">' +
                '<label>Clear all local data</label>' +
                '<p class="hint">Removes settings and watchlist from this browser.</p>' +
              '</div>' +
              '<div class="control">' +
                '<button type="button" class="chip" data-action="clear-storage">Clear</button>' +
              '</div>' +
            '</div>' +

            '<div class="banner">' +
              '<span class="banner-ico" aria-hidden="true">ℹ</span>' +
              '<div><strong>Phase 1 stores nothing on a server.</strong> ' +
              'No accounts, no cookies, no tracking, no market data requests.</div>' +
            '</div>' +

          '</section>' +

        '</div>' +

      '</section>';
  }

  /* ==========================================================================
     9. View registry & rendering
     ========================================================================== */

  var VIEWS = {
    dashboard: viewDashboard,
    markets: viewMarkets,
    watchlist: viewWatchlist,
    insights: viewInsights,
    journal: viewJournal,
    settings: viewSettings
  };

  var viewHost = null;
  var sidebarEl = null;
  var scrimEl = null;
  var menuBtn = null;

  function render() {
    state.view = currentRoute();

    var crumb = document.getElementById('crumbView');
    if (crumb) crumb.textContent = TITLES[state.view] || 'Dashboard';

    var navItems = document.querySelectorAll('.nav-item');
    for (var i = 0; i < navItems.length; i++) {
      var item = navItems[i];
      var isActive = item.getAttribute('data-view') === state.view;
      item.classList.toggle('active', isActive);
      if (isActive) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    }

    if (viewHost) {
      var builder = VIEWS[state.view] || VIEWS.dashboard;
      viewHost.innerHTML = builder();
    }

    renderStatusStrip();

    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (err) {
      window.scrollTo(0, 0);
    }

    closeSidebar();
  }

  /* ==========================================================================
     10. Mobile sidebar
     ========================================================================== */

  function openSidebar() {
    if (!sidebarEl) return;
    sidebarEl.classList.add('open');
    if (scrimEl) scrimEl.hidden = false;
    document.body.classList.add('nav-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    if (!sidebarEl) return;
    sidebarEl.classList.remove('open');
    if (scrimEl) scrimEl.hidden = true;
    document.body.classList.remove('nav-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleSidebar() {
    if (!sidebarEl) return;
    if (sidebarEl.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  /* ==========================================================================
     11. Toasts
     ========================================================================== */

  function toast(message) {
    var stack = document.getElementById('toastStack');
    if (!stack) return;

    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    stack.appendChild(el);

    window.requestAnimationFrame(function () {
      el.classList.add('show');
    });

    window.setTimeout(function () {
      el.classList.remove('show');
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    }, 2400);
  }

  /* ==========================================================================
     12. Search
     ========================================================================== */

  var searchInput = null;
  var searchResultsEl = null;

  function buildSearchResults(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];

    return INSTRUMENTS.filter(function (inst) {
      return inst.symbol.toLowerCase().indexOf(q) !== -1 ||
             inst.name.toLowerCase().indexOf(q) !== -1 ||
             MARKET_BY_ID[inst.market].label.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
  }

  function renderSearchResults(query) {
    if (!searchResultsEl) return;

    var q = query.trim();

    if (!q) {
      searchResultsEl.hidden = true;
      searchResultsEl.innerHTML = '';
      return;
    }

    var matches = buildSearchResults(q);

    if (!matches.length) {
      searchResultsEl.innerHTML = '<div class="search-empty">No instruments match “' +
        esc(q) + '”</div>';
      searchResultsEl.hidden = false;
      return;
    }

    searchResultsEl.innerHTML = matches.map(function (inst) {
      var d = decimals(inst);
      var up = inst.changePct >= 0;
      return '<button type="button" class="search-result" data-symbol="' + esc(inst.symbol) + '">' +
               '<span class="sr-sym">' + esc(inst.symbol) + '</span>' +
               '<span class="sr-name">' + esc(inst.name) + '</span>' +
               '<span class="sr-price ' + (up ? 'up' : 'down') + '">' +
                 fmt(inst.price, d) +
               '</span>' +
             '</button>';
    }).join('');

    searchResultsEl.hidden = false;
  }

  function closeSearch() {
    if (!searchResultsEl) return;
    searchResultsEl.hidden = true;
    searchResultsEl.innerHTML = '';
  }

  function runSearch(query) {
    state.query = query;
    state.marketFilter = 'all';
    closeSearch();
    if (searchInput) searchInput.blur();
    navigate('markets');
  }

  /* ==========================================================================
     13. Event wiring
     ========================================================================== */

  function handleViewClick(event) {
    var btn = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!btn || !viewHost.contains(btn)) return;

    var action = btn.getAttribute('data-action');

    if (action === 'filter-market') {
      state.marketFilter = btn.getAttribute('data-market') || 'all';
      state.query = '';
      render();
      return;
    }

    if (action === 'clear-query') {
      state.query = '';
      render();
      return;
    }

    if (action === 'watch-remove') {
      var removeSymbol = btn.getAttribute('data-symbol');
      var remaining = getWatchlist().filter(function (s) { return s !== removeSymbol; });
      setWatchlist(remaining);
      toast(removeSymbol + ' removed from watchlist');
      render();
      return;
    }

    if (action === 'watch-add') {
      var select = viewHost.querySelector('[data-role="watch-add-select"]');
      if (!select || !select.value) return;

      var symbol = select.value;
      var list = getWatchlist();

      if (list.indexOf(symbol) !== -1) {
        toast(symbol + ' is already in your watchlist');
        return;
      }

      list.push(symbol);
      setWatchlist(list);
      toast(symbol + ' added to watchlist');
      render();
      return;
    }

    if (action === 'reset-watchlist') {
      setWatchlist(DEFAULT_WATCHLIST.slice());
      toast('Watchlist reset to defaults');
      render();
      return;
    }

    if (action === 'reset-settings') {
      settings = Object.assign({}, DEFAULT_SETTINGS);
      state.marketFilter = settings.defaultMarket;
      applySettings();
      toast('Settings restored to defaults');
      render();
      return;
    }

    if (action === 'clear-storage') {
      store.remove(K_SETTINGS);
      store.remove(K_WATCH);
      settings = Object.assign({}, DEFAULT_SETTINGS);
      state.marketFilter = settings.defaultMarket;
      applySettings();
      toast('Local data cleared');
      render();
      return;
    }
  }

  function handleViewChange(event) {
    var control = event.target.closest ? event.target.closest('[data-setting]') : null;
    if (!control || !viewHost.contains(control)) return;

    var key = control.getAttribute('data-setting');
    var value;

    if (control.type === 'checkbox') {
      value = control.checked;
    } else {
      value = control.value;
    }

    settings[key] = value;
    applySettings();

    if (key === 'defaultMarket') {
      state.marketFilter = value;
    }
  }

  function init() {
    viewHost = document.getElementById('view');
    sidebarEl = document.getElementById('sidebar');
    scrimEl = document.getElementById('scrim');
    menuBtn = document.getElementById('menuBtn');
    searchInput = document.getElementById('search');

    applySettings();

    /* ---- theme toggle ---- */
    var themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
        applySettings();
        if (state.view === 'settings') render();
      });
    }

    /* ---- mobile navigation ---- */
    if (menuBtn) {
      menuBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleSidebar();
      });
    }

    if (scrimEl) {
      scrimEl.addEventListener('click', closeSidebar);
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (sidebarEl && sidebarEl.classList.contains('open')) closeSidebar();
        closeSearch();
      }
    });

    /* ---- view delegation ---- */
    if (viewHost) {
      viewHost.addEventListener('click', handleViewClick);
      viewHost.addEventListener('change', handleViewChange);
    }

    /* ---- search ---- */
    var searchBox = document.querySelector('.search');
    if (searchBox && searchInput) {
      searchResultsEl = document.createElement('div');
      searchResultsEl.className = 'search-results';
      searchResultsEl.id = 'searchResults';
      searchResultsEl.hidden = true;
      searchBox.appendChild(searchResultsEl);

      searchInput.addEventListener('input', function () {
        renderSearchResults(searchInput.value);
      });

      searchInput.addEventListener('focus', function () {
        if (searchInput.value.trim()) renderSearchResults(searchInput.value);
      });

      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          var q = searchInput.value.trim();
          if (!q) return;
          event.preventDefault();
          searchInput.value = '';
          runSearch(q);
        } else if (event.key === 'Escape') {
          searchInput.value = '';
          closeSearch();
        }
      });

      searchResultsEl.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('[data-symbol]') : null;
        if (!btn) return;
        var symbol = btn.getAttribute('data-symbol');
        searchInput.value = '';
        runSearch(symbol);
      });

      document.addEventListener('click', function (event) {
        if (!searchBox.contains(event.target)) closeSearch();
      });
    }

    /* ---- routing ---- */
    window.addEventListener('hashchange', render);

    if (!window.location.hash) {
      try {
        window.history.replaceState(null, '', '#/dashboard');
      } catch (err) {
        window.location.hash = '#/dashboard';
      }
    }

    render();

    /* ---- keep session indicators fresh ---- */
    window.setInterval(renderStatusStrip, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
