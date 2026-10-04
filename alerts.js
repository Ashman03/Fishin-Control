/**
 * alerts.js — "a day just turned green" detection, shared by the page and the
 * service worker.
 *
 * There is no server, so alerts rely on Periodic Background Sync: an
 * installed web app on Android Chrome may wake its service worker
 * periodically (the browser decides when; typically every several hours).
 * The worker re-runs the forecast with the user's limits and notifies for
 * any day that is newly green. The page does the same check on every open,
 * so nothing is missed on browsers without background sync.
 *
 * Shared state lives in Cache Storage (readable by both page and worker,
 * unlike localStorage), in a cache whose name never changes between versions.
 */
import { hhmm } from './util.js';

export const GO_SCORE = 70; // the green threshold used everywhere else
export const SYNC_TAG = 'fc-go-check';
export const SYNC_INTERVAL_MS = 6 * 36e5;
export const STATE_CACHE = 'fishin-state';

/** Days scoring green, with what an alert needs to say about them. */
export function goDays(days) {
  return days
    .filter(d => !d.past && d.overall >= GO_SCORE)
    .map(d => {
      const z = d.zones[0];
      const w = z.win[0];
      return {
        ds: d.ds,
        score: d.overall,
        ramp: z.z.name,
        from: w ? hhmm(w.a) : null,
        to: w ? hhmm(w.b) : null
      };
    });
}

/** Go days in `now` that were not go days in `seen`. A first run (no history) alerts nothing. */
export function newlyGo(seen, now) {
  if (!Array.isArray(seen)) return [];
  const before = new Set(seen.map(x => x.ds));
  return now.filter(x => !before.has(x.ds));
}

export function alertText(d) {
  const when = new Date(d.ds + 'T12:00').toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  });
  return {
    title: 'Go for launch — ' + when,
    body: d.ramp + ' scores ' + d.score + (d.from ? ', window ' + d.from + '–' + d.to : '') + '. Tap to plan.'
  };
}

/* ── shared state in Cache Storage ──────────────────────────────────────── */

const keyUrl = key => new URL('./__fc/' + key, self.location.href).href;

export async function readShared(key) {
  try {
    const c = await caches.open(STATE_CACHE);
    const r = await c.match(keyUrl(key));
    return r ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

export async function writeShared(key, value) {
  try {
    const c = await caches.open(STATE_CACHE);
    await c.put(
      keyUrl(key),
      new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    );
  } catch (e) {
    /* storage unavailable: alerts simply do not persist */
  }
}
