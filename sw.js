/* ═══════════════════════════════════════════════════════════════
   Pharma Plus Closing App — Service Worker  v5.2
   Strategy: Cache-first for app shell.
   Supabase API calls always go to network (never cached).

   v5.2 — Added js/auth.js and js/bt-bridge.js to APP_SHELL. Both are
   real ES modules app.js has imported for a while now (phone+PIN
   login/presence, and the BT sync bridge) but were missing from this
   list — meaning a fresh install, or any device whose cache had
   already been cleared, had no offline copy of either and could fail
   to load them. Also covers this round's index.html/pages.js/state.js/
   actions.js/app.js changes (whoami bar, shift-collision banner,
   JazzCash category sync, Log Out button) via the version bump below.
═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'pharmpos-closing-v5.2';

/* ── App Shell — all files that make the app work offline ──
   Load order no longer matters here — js/app.js is the only
   <script> tag index.html loads; it's an ES module that imports
   every other file below directly, and the browser's module
   loader resolves the graph. But since a service worker still
   intercepts each individual import as its own fetch, every file
   below still needs to be listed so it's available offline. ── */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  /* ── CSS ── */
  './css/main.css',
  /* ── JS ── */
  './js/app.js',
  './js/repository.js',
  './js/state.js',
  './js/actions.js',
  './js/ledger-engine.js',
  './js/components.js',
  './js/pages.js',
  './js/ledger-nav.js',
  './js/closing-book.js',
  './js/sync.js',
  './js/activity-log.js',
  './js/auth.js',
  './js/bt-bridge.js',
  /* ── Icons ── */
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/* ── CDN libraries — cached on first use ── */
const CDN_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* ── Supabase API — always network, never cache ── */
const NETWORK_ONLY_ORIGINS = [
  '.supabase.co',
];

/* ────────────────────────────────────────────────
   INSTALL — pre-cache the entire app shell
   ──────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to cache:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ────────────────────────────────────────────────
   ACTIVATE — delete old caches
   ──────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ────────────────────────────────────────────────
   FETCH — routing strategy
   ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  /* Supabase (http + realtime websocket) — always network */
  if (NETWORK_ONLY_ORIGINS.some(o => request.url.includes(o))) return;

  /* CDN fonts/libraries — stale while revalidate */
  if (CDN_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* App shell — network first (gets update), falls back to cache offline */
  event.respondWith(networkFirst(request));
});

/* ── Strategy helpers ──
   Timeout is adaptive: a flat 5s was too aggressive on mobile —
   reconnecting after a WiFi↔cellular handoff involves a cold DNS +
   TLS handshake that can legitimately take longer than that on a
   weak signal, and 5s was misreporting "offline" for what was
   really just "slow". navigator.connection isn't available on iOS
   Safari, so DEFAULT_TIMEOUT_MS covers that case; where the API
   *is* available (Chrome/Android), we tighten or loosen based on
   the reported connection type. ── */
const DEFAULT_TIMEOUT_MS  = 12000; /* iOS Safari and any browser without the Network Information API */
const FAST_TIMEOUT_MS     = 6000;  /* wifi / ethernet / 4g */
const SLOW_TIMEOUT_MS     = 20000; /* 2g / slow-2g / 3g */

function currentTimeoutMs() {
  const conn = self.navigator?.connection;
  if(!conn?.effectiveType) return DEFAULT_TIMEOUT_MS;
  return (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.effectiveType === '3g')
    ? SLOW_TIMEOUT_MS
    : FAST_TIMEOUT_MS;
}

function fetchWithTimeout(request, timeoutMs = currentTimeoutMs()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function networkFirst(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline — open the app while connected first.', {
      status: 503, statusText: 'Service Unavailable'
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetchWithTimeout(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/* ────────────────────────────────────────────────
   MESSAGE — commands from the app
   ──────────────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();

  if (event.data === 'CACHE_CLEAR') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => event.source.postMessage('CACHE_CLEARED'));
  }
});
