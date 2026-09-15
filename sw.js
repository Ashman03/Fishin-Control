/* Fishin' Control service worker.
   Shell (page + icons) is cached so the app opens instantly and works with no
   signal. Forecast data is NEVER served from cache — a stale forecast is worse
   than no forecast — but the last successful response is kept so the app can
   show something, clearly marked as old, when you are out of range. */
const SHELL = 'fishin-shell-v1';
const DATA  = 'fishin-data-v1';
const FILES = ['./', './index.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png', './icon-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isForecast = url.hostname.endsWith('open-meteo.com');

  if (isForecast) {
    // network first, fall back to the last copy we saw
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(DATA).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // The page itself is network-first so a redeploy shows up next time you open
  // the app, with the cached copy as the fallback when there is no signal.
  const isPage = e.request.mode === 'navigate' || url.pathname.endsWith('.html') ||
                 url.pathname.endsWith('/') || url.pathname.endsWith('.webmanifest');

  if (isPage) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // icons and anything else: cache-first, they never change
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(e.request, copy));
      return res;
    }))
  );
});
