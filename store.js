/**
 * store.js — application state and persistence.
 *
 * All mutable state lives in the one exported `state` object. Modules read it
 * and the action handlers in ui.js write it; nothing else holds state. That
 * makes "where did this value come from" a single search.
 *
 * Persistence is localStorage, wrapped as {v, data} so a future change of
 * shape can be migrated rather than silently misread. Corrupt values are
 * discarded with a console warning rather than thrown: losing one log entry
 * beats a blank screen.
 */
import { DEFAULTS, RATINGS } from './config.js';
import { writeShared } from './alerts.js';

export const state = {
  cfg: { ...DEFAULTS }, // the user's limits
  log: [], // the user's catch log
  raw: null, // last fetched payload (see data.js)
  days: [], // built forecast days, today onward (see model.js)
  past: [], // built days before today, used only for logging
  sel: 0, // selected day index into `days`
  zsel: null, // selected ramp id
  tab: 'plan', // 'plan' | 'history' | 'log'
  view: 'ocean', // Forecast tab: 'ocean' | 'river'
  logDraft: null, // unsaved log form values, kept across re-renders
  demo: false, // true when showing sample data
  loadError: null, // why the live forecast failed, shown on screen
  alerts: { on: false, mode: null }, // go-day alerts: mode is 'background' | 'open' | 'denied' | 'unsupported'
  freshGo: [], // days that turned green since the last look
  // the Flight log tab (history.js): what is showing, and what has loaded this session
  hist: {
    view: 'month', // 'day' | 'week' | 'month' | 'year'
    ds: null, // the day the view is built around (YYYY-MM-DD)
    ramp: '', // a ramp id, or '' for the best ramp each day
    status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
    data: null, // readSummary() of summary.json, plus byDs
    error: null,
    cached: false, // the phone's saved copy, not a fresh one
    first: null,
    last: null,
    at: 0, // when the summary was fetched
    months: {} // YYYY-MM → hours file, 'loading' or 'error'
  },
  loadSeq: 0 // guards against an older refresh overwriting a newer one
};

const STORE_VERSION = 1;
const PREFIX = 'fishin-';
const LEGACY_PREFIX = 'bundy-'; // keys written before the rename, read once

function parse(key, raw) {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && 'v' in p) return p.v === STORE_VERSION ? p.data : migrate(key, p);
    return p; // pre-versioning payload
  } catch (e) {
    console.warn('[store] discarding unreadable value for', key, e);
    return null;
  }
}

/** Add migrations here as { fromVersion: fn } when the stored shape changes. */
function migrate(key, payload) {
  console.warn('[store] no migration for', key, 'version', payload.v);
  return payload.data;
}

/** Delete a stored value, under the current name and the old one. */
function forget(key) {
  try {
    localStorage.removeItem(PREFIX + key);
    localStorage.removeItem(LEGACY_PREFIX + key);
  } catch (e) {
    /* storage disabled or private mode */
  }
}

function read(key) {
  try {
    const v = localStorage.getItem(PREFIX + key) ?? localStorage.getItem(LEGACY_PREFIX + key);
    return v == null ? null : parse(key, v);
  } catch (e) {
    return null; // storage disabled or private mode
  }
}

/**
 * The background worker cannot read localStorage, so whatever it needs to
 * score days the user's way (limits, catch log, alert switch) is mirrored
 * into shared Cache Storage whenever it changes.
 */
export function shareContext() {
  return writeShared('context', { cfg: state.cfg, log: state.log, alertsOn: !!state.alerts.on });
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: STORE_VERSION, data: value }));
    if (['limits', 'log', 'alerts'].includes(key)) shareContext();
    return true;
  } catch (e) {
    console.warn('[store] could not save', key, e);
    return false;
  }
}

/** Range-checks the user's limits; out-of-range values fall back to defaults. */
export function validLimits(o) {
  if (!o || typeof o !== 'object') return null;
  const n = (x, lo, hi, d) => (Number.isFinite(+x) && +x >= lo && +x <= hi ? +x : d);
  return {
    maxSwell: n(o.maxSwell, 0.1, 6, DEFAULTS.maxSwell),
    maxWind: n(o.maxWind, 1, 60, DEFAULTS.maxWind),
    maxGust: n(o.maxGust, 1, 80, DEFAULTS.maxGust)
  };
}

/* Stored values are coerced back to the types the app expects, so a damaged
   or hand-edited entry can neither break a render nor smuggle markup in. */
const num = (v, lo, hi, d) =>
  v != null && v !== '' && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d;
const str = (v, len = 200) => (v == null ? '' : String(v).slice(0, len));

export function cleanLogEntry(x, i) {
  const { mark, ...rest } = x; // marks were retired for the Flight log; an old entry's mark name is dropped
  return {
    ...rest,
    id: str(x.id, 40) || 'e' + i,
    date: str(x.date, 10),
    ramp: str(x.ramp, 20),
    species: str(x.species),
    notes: str(x.notes, 500),
    rating: Math.round(num(x.rating, 0, RATINGS.length - 1, 2)),
    wind: num(x.wind, 0, 200, null),
    swell: num(x.swell, 0, 20, null),
    sea: num(x.sea, 0, 20, null),
    period: num(x.period, 0, 30, null),
    range: num(x.range, 0, 10, null)
  };
}

export function loadStored() {
  const lim = validLimits(read('limits'));
  if (lim) state.cfg = lim;
  forget('marks'); // the marks list was retired for the Flight log: free the space it took
  state.view = read('view') === 'river' ? 'river' : 'ocean';
  const a = read('alerts');
  if (a && typeof a === 'object') state.alerts = { on: !!a.on, mode: a.mode || null };
  const l = read('log');
  state.log = Array.isArray(l)
    ? l.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.ramp).map(cleanLogEntry)
    : [];
}
