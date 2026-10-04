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

const LATS = POINTS.map(p => p.lat).join(',');
const LONS = POINTS.map(p => p.lon).join(',');

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

const common = {
  timezone: TZ,
  forecast_days: TUNING.forecastDays,
  past_days: TUNING.pastDays, // lets a session logged yesterday get yesterday's conditions
  cell_selection: 'sea'
};

export const forecastUrl = model =>
  'https://api.open-meteo.com/v1/forecast?' +
  query({
    latitude: LATS,
    longitude: LONS,
    hourly: FORECAST_VARS,
    daily: 'sunrise,sunset',
    wind_speed_unit: 'kn',
    models: model,
    ...common
  });

export const marineUrl = model =>
  'https://marine-api.open-meteo.com/v1/marine?' +
  query({
    latitude: LATS,
    longitude: LONS,
    hourly: MARINE_VARS,
    models: model,
    ...common
  });

export const ensembleUrl = () => {
  const ref = POINTS[ZONES.find(z => z.id === REFERENCE_ZONE).ptMid];
  return (
    'https://ensemble-api.open-meteo.com/v1/ensemble?' +
    query({
      latitude: ref.lat,
      longitude: ref.lon,
      hourly: 'wind_speed_10m,wind_gusts_10m',
      models: MODELS.ensemble.join(','),
      wind_speed_unit: 'kn',
      timezone: TZ,
      forecast_days: TUNING.forecastDays,
      cell_selection: 'sea'
    })
  );
};

/**
 * One request, time-boxed, never throws. Resolves to
 * { ok, json, cached, savedAt, error }. `cached` is set by the service worker
 * when it had to answer from its offline copy.
 */
export async function attempt(url, timeoutMs = TUNING.fetchTimeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    const json = await r.json();
    if (json && json.error) return { ok: false, error: json.reason || 'API error' };
    return {
      ok: true,
      json: Array.isArray(json) ? json : [json],
      cached: r.headers && r.headers.get('x-fc-cached') === '1',
      savedAt: (r.headers && +r.headers.get('x-fc-saved-at')) || null
    };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timed out' : e.message };
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
export function parseEnsemble(hourly) {
  if (!hourly) return [];
  const members = new Map();
  const RX = /^(wind_speed_10m|wind_gusts_10m)(?:_member(\d+))?(?:_([a-z][a-z0-9_]*))?$/;
  for (const [key, values] of Object.entries(hourly)) {
    const m = RX.exec(key);
    if (!m || !hasData(values)) continue;
    const [, variable, member = '00', model = 'default'] = m;
    const id = model + '#' + member;
    if (!members.has(id)) members.set(id, { id, wind: null, gust: null });
    members.get(id)[variable === 'wind_speed_10m' ? 'wind' : 'gust'] = values;
  }
  return [...members.values()].filter(m => m.wind);
}

export async function getData() {
  const status = [];
  const record = (label, role, ok, detail) => status.push({ label, role, ok, detail });

  const [fc, mar, ens, windSets, waveSets] = await Promise.all([
    attempt(forecastUrl()),
    attempt(marineUrl()),
    attempt(ensembleUrl()),
    Promise.all(MODELS.windCheck.map(m => attempt(forecastUrl(m)))),
    Promise.all(MODELS.waveCheck.map(m => attempt(marineUrl(m))))
  ]);

  // forecast is the one thing we cannot do without
  if (!fc.ok || !hasWind(fc.json)) {
    record('Wind forecast', 'primary', false, fc.error || 'no wind values returned');
    const err = new Error('Wind forecast unavailable: ' + (fc.error || 'no data'));
    err.status = status;
    throw err;
  }
  record('Wind forecast', 'primary', true, fc.cached ? 'offline copy' : 'best match');

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

  let ensemble = null;
  if (ens.ok && ens.json[0] && ens.json[0].hourly) {
    const h = ens.json[0].hourly;
    const members = parseEnsemble(h);
    if (members.length && Array.isArray(h.time)) ensemble = { times: h.time.map(localDate), members };
  }
  record(
    'Ensemble',
    'probability',
    !!ensemble,
    ensemble ? ensemble.members.length + ' members' : ens.error || 'no members parsed'
  );

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
