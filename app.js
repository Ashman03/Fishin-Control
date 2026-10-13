/**
 * app.js — entry point. Wires the page up and runs the load sequence.
 * Everything else is in a module named for its job:
 *
 *   config.js  limits, tuning, model IDs, ramps and sample points
 *   data.js    network requests and sample data
 *   model.js   scoring and day-building (pure)
 *   advice.js  sessions, techniques, catch-log patterns (pure)
 *   history.js the Flight log's stored days and their sums (pure)
 *   astro.js   sun and moon (pure)
 *   ui.js      rendering and click handlers
 *   store.js   state and localStorage
 *   map.js / art.js   the chart and the species pictures
 */
import { APP_VERSION } from './config.js';
import { state, loadStored, shareContext } from './store.js';
import { getData, sampleData } from './data.js';
import {
  render,
  rebuild,
  onAppClick,
  onAppChange,
  ACTIONS,
  countdown,
  tickCountdown,
  selectDay,
  feedsLine
} from './ui.js';
import { goDays, newlyGo, canAlert, readShared, writeShared } from './alerts.js';
import { esc, isoDay } from './util.js';

const app = document.getElementById('app');
const stamp = document.getElementById('stamp');

/** The status in the header; `st` (live, saved, demo, busy) colours its lamp. */
function setStamp(st, text) {
  stamp.dataset.st = st;
  stamp.textContent = text;
}

// A go-day notification opens the app on its day: ./?day=YYYY-MM-DD
let wantDay = new URLSearchParams(location.search).get('day');

/* ── Loading screen ─────────────────────────────────────────────────────── */

const splash = document.getElementById('splash');
const splashFill = document.getElementById('splashFill');
let splashUp = !!(splash && splashFill);
if (splashUp) splash.classList.add('live'); // the app has started: no boot help, and the bar is ours

/**
 * One line of the systems check: st is 'go', 'busy', 'wait' or 'nogo'. Each
 * line reports something the app has actually done, never a timed animation.
 */
function check(id, st, word, label) {
  const row = splashUp && document.getElementById(id);
  if (!row) return;
  row.dataset.st = st;
  row.querySelector('b').textContent = word;
  if (label) row.querySelector('span').textContent = label;
  const rows = [...splash.querySelectorAll('.sc-row')];
  const n = rows.filter(r => r.dataset.st !== 'busy' && r.dataset.st !== 'wait').length;
  document.getElementById('splashCount').textContent = n + ' of ' + rows.length;
}

/** Move the loading bar: a sliver at the start, full when the forecast is in. */
function splashProgress(done, total) {
  if (!splashUp) return;
  const pct = Math.round(6 + (88 * done) / total);
  splashFill.style.width = pct + '%';
  splashFill.parentElement.setAttribute('aria-valuenow', pct);
  document.getElementById('splashPct').textContent = pct + ' %';
  // how many have come back; whether they answered is set once getData returns
  check('scFeeds', 'busy', 'Loading', `Forecast feeds · ${done} of ${total}`);
}

if (splashUp) {
  document.getElementById('splashVer').textContent = 'v' + APP_VERSION;
  check('scApp', 'go', 'Go');
}

/** Fill the bar, hold it long enough to be seen, then fade the screen away. */
function hideSplash() {
  if (!splashUp) return;
  check('scScore', state.days.length ? 'go' : 'nogo', state.days.length ? 'Go' : 'No go');
  splashUp = false;
  splashFill.style.width = '100%';
  splashFill.parentElement.setAttribute('aria-valuenow', 100);
  document.getElementById('splashPct').textContent = '100 %';
  setTimeout(
    () => {
      splash.classList.add('out');
      setTimeout(() => splash.remove(), 500);
    },
    Math.max(250, 900 - performance.now())
  );
}

/**
 * Load sequence. Each call takes a ticket; if Refresh is pressed again before
 * this one finishes, the older result is dropped rather than painted over
 * the newer one.
 */
async function start() {
  const ticket = ++state.loadSeq;
  const fromAlert = !!wantDay;
  const keepDay = wantDay || (state.days[state.sel] && state.days[state.sel].ds);
  wantDay = null;
  if (!state.days.length) app.innerHTML = '<div class="state">Reading the water…</div>';
  setStamp('busy', 'Updating…');
  check(
    'scAlerts',
    state.alerts && state.alerts.on ? 'go' : 'off',
    state.alerts && state.alerts.on ? 'Armed' : 'Off'
  );

  let raw,
    demo = false,
    loadError = null;
  try {
    raw = await getData(splashProgress);
  } catch (err) {
    console.warn('[data] using sample data:', err.message, err.status || '');
    raw = sampleData();
    raw.status = err.status || raw.status; // keep the real per-source outcomes for the panel
    demo = true;
    loadError = err.message;
  }
  if (ticket !== state.loadSeq) return; // a newer refresh has started
  check('scFeeds', ...feedsLine(raw, demo)); // what answered, not just how many came back

  try {
    state.raw = raw;
    state.demo = demo;
    state.loadError = loadError;
    rebuild();
    if (!state.days.length) throw new Error('no forecast days returned');
    if (fromAlert) selectDay(keepDay, true);
    else if (keepDay && keepDay !== state.days[state.sel].ds) selectDay(keepDay);
    if (demo) setStamp('demo', 'Sample data');
    else if (raw.cached) setStamp('saved', 'Saved copy');
    else
      setStamp(
        'live',
        'Live ' + new Date(raw.fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
      );
    hideSplash();
    if (!demo && canAlert(raw)) await checkGoDays();
  } catch (err) {
    fail(err);
  }
}

/**
 * Compare today's go days (75 or more) with the last ones seen (on this phone, by the
 * page or the background worker) and flag any that are new. The first run
 * only records a baseline, so installing the app does not fire a burst.
 */
async function checkGoDays() {
  const now = goDays(state.days);
  const seen = await readShared('seen');
  const fresh = state.alerts.on ? newlyGo(seen, now) : [];
  await writeShared('seen', now);
  await shareContext();
  if (fresh.length) {
    state.freshGo = fresh;
    render();
  }
}

function fail(err) {
  console.error('[app]', err);
  hideSplash();
  setStamp('', '');
  app.innerHTML =
    '<div class="state err">Something went wrong building the forecast.<br>' +
    '<span style="color:var(--dim)">' +
    esc((err && err.message) || err) +
    '</span><br><br>' +
    '<button class="ghost" data-act="retry">Try again</button></div>';
}
ACTIONS.retry = () => start();

/* ── Wiring ─────────────────────────────────────────────────────────────── */

app.addEventListener('click', onAppClick);
app.addEventListener('change', onAppChange);
app.addEventListener('keydown', e => {
  // the map pins are SVG <g> elements, so give them Enter / Space like a button
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest && e.target.closest('[data-act]');
  if (el && el.tagName.toLowerCase() === 'g') {
    e.preventDefault();
    onAppClick(e);
  }
});
window.addEventListener('error', e => {
  if (!state.days.length) fail(e.error || new Error(e.message));
});
window.addEventListener('unhandledrejection', e => {
  console.warn('[app] unhandled rejection', e.reason);
  // before the first forecast is drawn, an error must not leave the loading screen up
  if (!state.days.length) fail(e.reason || new Error('start-up failed'));
});
document.getElementById('reload').addEventListener('click', start);

// re-check when the app comes back to the foreground after a while
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const stale = hiddenAt && Date.now() - hiddenAt > 30 * 60e3;
  const newDay = state.days[0] && state.days[0].ds !== isoDay(new Date());
  if (stale || newDay) start();
});

loadStored();
start();
console.log("%cFishin' Control v" + APP_VERSION, 'color:#7ad3f5;font-weight:700');

/* ── Install and offline ────────────────────────────────────────────────── */

let deferredPrompt = null;
let installState = 'waiting';
const installBtn = document.getElementById('install');

function refreshInstallUI() {
  const mm = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  if ((mm && mm.matches) || navigator.standalone) {
    installState = 'installed';
    installBtn.hidden = true;
    return;
  }
  installBtn.hidden = !deferredPrompt;
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  installState = 'ready';
  refreshInstallUI();
});
window.addEventListener('appinstalled', () => {
  installState = 'installed';
  deferredPrompt = null;
  refreshInstallUI();
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') deferredPrompt = null;
  refreshInstallUI();
});
refreshInstallUI();

// Service workers need a secure context: https, or localhost while testing.
if ('serviceWorker' in navigator && window.isSecureContext) {
  // A module worker, so it can run the same forecast model for background
  // alerts. updateViaCache 'none' checks sw.js and the modules it imports
  // against the server, not the ten-minute HTTP cache, so updates land promptly.
  navigator.serviceWorker
    .register('sw.js', { type: 'module', updateViaCache: 'none' })
    .then(r => console.log('[sw] scope', r.scope))
    .catch(e => console.warn('[sw] registration failed', e));
  // a tapped notification asks an already-open app to show its day
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'show-day' && !selectDay(e.data.ds, true)) {
      wantDay = e.data.ds;
      start();
    }
  });
}

// the launch clock ticks every second while the app is in view; when its
// target passes (window opens or closes) the whole countdown is rebuilt
setInterval(() => {
  if (document.hidden) return;
  const el = document.getElementById('tminus');
  if (el && !tickCountdown(el)) el.outerHTML = countdown();
}, 1000);

/* Add ?check to the address for a pass / fail list of install requirements. */
if (new URLSearchParams(location.search).has('check')) {
  setTimeout(async () => {
    const rows = [
      ['HTTPS', location.protocol === 'https:'],
      ['Service worker API', 'serviceWorker' in navigator]
    ];
    try {
      rows.push(['Service worker registered', !!(await navigator.serviceWorker.getRegistration())]);
    } catch (e) {
      rows.push(['Service worker registered', false]);
    }
    let man = null;
    try {
      man = await (await fetch('manifest.json')).json();
      rows.push(['Manifest loads', true]);
    } catch (e) {
      rows.push(['Manifest loads', false]);
    }
    if (man) {
      rows.push(['display: standalone', man.display === 'standalone']);
      for (const ic of man.icons || []) {
        let ok = false;
        try {
          ok = (await fetch(ic.src, { method: 'HEAD' })).ok;
        } catch (e) {
          /* stays false */
        }
        rows.push(['Icon ' + ic.src, ok]);
      }
    }
    rows.push(['Browser offered install', installState !== 'waiting']);
    app.innerHTML =
      '<div class="panel stack"><h3>Install self-check</h3>' +
      rows
        .map(
          ([k, v]) =>
            `<div class="mk"><span class="g">${esc(k)}</span><b style="color:${v ? 'var(--go)' : 'var(--no)'}">${v ? 'pass' : 'FAIL'}</b></div>`
        )
        .join('') +
      '<p class="sub" style="margin-top:10px">All green but no prompt usually means Chrome wants a few more ' +
      'seconds on the page, or it is already installed. Remove ?check to go back.</p></div>';
  }, 3000);
}
