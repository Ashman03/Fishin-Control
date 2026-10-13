/**
 * history.js — builds and tops up the History tab's files. Run once a day by
 * .github/workflows/history.yml, and by hand with
 *
 *   node tools/history.js --dir <folder> [--max-months 40] [--pause 12000]
 *                         [--report report.md] [--outputs $GITHUB_OUTPUT]
 *
 * <folder> holds the files from the `history-data` branch (empty the first
 * time). For every day from HISTORY_YEARS back to yesterday that is not yet
 * stored, plus the last REFRESH_DAYS again, it asks Open-Meteo's archive for
 * that day's hours at the app's twenty sample points, runs them through the
 * app's own model (model.build, standard limits, no catch log) and stores:
 *
 *   summary.json        one row per day (see history.js)
 *   hours/YYYY-MM.json  each ramp's hours, for the Day view
 *
 * Wind comes from the Historical Forecast API: the same best-match models the
 * forecast uses, archived as they ran. Swell, tide and currents come from the
 * Marine API, which reaches back the same way. Months are fetched newest first
 * with a pause between them, as Open-Meteo's free tier counts each place and
 * each fortnight as a call: the first run (three years) is about 3,500 calls,
 * under the hourly limit; each daily run after that is about 100.
 *
 * A day whose wind or swell came back with holes is left out, not stored as a
 * no-go, and retried for GAP_RETRY_DAYS; after that it stays a gap.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { POINTS, ZONES, TZ, DEFAULTS } from '../config.js';
import { attempt, FORECAST_VARS, MARINE_VARS } from '../data.js';
import { build } from '../model.js';
import { pickVar, hasData, isoDay, localDate, DAY } from '../util.js';
import {
  HISTORY_FORMAT,
  summariseDay,
  dayHours,
  mergeSummary,
  firstKept,
  addDays,
  daysBetween,
  staleMonths
} from '../history.js';

/** Days re-fetched every run: the archive firms up the last day or two. */
export const REFRESH_DAYS = 3;
/** How long a day with holes in its data is retried before it is left as a gap. */
export const GAP_RETRY_DAYS = 10;
/** Days fetched either side of the wanted ones: tide turns, the storm buffer and three-day rain need them. */
const MARGIN_BEFORE = 3,
  MARGIN_AFTER = 1;
/** Time for one archive request: a month at twenty points is a big answer. */
const REQUEST_MS = 60000;
/** A run stops starting months after this long, so it saves before the workflow's 40-minute limit. */
const BUDGET_MS = 30 * 60000;
/** The last stored day may lag yesterday by this much before the run is marked failed. */
const STALE_DAYS = 3;

const sleep = ms => new Promise(res => setTimeout(res, ms));
/** Progress lines on the workflow's log; quiet in the tests. */
let say = () => {};
const query = o =>
  Object.entries(o)
    .filter(([, v]) => v != null)
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
const where = () => ({
  latitude: POINTS.map(p => p.lat).join(','),
  longitude: POINTS.map(p => p.lon).join(',')
});

/** Archived wind, rain and storms for every sample point, `from` to `to` inclusive. */
export const pastWindUrl = (from, to, minimal = false) =>
  'https://historical-forecast-api.open-meteo.com/v1/forecast?' +
  query({
    ...where(),
    hourly: FORECAST_VARS,
    daily: 'sunrise,sunset',
    wind_speed_unit: 'kn',
    timezone: TZ,
    start_date: from,
    end_date: to,
    cell_selection: minimal ? null : 'sea'
  });

/** Archived swell, tide, currents and water temperature for every sample point. */
export const pastSwellUrl = (from, to) =>
  'https://marine-api.open-meteo.com/v1/marine?' +
  query({
    ...where(),
    hourly: MARINE_VARS,
    timezone: TZ,
    start_date: from,
    end_date: to,
    cell_selection: 'sea'
  });

const hasWind = sets =>
  Array.isArray(sets) &&
  sets.length === POINTS.length &&
  sets.some(o => hasData(pickVar(o.hourly, 'wind_speed_10m')));
const hasWaves = sets =>
  Array.isArray(sets) &&
  sets.some(
    o => hasData(pickVar(o.hourly, 'swell_wave_height')) || hasData(pickVar(o.hourly, 'wave_height'))
  );

/**
 * A request retried while the service is busy (429) or down; a refusal is
 * returned at once. A connection that never opened (status 0) is tried again
 * after a few seconds: on GitHub's runners the first request after a pause
 * often fails that way and the next one goes straight through.
 */
async function request(url, fetcher, { tries = 3, wait = 60000, quick = 3000 } = {}) {
  let res;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(res.status === 0 ? quick : wait * i);
    const t0 = Date.now();
    res = await fetcher(url);
    say(
      `  ${new URL(url).hostname.split('.')[0]}: ${res.ok ? 'ok' : res.status + ' ' + (res.error || '')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`
    );
    if (res.ok || (res.status !== 0 && res.status !== 429 && res.status < 500)) return res;
  }
  return res;
}

/**
 * Whether a built day has every figure the call depends on: wind and gusts at
 * every hour at every ramp (the model's gapHrs), and a full day of hours.
 */
const complete = d => d.zones.every(z => z.gapHrs === 0) && d.zones[0].hours.length >= 24;

/**
 * The dates with an hour that has no swell or wave height at any point of a
 * ramp. A missing swell figure reads as 0 m in the forecast by the owner's
 * choice; in history a hole in the archive would store a calm Go day, so such
 * a day is left out instead. A ramp with no swell anywhere in the fetch is
 * not held against it (the whole-feed check, hasWaves, covers an outage).
 */
export function swellHoles(sets, dates) {
  const holes = new Set();
  const want = new Set(dates);
  for (const z of ZONES) {
    const seen = new Map(); // time -> has a figure at some point of the ramp
    let any = false;
    for (const pi of z.pts) {
      const h = sets[pi] && sets[pi].hourly;
      if (!h || !Array.isArray(h.time)) continue;
      const sw = pickVar(h, 'swell_wave_height') || [],
        wv = pickVar(h, 'wave_height') || [];
      h.time.forEach((t, k) => {
        const ok = Number.isFinite(sw[k]) || Number.isFinite(wv[k]);
        if (ok) any = true;
        seen.set(t, seen.get(t) || ok);
      });
    }
    if (!any) continue;
    for (const ds of want)
      for (let hr = 0; hr < 24; hr++)
        if (!seen.get(ds + 'T' + String(hr).padStart(2, '0') + ':00')) {
          holes.add(ds);
          break;
        }
  }
  return holes;
}

/** The dates still to fetch, oldest first: missing, too recent to be final, or gaps still worth retrying. */
export function wanted(summary, yesterday) {
  const first = firstKept(yesterday);
  const have = new Set();
  if (summary && summary.first) summary.days.forEach((row, i) => row && have.add(addDays(summary.first, i)));
  const gaveUp = new Set(
    ((summary && summary.gaps) || []).filter(ds => daysBetween(ds, yesterday) > GAP_RETRY_DAYS)
  );
  const out = [];
  for (let ds = first; ds <= yesterday; ds = addDays(ds, 1)) {
    const recent = daysBetween(ds, yesterday) < REFRESH_DAYS;
    if (recent || (!have.has(ds) && !gaveUp.has(ds))) out.push(ds);
  }
  return out;
}

/** Group dates by month, newest month first. */
function byMonth(dates) {
  const m = new Map();
  for (const ds of dates) {
    const ym = ds.slice(0, 7);
    if (!m.has(ym)) m.set(ym, []);
    m.get(ym).push(ds);
  }
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch (e) {
    console.warn('[history] unreadable, starting afresh:', file, e.message);
    return fallback;
  }
};

/**
 * One month's wanted days: fetched, built with the app's model and boiled
 * down. Returns { rows: Map, hours: {ds: …}, gaps: [ds], error }.
 */
export async function fetchDays(
  dates,
  { fetcher = url => attempt(url, REQUEST_MS), wait = 60000, quick = 3000 } = {}
) {
  const from = addDays(dates[0], -MARGIN_BEFORE),
    to = addDays(dates[dates.length - 1], MARGIN_AFTER);
  let wind = await request(pastWindUrl(from, to), fetcher, { wait, quick });
  if (!wind.ok && wind.status === 400)
    wind = await request(pastWindUrl(from, to, true), fetcher, { wait, quick });
  if (!wind.ok || !hasWind(wind.json))
    return { error: 'wind: ' + (wind.error || 'no wind values'), busy: wind.status === 429 };
  const swell = await request(pastSwellUrl(from, to), fetcher, { wait, quick });
  if (!swell.ok || !hasWaves(swell.json))
    return { error: 'swell: ' + (swell.error || 'no swell values'), busy: swell.status === 429 };

  const want = new Set(dates);
  const holes = swellHoles(swell.json, dates);
  const rows = new Map(),
    hours = {},
    gaps = [];
  try {
    // every day in the fetch counts as past: no "today" in the archive
    const built = build(
      { fc: wind.json, mar: swell.json },
      { cfg: DEFAULTS, log: [], now: new Date(+localDate(to) + DAY) }
    );
    for (const d of built.past) {
      if (!want.has(d.ds)) continue;
      if (!complete(d) || holes.has(d.ds)) {
        gaps.push(d.ds);
        continue;
      }
      rows.set(d.ds, summariseDay(d));
      hours[d.ds] = dayHours(d);
    }
  } catch (e) {
    // one odd month must not stop every run after it
    return { error: 'could not be worked out: ' + e.message };
  }
  // a date the archive did not answer for at all is a gap too
  for (const ds of dates) if (!rows.has(ds) && !gaps.includes(ds)) gaps.push(ds);
  return { rows, hours, gaps };
}

/**
 * Bring the folder up to date. `today` is YYYY-MM-DD in Queensland time.
 * Returns a plain-English report of what was done.
 */
export async function updateHistory({
  dir,
  today = isoDay(new Date()),
  fetcher,
  maxMonths = 40,
  pause = 12000,
  budget = BUDGET_MS,
  wait = 60000
}) {
  const began = Date.now();
  mkdirSync(join(dir, 'hours'), { recursive: true });
  const sumFile = join(dir, 'summary.json');
  let summary = readJson(sumFile, null);
  if (summary && summary.v !== HISTORY_FORMAT) summary = null; // a new format starts afresh
  const yesterday = addDays(today, -1);
  const months = byMonth(wanted(summary, yesterday));
  const report = {
    months: 0,
    days: 0,
    gaps: [],
    errors: [],
    left: 0,
    before: summary ? summary.days.filter(Boolean).length : 0
  };
  let gaps = new Set((summary && summary.gaps) || []);

  const todo = months.slice(0, maxMonths);
  for (const [i, [ym, dates]] of todo.entries()) {
    // out of time, or Open-Meteo says it is busy: keep what is done, the next run carries on
    if (Date.now() - began > budget) {
      report.errors.push('out of time; the next run carries on');
      report.left = months.length - i;
      break;
    }
    if (i && pause) await sleep(pause);
    say(`${ym} (${dates.length} days)`);
    const got = await fetchDays(dates, fetcher ? { fetcher, wait } : { wait });
    say(
      got.error ? '  not stored: ' + got.error : `  stored ${got.rows.size} days, ${got.gaps.length} left out`
    );
    if (got.error) {
      report.errors.push(ym + ' — ' + got.error);
      if (got.busy) {
        report.errors.push('Open-Meteo is limiting requests; the next run carries on');
        report.left = months.length - i; // this month included: it is tried again
        break;
      }
      continue;
    }
    const mFile = join(dir, 'hours', ym + '.json');
    let month = readJson(mFile, null);
    if (!month || month.v !== HISTORY_FORMAT || !month.days) month = { v: HISTORY_FORMAT, days: {} };
    Object.assign(month.days, got.hours);
    writeFileSync(mFile, JSON.stringify(month));
    for (const ds of got.rows.keys()) gaps.delete(ds);
    got.gaps.forEach(ds => gaps.add(ds));
    summary = mergeSummary(summary, got.rows, new Date().toISOString());
    summary.gaps = [...gaps].filter(ds => ds >= summary.first).sort();
    writeFileSync(sumFile, JSON.stringify(summary)); // written as it goes, so a cut-off run keeps its work
    report.months++;
    report.days += got.rows.size;
    report.gaps.push(...got.gaps);
  }

  // nothing older than the history keeps, here or in the hours files
  if (summary && summary.first) {
    const files = readdirSync(join(dir, 'hours')).filter(f => /^\d{4}-\d\d\.json$/.test(f));
    for (const ym of staleMonths(
      files.map(f => f.slice(0, 7)),
      summary.first
    )) {
      unlinkSync(join(dir, 'hours', ym + '.json'));
      report.removed = (report.removed || 0) + 1;
    }
    // and in the month the history now starts, nothing before its first day
    const fm = join(dir, 'hours', summary.first.slice(0, 7) + '.json');
    const month = readJson(fm, null);
    if (month && month.days) {
      for (const ds of Object.keys(month.days)) if (ds < summary.first) delete month.days[ds];
      writeFileSync(fm, JSON.stringify(month));
    }
  }
  if (!report.left) report.left = Math.max(0, months.length - maxMonths);
  report.first = summary && summary.first;
  report.stored = summary ? summary.days.filter(Boolean).length : 0;
  if (summary && summary.first) {
    let i = summary.days.length - 1;
    while (i >= 0 && !summary.days[i]) i--;
    report.last = i >= 0 ? addDays(summary.first, i) : null;
  }
  Object.assign(report, verdict(report, yesterday));
  return report;
}

/**
 * Whether the run's files may replace the stored ones (save), and whether the
 * run should show as failed (fail), with the reason. Nothing stored, or far
 * fewer days than before (a bad read of the stored files, say), is never
 * saved over three good years; a run that fell behind saves but shows red.
 */
export function verdict(r, yesterday) {
  if (!r.stored) return { save: false, fail: true, why: 'nothing is stored' };
  if (r.before && r.stored < r.before - 40)
    return { save: false, fail: true, why: `only ${r.stored} days against ${r.before} before; not saved` };
  if (!r.last || daysBetween(r.last, yesterday) > STALE_DAYS)
    return { save: true, fail: true, why: 'the newest stored day is ' + (r.last || 'missing') };
  return { save: true, fail: false, why: '' };
}

/** The run report, as Markdown for the workflow's summary page. */
export function describeReport(r) {
  const lines = [
    `## History update`,
    '',
    `- Days stored: **${r.stored}**${r.first ? ` (from ${r.first})` : ''}`,
    `- Fetched this run: ${r.days} days in ${r.months} months`
  ];
  if (r.left) lines.push(`- Still to fetch: ${r.left} months (the next run carries on)`);
  if (r.removed) lines.push(`- Removed: ${r.removed} months older than the history keeps`);
  if (r.gaps.length)
    lines.push(
      `- Left out for missing figures: ${r.gaps.length} days (${r.gaps.slice(0, 6).join(', ')}${r.gaps.length > 6 ? ', …' : ''})`
    );
  if (r.errors.length) lines.push(`- Could not fetch: ${r.errors.join('; ')}`);
  if (r.fail)
    lines.push(`- **Failed:** ${r.why}${r.save ? '' : ' (the stored files were left as they were)'}`);
  return lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.TZ = TZ;
  say = (...a) => console.log(...a);
  const arg = (name, d) => {
    const i = process.argv.indexOf('--' + name);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const report = await updateHistory({
    dir: arg('dir', 'history-data'),
    maxMonths: +arg('max-months', 40),
    pause: +arg('pause', 12000)
  });
  const md = describeReport(report);
  console.log(md);
  if (arg('report')) writeFileSync(arg('report'), md);
  // the workflow saves and fails on these, so a bad run never replaces good files
  if (arg('outputs'))
    writeFileSync(arg('outputs'), `save=${report.save}\nfail=${report.fail}\n`, { flag: 'a' });
  else if (report.fail) process.exit(1);
}
