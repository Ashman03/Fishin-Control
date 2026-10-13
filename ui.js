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
  BOM_ZONES,
  MARK_TYPES,
  RATINGS,
  TUNING,
  SEASON,
  RIVER_SEASON
} from './config.js';
import { state, save, validLimits } from './store.js';
import { build, seaWord, conditionsFor } from './model.js';
import { sessions, techniques, launchNotes, patterns, tidePhaseAt, moonBucket, moonLabel } from './advice.js';
import { moonIllum } from './astro.js';
import { speciesArt } from './art.js';
import { mapSVG } from './map.js';
import { parseHWR, parseGPX, toMarks, nearestMark } from './importer.js';
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
  span,
  fromNewOrFull,
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

/** The daily score with its caption, as it sits at the left of the hero. */
const dailyScore = (score, caption, lines) =>
  `<div class="dscore">${dial(score, lines)}<span class="cap">${caption}</span></div>`;

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
  const maxS = Math.max(1.2, ...hrs.map(h => h.swellEff)),
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
  // forecast storm hours: an amber tick along the top of the chart
  const storms = hrs
    .filter(h => h.stormNow > 0)
    .map(
      h =>
        `<rect x="${x(h.t)}" y="8" width="${Math.max(2, x(+h.t + HOUR) - x(h.t))}" height="4" fill="var(--mid)" opacity="${h.stormNow === 2 ? 0.9 : 0.45}"/>`
    )
    .join('');
  const label = (t, txt) =>
    `<text x="${x(t)}" y="${H - 2}" text-anchor="middle" font-size="10.5" fill="#95b8cd" font-family="Space Grotesk,sans-serif">${txt}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Swell, wind and gusts through the day">
   <rect x="${P}" y="8" width="${W - P * 2}" height="${H - 24}" fill="rgba(0,0,0,.22)"/>
   ${bands}${storms}
   <line x1="${P}" x2="${W - P}" y1="${sy(cfg.maxSwell)}" y2="${sy(cfg.maxSwell)}" stroke="var(--sky)" stroke-opacity=".45" stroke-dasharray="2 4"/>
   <line x1="${P}" x2="${W - P}" y1="${wy(cfg.maxWind)}" y2="${wy(cfg.maxWind)}" stroke="var(--no)" stroke-opacity=".35" stroke-dasharray="2 4"/>
   <path d="${line(wy, h => h.gust)}" fill="none" stroke="var(--no)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>
   <path d="${line(wy, h => h.wind)}" fill="none" stroke="var(--mid)" stroke-width="2"/>
   <path d="${line(sy, h => h.swellEff)}" fill="none" stroke="var(--sky)" stroke-width="2.4"/>
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
  marks: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  log: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>'
};

/** The three sections: a bar along the bottom on a phone, across the top on a wide screen. */
function tabs() {
  // plain buttons marked aria-current: ARIA tab roles would promise arrow-key
  // navigation that a three-button switcher does not need
  return `<nav class="tabs" aria-label="Sections">
    ${[
      ['plan', 'Forecast'],
      ['marks', 'My marks'],
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
    ${worst >= 3 ? 'Cross before it starts or wait for the flood.' : 'Treat it with respect, and never cross on the last of the run-out into wind.'}</p>`
  );
}

/**
 * The loading screen's "Forecast feeds" line once the requests are back, as
 * [state, word, label]: GO only when every source answered live. Amber when
 * some are down or a primary is the phone's saved copy; red with sample data.
 */
export function feedsLine(raw, demo) {
  const s = (raw && raw.status) || [];
  const up = s.filter(x => x.ok).length;
  const label = `Forecast feeds · ${up} of ${s.length} up`;
  if (demo) return ['nogo', 'No go', 'Forecast feeds · offline'];
  if (raw.cached) return ['hold', 'Saved', label];
  return up === s.length ? ['go', 'Go', label] : ['hold', 'Partial', label];
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

/* ── Launch theme: caution and advisory panel, countdown, window tracks ── */

const STATUS = { go: 'GO', hold: 'HOLD', nogo: 'NO GO' };

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
  const w = zone.win[0];
  const inWin = w ? zone.hours.filter(h => h.t >= w.a && h.t < w.b) : daylight;
  const lo = k => Math.min(...inWin.map(h => h[k])),
    hi = k => Math.max(...inWin.map(h => h[k]));

  const [models, modelsVal] = modelsLamp(day);

  const rows = [
    ['Swell', station(hours(h => h.swellEff <= cfg.maxSwell)), span(lo('swell'), hi('swell')) + ' m'],
    ['Wind', station(hours(h => h.wind <= cfg.maxWind)), span(lo('wind'), hi('wind'), 0) + ' kn'],
    ['Gusts', station(hours(h => h.gust <= cfg.maxGust)), 'to ' + Math.round(hi('gust')) + ' kn'],
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
 * A caution and advisory panel: rows of [label, 'go' | 'hold' | 'nogo', value],
 * under a heading that totals the calls. 'tiles' draws an annunciator: a bezel
 * holding a glass key per station, its legend lit in the lamp's colour (the CSS
 * puts the call above the station name). `layout` 'rows' lists them one per line instead.
 */
function advisoryHTML(rows, label, layout = 'tiles') {
  const count = st => rows.filter(r => r[1] === st).length;
  const tally = ['go', 'hold', 'nogo']
    .filter(count)
    .map(st => count(st) + ' ' + STATUS[st])
    .join(' · ');
  const list = `<div class="adv ${layout}" role="list" aria-label="${esc(label)}">
    ${rows
      .map(
        ([k, st, v]) => `<div class="adv-row" role="listitem" data-st="${st}">
      <span class="adv-k">${k}</span><span class="adv-v num">${esc(v)}</span>
      <span class="adv-s ${st}">${STATUS[st]}</span></div>`
      )
      .join('')}
  </div>`;
  const head = sect('Caution and advisory panel', tally);
  return layout === 'tiles' ? `<div class="annun">${SCREWS}${head}${list}</div>` : head + list;
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

/** Sessions, then what's biting. `river` swaps the marks note for the river one. */
function flightPlan(day, zone, ss, river = false) {
  const shut = closedSpecies(day.d0, zone.z);
  const t = techniques(day, river);
  const month = day.d0.toLocaleDateString('en-AU', { month: 'long' });
  return `<section class="plan">
    ${sect('Flight plan', 'when to go, and what to throw')}
    <div class="panel list">${ss
      .map(
        s => `
      <div class="sess">
        <div class="when"><b class="num">${hhmm(s.a)}–${hhmm(s.b)}</b><i>${s.hrs} h · ${s.tide}</i></div>
        <div class="what"><div class="t">${s.title}${s.bar >= 2 ? ' <span class="risk">· bar risk</span>' : ''}</div>
          <div class="d">${s.how}</div>
          ${s.marks.length ? `<div class="bars">${s.marks.map(m => `<span>${esc(m.name)} · ${esc(m.km)} km · ${esc(m.depth)} m</span>`).join('')}</div>` : ''}
        </div>
      </div>`
      )
      .join('')}
      <p class="sub foot">${
        river
          ? 'Sessions are built on the tide turns and the moon, inside your fishing hours.'
          : 'Spots come from your marks list. Add your own on the My marks tab and they will be picked here by tide and swell.'
      }</p>
    </div>
  </section>
  <section class="biting">
    ${sect("What's biting", esc(month + ' · ' + t.m.t))}
    <div class="panel">
      <div class="fish">${t.m.sp
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

/** Details of the mark tapped on the map, under it. */
function markCaption(zone) {
  const m = state.markInfo && state.marks.find(x => x.id === state.markInfo && x.ramp === zone.z.id);
  if (!m) return '';
  return `<p class="sub mark-info"><b>${esc(m.name)}</b> · ${esc(m.km)} km from ${esc(short(zone.z.name))}${
    m.depth ? ' · ' + esc(m.depth) + ' m' : ''
  } · ${esc(m.type)}</p>`;
}

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

function call(kicker, word, why, extra = '') {
  const go = word === 'Go';
  return `<div class="call">
      <span class="kick">${kicker}</span>
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
    [
      'Turns',
      turns.length >= 2 ? 'go' : turns.length ? 'hold' : 'nogo',
      turns.length
        ? turns.map(t => (t.hi ? 'high ' : 'low ') + hhmm(t.t)).join(' · ')
        : 'none in fishing hours'
    ],
    ['Moon', nf < 0.12 ? 'go' : 'hold', moonPhase(day.moon.phase)],
    [
      'Feeding',
      majors.length ? 'go' : 'hold',
      majors.length ? majors.map(hhmm).join(' · ') : 'outside fishing hours'
    ],
    [
      'Water',
      ri.runoff ? 'hold' : 'go',
      ri.runoff
        ? 'run-off · ' + Math.round(ri.rain72) + ' mm in 3 days'
        : ri.rain72 >= 5
          ? Math.round(ri.rain72) + ' mm in 3 days'
          : 'clean'
    ],
    ['Wind', ri.windStrong ? 'hold' : 'go', Math.round(ri.windIn) + ' kn close in'],
    ['Rules', closed.length ? 'hold' : 'go', closed.length ? closed.length + ' closed' : 'all open']
  ];
  const [word, why] = riverVerdict(day);
  return `${banners(day)}
  <div class="deck">
    <div class="col col-a">
      <section class="panel hero">${dailyScore(day.river, 'Daily score', LINES.river)}
        ${call(esc(shortDate(day.d0) + ' · ' + est.name), word, why)}
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
    <section class="advsec">${advisoryHTML(rows, 'River caution and advisory panel for ' + est.name, 'rows')}</section>
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
      ${closuresCard(day, zone)}
    </div>
    <div class="grid">
      ${tideSection(day)}
      ${flightPlan(day, zone, sessions(day, zone, state.marks, est), true)}
    </div>
  </div>`;
}

function renderOcean() {
  const { cfg, days, marks } = state;
  const day = days[state.sel];
  if (!state.zsel || !day.zones.some(z => z.z.id === state.zsel)) state.zsel = day.zones[0].z.id;
  const zone = day.zones.find(z => z.z.id === state.zsel);
  const best = day.zones[0];
  const [word, why] = verdict(day.overall, day.river);
  const ss = sessions(day, zone, marks),
    ln = launchNotes(zone, cfg);
  const bom = BOM_ZONES[zone.z.bom];

  const ensemble =
    day.prob != null
      ? `<div class="ens" role="img" aria-label="${day.prob}% of ${day.ensembleMembers} forecast runs give you a usable window at ${esc(short(best.z.name))}">
        <div class="ens-h"><span>Ensemble</span><b class="num"><em style="color:${LAMP_COLOUR[modelsLamp(day)[0]]}">${day.prob}%</em> of ${day.ensembleMembers} runs</b></div>
        <div class="segs" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i${i < Math.round(day.prob / 10) ? ' class="on"' : ''}></i>`).join('')}</div>
      </div>`
      : '';

  return `${banners(day)}${freshGoBanner()}
  <div class="deck ocean">
    <div class="col col-a">
      ${countdown()}
      <section class="panel hero">${dailyScore(day.overall, 'Daily score', LINES.ocean)}
        ${call(
          "Flight director's call · " + esc(shortDate(day.d0)),
          word,
          why + (day.caps.length ? ' Capped: ' + esc(day.caps.join('; ')) + '.' : ''),
          ensemble
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

    <section class="advsec">
      ${cautionPanel(day, best)}
      <div class="pills">
        <span class="pill ${lightKey(best.score, LINES.ocean)}">Launch <b>${esc(best.z.ramp.split(',')[0])}</b></span>
        <span class="pill">Swell <b>${span(best.swell, best.swellMax)} m</b>${best.period ? ` · ${Math.round(best.period)} s, ${seaWord(best.period)}` : ''}</span>
        <span class="pill">Wind <b>${span(best.wind, best.windMax, 0)} kn ${dirOf(best.wdir)}</b> · gusts ${Math.round(best.gust)}</span>
        <span class="pill">Close in <b>${best.swellIn.toFixed(1)} m</b> · at 20 km <b>${best.swell20.toFixed(1)} m</b></span>
        ${best.chop >= 0.3 ? `<span class="pill">Chop <b>${best.chop.toFixed(1)} m</b></span>` : ''}
        ${best.barMax >= 2 ? '<span class="pill r"><b>Bar</b> wind against tide</span>' : ''}
      </div>
    </section>

    <section class="col col-b mapsec">
      ${sect('Launch control', esc(shortDate(day.d0)))}
      <div class="mapwrap">${mapSVG(day, state.zsel, state.marks, state.markInfo)}</div>
      ${markCaption(zone)}
      <div class="legend">
        <span><i style="background:var(--go)"></i>Go</span>
        <span><i style="background:var(--mid)"></i>Marginal</span>
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
                <span class="tags"><span class="tag ${z.swellEffMax <= cfg.maxSwell ? 'ok' : 'bad'}">swell ${span(z.swell, z.swellMax)} m</span><span class="tag ${z.windMax <= cfg.maxWind ? 'ok' : 'mid'}">${span(z.wind, z.windMax, 0)} kn ${dirOf(z.wdir)}</span><span class="tag ${z.gust <= cfg.maxGust ? 'ok' : 'bad'}">gusts ${Math.round(z.gust)}</span><span class="tag">${z.goodHrs} h ok</span>${z.barMax >= 2 ? '<span class="tag bad">bar risk</span>' : ''}${z.prob != null ? `<span class="tag">${z.prob}% chance</span>` : ''}</span>
              </span>
            </button>`
            )
            .join('')}
          <div class="brief">
            <h3>Site brief · ${esc(short(zone.z.name))}</h3>
            <p class="sub">${esc(zone.z.grounds)}</p>
            ${ln.length ? `<ul class="tight">${ln.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            <p class="sub">Rivers and creeks today
              <b style="color:${light(day.river, LINES.river)}">${day.river}/100</b>.
              <button class="inline" data-act="view" data-view="river">River view</button></p>
            <div class="links">
              <a href="${bom[1]}" target="_blank" rel="noopener">${bom[0]}</a>
              <a href="https://www.windy.com/-Waves-waves?waves,${zone.z.mlat},${zone.z.mlon},9" target="_blank" rel="noopener">Windy at ${esc(short(zone.z.name))}</a>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${zone.z.mlat},${zone.z.mlon}" target="_blank" rel="noopener">Directions</a>
            </div>
          </div>
        </div>
      </section>
      ${barCard(zone)}
      ${closuresCard(day, zone)}
    </div>

    <div class="grid">
  <section class="cond">
    ${sect('Conditions', '10–20 km off ' + esc(short(zone.z.name)))}
    <div class="panel chartwrap">${condChart(zone, cfg)}
      <div class="legend key">
        <span><i class="ln sw"></i>Swell</span>
        <span><i class="ln wd"></i>Wind</span>
        <span><i class="ln gu"></i>Gusts</span>
        <span><i class="bx ok"></i>Inside limits</span>
        <span><i class="bx st"></i>Storm risk</span>
      </div>
      <p class="sub">Swell is weighted for period. Dashed lines are your limits;
      green shading marks every hour that clears all three. Figures are the worst of the 10, 15 and 20 km
      points on the bearing you run out on —
      ${zone.period ? `period today is around ${Math.round(zone.period)} seconds, ${seaWord(zone.period)}` : 'period data is missing today'}.</p>
    </div>
  </section>

  ${tideSection(day)}

  ${flightPlan(day, zone, ss)}

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
      <div class="links">${SOURCES.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join('')}</div>
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
        <p class="sub">Swell is weighted for period before it meets your limit, so 0.6 m at
        5 seconds counts as roughly 0.8 m and 0.6 m at 11 seconds as about 0.5 m. Wind and gusts are compared as
        forecast — no allowance for shelter.</p>
      </details>
    </div>
  </section>
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

function renderMarks() {
  const byRamp = {};
  state.marks.forEach(m => (byRamp[m.ramp] = byRamp[m.ramp] || []).push(m));
  const imported = state.marks.filter(m => m.imported).length;
  const row = m => `
          <div class="mk">
            <span class="km num">${esc(m.km)} km</span>
            <span class="g"><b>${esc(m.name)}</b>
              <span class="ty">${esc(m.depth)} m · ${esc(m.type)}</span></span>
            <button data-act="delMark" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">Remove</button>
          </div>`;
  return `<div class="pages">
  <section>
    ${sect('Your marks', state.marks.length + ' on this phone')}
    <div class="panel bracket stack">
      <h3>Uplink · import from your Helix</h3>
      <ol class="steps">
        <li>On the Helix: Menu twice → Nav → Waypoints, Routes, Tracks → Options → Select All → Export
        (older software: Nav → Export All Nav Data).</li>
        <li>Put the SD card in your phone with the adapter.</li>
        <li>Choose <b>DATA.HWR</b> from the <b>matrix</b> folder. A GPX file works too.</li>
      </ol>
      <label class="save solid wide filebtn">Choose file<input type="file" id="importFile" class="vh"></label>
      ${state.importMsg ? `<p class="note">${esc(state.importMsg)}</p>` : ''}
      ${imported ? `<button class="danger wide" data-act="clearImported">Remove all ${imported} imported marks</button>` : ''}
      <p class="sub">Each mark is matched to its nearest ramp with its real distance, and they stay on this phone only.</p>
    </div>
  </section>
  <section>
    ${sect('Add a mark by hand')}
    <div class="panel stack">
      <div class="form">
        <div class="wide"><label for="mn">Name</label><input id="mn" placeholder="Four Mile lump"></div>
        <div class="wide"><label for="mr">Ramp</label><select id="mr">${ZONES.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>
        <div><label for="mk">Distance out (km)</label><input id="mk" type="number" inputmode="decimal" step="0.5" min="0" max="20" value="8"></div>
        <div><label for="md">Depth (m)</label><input id="md" type="number" inputmode="numeric" min="0" max="200" value="10"></div>
        <div class="wide"><label for="mt">Ground</label><select id="mt">${MARK_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
        <div class="wide"><button class="save wide" data-act="addMark">Add mark</button></div>
      </div>
      <p class="sub">These feed the flight plan, which picks the ground that suits the tide, the light and the
      swell. Distances are from the ramp, so keep everything inside your 20 km line.</p>
    </div>
  </section>
    ${ZONES.filter(z => byRamp[z.id])
      .map(z => {
        const list = byRamp[z.id].sort((a, b) => a.km - b.km);
        // a long imported list folds away so the page stays usable
        return `<section>${sect(esc(z.name), list.length + (list.length === 1 ? ' mark' : ' marks'))}${
          list.length > 8
            ? `<div class="panel list"><details data-key="marks-${z.id}" class="fold"><summary><span>Show all ${list.length} marks</span></summary>${list.map(row).join('')}</details></div>`
            : `<div class="panel list">${list.map(row).join('')}</div>`
        }</section>`;
      })
      .join('')}
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
      two days before — tide phase, moon, wind and swell. Older sessions get the moon only. Save while you're
      out and the nearest of your marks is added from the phone's location (it asks once).</p>
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
        ? `<section class="span">${sect('History', state.log.length + (state.log.length === 1 ? ' session' : ' sessions'))}
    <div class="panel list">${state.log
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40)
      .map(
        e => `
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
          e.mark ? 'at ' + esc(e.mark) : null,
          e.notes ? esc(e.notes) : null
        ]
          .filter(Boolean)
          .join(' · ')}</div>
        <button data-act="delLog" data-id="${esc(e.id)}" class="del">Delete</button>
      </div>`
      )
      .join('')}</div></section>`
        : ''
    }
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
  const body = state.tab === 'plan' ? renderPlan() : state.tab === 'marks' ? renderMarks() : renderLog();
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

/** The phone's position, or null if it can't or won't say within a few seconds. */
function whereAmI() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(res =>
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(null),
      { timeout: 8000, maximumAge: 10 * 60e3, enableHighAccuracy: true }
    )
  );
}

/** Build a catch-log entry, stamped with that day's conditions when we have them. */
export function logEntry(f, rating, built, mark = null) {
  const c = conditionsFor(built, f.date, f.ramp);
  const noon = new Date(f.date + 'T12:00');
  const entry = {
    id: 'e' + Date.now(),
    date: f.date,
    ramp: f.ramp,
    species: Array.isArray(f.picked) ? f.picked.join(', ') : (f.species || '').trim(),
    mark,
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
  addMark() {
    const g = id => ($(id) || {}).value;
    const name = (g('mn') || '').trim();
    if (!name) {
      const n = $('mn');
      if (n) n.focus();
      return;
    }
    state.marks = state.marks.concat([
      {
        id: 'm' + Date.now(),
        name,
        ramp: g('mr'),
        km: clamp(+g('mk') || 0, 0, 60),
        depth: clamp(+g('md') || 0, 0, 200),
        type: g('mt')
      }
    ]);
    save('marks', state.marks);
    render();
  },
  markInfo(el) {
    state.markInfo = state.markInfo === el.dataset.id ? null : el.dataset.id;
    render();
  },
  clearImported() {
    const n = state.marks.filter(m => m.imported).length;
    if (typeof confirm === 'function' && !confirm('Remove all ' + n + ' imported marks from this phone?'))
      return;
    state.marks = state.marks.filter(m => !m.imported);
    state.importMsg = 'Removed ' + n + ' imported marks.';
    save('marks', state.marks);
    render();
  },
  delMark(el) {
    state.marks = state.marks.filter(m => m.id !== el.dataset.id);
    save('marks', state.marks);
    render();
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
  async addLog() {
    // the location lookup can take a few seconds: a second tap must not save twice
    if (state.savingLog) return;
    const f = draftNow();
    if (!f.date) {
      const n = $('ld');
      if (n) n.focus();
      return;
    }
    state.savingLog = true;
    try {
      // logging on the day, probably from the boat: tag the nearest of your marks
      let mark = null;
      if (f.date === isoDay(new Date()) && state.marks.some(m => m.lat != null)) {
        const here = await whereAmI();
        const m = here && nearestMark(here.lat, here.lon, state.marks);
        mark = m ? m.name : null;
      }
      state.log = state.log.concat([logEntry(f, f.rating, { days: state.days, past: state.past }, mark)]);
      save('log', state.log);
      state.logDraft = null;
    } finally {
      state.savingLog = false;
    }
    rebuild();
  },
  delLog(el) {
    state.log = state.log.filter(e => e.id !== el.dataset.id);
    save('log', state.log);
    rebuild();
  }
};

/**
 * Read a sounder export or GPX file into marks. Tries the format the name
 * suggests first, then the other, so a renamed file still works.
 */
export async function importMarks(file) {
  const asGPX = async () => parseGPX(await file.text());
  const asHWR = async () => parseHWR(await file.arrayBuffer());
  const gpxFirst = /\.gpx$/i.test(file.name);
  let points;
  try {
    points = await (gpxFirst ? asGPX() : asHWR());
  } catch (first) {
    try {
      points = await (gpxFirst ? asHWR() : asGPX());
    } catch (e) {
      state.importMsg = "Couldn't read " + file.name + ': ' + first.message;
      return render();
    }
  }
  const { marks, outside, repeats } = toMarks(points, state.marks);
  state.marks = state.marks.concat(marks);
  save('marks', state.marks);
  state.importMsg =
    'Imported ' +
    marks.length +
    ' mark' +
    (marks.length === 1 ? '' : 's') +
    '.' +
    (outside ? ' ' + outside + ' more than 25 km from your ramps left out.' : '') +
    (repeats ? ' ' + repeats + ' already here.' : '');
  render();
}

/** Form controls that act on change rather than click (the file picker). */
export function onAppChange(ev) {
  const t = ev.target;
  if (t && t.id === 'importFile' && t.files && t.files[0]) importMarks(t.files[0]);
}

export function onAppClick(ev) {
  const el = ev.target.closest && ev.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el, ev);
}
