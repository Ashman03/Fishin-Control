/* Fishin' Control service worker.
 *
 * App files (HTML, JS, CSS) are network-first, so a deploy shows up the next
 * time the app opens with signal, and the cached copy is the fallback with
 * none. Images and fonts are cache-first; they never change without a version
 * bump, which replaces the whole app cache.
 *
 * Forecast responses are network-first and never served from cache while the
 * service answers properly. Each good response is stored with the time it was
 * saved; when the network fails, or the service refuses (busy, rate-limited,
 * down), the stored copy is returned marked x-fc-cached: 1 with the reason,
 * and the app shows a "Saved forecast — not live" warning instead of
 * presenting it as current. That store is not versioned, so an app update
 * does not throw away the last good forecast.
 *
 * Go-day alerts: on a periodic background sync the worker runs the same
 * forecast model the page uses, with the user's limits (shared via Cache
 * Storage), and notifies for any day that newly turns Go (75 or more). It is a
 * module worker, registered with { type: 'module' }, so it imports the model
 * rather than duplicating it.
 *
 * Bump VERSION (with APP_VERSION in config.js) on every release.
 */
import { getData } from './data.js';
import { build } from './model.js';
import {
  goDays,
  newlyGo,
  alertText,
  canAlert,
  readShared,
  writeShared,
  SYNC_TAG,
  STATE_CACHE
} from './alerts.js';

const VERSION = 'v6.0.5';
const SHELL = 'fishin-shell-' + VERSION;
const DATA = 'fishin-data';

/* The large install icons (512 and maskable) are left out: only the browser's
   installer reads them, straight from the site. */
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './app.js',
  './config.js',
  './util.js',
  './astro.js',
  './store.js',
  './data.js',
  './alerts.js',
  './closures.js',
  './model.js',
  './advice.js',
  './ui.js',
  './map.js',
  './art.js',
  './importer.js',
  './font-outfit.woff2',
  './font-space-grotesk.woff2',
  './logo-128.webp',
  './logo-448.webp',
  './icon-64.png',
  './icon-192.png',
  // species illustrations (~0.5 MB in all), stored so the cards work offline
  './species-barramundi.webp',
  './species-blackall.webp',
  './species-blue-salmon.webp',
  './species-bream.webp',
  './species-coral-trout.webp',
  './species-flathead.webp',
  './species-grass-sweetlip.webp',
  './species-grunter.webp',
  './species-longtail-tuna.webp',
  './species-mac-tuna.webp',
  './species-mangrove-jack.webp',
  './species-mud-crab.webp',
  './species-red-emperor.webp',
  './species-school-mackerel.webp',
  './species-snapper.webp',
  './species-spanish-mackerel.webp',
  './species-spotted-mackerel.webp',
  './species-squid.webp',
  './species-threadfin.webp',
  './species-tuskfish.webp',
  './species-whiting.webp'
];

const CACHE_FIRST = /\.(png|webp|svg|ico|woff2)$/;

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, which GitHub Pages fills
  // for ten minutes; without it a fresh install could store the old files.
  e.waitUntil(
    caches
      .open(SHELL)
      .then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    (async () => {
      const keep = new Set([SHELL, DATA, STATE_CACHE]);
      await Promise.all((await caches.keys()).filter(k => !keep.has(k)).map(k => caches.delete(k)));
      // start the page request while the worker boots, rather than after
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

/** Return a saved forecast, marked so the app can never present it as live. */
async function savedCopy(request, reason) {
  const hit = await caches.match(request, { cacheName: DATA });
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('x-fc-cached', '1');
  headers.set('x-fc-reason', reason);
  return new Response(await hit.blob(), { status: 200, statusText: 'OK', headers });
}

async function forecast(e) {
  let res;
  try {
    res = await fetch(e.request);
  } catch (err) {
    const saved = await savedCopy(e.request, 'no connection');
    if (saved) return saved;
    throw err;
  }
  if (res.ok) {
    const headers = new Headers(res.headers);
    headers.set('x-fc-saved-at', String(Date.now()));
    const copy = new Response(await res.clone().blob(), {
      status: res.status,
      statusText: res.statusText,
      headers
    });
    e.waitUntil(caches.open(DATA).then(c => c.put(e.request, copy)));
    return res;
  }
  // busy, rate-limited or down: the last good forecast beats sample data
  const reason = res.status === 429 ? 'service busy' : 'service error ' + res.status;
  return (await savedCopy(e.request, reason)) || res;
}

async function networkFirst(e) {
  try {
    const res = (await e.preloadResponse) || (await fetch(e.request));
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(caches.open(SHELL).then(c => c.put(e.request, copy)));
    }
    return res;
  } catch (err) {
    const nav = e.request.mode === 'navigate';
    return (
      (await caches.match(e.request, { ignoreSearch: nav })) ||
      (nav ? await caches.match('./index.html') : Response.error())
    );
  }
}

async function cacheFirst(e) {
  const hit = await caches.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok) {
    const copy = res.clone();
    e.waitUntil(caches.open(SHELL).then(c => c.put(e.request, copy)));
  }
  return res;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('open-meteo.com')) return e.respondWith(forecast(e));
  if (url.origin !== self.location.origin) return;
  e.respondWith(CACHE_FIRST.test(url.pathname) ? cacheFirst(e) : networkFirst(e));
});

/* ── Go-day alerts ──────────────────────────────────────────────────────── */

async function checkForGoDays() {
  const ctx = await readShared('context');
  if (!ctx || !ctx.alertsOn) return { checked: false };
  const raw = await getData();
  if (!canAlert(raw)) return { checked: false }; // never from a saved copy or an incomplete forecast
  const { days } = build(raw, { cfg: ctx.cfg, log: ctx.log || [] });
  const now = goDays(days);
  const fresh = newlyGo(await readShared('seen'), now);
  await writeShared('seen', now);
  for (const d of fresh.slice(0, 3)) {
    const { title, body } = alertText(d);
    await self.registration.showNotification(title, {
      body,
      tag: 'go-' + d.ds,
      icon: 'icon-192.png',
      badge: 'icon-64.png',
      data: { ds: d.ds }
    });
  }
  return { checked: true, fresh: fresh.length };
}

self.addEventListener('periodicsync', e => {
  if (e.tag === SYNC_TAG)
    e.waitUntil(checkForGoDays().catch(err => console.warn('[sw] go check failed', err)));
});

// the page can ask for a check now (and a test notification) without waiting for the browser
self.addEventListener('message', e => {
  const reply = msg => e.source && e.source.postMessage(msg);
  if (e.data === 'go-check') {
    e.waitUntil(
      checkForGoDays().then(
        r => reply({ type: 'go-check', ...r }),
        err => reply({ type: 'go-check', error: err.message })
      )
    );
  } else if (e.data === 'test-alert') {
    e.waitUntil(
      self.registration.showNotification("Fishin' Control", {
        body: 'Test alert — go-day alerts are working.',
        tag: 'test',
        icon: 'icon-192.png',
        badge: 'icon-64.png'
      })
    );
  }
});

// "Tap to plan": open the app on the day the alert was about
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ds = e.notification.data && e.notification.data.ds;
  e.waitUntil(
    (async () => {
      const [open] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (open) {
        await open.focus();
        if (ds) open.postMessage({ type: 'show-day', ds });
        return;
      }
      await self.clients.openWindow(ds ? './?day=' + ds : './');
    })()
  );
});
