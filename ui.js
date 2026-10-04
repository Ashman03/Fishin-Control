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
import { APP_VERSION, ZONES, ESTUARIES, SOURCES, BOM_ZONES, MARK_TYPES, RATINGS, TUNING } from './config.js';
import { state, save, validLimits } from './store.js';
import { build, seaWord, conditionsFor } from './model.js';
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
import { SYNC_TAG, SYNC_INTERVAL_MS } from './alerts.js';
import { esc, hhmm, pad, clamp, light, lightKey, dirOf, isoDay, span, HOUR, DAY } from './util.js';

const $ = id => document.getElementById(id);
const short = name => name.split(' /')[0].split(' (')[0];
const longDate = d => d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

/* ── Small components ───────────────────────────────────────────────────── */

function dial(score) {
  const y = 100 - score,
    c = light(score);
  return `<svg class="dial" viewBox="0 0 100 100" role="img" aria-label="Score ${score} of 100">
   <defs><clipPath id="dialClip"><circle cx="50" cy="50" r="44"/></clipPath></defs>
   <circle cx="50" cy="50" r="44" fill="rgba(0,0,0,.30)" stroke="${c}" stroke-opacity=".5" stroke-width="1.5"/>
   <g clip-path="url(#dialClip)">
     <rect class="fillw" x="0" y="${y}" width="100" height="${score + 3}" fill="${c}" opacity=".20"/>
     <path class="fillw" d="M0 ${y} q12 -5 25 0 t25 0 t25 0 t25 0 V100 H0Z" fill="${c}" opacity=".45"/>
   </g>
   <text x="50" y="55" text-anchor="middle" font-size="31" font-weight="700" fill="${c}"
     font-family="Space Grotesk,sans-serif" style="letter-spacing:-.05em">${score}</text>
   <text x="50" y="69" text-anchor="middle" font-size="8.5" fill="#65899f" font-family="Outfit,sans-serif">out of 100</text>
  </svg>`;
}

function verdict(score, river) {
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

const notice = (title, body) =>
  `<div class="card warn" style="margin-bottom:12px"><h3>${title}</h3><p class="sub">${body}</p></div>`;

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
  if (state.raw && state.raw.cached)
    out.push(
      notice(
        'Saved forecast — not live',
        'Showing the last forecast saved on this phone' +
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
  const W = 680,
    H = 155,
    P = 28,
    hrs = zone.hours;
  if (!hrs.length) return '';
  const t0 = +hrs[0].t,
    span = 23 * HOUR;
  const x = t => P + ((W - P * 2) * (+t - t0)) / span;
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
  const label = (t, txt) =>
    `<text x="${x(t)}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="#65899f" font-family="Outfit,sans-serif">${txt}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Swell, wind and gusts through the day">
   <rect x="${P}" y="8" width="${W - P * 2}" height="${H - 24}" fill="rgba(0,0,0,.22)" rx="10"/>
   ${bands}
   <line x1="${P}" x2="${W - P}" y1="${sy(cfg.maxSwell)}" y2="${sy(cfg.maxSwell)}" stroke="var(--sky)" stroke-opacity=".45" stroke-dasharray="2 4"/>
   <line x1="${P}" x2="${W - P}" y1="${wy(cfg.maxWind)}" y2="${wy(cfg.maxWind)}" stroke="var(--no)" stroke-opacity=".35" stroke-dasharray="2 4"/>
   <path d="${line(wy, h => h.gust)}" fill="none" stroke="var(--no)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>
   <path d="${line(wy, h => h.wind)}" fill="none" stroke="var(--mid)" stroke-width="2"/>
   <path d="${line(sy, h => h.swellEff)}" fill="none" stroke="var(--sky)" stroke-width="2.4"/>
   ${[0, 6, 12, 18].map(hr => label(t0 + hr * HOUR, pad(hr) + ':00')).join('')}
   <text x="${P + 3}" y="${sy(cfg.maxSwell) - 5}" font-size="9.5" fill="#65899f" font-family="Outfit,sans-serif">swell limit ${cfg.maxSwell} m</text>
   <text x="${W - P - 3}" y="${wy(cfg.maxWind) - 5}" text-anchor="end" font-size="9.5" fill="#65899f" font-family="Outfit,sans-serif">wind limit ${cfg.maxWind} kn</text>
  </svg>`;
}

/** Tide curve plotted against real time, so the curve and its markers cannot drift apart. */
function tideSVG(day) {
  const W = 680,
    H = 124,
    P = 26,
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
    .map(
      d =>
        `<rect x="${x(d) - 15}" y="10" width="30" height="${H - 38}" fill="var(--go)" opacity=".13" rx="6"/>`
    )
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
      <text x="${cx}" y="${t.hi ? cy - 9 : cy + 16}" text-anchor="middle" font-size="10.5" fill="#e9f4fb"
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

function tabs() {
  return `<div class="tabs" role="tablist">
    ${[
      ['plan', 'Forecast'],
      ['marks', 'My marks'],
      ['log', 'Catch log']
    ]
      .map(
        ([k, l]) =>
          `<button data-act="tab" data-tab="${k}" class="${state.tab === k ? 'on' : ''}" role="tab"
        aria-selected="${state.tab === k}">${l}</button>`
      )
      .join('')}
  </div>`;
}

function barCard(zone) {
  if (!zone.barWin.length) return '';
  const worst = Math.max(...zone.barWin.map(w => w.max));
  return `<div class="card warn">
    <h3>${worst >= 3 ? 'Bar: stay off it' : 'Bar: wind against tide'}</h3>
    <p class="sub">A run-out into an onshore breeze stands the bar up regardless of what the swell number says.
    ${zone.barWin.map(w => hhmm(w.a) + '–' + hhmm(w.b)).join(', ')} at ${esc(zone.z.ramp.split(',')[0])}.
    ${worst >= 3 ? 'Cross before it starts or wait for the flood.' : 'Treat it with respect, and never cross on the last of the run-out into wind.'}</p>
  </div>`;
}

/** What actually answered, so a silent failure upstream is visible on screen. */
function sourceStatus() {
  const s = state.raw && state.raw.status;
  if (!s || !s.length) return '';
  return `<details data-key="sources"><summary>Data sources (${s.filter(x => x.ok).length} of ${s.length} responding)</summary>
    ${s
      .map(
        x => `<div class="mk"><span class="g">${esc(x.label)} <span class="ty">${esc(x.role)}${x.detail ? ' · ' + esc(x.detail) : ''}</span></span>
      <b style="color:${x.ok ? 'var(--go)' : 'var(--no)'}">${x.ok ? 'ok' : 'down'}</b></div>`
      )
      .join('')}
  </details>`;
}

/* ── Launch theme: poll, countdown, window tracks ──────────────────────── */

const STATUS = { go: 'GO', hold: 'HOLD', nogo: 'NO GO' };

/**
 * The go / no-go poll for one ramp on one day. Each station reads GO when its
 * own limit holds for at least a full window of daylight, HOLD when it holds
 * for some of it, NO GO when it never does.
 */
function launchPoll(day, zone) {
  const cfg = state.cfg;
  const daylight = zone.hours.filter(h => h.t >= day.from && h.t <= day.to);
  const hours = test => daylight.filter(test).length;
  const station = n => (n >= TUNING.minWindowHours ? 'go' : n > 0 ? 'hold' : 'nogo');
  const closed = activeClosures(day.d0, zone.z);
  const rows = [
    ['Swell', station(hours(h => h.swellEff <= cfg.maxSwell)), span(zone.swell, zone.swellMax) + ' m'],
    ['Wind', station(hours(h => h.wind <= cfg.maxWind)), span(zone.wind, zone.windMax, 0) + ' kn'],
    ['Gusts', station(hours(h => h.gust <= cfg.maxGust)), Math.round(zone.gust) + ' kn'],
    ['Window', zone.win.length ? 'go' : zone.goodHrs ? 'hold' : 'nogo', zone.goodHrs + ' h'],
    [
      'Models',
      { high: 'go', fair: 'hold', low: 'nogo', unknown: 'hold' }[day.agree.level],
      day.prob != null ? day.prob + '%' : day.agree.level
    ],
    ['Bite', day.bite >= 60 ? 'go' : day.bite >= 45 ? 'hold' : 'nogo', String(day.bite)],
    ['Rules', closed.length ? 'hold' : 'go', closed.length ? closed.length + ' closed' : 'all open']
  ];
  return `<div class="poll" role="list" aria-label="Launch poll for ${esc(zone.z.name)}">
    ${rows
      .map(
        ([k, st, v]) => `<div class="poll-row" role="listitem">
      <span class="poll-k">${k}</span><span class="poll-v num">${esc(v)}</span>
      <span class="poll-s ${st}">${STATUS[st]}</span></div>`
      )
      .join('')}
  </div>`;
}

/** Earliest launch window still ahead (or open now) across the whole week. */
export function nextWindow(now = new Date()) {
  let best = null;
  for (const d of state.days)
    for (const z of d.zones)
      for (const w of z.win) if (w.b > now && (!best || w.a < best.w.a)) best = { d, z, w };
  return best;
}

export function countdown(now = new Date()) {
  const n = nextWindow(now);
  if (!n)
    return `<div class="tminus nogo" id="tminus">No launch window in the next ${state.days.length} days</div>`;
  const where = esc(short(n.z.z.name));
  if (n.w.a <= now)
    return `<div class="tminus go" id="tminus"><b>Window open</b> at ${where} — closes ${hhmm(n.w.b)}</div>`;
  const ms = n.w.a - now;
  const d = Math.floor(ms / DAY),
    h = Math.floor((ms % DAY) / HOUR),
    m = Math.floor((ms % HOUR) / 6e4);
  const t = (d ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm';
  const when = n.d.d0.toLocaleDateString('en-AU', { weekday: 'short' }) + ' ' + hhmm(n.w.a);
  return `<div class="tminus" id="tminus"><span class="num">T−${t}</span> to the next window · ${when} at ${where}</div>`;
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
    <rect width="${W}" height="5" rx="2.5" fill="rgba(255,255,255,.09)"/>${lit}</svg>`;
}

function closuresCard(day, zone) {
  const now = activeClosures(day.d0, zone.z);
  const soon = upcomingClosures(day.d0, zone.z, 14);
  const stale = closureDatesStale(day.d0);
  if (!now.length && !soon.length && !stale) return '';
  const fmt = d => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  return `<div class="card closure">
    <h3>${now.length ? 'Closed season in force' : 'Closed season coming up'}</h3>
    ${now.map(c => `<p class="sub"><b>${esc(c.title)}.</b> ${esc(c.detail)}${c.where ? ' Applies ' + esc(c.where) + '.' : ''}</p>`).join('')}
    ${soon.map(u => `<p class="sub"><b>${esc(u.closure.title)}</b> from ${fmt(u.starts)}.${u.closure.where ? ' Applies ' + esc(u.closure.where) + '.' : ''}</p>`).join('')}
    ${stale ? '<p class="sub">The published coral reef fin fish dates in this app have run out — check the official page.</p>' : ''}
    <div class="links"><a href="${CLOSURES_SOURCE}" target="_blank" rel="noopener">Official closed seasons</a></div>
  </div>`;
}

function freshGoBanner() {
  if (!state.freshGo || !state.freshGo.length) return '';
  const item = g =>
    new Date(g.ds + 'T12:00').toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }) +
    ' — ' +
    esc(short(g.ramp)) +
    ' ' +
    g.score +
    (g.from ? ', ' + g.from + '–' + g.to : '');
  return `<div class="card gonew"><h3>New go ${state.freshGo.length > 1 ? 'days' : 'day'}</h3>
    <p class="sub">${state.freshGo.map(item).join('<br>')}</p>
    <button class="ghost" data-act="dismissGo">Got it</button></div>`;
}

function alertsPanel() {
  const a = state.alerts || {};
  const msg =
    {
      background:
        'On. Your phone checks in the background — Android decides how often, usually every several hours — and notifies you when a day turns green.',
      open: 'On, but this phone will not run background checks: install the app from Chrome for that. Until then, new go days are flagged whenever you open it.',
      denied:
        'Notifications are blocked for this site. Allow them in Chrome under the site settings, then try again.',
      unsupported: 'This browser cannot show notifications.'
    }[a.on ? a.mode : a.mode === 'denied' || a.mode === 'unsupported' ? a.mode : ''] ||
    'Get a notification when a day newly turns green, without opening the app.';
  return `<details data-key="alerts"><summary>Go-day alerts ${a.on ? '· on' : ''}</summary>
    <p class="sub" style="margin-top:10px">${msg}</p>
    ${
      a.on
        ? '<button class="save" data-act="alertsTest">Send a test alert</button> <button class="ghost" data-act="alertsOff">Turn off</button>'
        : '<button class="save" data-act="alertsOn">Turn on alerts</button>'
    }
  </details>`;
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

function renderPlan() {
  const { cfg, days, marks } = state;
  const day = days[state.sel];
  if (!state.zsel || !day.zones.some(z => z.z.id === state.zsel)) state.zsel = day.zones[0].z.id;
  const zone = day.zones.find(z => z.z.id === state.zsel);
  const best = day.zones[0];
  const [word, why] = verdict(day.overall, day.river);
  const shut = closedSpecies(day.d0, zone.z);
  const t = techniques(day),
    ss = sessions(day, zone, marks),
    ln = launchNotes(zone, cfg);
  const phase = p =>
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
  const conf = {
    high: ['g', 'Models agree'],
    fair: ['a', 'Models roughly agree'],
    low: ['r', 'Models disagree'],
    unknown: ['a', 'Single model only']
  }[day.agree.level];
  const bom = BOM_ZONES[zone.z.bom];

  return `${banners(day)}${freshGoBanner()}
  <div class="hero">
    ${countdown()}
    <div class="hrow">${dial(day.overall)}
      <div class="verdict">${word}<small>${why}${day.caps.length ? ' Capped: ' + esc(day.caps.join('; ')) + '.' : ''}</small></div></div>
    ${launchPoll(day, best)}
    ${
      day.prob != null
        ? `<div class="prob" title="${day.prob}% of ensemble runs give a usable window">
      <i style="width:${day.prob}%;background:${light(day.prob)}"></i></div>
      <p class="sub" style="margin:7px 0 0;font-size:12.5px">${day.prob}% of ${day.ensembleMembers} forecast runs give you a usable window at ${esc(short(best.z.name))}.</p>`
        : ''
    }
    <div class="pills">
      <span class="pill ${lightKey(best.score)}">Launch <b>${esc(best.z.ramp.split(',')[0])}</b></span>
      <span class="pill">Swell <b>${span(best.swell, best.swellMax)} m</b>${best.period ? ` · ${Math.round(best.period)} s, ${seaWord(best.period)}` : ''}</span>
      <span class="pill">Wind <b>${span(best.wind, best.windMax, 0)} kn ${dirOf(best.wdir)}</b> · gusts ${Math.round(best.gust)}</span>
      <span class="pill">Close in <b>${best.swellIn.toFixed(1)} m</b> · at 20 km <b>${best.swell20.toFixed(1)} m</b></span>
      ${best.chop >= 0.3 ? `<span class="pill">Chop <b>${best.chop.toFixed(1)} m</b></span>` : ''}
      ${best.barMax >= 2 ? '<span class="pill r"><b>Bar</b> wind against tide</span>' : ''}
    </div>
  </div>

  <div class="strip">${days
    .map(
      (d, i) => `
    <button class="day ${i === state.sel ? 'on' : ''}" data-act="day" data-i="${i}" aria-pressed="${i === state.sel}"
      aria-label="${longDate(d.d0)}, score ${d.overall} of 100, ${d.zones[0].goodHrs} hours inside your limits">
      <div class="dow">${d.d0.toLocaleDateString('en-AU', { weekday: 'short' })}</div>
      <div class="dd num">${d.d0.getDate()}/${d.d0.getMonth() + 1}</div>
      <div class="sc num" style="color:${light(d.overall)}">${d.overall}</div>
      ${windowTrack(d)}
      <div class="dd num" style="margin-top:4px">${d.prob != null ? d.prob + '%' : '&nbsp;'}</div>
    </button>`
    )
    .join('')}</div>

  <section>
    <h2 class="sect">Launch control <span>${longDate(day.d0)}</span></h2>
    <div class="card mapwrap">
      ${mapSVG(day, state.zsel)}
      <div class="legend">
        <span><i style="background:var(--go)"></i>Go</span>
        <span><i style="background:var(--mid)"></i>Marginal</span>
        <span><i style="background:var(--no)"></i>No go</span>
        <span style="color:var(--dim)">Tap a ramp to plan around it</span>
      </div>
    </div>
    <div class="card">
      ${day.zones
        .map(
          z => `
        <button class="zone ${z.z.id === state.zsel ? 'on' : ''}" data-act="zone" data-z="${z.z.id}" aria-pressed="${z.z.id === state.zsel}">
          <span class="led" style="background:${light(z.score)}"></span>
          <span class="zsc num" style="color:${light(z.score)}">${z.score}</span>
          <span class="zb">
            <span class="t">${esc(z.z.name)}</span>
            <span class="d">${esc(z.z.ramp)}</span>
            <span class="tag ${z.swellEffMax <= cfg.maxSwell ? 'ok' : 'bad'}">swell ${span(z.swell, z.swellMax)} m</span><span class="tag ${z.windMax <= cfg.maxWind ? 'ok' : 'mid'}">${span(z.wind, z.windMax, 0)} kn ${dirOf(z.wdir)}</span><span class="tag ${z.gust <= cfg.maxGust ? 'ok' : 'bad'}">gusts ${Math.round(z.gust)}</span><span class="tag">${z.goodHrs} h ok</span>${z.barMax >= 2 ? '<span class="tag bad">bar risk</span>' : ''}${z.prob != null ? `<span class="tag">${z.prob}% chance</span>` : ''}
          </span>
        </button>`
        )
        .join('')}
      <div class="rule"></div>
      <h3>${esc(zone.z.name)}</h3>
      <p class="sub">${esc(zone.z.grounds)}</p>
      ${ln.length ? `<ul class="tight">${ln.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="sub" style="margin-top:8px">Rivers and creeks today
        <b style="color:${light(day.river)}">${day.river}/100</b> — ${ESTUARIES.map(e => e.name).join(', ')}.</p>
      <div class="links" style="margin-top:10px">
        <a href="${bom[1]}" target="_blank" rel="noopener">${bom[0]}</a>
        <a href="https://www.windy.com/-Waves-waves?waves,${zone.z.mlat},${zone.z.mlon},9" target="_blank" rel="noopener">Windy at ${esc(short(zone.z.name))}</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${zone.z.mlat},${zone.z.mlon}" target="_blank" rel="noopener">Directions</a>
      </div>
    </div>
    ${barCard(zone)}
    ${closuresCard(day, zone)}
  </section>

  <section>
    <h2 class="sect">Conditions <span>10–20 km off ${esc(zone.z.name)}</span></h2>
    <div class="card chartwrap">${condChart(zone, cfg)}
      <p class="sub" style="margin-top:6px">Light blue is swell, weighted for period. Amber is sustained wind, dashed red is gusts.
      Green shading marks every hour that clears all three of your limits. Figures are the worst of the 10, 15 and 20 km
      points on the bearing you run out on —
      ${zone.period ? `period today is around ${Math.round(zone.period)} seconds, ${seaWord(zone.period)}` : 'period data is missing today'}.</p>
    </div>
  </section>

  <section>
    <h2 class="sect">Tide and moon</h2>
    <div class="card chartwrap">${tideSVG(day)}
      <div class="kv" style="margin-top:10px">
        <div><div class="k">Range</div><div class="v num">${day.range != null ? day.range.toFixed(1) + ' m' : '—'}</div></div>
        <div><div class="k">Moon</div><div class="v" style="font-size:12.5px">${phase(day.moon.phase)}</div></div>
        <div><div class="k">Moon up</div><div class="v num">${hhmm(day.me.rise)}</div></div>
        <div><div class="k">Overhead</div><div class="v num">${hhmm(day.me.over)}</div></div>
        <div><div class="k">Sunrise</div><div class="v num">${hhmm(day.sunrise)}</div></div>
        <div><div class="k">Sunset</div><div class="v num">${hhmm(day.sunset)}</div></div>
        <div><div class="k">Water</div><div class="v num">${day.sst != null ? day.sst.toFixed(1) + '°' : '—'}</div></div>
        <div><div class="k">Bite</div><div class="v num" style="color:${light(day.bite)}">${day.bite}</div></div>
      </div>
      <p class="sub" style="margin-top:9px">Green bands are the major feeding periods, when the moon is directly
      overhead or underfoot. Tide times are modelled 10 km off Burnett Heads rather than official —
      check the MSQ table before you plan a bar crossing.</p>
      ${day.hint ? `<p class="sub" style="color:var(--sky)">${esc(day.hint.text)}</p>` : ''}
    </div>
  </section>

  <section>
    <h2 class="sect">Flight plan <span>when to go, and what to throw</span></h2>
    <div class="card">${ss
      .map(
        s => `
      <div class="sess">
        <div class="when"><b class="num">${hhmm(s.a)}–${hhmm(s.b)}</b><i>${s.hrs} h · ${s.tide}</i></div>
        <div class="what"><div class="t">${s.title}${s.bar >= 2 ? ' <span style="color:var(--no);font-size:12px">· bar risk</span>' : ''}</div>
          <div class="d">${s.how}</div>
          ${s.marks.length ? `<div class="bars">${s.marks.map(m => `<span>${esc(m.name)} · ${m.km} km · ${m.depth} m</span>`).join('')}</div>` : ''}
        </div>
      </div>`
      )
      .join('')}
      <p class="sub" style="margin-top:10px">Spots come from your marks list. Add your own on the My marks tab and
      they will be picked here by tide and swell.</p>
    </div>
    <div class="card">
      <h3>${t.m.t} — what's biting</h3>
      <div class="fish" style="margin:12px 0 4px">${t.m.sp
        .map(
          n =>
            `<div class="fc${shut.has(n) ? ' closed' : ''}">${speciesArt(n)}<div class="n">${esc(n)}${shut.has(n) ? '<span class="shut">Closed</span>' : ''}</div></div>`
        )
        .join('')}</div>
      <div class="rule"></div>
      <p class="lbl">Bait</p><p class="sub">${t.m.bait.join(' · ')}</p>
      <p class="lbl">Lures</p><p class="sub">${t.m.lure.join(' · ')}</p>
      <p class="sub">${t.m.note}</p>
      ${t.mods.length ? `<div class="rule"></div><ul class="tight">${t.mods.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    </div>
  </section>

  <section>
    <h2 class="sect">Pre-launch checks</h2>
    <div class="card">
      ${
        day.prob != null
          ? `<p class="sub"><b style="color:${light(day.prob)}">${day.prob}%</b> of ${day.ensembleMembers} ensemble
        runs give at least ${TUNING.minWindowHours} hours in a row inside your limits at ${esc(short(best.z.name))}${zone.prob != null && zone.z.id !== best.z.id ? `, and ${zone.prob}% at ${esc(short(zone.z.name))}` : ''}.
        ${day.prob >= 70 ? 'That is a solid bet this far out.' : day.prob >= 40 ? 'Genuinely borderline — worth looking again tomorrow.' : 'Most runs say you get nothing, so plan around it.'}</p>`
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
        <summary>Your limits</summary>
        <label class="f">Maximum swell (m)<input type="number" step="0.1" min="0.1" max="6" id="s1" value="${cfg.maxSwell}"></label>
        <label class="f">Maximum sustained wind (kn)<input type="number" min="1" max="60" id="s2" value="${cfg.maxWind}"></label>
        <label class="f">Maximum gust (kn)<input type="number" min="1" max="80" id="s3" value="${cfg.maxGust}"></label>
        <button class="save" data-act="saveLimits">Save limits</button>
        <p class="sub" style="margin-top:10px">Swell is weighted for period before it meets your limit, so 0.6 m at
        5 seconds counts as roughly 0.8 m and 0.6 m at 11 seconds as about 0.5 m. Wind and gusts are compared as
        forecast — no allowance for shelter.</p>
      </details>
    </div>
    <footer>
      Forecasts from Open-Meteo: wind from its best-match model with ECMWF IFS 9 km, NOAA GFS and DWD ICON as
      cross-checks; swell from its best-match wave model with ECMWF WAM, NOAA GFS-Wave and Météo-France as
      cross-checks; probability from the ECMWF and NOAA ensembles. Each ramp is sampled at 2, 10, 15 and 20 km
      offshore along its run-out bearing and scored on the worst of the outer three. Sun and moon are computed
      on the device. Version ${APP_VERSION}. Scores are a filter, not a forecast — the skipper's call is the only one that counts.
    </footer>
  </section>`;
}

function renderMarks() {
  const byRamp = {};
  state.marks.forEach(m => (byRamp[m.ramp] = byRamp[m.ramp] || []).push(m));
  return `<section style="margin-top:14px">
    <h2 class="sect">Your marks</h2>
    <div class="card">
      <p class="sub">These feed the session planner — it picks the ground that suits the tide, the light and the
      swell. Distances are from the ramp, so keep everything inside your 20 km line.</p>
      <div class="form">
        <div><label for="mn">Name</label><input id="mn" placeholder="Four Mile lump"></div>
        <div><label for="mr">Ramp</label><select id="mr">${ZONES.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>
        <div><label for="mk">Distance out (km)</label><input id="mk" type="number" step="0.5" min="0" max="20" value="8"></div>
        <div><label for="md">Depth (m)</label><input id="md" type="number" min="0" max="200" value="10"></div>
        <div class="wide"><label for="mt">Ground</label><select id="mt">${MARK_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
        <div class="wide"><button class="save" data-act="addMark">Add mark</button></div>
      </div>
    </div>
    ${ZONES.filter(z => byRamp[z.id])
      .map(
        z => `
      <div class="card">
        <h3>${esc(z.name)}</h3>
        ${byRamp[z.id]
          .sort((a, b) => a.km - b.km)
          .map(
            m => `
          <div class="mk">
            <span class="g"><b style="font-weight:500">${esc(m.name)}</b>
              <span class="ty">${m.km} km · ${m.depth} m · ${esc(m.type)}</span></span>
            <button data-act="delMark" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">Remove</button>
          </div>`
          )
          .join('')}
      </div>`
      )
      .join('')}
  </section>`;
}

function renderLog() {
  const today = isoDay(new Date());
  const d = state.logDraft || {
    date: today,
    ramp: state.zsel || ZONES[0].id,
    species: '',
    rating: 2,
    notes: ''
  };
  const pat = patterns(state.log);
  const cap = k => k.charAt(0).toUpperCase() + k.slice(1);
  const rampName = id => (ZONES.find(z => z.id === id) || { name: id }).name;
  return `<section style="margin-top:14px">
    <h2 class="sect">Log a session</h2>
    <div class="card">
      <div class="form">
        <div><label for="ld">Date</label><input id="ld" type="date" max="${today}" value="${esc(d.date)}"></div>
        <div><label for="lr">Ramp</label><select id="lr">${ZONES.map(
          z => `<option value="${z.id}" ${z.id === d.ramp ? 'selected' : ''}>${esc(z.name)}</option>`
        ).join('')}</select></div>
        <div class="wide"><label for="ls">What you caught (comma separated)</label>
          <input id="ls" value="${esc(d.species)}" placeholder="Grunter, flathead"></div>
        <div class="wide"><label>How it went</label>
          <div class="rate">${RATINGS.map(
            (r, i) =>
              `<button data-act="rate" data-rating="${i}" class="${i === d.rating ? 'on' : ''}" aria-pressed="${i === d.rating}">${r}</button>`
          ).join('')}</div></div>
        <div class="wide"><label for="lnotes">Notes</label><input id="lnotes" value="${esc(d.notes)}" placeholder="Last of the run-out, 3in paddle tail"></div>
        <div class="wide"><button class="save" data-act="addLog">Save session</button></div>
      </div>
      <p class="sub" style="margin-top:10px">Conditions are stamped on the entry automatically for today and the
      two days before — tide phase, moon, wind and swell. Older sessions get the moon only.</p>
    </div>

    ${
      pat
        ? `<h2 class="sect" style="margin-top:22px">What your log says</h2>
    <div class="card">
      ${[
        ['tide', 'Tide'],
        ['moon', 'Moon'],
        ['ramp', 'Ramp'],
        ['wind', 'Wind from']
      ]
        .map(([k, lab]) => {
          const rows = pat[k];
          if (!rows || !rows.length) return '';
          return `<p class="lbl">${lab}</p><div class="bars" style="margin-bottom:10px">${rows
            .slice(0, 4)
            .map(
              r =>
                `<span style="color:${light((r.avg / 3) * 100)}">${esc(k === 'ramp' ? short(rampName(r.k)) : cap(k === 'moon' ? moonLabel(r.k) : String(r.k)))} · ${r.avg.toFixed(1)}/3 · ${r.n}</span>`
            )
            .join('')}</div>`;
        })
        .join('')}
      ${
        pat.species.length
          ? `<p class="lbl">Most logged</p>
        <div class="bars">${pat.species.map(([n, c]) => `<span>${esc(n)} × ${c}</span>`).join('')}</div>`
          : ''
      }
      <p class="sub" style="margin-top:12px">Once a pattern has enough sessions behind it, it nudges the bite score
      by a few points either way. It never touches the safety side — wind, swell and bar calls stay as they are.</p>
    </div>`
        : `<div class="card"><p class="sub">Log four or more sessions and this turns into your own pattern
      summary — which tide, moon and ramp actually produce for you.</p></div>`
    }

    ${
      state.log.length
        ? `<h2 class="sect" style="margin-top:22px">History <span>${state.log.length} sessions</span></h2>
    <div class="card">${state.log
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40)
      .map(
        e => `
      <div class="entry">
        <div class="h"><b>${esc(e.date)}</b>
          <span style="color:${light((e.rating / 3) * 100)}">${RATINGS[e.rating] || ''}</span>
          <span class="sub">${esc(rampName(e.ramp))}</span></div>
        ${e.species ? `<div>${esc(e.species)}</div>` : ''}
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
        <div style="margin-top:5px"><button data-act="delLog" data-id="${esc(e.id)}" class="del">Delete</button></div>
      </div>`
      )
      .join('')}</div>`
        : ''
    }
  </section>`;
}

/* ── Render and actions ─────────────────────────────────────────────────── */

export function render() {
  const app = $('app');
  // re-rendering replaces the DOM, so remember which panels were open
  const open = app.querySelectorAll
    ? [...app.querySelectorAll('details[open][data-key]')].map(d => d.dataset.key)
    : [];
  const body = state.tab === 'plan' ? renderPlan() : state.tab === 'marks' ? renderMarks() : renderLog();
  app.innerHTML = tabs() + body;
  open.forEach(k => {
    const d = app.querySelector(`details[data-key="${k}"]`);
    if (d) d.open = true;
  });
}

export function rebuild() {
  const built = build(state.raw, { cfg: state.cfg, log: state.log });
  state.days = built.days;
  state.past = built.past;
  state.sel = Math.min(state.sel, Math.max(0, state.days.length - 1));
  render();
}

const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

function formValues() {
  const g = id => {
    const n = $(id);
    return n ? n.value : '';
  };
  return { date: g('ld'), ramp: g('lr'), species: g('ls'), notes: g('lnotes') };
}

/** Build a catch-log entry, stamped with that day's conditions when we have them. */
export function logEntry(f, rating, built) {
  const c = conditionsFor(built, f.date, f.ramp);
  const noon = new Date(f.date + 'T12:00');
  const entry = {
    id: 'e' + Date.now(),
    date: f.date,
    ramp: f.ramp,
    species: f.species.trim(),
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
  day(el) {
    state.sel = +el.dataset.i;
    state.zsel = null;
    state.logDraft = null;
    render();
    scrollTop();
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
  delMark(el) {
    state.marks = state.marks.filter(m => m.id !== el.dataset.id);
    save('marks', state.marks);
    render();
  },
  rate(el) {
    state.logDraft = { ...formValues(), rating: +el.dataset.rating };
    render();
  },
  addLog() {
    const f = formValues();
    if (!f.date) {
      const n = $('ld');
      if (n) n.focus();
      return;
    }
    const rating = state.logDraft ? state.logDraft.rating : 2;
    state.log = state.log.concat([logEntry(f, rating, { days: state.days, past: state.past })]);
    save('log', state.log);
    state.logDraft = null;
    rebuild();
  },
  delLog(el) {
    state.log = state.log.filter(e => e.id !== el.dataset.id);
    save('log', state.log);
    rebuild();
  }
};

export function onAppClick(ev) {
  const el = ev.target.closest && ev.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el, ev);
}
