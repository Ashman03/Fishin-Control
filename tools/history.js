/**
 * history.js — builds and tops up the History tab's files. Run once a day by
 * .github/workflows/history.yml, and by hand with
 *
 *   node tools/history.js --dir <folder> [--max-months 40] [--pause 12000]
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
import { POINTS, TZ, DEFAULTS } from '../config.js';
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

const sleep = ms => new Promise(res => setTimeout(res, ms));
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

/** A request retried while the service is busy (429) or down; a refusal is returned at once. */
async function request(url, fetcher, { tries = 3, wait = 60000 } = {}) {
  let res;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(wait * i);
    res = await fetcher(url);
    if (res.ok || (res.status !== 0 && res.status !== 429 && res.status < 500)) return res;
  }
  return res;
}

/**
 * Whether a built day has every figure the call depends on: wind and gusts at
 * every hour at every ramp, and swell at the best ramp. A swell figure that is
 * missing reads as 0 m in the app by the owner's choice; in history a whole
 * missing swell feed would turn every day calm, so the swell must be there.
 */
const complete = d => d.zones.every(z => z.gapHrs === 0) && d.zones[0].hours.length >= 24;

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
export async function fetchDays(dates, { fetcher = attempt } = {}) {
  const from = addDays(dates[0], -MARGIN_BEFORE),
    to = addDays(dates[dates.length - 1], MARGIN_AFTER);
  let wind = await request(pastWindUrl(from, to), fetcher);
  if (!wind.ok && wind.status === 400) wind = await request(pastWindUrl(from, to, true), fetcher);
  if (!wind.ok || !hasWind(wind.json)) return { error: 'wind: ' + (wind.error || 'no wind values') };
  const swell = await request(pastSwellUrl(from, to), fetcher);
  if (!swell.ok || !hasWaves(swell.json)) return { error: 'swell: ' + (swell.error || 'no swell values') };

  // every day in the fetch counts as past: no "today" in the archive
  const built = build(
    { fc: wind.json, mar: swell.json },
    { cfg: DEFAULTS, log: [], now: new Date(+localDate(to) + DAY) }
  );
  const want = new Set(dates);
  const rows = new Map(),
    hours = {},
    gaps = [];
  for (const d of built.past) {
    if (!want.has(d.ds)) continue;
    if (!complete(d)) {
      gaps.push(d.ds);
      continue;
    }
    rows.set(d.ds, summariseDay(d));
    hours[d.ds] = dayHours(d);
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
  fetcher = attempt,
  maxMonths = 40,
  pause = 12000
}) {
  mkdirSync(join(dir, 'hours'), { recursive: true });
  const sumFile = join(dir, 'summary.json');
  let summary = readJson(sumFile, null);
  if (summary && summary.v !== HISTORY_FORMAT) summary = null; // a new format starts afresh
  const yesterday = addDays(today, -1);
  const months = byMonth(wanted(summary, yesterday));
  const report = { months: 0, days: 0, gaps: [], errors: [], left: Math.max(0, months.length - maxMonths) };
  let gaps = new Set((summary && summary.gaps) || []);

  for (const [i, [ym, dates]] of months.slice(0, maxMonths).entries()) {
    if (i && pause) await sleep(pause);
    const got = await fetchDays(dates, { fetcher });
    if (got.error) {
      report.errors.push(ym + ' — ' + got.error);
      continue;
    }
    const mFile = join(dir, 'hours', ym + '.json');
    const month = readJson(mFile, { v: HISTORY_FORMAT, days: {} });
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
  report.first = summary && summary.first;
  report.stored = summary ? summary.days.filter(Boolean).length : 0;
  return report;
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
  return lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.TZ = TZ;
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
  // nothing stored at all is a failure worth a red run; a few gaps are not
  if (!report.stored) process.exit(1);
}
