/**
 * ui.js — turns state into HTML and turns clicks into state changes.
 *
 * render() is the only function that writes to the page. It rebuilds #app
 * from `state` every time; that is cheap (a few ms) and means the screen can
 * never drift out of sync with the data.
 *
 * Clicks are delegated: markup declares data-act="name", and ACTIONS[name]
 * handles it. To add a control, add a handler here and an attribute in the
 * markup — never an inline onclick.
 *
 * rebuild() = recompute the model + render. Use it after anything that feeds
 * the model (limits, catch log). render() alone is a repaint.
 */
import {
  APP_VERSION,
  ZONES,
  ESTUARIES,
  SOURCES,
  TOP_SOURCES,
  BOM_ZONES,
  RATINGS,
  DEFAULTS,
  TUNING,
  SEASON,
  RIVER_SEASON
} from './config.js';
import { state, save, validLimits } from './store.js';
import { attempt } from './data.js';
import { build, seaWord, conditionsFor } from './model.js';
import {
  summaryUrl,
  hoursUrl,
  readSummary,
  rampHours,
  dayTides,
  rampOf,
  scoreOf,
  tally,
  yearMonths,
  weekStart,
  addDays
} from './history.js';
import { sessions, techniques, launchNotes, patterns, tidePhaseAt, moonBucket, moonLabel } from './advice.js';
import { moonIllum } from './astro.js';
import { speciesArt } from './art.js';
import { mapSVG } from './map.js';
import {
  activeClosures,
  upcomingClosures,
  closedSpecies,
  closureDatesStale,
  CLOSURES_SOURCE
} from './closures.js';
import { GO_SCORE, SYNC_TAG, SYNC_INTERVAL_MS } from './alerts.js';
import {
  esc,
  hhmm,
  pad,
  clamp,
  light,
  lightKey,
  LINES,
  dirOf,
  isoDay,
  localDate,
  span,
  fromNewOrFull,
  circularMean,
  HOUR,
  DAY
} from './util.js';

/** A lamp's colour, for a figure that is coloured by its lamp on the caution and advisory panel. */
const LAMP_COLOUR = { go: 'var(--go)', hold: 'var(--mid)', nogo: 'var(--no)' };

/**
 * The Models lamp: [state, figure]. The ensemble answers "is there a window?"
 * directly, so it leads; the three-model spread can only downgrade a GO to a
 * HOLD. The ensemble % elsewhere on the page takes this lamp's colour.
 */
function modelsLamp(day) {
  if (day.prob != null) {
    const st =
      day.prob >= TUNING.ensembleTrusted ? 'go' : day.prob >= TUNING.lowProbability ? 'hold' : 'nogo';
    return [st === 'go' && day.agree.level === 'low' ? 'hold' : st, day.prob + '%'];
  }
  const st = { high: 'go', fair: 'hold', low: 'nogo', unknown: 'hold' }[day.agree.level];
  return [st, day.agree.level === 'unknown' ? 'one model' : day.agree.level + ' agreement'];
}

const $ = id => document.getElementById(id);
const short = name => name.split(' /')[0].split(' (')[0];
const longDate = d => d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
/** "Sat 17 Oct": the parts joined by hand, as the en-AU format puts a comma after the day name. */
const shortDate = d =>
  ['weekday', 'day', 'month']
    .map(k => d.toLocaleDateString('en-AU', { [k]: k === 'day' ? 'numeric' : 'short' }))
    .join(' ');

/* ── Small components ───────────────────────────────────────────────────── */

/**
 * The daily score as a gauge that fills with water, with ticks at its green and
 * amber lines (the verdict's lines: LINES.ocean, or LINES.river for the river score).
 * The water is kept faint and its surface drawn as a line, so the figures on
 * top read the same in green, amber or red.
 */
export function dial(score, lines = LINES.ocean) {
  const W = 82,
    H = 196,
    y = +(H - (H * score) / 100).toFixed(1),
    c = light(score, lines);
  const tick = s =>
    `<path d="M0 ${(H - (H * s) / 100).toFixed(1)}h14" stroke="#e9f4fb" stroke-opacity=".5"/>`;
  return `<svg class="dial" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score ${score} of 100">
   <defs><clipPath id="dialClip"><rect width="${W}" height="${H}"/></clipPath></defs>
   <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="#061420" stroke="#7ad3f5" stroke-opacity=".35"/>
   <g clip-path="url(#dialClip)">
     <rect class="fillw" x="0" y="${y}" width="${W}" height="${H - y + 3}" fill="${c}" opacity=".16"/>
     <path class="fillw" d="M0 ${y} q10 -4 20.5 0 t20.5 0 t20.5 0 t20.5 0 V${H} H0Z" fill="${c}" opacity=".06"/>
     <path class="fillw" d="M0 ${y} q10 -4 20.5 0 t20.5 0 t20.5 0 t20.5 0" fill="none" stroke="${c}" stroke-width="2"/>
     ${tick(lines[0])}${tick(lines[1])}
   </g>
   <text x="41" y="90" text-anchor="middle" font-size="38" font-weight="700" fill="${c}" class="dial-num">${score}</text>
   <text x="41" y="107" text-anchor="middle" font-size="11" fill="#bde9fb" class="dial-sub">out of 100</text>
  </svg>`;
}

/**
 * The daily score with its caption, as it sits at the left of the hero.
 * `parts` lists what the score is made from, so it can be read against the
 * ramp scores below it: [[label, value, lines], …].
 */
const dailyScore = (score, caption, lines, parts = []) =>
  `<div class="dscore">${dial(score, lines)}<span class="cap">${caption}</span>${
    parts.length
      ? `<span class="parts">${parts
          .map(([k, v, l]) => `<span>${k} <b class="num" style="color:${light(v, l)}">${v}</b></span>`)
          .join('')}</span>`
      : ''
  }</div>`;

export function verdict(score, river) {
  if (score >= 75) return ['Go', 'Inside your limits for a decent stretch of the day.'];
  if (score >= 58)
    return [
      'Worth a look',
      'Inside your limits, but the window is not generous. Check the morning obs before you hook up.'
    ];
  if (score >= 42)
    return [
      'Marginal',
      'Sitting right on the edge of what you fish. In a 4.5 m boat, treat any doubt as a no.'
    ];
  return [
    'River day',
    river >= 55
      ? 'Outside is out, but the systems will fish fine in the lee.'
      : 'Blowing and lumpy. Tie rigs, service the trailer, go another day.'
  ];
}

/**
 * A status panel with a lamp: kind 'no' (red), 'mid' (amber) or 'go' (green).
 * `body` is markup, already escaped by the caller.
 */
const alertBox = (kind, title, body, extra = '') =>
  `<div class="alert ${kind}"><span class="lamp" aria-hidden="true"></span>
    <div class="alert-b"><h3>${title}</h3>${body}${extra}</div></div>`;

const notice = (title, body) => alertBox('no', title, `<p class="sub">${body}</p>`);

/**
 * The day's cautions (bar, closed seasons) in a row of their own under the
 * sites, not at the foot of the sites column: they come and go by the day, and
 * a column that grows with them pushed the panel and countdown apart on a
 * wide screen. Nothing at all when there are none.
 */
const notes = (...cards) => {
  const html = cards.filter(Boolean).join('');
  return html ? `<div class="notes">${html}</div>` : '';
};

/** Banners for anything that makes the forecast less trustworthy than it looks. */
function banners(day) {
  const out = [];
  if (state.demo)
    out.push(
      notice(
        'Sample data — not a real forecast',
        'The live forecast could not be loaded' +
          (state.loadError ? ': <b>' + esc(state.loadError) + '</b>' : '') +
          '. What you see below is invented, to show how the app works. Tap Refresh to try again.'
      )
    );
  // only the swell can be a saved copy while the wind is live (the wave service was busy)
  const swellOnly = state.raw && state.raw.saved && state.raw.saved.join() === 'swell';
  if (state.raw && state.raw.cached)
    out.push(
      notice(
        swellOnly ? 'Saved swell forecast — not live' : 'Saved forecast — not live',
        (swellOnly
          ? 'The wind is live, but the swell is the last forecast saved on this phone'
          : 'Showing the last forecast saved on this phone') +
          (state.raw.savedAt
            ? ', from ' +
              new Date(state.raw.savedAt).toLocaleString('en-AU', {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit'
              })
            : '') +
          (state.raw.savedReason ? ' (' + esc(state.raw.savedReason) + ')' : '') +
          '. Conditions may have changed. Do not launch on it.'
      )
    );
  if (day && day.noWaves)
    out.push(
      notice(
        'Swell data unavailable',
        'The wave models did not respond, so scores here are wind-only and capped. Check BOM or Windy for swell before you decide.'
      )
    );
  // a feed answered but left something out: the app reads the gap as zero
  if (!state.demo && state.raw && state.raw.gaps && state.raw.gaps.length)
    out.push(
      notice(
        'Forecast data incomplete',
        'The forecast came back incomplete: <b>' +
          esc(state.raw.gaps.join(', ')) +
          '</b>. The app cannot allow for what is missing, so the calls here may look better than they are. ' +
          'Check BOM before you decide. If this stays after a refresh, the forecast service has ' +
          'probably changed and the app needs updating.'
      )
    );
  const off = -new Date().getTimezoneOffset();
  if (off !== 600)
    out.push(
      notice(
        'Clock mismatch',
        'This device is not on Queensland time (UTC+10). Every time shown is Queensland local, so it will not match your phone clock while you are away.'
      )
    );
  return out.join('');
}

function condChart(zone, cfg) {
  // drawn at roughly phone width, so its labels read at their real size
  const W = 420,
    H = 170,
    P = 22,
    hrs = zone.hours;
  if (!hrs.length) return '';
  const t0 = +hrs[0].t,
    width = 23 * HOUR;
  const x = t => P + ((W - P * 2) * (+t - t0)) / width;
  const maxS = Math.max(1.2, ...hrs.map(h => h.swellChk)),
    maxW = Math.max(18, ...hrs.map(h => h.gust));
  const sy = v => H - 16 - (H - 44) * clamp(v / maxS, 0, 1),
    wy = v => H - 16 - (H - 44) * clamp(v / maxW, 0, 1);
  const line = (f, k) =>
    hrs.map((h, i) => (i ? 'L' : 'M') + x(h.t).toFixed(1) + ' ' + f(k(h)).toFixed(1)).join(' ');
  let bands = '',
    start = null;
  hrs.forEach((h, i) => {
    if (h.z.ok && start === null) start = h.t;
    if ((!h.z.ok || i === hrs.length - 1) && start !== null) {
      const end = h.z.ok ? new Date(+h.t + HOUR) : h.t;
      bands += `<rect x="${x(start)}" y="8" width="${Math.max(2, x(end) - x(start))}" height="${H - 24}" fill="var(--go)" opacity=".11"/>`;
      start = null;
    }
  });
  // forecast storm hours: white hatching down the chart, so they cannot be
  // mistaken for the wind line (amber); denser where a storm is likely
  const storms = hrs
    .filter(h => h.stormNow > 0)
    .map(
      h =>
        `<rect class="storm" x="${x(h.t)}" y="8" width="${Math.max(2, x(+h.t + HOUR) - x(h.t))}" height="${H - 24}" fill="url(#stormHatch)" opacity="${h.stormNow === 2 ? 0.9 : 0.5}"/>`
    )
    .join('');
  const label = (t, txt) =>
    `<text x="${x(t)}" y="${H - 2}" text-anchor="middle" font-size="10.5" fill="#95b8cd" font-family="Space Grotesk,sans-serif">${txt}</text>`;
  // the two scales: swell in metres up the left, wind in knots up the right
  const scale = (xx, anchor, colour, txt) =>
    `<text x="${xx}" y="22" text-anchor="${anchor}" font-size="10.5" fill="${colour}" font-family="Space Grotesk,sans-serif">${txt}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Swell, wind and gusts through the day">
   <defs><pattern id="stormHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
     <rect width="2" height="6" fill="#e9f4fb" opacity=".3"/></pattern></defs>
   <rect x="${P}" y="8" width="${W - P * 2}" height="${H - 24}" fill="rgba(0,0,0,.22)"/>
   ${bands}${storms}
   ${scale(P + 3, 'start', 'var(--sky)', maxS.toFixed(1) + ' m')}${scale(W - P - 3, 'end', 'var(--mid)', Math.round(maxW) + ' kn')}
   <line x1="${P}" x2="${W - P}" y1="${sy(cfg.maxSwell)}" y2="${sy(cfg.maxSwell)}" stroke="var(--sky)" stroke-opacity=".45" stroke-dasharray="2 4"/>
   <line x1="${P}" x2="${W - P}" y1="${wy(cfg.maxWind)}" y2="${wy(cfg.maxWind)}" stroke="var(--no)" stroke-opacity=".35" stroke-dasharray="2 4"/>
   <path d="${line(wy, h => h.gust)}" fill="none" stroke="var(--no)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>
   <path d="${line(wy, h => h.wind)}" fill="none" stroke="var(--mid)" stroke-width="2"/>
   <path d="${line(sy, h => h.swellChk)}" fill="none" stroke="var(--sky)" stroke-width="2.4"/>
   ${[0, 6, 12, 18].map(hr => label(t0 + hr * HOUR, pad(hr) + ':00')).join('')}
   <text x="${P + 3}" y="${sy(cfg.maxSwell) - 5}" font-size="10" fill="#95b8cd" font-family="Space Grotesk,sans-serif">SWELL LIMIT ${cfg.maxSwell} M</text>
   <text x="${W - P - 3}" y="${wy(cfg.maxWind) - 5}" text-anchor="end" font-size="10" fill="#95b8cd" font-family="Space Grotesk,sans-serif">WIND LIMIT ${cfg.maxWind} KN</text>
  </svg>`;
}

/** Tide curve plotted against real time, so the curve and its markers cannot drift apart. */
function tideSVG(day) {
  const W = 420,
    H = 132,
    P = 20,
    pts = day.tideCurve.filter(h => h.v != null);
  if (pts.length < 4) return '<p class="sub">No modelled tide curve for this day — use the MSQ table.</p>';
  const vs = pts.map(h => h.v),
    lo = Math.min(...vs),
    hi = Math.max(...vs);
  const x = t => P + ((W - P * 2) * (+t - +day.d0)) / DAY;
  const y = v => H - 26 - (H - 50) * ((v - lo) / (hi - lo || 1));
  const path = pts.map((h, i) => (i ? 'L' : 'M') + x(h.t).toFixed(1) + ' ' + y(h.v).toFixed(1)).join(' ');
  const inDay = d => d && d >= day.d0 && d < new Date(+day.d0 + DAY);
  const maj = [day.me.over, day.me.under]
    .filter(inDay)
    .map(d => `<rect x="${x(d) - 10}" y="10" width="20" height="${H - 38}" fill="var(--go)" opacity=".13"/>`)
    .join('');
  const sun = [day.sunrise, day.sunset]
    .map(
      d =>
        `<line x1="${x(d)}" x2="${x(d)}" y1="10" y2="${H - 26}" stroke="var(--mid)" stroke-opacity=".4" stroke-dasharray="3 3"/>`
    )
    .join('');
  const marks = day.tides
    .map(t => {
      const cx = x(t.t),
        cy = y(t.v);
      return `<circle cx="${cx}" cy="${cy}" r="3.6" fill="${t.hi ? 'var(--sky2)' : 'var(--sky)'}"/>
      <text x="${cx}" y="${t.hi ? cy - 9 : cy + 16}" text-anchor="middle" font-size="11" fill="#e9f4fb"
        font-family="Space Grotesk,sans-serif">${hhmm(t.t)}</text>`;
    })
    .join('');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tide curve">
   ${maj}${sun}
   <path d="${path} L ${x(last.t)} ${H - 22} L ${x(pts[0].t)} ${H - 22} Z" fill="var(--sky)" opacity=".13"/>
   <path d="${path}" fill="none" stroke="var(--sky)" stroke-width="2.2"/>
   ${marks}
  </svg>`;
}

const ICONS = {
  plan: '<path d="M3 15c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2"/><path d="M3 19c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2"/><path d="M12 3v7M9 7l3 3 3-3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>',
  log: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>'
};

/** The three sections: a bar along the bottom on a phone, across the top on a wide screen. */
function tabs() {
  // plain buttons marked aria-current: ARIA tab roles would promise arrow-key
  // navigation that a three-button switcher does not need
  return `<nav class="tabs" aria-label="Sections">
    ${[
      ['plan', 'Forecast'],
      ['history', 'Flight log'],
      ['log', 'Catch log']
    ]
      .map(
        ([k, l]) =>
          `<button data-act="tab" data-tab="${k}" class="${state.tab === k ? 'on' : ''}"${state.tab === k ? ' aria-current="page"' : ''}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${ICONS[k]}</svg>${l}</button>`
      )
      .join('')}
  </nav>`;
}

/** A section heading: spaced capitals, with a quieter note on the right. */
const sect = (title, note = '') => `<h2 class="sect">${title}${note ? ` <span>${note}</span>` : ''}</h2>`;

function barCard(zone) {
  if (!zone.barWin.length) return '';
  const worst = Math.max(...zone.barWin.map(w => w.max));
  return alertBox(
    worst >= 3 ? 'no' : 'mid',
    worst >= 3 ? 'Bar · stay off it' : 'Bar · wind against tide',
    `<p class="sub">${zone.barWin.map(w => hhmm(w.a) + '–' + hhmm(w.b)).join(', ')} at ${esc(zone.z.ramp.split(',')[0])}.
    A run-out into an onshore breeze stands the bar up regardless of what the swell number says.
    ${worst >= 3 ? 'Plan to stay off the bar through these hours.' : 'Treat it with respect, and never cross on the last of the run-out into wind.'}</p>
    <p class="sub">Indicative only: worked out from one tide curve off Burnett Heads, not this bar's own tide.
    Check the <a href="https://www.msq.qld.gov.au/Tides/Tide-tables" target="_blank" rel="noopener">MSQ tide tables</a>
    and look at the bar before you cross.</p>`
  );
}

/**
 * The loading screen's "Forecast feeds" line once the requests are back, as
 * [state, word, label]: GO only when every source answered live. HOLD (amber,
 * the word the caution and advisory panel uses) when some are down or a
 * primary is the phone's saved copy; NO GO with sample data.
 */
export function feedsLine(raw, demo) {
  const s = (raw && raw.status) || [];
  const up = s.filter(x => x.ok).length;
  const label = `Forecast feeds · ${up} of ${s.length} up`;
  if (demo) return ['nogo', 'No go', 'Forecast feeds · offline'];
  if (raw.cached) return ['hold', 'Hold', 'Forecast feeds · saved copy'];
  return up === s.length ? ['go', 'Go', label] : ['hold', 'Hold', label];
}

/** What actually answered, so a silent failure upstream is visible on screen. */
function sourceStatus() {
  const s = state.raw && state.raw.status;
  if (!s || !s.length) return '';
  const up = s.filter(x => x.ok).length;
  return `<details data-key="sources"><summary><span>Data sources</span>
      <b class="num" style="color:${up === s.length ? 'var(--go)' : up ? 'var(--mid)' : 'var(--no)'}">${up} of ${s.length} up</b>
      <span class="dots" aria-hidden="true">${s.map(x => `<i class="${x.ok ? 'ok' : 'down'}"></i>`).join('')}</span></summary>
    ${s
      .map(
        x => `<div class="mk"><span class="g">${esc(x.label)} <span class="ty">${esc(x.role)}${x.detail ? ' · ' + esc(x.detail) : ''}</span></span>
      <b style="color:${x.ok ? 'var(--go)' : 'var(--no)'}">${x.ok ? 'ok' : 'down'}</b></div>`
      )
      .join('')}
  </details>`;
}

/** The pre-launch links: the first TOP_SOURCES (config.js) show, the rest fold away. */
const sourceLink = ([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`;

/* ── Launch theme: caution and advisory panel, countdown, window tracks ── */

const STATUS = { go: 'GO', hold: 'HOLD', nogo: 'NO GO' };

/**
 * The hours a ramp's figures describe: its first launch window if it has one,
 * otherwise the whole of the fishing day. The caution panel and the launch
 * sites list both use it, so the two never quote different stretches of the
 * day (6.2.0 showed the window's 3–8 kn in the panel beside the day's
 * 11–21 kn in red on the same ramp).
 */
export function figureHours(day, zone) {
  const w = zone.win[0];
  const hrs = w
    ? zone.hours.filter(h => h.t >= w.a && h.t < w.b)
    : zone.hours.filter(h => h.t >= day.from && h.t <= day.to);
  return { w, hrs: hrs.length ? hrs : zone.hours };
}

/** The launch sites list's tags for one ramp, from the same hours as its caution panel. */
export function rampTags(day, z, cfg) {
  const { w, hrs } = figureHours(day, z);
  const lo = k => Math.min(...hrs.map(h => h[k])),
    hi = k => Math.max(...hrs.map(h => h[k]));
  const gap = hrs.some(h => h.gap);
  const tag = (ok, txt) => `<span class="tag ${ok ? 'ok' : 'bad'}">${txt}</span>`;
  const dir = dirOf(
    circularMean(
      hrs.map(h => h.wdir),
      hrs.map(h => h.wind)
    )
  );
  return (
    tag(hi('swellChk') <= cfg.maxSwell, 'swell ' + span(lo('swell'), hi('swell')) + ' m') +
    tag(!gap && hi('wind') <= cfg.maxWind, span(lo('wind'), hi('wind'), 0) + ' kn ' + dir) +
    tag(!gap && hi('gust') <= cfg.maxGust, 'gusts ' + Math.round(hi('gust'))) +
    (w
      ? `<span class="tag ok">window ${hhmm(w.a)}–${hhmm(w.b)}</span>`
      : `<span class="tag">${z.goodHrs} h ok · no window</span>`) +
    (z.barMax >= 2 ? '<span class="tag bad">bar risk</span>' : '') +
    (z.prob != null ? `<span class="tag">${z.prob}% chance</span>` : '')
  );
}

/**
 * The caution and advisory panel for one ramp on one day. Each station reads GO when its
 * own limit holds for at least a full window of daylight, HOLD when it holds
 * for some of it, NO GO when it never does.
 */
function cautionPanel(day, zone) {
  const cfg = state.cfg;
  const daylight = zone.hours.filter(h => h.t >= day.from && h.t <= day.to);
  const hours = test => daylight.filter(test).length;
  const station = n => (n >= TUNING.minWindowHours ? 'go' : n > 0 ? 'hold' : 'nogo');
  const closed = activeClosures(day.d0, zone.z);

  // Show the figures for the hours the verdict is about: the best window if
  // there is one, otherwise the whole of daylight. Windows run on whole hours,
  // so the window reads 06–18 to fit a phone-width column. A day's peak gust beside a
  // GO for the window reads as a contradiction.
  const { w, hrs: inWin } = figureHours(day, zone);
  const lo = k => Math.min(...inWin.map(h => h[k])),
    hi = k => Math.max(...inWin.map(h => h[k]));

  const [models, modelsVal] = modelsLamp(day);

  const rows = [
    ['Swell', station(hours(h => h.swellChk <= cfg.maxSwell)), span(lo('swell'), hi('swell')) + ' m'],
    // an hour with no wind or gust figure is not inside the limit
    ['Wind', station(hours(h => !h.gap && h.wind <= cfg.maxWind)), span(lo('wind'), hi('wind'), 0) + ' kn'],
    ['Gusts', station(hours(h => !h.gap && h.gust <= cfg.maxGust)), 'to ' + Math.round(hi('gust')) + ' kn'],
    [
      'Window',
      zone.win.length ? 'go' : zone.goodHrs ? 'hold' : 'nogo',
      w ? hhmm(w.a) + '–' + hhmm(w.b) + ' · ' + zone.goodHrs + ' h' : zone.goodHrs + ' h'
    ],
    ['Models', models, modelsVal],
    [
      'Bite',
      day.bite >= LINES.bite[0] ? 'go' : day.bite >= LINES.bite[1] ? 'hold' : 'nogo',
      String(day.bite)
    ],
    // storms lower the score but never stop the launch on their own: HOLD at worst
    [
      'Storms',
      zone.stormFrom ? 'hold' : 'go',
      zone.stormFrom
        ? (zone.stormMax === 2 ? 'risk from ' : 'unstable from ') + hhmm(zone.stormFrom)
        : 'none forecast'
    ],
    ['Rules', closed.length ? 'hold' : 'go', closed.length ? closed.length + ' closed' : 'all open']
  ];
  return advisoryHTML(rows, 'Caution and advisory panel for ' + zone.z.name);
}

/** The four screws in the corners of the annunciator panel's bezel. */
const SCREWS = ['tl', 'tr', 'bl', 'br'].map(c => `<i class="screw ${c}" aria-hidden="true"></i>`).join('');

/**
 * A caution and advisory panel: rows of [label, 'go' | 'hold' | 'nogo', value,
 * full?], under a heading that totals the calls, drawn as an annunciator: a
 * bezel holding a glass key per station, its legend lit in the lamp's colour
 * (the CSS puts the call above the station name). A key has room for a short
 * figure; `full`, when given, is the whole reading, read out instead of it.
 */
function advisoryHTML(rows, label) {
  const count = st => rows.filter(r => r[1] === st).length;
  const tally = ['go', 'hold', 'nogo']
    .filter(count)
    .map(st => count(st) + ' ' + STATUS[st])
    .join(' · ');
  const list = `<div class="adv tiles" role="list" aria-label="${esc(label)}">
    ${rows
      .map(
        ([k, st, v, full]) => `<div class="adv-row" role="listitem" data-st="${st}">
      <span class="adv-k">${k}</span><span class="adv-v num"${full ? ' aria-hidden="true"' : ''}>${esc(v)}</span>${
        full ? `<span class="vh">${esc(full)}</span>` : ''
      }
      <span class="adv-s ${st}">${STATUS[st]}</span></div>`
      )
      .join('')}
  </div>`;
  return `<div class="annun">${SCREWS}${sect('Caution and advisory panel', tally)}${list}</div>`;
}

/** Earliest launch window still ahead (or open now) across the whole week. */
export function nextWindow(now = new Date()) {
  let best = null;
  for (const d of state.days)
    for (const z of d.zones)
      for (const w of z.win) if (w.b > now && (!best || w.a < best.w.a)) best = { d, z, w };
  return best;
}

/** Split a duration into zero-padded days, hours, minutes and seconds. */
export function clockParts(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return {
    d: pad(Math.floor(t / 86400)),
    h: pad(Math.floor((t % 86400) / 3600)),
    m: pad(Math.floor((t % 3600) / 60)),
    s: pad(t % 60)
  };
}

const CLOCK_UNITS = [
  ['d', 'Days'],
  ['h', 'Hrs'],
  ['m', 'Min'],
  ['s', 'Sec']
];

/**
 * NASA-style launch clock to the next window anywhere in the week. T− counts
 * down to the window opening; once open it turns green and T+ counts up from
 * the opening, as a launch clock does after liftoff, until the window closes.
 * The times live in data-from / data-end so tickCountdown() can update the
 * digits each second without rebuilding anything.
 */
export function countdown(now = new Date()) {
  const n = nextWindow(now);
  if (!n)
    return `<div class="tminus nogo" id="tminus">
      <div class="tm-head"><span class="tm-label">Hold</span>
      <span class="tm-where">No launch window in the next ${state.days.length} days</span></div></div>`;
  const where = esc(short(n.z.z.name));
  const open = n.w.a <= now;
  const end = open ? +n.w.b : 0;
  const day = n.d.d0.toLocaleDateString('en-AU', { weekday: 'short' });
  const head = open
    ? `<span class="tm-label">Window open</span><span class="tm-where">${where} · closes ${hhmm(n.w.b)}</span>`
    : `<span class="tm-label">To launch window</span><span class="tm-where">${day} ${hhmm(n.w.a)} · ${where}</span>`;
  const p = clockParts(open ? now - n.w.a : n.w.a - now);
  const units = CLOCK_UNITS.map(
    ([k, label]) => `<span class="tm-unit"><b data-u="${k}">${p[k]}</b><i>${label}</i></span>`
  ).join('');
  const spoken =
    (open ? 'Window open at ' + where + ', closes ' : 'Next launch window ') +
    day +
    ' ' +
    hhmm(open ? n.w.b : n.w.a);
  return `<div class="tminus ${open ? 'go' : ''}" id="tminus" data-from="${+n.w.a}" data-end="${end}">
    <div class="tm-head">${head}</div>
    <div class="tm-clock" role="timer" aria-label="${esc(spoken)}">
      <span class="tm-sign" aria-hidden="true">${open ? 'T+' : 'T−'}</span>${units}
    </div>
  </div>`;
}

/**
 * Advance the clock in place. Returns false when it needs rebuilding: the
 * window has opened (T− becomes T+) or closed (move on to the next one).
 */
export function tickCountdown(el, now = Date.now()) {
  const from = +el.dataset.from,
    end = +el.dataset.end;
  if (!from) return true;
  const open = end > 0;
  if ((!open && now >= from) || (open && now >= end)) return false;
  const p = clockParts(open ? now - from : from - now);
  for (const b of el.querySelectorAll('[data-u]')) {
    const v = p[b.dataset.u];
    if (b.textContent !== v) b.textContent = v;
  }
  return true;
}

/** A 24-hour track with the best ramp's passing daylight hours lit. */
function windowTrack(d) {
  const z = d.zones[0],
    W = 64;
  const lit = z.hours
    .filter(h => h.z.ok && h.t >= d.from && h.t <= d.to)
    .map(
      h =>
        `<rect x="${(((h.t - d.d0) / DAY) * W).toFixed(1)}" width="${(W / 24 + 0.2).toFixed(2)}" height="5" fill="var(--go)"/>`
    )
    .join('');
  return `<svg class="track" viewBox="0 0 ${W} 5" aria-hidden="true">
    <rect width="${W}" height="5" fill="rgba(122,211,245,.12)"/>${lit}</svg>`;
}

function closuresCard(day, zone) {
  const now = activeClosures(day.d0, zone.z);
  const soon = upcomingClosures(day.d0, zone.z, 14);
  const stale = closureDatesStale(day.d0);
  if (!now.length && !soon.length && !stale) return '';
  return alertBox(
    'mid',
    now.length ? 'Closed season in force' : 'Closed season coming up',
    `${now.map(c => `<p class="sub"><b>${esc(c.title)}.</b> ${esc(c.detail)}${c.where ? ' Applies ' + esc(c.where) + '.' : ''}</p>`).join('')}
    ${soon.map(u => `<p class="sub"><b>${esc(u.closure.title)}</b> from ${shortDate(u.starts)}.${u.closure.where ? ' Applies ' + esc(u.closure.where) + '.' : ''}</p>`).join('')}
    ${stale ? '<p class="sub">The published coral reef fin fish dates in this app have run out — check the official page.</p>' : ''}`,
    `<div class="links"><a href="${CLOSURES_SOURCE}" target="_blank" rel="noopener">Official closed seasons</a></div>`
  );
}

function freshGoBanner() {
  if (!state.freshGo || !state.freshGo.length) return '';
  const item = g =>
    shortDate(new Date(g.ds + 'T12:00')) +
    ' · ' +
    esc(short(g.ramp)) +
    ' ' +
    g.score +
    (g.from ? ' · ' + g.from + '–' + g.to : '');
  return alertBox(
    'go',
    `New go ${state.freshGo.length > 1 ? 'days' : 'day'}`,
    `<p class="sub">${state.freshGo.map(item).join('<br>')}</p>`,
    '<button class="ghost" data-act="dismissGo">Got it</button>'
  );
}

function alertsPanel() {
  const a = state.alerts || {};
  const msg =
    {
      background:
        'On. Your phone checks in the background — Android decides how often, usually every several hours — and notifies you when a day newly turns Go (' +
        GO_SCORE +
        ' or more).',
      open: 'On, but this phone will not run background checks: install the app from Chrome for that. Until then, new go days are flagged whenever you open it.',
      denied:
        'Notifications are blocked for this site. Allow them in Chrome under the site settings, then try again.',
      unsupported: 'This browser cannot show notifications.'
    }[a.on ? a.mode : a.mode === 'denied' || a.mode === 'unsupported' ? a.mode : ''] ||
    'Get a notification when a day newly turns Go (' + GO_SCORE + ' or more), without opening the app.';
  return `<details data-key="alerts"><summary><span>Go-day alerts</span>
      <b style="color:${a.on ? 'var(--go)' : 'var(--mute)'}">${a.on ? 'Armed' : 'Off'}</b></summary>
    <p class="sub">${msg}</p>
    <div class="btns">${
      a.on
        ? '<button class="save solid" data-act="alertsTest">Send a test alert</button> <button class="ghost" data-act="alertsOff">Turn off</button>'
        : '<button class="save solid" data-act="alertsOn">Turn on alerts</button>'
    }</div>
  </details>`;
}

/* ── Shared sections (ocean and river views) ──────────────────────────── */

const moonPhase = p =>
  [
    'New moon',
    'Waxing crescent',
    'First quarter',
    'Waxing gibbous',
    'Full moon',
    'Waning gibbous',
    'Last quarter',
    'Waning crescent'
  ][Math.round(p * 8) % 8];

/**
 * The week as a bar chart, one bar per day at the height of its score, with
 * dashed lines at its green and amber lines (as the daily score). Each day is a button.
 * score(d), what(d) for the spoken label, extra(d) under the date.
 */
function dayStrip(title, score, what, extra, lines) {
  return `<section class="panel week">${sect(title, 'Tap a day')}
    <div class="strip" style="--n:${state.days.length};--line-go:${lines[0]};--line-amber:${lines[1]}">${state.days
      .map(
        (d, i) => `
    <button class="day ${i === state.sel ? 'on' : ''}" data-act="day" data-i="${i}" aria-pressed="${i === state.sel}"
      aria-label="${longDate(d.d0)}, score ${score(d)} of 100, ${what(d)}">
      <span class="plot" aria-hidden="true"><span class="sc num" style="color:${light(score(d), lines)}">${score(d)}</span>
        <span class="bar" style="--s:${score(d)};--c:${light(score(d), lines)}"></span></span>
      <span class="dow">${d.d0.toLocaleDateString('en-AU', { weekday: 'short' })}</span>
      <span class="dd num">${d.d0.getDate()}/${d.d0.getMonth() + 1}</span>
      ${extra(d)}
    </button>`
      )
      .join('')}</div>
  </section>`;
}

function tideSection(day) {
  return `<section class="tide">
    ${sect('Tide and moon', shortDate(day.d0))}
    <div class="panel chartwrap">${tideSVG(day)}
      <div class="kv">
        <div><div class="k">Range</div><div class="v num">${day.range != null ? day.range.toFixed(1) + ' m' : '—'}</div></div>
        <div><div class="k">Moon</div><div class="v small">${moonPhase(day.moon.phase)}</div></div>
        <div><div class="k">Moon up</div><div class="v num">${hhmm(day.me.rise)}</div></div>
        <div><div class="k">Overhead</div><div class="v num">${hhmm(day.me.over)}</div></div>
        <div><div class="k">Sunrise</div><div class="v num">${hhmm(day.sunrise)}</div></div>
        <div><div class="k">Sunset</div><div class="v num">${hhmm(day.sunset)}</div></div>
        <div><div class="k">Water</div><div class="v num">${day.sst != null ? day.sst.toFixed(1) + '°' : '—'}</div></div>
        <div><div class="k">Bite</div><div class="v num" style="color:${light(day.bite, LINES.bite)}">${day.bite}</div></div>
      </div>
      <p class="sub">Green bands are the major feeding periods, when the moon is directly
      overhead or underfoot. Tide times are modelled 10 km off Burnett Heads rather than official —
      check the MSQ table before you plan a bar crossing.</p>
      ${day.hint ? `<p class="sub hint">${esc(day.hint.text)}</p>` : ''}
    </div>
  </section>`;
}

/** The sessions. `river` adds a note on how river sessions are chosen. */
function flightPlan(ss, river = false) {
  return `<section class="plan">
    ${sect('Flight plan', 'when to go, and what to throw')}
    <div class="panel list">${
      ss.some(s => s.outside)
        ? '<p class="sub lead">Outside is out today, so fish the system instead.</p>'
        : ''
    }${ss
      .map(
        s => `
      <div class="sess">
        <div class="when"><b class="num">${hhmm(s.a)}–${hhmm(s.b)}</b><i>${s.hrs} h · ${s.tide}</i></div>
        <div class="what"><div class="t">${s.title}${s.bar >= 2 ? ' <span class="risk">· bar risk</span>' : ''}</div>
          <div class="d">${s.how}</div>
        </div>
      </div>`
      )
      .join('')}
      ${river ? '<p class="sub foot">Sessions are built on the tide turns and the moon, inside your fishing hours.</p>' : ''}
    </div>
  </section>`;
}

/** What's biting this month, with the bait, lures and the day's notes. */
function whatsBiting(day, zone, river = false) {
  const shut = closedSpecies(day.d0, zone.z);
  const t = techniques(day, river);
  const month = day.d0.toLocaleDateString('en-AU', { month: 'long' });
  return `<section class="biting">
    ${sect("What's biting", esc(month + ' · ' + t.m.t))}
    <div class="panel">
      <div class="fish" style="--fish-cols:${Math.ceil(t.m.sp.length / Math.ceil(t.m.sp.length / 6))}">${t.m.sp
        .map(
          n =>
            `<div class="fc${shut.has(n) ? ' closed' : ''}">${speciesArt(n)}<div class="n">${esc(n)}${shut.has(n) ? '<span class="shut">Closed</span>' : ''}</div></div>`
        )
        .join('')}</div>
      <dl class="dl"><dt>Bait</dt><dd>${t.m.bait.join(' · ')}</dd><dt>Lures</dt><dd>${t.m.lure.join(' · ')}</dd></dl>
      <p class="sub">${t.m.note}</p>
      ${t.mods.length ? `<ul class="tight">${t.mods.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>`;
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

/** Ocean or rivers: one switch at the top of the Forecast tab swaps the whole page. */
function renderPlan() {
  const river = state.view === 'river';
  const btn = (v, label) =>
    `<button data-act="view" data-view="${v}" class="${state.view === v ? 'on' : ''}" aria-pressed="${state.view === v}">${label}</button>`;
  return `<div class="switch" role="group" aria-label="Water">${btn('ocean', 'Ocean')}${btn('river', 'Rivers and creeks')}</div>
  ${river ? renderRiver() : renderOcean()}`;
}

/**
 * The colour of each verdict word. The score colours use the same lines
 * (LINES in util.js), so the daily score and the word always agree; amber covers
 * both middle words, as a red "Marginal" would read as a no-go.
 */
export const VERDICT_COLOUR = {
  Go: 'var(--go)',
  'Worth a look': 'var(--mid)',
  Marginal: 'var(--mid)',
  'River day': 'var(--no)',
  'Good river day': 'var(--go)',
  'Worth a fish': 'var(--mid)',
  Steady: 'var(--mid)',
  Slow: 'var(--no)'
};

/**
 * The verdict beside the daily score. `kicker` is a list of short phrases that
 * wrap whole, so a date never splits across two lines. "River day" is red
 * because the ocean is out, so a small line above it says so: the red must not
 * read as a verdict on the rivers.
 */
function call(kicker, word, why, extra = '') {
  const go = word === 'Go';
  return `<div class="call">
      <span class="kick">${kicker.map(k => `<span>${k}</span>`).join('')}</span>
      ${word === 'River day' ? '<span class="pre">Ocean · No go</span>' : ''}
      <div class="verdict${word.length > 6 ? ' long' : ''}" style="color:${VERDICT_COLOUR[word] || 'var(--paper)'}">${word}${go ? '<small>for launch</small>' : ''}</div>
      <p class="why">${why}</p>${extra}
    </div>`;
}

export const riverWord = s =>
  s >= 70 ? 'Good river day' : s >= 55 ? 'Worth a fish' : s >= 40 ? 'Steady' : 'Slow';

function riverVerdict(day) {
  const s = day.river,
    ri = day.riverInfo;
  const word = riverWord(s);
  const why = ri.runoff
    ? 'Run-off after heavy rain — dirty water. Fish the clean edges and the holes further up.'
    : ri.windStrong
      ? 'Blowing hard even close in. Tuck into the bends and lee banks.'
      : day.range != null && day.range > 2.4
        ? 'Big tides and plenty of water moving — the turns will do the work.'
        : day.range != null && day.range < 1.4
          ? 'Neap tides, so less run. Fish the turns and the deeper structure.'
          : 'Steady tides. Plan around the turns and the moon.';
  return [word, why];
}

/** The rivers and creeks: tide and moon first, weather only when it matters. */
function renderRiver() {
  const day = state.days[state.sel];
  if (!state.zsel || !ZONES.some(z => z.id === state.zsel)) state.zsel = day.zones[0].z.id;
  const zone = day.zones.find(z => z.z.id === state.zsel);
  const est = ESTUARIES.find(e => e.z === zone.z.id) || ESTUARIES[0];
  const ri = day.riverInfo;
  const { turns, majors } = ri;
  const nf = fromNewOrFull(day.moon.phase);
  const closed = activeClosures(day.d0, zone.z);
  const kind =
    day.range == null ? 'no curve' : day.range > 2.4 ? 'springs' : day.range < 1.4 ? 'neaps' : 'mid-range';
  const rows = [
    [
      'Tide',
      day.range == null || day.range < 1.4 ? 'hold' : 'go',
      day.range != null ? day.range.toFixed(1) + ' m · ' + kind : kind
    ],
    // a key holds a short figure; the times are on the tide chart just below
    [
      'Turns',
      turns.length >= 2 ? 'go' : turns.length ? 'hold' : 'nogo',
      turns.length ? turns.length + (turns.length === 1 ? ' turn' : ' turns') : 'none',
      turns.length
        ? turns.map(t => (t.hi ? 'high ' : 'low ') + hhmm(t.t)).join(' · ')
        : 'none in fishing hours'
    ],
    ['Moon', nf < 0.12 ? 'go' : 'hold', moonPhase(day.moon.phase)],
    [
      'Feeding',
      majors.length ? 'go' : 'hold',
      majors.length ? majors.map(hhmm).join(' · ') : 'none',
      majors.length ? '' : 'outside fishing hours'
    ],
    [
      'Water',
      ri.runoff ? 'hold' : 'go',
      ri.runoff ? 'run-off' : ri.rain72 >= 5 ? Math.round(ri.rain72) + ' mm rain' : 'clean',
      ri.runoff
        ? 'run-off · ' + Math.round(ri.rain72) + ' mm in 3 days'
        : ri.rain72 >= 5
          ? Math.round(ri.rain72) + ' mm in 3 days'
          : ''
    ],
    ['Wind', ri.windStrong ? 'hold' : 'go', Math.round(ri.windIn) + ' kn close in'],
    ['Rules', closed.length ? 'hold' : 'go', closed.length ? closed.length + ' closed' : 'all open']
  ];
  const [word, why] = riverVerdict(day);
  return `${banners(day)}
  <div class="deck river">
    <div class="col col-a">
      <section class="panel hero">${dailyScore(day.river, 'Daily score', LINES.river)}
        ${call([esc(shortDate(day.d0)), esc(est.name)], word, why)}
      </section>
      ${dayStrip(
        '7-day forecast',
        d => d.river,
        () => 'rivers and creeks',
        d =>
          `<span class="odds${d.riverInfo.runoff ? ' runoff' : ''}">${d.riverInfo.runoff ? 'run-off' : '&nbsp;'}</span>`,
        LINES.river
      )}
    </div>
    <section class="advsec">${advisoryHTML(rows, 'River caution and advisory panel for ' + est.name)}</section>
    <div class="col col-c">
      <section>
        ${sect('Rivers and creeks', esc(longDate(day.d0)))}
        <div class="panel list">
          ${ESTUARIES.map(
            e => `<button class="zone ${e.z === state.zsel ? 'on' : ''}" data-act="zone" data-z="${e.z}" aria-pressed="${e.z === state.zsel}">
              <span class="zb"><span class="t">${esc(e.name)}</span><span class="d">${esc(e.d)}</span></span>
            </button>`
          ).join('')}
          <div class="links pad">
            <a href="https://www.msq.qld.gov.au/Tides/Tide-tables" target="_blank" rel="noopener">MSQ tide tables</a>
            <a href="https://www.bom.gov.au/australia/radar/" target="_blank" rel="noopener">BOM radar</a>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${zone.z.mlat},${zone.z.mlon}" target="_blank" rel="noopener">Directions</a>
          </div>
        </div>
      </section>
    </div>
    ${notes(closuresCard(day, zone))}
    <div class="grid">
      ${tideSection(day)}
      ${flightPlan(sessions(day, zone, est), true)}
      ${whatsBiting(day, zone, true)}
    </div>
  </div>`;
}

function renderOcean() {
  const { cfg, days } = state;
  const day = days[state.sel];
  if (!state.zsel || !day.zones.some(z => z.z.id === state.zsel)) state.zsel = day.zones[0].z.id;
  const zone = day.zones.find(z => z.z.id === state.zsel);
  const best = day.zones[0];
  const [word, why] = verdict(day.overall, day.river);
  const ss = sessions(day, zone),
    ln = launchNotes(zone, cfg);
  const bom = BOM_ZONES[zone.z.bom];

  // the best ramp's figures for the day, beside the call: the hero's empty half
  // was the best spot on the screen. The ramp is only coloured when it is a go
  // or a maybe; on a no-go day a red "best ramp" would read as "launch here".
  const rampKey = lightKey(best.score, LINES.ocean);
  const readout = `<dl class="readout">
      <div class="wide"><dt>Best ramp</dt><dd${rampKey !== 'r' ? ` class="${rampKey}"` : ''}>${esc(short(best.z.name))}</dd></div>
      <div><dt>Swell</dt><dd class="num">${span(best.swell, best.swellMax)} m${best.period ? ` · ${Math.round(best.period)} s` : ''}</dd></div>
      <div><dt>Wind</dt><dd class="num">${span(best.wind, best.windMax, 0)} kn ${dirOf(best.wdir)}</dd></div>
      <div><dt>Gusts</dt><dd class="num">${Math.round(best.gust)} kn</dd></div>
      <div><dt>Close in</dt><dd class="num">${best.swellIn.toFixed(1)} m</dd></div>
      <div><dt>At 20 km</dt><dd class="num">${best.swell20.toFixed(1)} m</dd></div>
      ${best.swellChkMax - best.swellMax >= 0.05 ? `<div><dt>Counts as</dt><dd class="num">${best.swellChkMax.toFixed(1)} m</dd></div>` : ''}
      ${best.chop >= 0.3 ? `<div><dt>Chop</dt><dd class="num">${best.chop.toFixed(1)} m</dd></div>` : ''}
      ${best.barMax >= 2 ? '<div class="wide"><dt>Bar</dt><dd class="r">Wind against tide</dd></div>' : ''}
    </dl>`;

  return `${banners(day)}${freshGoBanner()}
  <div class="deck ocean">
    <div class="col col-a">
      <section class="panel hero">${dailyScore(day.overall, 'Daily score', LINES.ocean, [
        ['Launch', best.score, LINES.ocean],
        ['Bite', day.bite, LINES.bite]
      ])}
        ${call(
          ["Flight director's call", esc(shortDate(day.d0))],
          word,
          why + (day.caps.length ? ' Capped: ' + esc(day.caps.join('; ')) + '.' : ''),
          readout
        )}
      </section>
      ${dayStrip(
        '7-day forecast',
        d => d.overall,
        d => `${d.zones[0].goodHrs} hours inside your limits`,
        d => windowTrack(d) + `<span class="odds num">${d.prob != null ? d.prob + '%' : '&nbsp;'}</span>`,
        LINES.ocean
      )}
    </div>

    <div class="tmsec">${countdown()}</div>

    <section class="advsec">${cautionPanel(day, best)}</section>

    <section class="col col-b mapsec">
      ${sect('Launch control', esc(shortDate(day.d0)))}
      <div class="mapwrap">${mapSVG(day, state.zsel)}</div>
      <div class="legend">
        <span><i style="background:var(--go)"></i>Go</span>
        <span><i style="background:var(--mid)"></i>Hold</span>
        <span><i style="background:var(--no)"></i>No go</span>
        <span><i class="range"></i>Your 20 km range</span>
        <span class="hintx">Tap a ramp to plan around it</span>
      </div>
    </section>

    <div class="col col-c">
      <section>
        ${sect('Launch sites', esc(longDate(day.d0)))}
        <div class="panel list">
          ${day.zones
            .map(
              z => `
            <button class="zone ${z.z.id === state.zsel ? 'on' : ''}" data-act="zone" data-z="${z.z.id}" aria-pressed="${z.z.id === state.zsel}">
              <span class="zsc num" style="color:${light(z.score, LINES.ocean)}">${z.score}</span>
              <span class="zb">
                <span class="t">${esc(z.z.name)}</span>
                <span class="d">${esc(z.z.ramp)}</span>
                <span class="tags">${rampTags(day, z, cfg)}</span>
              </span>
            </button>`
            )
            .join('')}
          <div class="brief">
            <h3>Site brief · ${esc(short(zone.z.name))}</h3>
            <p class="sub">${esc(zone.z.grounds)}</p>
            ${ln.length ? `<ul class="tight">${ln.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            <p class="sub">Rivers and creeks today
              <b style="color:${light(day.river, LINES.river)}">${day.river}/100</b>.</p>
            <div class="links">
              <button data-act="view" data-view="river">River view</button>
              <a href="${bom[1]}" target="_blank" rel="noopener">${bom[0]}</a>
              <a href="https://www.windy.com/-Waves-waves?waves,${zone.z.mlat},${zone.z.mlon},9" target="_blank" rel="noopener">Windy at ${esc(short(zone.z.name))}</a>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${zone.z.mlat},${zone.z.mlon}" target="_blank" rel="noopener">Directions</a>
            </div>
          </div>
        </div>
      </section>
    </div>
    ${notes(barCard(zone), closuresCard(day, zone))}

    <div class="grid">
  <div class="gstack">
  <section class="cond">
    ${sect('Conditions', '10–20 km off ' + esc(short(zone.z.name)))}
    <div class="panel chartwrap">${condChart(zone, cfg)}
      <div class="legend key">
        <span><i class="ln sw"></i>Swell</span>
        <span><i class="ln wd"></i>Wind</span>
        <span><i class="ln gu"></i>Gusts</span>
        <span><i class="bx ok"></i>In limits</span>
        <span><i class="bx st"></i>Storm</span>
      </div>
      <p class="sub">Swell is the figure checked against your limit (weighted for period, never less than
      the forecast height) and read on the left scale, wind and gusts on the
      right. Dashed lines are your limits; green shading marks every hour that clears all three,
      white hatching any hour with a storm forecast. Figures are the worst of the 10, 15 and 20 km
      points on the bearing you run out on —
      ${zone.period ? `period today is around ${Math.round(zone.period)} seconds, ${seaWord(zone.period)}` : 'period data is missing today'}.</p>
    </div>
  </section>

  ${tideSection(day)}
  </div>

  <div class="gmain">
  ${flightPlan(ss)}
  ${whatsBiting(day, zone)}

  <section class="checks">
    ${sect('Pre-launch checks')}
    <div class="panel">
      ${
        day.prob != null
          ? `<p class="sub"><b style="color:${LAMP_COLOUR[modelsLamp(day)[0]]}">${day.prob}%</b> of ${day.ensembleMembers} ensemble
        runs give at least ${TUNING.minWindowHours} hours in a row inside your limits at ${esc(short(best.z.name))}${zone.prob != null && zone.z.id !== best.z.id ? `, and ${zone.prob}% at ${esc(short(zone.z.name))}` : ''}.
        ${day.prob >= TUNING.ensembleTrusted ? 'That is a solid bet this far out.' : day.prob >= TUNING.lowProbability ? 'Genuinely borderline — worth looking again tomorrow.' : 'Most runs say you get nothing, so plan around it.'}</p>`
          : '<p class="sub">No ensemble data today, so there is no probability figure. Lean on the model agreement below.</p>'
      }
      <p class="sub">${
        day.agree.windModels > 1
          ? `Compared across ${day.agree.windModels} wind models${day.agree.waveModels > 1 ? ' and ' + day.agree.waveModels + ' swell models' : ''}. Wind spread ${day.agree.wSpread.toFixed(1)} kn${day.agree.sSpread != null ? ', swell spread ' + day.agree.sSpread.toFixed(2) + ' m' : ''}. ${day.agree.level === 'low' ? 'That is a wide spread, so treat this day as unsettled and look again the morning of.' : day.agree.level === 'fair' ? 'Reasonable agreement — worth a second look the day before.' : 'Tight agreement, which is about as confident as a week-out forecast gets.'}`
          : 'Only one model responded, so there is no cross-check today. Lean on the links below.'
      }</p>
      <div class="links">${SOURCES.slice(0, TOP_SOURCES).map(sourceLink).join('')}</div>
      <details data-key="links"><summary><span>More links</span><b class="num">${SOURCES.length - TOP_SOURCES} more</b></summary>
        <div class="links">${SOURCES.slice(TOP_SOURCES).map(sourceLink).join('')}</div>
      </details>
      ${sourceStatus()}
      ${alertsPanel()}
      <details data-key="limits">
        <summary><span>Your limits</span><b class="num">${cfg.maxSwell} m · ${cfg.maxWind} kn · ${cfg.maxGust} kn</b></summary>
        <div class="limits">
          <label>Swell (m)<input type="number" inputmode="decimal" step="0.1" min="0.1" max="6" id="s1" value="${cfg.maxSwell}"></label>
          <label>Wind (kn)<input type="number" inputmode="numeric" min="1" max="60" id="s2" value="${cfg.maxWind}"></label>
          <label>Gusts (kn)<input type="number" inputmode="numeric" min="1" max="80" id="s3" value="${cfg.maxGust}"></label>
        </div>
        <button class="save wide" data-act="saveLimits">Save limits</button>
        <p class="sub">Short, steep swell counts as more than its height before it meets your limit, so
        0.6 m at 5 seconds counts as roughly 0.8 m. Long, lazy swell never counts as less than its height:
        anything over your limit is a no go whatever its period. Wind and gusts are compared as
        forecast — no allowance for shelter — and an hour with no wind or gust figure counts as outside them.</p>
      </details>
    </div>
  </section>
  </div>
    </div>
    <footer>
      Forecasts from Open-Meteo: wind from its best-match model with ECMWF IFS 9 km, NOAA GFS and DWD ICON as
      cross-checks; swell from its best-match wave model with ECMWF WAM, NOAA GFS-Wave and Météo-France as
      cross-checks; probability from the ECMWF and NOAA ensembles. Each ramp is sampled at 2, 10, 15 and 20 km
      offshore along its run-out bearing and scored on the worst of the outer three. Sun and moon are computed
      on the device. Version ${APP_VERSION}. Scores are a filter, not a forecast — the skipper's call is the only one that counts.
      <br><a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0).
      Coastline from <a href="https://www.soest.hawaii.edu/pwessel/gshhg/" target="_blank" rel="noopener">GSHHG</a> (Wessel and Smith, LGPL).
    </footer>
  </div>`;
}

function renderLog() {
  const today = isoDay(new Date());
  const d = state.logDraft || {
    date: today,
    ramp: state.zsel || ZONES[0].id,
    picked: [],
    rating: 2,
    notes: ''
  };
  // this month's species first, ocean then rivers, then the rest of the year's
  const mo = new Date().getMonth();
  const year = [SEASON, RIVER_SEASON].flatMap(t => Object.values(t).flatMap(m => m.sp));
  const allSpecies = [...new Set([...SEASON[mo].sp, ...RIVER_SEASON[mo].sp, ...year])];
  const pat = patterns(state.log);
  const cap = k => k.charAt(0).toUpperCase() + k.slice(1);
  const rampName = id => (ZONES.find(z => z.id === id) || { name: id }).name;
  return `<div class="pages">
  <section>
    ${sect('Log a session', state.log.length + (state.log.length === 1 ? ' session' : ' sessions'))}
    <div class="panel bracket stack">
      <div class="form">
        <div><label for="ld">Date</label><input id="ld" type="date" max="${today}" value="${esc(d.date)}"></div>
        <div><label for="lr">Ramp</label><select id="lr">${ZONES.map(
          z => `<option value="${z.id}" ${z.id === d.ramp ? 'selected' : ''}>${esc(z.name)}</option>`
        ).join('')}</select></div>
        <div class="wide"><span class="lab" id="lcaught">What you caught</span>
          <div class="chips" role="group" aria-labelledby="lcaught">${allSpecies
            .map(
              n =>
                `<button data-act="logSp" data-name="${esc(n)}" class="${d.picked.includes(n) ? 'on' : ''}" aria-pressed="${d.picked.includes(n)}">${esc(n)}</button>`
            )
            .join('')}</div></div>
        <div class="wide"><span class="lab" id="lrate">How it went</span>
          <div class="rate" role="group" aria-labelledby="lrate">${RATINGS.map(
            (r, i) =>
              `<button data-act="rate" data-rating="${i}" class="${i === d.rating ? 'on' : ''}" aria-pressed="${i === d.rating}">${r}</button>`
          ).join('')}</div></div>
        <div class="wide"><label for="lnotes">Notes</label><input id="lnotes" value="${esc(d.notes)}" placeholder="Last of the run-out, 3in paddle tail"></div>
        <div class="wide"><button class="save solid wide" data-act="addLog">Save session</button></div>
      </div>
      <p class="sub">Conditions are stamped on the entry automatically for today and the
      two days before — tide phase, moon, wind and swell. Older sessions get the moon only.</p>
    </div>
  </section>

    ${
      pat
        ? `<section>${sect('What your log says', 'average out of 3')}
    <div class="panel stack">
      ${[
        ['tide', 'Tide'],
        ['moon', 'Moon'],
        ['ramp', 'Ramp'],
        ['wind', 'Wind from']
      ]
        .map(([k, lab]) => {
          const rows = pat[k];
          if (!rows || !rows.length) return '';
          return `<div class="pat"><span class="lab">${lab}</span>${rows
            .slice(0, 4)
            .map(r => {
              const c = light((r.avg / 3) * 100);
              return `<div class="pat-row"><span>${esc(k === 'ramp' ? short(rampName(r.k)) : cap(k === 'moon' ? moonLabel(r.k) : String(r.k)))}</span>
              <span class="pat-bar" aria-hidden="true"><i style="width:${Math.round((r.avg / 3) * 100)}%;background:${c}"></i></span>
              <span class="num" style="color:${c}">${r.avg.toFixed(1)} · ${r.n}</span></div>`;
            })
            .join('')}</div>`;
        })
        .join('')}
      ${
        pat.species.length
          ? `<div class="pat"><span class="lab">Most logged</span>
        <div class="bars">${pat.species.map(([n, c]) => `<span>${esc(n)} × ${c}</span>`).join('')}</div></div>`
          : ''
      }
      <p class="sub">Each row is the average rating, then the number of sessions. Once a pattern has enough sessions
      behind it, it nudges the bite score by a few points either way. It never touches the safety side — wind,
      swell and bar calls stay as they are.</p>
    </div></section>`
        : `<section>${sect('What your log says')}<div class="panel"><p class="sub">Log four or more sessions and this turns into your own pattern
      summary — which tide, moon and ramp actually produce for you.</p></div></section>`
    }

    ${
      state.log.length
        ? `<section class="span">${sect('Your sessions', state.log.length + (state.log.length === 1 ? ' session' : ' sessions'))}
    <div class="panel list">${state.log
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40)
      .map(e => logRow(e))
      .join('')}</div></section>`
        : ''
    }
  </div>`;
}

/** One catch-log entry, with its stamped conditions; `del` adds its Delete button. */
function logRow(e, del = true) {
  const rampName = id => (ZONES.find(z => z.id === id) || { name: id }).name;
  return `
      <div class="entry" style="--c:${light((e.rating / 3) * 100)}">
        <div class="h"><b class="num">${esc(e.date)}</b>
          <span class="r">${RATINGS[e.rating] || ''}</span>
          <span class="where">${esc(rampName(e.ramp))}</span></div>
        ${e.species ? `<div class="sp-l">${esc(e.species)}</div>` : ''}
        <div class="m">${[
          e.tide && e.tide !== 'unknown' ? esc(e.tide) : null,
          esc(moonLabel(e.moon)) + ' moon',
          e.wind != null ? Math.round(e.wind) + ' kn ' + esc(e.windDir || '') : null,
          e.swell != null
            ? 'swell ' + (+e.swell).toFixed(1) + ' m'
            : e.sea != null
              ? 'sea ' + (+e.sea).toFixed(1) + ' m'
              : null,
          e.notes ? esc(e.notes) : null
        ]
          .filter(Boolean)
          .join(' · ')}</div>
        ${del ? `<button data-act="delLog" data-id="${esc(e.id)}" class="del">Delete</button>` : ''}
      </div>`;
}

/* ── Flight log: the last three years ─────────────────────────────────── */

const DATA_CACHE = 'fishin-data'; // the service worker's store for fetched data (DATA in sw.js)
const HISTORY_STALE_MS = 6 * HOUR;

/**
 * The stored history, fetched the first time the tab opens in a session.
 * Offline, the service worker answers with the phone's saved copy.
 */
export async function loadHistory() {
  const h = state.hist;
  if (h.status === 'loading') return;
  h.status = 'loading';
  const res = await attempt(summaryUrl());
  const data = res.ok ? readSummary(res.json[0]) : null;
  if (data && data.days.length) {
    data.byDs = new Map(data.days.map(d => [d.ds, d]));
    const first = data.days[0].ds,
      last = data.days[data.days.length - 1].ds;
    Object.assign(h, {
      status: 'ready',
      data,
      error: null,
      cached: !!res.cached,
      first,
      last,
      at: Date.now()
    });
    if (!h.ds || h.ds > last || h.ds < first) h.ds = last;
    forgetOldMonths(first);
  } else if (h.data) {
    h.status = 'ready'; // a failed top-up keeps what is already showing
  } else {
    h.status = 'error';
    h.error = res.ok ? 'the history file could not be read' : res.error;
  }
  if (state.tab === 'history') render();
}

/** One month's hours, for the Day view; fetched once and kept for the session. */
async function loadMonth(ym) {
  const h = state.hist;
  if (h.months[ym]) return;
  h.months[ym] = 'loading';
  const res = await attempt(hoursUrl(ym));
  h.months[ym] = res.ok && res.json[0] && res.json[0].days ? res.json[0] : 'error';
  if (state.tab === 'history') render();
}

/** Month files saved on the phone that the history no longer reaches are deleted. */
async function forgetOldMonths(first) {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(DATA_CACHE);
    for (const req of await c.keys()) {
      const m = /\/hours\/(\d{4}-\d\d)\.json$/.exec(req.url);
      if (m && m[1] < first.slice(0, 7)) await c.delete(req);
    }
  } catch (e) {
    /* storage unavailable: nothing to tidy */
  }
}

const monthName = (ym, style = 'long') =>
  localDate(ym + '-01').toLocaleDateString('en-AU', { month: style, year: 'numeric' });
const dayMonth = ds => localDate(ds).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
/** "6–12 Oct 2026", or across a month "29 Sep – 5 Oct 2026". */
const weekLabel = (a, b) =>
  (a.slice(0, 7) === b.slice(0, 7) ? +a.slice(8) + '–' + dayMonth(b) : dayMonth(a) + ' – ' + dayMonth(b)) +
  ' ' +
  b.slice(0, 4);
const rampShort = id => short((ZONES.find(z => z.id === id) || { name: id }).name);

/** The word for a past score: the daily verdict, or Go / Hold / No go for one ramp. */
function pastWord(score, rampId, river) {
  if (!rampId) return verdict(score, river)[0];
  return score >= LINES.ocean[0] ? 'Go' : score >= LINES.ocean[1] ? 'Hold' : 'No go';
}

/** What the day came to, in one line. */
function pastWhy(d, rampId) {
  const z = rampOf(d, rampId);
  return z.win
    ? `Longest window ${z.win.toFixed(1)} hours at ${esc(rampShort(z.id))}, inside the standard limits.`
    : `No ${TUNING.minWindowHours}-hour window inside the standard limits at ${rampId ? esc(rampShort(z.id)) : 'any ramp'}.`;
}

/** A small marker for a day with a session in the catch log. */
const LOGGED = '<i class="logged" aria-hidden="true"></i>';

/*
 * On a phone the Flight log is one column, its parts placed by their CSS
 * order; on a wide screen each view's parts sit in two columns (.hcol), so the
 * calendar can stand beside the month's summary and chart.
 */

/**
 * The period at a glance: its average score (the period's colour, on the
 * forecast's own lines), and a bar split into Go, in-between and no-go days.
 */
function periodHead(t, rampId, label) {
  if (!t.n)
    return '<div class="panel" style="order:1"><p class="sub">Nothing stored for this stretch.</p></div>';
  const c = light(t.avg, LINES.ocean);
  const w = n => ((100 * n) / t.n).toFixed(1) + '%';
  return `<div class="panel hsum" style="--c:${c};order:1">
    <div class="hsum-avg"><b class="num">${t.avg}</b><span>${label}</span></div>
    <div class="hsum-main">
      <div class="split" role="img" aria-label="${t.go} go days, ${t.amber} in between, ${t.red} no go, of ${t.n}">
        <i style="width:${w(t.go)};background:var(--go)"></i><i style="width:${w(t.amber)};background:var(--mid)"></i><i style="width:${w(t.red)};background:var(--no)"></i>
      </div>
      <p class="hsum-k num"><span style="color:var(--go)">${t.go} go</span><span style="color:var(--mid)">${t.amber} in between</span><span style="color:var(--no)">${t.red} no go</span></p>
      ${t.n > 1 ? `<button class="hlink" data-act="histDay" data-id="${t.best.ds}">Best: ${esc(shortDate(t.best.d0))} · ${scoreOf(t.best, rampId)}</button>` : ''}
    </div>
  </div>`;
}

/**
 * A run of days as a chart: the strongest gust, the average wind and the
 * highest swell each day, against the standard limits, with green behind
 * every day that had a launch window. Drawn like the forecast's hourly chart.
 */
function daysChart(list, rampId, tick) {
  const W = 420,
    H = 170,
    P = 22;
  const n = list.length;
  const x = i => P + ((W - P * 2) * (i + 0.5)) / n;
  const bw = (W - P * 2) / n;
  const figs = list.map(({ d }) => (d ? rampOf(d, rampId) : null));
  const maxS = Math.max(1.2, ...figs.filter(Boolean).map(f => f.swellMax / 100));
  const maxW = Math.max(18, ...figs.filter(Boolean).map(f => f.gust));
  const sy = v => H - 16 - (H - 44) * clamp(v / maxS, 0, 1),
    wy = v => H - 16 - (H - 44) * clamp(v / maxW, 0, 1);
  // a line through the days that have figures, broken where a day is missing
  const line = (f, y) => {
    let out = '',
      pen = false;
    figs.forEach((g, i) => {
      if (!g) return (pen = false);
      out += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(f(g)).toFixed(1) + ' ';
      pen = true;
    });
    return out;
  };
  const bands = figs
    .map((g, i) =>
      g && g.win
        ? `<rect x="${(P + i * bw).toFixed(1)}" y="8" width="${bw.toFixed(1)}" height="${H - 24}" fill="var(--go)" opacity=".11"/>`
        : ''
    )
    .join('');
  const dots = figs
    .map((g, i) =>
      g && n <= 7 ? `<circle cx="${x(i)}" cy="${sy(g.swellMax / 100)}" r="2.6" fill="var(--sky)"/>` : ''
    )
    .join('');
  const txt = (xx, y, anchor, colour, s) =>
    `<text x="${xx}" y="${y}" text-anchor="${anchor}" font-size="10.5" fill="${colour}" font-family="Space Grotesk,sans-serif">${s}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Swell, wind and gusts each day">
   <rect x="${P}" y="8" width="${W - P * 2}" height="${H - 24}" fill="rgba(0,0,0,.22)"/>
   ${bands}
   ${txt(P + 3, 22, 'start', 'var(--sky)', maxS.toFixed(1) + ' m')}${txt(W - P - 3, 22, 'end', 'var(--mid)', Math.round(maxW) + ' kn')}
   <line x1="${P}" x2="${W - P}" y1="${sy(DEFAULTS.maxSwell)}" y2="${sy(DEFAULTS.maxSwell)}" stroke="var(--sky)" stroke-opacity=".45" stroke-dasharray="2 4"/>
   <line x1="${P}" x2="${W - P}" y1="${wy(DEFAULTS.maxWind)}" y2="${wy(DEFAULTS.maxWind)}" stroke="var(--no)" stroke-opacity=".35" stroke-dasharray="2 4"/>
   <path d="${line(g => g.gust, wy)}" fill="none" stroke="var(--no)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>
   <path d="${line(g => g.wind, wy)}" fill="none" stroke="var(--mid)" stroke-width="2"/>
   <path d="${line(g => g.swellMax / 100, sy)}" fill="none" stroke="var(--sky)" stroke-width="2.4"/>
   ${dots}
   ${list.map(({ ds }, i) => (tick(ds, i) ? txt(x(i), H - 2, 'middle', '#95b8cd', tick(ds, i)) : '')).join('')}
  </svg>`;
}

/** The legend under a chart of days. */
const DAYS_KEY = `<div class="legend key">
    <span><i class="ln sw"></i>Highest swell</span>
    <span><i class="ln wd"></i>Average wind</span>
    <span><i class="ln gu"></i>Strongest gust</span>
    <span><i class="bx ok"></i>Had a window</span>
  </div>`;

function histDay(d, rampId) {
  const h = state.hist;
  if (!d)
    return `<div class="hcol"><div class="panel"><p class="sub">Nothing stored for this day: the archive had holes in its figures, so it is left out rather than guessed.</p></div></div>`;
  const ym = d.ds.slice(0, 7);
  const month = h.months[ym];
  if (!month) queueMicrotask(() => loadMonth(ym));
  const zid = rampId || d.bestId;
  const zi = ZONES.findIndex(z => z.id === zid);
  const ready = month && typeof month === 'object';
  const zh = ready ? rampHours(month, d.ds, zi) : null;
  const day = ready ? dayTides(month, d.ds) : null;
  const f = rampOf(d, rampId);
  const score = scoreOf(d, rampId);
  const word = pastWord(score, rampId, d.river);
  const best = rampOf(d, null);
  const win = zh && zh.win.length ? zh.win.map(w => hhmm(w.a) + '–' + hhmm(w.b)).join(', ') : null;
  const sessions = state.log.filter(e => e.date === d.ds);

  return `<div class="hcol"><section class="panel hero">${dailyScore(
    score,
    rampId ? 'Launch score' : 'Daily score',
    LINES.ocean,
    rampId
      ? []
      : [
          ['Launch', best.score, LINES.ocean],
          ['Bite', d.bite, LINES.bite]
        ]
  )}
      ${call(
        ['Looking back', esc(shortDate(d.d0)) + ' ' + d.ds.slice(0, 4)],
        word,
        pastWhy(d, rampId),
        `<dl class="readout">
          <div class="wide"><dt>${rampId ? 'Ramp' : 'Best ramp'}</dt><dd>${esc(rampShort(zid))}</dd></div>
          <div><dt>Swell</dt><dd class="num">${zid === d.bestId ? span(d.swell / 100, f.swellMax / 100) : 'to ' + (f.swellMax / 100).toFixed(1)} m${d.period && zid === d.bestId ? ` · ${d.period} s` : ''}</dd></div>
          <div><dt>Wind</dt><dd class="num">${f.wind} kn${zid === d.bestId ? ' ' + dirOf(d.wdir) : ''}</dd></div>
          <div><dt>Gusts</dt><dd class="num">${f.gust} kn</dd></div>
          ${win ? `<div class="wide"><dt>Window</dt><dd class="g num">${win}</dd></div>` : ''}
        </dl>`
      )}
    </section>

    <section class="cond">
      ${sect('Conditions', '10–20 km off ' + esc(rampShort(zid)))}
      <div class="panel chartwrap">${
        zh
          ? condChart(zh, DEFAULTS) +
            `<div class="legend key">
          <span><i class="ln sw"></i>Swell</span>
          <span><i class="ln wd"></i>Wind</span>
          <span><i class="ln gu"></i>Gusts</span>
          <span><i class="bx ok"></i>In limits</span>
          <span><i class="bx st"></i>Storm</span>
        </div>`
          : `<p class="sub">${
              month === 'error'
                ? 'The hours for this day could not be loaded. <button class="hlink" data-act="histRetry">Try again</button>'
                : ready
                  ? 'No hours are stored for this day.'
                  : 'Loading the hours…'
            }</p>`
      }</div>
    </section></div>

    <div class="hcol"><section>
      ${sect('Launch sites', 'tap one to look at it')}
      <div class="panel list">${ZONES.map((z, i) => {
        const r = d.ramps[i];
        const on = z.id === zid;
        return `<button class="zone ${on ? 'on' : ''}" data-act="histRamp" data-z="${z.id}" aria-pressed="${on}">
          <span class="zsc num" style="color:${light(r.score, LINES.ocean)}">${r.score}</span>
          <span class="zb"><span class="t">${esc(z.name)}</span>
            <span class="tags">${r.win ? `<span class="tag ok">window ${r.win.toFixed(1)} h</span>` : '<span class="tag">no window</span>'}<span class="tag">${r.wind} kn · gusts ${r.gust}</span><span class="tag">swell to ${(r.swellMax / 100).toFixed(1)} m</span></span></span>
        </button>`;
      }).join('')}</div>
    </section>

    <section class="tide">
      ${sect('Tide, moon and rivers')}
      <div class="panel">
        <div class="kv">
          <div><div class="k">Range</div><div class="v num">${d.range != null ? (d.range / 100).toFixed(1) + ' m' : '—'}</div></div>
          <div><div class="k">Moon</div><div class="v small">${moonPhase(d.moon / 100)}</div></div>
          <div><div class="k">Sunrise</div><div class="v num">${(day && day.sr) || '—'}</div></div>
          <div><div class="k">Sunset</div><div class="v num">${(day && day.ss) || '—'}</div></div>
          <div><div class="k">Water</div><div class="v num">${d.sst != null ? (d.sst / 10).toFixed(1) + '°' : '—'}</div></div>
          <div><div class="k">Rain</div><div class="v num">${(d.rain / 10).toFixed(1)} mm</div></div>
          <div><div class="k">Rivers</div><div class="v num" style="color:${light(d.river, LINES.river)}">${d.river}</div></div>
          <div><div class="k">Bite</div><div class="v num" style="color:${light(d.bite, LINES.bite)}">${d.bite}</div></div>
        </div>
        ${day && day.tides.length ? `<p class="sub">${day.tides.map(t => `${t.hi ? 'High' : 'Low'} ${t.t} · ${t.v.toFixed(1)} m`).join('&ensp;')}</p>` : ''}
      </div>
    </section>

    ${
      sessions.length
        ? `<section>${sect('Your sessions this day')}
      <div class="panel list">${sessions.map(e => logRow(e, false)).join('')}</div></section>`
        : ''
    }</div>`;
}

function histWeek(from, rampId, logged) {
  const h = state.hist;
  const list = Array.from({ length: 7 }, (_, i) => addDays(from, i)).map(ds => ({
    ds,
    d: h.data.byDs.get(ds)
  }));
  const t = tally(list.map(x => x.d).filter(Boolean), rampId);
  const dow = ds => localDate(ds).toLocaleDateString('en-AU', { weekday: 'short' });
  return `<div class="hcol">${periodHead(t, rampId, 'week avg')}
  <section class="panel week" style="order:2">${sect('The week', 'Tap a day')}
    <div class="strip" style="--n:7;--line-go:${LINES.ocean[0]};--line-amber:${LINES.ocean[1]}">${list
      .map(({ ds, d }) => {
        const dd = localDate(ds);
        if (!d)
          return `<span class="day none"><span class="plot"></span><span class="dow">${dow(ds)}</span><span class="dd num">${dd.getDate()}/${dd.getMonth() + 1}</span></span>`;
        const s = scoreOf(d, rampId);
        return `<button class="day" data-act="histDay" data-id="${ds}" aria-label="${longDate(dd)}, score ${s} of 100${logged.has(ds) ? ', session logged' : ''}">
          <span class="plot" aria-hidden="true"><span class="sc num" style="color:${light(s, LINES.ocean)}">${s}</span>
            <span class="bar" style="--s:${s};--c:${light(s, LINES.ocean)}"></span></span>
          <span class="dow">${dow(ds)}</span>
          <span class="dd num">${dd.getDate()}/${dd.getMonth() + 1}</span>
          ${logged.has(ds) ? LOGGED : ''}
        </button>`;
      })
      .join('')}</div>
  </section></div>
  <div class="hcol"><section class="cond" style="order:3">${sect('Conditions', rampId ? esc(rampShort(rampId)) : 'best ramp each day')}
    <div class="panel chartwrap">${daysChart(list, rampId, ds => dow(ds))}${DAYS_KEY}</div>
  </section></div>`;
}

function histMonth(ym, rampId, logged) {
  const h = state.hist;
  const first = localDate(ym + '-01');
  const lead = (first.getDay() + 6) % 7; // Monday first
  const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const list = Array.from({ length: n }, (_, k) => {
    const ds = ym + '-' + pad(k + 1);
    return { ds, d: h.data.byDs.get(ds) };
  });
  const t = tally(list.map(x => x.d).filter(Boolean), rampId);
  const cells = Array.from({ length: lead }, () => '<span class="cal-c blank"></span>');
  list.forEach(({ ds, d }, k) => {
    // a day still to come is faint; a day the archive could not fill is marked as empty
    if (!d)
      return cells.push(
        `<span class="cal-c ${ds > h.last ? 'future' : 'none'}"><span class="cal-d num">${k + 1}</span></span>`
      );
    const s = scoreOf(d, rampId);
    cells.push(`<button class="cal-c" style="--c:${light(s, LINES.ocean)}" data-act="histDay" data-id="${ds}"
      aria-label="${longDate(d.d0)}, score ${s}${logged.has(ds) ? ', session logged' : ''}">
      <span class="cal-d num">${k + 1}</span><b class="num">${s}</b>${logged.has(ds) ? LOGGED : ''}</button>`);
  });
  return `<div class="hcol"><section class="panel cal" style="order:2">
    <div class="cal-g">
      ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span class="cal-h" aria-hidden="true">${x}</span>`).join('')}
      ${cells.join('')}
    </div>
    <div class="legend">
      <span><i style="background:var(--go)"></i>Go</span>
      <span><i style="background:var(--mid)"></i>In between</span>
      <span><i style="background:var(--no)"></i>No go</span>
      <span>${LOGGED}Session logged</span>
    </div>
  </section></div>
  <div class="hcol">${periodHead(t, rampId, 'month avg')}
  <section class="cond" style="order:3">${sect('Conditions', rampId ? esc(rampShort(rampId)) : 'best ramp each day')}
    <div class="panel chartwrap">${daysChart(list, rampId, (ds, i) => ([0, 7, 14, 21, 28].includes(i) ? String(i + 1) : ''))}${DAYS_KEY}</div>
  </section></div>`;
}

function histYear(year, rampId) {
  const h = state.hist;
  const months = yearMonths(h.data.days, year, rampId);
  const t = tally(
    h.data.days.filter(d => d.ds.startsWith(year)),
    rampId
  );
  const top = Math.max(1, ...months.map(m => m.windows));
  const mon = ym => localDate(ym + '-01').toLocaleDateString('en-AU', { month: 'short' });
  return `<div class="hcol">${periodHead(t, rampId, 'year avg')}
  <section style="order:2">${sect('Month by month', 'Tap a month')}
    <div class="ytiles">${months
      .map(m => {
        if (!m.n) return `<span class="ytile none"><span class="caps">${mon(m.ym)}</span></span>`;
        const w = k => ((100 * m[k]) / m.n).toFixed(1) + '%';
        return `<button class="ytile" style="--c:${light(m.avg, LINES.ocean)}" data-act="histMonth" data-id="${m.ym}"
          aria-label="${monthName(m.ym)}: average ${m.avg}, ${m.go} go days of ${m.n}">
          <span class="caps">${mon(m.ym)}</span>
          <b class="num">${m.go}</b><span class="yk">go days</span>
          <span class="split" aria-hidden="true"><i style="width:${w('go')};background:var(--go)"></i><i style="width:${w('amber')};background:var(--mid)"></i><i style="width:${w('red')};background:var(--no)"></i></span>
        </button>`;
      })
      .join('')}</div>
    <p class="sub hnote">Each month's colour is its average score; the bar splits its days into go, in between and no go.</p>
  </section></div>
  <div class="hcol"><section class="panel week" style="order:3">${sect('Days with a launch window')}
    <div class="ybars" role="img" aria-label="Days with a launch window each month">${months
      .map(
        m => `<span class="ybar">
        <span class="yplot"><span class="yn num">${m.n ? m.windows : ''}</span>
          <span class="yw" style="height:${(100 * m.windows) / top}%"></span></span>
        <span class="dow">${localDate(m.ym + '-01').toLocaleDateString('en-AU', { month: 'narrow' })}</span>
      </span>`
      )
      .join('')}</div>
  </section></div>`;
}

const HVIEWS = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year']
];

/** The stretch shown: its title, and its first and last days, for the arrows. */
export function histPeriod(view, ds) {
  if (view === 'day') return { title: longDate(localDate(ds)) + ' ' + ds.slice(0, 4), a: ds, b: ds };
  if (view === 'week') {
    const a = weekStart(ds),
      b = addDays(a, 6);
    return { title: weekLabel(a, b), a, b };
  }
  if (view === 'month')
    return { title: monthName(ds.slice(0, 7)), a: ds.slice(0, 7) + '-01', b: ds.slice(0, 7) + '-31' };
  return { title: ds.slice(0, 4), a: ds.slice(0, 4) + '-01-01', b: ds.slice(0, 4) + '-12-31' };
}

/** The day `n` steps of `view` away from `ds`, kept inside [first, last]. */
export function histStep(view, ds, n, first, last) {
  const d = localDate(ds);
  const to =
    view === 'day'
      ? addDays(ds, n)
      : view === 'week'
        ? addDays(ds, 7 * n)
        : view === 'month'
          ? isoDay(new Date(d.getFullYear(), d.getMonth() + n, 1))
          : isoDay(new Date(d.getFullYear() + n, d.getMonth(), Math.min(d.getDate(), 28)));
  return to < first ? first : to > last ? last : to;
}

function renderHistory() {
  const h = state.hist;
  if (h.status === 'idle') queueMicrotask(loadHistory);
  if (!h.data)
    return `<div class="hist">${
      h.status === 'error'
        ? notice(
            'Flight log could not load',
            `${esc(h.error || 'no connection')}. It needs a connection the first time; after that the phone keeps a copy.`
          ) + '<button class="save wide" data-act="histRetry">Try again</button>'
        : '<div class="panel"><p class="sub">Loading three years of conditions…</p></div>'
    }</div>`;

  const rampId = h.ramp || null;
  const logged = new Set(state.log.map(e => e.date));
  const p = histPeriod(h.view, h.ds);
  const body =
    h.view === 'day'
      ? histDay(h.data.byDs.get(h.ds), rampId)
      : h.view === 'week'
        ? histWeek(p.a, rampId, logged)
        : h.view === 'month'
          ? histMonth(h.ds.slice(0, 7), rampId, logged)
          : histYear(h.ds.slice(0, 4), rampId);

  return `<div class="hist">
    <div class="hctl">
      <div class="switch four" role="group" aria-label="Look back by">${HVIEWS.map(
        ([k, l]) =>
          `<button data-act="histView" data-view="${k}" class="${h.view === k ? 'on' : ''}" aria-pressed="${h.view === k}">${l}</button>`
      ).join('')}</div>
      <div class="hnav">
        <button class="ghost" data-act="histStep" data-i="-1" ${p.a <= h.first ? 'disabled' : ''} aria-label="Earlier">‹</button>
        <h2 class="num">${esc(p.title)}</h2>
        <button class="ghost" data-act="histStep" data-i="1" ${p.b >= h.last ? 'disabled' : ''} aria-label="Later">›</button>
      </div>
      <div class="chips hramps" role="group" aria-label="Ramp">
        <button data-act="histRamp" data-z="" class="${!rampId ? 'on' : ''}" aria-pressed="${!rampId}">Best ramp</button>
        ${ZONES.map(
          z =>
            `<button data-act="histRamp" data-z="${z.id}" class="${rampId === z.id ? 'on' : ''}" aria-pressed="${rampId === z.id}">${esc(rampShort(z.id))}</button>`
        ).join('')}
      </div>
    </div>
    <div class="hbody hb-${h.view}">${body}</div>
    <p class="sub hnote">Each day is judged by the standard limits (${DEFAULTS.maxSwell} m swell, ${DEFAULTS.maxWind} kn wind,
    ${DEFAULTS.maxGust} kn gusts, a ${TUNING.minWindowHours}-hour window), from Open-Meteo's archive of the same
    forecast models: the models' picture of the day, not a measurement.
    ${rampId ? "Scores are this ramp's launch score." : 'Scores are the daily score, at the best ramp each day.'}
    Kept from ${esc(longDate(localDate(h.first)))} ${h.first.slice(0, 4)} and updated each morning${h.cached ? '; this is the copy saved on the phone' : ''}.</p>
  </div>`;
}

/* ── Render and actions ─────────────────────────────────────────────────── */

/**
 * A selector that finds the same control again after a re-render, built from
 * its tag and data-* attributes (data-act plus whichever of i, z, tab, view,
 * rating, id, name it carries). Null for anything that is not one of our controls.
 */
export function controlKey(el) {
  if (!el || !el.dataset || !el.dataset.act) return null;
  // a CSS string: quotes and backslashes escaped, and a newline written as \a
  // (a raw one would make querySelector throw part-way through a render)
  const q = v => '"' + String(v).replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ') + '"';
  // the tag first: a ramp's map pin (<g>) and its list button share data-z
  return (
    el.tagName.toLowerCase() +
    ['act', 'i', 'z', 'tab', 'view', 'rating', 'id', 'name']
      .filter(k => el.dataset[k] != null)
      .map(k => `[data-${k}=${q(el.dataset[k])}]`)
      .join('')
  );
}

export function render() {
  const app = $('app');
  // re-rendering replaces the DOM, so remember which panels were open and
  // which control had keyboard focus, and put both back
  const open = app.querySelectorAll
    ? [...app.querySelectorAll('details[open][data-key]')].map(d => d.dataset.key)
    : [];
  const active = typeof document.activeElement === 'object' ? document.activeElement : null;
  // only for keyboard users: a tap should not leave a focus ring behind
  const focusKey =
    active && app.contains && app.contains(active) && active.matches && active.matches(':focus-visible')
      ? controlKey(active)
      : null;
  const body = state.tab === 'plan' ? renderPlan() : state.tab === 'history' ? renderHistory() : renderLog();
  app.innerHTML = tabs() + `<div class="view view-${state.tab}">${body}</div>`;
  open.forEach(k => {
    const d = app.querySelector(`details[data-key="${k}"]`);
    if (d) d.open = true;
  });
  if (focusKey) {
    const el = app.querySelector(focusKey);
    if (el) el.focus({ preventScroll: true });
  }
}

/**
 * Show the day with this date (YYYY-MM-DD). False if it is not in the forecast.
 * `ocean` switches to the ocean page too: go-day alerts are about the ocean.
 */
export function selectDay(ds, ocean = false) {
  const i = state.days.findIndex(d => d.ds === ds);
  if (i < 0) return false;
  state.sel = i;
  state.zsel = null;
  state.tab = 'plan';
  if (ocean) state.view = 'ocean';
  render();
  return true;
}

export function rebuild() {
  const built = build(state.raw, { cfg: state.cfg, log: state.log });
  state.days = built.days;
  state.past = built.past;
  state.sel = Math.min(state.sel, Math.max(0, state.days.length - 1));
  render();
}

const scrollTop = () =>
  window.scrollTo({
    top: 0,
    behavior:
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  });

function formValues() {
  const g = id => {
    const n = $(id);
    return n ? n.value : '';
  };
  return { date: g('ld'), ramp: g('lr'), notes: g('lnotes') };
}

/** The log form as it stands: typed fields from the page, taps from the draft. */
function draftNow() {
  const prev = state.logDraft || { picked: [], rating: 2 };
  return { ...formValues(), picked: prev.picked || [], rating: prev.rating };
}

/** Build a catch-log entry, stamped with that day's conditions when we have them. */
export function logEntry(f, rating, built) {
  const c = conditionsFor(built, f.date, f.ramp);
  const noon = new Date(f.date + 'T12:00');
  const entry = {
    id: 'e' + Date.now(),
    date: f.date,
    ramp: f.ramp,
    species: Array.isArray(f.picked) ? f.picked.join(', ') : (f.species || '').trim(),
    notes: f.notes.trim(),
    rating,
    moon: moonBucket(moonIllum(isNaN(noon) ? new Date() : noon).phase),
    tide: 'unknown',
    wind: null,
    windDir: null,
    swell: null,
    period: null,
    range: null
  };
  if (c) {
    Object.assign(entry, {
      tide: tidePhaseAt(new Date(+c.day.d0 + 7 * HOUR), c.day.tides),
      wind: Math.round(c.zone.wind),
      windDir: dirOf(c.zone.wdir),
      swell: +c.zone.swellMax.toFixed(2),
      period: c.zone.period,
      range: c.day.range
    });
  }
  return entry;
}

export const ACTIONS = {
  dismissGo() {
    state.freshGo = [];
    render();
  },
  async alertsOn() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      state.alerts = { on: false, mode: 'unsupported' };
      return render();
    }
    if ((await Notification.requestPermission()) !== 'granted') {
      state.alerts = { on: false, mode: 'denied' };
      save('alerts', state.alerts);
      return render();
    }
    const reg = await navigator.serviceWorker.ready;
    let mode = 'open';
    if ('periodicSync' in reg) {
      try {
        await reg.periodicSync.register(SYNC_TAG, { minInterval: SYNC_INTERVAL_MS });
        mode = 'background';
      } catch (e) {
        /* only installed apps get background sync */
      }
    }
    state.alerts = { on: true, mode };
    save('alerts', state.alerts);
    render();
  },
  async alertsOff() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.periodicSync) await reg.periodicSync.unregister(SYNC_TAG);
    } catch (e) {
      /* nothing registered */
    }
    state.alerts = { on: false, mode: null };
    save('alerts', state.alerts);
    render();
  },
  async alertsTest() {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) reg.active.postMessage('test-alert');
  },
  tab(el) {
    state.tab = el.dataset.tab;
    // a new day lands each morning: an app left open picks it up on the next visit
    const h = state.hist;
    if (state.tab === 'history' && h.status === 'ready' && Date.now() - h.at > HISTORY_STALE_MS)
      loadHistory();
    render();
    scrollTop();
  },
  view(el) {
    state.view = el.dataset.view === 'river' ? 'river' : 'ocean';
    state.tab = 'plan';
    save('view', state.view);
    render();
    scrollTop();
  },
  day(el) {
    // stay put: the panels above the week change height from day to day, so
    // scroll by that change to keep the tapped day under the finger
    const before = el.getBoundingClientRect && el.getBoundingClientRect().top;
    state.sel = +el.dataset.i;
    state.zsel = null;
    state.logDraft = null;
    render();
    const now = before != null && $('app').querySelector(`.day[data-i="${state.sel}"]`);
    if (now) window.scrollBy(0, now.getBoundingClientRect().top - before);
  },
  zone(el) {
    state.zsel = el.dataset.z;
    render();
  },
  saveLimits() {
    const g = id => parseFloat(($(id) || {}).value);
    state.cfg = validLimits({ maxSwell: g('s1'), maxWind: g('s2'), maxGust: g('s3') }) || state.cfg;
    save('limits', state.cfg);
    rebuild();
  },
  rate(el) {
    state.logDraft = { ...draftNow(), rating: +el.dataset.rating };
    render();
  },
  logSp(el) {
    const d = draftNow(),
      n = el.dataset.name;
    d.picked = d.picked.includes(n) ? d.picked.filter(x => x !== n) : d.picked.concat(n);
    state.logDraft = d;
    render();
  },
  addLog() {
    const f = draftNow();
    if (!f.date) {
      const n = $('ld');
      if (n) n.focus();
      return;
    }
    state.log = state.log.concat([logEntry(f, f.rating, { days: state.days, past: state.past })]);
    save('log', state.log);
    state.logDraft = null;
    rebuild();
  },
  delLog(el) {
    state.log = state.log.filter(e => e.id !== el.dataset.id);
    save('log', state.log);
    rebuild();
  },
  histView(el) {
    state.hist.view = el.dataset.view;
    render();
  },
  histStep(el) {
    const h = state.hist;
    h.ds = histStep(h.view, h.ds, +el.dataset.i, h.first, h.last);
    render();
  },
  histDay(el) {
    Object.assign(state.hist, { view: 'day', ds: el.dataset.id });
    render();
    scrollTop();
  },
  histMonth(el) {
    const h = state.hist;
    h.view = 'month';
    h.ds = histStep('day', el.dataset.id + '-01', 0, h.first, h.last);
    render();
    scrollTop();
  },
  histRamp(el) {
    state.hist.ramp = el.dataset.z || '';
    render();
  },
  histRetry() {
    const h = state.hist;
    for (const ym of Object.keys(h.months)) if (h.months[ym] === 'error') delete h.months[ym];
    if (h.status === 'error') h.status = 'idle';
    render();
  }
};

export function onAppClick(ev) {
  const el = ev.target.closest && ev.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el, ev);
}
