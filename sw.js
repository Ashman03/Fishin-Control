/* Fishin' Control service worker.
 *
 * App files (HTML, JS, CSS) are network-first, so a deploy shows up the next
 * time the app opens with signal, and the cached copy is the fallback with
 * none. Icons are cache-first; they never change without a version bump.
 *
 * Forecast responses are network-first and never served from cache while the
 * service answers properly. Each good response is stored with the time it was saved;
 * when the network fails, or the service refuses (busy, rate-limited, down),
 * the stored copy is returned marked x-fc-cached: 1 with the reason,
 * and the app shows a "Saved forecast — not live" warning instead of
 * presenting it as current.
 *
 * Go-day alerts: on a periodic background sync the worker runs the same
 * forecast model the page uses, with the user's limits (shared via Cache
 * Storage), and notifies for any day that has newly turned green. It is a
 * module worker, registered with { type: 'module' }, so it imports the model
 * rather than duplicating it.
 *
 * Bump VERSION whenever the list of app files changes.
 */
import { getData } from './data.js';
import { build } from './model.js';
import { goDays, newlyGo, alertText, readShared, writeShared, SYNC_TAG, STATE_CACHE } from './alerts.js';

const VERSION = 'v4.7';
const SHELL = 'fishin-shell-' + VERSION;
const DATA = 'fishin-data-' + VERSION;

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
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== SHELL && k !== DATA && k !== STATE_CACHE).map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Return a saved forecast, marked so the app can never present it as live. */
async function savedCopy(request, reason) {
  const hit = await caches.match(request);
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('x-fc-cached', '1');
  headers.set('x-fc-reason', reason);
  return new Response(await hit.blob(), { status: 200, statusText: 'OK', headers });
}

async function forecast(request) {
  let res;
  try {
    res = await fetch(request);
  } catch (err) {
    const saved = await savedCopy(request, 'no connection');
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
    caches.open(DATA).then(c => c.put(request, copy));
    return res;
  }
  // busy, rate-limited or down: the last good forecast beats sample data
  const reason = res.status === 429 ? 'service busy' : 'service error ' + res.status;
  return (await savedCopy(request, reason)) || res;
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

/* ── Go-day alerts ──────────────────────────────────────────────────────── */

async function checkForGoDays() {
  const ctx = await readShared('context');
  if (!ctx || !ctx.alertsOn) return { checked: false };
  const raw = await getData();
  if (raw.cached) return { checked: false }; // never alert from a saved copy
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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (all.length) return all[0].focus();
      return self.clients.openWindow('./');
    })()
  );
});
