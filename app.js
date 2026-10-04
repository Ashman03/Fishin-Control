/**
 * app.js — entry point. Wires the page up and runs the load sequence.
 * Everything else is in a module named for its job:
 *
 *   config.js  limits, tuning, model IDs, ramps and sample points
 *   data.js    network requests and sample data
 *   model.js   scoring and day-building (pure)
 *   advice.js  sessions, techniques, marks, catch-log patterns (pure)
 *   astro.js   sun and moon (pure)
 *   ui.js      rendering and click handlers
 *   store.js   state and localStorage
 *   map.js / art.js   the chart and the fish
 */
import { APP_VERSION } from './config.js';
import { state, loadStored, shareContext } from './store.js';
import { getData, sampleData } from './data.js';
import { render, rebuild, onAppClick, ACTIONS, countdown, tickCountdown } from './ui.js';
import { goDays, newlyGo, readShared, writeShared } from './alerts.js';
import { esc, isoDay } from './util.js';

const app = document.getElementById('app');

// Web fonts load after first paint; the system font stack shows until they arrive.
const FONTS =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Outfit:wght@300;400;500;600&display=swap';
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS }));
const stamp = document.getElementById('stamp');

/**
 * Load sequence. Each call takes a ticket; if Refresh is pressed again before
 * this one finishes, the older result is dropped rather than painted over
 * the newer one.
 */
async function start() {
  const ticket = ++state.loadSeq;
  const keepDay = state.days[state.sel] && state.days[state.sel].ds;
  if (!state.days.length) app.innerHTML = '<div class="state">Reading the water…</div>';
  stamp.textContent = 'Updating…';

  let raw,
    demo = false,
    loadError = null;
  try {
    raw = await getData();
  } catch (err) {
    console.warn('[data] using sample data:', err.message, err.status || '');
    raw = sampleData();
    raw.status = err.status || raw.status; // keep the real per-source outcomes for the panel
    demo = true;
    loadError = err.message;
  }
  if (ticket !== state.loadSeq) return; // a newer refresh has started

  try {
    state.raw = raw;
    state.demo = demo;
    state.loadError = loadError;
    rebuild();
    if (!state.days.length) throw new Error('no forecast days returned');
    if (keepDay) {
      const i = state.days.findIndex(d => d.ds === keepDay);
      if (i >= 0 && i !== state.sel) {
        state.sel = i;
        render();
      }
    }
    stamp.innerHTML = demo
      ? 'Sample data'
      : raw.cached
        ? 'Saved copy'
        : 'Live · ' +
          new Date(raw.fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    if (!demo && !raw.cached) await checkGoDays();
  } catch (err) {
    fail(err);
  }
}

/**
 * Compare today's green days with the last ones seen (on this phone, by the
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
  stamp.textContent = '';
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
window.addEventListener('unhandledrejection', e => console.warn('[app] unhandled rejection', e.reason));
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

// browsers treat localhost as secure, which lets the offline path be tested locally
// browsers treat localhost as secure, which lets the offline path be tested locally
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // a module worker, so it can run the same forecast model for background alerts
  navigator.serviceWorker
    .register('sw.js', { type: 'module' })
    .then(r => console.log('[sw] scope', r.scope))
    .catch(e => console.warn('[sw] registration failed', e));
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
      '<div class="card"><h3>Install self-check</h3>' +
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
