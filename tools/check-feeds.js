/**
 * check-feeds.js — the daily check that every outside source the app relies on
 * still answers the way the app expects.
 *
 * Run by .github/workflows/feed-check.yml every morning, and by hand with
 *   node tools/check-feeds.js [--report report.md] [--json result.json]
 *
 * It makes the same requests the app makes (the URLs and field lists come from
 * data.js, so the check and the app cannot drift apart) and looks for the ways
 * a source changes under an app without breaking outright:
 *
 *   Open-Meteo   a model renamed or retired, a parameter no longer accepted,
 *                a field dropped or renamed, new units, a shorter forecast
 *   DPI closures the closed seasons page updated since the app's dates were
 *                copied from it, or moved; the app's list of dates running out
 *   Links        a page the app links to (BOM, MSQ, ...) gone (404 / 410)
 *
 * Each finding is one of:
 *   changed  the source has changed and the app probably needs updating
 *   outage   busy, down or unreachable; these fix themselves, so no alert
 *   note     worth knowing, nothing to do yet
 *
 * Exit code 1 when anything is "changed", else 0.
 */
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { POINTS, MODELS, SOURCES } from '../config.js';
import {
  attempt,
  forecastUrl,
  marineUrl,
  windCheckUrl,
  waveCheckUrl,
  ensembleUrl,
  fieldGaps,
  hasSunTimes,
  parseEnsemble,
  FORECAST_VARS,
  MARINE_VARS,
  WAVE_VARS,
  BACKUP_CHECKED
} from '../data.js';
import { CLOSURES_SOURCE, CLOSURES_CHECKED, CRFF_LAST_YEAR } from '../closures.js';
import { pickVar, hasData } from '../util.js';

/** Fewest hours ahead a primary forecast must reach before the app's week looks thin. */
const MIN_HOURS_AHEAD = 5 * 24;
/** Fewest ensemble members per model; each normally sends 30 or more. */
const MIN_MEMBERS = 10;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A failed request that will probably come right by itself. */
const passing = r => r.status === 0 || r.status === 429 || r.status >= 500;

/**
 * One request, retried while the service is busy or down. A free service on a
 * shared GitHub machine is sometimes rate limited; that is not a change.
 */
async function request(url, { wait = 30000, tries = 3 } = {}) {
  let r;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(wait * i);
    r = await attempt(url, 30000);
    if (r.ok || !passing(r)) return r;
  }
  return r;
}

/** How many hours ahead of now a series has values for, at its best point. */
function hoursAhead(sets, name, now) {
  let best = 0;
  for (const o of sets) {
    const times = (o.hourly && o.hourly.time) || [];
    const vals = pickVar(o.hourly, name) || [];
    let last = -1;
    vals.forEach((v, k) => v != null && (last = k));
    if (last >= 0) best = Math.max(best, (Date.parse(times[last] + ':00+10:00') - now) / 36e5);
  }
  return Math.round(best);
}

/**
 * Every Open-Meteo request the app makes, checked. `now` is passed in so tests
 * can pin the clock. Returns [{ source, kind, detail }].
 */
export async function checkOpenMeteo({ now = Date.now(), wait } = {}) {
  const out = [];
  const add = (source, kind, detail) => out.push({ source, kind, detail });
  const failed = (source, r) => add(source, passing(r) ? 'outage' : 'changed', r.error || 'no usable answer');

  const jobs = [
    {
      source: 'Wind forecast (primary)',
      url: forecastUrl(),
      check(sets) {
        if (sets.length !== POINTS.length)
          return [`answered for ${sets.length} places, the app asks for ${POINTS.length}`];
        const gaps = fieldGaps(sets, FORECAST_VARS);
        if (!hasSunTimes(sets)) gaps.push('sunrise times missing');
        const ahead = hoursAhead(sets, 'wind_speed_10m', now);
        if (ahead < MIN_HOURS_AHEAD) gaps.push(`wind only reaches ${ahead} hours ahead`);
        return gaps;
      },
      info: sets => `${sets.length} places, wind ${hoursAhead(sets, 'wind_speed_10m', now)} hours ahead`
    },
    {
      source: 'Swell forecast (primary)',
      url: marineUrl(),
      check(sets) {
        if (sets.length !== POINTS.length)
          return [`answered for ${sets.length} places, the app asks for ${POINTS.length}`];
        const gaps = fieldGaps(sets, MARINE_VARS);
        const ahead = hoursAhead(sets, 'swell_wave_height', now);
        if (ahead < MIN_HOURS_AHEAD) gaps.push(`swell only reaches ${ahead} hours ahead`);
        return gaps;
      },
      info: sets => {
        const wet = sets.filter(o => hasData(pickVar(o.hourly, 'swell_wave_height'))).length;
        return `swell at ${wet} of ${sets.length} places, ${hoursAhead(sets, 'swell_wave_height', now)} hours ahead`;
      }
    },
    {
      source: `Backup swell model (${MODELS.waveFallback})`,
      url: marineUrl(MODELS.waveFallback, { vars: WAVE_VARS }),
      check: sets => fieldGaps(sets, BACKUP_CHECKED)
    },
    ...MODELS.windCheck.map(model => ({
      source: `Wind cross-check (${model})`,
      url: windCheckUrl(model),
      check: sets => fieldGaps(sets, 'wind_speed_10m')
    })),
    ...MODELS.waveCheck.map(model => ({
      source: `Swell cross-check (${model})`,
      url: waveCheckUrl(model),
      // the app takes swell height, or wave height when a model has no swell split
      check: sets => {
        const gaps = fieldGaps(sets, 'swell_wave_height,wave_height');
        return gaps.length === 2 ? ['swell and wave height missing'] : [];
      }
    })),
    ...MODELS.ensemble.map(model => ({
      source: `Wind ensemble (${model})`,
      url: ensembleUrl(model),
      check(sets) {
        const h = sets[0] && sets[0].hourly;
        const n = h && Array.isArray(h.time) ? parseEnsemble(h, model).length : 0;
        return n >= MIN_MEMBERS ? [] : [`${n} members found, expected ${MIN_MEMBERS} or more`];
      },
      info: sets => `${parseEnsemble(sets[0].hourly, model).length} members`
    }))
  ];

  for (const job of jobs) {
    const r = await request(job.url, { wait });
    if (!r.ok) {
      failed(job.source, r);
      continue;
    }
    const gaps = job.check(r.json);
    if (gaps.length) add(job.source, 'changed', gaps.join(', '));
    else add(job.source, 'ok', job.info ? job.info(r.json) : 'all fields present');
  }
  return out;
}

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

/** "25 September 2026" or "25 Sep 2026" (as DPI writes it) as 2026-09-25, or null. */
export function isoDate(text) {
  const m = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/.exec(text || '');
  const mon = m && MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (!m || mon < 0) return null;
  return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** A page as text, or { status } when it would not come. Browsers' headers, as some sites refuse others. */
async function page(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-AU,en;q=0.9'
      }
    });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) {
    return { status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The closed seasons the app copies from DPI: has the page been updated since,
 * and do the app's coral reef fin fish dates still reach next year?
 */
export async function checkClosures({ now = Date.now() } = {}) {
  const out = [];
  const source = 'DPI closed seasons page';
  const year = new Date(now).getFullYear();
  if (year >= CRFF_LAST_YEAR)
    out.push({
      source: 'Coral reef fin fish dates',
      kind: 'changed',
      detail: `the app's dates end in ${CRFF_LAST_YEAR}; add the next years from DPI`
    });
  else if (year + 1 >= CRFF_LAST_YEAR)
    out.push({
      source: 'Coral reef fin fish dates',
      kind: 'note',
      detail: `the app's dates end in ${CRFF_LAST_YEAR}; add more once DPI publishes them`
    });

  const r = await page(CLOSURES_SOURCE);
  if (r.status === 404 || r.status === 410) {
    out.push({ source, kind: 'changed', detail: `page gone (HTTP ${r.status}); the app links to it` });
    return out;
  }
  if (r.status === 403) {
    // DPI's website turns away GitHub's machines every time, so this is not an outage
    out.push({
      source,
      kind: 'note',
      detail: 'DPI turns away automated checks from GitHub; a monthly Claude check reads this page instead'
    });
    return out;
  }
  if (!r.text) {
    out.push({ source, kind: 'outage', detail: `could not read it (HTTP ${r.status || 'no answer'})` });
    return out;
  }
  const text = r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const stamp = /last (?:updated|reviewed|modified)\W{0,5}([^.]{0,40})/i.exec(text);
  const updated = stamp && isoDate(stamp[1]);
  if (!updated) out.push({ source, kind: 'note', detail: 'could not find a "last updated" date to compare' });
  else if (updated > CLOSURES_CHECKED)
    out.push({
      source,
      kind: 'changed',
      detail: `updated ${updated}; the app's dates were checked on ${CLOSURES_CHECKED}. Compare and update closures.js`
    });
  else
    out.push({
      source,
      kind: 'ok',
      detail: `last updated ${updated}; the app's dates were checked ${CLOSURES_CHECKED}`
    });
  return out;
}

/**
 * The pages the app links to. Only a definite "gone" (404 / 410) counts: many
 * sites turn away automated visitors (403) or are slow, and that is not a change.
 */
export async function checkLinks() {
  const out = [];
  for (const [name, url] of SOURCES) {
    const r = await page(url);
    if (r.status === 404 || r.status === 410)
      out.push({ source: 'Link: ' + name, kind: 'changed', detail: `page gone (HTTP ${r.status}): ${url}` });
  }
  if (!out.length)
    out.push({ source: 'Links', kind: 'ok', detail: `none of the ${SOURCES.length} links gone` });
  return out;
}

const WORD = { ok: 'OK', changed: '❌ Changed', outage: '⚠️ Not reachable', note: 'ℹ️ Note' };

/** The plain-English report: headline, what to do, then every check. */
export function report(findings, when = new Date()) {
  const changed = findings.filter(f => f.kind === 'changed');
  const outage = findings.filter(f => f.kind === 'outage');
  const head = changed.length
    ? '## ❌ Something the app relies on has changed'
    : outage.length
      ? '## ⚠️ All good, but some sources could not be reached'
      : '## ✅ All data sources are coming through as the app expects';
  const advice = changed.length
    ? 'The app probably needs updating. Open a thread in the Fishin’ Control project, paste the ' +
      'link to this page, and ask Claude to update the app.'
    : outage.length
      ? 'A service was busy or down when checked. That usually fixes itself; the check runs again tomorrow.'
      : 'Nothing to do.';
  const esc = s => String(s).replace(/\|/g, '\\|');
  const rows = findings.map(f => `| ${esc(f.source)} | ${WORD[f.kind]} | ${esc(f.detail)} |`);
  return [
    head,
    '',
    advice,
    '',
    '| Source | Result | Detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `_Checked ${when.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} (Queensland time)._`
  ].join('\n');
}

/** A short fingerprint of what is wrong, so the same problem is not reported every day. */
export const signature = findings =>
  findings
    .filter(f => f.kind === 'changed')
    .map(f => f.source)
    .sort()
    .join(' + ');

export async function run(opts = {}) {
  const findings = [
    ...(await checkOpenMeteo(opts)),
    ...(await checkClosures(opts)),
    ...(await checkLinks(opts))
  ];
  return { findings, changed: findings.some(f => f.kind === 'changed'), signature: signature(findings) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
  };
  const result = await run();
  const text = report(result.findings);
  console.log(text);
  if (arg('--report')) writeFileSync(arg('--report'), text + '\n');
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.changed ? 1 : 0;
}
