/* ═══════════════════════════════════════════════════════════════
   Pharma Plus Closing App — Service Worker  v3.1
   Strategy: Cache-first for app shell.
   Dropbox API calls always go to network (never cached).
═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'pharmpos-closing-v3.1';

/* ── App Shell — all files that make the app work offline ── */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  /* ── CSS ── */
  './css/main.css',
  './css/closing-book.css',
  /* ── JS — load order matters (matches index.html) ── */
  './js/state.js',
  './js/repository.js',
  './js/actions.js',
  './js/components.js',
  './js/pages.js',
  './js/ledger-nav.js',
  './js/closing-book.js',
  './js/sync.js',
];

/* ── Skip waiting, activate immediately ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e)))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  /* Always go to network for Dropbox API */
  if (url.includes('api.dropboxapi.com') || url.includes('content.dropboxapi.com') || url.includes('api.dropbox.com')) {
    event.respondWith(fetch(event.request));
    return;
  }
  /* Cache-first for everything else */
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
