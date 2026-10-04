/**
 * util.js — small pure helpers. No DOM, no state, no network.
 */

export const pad = n => String(n).padStart(2, '0');
export const hhmm = d => (d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '—');
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** 0 at a, 1 at b, clamped. */
export const lerp = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const max = a => (a.length ? Math.max(...a) : 0);
export const min = a => (a.length ? Math.min(...a) : 0);
export const HOUR = 36e5;
export const DAY = 864e5;

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW'
];
export const dirOf = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** True if a compass bearing falls inside an arc [from, to], wrapping through north. */
export const inArc = (deg, [a, b]) => {
  const d = ((deg % 360) + 360) % 360;
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
};

/** Smallest angle between two bearings, 0–180. */
export const angDiff = (a, b) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/**
 * Mean of compass bearings. An arithmetic mean is wrong for angles:
 * 350° and 10° average to 180° (a southerly) when the answer is 0° (north).
 * Weighting by speed means a gusty 15 kn spell outvotes a 2 kn lull.
 */
export function circularMean(degrees, weights) {
  let x = 0,
    y = 0;
  degrees.forEach((d, i) => {
    const w = weights ? weights[i] : 1,
      r = (d * Math.PI) / 180;
    x += w * Math.cos(r);
    y += w * Math.sin(r);
  });
  if (x === 0 && y === 0) return 0;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Traffic-light colour and class key for a 0–100 score. */
export const light = s => (s >= 70 ? 'var(--go)' : s >= 48 ? 'var(--mid)' : 'var(--no)');
export const lightKey = s => (s >= 70 ? 'g' : s >= 48 ? 'a' : 'r');

/**
 * Parse "2026-10-04T05:00" as local wall-clock time. The API already returns
 * Queensland local time, so this must not go through Date(string), which
 * would treat it as UTC on some engines.
 */
export function localDate(iso) {
  const [d, t = '00:00'] = iso.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, m] = t.split(':').map(Number);
  return new Date(Y, M - 1, D, h, m || 0);
}

/** YYYY-MM-DD for a Date, in local time. */
export const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

/** Escape for both text nodes and attribute values — quotes included. */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC[c]);

/**
 * Read a variable from an Open-Meteo hourly block that may or may not carry a
 * model suffix. A single-model request returns "wind_speed_10m"; a renamed or
 * multi-model request returns "wind_speed_10m_<model>". Never matches a
 * different variable that merely shares a prefix (wind_speed_10m vs
 * wind_speed_100m) because the suffix must start with "_" plus a letter.
 */
export function pickVar(block, name) {
  if (!block) return null;
  if (Array.isArray(block[name])) return block[name];
  const key = Object.keys(block).find(
    k =>
      k.startsWith(name + '_') &&
      /^[a-z]/.test(k.slice(name.length + 1)) &&
      !/^member\d/.test(k.slice(name.length + 1))
  );
  return key ? block[key] : null;
}

/** "0.6–0.9" or just "0.7" when both ends round the same. */
export function span(lo, hi, dp = 1) {
  const a = lo.toFixed(dp),
    b = hi.toFixed(dp);
  return a === b ? a : a + '–' + b;
}

/** True if an array holds at least one real number. */
export const hasData = a => Array.isArray(a) && a.some(v => v != null);
