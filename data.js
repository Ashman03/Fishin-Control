/**
 * data.js — everything that talks to the network, and the sample data used
 * when it can't.
 *
 * Source: Open-Meteo (free, no key, CORS-enabled). Five kinds of request, all
 * fired in parallel:
 *
 *   forecast   wind, gusts, rain, pressure at all 20 sample points  (required)
 *   marine     swell, period, chop, sea level, sea temp at all 20   (degrades)
 *   windCheck  independent wind models at all 20, for agreement     (optional)
 *   waveCheck  independent wave models at all 20, for agreement     (optional)
 *   ensemble   perturbed wind members at the reference point        (optional)
 *
 * Every request sets cell_selection=sea. Open-Meteo's forecast and ensemble
 * APIs default to `land`, which snaps an offshore coordinate to a nearby land
 * grid cell — surface friction then knocks the wind down and the sea breeze
 * cycle dominates. Before v4 that silently under-read offshore wind.
 *
 * Nothing here interprets the weather; it fetches, validates and reports.
 * Each source's outcome lands in `status` so the UI can show what actually
 * answered, rather than an HTTP 200 full of nulls passing as success.
 */
import { POINTS, ZONES, TZ, TUNING, MODELS, REFERENCE_ZONE } from './config.js';
import { pad, localDate, pickVar, hasData } from './util.js';

const REF_POINT = POINTS[ZONES.find(z => z.id === REFERENCE_ZONE).ptMid];

const FORECAST_VARS =
  'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation,cloud_cover,pressure_msl';
const MARINE_VARS =
  'wave_height,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction,' +
  'wind_wave_height,sea_level_height_msl,sea_surface_temperature';

function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
}

const where = points => ({
  latitude: points.map(p => p.lat).join(','),
  longitude: points.map(p => p.lon).join(',')
});

/**
 * Request options shared by every call. `minimal` drops the two optional
 * parameters, used only to retry if the service ever rejects a request.
 */
const timing = minimal =>
  minimal
    ? { timezone: TZ, forecast_days: TUNING.forecastDays }
    : {
        timezone: TZ,
        forecast_days: TUNING.forecastDays,
        past_days: TUNING.pastDays, // lets a session logged yesterday get yesterday's conditions
        cell_selection: 'sea'
      };

/**
 * Open-Meteo's free tier counts every location as a separate call and limits
 * calls per minute. The primary requests need all 20 sample points; the
 * cross-checks only ever read the reference point, so they ask for just that
 * one. Before v4.2 they asked for all 20 — about 180 calls per refresh, enough
 * to be refused after a few quick refreshes.
 */
export const forecastUrl = (model, { points = POINTS, vars = FORECAST_VARS, minimal = false } = {}) =>
  'https://api.open-meteo.com/v1/forecast?' +
  query({
    ...where(points),
    hourly: vars,
    daily: points === POINTS ? 'sunrise,sunset' : null,
    wind_speed_unit: 'kn',
    models: model,
    ...timing(minimal)
  });

export const marineUrl = (model, { points = POINTS, vars = MARINE_VARS, minimal = false } = {}) =>
  'https://marine-api.open-meteo.com/v1/marine?' +
  query({ ...where(points), hourly: vars, models: model, ...timing(minimal) });

export const windCheckUrl = model => forecastUrl(model, { points: [REF_POINT], vars: 'wind_speed_10m' });

export const waveCheckUrl = model =>
  marineUrl(model, { points: [REF_POINT], vars: 'swell_wave_height,wave_height' });

/** One ensemble model per request, so one renamed model cannot take the others down. */
export const ensembleUrl = model =>
  'https://ensemble-api.open-meteo.com/v1/ensemble?' +
  query({
    ...where([REF_POINT]),
    hourly: 'wind_speed_10m,wind_gusts_10m',
    models: model,
    wind_speed_unit: 'kn',
    timezone: TZ,
    forecast_days: TUNING.forecastDays,
    cell_selection: 'sea'
  });

/** Plain-English reason for a failed request. */
export function describe(status, fallback) {
  if (status === 429) return 'too many requests — the free forecast service is rate limiting; wait a minute';
  if (status >= 500) return 'the forecast service is having trouble (HTTP ' + status + ')';
  if (status === 400) return 'the forecast service rejected the request (HTTP 400)';
  return fallback;
}

/**
 * One request, time-boxed, never throws. Resolves to
 * { ok, status, json, cached, savedAt, reason, error }. `cached` is set by the
 * service worker when it answered from its saved copy; `reason` says why.
 */
export async function attempt(url, timeoutMs = TUNING.fetchTimeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const header = name => (r.headers && r.headers.get(name)) || null;
    let json = null;
    try {
      json = await r.json();
    } catch (e) {
      /* non-JSON error body */
    }
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: describe(r.status, (json && json.reason) || 'HTTP ' + r.status)
      };
    }
    if (!json || json.error)
      return { ok: false, status: r.status, error: (json && json.reason) || 'empty response' };
    return {
      ok: true,
      status: r.status,
      json: Array.isArray(json) ? json : [json],
      cached: header('x-fc-cached') === '1',
      savedAt: +header('x-fc-saved-at') || null,
      reason: header('x-fc-reason')
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e.name === 'AbortError' ? 'timed out' : 'no connection (' + e.message + ')'
    };
  } finally {
    clearTimeout(timer);
  }
}

const hasWind = sets => Array.isArray(sets) && sets.some(o => hasData(pickVar(o.hourly, 'wind_speed_10m')));
const hasWaves = sets =>
  Array.isArray(sets) &&
  sets.some(
    o => hasData(pickVar(o.hourly, 'swell_wave_height')) || hasData(pickVar(o.hourly, 'wave_height'))
  );

/**
 * Pull ensemble members out of an hourly block, whatever the key naming.
 * Handles all of: wind_speed_10m, wind_speed_10m_member07,
 * wind_speed_10m_ecmwf_ifs025_ensemble, wind_speed_10m_member07_ncep_gefs_seamless.
 * Returns [{ id, wind:[], gust:[]|null }].
 */
export function parseEnsemble(hourly, label = '') {
  if (!hourly) return [];
  const members = new Map();
  const RX = /^(wind_speed_10m|wind_gusts_10m)(?:_member(\d+))?(?:_([a-z][a-z0-9_]*))?$/;
  for (const [key, values] of Object.entries(hourly)) {
    const m = RX.exec(key);
    if (!m || !hasData(values)) continue;
    const [, variable, member = '00', model = label || 'default'] = m;
    const id = model + '#' + member;
    if (!members.has(id)) members.set(id, { id, wind: null, gust: null });
    members.get(id)[variable === 'wind_speed_10m' ? 'wind' : 'gust'] = values;
  }
  return [...members.values()].filter(m => m.wind);
}

export async function getData() {
  const status = [];
  const record = (label, role, ok, detail) => status.push({ label, role, ok, detail });

  const [first, mar, ensSets, windSets, waveSets] = await Promise.all([
    attempt(forecastUrl()),
    attempt(marineUrl()),
    Promise.all(MODELS.ensemble.map(m => attempt(ensembleUrl(m)))),
    Promise.all(MODELS.windCheck.map(m => attempt(windCheckUrl(m)))),
    Promise.all(MODELS.waveCheck.map(m => attempt(waveCheckUrl(m))))
  ]);

  // The wind forecast is the one thing we cannot do without. If the service
  // rejects the request outright (not a rate limit), retry once without the
  // optional parameters before giving up.
  let fc = first,
    reduced = false;
  if (!fc.ok && fc.status >= 400 && fc.status < 500 && fc.status !== 429) {
    const retry = await attempt(forecastUrl(null, { minimal: true }));
    if (retry.ok && hasWind(retry.json)) {
      fc = retry;
      reduced = true;
    }
  }
  if (!fc.ok || !hasWind(fc.json)) {
    record('Wind forecast', 'primary', false, fc.error || 'no wind values returned');
    const err = new Error(fc.error || 'no wind values returned');
    err.status = status;
    throw err;
  }
  record(
    'Wind forecast',
    'primary',
    true,
    fc.cached ? 'saved copy (' + (fc.reason || 'offline') + ')' : reduced ? 'reduced request' : 'best match'
  );

  // waves: best match, then a named fallback, then carry on capped
  let marine = mar.ok && hasWaves(mar.json) ? mar.json : null;
  if (!marine) {
    const alt = await attempt(marineUrl(MODELS.waveFallback));
    if (alt.ok && hasWaves(alt.json)) marine = alt.json;
  }
  record('Swell forecast', 'primary', !!marine, marine ? 'best match' : mar.error || 'no wave values');

  const windAlt = [];
  MODELS.windCheck.forEach((model, i) => {
    const r = windSets[i],
      ok = r.ok && hasWind(r.json);
    record(model, 'wind check', ok, ok ? '' : r.error || 'no data for this location');
    if (ok) windAlt.push({ model, sets: r.json });
  });

  const waveAlt = [];
  MODELS.waveCheck.forEach((model, i) => {
    const r = waveSets[i],
      ok = r.ok && hasWaves(r.json);
    record(model, 'swell check', ok, ok ? '' : r.error || 'no data for this location');
    if (ok) waveAlt.push({ model, sets: r.json });
  });

  // each ensemble model carries its own time axis; the model aligns by timestamp
  const members = [];
  MODELS.ensemble.forEach((model, i) => {
    const r = ensSets[i];
    const h = r.ok && r.json[0] && r.json[0].hourly;
    const found = h && Array.isArray(h.time) ? parseEnsemble(h, model) : [];
    const times = h && Array.isArray(h.time) ? h.time.map(localDate) : [];
    found.forEach(m => members.push({ ...m, times }));
    record(
      model,
      'ensemble',
      found.length > 0,
      found.length ? found.length + ' members' : r.error || 'no members'
    );
  });
  const ensemble = members.length ? { members } : null;

  return {
    fc: fc.json,
    mar: marine || [],
    noWaves: !marine,
    windAlt,
    waveAlt,
    ensemble,
    status,
    cached: !!fc.cached,
    savedAt: fc.savedAt,
    savedReason: fc.reason,
    fetchedAt: Date.now()
  };
}

/**
 * Synthetic data in the same shape as getData(), used only when the network
 * is unreachable so the interface can still be explored. Flagged on screen.
 */
export function sampleData() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - TUNING.pastDays);
  const N = (TUNING.forecastDays + TUNING.pastDays) * 24,
    times = [];
  for (let i = 0; i < N; i++) {
    const d = new Date(+start + i * 36e5);
    times.push(
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':00'
    );
  }
  const days = [...new Set(times.map(t => t.slice(0, 10)))];
  const dayWind = [11, 9, 13, 8, 5, 7, 12, 17, 9];
  const daySwell = [0.9, 0.8, 1.1, 0.8, 0.42, 0.55, 0.9, 1.4, 0.65];
  const dayPeriod = [8, 8, 9, 10, 11, 8, 6, 5, 7];

  const fc = POINTS.map(pt => {
    const H = {
      time: times,
      wind_speed_10m: [],
      wind_gusts_10m: [],
      wind_direction_10m: [],
      temperature_2m: [],
      precipitation: [],
      cloud_cover: [],
      pressure_msl: []
    };
    for (let i = 0; i < N; i++) {
      const d = Math.floor(i / 24),
        hr = i % 24;
      const w = Math.max(
        2,
        dayWind[d % dayWind.length] + Math.max(0, Math.sin(((hr - 8) / 24) * 2 * Math.PI)) * 5 + pt.km * 0.08
      );
      H.wind_speed_10m.push(+w.toFixed(1));
      H.wind_gusts_10m.push(+(w * 1.35 + 1).toFixed(1));
      H.wind_direction_10m.push((120 + d * 14 + hr) % 360);
      H.temperature_2m.push(+(19 + 6 * Math.sin(((hr - 9) / 24) * 2 * Math.PI)).toFixed(1));
      H.precipitation.push(d === 7 && hr > 12 && hr < 18 ? 1.1 : 0);
      H.cloud_cover.push(40);
      H.pressure_msl.push(+(1018 - d * 0.7).toFixed(1));
    }
    return {
      hourly: H,
      daily: { time: days, sunrise: days.map(d => d + 'T05:45'), sunset: days.map(d => d + 'T17:35') }
    };
  });

  const mar = POINTS.map(pt => {
    const H = {
      time: times,
      wave_height: [],
      wave_period: [],
      swell_wave_height: [],
      swell_wave_period: [],
      swell_wave_direction: [],
      wind_wave_height: [],
      sea_level_height_msl: [],
      sea_surface_temperature: []
    };
    for (let i = 0; i < N; i++) {
      const d = Math.floor(i / 24);
      const sw = +(daySwell[d % daySwell.length] * (0.72 + pt.km * 0.018)).toFixed(2);
      const per = dayPeriod[d % dayPeriod.length];
      H.swell_wave_height.push(sw);
      H.wave_height.push(+(sw * 1.12).toFixed(2));
      H.swell_wave_period.push(per);
      H.wave_period.push(per - 1);
      H.swell_wave_direction.push(135);
      H.wind_wave_height.push(+(sw * 0.4).toFixed(2));
      H.sea_level_height_msl.push(
        +(1.25 * Math.sin((2 * Math.PI * i) / 12.42) + 0.35 * Math.sin((2 * Math.PI * i) / 25.8 + 1)).toFixed(
          3
        )
      );
      H.sea_surface_temperature.push(22.4);
    }
    return { hourly: H };
  });

  return {
    fc,
    mar,
    noWaves: false,
    windAlt: [],
    waveAlt: [],
    ensemble: null,
    status: [{ label: 'Sample data', role: 'offline', ok: false, detail: 'network unreachable' }],
    cached: false,
    savedAt: null,
    fetchedAt: Date.now()
  };
}
