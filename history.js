/**
 * history.js — the past conditions behind the History tab: how a day is boiled
 * down for storage, how the stored file is read back, and the week, month and
 * year sums. Pure; used by the page and by tools/history.js, which builds the
 * files once a day on GitHub.
 *
 * Why the files are built on GitHub rather than on the phone: three years of
 * hourly forecasts for the app's twenty sample points is tens of megabytes and
 * thousands of Open-Meteo calls. Built once a day by tools/history.js with
 * the app's own model, the phone downloads only the results:
 *
 *   summary.json      one row of whole numbers per day, about 110 KB for three
 *                     years; fetched when the History tab opens
 *   hours/YYYY-MM.json  each ramp's 24 hours for every day of one month,
 *                     about 45 KB; fetched only when a day is opened
 *
 * Both live on the repository's `history-data` branch, never on main, so the
 * daily update never touches the live site. Nothing older than HISTORY_YEARS
 * is kept, there or on the phone.
 *
 * Every past day is judged by the standard limits (DEFAULTS) with no catch-log
 * nudge, so a day reads the same whatever the phone's settings, and years can
 * be compared fairly.
 */
import { ZONES, DEFAULTS } from './config.js';
import { localDate, isoDay, pad, mean, LINES, DAY, HOUR } from './util.js';

export const HISTORY_YEARS = 3;
export const HISTORY_FORMAT = 1;
export const HISTORY_BRANCH = 'history-data';
export const HISTORY_BASE = `https://raw.githubusercontent.com/Ashman03/Fishin-Control/${HISTORY_BRANCH}/`;
export const summaryUrl = () => HISTORY_BASE + 'summary.json';
export const hoursUrl = ym => HISTORY_BASE + 'hours/' + ym + '.json';

/** The forecast's own lines: Go at or above the first, red below the second. */
export const GO_LINE = LINES.ocean[0];
export const AMBER_LINE = LINES.ocean[1];

/** What each stored day row holds, in order. Scaled values are whole numbers. */
export const DAY_COLS = [
  'overall', // daily score
  'river', // rivers and creeks score
  'bite', // bite score
  'best', // index into ZONES of the best ramp
  'moon', // moon phase × 100 (0 new, 50 full)
  'range', // tide range, cm
  'rain', // rain at the reference ramp, mm × 10
  'sst', // water temperature, °C × 10
  'wdir', // best ramp: wind direction, degrees
  'period', // best ramp: shortest swell period, s
  'swell' // best ramp: lowest swell, cm
];
/**
 * Then, for each ramp in ZONES order: its launch score, longest launch window
 * (hours × 10), average wind and strongest gust over the fishing hours (kn),
 * and highest swell (cm).
 */
export const RAMP_COLS = ['score', 'win', 'wind', 'gust', 'swellMax'];

const r = (v, k = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * k));

/** Days between two YYYY-MM-DD dates (b − a). */
export const daysBetween = (a, b) => Math.round((localDate(b) - localDate(a)) / DAY);
/** The YYYY-MM-DD `n` days after `ds`. */
export const addDays = (ds, n) => isoDay(new Date(+localDate(ds) + n * DAY + 12 * HOUR));

/** The first day kept: HISTORY_YEARS back from `last`, so at most that many years are stored. */
export function firstKept(last) {
  const d = localDate(last);
  return addDays(isoDay(new Date(d.getFullYear() - HISTORY_YEARS, d.getMonth(), d.getDate())), 1);
}

/** One built day (model.build) boiled down to a row of whole numbers. */
export function summariseDay(d) {
  const best = d.zones[0];
  const ramps = ZONES.flatMap(z => {
    const zone = d.zones.find(x => x.z.id === z.id);
    const longest = zone && zone.win.length ? Math.max(...zone.win.map(w => w.hrs)) : 0;
    return zone
      ? [zone.score, r(longest, 10), r(zone.wind), r(zone.gust), r(zone.swellMax, 100)]
      : RAMP_COLS.map(() => null);
  });
  return [
    d.overall,
    d.river,
    d.bite,
    ZONES.findIndex(z => z.id === best.z.id),
    r(d.moon.phase, 100),
    r(d.range, 100),
    r(d.rain, 10),
    r(d.sst, 10),
    r(best.wdir),
    r(best.period),
    r(best.swell, 100),
    ...ramps
  ];
}

/** "HH:MM" from a Date, in local time. */
const hm = t => pad(t.getHours()) + ':' + pad(t.getMinutes());
/** Minutes after midnight of `d0`. */
const mins = (t, d0) => Math.round((t - d0) / 6e4);

/**
 * One built day's hours for the Day view: each ramp's 24 hours of wind, gust
 * and the swell figure checked against the limit, plus a flag per hour
 * (1 inside the limits, + 2 × the storm level forecast for that hour), and its
 * launch windows as minutes after midnight.
 */
export function dayHours(d) {
  return {
    sr: hm(d.sunrise),
    ss: hm(d.sunset),
    tides: d.tides.map(t => [hm(t.t), r(t.v, 100), t.hi ? 1 : 0]),
    z: ZONES.map(z => {
      const zone = d.zones.find(x => x.z.id === z.id);
      if (!zone) return null;
      const at = k => zone.hours.find(h => +h.t === +d.d0 + k * HOUR);
      const hrs = Array.from({ length: 24 }, (_, k) => at(k));
      const col = f => hrs.map(h => (h ? f(h) : null));
      return [
        col(h => r(h.wind)),
        col(h => r(h.gust)),
        col(h => r(h.swellChk, 100)),
        col(h => (h.z.ok ? 1 : 0) + 2 * (h.stormNow || 0)),
        zone.win.map(w => [mins(w.a, d.d0), mins(w.b, d.d0)])
      ];
    })
  };
}

/* ── Reading the stored files ─────────────────────────────────────────── */

/* The files come over the network, so every value is coerced back to what the
   page expects: a number or null, a time as HH:MM. A damaged file can leave a
   gap, but can neither break a render nor smuggle markup in. */
const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const arr = v => (Array.isArray(v) ? v : []);
const clock = v => (/^\d\d:\d\d$/.test(v) ? v : null);

/**
 * The stored summary as day objects, oldest first. A row that is missing or
 * the wrong length (a damaged file, or a newer format) is left out rather than
 * misread: a gap in history beats a wrong day.
 */
export function readSummary(json) {
  if (
    !json ||
    json.v !== HISTORY_FORMAT ||
    !Array.isArray(json.days) ||
    !/^\d{4}-\d\d-\d\d$/.test(json.first)
  )
    return null;
  const width = DAY_COLS.length + RAMP_COLS.length * ZONES.length;
  const days = [];
  json.days.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== width) return;
    const ds = addDays(json.first, i);
    const o = { ds, d0: localDate(ds) };
    DAY_COLS.forEach((k, j) => (o[k] = num(row[j])));
    o.ramps = ZONES.map((z, zi) => {
      const at = DAY_COLS.length + zi * RAMP_COLS.length;
      const x = { id: z.id };
      RAMP_COLS.forEach((k, j) => (x[k] = num(row[at + j])));
      x.win = (x.win || 0) / 10;
      return x;
    });
    // a day without its scores or figures is left out rather than drawn wrong
    const must = [o.overall, o.river, o.bite, o.moon, o.rain, o.swell];
    if (must.some(v => v == null) || o.ramps.some(x => [x.score, x.wind, x.gust, x.swellMax].includes(null)))
      return;
    o.bestId = (ZONES[o.best] || ZONES[0]).id;
    // the best ramp's figures, as the day's own
    const b = o.ramps.find(x => x.id === o.bestId);
    Object.assign(o, { wind: b.wind, gust: b.gust, swellMax: b.swellMax });
    days.push(o);
  });
  return { days };
}

/**
 * New rows merged into a stored summary: later rows replace earlier ones for
 * the same day, and anything before firstKept(last day) is dropped.
 * `rows` is a Map of YYYY-MM-DD → row. Returns the file to write.
 */
export function mergeSummary(json, rows, made) {
  const all = new Map();
  if (json && json.v === HISTORY_FORMAT && Array.isArray(json.days))
    json.days.forEach((row, i) => row && all.set(addDays(json.first, i), row));
  for (const [ds, row] of rows) all.set(ds, row);
  const dates = [...all.keys()].sort();
  if (!dates.length) return { v: HISTORY_FORMAT, made, limits: DEFAULTS, first: null, days: [] };
  const last = dates[dates.length - 1];
  const first = dates.find(ds => ds >= firstKept(last));
  const n = daysBetween(first, last) + 1;
  return {
    v: HISTORY_FORMAT,
    made,
    limits: DEFAULTS,
    first,
    days: Array.from({ length: n }, (_, i) => all.get(addDays(first, i)) || null)
  };
}

/** Months (YYYY-MM) whose hours files fall wholly before the first kept day. */
export const staleMonths = (months, first) => months.filter(ym => ym < first.slice(0, 7));

/* ── Week, month and year sums ────────────────────────────────────────── */

/** The score for a day: the daily score, or one ramp's launch score. */
export const scoreOf = (d, rampId) => (rampId ? (d.ramps.find(x => x.id === rampId) || {}).score : d.overall);

/** The figures for one ramp on a day: the ramp chosen, or the day's best ramp. */
export const rampOf = (d, rampId) => d.ramps.find(x => x.id === (rampId || d.bestId)) || d.ramps[0];

/** Hours of the longest launch window: at the day's best ramp, or the ramp chosen. */
export const windowOf = (d, rampId) => rampOf(d, rampId).win || 0;

/** The Monday on or before `ds`, as YYYY-MM-DD. */
export function weekStart(ds) {
  const dow = (localDate(ds).getDay() + 6) % 7; // Monday 0
  return addDays(ds, -dow);
}

/**
 * Totals for a run of days: Go days, days with a launch window, the average
 * score, and the best day. `rampId` (optional) judges one ramp instead of the
 * best ramp each day.
 */
export function tally(days, rampId) {
  const scored = days.filter(d => scoreOf(d, rampId) != null);
  const scores = scored.map(d => scoreOf(d, rampId));
  const best = scored.reduce((a, d) => (!a || scoreOf(d, rampId) > scoreOf(a, rampId) ? d : a), null);
  const go = scores.filter(s => s >= GO_LINE).length;
  const amber = scores.filter(s => s < GO_LINE && s >= AMBER_LINE).length;
  return {
    n: scored.length,
    go,
    amber,
    red: scored.length - go - amber,
    windows: scored.filter(d => windowOf(d, rampId) > 0).length,
    avg: scores.length ? Math.round(mean(scores)) : null,
    best
  };
}

/** Days falling in one month (YYYY-MM). */
export const monthDays = (days, ym) => days.filter(d => d.ds.startsWith(ym));

/** Twelve monthly tallies for one calendar year. */
export const yearMonths = (days, year, rampId) =>
  Array.from({ length: 12 }, (_, m) => {
    const ym = year + '-' + pad(m + 1);
    return { ym, ...tally(monthDays(days, ym), rampId) };
  });

/**
 * The stored hours for one ramp on one day, shaped like the model's zone hours
 * so the forecast's conditions chart can draw them. Null when not stored.
 */
export function rampHours(month, ds, zi) {
  const day = month && month.days && month.days[ds];
  const z = day && Array.isArray(day.z) && day.z[zi];
  if (!Array.isArray(z)) return null;
  const [wind, gust, swell, flag, win] = z.map(arr);
  const d0 = localDate(ds);
  const hours = [];
  for (let k = 0; k < 24; k++) {
    if (num(wind[k]) == null || num(gust[k]) == null) continue;
    const f = num(flag[k]) || 0;
    hours.push({
      t: new Date(+d0 + k * HOUR),
      wind: num(wind[k]),
      gust: num(gust[k]),
      swellChk: (num(swell[k]) || 0) / 100,
      stormNow: (f >> 1) & 3,
      z: { ok: (f & 1) === 1 }
    });
  }
  if (!hours.length) return null;
  return {
    hours,
    win: win
      .filter(w => Array.isArray(w) && num(w[0]) != null && num(w[1]) != null)
      .map(([a, b]) => ({ a: new Date(+d0 + a * 6e4), b: new Date(+d0 + b * 6e4) }))
  };
}

/** Sunrise, sunset and the tide turns stored for a day, checked; null when not stored. */
export function dayTides(month, ds) {
  const day = month && month.days && month.days[ds];
  if (!day) return null;
  return {
    sr: clock(day.sr),
    ss: clock(day.ss),
    tides: arr(day.tides)
      .filter(t => Array.isArray(t) && clock(t[0]) && num(t[1]) != null)
      .map(([t, v, hi]) => ({ t, v: num(v) / 100, hi: !!hi }))
  };
}
