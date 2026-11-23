/* NetSight service worker — app shell + runtime cache, offline first */

const VERSION = 'netsight-v11';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
  './',
  './index.html',
  './inspector.html',
  './admin.html',
  './manifest.webmanifest',
  './css/style.css',
  './assets/netsight-logo.svg',
  './js/config.js',
  './js/theme.js',
  './js/status.js',
  './js/location.js',
  './js/registry.js',
  './js/map.js',
  './js/ui.js',
  './js/detection.js',
  './js/store.js',
  './js/app.js',
  './reset.html',
  './js/inspector.js',
  './js/admin.js',
  './data/registry.csv',
  './DETECT.md'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache the detection endpoint or API calls
  if (url.pathname.includes('/.netlify/functions/') || url.pathname.startsWith('/api/')) return;

  // Same-origin: stale-while-revalidate
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request)
          .then(response => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then(c => c.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin tiles/assets: cache-first with network fallback
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.status === 200 && url.hostname.endsWith('openstreetmap.org')) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(request, copy));
      }
      return response;
    }).catch(() => cached))
  );
});












