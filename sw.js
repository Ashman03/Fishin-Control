/* Fishin' Control service worker.
 *
 * App files (HTML, JS, CSS) are network-first, so a deploy shows up the next
 * time the app opens with signal, and the cached copy is the fallback with
 * none. Icons are cache-first; they never change without a version bump.
 *
 * Forecast responses are network-first and never served from cache while the
 * network works. Each good response is stored with the time it was saved;
 * when the network fails the stored copy is returned marked x-fc-cached: 1,
 * and the app shows a "Saved forecast — not live" warning instead of
 * presenting it as current.
 *
 * Bump VERSION whenever the list of app files changes.
 */
const VERSION = 'v4.0';
const SHELL = 'fishin-shell-' + VERSION;
const DATA = 'fishin-data-' + VERSION;

const APP_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.json',
  './js/app.js',
  './js/config.js',
  './js/util.js',
  './js/astro.js',
  './js/store.js',
  './js/data.js',
  './js/model.js',
  './js/advice.js',
  './js/ui.js',
  './js/map.js',
  './js/art.js',
  './icon-64.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then(c => c.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function forecast(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('x-fc-saved-at', String(Date.now()));
      const copy = new Response(await res.clone().blob(), {
        status: res.status,
        statusText: res.statusText,
        headers
      });
      caches.open(DATA).then(c => c.put(request, copy));
    }
    return res;
  } catch (err) {
    const hit = await caches.match(request);
    if (!hit) throw err;
    const headers = new Headers(hit.headers);
    headers.set('x-fc-cached', '1');
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
  }
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) caches.open(SHELL).then(c => c.put(request, res.clone()));
    return res;
  } catch (err) {
    return (await caches.match(request)) || (await caches.match('./index.html'));
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) caches.open(SHELL).then(c => c.put(request, res.clone()));
  return res;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('open-meteo.com')) {
    e.respondWith(forecast(e.request));
    return;
  }
  if (url.origin !== self.location.origin) return; // fonts etc: browser default
  if (/\.(png|svg|ico)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  e.respondWith(networkFirst(e.request));
});
