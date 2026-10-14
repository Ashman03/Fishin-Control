/**
 * Fishin' Control — test suite. No dependencies: `node tests/run.js`.
 *
 * The clock is pinned to Queensland time before anything else runs. The app
 * renders Queensland local times against the device clock, so a test machine
 * on UTC will see "midnight" ten hours late and report phantom failures.
 *
 * Every bug fixed in v4 has a test here, named after the bug, so it stays fixed.
 */
process.env.TZ = 'Australia/Brisbane';

const results = [];
let group = '';
const describe = (name, fn) => {
  group = name;
  return fn();
};
async function it(name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
  } catch (e) {
    results.push({ group, name, ok: false, err: e.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
const near = (a, b, tol, msg) =>
  assert(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);

const imp = m => import('../' + m + '.js');
const [util, config, astro, data, model, advice, store] = await Promise.all(
  ['util', 'config', 'astro', 'data', 'model', 'advice', 'store'].map(imp)
);
const { POINTS, ZONES, MODELS, DEFAULTS } = config;
const CFG = { ...DEFAULTS };

/* ── Fixtures ───────────────────────────────────────────────────────────── */

/** sampleData() with optional per-point overrides, in Open-Meteo's shape. */
function fixture(tweak = {}) {
  const raw = data.sampleData();
  const set = (arr, key, fn) =>
    arr.forEach((p, i) => {
      p.hourly[key] = p.hourly[key].map((v, k) => fn(v, k, i));
    });
  if (tweak.wind != null) set(raw.fc, 'wind_speed_10m', () => tweak.wind);
  if (tweak.gust != null) set(raw.fc, 'wind_gusts_10m', () => tweak.gust);
  if (tweak.dir != null) set(raw.fc, 'wind_direction_10m', () => tweak.dir);
  if (tweak.swell != null) set(raw.mar, 'swell_wave_height', () => tweak.swell);
  if (tweak.period != null) set(raw.mar, 'swell_wave_period', () => tweak.period);
  return raw;
}
const calm = () => fixture({ wind: 6, gust: 8, swell: 0.4, period: 10, dir: 90 });

/** An ensemble block in the given key style, every member at `wind` knots. */
function ensembleHourly(times, wind, style) {
  const H = { time: times };
  const key = (v, m) =>
    ({
      plain: m === 0 ? v : `${v}_member${String(m).padStart(2, '0')}`,
      suffixed:
        m === 0 ? `${v}_ncep_gefs_seamless` : `${v}_member${String(m).padStart(2, '0')}_ncep_gefs_seamless`
    })[style];
  for (let m = 0; m <= 30; m++) {
    H[key('wind_speed_10m', m)] = times.map(() => wind);
    H[key('wind_gusts_10m', m)] = times.map(() => wind * 1.3);
  }
  return H;
}

/* ── util ───────────────────────────────────────────────────────────────── */

await describe('util', async () => {
  await it('circularMean: 350° and 10° average to north, not south', () => {
    const m = util.circularMean([350, 10]);
    assert(m < 1 || m > 359, 'got ' + m);
  });
  await it('circularMean is weighted by speed', () => near(util.circularMean([0, 90], [10, 1]), 5.7, 0.5));
  await it('pickVar reads a model-suffixed key', () =>
    assert(util.pickVar({ wind_speed_10m_ecmwf_ifs: [1] }, 'wind_speed_10m')[0] === 1));
  await it('pickVar does not confuse 10m with 100m', () =>
    assert(util.pickVar({ wind_speed_100m: [9] }, 'wind_speed_10m') === null));
  await it('pickVar does not return an ensemble member as the main series', () =>
    assert(util.pickVar({ wind_speed_10m_member01: [9] }, 'wind_speed_10m') === null));
  await it('esc escapes quotes for attributes', () =>
    assert(util.esc(`4" reef & 'co' <b>`) === '4&quot; reef &amp; &#39;co&#39; &lt;b&gt;'));
  await it('inArc wraps through north', () =>
    assert(util.inArc(10, [330, 60]) && !util.inArc(180, [330, 60])));
  await it('dirOf handles negative and >360 bearings', () =>
    assert(util.dirOf(-10) === 'N' && util.dirOf(450) === 'E'));
});

/* ── astro ──────────────────────────────────────────────────────────────── */

await describe('astro', async () => {
  // reference: PyEphem, Burnett Heads, 4 Oct 2026, AEST
  const e = astro.moonEvents(new Date(2026, 9, 4), -24.76, 152.41);
  const mins = d => d.getHours() * 60 + d.getMinutes();
  await it('moonrise within 6 min of ephemeris (00:45)', () => near(mins(e.rise), 45, 6));
  await it('moon overhead within 10 min of ephemeris (06:03)', () => near(mins(e.over), 363, 10));
  await it('moonset within 6 min of ephemeris (11:24)', () => near(mins(e.set), 684, 6));
});

/* ── data ───────────────────────────────────────────────────────────────── */

await describe('data', async () => {
  await it('forecast requests sea grid cells (was land by default)', () =>
    assert(data.forecastUrl().includes('cell_selection=sea')));
  await it('ensemble requests sea grid cells', () =>
    assert(data.ensembleUrl(MODELS.ensemble[0]).includes('cell_selection=sea')));
  await it('each ensemble model is requested on its own', () =>
    MODELS.ensemble.forEach(m => {
      const u = decodeURIComponent(data.ensembleUrl(m));
      assert(u.includes('models=' + m + '&'), m);
    }));
  await it('cross-checks ask for one point, not all 20 (rate limits count every point)', () => {
    const pts = u =>
      decodeURIComponent(u)
        .match(/latitude=([^&]*)/)[1]
        .split(',').length;
    MODELS.windCheck.forEach(m => assert(pts(data.windCheckUrl(m)) === 1, m));
    MODELS.waveCheck.forEach(m => assert(pts(data.waveCheckUrl(m)) === 1, m));
    assert(pts(data.forecastUrl()) === POINTS.length, 'primary still needs every point');
  });
  await it('a rate-limit refusal is explained in plain English', () =>
    assert(/rate limit/.test(data.describe(429, 'x')) && /trouble/.test(data.describe(503, 'x'))));
  await it('no Europe-only wave model in the cross-check list', () =>
    assert(!MODELS.waveCheck.includes('ewam')));
  await it('forecast includes past days so recent sessions can be logged', () =>
    assert(data.forecastUrl().includes('past_days=2')));

  const times = ['2026-10-04T00:00', '2026-10-04T01:00'];
  await it('parseEnsemble reads plain member keys', () =>
    assert(data.parseEnsemble(ensembleHourly(times, 8, 'plain')).length === 31));
  await it('parseEnsemble reads model-suffixed member keys (renamed upstream)', () =>
    assert(data.parseEnsemble(ensembleHourly(times, 8, 'suffixed')).length === 31));
  await it('parseEnsemble pairs gusts with the right member', () => {
    const m = data.parseEnsemble(ensembleHourly(times, 8, 'suffixed'));
    assert(m.every(x => x.gust && x.gust[0] === 8 * 1.3));
  });
  await it('parseEnsemble ignores all-null members', () =>
    assert(data.parseEnsemble({ time: times, wind_speed_10m_member01: [null, null] }).length === 0));

  await it('attempt() times out instead of hanging', async () => {
    globalThis.fetch = (u, { signal }) =>
      new Promise((_, rej) =>
        signal.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        )
      );
    const r = await data.attempt('https://x', 50);
    assert(!r.ok && r.error === 'timed out', JSON.stringify(r));
  });

  await it('the fallback wave request asks only for wave fields (no currents or sea temperature)', async () => {
    const s = data.sampleData();
    const urls = [];
    globalThis.fetch = async url => {
      urls.push(url);
      // the best-match marine request is refused; everything else answers
      const primaryMarine = url.includes('marine-api') && !url.includes('models=');
      if (primaryMarine)
        return {
          ok: false,
          status: 400,
          json: async () => ({ reason: 'bad' }),
          headers: { get: () => null }
        };
      const body = url.includes('ensemble-api')
        ? { hourly: ensembleHourly(s.fc[0].hourly.time, 7, 'suffixed') }
        : url.includes('marine-api')
          ? s.mar
          : s.fc;
      return { ok: true, json: async () => body, headers: { get: () => null } };
    };
    const raw = await data.getData();
    const fallback = urls.find(
      u =>
        u.includes('marine-api') &&
        u.includes('models=' + MODELS.waveFallback) &&
        u.includes('swell_wave_period')
    );
    assert(fallback, 'no fallback wave request');
    assert(
      !/ocean_current|sea_surface_temperature/.test(decodeURIComponent(fallback)),
      'fallback asks for extras'
    );
    assert(!raw.noWaves, 'swell rescued by the fallback');
  });
  await it('getData marks a model that returns only nulls as down', async () => {
    const s = data.sampleData();
    const nulls = s.mar.map(p => ({
      hourly: Object.fromEntries(
        Object.entries(p.hourly).map(([k, v]) => [k, k === 'time' ? v : v.map(() => null)])
      )
    }));
    globalThis.fetch = async url => {
      const body = url.includes('ensemble-api')
        ? { hourly: ensembleHourly(s.fc[0].hourly.time, 7, 'suffixed') }
        : url.includes('marine-api')
          ? url.includes('meteofrance_wave')
            ? nulls
            : s.mar
          : s.fc;
      return { ok: true, json: async () => body, headers: { get: () => null } };
    };
    const raw = await data.getData();
    const mf = raw.status.find(x => x.label === 'meteofrance_wave');
    assert(mf && mf.ok === false, 'expected meteofrance_wave down');
    assert(
      raw.ensemble && raw.ensemble.members.length === 31 * MODELS.ensemble.length,
      'both ensemble models should parse under the new names'
    );
    assert(raw.waveAlt.length === MODELS.waveCheck.length - 1);
  });

  const ok = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
  const refuse = (status, reason) => ({
    ok: false,
    status,
    json: async () => ({ error: true, reason }),
    headers: { get: () => null }
  });
  const answer = (s, url) =>
    url.includes('ensemble-api')
      ? { hourly: ensembleHourly(s.fc[0].hourly.time, 7, 'plain') }
      : url.includes('marine-api')
        ? s.mar
        : s.fc;

  await it('one rejected ensemble model does not lose the other', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url =>
      url.includes('ensemble-api') && url.includes('models=' + MODELS.ensemble[0] + '&')
        ? refuse(400, 'unknown model')
        : ok(answer(s, url));
    const raw = await data.getData();
    assert(raw.ensemble && raw.ensemble.members.length === 31, 'expected the surviving model only');
    assert(raw.status.find(x => x.label === MODELS.ensemble[0]).ok === false);
  });

  await it('a rejected forecast request is retried without the optional parameters', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url => {
      const primary = url.includes('api.open-meteo.com/v1/forecast') && !url.includes('models=');
      return primary && url.includes('cell_selection') ? refuse(400, 'bad parameter') : ok(answer(s, url));
    };
    const raw = await data.getData();
    assert(raw.status[0].ok && raw.status[0].detail === 'reduced request', JSON.stringify(raw.status[0]));
  });

  await it('a rate limit is not retried (that would only make it worse)', async () => {
    let primaries = 0;
    globalThis.fetch = async url => {
      if (url.includes('api.open-meteo.com/v1/forecast') && !url.includes('models=')) primaries++;
      return refuse(429, '');
    };
    let msg = '';
    try {
      await data.getData();
    } catch (e) {
      msg = e.message;
    }
    assert(primaries === 1, 'asked ' + primaries + ' times');
    assert(/rate limit/.test(msg), msg);
  });

  await it('getData flags an offline copy served by the service worker', async () => {
    const s = data.sampleData();
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => s.fc,
      headers: {
        get: h =>
          ({ 'x-fc-cached': '1', 'x-fc-saved-at': '1700000000000', 'x-fc-reason': 'service busy' })[h] ?? null
      }
    });
    const raw = await data.getData();
    assert(raw.cached === true && raw.savedAt === 1700000000000 && raw.savedReason === 'service busy');
  });

  await it('a saved swell copy makes the forecast "not live", and the sources say so', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url => {
      const marine = url.includes('marine-api');
      const saved = { 'x-fc-cached': '1', 'x-fc-saved-at': '1700000000000', 'x-fc-reason': 'service busy' };
      return {
        ok: true,
        json: async () => (marine ? s.mar : s.fc),
        headers: { get: h => (marine ? (saved[h] ?? null) : null) }
      };
    };
    const raw = await data.getData();
    assert(raw.cached === true, 'swell from the saved copy was passed off as live');
    assert(raw.saved.join() === 'swell' && raw.savedAt === 1700000000000, JSON.stringify(raw.saved));
    const swell = raw.status.find(x => x.label === 'Swell forecast');
    assert(/saved copy \(service busy\)/.test(swell.detail), swell.detail);
  });

  await it('swell from the backup wave model is labelled as the backup', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url => {
      const best = url.includes('marine-api') && !url.includes('models=');
      return best
        ? { ok: false, status: 503, json: async () => ({}), headers: { get: () => null } }
        : {
            ok: true,
            json: async () => (url.includes('marine-api') ? s.mar : s.fc),
            headers: { get: () => null }
          };
    };
    const raw = await data.getData();
    const swell = raw.status.find(x => x.label === 'Swell forecast');
    assert(swell.ok && swell.detail.includes(MODELS.waveFallback + ' (backup model)'), swell.detail);
    assert(raw.cached === false && !raw.noWaves);
  });

  await it('getData moves the loading bar as each request comes back, ending full', async () => {
    const s = data.sampleData();
    globalThis.fetch = async () => ({ ok: true, json: async () => s.fc, headers: { get: () => null } });
    const seen = [];
    await data.getData((done, total) => seen.push([done, total]));
    const total = seen[0][1];
    assert(total >= 5 && seen.every(([, t]) => t === total), 'total ' + JSON.stringify(seen));
    assert(
      seen.every(([d], i) => d === i),
      'should count up from 0 one request at a time: ' + JSON.stringify(seen)
    );
    assert(seen.at(-1)[0] === total, 'never reached the end');
  });

  /* A feed that drifts: answers 200, but with a field renamed, dropped or in new units. */
  const drop = (sets, name) =>
    sets.map(p => ({
      ...p,
      hourly: Object.fromEntries(Object.entries(p.hourly).filter(([k]) => k !== name))
    }));

  await it('fieldGaps names a dropped field and a change of units, in plain words', () => {
    const s = data.sampleData();
    assert(data.fieldGaps(s.fc, data.FORECAST_VARS).length === 0, 'sample forecast is complete');
    assert(
      data.fieldGaps(drop(s.fc, 'wind_gusts_10m'), data.FORECAST_VARS).join() === 'gusts missing',
      'dropped gusts'
    );
    const mph = s.fc.map(p => ({ ...p, hourly_units: { wind_speed_10m: 'mph', wind_gusts_10m: 'kn' } }));
    assert(data.fieldGaps(mph, data.FORECAST_VARS).join() === 'wind in mph, not kn', 'wind units');
    const suffixed = s.mar.map(p => ({ ...p, hourly_units: { ocean_current_velocity_ecmwf_wam: 'm/s' } }));
    assert(
      data.fieldGaps(suffixed, data.MARINE_VARS).join() === 'currents in m/s, not km/h',
      'suffixed unit key'
    );
  });

  await it('a blank gust hour at one place shows the incomplete warning (only whole-field gaps did)', async () => {
    const s = data.sampleData();
    assert(data.fieldHoles(s.fc).length === 0, 'sample forecast has no holes');
    const holed = s.fc.map((p, i) => ({
      ...p,
      hourly: {
        ...p.hourly,
        wind_gusts_10m: p.hourly.wind_gusts_10m.map((v, k) => (i === 9 && k === 60 ? null : v))
      }
    }));
    assert(data.fieldGaps(holed, data.FORECAST_VARS).length === 0, 'fieldGaps alone misses it');
    assert(data.fieldHoles(holed).join() === 'gusts missing at some hours', data.fieldHoles(holed).join());
    assert(data.fieldHoles(s.fc.slice(0, 19)).join() === 'forecast for 19 of 20 places', 'short reply');
    const ends = s.fc.map(p => ({
      ...p,
      hourly: {
        ...p.hourly,
        wind_gusts_10m: p.hourly.wind_gusts_10m.map((v, k, all) => (k >= all.length - 5 ? null : v))
      }
    }));
    assert(data.fieldHoles(ends).length === 0, 'where the forecast stops at every place is not a hole');
    globalThis.fetch = async url =>
      ok(url.includes('api.open-meteo.com/v1/forecast') ? holed : answer(s, url));
    const raw = await data.getData();
    assert(raw.gaps.join() === 'gusts missing at some hours', raw.gaps.join());
  });

  await it('a forecast that answers without gusts is flagged, not passed off as complete', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url =>
      ok(url.includes('api.open-meteo.com/v1/forecast') ? drop(s.fc, 'wind_gusts_10m') : answer(s, url));
    const raw = await data.getData();
    const row = raw.status.find(x => x.label === 'Forecast details');
    assert(row && row.ok === false && /gusts missing/.test(row.detail), JSON.stringify(row));
    assert(raw.gaps.join() === 'gusts missing', raw.gaps.join());
  });

  await it('missing tide heights and sunrise times are flagged too', async () => {
    const s = data.sampleData();
    const noSun = s.fc.map(p => ({ hourly: p.hourly }));
    globalThis.fetch = async url =>
      ok(
        url.includes('marine-api')
          ? drop(s.mar, 'sea_level_height_msl')
          : url.includes('ensemble-api')
            ? answer(s, url)
            : noSun
      );
    const raw = await data.getData();
    assert(raw.gaps.join() === 'sunrise times missing,tide heights missing', raw.gaps.join());
  });

  await it('a complete forecast reports every field present', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url => ok(answer(s, url));
    const raw = await data.getData();
    const row = raw.status.find(x => x.label === 'Forecast details');
    assert(row && row.ok && raw.gaps.length === 0, JSON.stringify(row));
  });

  await it('the backup wave model is not faulted for tide heights it has never sent', async () => {
    const s = data.sampleData();
    globalThis.fetch = async url => {
      const best = url.includes('marine-api') && !url.includes('models=');
      return best
        ? refuse(503, '')
        : ok(url.includes('marine-api') ? drop(s.mar, 'sea_level_height_msl') : answer(s, url));
    };
    const raw = await data.getData();
    assert(raw.gaps.length === 0, raw.gaps.join());
  });

  await it('the backup wave model is not faulted for the currents it was never asked for', async () => {
    const s = data.sampleData();
    const waves = drop(drop(s.mar, 'ocean_current_velocity'), 'sea_surface_temperature');
    globalThis.fetch = async url => {
      const best = url.includes('marine-api') && !url.includes('models=');
      return best ? refuse(503, '') : ok(url.includes('marine-api') ? waves : answer(s, url));
    };
    const raw = await data.getData();
    assert(raw.gaps.length === 0, raw.gaps.join());
  });
});

/* ── feed check (tools/check-feeds.js) ──────────────────────────────────── */

await describe('feed check', async () => {
  const feeds = await import('../tools/check-feeds.js');
  const s = data.sampleData();
  const strip = (sets, name) =>
    sets.map(p => ({
      ...p,
      hourly: Object.fromEntries(Object.entries(p.hourly).filter(([k]) => k !== name))
    }));
  const DPI = '<html><body><h1>Closed seasons</h1><p><b>Last updated:</b> 25 Sep 2026</p></body></html>';
  /** Answers like the real services, with `over` replacing any answer by URL. */
  const serve =
    (over = () => null) =>
    async url => {
      const o = over(url);
      if (o) return o;
      const body = url.includes('ensemble-api')
        ? { hourly: ensembleHourly(s.fc[0].hourly.time, 7, 'suffixed') }
        : url.includes('marine-api')
          ? s.mar
          : url.includes('open-meteo')
            ? s.fc
            : null;
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => (url.includes('dpi.qld') ? DPI : '<html>ok</html>'),
        headers: { get: () => null }
      };
    };
  const http = (status, reason = '') => ({
    ok: false,
    status,
    json: async () => ({ error: true, reason }),
    text: async () => '',
    headers: { get: () => null }
  });
  const kinds = list => Object.fromEntries(list.map(f => [f.source, f.kind]));

  await it('every source answering as expected finds nothing changed', async () => {
    globalThis.fetch = serve();
    const r = await feeds.run({ wait: 0 });
    const bad = r.findings.filter(f => f.kind !== 'ok');
    assert(r.state === 'ok' && bad.length === 0, JSON.stringify(bad));
    assert(/✅ All data sources/.test(feeds.report(r.findings)), 'headline');
  });

  await it('a renamed model is a change; a rate limit is only an outage', async () => {
    let busy = 0;
    globalThis.fetch = serve(url => {
      if (url.includes('models=' + MODELS.ensemble[0] + '&')) return http(400, 'Invalid model');
      if (url.includes('models=' + MODELS.windCheck[0] + '&')) return (busy++, http(429));
      return null;
    });
    const k = kinds(await feeds.checkOpenMeteo({ wait: 0 }));
    assert(k[`Wind ensemble (${MODELS.ensemble[0]})`] === 'changed', JSON.stringify(k));
    assert(k[`Wind cross-check (${MODELS.windCheck[0]})`] === 'outage', JSON.stringify(k));
    assert(busy === 3, 'a busy service is tried three times, got ' + busy);
  });

  await it('the backup swell model is not faulted for tide heights it has never sent', async () => {
    globalThis.fetch = serve(url =>
      url.includes('models=' + MODELS.waveFallback) && url.includes('sea_level')
        ? { ...http(200), ok: true, json: async () => strip(s.mar, 'sea_level_height_msl') }
        : null
    );
    const f = (await feeds.checkOpenMeteo({ wait: 0 })).find(x => x.source.startsWith('Backup swell'));
    assert(f.kind === 'ok', JSON.stringify(f));
  });

  await it('a field dropped from an answer that is otherwise fine is a change', async () => {
    globalThis.fetch = serve(url =>
      url.includes('marine-api') && !url.includes('models=')
        ? { ...http(200), ok: true, json: async () => strip(s.mar, 'ocean_current_velocity') }
        : null
    );
    const f = (await feeds.checkOpenMeteo({ wait: 0 })).find(x => x.source === 'Swell forecast (primary)');
    assert(f.kind === 'changed' && f.detail === 'currents missing', JSON.stringify(f));
  });

  await it('a forecast that stops short of the week is a change', async () => {
    const short = s.fc.map(p => ({
      ...p,
      hourly: { ...p.hourly, wind_speed_10m: p.hourly.wind_speed_10m.map((v, k) => (k < 72 ? v : null)) }
    }));
    globalThis.fetch = serve(url =>
      url.includes('/v1/forecast') && !url.includes('models=')
        ? { ...http(200), ok: true, json: async () => short }
        : null
    );
    const f = (await feeds.checkOpenMeteo({ wait: 0 })).find(x => x.source === 'Wind forecast (primary)');
    assert(f.kind === 'changed' && /wind only reaches/.test(f.detail), JSON.stringify(f));
  });

  await it('the closed seasons page updated after the app copied it is a change', async () => {
    globalThis.fetch = serve(url =>
      url.includes('dpi.qld')
        ? { ...http(200), ok: true, text: async () => DPI.replace('25 Sep 2026', '3 Mar 2027') }
        : null
    );
    const f = (await feeds.checkClosures()).find(x => x.source === 'DPI closed seasons page');
    assert(f.kind === 'changed' && f.detail.includes('2027-03-03'), JSON.stringify(f));
  });

  await it('DPI turning the check away is a note, not a daily "not reachable"', async () => {
    globalThis.fetch = serve(url => (url.includes('dpi.qld') ? http(403) : null));
    const f = (await feeds.checkClosures()).find(x => x.source === 'DPI closed seasons page');
    assert(f.kind === 'note', JSON.stringify(f));
  });

  await it('closure dates running out are flagged the year before, then as a change', async () => {
    globalThis.fetch = serve();
    const last = (await import('../closures.js')).CRFF_LAST_YEAR;
    const at = y => feeds.checkClosures({ now: Date.parse(y + '-06-01') });
    const pick = list => list.find(f => f.source === 'Coral reef fin fish dates');
    assert(!pick(await at(last - 2)), 'too early');
    assert(pick(await at(last - 1)).kind === 'note', 'year before');
    assert(pick(await at(last)).kind === 'changed', 'final year');
  });

  await it('a link that is gone is a change; a site turning the check away is not', async () => {
    globalThis.fetch = serve(url =>
      url.includes('msq.qld') ? http(404) : url.includes('bom.gov') ? http(403) : null
    );
    const found = await feeds.checkLinks();
    const gone = found.filter(f => f.kind === 'changed').map(f => f.source);
    assert(gone.join() === 'Link: MSQ tide tables,Link: Marine safety', JSON.stringify(found));
  });

  await it('the same problem keeps the same signature, so it is reported once', () => {
    const a = [
      { source: 'B', kind: 'changed' },
      { source: 'A', kind: 'changed' },
      { source: 'C', kind: 'outage' }
    ];
    assert(feeds.signature(a) === 'A + B', feeds.signature(a));
    assert(/❌ Something the app relies on has changed/.test(feeds.report(a)), 'headline');
  });

  await it('a run with only outages reads "outage", so it never closes a reported problem', async () => {
    globalThis.fetch = serve(url => (url.includes('models=' + MODELS.windCheck[0] + '&') ? http(503) : null));
    const r = await feeds.run({ wait: 0 });
    assert(r.state === 'outage', r.state);
    assert(
      feeds.overall([{ kind: 'outage' }, { kind: 'changed' }]) === 'changed',
      'a change outranks an outage'
    );
    assert(feeds.overall([{ kind: 'ok' }, { kind: 'note' }]) === 'ok', 'notes are fine');
  });

  await it('a busy service is retried for one request, then each other request is tried once', async () => {
    let calls = 0;
    globalThis.fetch = serve(url => (url.includes('open-meteo') ? (calls++, http(429)) : null));
    const found = await feeds.checkOpenMeteo({ wait: 0 });
    assert(
      found.every(f => f.kind === 'outage'),
      JSON.stringify(found)
    );
    assert(calls === 3 + (found.length - 1), calls + ' requests for ' + found.length + ' sources');
  });

  await it('the links are checked without downloading their pages', async () => {
    let reads = 0;
    globalThis.fetch = serve(url =>
      url.includes('open-meteo')
        ? null
        : {
            ...http(200),
            ok: true,
            text: async () => (reads++, url.includes('dpi.qld') ? DPI : 'page')
          }
    );
    await feeds.checkLinks();
    assert(reads === 0, reads + ' link pages downloaded');
    await feeds.checkClosures();
    assert(reads === 1, 'the DPI page is the one page read');
  });

  await it('a detail with a line break stays on its own row of the report', () => {
    const text = feeds.report([{ source: 'A', kind: 'changed', detail: 'line one\nline two' }]);
    assert(text.includes('| A | ❌ Changed | line one line two |'), text);
  });

  await it('the check can be imported without a script path (as the workflow may)', async () => {
    const { execFileSync } = await import('child_process');
    const out = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(new URL('../tools/check-feeds.js', import.meta.url).href)}); console.log(typeof m.run)`
    ]).toString();
    assert(out.trim() === 'function', out);
  });

  await it('the daily workflow closes an issue only on a clean run and keeps its schedule alive', async () => {
    const fs = await import('fs');
    const yml = fs.readFileSync(new URL('../.github/workflows/feed-check.yml', import.meta.url), 'utf8');
    assert(/issue && result\.state === 'ok'/.test(yml), 'an outage could close a real problem');
    assert(/open\.find\(i => !i\.pull_request\)/.test(yml), 'a pull request could be taken for the issue');
    assert(
      /if: always\(\) && github\.event_name == 'schedule'/.test(yml),
      'keep-alive skipped after a failure'
    );
    assert(/"state":"changed"/.test(yml), 'a crashed check must still raise the alert');
  });

  await it('isoDate reads the dates DPI writes', () => {
    assert(feeds.isoDate(': 5 September 2026 ') === '2026-09-05');
    assert(feeds.isoDate(' 25 Sep 2026') === '2026-09-25', 'DPI writes the month short');
    assert(feeds.isoDate('no date here') === null);
  });
});

/* ── model ──────────────────────────────────────────────────────────────── */

await describe('model', async () => {
  await it('swell is matched to the wind by time, so a saved copy from yesterday is not a day out', () => {
    const raw = data.sampleData();
    const plain = model.pointSeries(raw);
    // the same swell, but as a copy saved a day earlier: its hours start 24 h sooner
    const shifted = JSON.parse(JSON.stringify(raw));
    const t0 = raw.mar[0].hourly.time;
    const stamp = d => util.isoDay(d) + 'T' + util.pad(d.getHours()) + ':00';
    const earlier = t0.map(t => stamp(new Date(+util.localDate(t) - util.DAY)));
    shifted.mar.forEach(b => {
      for (const [k, arr] of Object.entries(b.hourly))
        if (k !== 'time') b.hourly[k] = [...Array(24).fill(9.9), ...arr.slice(0, -24)];
      b.hourly.time = earlier;
    });
    const got = model.pointSeries(shifted);
    for (let k = 0; k < t0.length - 24; k++)
      assert(
        got[5][k].swell === plain[5][k].swell,
        'hour ' + k + ': ' + got[5][k].swell + ' vs ' + plain[5][k].swell
      );
    assert(
      got[5].at(-1).swell === 0 && got[5].at(-1).lvl === null,
      'hours the copy does not cover stay empty'
    );
  });
  const offshoreZ = ZONES.find(z => z.id === 'burnett'); // exposed 20–140°, so 270° is offshore
  await it('an offshore 13 kn wind fails a 10 kn limit (was discounted to 9.4)', () => {
    const h = { swellEff: 0.3, swellChk: 0.3, wind: 13, gust: 13, wdir: 270 };
    assert(model.hourScore(h, offshoreZ, CFG).ok === false);
  });
  await it('passes() is inclusive at the limit and strict beyond it', () => {
    assert(
      model.passes(0.7, 10, 12, CFG) && !model.passes(0.71, 10, 12, CFG) && !model.passes(0.7, 10.1, 12, CFG)
    );
  });
  await it('short-period swell counts as bigger', () =>
    assert(model.periodFactor(5) > 1.2 && model.periodFactor(11) < 1));

  /* Safety fixes from the 13 Oct 2026 audit: each test below failed before its fix. */

  // tomorrow in the sample week: two past days, then today
  const TOMORROW = config.TUNING.pastDays + 1;
  /** Change every place's hourly figures for tomorrow: fn(fcHourly, marineHourly, k, hour). */
  const tomorrowAt = (raw, fn) =>
    raw.fc.forEach((p, i) =>
      p.hourly.time.forEach((t, k) => {
        if (Math.floor(k / 24) === TOMORROW) fn(p.hourly, raw.mar[i].hourly, k, k % 24, POINTS[i].zone);
      })
    );

  await it('long-period swell over the limit is a no go whatever its period (0.78 m at 12 s passed)', () => {
    const d = model.build(fixture({ wind: 6, gust: 8, swell: 0.78, period: 12, dir: 250 }), { cfg: CFG })
      .days[1];
    d.zones.forEach(z => assert(z.goodHrs === 0 && !z.win.length, z.z.id + ' passed ' + z.goodHrs + ' h'));
    assert(d.overall < 75, 'scored ' + d.overall);
    // short, steep swell still counts as more than its height
    assert(model.swellCheck(0.55, 0.55 * model.periodFactor(5)) > CFG.maxSwell, '0.55 m at 5 s');
    assert(model.swellCheck(0.6, 0.6 * model.periodFactor(12)) === 0.6, 'never below the forecast');
  });

  await it('a day of scattered passing hours is never a Go (alternating gusts scored 89 with no window)', () => {
    const s = calm();
    tomorrowAt(s, (F, M, k, hr) => (F.wind_gusts_10m[k] = hr % 2 ? 13 : 11));
    const d = model.build(s, { cfg: CFG }).days[1];
    assert(
      d.zones.every(z => !z.win.length),
      'expected no windows'
    );
    assert(d.overall <= config.TUNING.capNoWindow, 'scored ' + d.overall);
    d.zones.forEach(z => assert(z.score <= config.TUNING.capNoWindow, z.z.id + ' ' + z.score));
    assert(
      d.caps.some(c => /window/.test(c)),
      'the cap should say why: ' + d.caps.join()
    );
  });

  await it('a ramp with a launch window ranks above one without (best ramp could be unlaunchable)', () => {
    const s = calm();
    tomorrowAt(s, (F, M, k, hr, zone) => {
      // Walkers Point: a short morning window and a poor day; the rest: scattered calm hours
      if (zone === 'woodgate') F.wind_gusts_10m[k] = hr >= 6 && hr <= 8 ? 11 : 13;
      else F.wind_gusts_10m[k] = hr % 2 ? 13 : 11;
    });
    const d = model.build(s, { cfg: CFG }).days[1];
    assert(d.zones[0].z.id === 'woodgate' && d.zones[0].win.length, 'best ramp: ' + d.zones[0].z.id);
  });
  await it('a window still makes a Go: the no-window cap leaves good days alone', () => {
    const d = model.build(calm(), { cfg: CFG }).days[1];
    assert(d.zones[0].win.length && d.overall >= 75, 'calm day scored ' + d.overall);
    assert(!d.caps.length, 'capped: ' + d.caps.join());
  });

  await it('a forecast thunderstorm ends the launch window (it ran 05:00–18:35 through one)', () => {
    const s = calm();
    tomorrowAt(s, (F, M, k, hr) => {
      F.weather_code[k] = hr >= 13 && hr <= 15 ? 95 : 1;
      F.cape[k] = 100;
      F.precipitation[k] = 0;
    });
    const d = model.build(s, { cfg: CFG }).days[1];
    const z = d.zones[0];
    const storm = [new Date(+d.d0 + 12 * util.HOUR), new Date(+d.d0 + 16 * util.HOUR)];
    assert(z.win.length >= 2, 'expected a window either side, got ' + z.win.length);
    z.win.forEach(w => assert(w.b <= storm[0] || w.a >= storm[1], util.hhmm(w.a) + '–' + util.hhmm(w.b)));
    // a showery, unstable hour only costs points
    const t = calm();
    tomorrowAt(t, (F, M, k, hr) => {
      F.weather_code[k] = 80;
      F.cape[k] = hr === 12 ? 2000 : 100;
      F.precipitation[k] = hr === 12 ? 2 : 0;
    });
    assert(model.build(t, { cfg: CFG }).days[1].zones[0].win.length === 1, 'unstable hour broke the window');
  });

  await it('ensemble runs give no window through a thunderstorm either', () => {
    const s = calm();
    tomorrowAt(s, (F, M, k) => (F.weather_code[k] = 95));
    const times = s.fc[0].hourly.time;
    s.ensemble = {
      times: times.map(util.localDate),
      members: data.parseEnsemble(ensembleHourly(times, 6, 'suffixed'))
    };
    const b = model.build(s, { cfg: CFG });
    assert(b.days[1].prob === 0 && b.days[2].prob === 100, b.days[1].prob + ' / ' + b.days[2].prob);
  });

  await it('an hour with no gust figure is outside the limits (two blank hours made a window on a 14 kn day)', () => {
    const s = fixture({ wind: 8, gust: 14, swell: 0.4, period: 9, dir: 250 });
    tomorrowAt(s, (F, M, k, hr) => {
      if (hr === 9 || hr === 10) F.wind_gusts_10m[k] = null;
      else F.wind_gusts_10m[k] = 14;
    });
    const d = model.build(s, { cfg: CFG }).days[1];
    d.zones.forEach(z => assert(!z.win.length && z.goodHrs === 0, z.z.id + ' ' + z.goodHrs + ' h'));
    // a blank wind figure too
    const t = calm();
    tomorrowAt(t, (F, M, k, hr) => hr % 2 === 0 && (F.wind_speed_10m[k] = null));
    assert(
      model.build(t, { cfg: CFG }).days[1].zones.every(z => !z.win.length),
      'blank wind passed'
    );
  });

  await it('a place left out of the forecast is all gaps, not a copy of Baffle Creek', () => {
    const s = calm();
    const miara = ZONES.find(z => z.id === 'miara');
    s.fc[miara.ptOut[0]] = undefined;
    const d = model.build(s, { cfg: CFG }).days[1];
    const z = d.zones.find(x => x.z.id === 'miara');
    assert(z.goodHrs === 0 && !z.win.length, 'miara passed ' + z.goodHrs + ' h on borrowed wind');
    assert(d.zones.find(x => x.z.id === 'burnett').win.length, 'other ramps unaffected');
  });

  await it('bay points borrow waves from the nearest point, not the first in the list', () => {
    const s = data.sampleData();
    const wg = ZONES.find(z => z.id === 'woodgate');
    wg.pts.forEach(i => {
      s.mar[i] = { hourly: { time: s.mar[i].hourly.time } };
    });
    const j = model.nearestWithWaves(wg.ptOut[0], s.mar);
    assert(POINTS[j].zone !== 'baffle', 'borrowed from ' + POINTS[j].zone);
    assert(POINTS[j].zone === 'elliott', 'expected elliott, got ' + POINTS[j].zone);
  });

  await it('open-coast swell is not discounted by the bay shelter factor', () => {
    const b = model.build(fixture({ swell: 0.6, period: 8 }), { cfg: CFG });
    const z = b.days[0].zones.find(x => x.z.id === 'elliott');
    near(z.swellMax, 0.6, 0.001, 'elliott swell');
  });
  await it('Walkers Point borrows Elliott swell, not Baffle Creek swell', () => {
    // give each ramp a distinct swell so borrowing from the wrong one shows
    const s = fixture({ period: 8 });
    const swellOf = { baffle: 1.5, miara: 1.4, burnett: 1.2, elliott: 0.5, woodgate: 0.5 };
    POINTS.forEach((p, i) => {
      s.mar[i].hourly.swell_wave_height = s.mar[i].hourly.swell_wave_height.map(() => swellOf[p.zone]);
    });
    const wg = ZONES.find(z => z.id === 'woodgate');
    wg.pts.forEach(i => {
      s.mar[i] = { hourly: { time: s.mar[i].hourly.time } };
    });
    const z = model.build(s, { cfg: CFG }).days[0].zones.find(x => x.z.id === 'woodgate');
    near(z.swellMax, 0.5 * wg.shelterF, 0.001, 'woodgate swell (1.5 would mean it borrowed Baffle)');
  });

  await it('bay shelter factor applies only when wave data was borrowed', () => {
    const s = fixture({ swell: 0.6, period: 8 });
    ZONES.find(z => z.id === 'woodgate').pts.forEach(i => {
      s.mar[i] = { hourly: { time: s.mar[i].hourly.time } };
    });
    const z = model.build(s, { cfg: CFG }).days[0].zones.find(x => x.z.id === 'woodgate');
    near(z.swellMax, 0.6 * ZONES.find(x => x.id === 'woodgate').shelterF, 0.001, 'woodgate swell');
  });

  await it('daily wind direction is a circular mean (north stays north)', () => {
    const s = fixture({ wind: 8 });
    s.fc.forEach(p => {
      p.hourly.wind_direction_10m = p.hourly.wind_direction_10m.map((_, k) => (k % 2 ? 350 : 10));
    });
    const d = model.build(s, { cfg: CFG }).days[0].zones[0].wdir;
    assert(d < 5 || d > 355, 'got ' + d);
  });

  await it('build splits past days from today onward', () => {
    const b = model.build(fixture(), { cfg: CFG });
    const today = util.isoDay(new Date());
    assert(
      b.days[0].ds === today && b.days.length === 7 && b.past.length === 2 && b.past.every(d => d.ds < today)
    );
  });

  await it('tide comes from the 10 km point', () => {
    const s = fixture();
    const ref = ZONES.find(z => z.id === config.REFERENCE_ZONE);
    s.mar[ref.ptInshore].hourly.sea_level_height_msl = s.mar[ref.ptInshore].hourly.sea_level_height_msl.map(
      () => 0
    );
    const b = model.build(s, { cfg: CFG });
    assert(b.days[0].tides.length >= 3, 'tide curve should survive a flat 2 km point');
  });

  await it('calm ensemble gives 100%, windy ensemble gives 0% and caps the day', () => {
    const s = calm();
    const times = s.fc[0].hourly.time;
    s.ensemble = {
      times: times.map(util.localDate),
      members: data.parseEnsemble(ensembleHourly(times, 6, 'suffixed'))
    };
    assert(model.build(s, { cfg: CFG }).days[0].prob === 100);
    s.ensemble = {
      times: times.map(util.localDate),
      members: data.parseEnsemble(ensembleHourly(times, 20, 'suffixed'))
    };
    const d = model.build(s, { cfg: CFG }).days[0];
    assert(d.prob === 0 && d.overall <= config.TUNING.capLowProbability && d.caps.length);
  });

  await it('ensemble lines up by timestamp, not by array position', () => {
    // members are calm ONLY in tomorrow's daylight and blowing 25 kn every other hour,
    // and the ensemble starts 5 hours after the forecast. Correct alignment finds the
    // calm; positional alignment lands on the wrong hours and finds none.
    const s = calm();
    const times = s.fc[0].hourly.time.slice(5);
    const tomorrow = util.isoDay(new Date(Date.now() + util.DAY));
    const H = ensembleHourly(times, 0, 'plain');
    Object.keys(H)
      .filter(k => k !== 'time')
      .forEach(k => {
        H[k] = times.map(t =>
          t.startsWith(tomorrow) && +t.slice(11, 13) >= 6 && +t.slice(11, 13) <= 17 ? 6 : 25
        );
      });
    s.ensemble = { times: times.map(util.localDate), members: data.parseEnsemble(H) };
    const b = model.build(s, { cfg: CFG });
    assert(b.days[1].prob === 100, 'tomorrow should be 100%, got ' + b.days[1].prob);
    assert(b.days[2].prob === 0, 'the day after should be 0%, got ' + b.days[2].prob);
  });

  // the situation on the 5 Oct screenshot: ensemble unanimous, headline models apart
  const withEnsemble = (raw, wind) => {
    const times = raw.fc[0].hourly.time;
    raw.ensemble = {
      times: times.map(util.localDate),
      members: data.parseEnsemble(ensembleHourly(times, wind, 'plain'))
    };
    return raw;
  };
  const altWind = (raw, offset, nightOnly = false) => {
    const ref = ZONES.find(z => z.id === config.REFERENCE_ZONE).ptMid;
    const h = raw.fc[ref].hourly;
    raw.windAlt = [
      {
        model: 'x',
        sets: [
          {
            hourly: {
              time: h.time,
              wind_speed_10m: h.wind_speed_10m.map((v, k) =>
                !nightOnly || +h.time[k].slice(11, 13) < 4 ? v + offset : v
              )
            }
          }
        ]
      }
    ];
    return raw;
  };
  await it('a confident ensemble is not capped by a spread between headline models', () => {
    const d = model.build(withEnsemble(altWind(calm(), 12), 6), { cfg: CFG }).days[0];
    assert(d.agree.level === 'low', 'setup: expected low agreement');
    assert(d.prob === 100 && !d.caps.includes('models disagree'), JSON.stringify(d.caps));
  });
  await it('without an ensemble, a wide model spread still caps the day', () => {
    const d = model.build(altWind(calm(), 12), { cfg: CFG }).days[0];
    assert(d.caps.includes('models disagree') && d.overall <= config.TUNING.capLowAgreement);
  });
  await it('models are compared over daylight, not overnight', () => {
    const d = model.build(altWind(calm(), 30, true), { cfg: CFG }).days[0];
    assert(d.agree.level !== 'low', 'a night-only difference should not count: ' + d.agree.level);
  });
  await it('sea state is compared as total wave height, not the swell partition', () => {
    // an alternate wave model that labels nearly all of the same sea as wind-sea, not swell
    const s = calm();
    const ref = ZONES.find(z => z.id === config.REFERENCE_ZONE).ptMid;
    const h = s.mar[ref].hourly;
    s.waveAlt = [
      {
        model: 'y',
        sets: [
          {
            hourly: {
              time: h.time,
              wave_height: h.wave_height.slice(),
              swell_wave_height: h.swell_wave_height.map(() => 0.02)
            }
          }
        ]
      }
    ];
    const d = model.build(s, { cfg: CFG }).days[0];
    assert(d.agree.sSpread < 0.05, 'spread ' + d.agree.sSpread);
  });

  await it('fishing hours run from an hour before sunrise to an hour after sunset', () => {
    const d = model.build(calm(), { cfg: CFG }).days[0];
    assert(d.sunrise - d.from === 60 * 6e4 && d.to - d.sunset === 60 * 6e4);
  });
  await it('a window never runs past the end of the fishing hours', () => {
    const days = model.build(calm(), { cfg: CFG }).days;
    days.forEach(d =>
      d.zones.forEach(z =>
        z.win.forEach(w => assert(w.b <= d.to && w.a >= d.from, d.ds + ' ' + z.z.id + ' ends ' + w.b))
      )
    );
    const z = days[1].zones[0];
    assert(+z.win[z.win.length - 1].b === +days[1].to, 'a calm evening runs right up to the cut-off');
  });
  await it('a northerly costs a few points at most, and never changes go / no-go', () => {
    const h = { swellEff: 0.4, swellChk: 0.4, wind: 10, gust: 12, wdir: 0, against: 0, storm: 0 };
    const p = w => model.softPenalties({ ...h, wdir: w }, CFG).north;
    near(p(0), config.TUNING.northerly, 0.01, 'straight from the north');
    near(p(90), 0, 0.01, 'easterly');
    near(p(270), 0, 0.01, 'westerly');
    assert(p(45) > 0 && p(45) < p(0), 'north-east is partial');
    const z = ZONES[2];
    assert(model.hourScore({ ...h, wdir: 0 }, z, CFG).ok === model.hourScore({ ...h, wdir: 90 }, z, CFG).ok);
  });
  await it('wind against the current is penalised; wind with it is not', () => {
    // the current heads south-east (150°); a south-easter blows FROM 150° — straight into it
    near(model.windAgainstCurrent(15, 150, 1.2, 150), 1, 0.01, 'head-on');
    near(model.windAgainstCurrent(15, 330, 1.2, 150), 0, 0.01, 'wind with the current');
    near(model.windAgainstCurrent(15, 150, 0.1, 150), 0, 0.01, 'weak current does not count');
    near(model.windAgainstCurrent(15, 150, null, null), 0, 0.01, 'no current data');
  });
  await it('thunderstorms read from the weather code; unstable needs energy and showers', () => {
    assert(model.stormLevel(95, 0, 0) === 2 && model.stormLevel(97, 0, 0) === 2);
    assert(model.stormLevel(3, 1500, 1) === 1 && model.stormLevel(3, 1500, 0) === 0);
    assert(model.stormLevel(3, 200, 5) === 0);
  });
  await it('a storm lowers the score (and the hour before it), but is never a hard stop', () => {
    const raw = calm();
    raw.fc.forEach(p => {
      p.hourly.weather_code = p.hourly.time.map(t => (t.endsWith('T15:00') ? 95 : 1));
    });
    const d = model.build(raw, { cfg: CFG }).days[1];
    const z = d.zones.find(x => x.z.id === 'burnett');
    const at = hr => z.hours.find(h => h.t.getHours() === hr);
    assert(at(15).stormNow === 2 && at(14).storm === 2 && at(14).stormNow === 0, 'one-hour buffer');
    assert(at(12).storm === 0, 'earlier hours untouched');
    assert(at(15).z.ok && at(14).z.ok, 'still inside the limits');
    assert(at(15).z.s < at(12).z.s, 'but scored lower');
    assert(z.stormFrom.getHours() === 15 && z.stormMax === 2, 'day summary');
  });
  await it('the sample week has a storm afternoon and the caution and advisory panel shows it as HOLD', () => {
    const days = model.build(data.sampleData(), { cfg: CFG }).days;
    assert(
      days.some(d => d.zones.some(z => z.stormFrom)),
      'no storm in sample data'
    );
  });
  await it('river days score on tide and moon; wind only counts when strong', () => {
    const base = { range: 2.6, turns: 2, nf: 0.02, major: true, presTrend: 0, rain: 0, rain72: 0, windIn: 8 };
    const a = model.riverScore(base),
      b = model.riverScore({ ...base, windIn: 15 }),
      c = model.riverScore({ ...base, windIn: 22 });
    assert(a.score === b.score, 'moderate wind should not matter');
    assert(c.score < a.score && c.windStrong, 'strong wind should');
    const neap = model.riverScore({ ...base, range: 1.2, nf: 0.25, major: false, turns: 0 });
    assert(neap.score < a.score - 25, 'neap quarter moon with no turns is a poor river day');
    const flood = model.riverScore({ ...base, rain72: 40 });
    assert(flood.runoff && flood.score < a.score, 'run-off after heavy rain');
  });
  await it('missing swell data caps every score', () => {
    const s = calm();
    s.mar = [];
    s.noWaves = true;
    const d = model.build(s, { cfg: CFG }).days[0];
    assert(d.overall <= config.TUNING.capNoWaves && d.zones.every(z => z.score <= config.TUNING.capNoWaves));
  });

  await it('no NaN anywhere in a built week', () => {
    const json = JSON.stringify(model.build(fixture(), { cfg: CFG }));
    assert(!/NaN|Infinity/.test(json));
  });
});

/* ── advice ─────────────────────────────────────────────────────────────── */

await describe('advice', async () => {
  const zone = { z: { id: 'burnett', name: 'Burnett Heads' } };
  const moon = { phase: 0.3 };
  const entry = r => ({ ramp: 'burnett', moon: 'between', rating: r });
  await it('logHint stays quiet under six sessions', () =>
    assert(advice.logHint([1, 2, 3].map(entry), zone, moon) === null));
  await it('logHint nudges toward a strong record, within the cap', () => {
    const h = advice.logHint([3, 3, 3, 3, 3, 3].map(entry), zone, moon);
    assert(h && h.delta > 0 && h.delta <= config.TUNING.logNudgeMax);
  });
  await it('sessions never overlap', () => {
    const b = model.build(calm(), { cfg: CFG });
    const ss = advice.sessions(b.days[0], b.days[0].zones[0]);
    ss.forEach((a, i) => ss.slice(i + 1).forEach(c => assert(!(a.a < c.b && c.a < a.b), 'overlap')));
  });
});

/* ── closures ───────────────────────────────────────────────────────────── */

await describe('closures', async () => {
  const cl = await imp('closures');
  const z = id => ZONES.find(x => x.id === id);
  const ids = (date, ramp) => cl.activeClosures(new Date(date + 'T12:00'), z(ramp)).map(c => c.id);
  await it('coral reef fin fish closure 8–12 Oct 2026 applies at Burnett Heads', () =>
    assert(ids('2026-10-08', 'burnett').includes('crff') && ids('2026-10-12', 'burnett').includes('crff')));
  await it('...but not the day either side', () =>
    assert(!ids('2026-10-07', 'burnett').includes('crff') && !ids('2026-10-13', 'burnett').includes('crff')));
  await it('...and not south of 24°50′S (Elliott Heads, Walkers Point)', () =>
    assert(
      !ids('2026-10-09', 'elliott').includes('crff') && !ids('2026-10-09', 'woodgate').includes('crff')
    ));
  await it('barramundi closure runs across New Year', () =>
    assert(
      ids('2026-12-31', 'elliott').includes('barra') &&
        ids('2027-01-31', 'elliott').includes('barra') &&
        !ids('2027-02-01', 'elliott').includes('barra')
    ));
  await it('Spanish mackerel uses the southern dates (1–21 Feb, 1–21 Mar)', () =>
    assert(
      ids('2027-02-10', 'burnett').includes('spanish') &&
        !ids('2027-02-25', 'burnett').includes('spanish') &&
        ids('2027-03-21', 'burnett').includes('spanish')
    ));
  await it('snapper and pearl perch 15 Jul – 15 Aug', () =>
    assert(
      ids('2027-07-15', 'miara').includes('snapper') && !ids('2027-08-16', 'miara').includes('snapper')
    ));
  await it('upcoming closures look ahead two weeks', () => {
    const up = cl.upcomingClosures(new Date('2026-10-04T12:00'), z('burnett'));
    assert(up.length === 1 && up[0].closure.id === 'crff' && up[0].starts.getDate() === 8);
  });
  await it('closed species are flagged for the biting list', () =>
    assert(cl.closedSpecies(new Date('2026-10-09T12:00'), z('baffle')).has('Coral trout')));
  await it('warns once the published dates run out', () =>
    assert(!cl.closureDatesStale(new Date('2033-06-01')) && cl.closureDatesStale(new Date('2034-01-01'))));
});

/* ── river species ──────────────────────────────────────────────────────── */

await describe('river species', async () => {
  const cl = await imp('closures');
  // reef and offshore fish: never caught in the rivers and creeks
  const OFFSHORE = [
    'Spanish mackerel',
    'Spotted mackerel',
    'School mackerel',
    'Coral trout',
    'Red emperor',
    'Grass sweetlip',
    'Snapper',
    'Tuskfish',
    'Longtail tuna',
    'Mac tuna',
    'Squid'
  ];
  const dayIn = (m, extra = {}) => ({
    d0: new Date(2027, m, 15, 12),
    range: 2,
    rain: 0,
    presTrend: 0,
    sst: 23,
    moon: { phase: 0.25 },
    ...extra
  });
  await it('the rivers page lists only estuary fish, every month', () => {
    for (let m = 0; m < 12; m++) {
      const sp = advice.techniques(dayIn(m), true).m.sp;
      const bad = sp.filter(n => OFFSHORE.includes(n));
      assert(!bad.length, 'month ' + m + ': ' + bad.join(', '));
      assert(sp.length >= 6, 'month ' + m + ': only ' + sp.length);
    }
  });
  await it('the ocean page keeps its own list', () => {
    for (let m = 0; m < 12; m++) assert(advice.techniques(dayIn(m)).m === config.SEASON[m], 'month ' + m);
    assert(advice.techniques(dayIn(2)).m.sp.includes('Spanish mackerel'), 'ocean lost its spanish');
  });
  await it('a fish closed for the whole month is left off the river list (barra Nov to Jan)', () => {
    for (let m = 0; m < 12; m++) {
      const days = new Date(2027, m + 1, 0).getDate();
      for (const z of ZONES) {
        const all = new Set(cl.closedSpecies(new Date(2027, m, 1, 12), z));
        for (let d = 2; d <= days; d++) {
          const shut = cl.closedSpecies(new Date(2027, m, d, 12), z);
          all.forEach(n => shut.has(n) || all.delete(n));
        }
        const listed = config.RIVER_SEASON[m].sp.filter(n => all.has(n));
        assert(!listed.length, 'month ' + m + ' ' + z.id + ': ' + listed.join(', '));
      }
    }
    assert(!config.RIVER_SEASON[11].sp.includes('Barramundi'), 'barra in December');
    assert(config.RIVER_SEASON[1].sp.includes('Barramundi'), 'barra missing once open in February');
  });
  await it('every river month has a title, species, bait, lures and a note', () => {
    assert(Object.keys(config.RIVER_SEASON).length === 12);
    Object.values(config.RIVER_SEASON).forEach((m, i) => {
      assert(m.t && m.note && m.sp.length && m.bait.length && m.lure.length, 'month ' + i);
      assert(new Set(m.sp).size === m.sp.length, 'month ' + i + ' repeats a species');
    });
  });
  await it('river notes for the day talk about the river, not going wide or pelagics', () => {
    const r = advice.techniques(dayIn(0, { range: 1.2, sst: 27 }), true).mods.join(' ');
    assert(!/go wide|pelagic/i.test(r), r);
    const o = advice.techniques(dayIn(0, { range: 1.2, sst: 27 })).mods.join(' ');
    assert(/go wide/.test(o) && /pelagics/.test(o), 'ocean notes changed: ' + o);
  });
});

/* ── alerts ─────────────────────────────────────────────────────────────── */

await describe('alerts', async () => {
  const al = await imp('alerts');
  await it('no go-day alert from a saved copy or a forecast with fields missing', async () => {
    assert(al.canAlert({ cached: false, gaps: [] }), 'a clean live forecast may alert');
    assert(!al.canAlert({ cached: true, gaps: [] }), 'saved copy');
    assert(!al.canAlert({ cached: false, gaps: ['gusts missing'] }), 'gusts missing reads as calm');
    assert(!al.canAlert(null), 'nothing at all');
    const fs = await import('fs');
    const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert(/if \(!canAlert\(raw\)\) return \{ checked: false \}/.test(read('sw.js')), 'background check');
    assert(/!demo && canAlert\(raw\)\) await checkGoDays\(\)/.test(read('app.js')), 'page check');
  });
  const win = [{ a: new Date(2026, 9, 14, 6), b: new Date(2026, 9, 14, 10) }];
  const day = (ds, overall, w = win) => ({
    ds,
    overall,
    past: false,
    zones: [{ z: { name: 'Elliott Heads' }, win: w }]
  });
  await it('a go day for alerts is one the app calls Go: 75 or more, not 70', () =>
    assert(
      al
        .goDays([day('a', 70), day('b', 74), day('c', 75), day('d', 88)])
        .map(d => d.ds)
        .join() === 'c,d'
    ));
  await it('a go-day alert always has a launch window to name', () =>
    assert(
      al
        .goDays([day('a', 90, []), day('b', 90)])
        .map(d => d.ds + d.from)
        .join() === 'b06:00'
    ));
  await it('first run records a baseline and alerts nothing', () =>
    assert(al.newlyGo(null, [{ ds: 'x' }]).length === 0));
  await it('only days that were not green before are new', () =>
    assert(
      al
        .newlyGo([{ ds: 'a' }], [{ ds: 'a' }, { ds: 'b' }])
        .map(d => d.ds)
        .join() === 'b'
    ));
  await it('alert text names the day, ramp and score', () => {
    const t = al.alertText({
      ds: '2026-10-10',
      score: 82,
      ramp: 'Elliott Heads',
      from: '06:00',
      to: '11:00'
    });
    assert(
      /Go for launch/.test(t.title) && /Elliott Heads scores 82, window 06:00–11:00/.test(t.body),
      t.body
    );
  });
});

/* ── geography ──────────────────────────────────────────────────────────── */

await describe('geography', async () => {
  const { LAND } = await imp('map');
  const inPoly = (land, lat, lon) => {
    let c = false;
    for (let i = 0, j = land.length - 1; i < land.length; j = i++) {
      const [yi, xi] = land[i],
        [yj, xj] = land[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const onLand = (lat, lon) => LAND.some(p => inPoly(p, lat, lon));
  await it('the land test itself works (Bundaberg city is land)', () => assert(onLand(-24.866, 152.35)));
  await it('every 10, 15 and 20 km sample point is at sea', () => {
    const wet = POINTS.filter(p => p.km >= 10 && onLand(p.lat, p.lon));
    assert(!wet.length, wet.map(p => p.zone + ' ' + p.km + ' km').join(', '));
  });
  await it('every ramp sits on the coastline (within 2 km of the shore)', () => {
    const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.3, (a[1] - b[1]) * 101);
    ZONES.forEach(z => {
      const d = Math.min(...LAND.flat().map(p => km(p, [z.mlat, z.mlon])));
      assert(d < 2, z.id + ' is ' + d.toFixed(1) + ' km from the coast');
    });
  });
  await it('Walkers Point runs out east-north-east, off the front of Woodgate', () => {
    const wg = ZONES.find(z => z.id === 'woodgate');
    const p20 = POINTS[wg.pts[3]];
    assert(wg.out > 45 && wg.out < 90 && p20.lat > wg.mlat && p20.lon > wg.mlon, JSON.stringify(p20));
  });
});

/* ── art ────────────────────────────────────────────────────────────────── */

await describe('art', async () => {
  const art = await imp('art');
  const all = [
    ...new Set([config.SEASON, config.RIVER_SEASON].flatMap(t => Object.values(t).flatMap(m => m.sp)))
  ];
  const fs = await import('fs');
  const file = f => new URL('../' + f, import.meta.url);
  await it('every species in the seasonal lists has a painted illustration, or is waiting on one', () => {
    const missing = all.filter(n => !art.hasImage(n) && !art.ART_PENDING.includes(n));
    assert(!missing.length, 'no image: ' + missing.join(', '));
  });
  await it('species waiting on art are in use and have no picture yet', () =>
    art.ART_PENDING.forEach(n => {
      assert(all.includes(n), n + ' is not in any list');
      assert(!art.hasImage(n), n + ' has its picture now: take it off ART_PENDING');
    }));
  await it('no illustration is mapped to a species the app does not use', () => {
    const extra = Object.keys(art.SPECIES_IMAGES).filter(n => !all.includes(n));
    assert(!extra.length, 'unused: ' + extra.join(', '));
  });
  await it('each illustration is a 600×320 WebP with transparency, under 60 KB, at the site root', () =>
    Object.entries(art.SPECIES_IMAGES).forEach(([n, f]) => {
      assert(/^species-[a-z-]+\.webp$/.test(f), n + ': ' + f);
      assert(fs.existsSync(file(f)), f + ' missing');
      const b = fs.readFileSync(file(f));
      assert(
        b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 16) === 'WEBPVP8X',
        f + ' not WebP'
      );
      assert(b[20] & 0x10, f + ' has no transparency');
      const w = 1 + b.readUIntLE(24, 3),
        h = 1 + b.readUIntLE(27, 3);
      assert(w === 600 && h === 320, f + ' is ' + w + '×' + h);
      assert(b.length <= 60 * 1024, f + ' is ' + Math.round(b.length / 1024) + ' KB');
    }));
  await it('cards use the illustration, and keep their shape without one', () => {
    const img = art.speciesArt('Mangrove jack');
    assert(img.startsWith('<img class="sp" src="species-mangrove-jack.webp"'), img);
    assert(/ width="600" height="320"/.test(img) && / alt=""/.test(img), 'size/alt');
    assert(art.speciesArt('mangrove JACK') === img, 'names match regardless of case');
    const none = art.speciesArt('Some new fish');
    assert(
      /^<span class="sp sp-none" aria-hidden="true"><svg viewBox="0 0 150 80">.*<\/svg><\/span>$/.test(none),
      none
    );
  });
  await it('the service worker stores every illustration for offline use', () => {
    const sw = fs.readFileSync(file('sw.js'), 'utf8');
    Object.values(art.SPECIES_IMAGES).forEach(f => assert(sw.includes(`'./${f}'`), f + ' not in sw.js'));
    assert(/\(png\|webp\|/.test(sw), 'webp is not cache-first');
  });
});

/* ── store ──────────────────────────────────────────────────────────────── */

await describe('store', async () => {
  await it('validLimits rejects nonsense and keeps sane values', () => {
    const bad = store.validLimits({ maxSwell: -5, maxWind: 'x', maxGust: 500 });
    assert(
      bad.maxSwell === DEFAULTS.maxSwell &&
        bad.maxWind === DEFAULTS.maxWind &&
        bad.maxGust === DEFAULTS.maxGust
    );
    const ok = store.validLimits({ maxSwell: 0.9, maxWind: 12, maxGust: 15 });
    assert(ok.maxSwell === 0.9 && ok.maxWind === 12 && ok.maxGust === 15);
  });
  await it('reads data saved under the old bundy- prefix', () => {
    const mem = {
      'bundy-log': JSON.stringify({ v: 1, data: [{ date: '2026-09-01', ramp: 'burnett', rating: 3 }] })
    };
    globalThis.localStorage = {
      getItem: k => mem[k] ?? null,
      setItem: (k, v) => {
        mem[k] = v;
      }
    };
    store.loadStored();
    assert(store.state.log.length === 1);
  });
  await it('stored log entries come back as clean values, never markup', () => {
    const mem = {
      'fishin-log': JSON.stringify({
        v: 1,
        data: [
          { id: 'b', date: '2026-09-01', ramp: 'burnett', rating: 99, wind: 'lots', mark: 'Four Mile' },
          { id: 'c', date: '<script>', ramp: 'burnett', rating: 1 }
        ]
      })
    };
    globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem() {}, removeItem() {} };
    store.loadStored();
    assert(store.state.log.length === 1, 'entry with a bad date kept');
    assert(!('mark' in store.state.log[0]), 'a retired mark name is dropped from an old entry');
    const [e] = store.state.log;
    assert(e.rating === 3 && e.wind === null, JSON.stringify(e));
  });
  await it('discards corrupt stored data instead of crashing', () => {
    globalThis.localStorage = { getItem: () => '{not json', setItem() {} };
    const warn = console.warn;
    console.warn = () => {};
    store.loadStored();
    console.warn = warn;
    assert(Array.isArray(store.state.log) && store.state.log.length === 0);
  });
});

/* ── ui (with a minimal DOM) ────────────────────────────────────────────── */

await describe('ui', async () => {
  const nodes = {};
  globalThis.document = { getElementById: id => (nodes[id] = nodes[id] || { innerHTML: '', value: '' }) };
  globalThis.window = { scrollTo() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const ui = await imp('ui');
  const { state } = store;
  state.raw = fixture();
  state.cfg = { ...DEFAULTS };
  store.loadStored();
  ui.rebuild();

  for (const tab of ['plan', 'log']) {
    await it(`${tab} tab renders with no undefined or NaN`, () => {
      state.tab = tab;
      ui.render();
      const html = nodes.app.innerHTML;
      assert(html.length > 1000, 'too short');
      const bad = html.match(/undefined|NaN/);
      assert(
        !bad,
        'found ' + bad + ' near: ' + html.slice(Math.max(0, html.indexOf(bad) - 80), html.indexOf(bad) + 40)
      );
    });
  }
  await it('every ramp on every day renders', () => {
    state.tab = 'plan';
    state.days.forEach((d, i) =>
      d.zones.forEach(z => {
        state.sel = i;
        state.zsel = z.z.id;
        ui.render();
      })
    );
    assert(!/undefined|NaN/.test(nodes.app.innerHTML));
  });
  await it('map range rings are true-size circles with valid radii', async () => {
    const { mapSVG, MAPW } = await imp('map');
    const svg = mapSVG(state.days[0], 'burnett');
    const radii = [...svg.matchAll(/<circle [^>]*\br="(-?[\d.]+)"[^>]*stroke-dasharray/g)].map(m => +m[1]);
    assert(radii.length === 4, 'expected four rings, got ' + radii.length);
    assert(
      radii.every(r => r > 0),
      'bad radius: ' + radii.join(',')
    );
    // 20 km on a 90 km-wide chart is about 22% of its width
    near(radii[3] / MAPW, 20 / 90.9, 0.01, '20 km ring scale');
  });
  await it("limits are not drawn; the range is every ramp's 20 km reach", async () => {
    const { mapSVG } = await imp('map');
    const svg = mapSVG(state.days[0], 'burnett');
    assert(!/LIMIT|class="limit"|mRange/i.test(svg), 'limit markers or limit clipping drawn');
    const range = svg.match(/<g fill="#7ad3f5" opacity="\.07">([\s\S]*?)<\/g>/)[1];
    assert((range.match(/<circle /g) || []).length === ZONES.length, 'one 20 km reach per ramp');
  });
  await it('the daily score reads in every colour: faint water, figures on top, no outlines', () => {
    for (const score of [92, 62, 45, 18]) {
      const svg = ui.dial(score);
      const water = [...svg.matchAll(/class="fillw"[^>]*\sopacity="([\d.]+)"/g)].map(m => +m[1]);
      assert(water.length === 2 && water.every(o => o <= 0.2), score + ': water too strong ' + water);
      assert(svg.lastIndexOf('</g>') < svg.indexOf('<text'), score + ': figures must sit over the water');
      assert(/fill="#bde9fb" class="dial-sub">out of 100</.test(svg), score + ': "out of 100" must be light');
      assert(!/<text[^>]*\bstroke/.test(svg), score + ': outlined text');
    }
  });
  await it('map labels have no outlines, and every name fits its plate on the chart', async () => {
    const { mapSVG, MAPW, textWidth } = await imp('map');
    for (const z of ZONES) {
      const svg = mapSVG(state.days[0], z.id);
      assert(!/class="halo"|<text[^>]*\bstroke/.test(svg), z.id + ': outlined text');
      const pills = [
        ...svg.matchAll(
          /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="24"[^>]*\/>\s*<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)</g
        )
      ];
      assert(pills.length === ZONES.length, z.id + ': ' + pills.length + ' name pills');
      for (const [, rx, w, tx, size, name] of pills) {
        const right = +tx + textWidth(name, +size) * 1.02;
        assert(+tx >= +rx + 6 && right <= +rx + +w - 6, name + ' does not fit its pill');
        assert(+rx + +w <= MAPW, name + ' runs off the chart');
      }
    }
  });
  await it('distance labels on the rings stay off the land for every ramp', async () => {
    const { mapSVG, onLand, textWidth } = await imp('map');
    for (const z of ZONES) {
      const svg = mapSVG(state.days[0], z.id);
      const labels = [
        ...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="start" class="caps"[^>]*>(\d+ KM)</g)
      ];
      assert(labels.length === 2, z.id + ': ' + labels.length + ' ring labels');
      for (const [, x, y, text] of labels) {
        const w = textWidth(text, 12, 1.92);
        for (let i = 0; i <= 4; i++)
          for (const dy of [-9, -4, 1])
            assert(!onLand(+x + (w * i) / 4, +y + dy), z.id + ': ' + text + ' sits on the land');
      }
    }
  });
  await it('a saved swell copy is flagged on screen, naming the swell', () => {
    const keep = state.raw;
    state.raw = { ...keep, cached: true, saved: ['swell'], savedAt: Date.now(), savedReason: 'service busy' };
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    state.raw = keep;
    assert(
      html.includes('Saved swell forecast — not live') && html.includes('The wind is live'),
      'no banner'
    );
    assert(html.includes('Do not launch on it'));
  });
  await it('the bar card is marked indicative and links the MSQ tables, not prescriptive timing', () => {
    state.sel = 0;
    state.tab = 'plan';
    state.view = 'ocean';
    state.zsel = 'elliott';
    const d = state.days[0];
    const z = d.zones.find(x => x.z.id === 'elliott');
    const keep = z.barWin;
    z.barWin = [{ a: new Date(+d.d0 + 8 * util.HOUR), b: new Date(+d.d0 + 10 * util.HOUR), max: 3 }];
    ui.render();
    const html = nodes.app.innerHTML;
    z.barWin = keep;
    const card = html.slice(html.indexOf('Bar · '), html.indexOf('Bar · ') + 1200);
    assert(html.includes('Bar · '), 'no bar card');
    assert(/Indicative only/.test(card) && /msq\.qld\.gov\.au\/Tides/.test(card), 'not marked or linked');
    assert(!/Cross before it starts/.test(html), 'still tells you when to cross');
  });
  await it('the top card shows the swell figure the limit is checked against when it differs', () => {
    const keep = state.raw;
    state.raw = fixture({ wind: 6, gust: 8, swell: 0.5, period: 5, dir: 250 });
    ui.rebuild();
    state.sel = 0;
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const steep = nodes.app.innerHTML;
    state.raw = keep;
    ui.rebuild();
    ui.render();
    assert(/<dt>Counts as<\/dt><dd class="num">0\.[67] m/.test(steep), 'no Counts as for 0.5 m at 5 s');
    state.raw = fixture({ wind: 6, gust: 8, swell: 0.5, period: 12, dir: 250 });
    ui.rebuild();
    ui.render();
    const lazy = nodes.app.innerHTML;
    state.raw = keep;
    ui.rebuild();
    ui.render();
    assert(!lazy.includes('<dt>Counts as</dt>'), 'long-period swell counts as its own height: no extra line');
  });
  await it('a ramp with hours missing their gust figure is not tagged ok for gusts', () => {
    const keep = state.raw;
    state.raw = calm();
    state.raw.fc.forEach(p => (p.hourly.wind_gusts_10m = p.hourly.wind_gusts_10m.map(() => null)));
    state.raw.fc[0].hourly.wind_gusts_10m[0] = 8; // not missing everywhere, just everywhere that matters
    ui.rebuild();
    state.sel = 0;
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    state.raw = keep;
    ui.rebuild();
    assert(
      !/tag ok">gusts/.test(html) && /tag bad">gusts/.test(html),
      'gusts tagged ok with no gust figures'
    );
  });
  await it('launch sites quote the same hours as the caution panel (panel 3–8 kn green, sites 11–21 kn red)', () => {
    const keep = state.raw;
    state.raw = calm();
    // calm morning, blowing afternoon: a morning window, and a day peak well over the limits
    state.raw.fc.forEach(p =>
      p.hourly.time.forEach((t, k) => {
        if (+t.slice(11, 13) >= 12) [p.hourly.wind_speed_10m[k], p.hourly.wind_gusts_10m[k]] = [20, 26];
      })
    );
    ui.rebuild();
    state.sel = 1;
    state.tab = 'plan';
    state.view = 'ocean';
    state.zsel = 'burnett';
    ui.render();
    const html = nodes.app.innerHTML;
    state.raw = keep;
    ui.rebuild();
    const at =
      html.indexOf('<button class="zone') +
      html.slice(html.indexOf('<button class="zone')).indexOf('data-z="burnett"');
    const site = html.slice(at, html.indexOf('</button>', at));
    assert(site.includes('Burnett Heads / Port Bundaberg ramp'), 'not the launch sites entry');
    assert(
      /tag ok">6 kn/.test(site) && /tag ok">gusts 8/.test(site),
      'site tags: ' + site.replace(/<[^>]+>/g, ' ')
    );
    assert(/tag ok">window \d\d:\d\d–12:00/.test(site), 'window tag missing');
    assert(!/tag bad/.test(site.split('bar risk')[0]), 'a red tag beside a green panel');
  });
  await it('each ramp links to its own BOM zone', () => {
    state.sel = 0;
    state.tab = 'plan';
    state.zsel = 'baffle';
    ui.render();
    assert(nodes.app.innerHTML.includes('capricornia-coast'));
    state.zsel = 'woodgate';
    ui.render();
    assert(nodes.app.innerHTML.includes('hervey-bay-waters'));
    assert(!nodes.app.innerHTML.includes('fraser-island-coast'), "K'gari zone is not his water");
  });
  await it('logging yesterday stamps yesterday, not today', () => {
    const y = state.past[state.past.length - 1];
    const e = ui.logEntry({ date: y.ds, ramp: 'burnett', species: '', notes: '' }, 2, {
      days: state.days,
      past: state.past
    });
    const expect = y.zones.find(z => z.z.id === 'burnett');
    assert(e.wind === Math.round(expect.wind) && e.tide !== 'unknown');
  });
  await it('logging an old session stores the moon only, not wrong conditions', () => {
    const e = ui.logEntry({ date: '2025-01-15', ramp: 'burnett', species: '', notes: '' }, 2, {
      days: state.days,
      past: state.past
    });
    assert(e.wind === null && e.swell === null && e.tide === 'unknown' && e.moon);
  });
  await it('the caution and advisory panel has eight stations', () => {
    state.tab = 'plan';
    state.sel = 0;
    state.zsel = null;
    ui.render();
    assert((nodes.app.innerHTML.match(/class="adv-row"/g) || []).length === 8);
    assert(/adv-s (go|hold|nogo)/.test(nodes.app.innerHTML));
  });
  await it('Models station follows the ensemble: 100% of runs is never NO GO', () => {
    const d = state.days[0];
    const saved = { prob: d.prob, level: d.agree.level };
    d.prob = 100;
    d.agree.level = 'low';
    state.tab = 'plan';
    state.sel = 0;
    state.zsel = null;
    ui.render();
    const row = nodes.app.innerHTML.match(/adv-k">Models<\/span>[\s\S]*?adv-s (\w+)/)[1];
    assert(row !== 'nogo', 'got ' + row);
    d.prob = saved.prob;
    d.agree.level = saved.level;
  });
  await it('gust figure matches the verdict: the window, not the day peak', () => {
    const d = state.days[0],
      z = d.zones[0];
    const saved = { win: z.win };
    const t0 = d.from.getTime();
    z.win = [{ a: new Date(t0), b: new Date(t0 + 3 * 36e5) }];
    const inWin = z.hours.filter(h => h.t >= z.win[0].a && h.t < z.win[0].b);
    const want = Math.round(Math.max(...inWin.map(h => h.gust)));
    state.zsel = z.z.id;
    ui.render();
    const val = nodes.app.innerHTML.match(/adv-k">Gusts<\/span>\s*<span class="adv-v num">([^<]*)/)[1];
    assert(val === 'to ' + want + ' kn', 'got ' + val + ', want to ' + want + ' kn');
    z.win = saved.win;
  });
  await it('every day chip has a window track', () => {
    ui.render();
    assert((nodes.app.innerHTML.match(/class="track"/g) || []).length === state.days.length);
  });
  await it("the daily score fills to the score, with ticks at the verdict's green and amber lines", () => {
    for (const [lines, go, amber] of [
      [undefined, 75, 42], // the ocean score
      [[70, 40], 70, 40] // the river score
    ])
      for (const score of [92, 62, 45, 18]) {
        const svg = ui.dial(score, lines);
        const H = +svg.match(/viewBox="0 0 \d+ (\d+)"/)[1];
        const y = +svg.match(/<rect class="fillw" x="0" y="([\d.]+)"/)[1];
        near(y, H - (H * score) / 100, 0.05, score + ': water level');
        const ticks = [...svg.matchAll(/<path d="M0 ([\d.]+)h14"/g)].map(m => +m[1]);
        assert(ticks.length === 2, score + ': ' + ticks.length + ' ticks');
        near(ticks[0], H * (1 - go / 100), 0.05, 'green tick');
        near(ticks[1], H * (1 - amber / 100), 0.05, 'amber tick');
      }
  });
  await it('the week reads as one bar per day at its score, with the chosen day pressed', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    state.sel = 1;
    ui.render();
    const html = nodes.app.innerHTML;
    const bars = [...html.matchAll(/class="bar" style="--s:(\d+);/g)].map(m => +m[1]);
    assert(bars.join() === state.days.map(d => d.overall).join(), bars.join() + ' vs scores');
    const pressed = [...html.matchAll(/data-i="(\d+)" aria-pressed="true"/g)].map(m => m[1]);
    assert(pressed.join() === '1', 'pressed: ' + pressed.join());
    state.sel = 0;
  });
  await it('every section of the ocean page is still there after the redesign', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const heads = [...nodes.app.innerHTML.matchAll(/<h2 class="sect">([^<]+)/g)].map(m => m[1].trim());
    const want = [
      '7-day forecast',
      'Caution and advisory panel',
      'Launch control',
      'Launch sites',
      'Conditions',
      'Tide and moon',
      'Flight plan',
      "What's biting",
      'Pre-launch checks'
    ];
    assert(heads.join('|') === want.join('|'), heads.join('|'));
    ['id="tminus"', 'class="dial"', 'class="chart-map"', 'data-key="limits"', 'data-key="alerts"'].forEach(
      k => assert(nodes.app.innerHTML.includes(k), k + ' missing')
    );
  });
  await it('the rivers page reads score, week, then the caution and advisory panel', () => {
    state.tab = 'plan';
    state.view = 'river';
    ui.render();
    const html = nodes.app.innerHTML;
    const heads = [...html.matchAll(/<h2 class="sect">([^<]+)/g)].map(m => m[1].trim());
    const want = ['7-day forecast', 'Caution and advisory panel', 'Rivers and creeks'];
    assert(heads.slice(0, 3).join('|') === want.join('|'), heads.join('|'));
    assert(html.indexOf('class="dial"') < html.indexOf('class="panel week"'), 'score before the week');
    state.view = 'ocean';
  });
  await it("the rivers page's what's biting has no reef or offshore fish", () => {
    state.tab = 'plan';
    state.view = 'river';
    ui.render();
    const html = nodes.app.innerHTML;
    const biting = html.slice(html.indexOf('class="biting"'));
    const names = [...biting.matchAll(/<div class="n">([^<]+)/g)].map(m => m[1]);
    assert(names.length >= 6, 'names: ' + names.join(', '));
    const month = state.days[state.sel].d0.getMonth();
    assert(names.join() === config.RIVER_SEASON[month].sp.join(), names.join());
    assert(
      !/Spanish mackerel|Coral trout|Red emperor|Snapper/.test(biting),
      'offshore fish on the rivers page'
    );
    state.view = 'ocean';
    ui.render();
    const o = nodes.app.innerHTML;
    const on = [...o.slice(o.indexOf('class="biting"')).matchAll(/<div class="n">([^<]+)/g)].map(m => m[1]);
    assert(on.join() === config.SEASON[month].sp.join(), 'ocean: ' + on.join());
  });
  await it('the week sits with the daily score and the panel comes after both, ocean and river', async () => {
    state.tab = 'plan';
    for (const view of ['ocean', 'river']) {
      state.view = view;
      ui.render();
      const html = nodes.app.innerHTML;
      const colA = html.slice(html.indexOf('class="col col-a"'), html.indexOf('class="advsec"'));
      assert(
        colA.includes('class="dial"') && colA.includes('class="panel week"'),
        view + ': week not beside the score'
      );
      assert(!colA.includes('class="adv '), view + ': panel still in the first column');
      assert(
        html.indexOf('class="advsec"') > html.indexOf('class="panel week"'),
        view + ': panel before the week'
      );
    }
    // on a wide screen the panel runs full width under the three columns, where the week was
    const fs = await import('fs');
    const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const wide = css.slice(css.indexOf('@media (min-width: 900px)'));
    assert(
      /\.deck > \.advsec \{\s*flex: 1 1 100%;\s*order: 4;/.test(wide),
      'panel not full width after the columns'
    );
    assert(!/\.telem|\.view-plan \.week/.test(css), 'old week rule left behind');
    state.view = 'ocean';
  });
  await it('the old names are gone: telemetry, score tank, launch poll, launch control chart', async () => {
    const fs = await import('fs');
    const old =
      /telemetry|score tank|river tank|launch poll|river poll|Launch control · chart|class="(tank|poll|telem)\b/i;
    state.tab = 'plan';
    for (const view of ['ocean', 'river']) {
      state.view = view;
      ui.render();
      assert(!old.test(nodes.app.innerHTML), view + ': ' + (nodes.app.innerHTML.match(old) || [])[0]);
    }
    state.view = 'ocean';
    ui.render();
    assert(/<span class="cap">Daily score<\/span>/.test(nodes.app.innerHTML), 'ocean caption');
    assert(/aria-label="Caution and advisory panel for /.test(nodes.app.innerHTML), 'ocean panel label');
    state.view = 'river';
    ui.render();
    assert(/<span class="cap">Daily score<\/span>/.test(nodes.app.innerHTML), 'river caption');
    assert(!/river score<\/span>|7-day river/i.test(nodes.app.innerHTML), 'river page still says river');
    state.view = 'ocean';
    const splash = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert(/<div class="splash-tag">Wide Bay<\/div>/.test(splash), 'loading screen tagline');
    // one name for the area everywhere: header and tab title match the loading screen
    assert(/<h1 class="mark">Fishin' Control<span>Wide Bay<\/span><\/h1>/.test(splash), 'header subtitle');
    assert(/<title>[^<]*Wide Bay<\/title>/.test(splash), 'tab title');
    assert(!/Bundaberg coast/i.test(splash), 'Bundaberg coast still on the page');
    for (const f of [
      'index.html',
      'manifest.json',
      'app.js',
      'ui.js',
      'alerts.js',
      'sw.js',
      'util.js',
      'styles.css',
      'README.md'
    ])
      assert(
        !old.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')),
        f + ' still uses an old name'
      );
  });
  await it('the caution and advisory panel heading totals the calls', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    const tally = html.match(/<h2 class="sect">Caution and advisory panel <span>([^<]+)/)[1];
    const n = st => (html.match(new RegExp(`adv-s ${st}"`, 'g')) || []).length;
    const want = [
      ['go', 'GO'],
      ['hold', 'HOLD'],
      ['nogo', 'NO GO']
    ]
      .filter(([st]) => n(st))
      .map(([st, w]) => n(st) + ' ' + w)
      .join(' · ');
    assert(tally === want, tally + ' vs ' + want);
  });
  await it('the ocean panel is an annunciator: a bezel with four screws, its heading on the bezel', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    const annun = html.slice(
      html.indexOf('<div class="annun">'),
      html.indexOf('</section>', html.indexOf('class="annun"'))
    );
    assert(annun.length > 0 && html.includes('<div class="annun">'), 'no bezel');
    assert(
      (annun.match(/class="screw (tl|tr|bl|br)" aria-hidden="true"/g) || []).length === 4,
      'four screws'
    );
    assert(/<h2 class="sect">Caution and advisory panel/.test(annun), 'heading inside the bezel');
    assert((annun.match(/class="adv-row"/g) || []).length === 8, 'eight keys inside the bezel');
    state.view = 'ocean';
  });
  await it('each key reads call, then station large, then figure', async () => {
    const fs = await import('fs');
    const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const rule = sel => css.match(new RegExp(sel.replace(/\./g, '\\.') + ' \\{([^}]*)\\}'))[1];
    const order = sel => +rule(sel).match(/order: (\d)/)[1];
    const size = sel => parseFloat(rule(sel).match(/font-size: ([\d.]+)px/)[1]);
    assert(order('.adv.tiles .adv-s') < order('.adv.tiles .adv-k'), 'call above the station');
    assert(order('.adv.tiles .adv-k') < order('.adv.tiles .adv-v'), 'figure under the station');
    assert(size('.adv.tiles .adv-k') > size('.adv.tiles .adv-s') + 6, 'station is the big word');
    assert(size('.adv.tiles .adv-s') >= 12 && size('.adv.tiles .adv-v') >= 12, 'small text stays readable');
    assert(!/-webkit-text-stroke|text-stroke/.test(css), 'no outlined text');
  });
  await it('on a wide screen the ocean panel sits straight under the score and chart, sites beside it', async () => {
    const fs = await import('fs');
    const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const areas = [...css.matchAll(/\.deck\.ocean \{[^}]*grid-template-areas: ([^;]+);/g)].map(m => m[1]);
    assert(
      areas.includes("'a b' 't t' 'p p' 'c c' 'n n' 'g g' 'f f'"),
      'mid width: countdown and panel under score and chart, then sites'
    );
    assert(
      areas.includes("'a b c' 't t c' 'p p c' 'n n n' 'g g g' 'f f f'"),
      'wide: sites run down beside the countdown and panel'
    );
    ['col-a', 'col-b', 'advsec', 'col-c', 'grid'].forEach(c =>
      assert(css.includes(`.deck.ocean > .${c} {`), c)
    );
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    assert(nodes.app.innerHTML.includes('<div class="deck ocean">'), 'ocean deck marked');
  });
  await it('a day with bar or closed-season cards keeps the wide layout packed (no gap above the countdown)', async () => {
    const fs = await import('fs');
    const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const day = state.days[state.sel],
      d0 = day.d0;
    const zone = day.zones.find(z => z.z.id === state.zsel) || day.zones[0];
    const barWin = zone.barWin;
    // a bar warning, and a date two weeks before a closed season starts
    zone.barWin = [{ a: new Date(+d0 + 11 * 36e5), b: new Date(+d0 + 15 * 36e5), max: 3 }];
    day.d0 = new Date(d0.getFullYear(), 9, 25);
    state.zsel = zone.z.id;
    state.tab = 'plan';
    try {
      for (const view of ['ocean', 'river']) {
        state.view = view;
        ui.render();
        const html = nodes.app.innerHTML;
        const colC = html.slice(html.indexOf('class="col col-c"'), html.indexOf('class="notes"'));
        assert(html.includes('class="notes"'), view + ': no cautions row');
        assert(!/class="alert /.test(colC), view + ': a caution card still sits in the sites column');
        const notes = html.slice(html.indexOf('class="notes"'), html.indexOf('class="grid"'));
        assert(notes.includes('Closed season coming up'), view + ': closed season card missing');
        if (view === 'ocean') assert(notes.includes('Bar · stay off it'), 'bar card missing');
      }
    } finally {
      zone.barWin = barWin;
      day.d0 = d0;
      state.view = 'ocean';
    }
    // a day with nothing to say leaves no empty row behind
    ui.render();
    if (!zone.barWin.length && !/Closed season/.test(nodes.app.innerHTML))
      assert(!nodes.app.innerHTML.includes('class="notes"'), 'empty cautions row');
    const wide = css.slice(css.indexOf('@media (min-width: 1180px)'));
    assert(
      /grid-template-rows: auto auto 1fr;/.test(wide),
      'a long sites column still spreads the rows apart'
    );
    assert(/\.deck\.ocean > \.advsec \{\s*align-self: stretch;/.test(wide), 'panel does not meet the sites');
    assert(
      /\.deck > \.notes \{\s*flex: 1 1 100%;\s*order: 4;/.test(css),
      'rivers: cautions not a row of their own'
    );
  });
  /* ── design critique fixes (13 Oct 2026) ── */
  const readCss = async () =>
    (await import('fs')).readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const wideCss = css => css.slice(css.indexOf('@media (min-width: 900px)'));
  await it('critique 1: on a wide screen the cards under the panel pair up instead of leaving gaps', async () => {
    const css = await readCss();
    const wide = wideCss(css);
    assert(!/\.deck > \.grid \{[^}]*\n\s*columns:/.test(wide), 'still flows down newspaper columns');
    assert(
      /\.deck\.ocean > \.grid \{\s*grid-template-areas: 'cond tide' 'plan biting' 'checks checks';/.test(
        wide
      ),
      'ocean pairs'
    );
    assert(
      /\.deck\.river > \.grid \{\s*grid-template-areas: 'tide plan' 'biting biting';/.test(wide),
      'river pairs'
    );
    assert(
      /grid-template-areas: 'plan checks' 'biting biting';/.test(wide),
      'ocean at 1180: plan beside checks, fish under both'
    );
    assert(/\.grid section > \.panel \{\s*flex: 1;/.test(wide), 'paired cards do not end level');
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    const stack = html.slice(html.indexOf('class="gstack"'), html.indexOf('class="gmain"'));
    assert(stack.includes('class="cond"') && stack.includes('class="tide"'), 'conditions and tide stack');
    const main = html.slice(html.indexOf('class="gmain"'));
    ['class="plan"', 'class="biting"', 'class="checks"'].forEach(c => assert(main.includes(c), c));
    // on a phone the groups are not boxes, so the order there is unchanged
    assert(
      /\.gstack,\s*\.gmain \{\s*display: contents;/.test(
        css.slice(0, css.indexOf('@media (min-width: 900px)'))
      )
    );
  });
  await it('critique 2: the daily score shows the launch and bite figures it is made from', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    state.days.forEach((d, i) => {
      state.sel = i;
      ui.render();
      const html = nodes.app.innerHTML;
      const m = html.match(
        /<span class="parts"><span>Launch <b[^>]*>(\d+)<\/b><\/span><span>Bite <b[^>]*>(\d+)<\/b>/
      );
      assert(m, i + ': no parts under the score');
      assert(+m[1] === d.zones[0].score && +m[2] === d.bite, i + ': ' + m[1] + '/' + m[2]);
    });
    state.sel = 0;
  });
  await it('critique 3: the best ramp figures sit in the hero, and the loose pills are gone', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    const hero = html.slice(html.indexOf('class="panel hero"'), html.indexOf('class="panel week"'));
    const ro = hero.match(/<dl class="readout">([\s\S]*?)<\/dl>/);
    assert(ro, 'no readout in the hero');
    ['Best ramp', 'Swell', 'Wind', 'Gusts', 'Close in', 'At 20 km'].forEach(k =>
      assert(ro[1].includes(`<dt>${k}</dt>`), k)
    );
    assert(!/class="pills?\b/.test(html), 'pills still drawn');
  });
  await it('critique 4: colours agree with their words (wind tag, best ramp, river day)', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    const i = state.days.findIndex(d => d.zones.some(z => z.windMax > state.cfg.maxWind));
    assert(i >= 0, 'sample week has no windy day');
    state.sel = i;
    ui.render();
    ui.render();
    let html = nodes.app.innerHTML;
    assert(/class="tag bad">[\d–]+ kn /.test(html), 'wind over the limit is not red');
    assert(!/class="tag mid">[\d–]+ kn /.test(html), 'wind over the limit is still amber');
    const d = state.days[0],
      saved = [d.overall, d.zones[0].score];
    d.overall = 20;
    d.zones[0].score = 10;
    state.sel = 0;
    ui.render();
    html = nodes.app.innerHTML;
    assert(
      /<span class="pre">Ocean · No go<\/span>/.test(html),
      'River day does not say the red is the ocean'
    );
    assert(/<dt>Best ramp<\/dt><dd>/.test(html), 'a no-go best ramp is coloured');
    d.overall = 90;
    d.zones[0].score = 90;
    ui.render();
    html = nodes.app.innerHTML;
    assert(!html.includes('class="pre"'), 'Ocean · No go on a go day');
    assert(/<dt>Best ramp<\/dt><dd class="g">/.test(html), 'a go best ramp is not green');
    [d.overall, d.zones[0].score] = saved;
  });
  await it('critique 5: amber is HOLD on the map legend and the loading screen', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const legend = nodes.app.innerHTML.match(/<div class="legend">([\s\S]*?)<\/div>/)[1];
    assert(legend.includes('Hold') && !legend.includes('Marginal'), legend);
    const st = (...ok) => ok.map(o => ({ ok: o }));
    assert(ui.feedsLine({ status: st(true, false) }, false)[1] === 'Hold', 'partial');
    const saved = ui.feedsLine({ status: st(true, true), cached: true }, false);
    assert(saved[1] === 'Hold' && /saved copy/.test(saved[2]), saved.join());
  });
  await it('critique 6: the rivers panel is an annunciator too, short figures on the keys, the full reading read out', async () => {
    state.tab = 'plan';
    state.view = 'river';
    ui.render();
    const html = nodes.app.innerHTML;
    const annun = html.slice(
      html.indexOf('<div class="annun">'),
      html.indexOf('</section>', html.indexOf('class="annun"'))
    );
    assert(html.includes('<div class="annun">'), 'no bezel on the rivers page');
    assert((annun.match(/class="adv-row"/g) || []).length === 7, 'seven keys');
    const turns = annun.match(
      /<span class="adv-k">Turns<\/span><span class="adv-v num"([^>]*)>([^<]+)<\/span>(<span class="vh">([^<]+)<\/span>)?/
    );
    assert(turns && turns[2].length <= 12, 'turns key: ' + (turns && turns[2]));
    if (!/none/.test(turns[2]))
      assert(
        /aria-hidden/.test(turns[1]) && /(high|low) \d\d:\d\d/.test(turns[4]),
        'turn times not read out'
      );
    const css = await readCss();
    assert(
      /\.adv\.tiles \.adv-row:last-child:nth-child\(4n \+ 3\) \{\s*grid-column: span 2;/.test(css),
      'hole after the seventh key'
    );
    assert(!/\.adv\.rows/.test(css), 'old row layout left behind');
    state.view = 'ocean';
  });
  await it('critique 7: the conditions chart has its own storm marking and both scales', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    const i = state.days.findIndex(d => d.zones[0].hours.some(h => h.stormNow > 0));
    assert(i >= 0, 'sample week has no storm');
    state.sel = i;
    ui.render();
    const html = nodes.app.innerHTML;
    const svg = html.slice(
      html.indexOf('aria-label="Swell, wind and gusts'),
      html.indexOf('</svg>', html.indexOf('aria-label="Swell, wind and gusts'))
    );
    assert(/class="storm"[^>]*fill="url\(#stormHatch\)"/.test(svg), 'storms are not hatched');
    assert(!/fill="var\(--mid\)"[^>]*height="4"/.test(svg), 'storms still an amber tick, like the wind line');
    assert(/>[\d.]+ m<\/text>/.test(svg) && />\d+ kn<\/text>/.test(svg), 'no scale for swell and wind');
    assert(/<i class="bx st"><\/i>Storm</.test(html), 'legend');
    state.sel = 0;
  });
  await it('critique 8: "outside is out" is said once, and the extra links fold away', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    const i = state.days.findIndex(d => !d.zones[0].win.length);
    assert(i >= 0, 'sample week has no river day');
    state.sel = i;
    ui.render();
    const html = nodes.app.innerHTML;
    assert((html.match(/Outside is out today/g) || []).length === 1, 'said more than once');
    const checks = html.slice(html.indexOf('class="checks"'));
    const shown = checks.slice(0, checks.indexOf('<details data-key="links">'));
    assert((shown.match(/<a href/g) || []).length === config.TOP_SOURCES, 'links up front');
    const more = checks.match(/<details data-key="links">([\s\S]*?)<\/details>/)[1];
    assert(
      (more.match(/<a href/g) || []).length === config.SOURCES.length - config.TOP_SOURCES,
      'folded links'
    );
    state.sel = 0;
  });
  await it('critique 9: thumb-sized links and readable small labels', async () => {
    const css = await readCss();
    const px = (sel, prop) =>
      parseFloat(
        css.match(new RegExp(sel.replace(/[.()]/g, '\\$&') + ' \\{[^}]*?' + prop + ': ([\\d.]+)px'))[1]
      );
    assert(/\.links a,\s*\.links button \{[^}]*min-height: 44px/.test(css), 'links');
    assert(px('.checks .links a', 'min-height') >= 40, 'pre-launch links');
    assert(px('summary', 'min-height') >= 44, 'fold rows');
    assert(px('.tm-unit i', 'font-size') >= 11, 'countdown labels');
    assert(px('.tag', 'font-size') >= 11, 'ramp tags');
    assert(/\.tabs button \{[^}]*font-size: 11px/.test(css), 'sections bar labels');
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    assert(
      /<div class="links">\s*<button data-act="view" data-view="river">River view<\/button>/.test(
        nodes.app.innerHTML
      ),
      'River view is still a small inline link'
    );
  });
  await it('critique 10: the date never splits, the countdown follows the week, the loading screen is centred', async () => {
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const html = nodes.app.innerHTML;
    assert(
      /<span class="kick"><span>Flight director's call<\/span><span>\w{3} \d{1,2} \w{3}<\/span><\/span>/.test(
        html
      ),
      'kicker'
    );
    const css = await readCss();
    assert(/\.kick span \{\s*white-space: nowrap;/.test(css), 'kicker phrases can split');
    assert(html.indexOf('class="tmsec"') > html.indexOf('class="panel week"'), 'countdown above the week');
    assert(html.indexOf('class="tmsec"') < html.indexOf('class="advsec"'), 'countdown below the panel');
    assert(/\.splash-radar \{[^}]*margin-top: auto;/.test(css), 'loading screen not centred');
  });
  await it('the sections bar names all three sections, with the open one marked', () => {
    state.tab = 'log';
    ui.render();
    const nav = nodes.app.innerHTML.match(/<nav class="tabs"[\s\S]*?<\/nav>/)[0];
    ['Forecast', 'Flight log', 'Catch log'].forEach(l => assert(nav.includes(l), l));
    assert(!/marks/i.test(nav), 'My marks is gone');
    assert((nav.match(/aria-current="page"/g) || []).length === 1, 'one current');
    assert(/data-tab="log" class="on" aria-current="page"/.test(nav), 'log marked');
    state.tab = 'plan';
  });
  await it('countdown reads T-minus, window open, or no window — never blank', () => {
    const html = ui.countdown();
    assert(/T−|Window open|No launch window/.test(html), html);
  });
  await it('a window that is open now says so', () => {
    const d = state.days[0],
      z = d.zones[0];
    const saved = z.win;
    z.win = [{ a: new Date(Date.now() - 36e5), b: new Date(Date.now() + 36e5) }];
    assert(/Window open/.test(ui.countdown()));
    z.win = saved;
  });
  await it('launch clock splits time into days, hours, minutes and seconds', () => {
    const p = ui.clockParts(((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000);
    assert(p.d === '01' && p.h === '02' && p.m === '03' && p.s === '04', JSON.stringify(p));
    assert(ui.clockParts(-5000).s === '00', 'never negative');
  });
  await it('launch clock shows four labelled units, counting down with T−', () => {
    const d = state.days[0],
      z = d.zones[0],
      saved = z.win;
    const start = Date.now() + ((26 * 60 + 5) * 60 + 7) * 1000;
    z.win = [{ a: new Date(start), b: new Date(start + 4 * 36e5) }];
    const html = ui.countdown(new Date());
    z.win = saved;
    assert(/T−/.test(html) && !/T\+/.test(html), 'sign');
    ['Days', 'Hrs', 'Min', 'Sec'].forEach(l => assert(html.includes('<i>' + l + '</i>'), l));
    const digits = [...html.matchAll(/data-u="(\w)">(\d\d)</g)].map(m => m[1] + m[2]).join(' ');
    assert(digits === 'd01 h02 m05 s07' || digits === 'd01 h02 m05 s06', digits);
  });
  await it('once the window opens the clock turns green and counts up with T+', () => {
    const d = state.days[0],
      z = d.zones[0],
      saved = z.win;
    const opened = Date.now() - (90 * 60 + 30) * 1000;
    z.win = [{ a: new Date(opened), b: new Date(opened + 5 * 36e5) }];
    const html = ui.countdown(new Date());
    z.win = saved;
    assert(/class="tminus go"/.test(html) && /T\+/.test(html) && /Window open/.test(html), 'open state');
    const digits = [...html.matchAll(/data-u="(\w)">(\d\d)</g)].map(m => m[2]).join(':');
    assert(digits.startsWith('00:01:30'), digits);
  });
  await it('the tick moves the digits and asks for a rebuild when the window opens', () => {
    const b = u => ({ dataset: { u }, textContent: '' });
    const cells = ['d', 'h', 'm', 's'].map(b);
    const el = { dataset: { from: String(10_000 + 65_000), end: '0' }, querySelectorAll: () => cells };
    assert(
      ui.tickCountdown(el, 10_000) === true && cells[2].textContent === '01' && cells[3].textContent === '05'
    );
    assert(ui.tickCountdown(el, 10_000 + 65_000) === false, 'should hand over to a rebuild');
  });
  await it('new go days show a banner until dismissed', () => {
    state.freshGo = [{ ds: state.days[1].ds, score: 81, ramp: 'Elliott Heads', from: '06:00', to: '11:00' }];
    ui.render();
    assert(nodes.app.innerHTML.includes('New go day'));
    ui.ACTIONS.dismissGo();
    assert(!nodes.app.innerHTML.includes('New go day'));
  });
  await it('alerts panel offers to turn alerts on', () => {
    state.alerts = { on: false, mode: null };
    ui.render();
    assert(nodes.app.innerHTML.includes('data-act="alertsOn"'));
  });
  await it('the verdict word is coloured by what it says, not by the score (Marginal is never red)', () => {
    const d = state.days[0],
      saved = d.overall;
    state.tab = 'plan';
    state.view = 'ocean';
    state.sel = 0;
    for (const [score, word, colour] of [
      [45, 'Marginal', 'var(--mid)'],
      [72, 'Worth a look', 'var(--mid)'],
      [80, 'Go', 'var(--go)'],
      [30, 'River day', 'var(--no)']
    ]) {
      d.overall = score;
      ui.render();
      const m = nodes.app.innerHTML.match(/class="verdict[^"]*" style="color:([^"]+)">([^<]+)/);
      assert(m && m[2] === word && m[1] === colour, score + ': ' + (m && m[2] + ' in ' + m[1]));
    }
    d.overall = saved;
  });
  await it('the daily score is the colour of its verdict word, at every score, ocean and river', () => {
    const { LINES } = util;
    const scoreColour = svg => svg.match(/fill="([^"]+)" class="dial-num"/)[1];
    for (let s = 0; s <= 100; s++) {
      const sea = ui.VERDICT_COLOUR[ui.verdict(s, 50)[0]];
      assert(
        scoreColour(ui.dial(s, LINES.ocean)) === sea,
        'ocean ' + s + ': daily score vs ' + ui.verdict(s, 50)[0]
      );
      const river = ui.VERDICT_COLOUR[ui.riverWord(s)];
      assert(
        scoreColour(ui.dial(s, LINES.river)) === river,
        'river ' + s + ': daily score vs ' + ui.riverWord(s)
      );
    }
  });
  await it('every ocean score on the page is coloured at the verdict lines: daily score, week, sites, map, pill', () => {
    const d = state.days[0],
      saved = { overall: d.overall, scores: d.zones.map(z => z.score) };
    state.tab = 'plan';
    state.view = 'ocean';
    state.sel = 0;
    d.overall = 72; // "Worth a look": amber, where the old 70 line made it green
    d.zones.forEach(z => (z.score = 72));
    ui.render();
    const html = nodes.app.innerHTML;
    const greens = [
      /fill="var\(--go\)" class="dial-num"/,
      /class="sc num" style="color:var\(--go\)">72</,
      /--s:72;--c:var\(--go\)/,
      /class="zsc num" style="color:var\(--go\)"/,
      /class="pill g">Launch/
    ].filter(re => re.test(html));
    assert(!greens.length, 'still green at 72: ' + greens.join(' '));
    const pins = html.match(/<g class="pin"[^]*?<\/g>/g) || [];
    assert(pins.length && pins.every(p => !p.includes('var(--go)')), 'a map pin is still green at 72');
    assert(/fill="var\(--mid\)" class="dial-num"/.test(html), 'daily score not amber');
    assert(/--line-go:75;--line-amber:42/.test(html), 'week lines not at 75 / 42');
    d.overall = saved.overall;
    d.zones.forEach((z, i) => (z.score = saved.scores[i]));
    state.view = 'river';
    ui.render();
    assert(/--line-go:70;--line-amber:40/.test(nodes.app.innerHTML), 'river week lines not at 70 / 40');
    state.view = 'ocean';
  });
  await it('the Bite figure is coloured at its lamp lines (60 / 45)', () => {
    const d = state.days[0],
      saved = d.bite;
    state.tab = 'plan';
    state.view = 'ocean';
    state.sel = 0;
    for (const [bite, lamp, colour] of [
      [65, 'go', 'var(--go)'],
      [60, 'go', 'var(--go)'],
      [50, 'hold', 'var(--mid)'],
      [45, 'hold', 'var(--mid)'],
      [44, 'nogo', 'var(--no)']
    ]) {
      d.bite = bite;
      ui.render();
      const html = nodes.app.innerHTML;
      const row = html.match(/data-st="(\w+)">\s*<span class="adv-k">Bite</);
      const fig = html.match(/<div class="k">Bite<\/div><div class="v num" style="color:([^"]+)">/);
      assert(row && row[1] === lamp, bite + ': lamp ' + (row && row[1]));
      assert(fig && fig[1] === colour, bite + ': figure ' + (fig && fig[1]));
    }
    d.bite = saved;
  });
  await it('the Models % is coloured at its lamp lines (HOLD from 35%)', () => {
    const d = state.days[0],
      saved = { prob: d.prob, members: d.ensembleMembers, level: d.agree.level };
    state.tab = 'plan';
    state.view = 'ocean';
    state.sel = 0;
    d.ensembleMembers = d.ensembleMembers || 30;
    d.agree.level = 'high';
    for (const [prob, lamp, colour] of [
      [70, 'go', 'var(--go)'],
      [40, 'hold', 'var(--mid)'],
      [35, 'hold', 'var(--mid)'],
      [34, 'nogo', 'var(--no)']
    ]) {
      d.prob = prob;
      ui.render();
      const html = nodes.app.innerHTML;
      const row = html.match(/data-st="(\w+)">\s*<span class="adv-k">Models</);
      const check = html.match(/<p class="sub"><b style="color:([^"]+)">\d+%<\/b>/);
      assert(row && row[1] === lamp, prob + ': lamp ' + (row && row[1]));
      assert(check && check[1] === colour, prob + ': pre-launch checks ' + (check && check[1]));
    }
    Object.assign(d, { prob: saved.prob, ensembleMembers: saved.members });
    d.agree.level = saved.level;
  });
  await it('the top card is a summary: the ensemble figure sits in the pre-launch checks, not the hero', () => {
    const d = state.days[0],
      saved = { prob: d.prob, members: d.ensembleMembers };
    Object.assign(state, { tab: 'plan', view: 'ocean', sel: 0 });
    d.ensembleMembers = d.ensembleMembers || 30;
    d.prob = 11;
    ui.render();
    const html = nodes.app.innerHTML;
    const hero = html.slice(html.indexOf('class="panel hero"'), html.indexOf('class="panel week"'));
    assert(!/Ensemble|class="ens"|class="segs"/.test(hero), 'ensemble row still in the top card');
    const checks = html.slice(html.indexOf('class="checks"'));
    assert(
      /<b style="color:[^"]+">11%<\/b> of \d+ ensemble/.test(checks),
      'figure missing from the pre-launch checks'
    );
    Object.assign(d, { prob: saved.prob, ensembleMembers: saved.members });
  });
  await it('the verdict words change at their own scores: ocean 75 / 58 / 42, river 70 / 55 / 40', () => {
    for (const [s, word] of [
      [75, 'Go'],
      [74, 'Worth a look'],
      [58, 'Worth a look'],
      [57, 'Marginal'],
      [42, 'Marginal'],
      [41, 'River day']
    ])
      assert(ui.verdict(s, 50)[0] === word, s + ': ' + ui.verdict(s, 50)[0]);
    for (const [s, word] of [
      [70, 'Good river day'],
      [69, 'Worth a fish'],
      [55, 'Worth a fish'],
      [54, 'Steady'],
      [40, 'Steady'],
      [39, 'Slow']
    ])
      assert(ui.riverWord(s) === word, s + ': ' + ui.riverWord(s));
  });
  await it('the Models % takes its lamp colour, even when poor agreement holds a high % back', () => {
    const d = state.days[0],
      saved = { prob: d.prob, members: d.ensembleMembers, level: d.agree.level };
    Object.assign(state, { tab: 'plan', view: 'ocean', sel: 0 });
    d.ensembleMembers = d.ensembleMembers || 30;
    d.prob = 80;
    d.agree.level = 'low';
    ui.render();
    let html = nodes.app.innerHTML;
    assert(/data-st="hold">\s*<span class="adv-k">Models</.test(html), 'lamp should be HOLD');
    assert(/<b style="color:var\(--mid\)">80%<\/b>/.test(html), 'ensemble % not amber with its HOLD lamp');
    // the pre-launch words switch at the same 35% line as the lamp
    d.agree.level = 'high';
    d.prob = 37;
    ui.render();
    html = nodes.app.innerHTML;
    assert(html.includes('Genuinely borderline'), '37% reads as nothing, beside an amber HOLD');
    Object.assign(d, { prob: saved.prob, ensembleMembers: saved.members });
    d.agree.level = saved.level;
  });
  await it('river scores are coloured at the river verdict lines, on both pages', () => {
    const d = state.days[0],
      saved = d.river;
    Object.assign(state, { tab: 'plan', sel: 0 });
    d.river = 41; // "Steady": amber, where the old 48 line and the ocean 42 line make it red
    state.view = 'river';
    ui.render();
    assert(/fill="var\(--mid\)" class="dial-num"/.test(nodes.app.innerHTML), 'river score not amber at 41');
    state.view = 'ocean';
    ui.render();
    assert(
      /<b style="color:var\(--mid\)">41\/100<\/b>/.test(nodes.app.innerHTML),
      'site brief river score not amber'
    );
    d.river = saved;
  });
  await it('the week chart draws its dashed lines where the page puts them', async () => {
    const fs = await import('fs');
    const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    assert(/bottom: calc\(var\(--line-go[,)]/.test(css), 'green dashed line is fixed');
    assert(/bottom: calc\(var\(--line-amber[,)]/.test(css), 'amber dashed line is fixed');
  });
  await it('the alerts panel says alerts come on Go days, 75 or more', () => {
    for (const alerts of [
      { on: false, mode: null },
      { on: true, mode: 'background' }
    ]) {
      state.alerts = alerts;
      Object.assign(state, { tab: 'plan', view: 'ocean' });
      ui.render();
      const html = nodes.app.innerHTML;
      assert(!/turns green|70 or more/.test(html), 'old wording');
      assert(html.includes('turns Go (75 or more)'), 'does not say Go, 75 or more');
    }
    state.alerts = { on: false, mode: null };
  });
  await it('tapping a day keeps the page where it is, with the tapped day under the finger', () => {
    const calls = [];
    const saved = { scrollTo: window.scrollTo, scrollBy: window.scrollBy, qs: nodes.app.querySelector };
    window.scrollTo = (...a) => calls.push(['to', ...a]);
    window.scrollBy = (x, y) => calls.push(['by', x, y]);
    // the week sits 300 px down the screen before the tap, and 340 px after the
    // page above it is redrawn a little taller for the new day
    nodes.app.querySelector = sel =>
      sel === '.day[data-i="2"]' ? { getBoundingClientRect: () => ({ top: 340 }) } : null;
    Object.assign(state, { tab: 'plan', view: 'ocean', sel: 0 });
    ui.ACTIONS.day({ dataset: { i: '2' }, getBoundingClientRect: () => ({ top: 300 }) });
    assert(state.sel === 2, 'day not selected');
    assert(!calls.some(c => c[0] === 'to'), 'jumped: ' + JSON.stringify(calls));
    assert(
      JSON.stringify(calls) === '[["by",0,40]]',
      'did not hold the day in place: ' + JSON.stringify(calls)
    );
    Object.assign(window, { scrollTo: saved.scrollTo, scrollBy: saved.scrollBy });
    if (saved.qs) nodes.app.querySelector = saved.qs;
    else delete nodes.app.querySelector;
    state.sel = 0;
  });
  await it('loading screen: the feeds line is GO only when every source answered live', () => {
    const st = (...oks) => oks.map(ok => ({ label: 'x', role: 'y', ok }));
    assert(ui.feedsLine({ status: st(true, true, true) }, false)[0] === 'go', 'all up');
    const part = ui.feedsLine({ status: st(true, false, true) }, false);
    assert(part[0] === 'hold' && part[2].includes('2 of 3 up'), 'one down: ' + part);
    assert(ui.feedsLine({ status: st(true, true), cached: true }, false)[0] === 'hold', 'saved copy');
    assert(ui.feedsLine({ status: st(false) }, true)[0] === 'nogo', 'sample data');
  });
  await it('keyboard focus comes back to the same control, not its map pin or the first chip', () => {
    const el = (tag, dataset) => ({ tagName: tag, dataset });
    const pin = ui.controlKey(el('G', { act: 'zone', z: 'elliott' }));
    const btn = ui.controlKey(el('BUTTON', { act: 'zone', z: 'elliott' }));
    assert(pin !== btn, 'pin and list button share a key: ' + pin);
    const a = ui.controlKey(el('BUTTON', { act: 'logSp', name: 'Grunter' }));
    const b = ui.controlKey(el('BUTTON', { act: 'logSp', name: 'Flathead' }));
    assert(a !== b, 'species chips share a key: ' + a);
    const odd = ui.controlKey(el('BUTTON', { act: 'delLog', id: 'm1\nx"y' }));
    assert(!/\n/.test(odd) && odd.includes('\\a ') && odd.includes('\\"'), 'unsafe key: ' + odd);
  });
  await it('a forecast with fields missing says so on the forecast screen', () => {
    state.tab = 'plan';
    state.view = 'ocean';
    state.raw.gaps = ['gusts missing'];
    ui.render();
    assert(/Forecast data incomplete[\s\S]*gusts missing/.test(nodes.app.innerHTML), 'no warning');
    state.raw.gaps = [];
    ui.render();
    assert(!/Forecast data incomplete/.test(nodes.app.innerHTML), 'warning with nothing missing');
    delete state.raw.gaps;
  });
  await it('data sources read red when nothing answered', () => {
    const saved = state.raw.status;
    state.raw.status = [
      { label: 'Wind forecast', role: 'primary', ok: false, detail: 'down' },
      { label: 'Swell forecast', role: 'primary', ok: false, detail: 'down' }
    ];
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    const m = nodes.app.innerHTML.match(/<b class="num" style="color:([^"]+)">0 of 2 up/);
    assert(m && m[1] === 'var(--no)', m ? m[1] : 'no summary');
    state.raw.status = saved;
  });
  await it('one date style everywhere: "Tue 13 Oct", never "Tue, 13 Oct"', () => {
    state.freshGo = [{ ds: state.days[1].ds, score: 81, ramp: 'Elliott Heads', from: '06:00', to: '11:00' }];
    state.tab = 'plan';
    state.view = 'ocean';
    ui.render();
    state.freshGo = [];
    const bad = nodes.app.innerHTML.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d/);
    assert(!bad, 'found ' + (bad && bad[0]));
  });
  await it('the sample-data banner says why the live forecast failed', () => {
    state.demo = true;
    state.loadError = 'too many requests — rate limiting';
    state.tab = 'plan';
    ui.render();
    assert(nodes.app.innerHTML.includes('too many requests'));
    state.demo = false;
    state.loadError = null;
  });
  await it('the river view renders every system on every day, with no undefined or NaN', () => {
    state.tab = 'plan';
    state.view = 'river';
    state.days.forEach((d, i) =>
      ZONES.forEach(z => {
        state.sel = i;
        state.zsel = z.id;
        ui.render();
        const html = nodes.app.innerHTML;
        assert(!/undefined|NaN/.test(html), 'day ' + i + ' ' + z.id);
      })
    );
    const html = nodes.app.innerHTML;
    assert(/aria-label="River caution and advisory panel for/.test(html), 'river panel');
    assert((html.match(/class="adv-row"/g) || []).length === 7, 'seven river stations');
    assert(!/Launch control|id="tminus"|chart-map/.test(html), 'ocean-only parts must not show');
    config.ESTUARIES.forEach(e => assert(html.includes(e.name), e.name));
    state.view = 'ocean';
    state.sel = 0;
  });
  await it('the Ocean / Rivers switch swaps the page and is remembered', () => {
    const saved = [];
    globalThis.localStorage = { getItem: () => null, setItem: (k, v) => saved.push([k, v]) };
    ui.ACTIONS.view({ dataset: { view: 'river' } });
    assert(state.view === 'river' && /River caution and advisory panel/.test(nodes.app.innerHTML));
    assert(
      saved.some(([k, v]) => k === 'fishin-view' && v.includes('river')),
      'not saved'
    );
    ui.ACTIONS.view({ dataset: { view: 'ocean' } });
    assert(state.view === 'ocean' && /Launch control/.test(nodes.app.innerHTML));
    assert(/data-act="view" data-view="river"/.test(nodes.app.innerHTML), 'switch present on the ocean page');
  });
  await it('river sessions use the river wording and never need an ocean window', () => {
    const d = state.days[0];
    const z = d.zones[0];
    const ss = advice.sessions(d, z, config.ESTUARIES[2]);
    assert(ss.length > 0 && ss.every(x => x.where === 'Burnett River' && !/Outside is out/.test(x.how)));
  });
  await it('the catch log takes species by tap and keeps them through a rating change', () => {
    state.tab = 'log';
    state.logDraft = null;
    ui.render();
    assert(/data-act="logSp" data-name="Grunter"/.test(nodes.app.innerHTML), 'species chips');
    assert(/data-act="logSp" data-name="Estuary cod"/.test(nodes.app.innerHTML), 'river species chips');
    ui.ACTIONS.logSp({ dataset: { name: 'Grunter' } });
    ui.ACTIONS.logSp({ dataset: { name: 'Flathead' } });
    ui.ACTIONS.logSp({ dataset: { name: 'Grunter' } }); // second tap un-picks
    ui.ACTIONS.rate({ dataset: { rating: 3 } });
    assert(
      state.logDraft.picked.join() === 'Flathead' && state.logDraft.rating === 3,
      JSON.stringify(state.logDraft)
    );
    assert(/data-name="Flathead" class="on"/.test(nodes.app.innerHTML), 'shown as picked');
  });
  await it('saving a session keeps what was caught, the rating and the notes, then clears the form', () => {
    const today = util.isoDay(new Date());
    nodes.ld = { value: today };
    nodes.lr = { value: 'burnett' };
    nodes.lnotes = { value: 'early bite' };
    state.logDraft = {
      date: today,
      ramp: 'burnett',
      picked: ['Snapper', 'Grass sweetlip'],
      rating: 3,
      notes: ''
    };
    const n = state.log.length;
    ui.ACTIONS.addLog();
    const e = state.log[state.log.length - 1];
    assert(state.log.length === n + 1, 'saved');
    assert(e.species === 'Snapper, Grass sweetlip' && e.rating === 3 && !('mark' in e), JSON.stringify(e));
    assert(e.notes === 'early bite' && state.logDraft === null, 'notes kept, form cleared');
    state.log = state.log.slice(0, n);
    ['ld', 'lr', 'lnotes'].forEach(k => delete nodes[k]);
  });
  await it('the map is a group of controls, not an image (an image hides its buttons from screen readers)', async () => {
    const { mapSVG } = await imp('map');
    const svg = mapSVG(state.days[0], 'burnett');
    assert(/^<svg class="chart-map"[^>]*role="group"/.test(svg) && /role="button"/.test(svg));
  });
  await it('a go-day alert can open the app on its day', () => {
    state.tab = 'log';
    const target = state.days[3].ds;
    assert(ui.selectDay(target) === true && state.days[state.sel].ds === target && state.tab === 'plan');
    assert(ui.selectDay('1999-01-01') === false, 'unknown day');
    state.view = 'river';
    ui.selectDay(target, true);
    assert(state.view === 'ocean', 'an alert is about the ocean, so it opens the ocean page');
    state.view = 'river';
    ui.selectDay(target);
    assert(state.view === 'river', 'keeping the day across a refresh leaves the page alone');
    state.view = 'ocean';
    state.sel = 0;
  });
  await it('an offline copy shows a not-live warning', () => {
    state.raw.cached = true;
    state.raw.savedAt = Date.now();
    state.tab = 'plan';
    ui.render();
    assert(nodes.app.innerHTML.includes('Saved forecast'));
    state.raw.cached = false;
  });
});

/* ── Flight log (history.js, tools/history.js and the tab) ─────────────── */

await describe('flight log', async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const history = await imp('history');
  const tool = await import('../tools/history.js');
  const ui = await imp('ui');
  const { state } = store;
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fc-history-'));

  /**
   * A stand-in for Open-Meteo's archive: hourly figures for every sample point
   * between the dates asked for. Day n (from 2020-01-01) cycles through calm
   * and rough, so a run of days has Go and No go days in it. `tweak(H, kind)`
   * edits the hourly block before it is sent.
   */
  function archive(tweak = () => {}) {
    const calls = [];
    const fetcher = async url => {
      calls.push(url);
      const u = new URL(url);
      const a = u.searchParams.get('start_date'),
        b = u.searchParams.get('end_date');
      const times = [];
      for (let t = +util.localDate(a + 'T00:00'); t <= +util.localDate(b + 'T23:00'); t += util.HOUR) {
        const d = new Date(t);
        times.push(util.isoDay(d) + 'T' + util.pad(d.getHours()) + ':00');
      }
      const dayN = k => history.daysBetween('2020-01-01', times[k].slice(0, 10));
      const days = [...new Set(times.map(t => t.slice(0, 10)))];
      const marine = u.hostname.startsWith('marine');
      const json = POINTS.map(() => {
        const H = { time: times };
        if (marine) {
          H.swell_wave_height = times.map((_, k) => [0.4, 0.5, 1.1, 0.6][dayN(k) % 4]);
          H.wave_height = H.swell_wave_height.map(v => v + 0.1);
          H.swell_wave_period = times.map(() => 10);
          H.wave_period = times.map(() => 8);
          H.swell_wave_direction = times.map(() => 110);
          H.wind_wave_height = times.map(() => 0.2);
          H.sea_level_height_msl = times.map((_, k) => Math.sin((k / 12.42) * 2 * Math.PI));
          H.sea_surface_temperature = times.map(() => 24);
          H.ocean_current_velocity = times.map(() => 0.4);
          H.ocean_current_direction = times.map(() => 0);
        } else {
          H.wind_speed_10m = times.map((_, k) => [5, 7, 14, 6][dayN(k) % 4]);
          H.wind_gusts_10m = H.wind_speed_10m.map(w => w * 1.3);
          H.wind_direction_10m = times.map(() => 120);
          H.precipitation = times.map(() => 0);
          H.pressure_msl = times.map(() => 1015);
          H.weather_code = times.map(() => 1);
          H.cape = times.map(() => 0);
        }
        tweak(H, marine ? 'marine' : 'wind');
        return marine
          ? { hourly: H }
          : {
              hourly: H,
              hourly_units: { wind_speed_10m: 'kn', wind_gusts_10m: 'kn' },
              daily: { time: days, sunrise: days.map(d => d + 'T05:30'), sunset: days.map(d => d + 'T17:50') }
            };
      });
      return { ok: true, status: 200, json };
    };
    return { fetcher, calls };
  }

  // one full build, shared by the tab tests below
  const dir = tmp();
  const full = archive();
  const report = await tool.updateHistory({ dir, today: '2026-10-14', fetcher: full.fetcher, pause: 0 });
  const summaryJson = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const summary = history.readSummary(summaryJson);

  await it('the first run fills exactly three years, to yesterday', () => {
    assert(report.stored === 1096 && summaryJson.first === '2023-10-14', JSON.stringify(report));
    assert(summary.days[summary.days.length - 1].ds === '2026-10-13', 'last day is yesterday');
    assert(!report.errors.length && !report.gaps.length, JSON.stringify(report));
  });
  await it('the stored files stay light: about 110 KB of summary, under 60 KB a month of hours', () => {
    const size = fs.statSync(path.join(dir, 'summary.json')).size;
    assert(size < 130e3, 'summary is ' + size + ' bytes');
    const months = fs.readdirSync(path.join(dir, 'hours'));
    assert(months.length === 37, months.length + ' month files');
    months.forEach(f => {
      const s = fs.statSync(path.join(dir, 'hours', f)).size;
      assert(s < 60e3, f + ' is ' + s + ' bytes');
    });
  });
  await it('archive requests ask for the app’s own fields at every sample point, a month at a time', () => {
    const wind = full.calls.find(u => u.includes('historical-forecast-api'));
    const sea = full.calls.find(u => u.includes('marine-api'));
    assert(wind && sea, 'both archives asked');
    const q = new URL(wind).searchParams;
    assert(q.get('hourly') === data.FORECAST_VARS && q.get('wind_speed_unit') === 'kn', 'wind fields');
    assert(q.get('latitude').split(',').length === POINTS.length, 'every sample point');
    assert(new URL(sea).searchParams.get('hourly') === data.MARINE_VARS, 'swell fields');
    // 37 months, two archives each: a month per request keeps each call small
    assert(full.calls.length === 74, full.calls.length + ' requests');
  });
  await it('each stored day is the app’s own verdict on that day', async () => {
    // build the same archive directly and compare a run of days
    const { fetcher } = archive();
    const from = '2026-09-01',
      to = '2026-09-10';
    const [w, m] = await Promise.all([
      fetcher(tool.pastWindUrl(history.addDays(from, -3), history.addDays(to, 1))),
      fetcher(tool.pastSwellUrl(history.addDays(from, -3), history.addDays(to, 1)))
    ]);
    const built = model.build(
      { fc: w.json, mar: m.json },
      { cfg: CFG, log: [], now: util.localDate('2026-10-14') }
    );
    for (let ds = from; ds <= to; ds = history.addDays(ds, 1)) {
      const d = built.past.find(x => x.ds === ds);
      const s = summary.byDs ? summary.byDs.get(ds) : summary.days.find(x => x.ds === ds);
      assert(
        s.overall === d.overall && s.bestId === d.zones[0].z.id,
        ds + ' ' + s.overall + ' vs ' + d.overall
      );
      ZONES.forEach((z, i) => {
        const zone = d.zones.find(x => x.z.id === z.id);
        assert(s.ramps[i].score === zone.score, ds + ' ' + z.id);
        assert(!!s.ramps[i].win === zone.win.length > 0, ds + ' ' + z.id + ' window');
      });
    }
    const goDays = summary.days.filter(d => d.overall >= history.GO_LINE).length;
    assert(goDays > 0 && goDays < summary.days.length, 'the archive has both Go and No go days: ' + goDays);
  });
  await it('the next morning fetches only the last few days, and nothing older than three years is kept', async () => {
    const d2 = tmp();
    fs.cpSync(dir, d2, { recursive: true });
    const next = archive();
    const r = await tool.updateHistory({ dir: d2, today: '2026-11-05', fetcher: next.fetcher, pause: 0 });
    const s = JSON.parse(fs.readFileSync(path.join(d2, 'summary.json'), 'utf8'));
    assert(s.first === '2023-11-05' && r.stored === 1096, JSON.stringify(r));
    assert(next.calls.length === 4, 'October and November only: ' + next.calls.length);
    assert(!fs.existsSync(path.join(d2, 'hours', '2023-10.json')), 'October 2023 hours kept');
    const nov = JSON.parse(fs.readFileSync(path.join(d2, 'hours', '2023-11.json'), 'utf8'));
    assert(!nov.days['2023-11-04'] && nov.days['2023-11-05'], 'the day before the first kept');
    const again = archive();
    await tool.updateHistory({ dir: d2, today: '2026-11-05', fetcher: again.fetcher, pause: 0 });
    assert(again.calls.length === 2, 'a second run the same day re-checks only the recent days');
  });
  await it('a day with holes in the wind is left out, not stored as a no go, and retried for a while', async () => {
    const d3 = tmp();
    // gusts missing through the middle of 5 Oct 2026
    const holey = archive((H, kind) => {
      if (kind !== 'wind') return;
      H.time.forEach((t, k) => {
        if (t.startsWith('2026-10-05T1')) H.wind_gusts_10m[k] = null;
      });
    });
    const r = await tool.updateHistory({
      dir: d3,
      today: '2026-10-14',
      fetcher: holey.fetcher,
      pause: 0,
      maxMonths: 1
    });
    const s = JSON.parse(fs.readFileSync(path.join(d3, 'summary.json'), 'utf8'));
    const i = history.daysBetween(s.first, '2026-10-05');
    assert(s.days[i] === null && s.gaps.includes('2026-10-05'), JSON.stringify(r.gaps));
    assert(r.left === 36, 'the rest of the three years waits for the next run: ' + r.left);
    assert(tool.wanted(s, '2026-10-13').includes('2026-10-05'), 'retried while recent');
    assert(!tool.wanted(s, '2026-11-30').includes('2026-10-05'), 'given up once old');
  });
  await it('a refused or empty archive request stores nothing for that month', async () => {
    const d4 = tmp();
    const down = async () => ({ ok: false, status: 400, error: 'bad request' });
    const r = await tool.updateHistory({
      dir: d4,
      today: '2026-10-14',
      fetcher: down,
      pause: 0,
      maxMonths: 2
    });
    assert(r.stored === 0 && r.errors.length === 2, JSON.stringify(r));
    assert(/could not fetch/i.test(tool.describeReport(r)), 'reported');
  });
  await it('review: a day with holes in the swell is left out, not stored as a calm Go day', async () => {
    const d5 = tmp();
    // a rough sea everywhere, with the swell missing from 5 to 9 Oct 2026
    const holey = archive((H, kind) => {
      if (kind !== 'marine') return;
      H.time.forEach((t, k) => {
        const ds = t.slice(0, 10);
        const gone = ds >= '2026-10-05' && ds <= '2026-10-09';
        H.swell_wave_height[k] = gone ? null : 2.5;
        H.wave_height[k] = gone ? null : 2.6;
      });
    });
    const r = await tool.updateHistory({
      dir: d5,
      today: '2026-10-14',
      fetcher: holey.fetcher,
      pause: 0,
      maxMonths: 1
    });
    const s = JSON.parse(fs.readFileSync(path.join(d5, 'summary.json'), 'utf8'));
    for (let ds = '2026-10-05'; ds <= '2026-10-09'; ds = history.addDays(ds, 1)) {
      assert(s.days[history.daysBetween(s.first, ds)] === null, ds + ' stored');
      assert(r.gaps.includes(ds), ds + ' not reported');
    }
    assert(s.days[history.daysBetween(s.first, '2026-10-10')], 'a whole day either side is kept');
  });
  await it('a connection that drops is tried again within seconds, not after a minute', async () => {
    const ok = archive();
    const seen = new Set();
    // the first try at each address never connects, as on GitHub's runners after a pause
    const flaky = async url => {
      if (!seen.has(url)) {
        seen.add(url);
        return { ok: false, status: 0, error: 'no connection (fetch failed)' };
      }
      return ok.fetcher(url);
    };
    const t0 = Date.now();
    const got = await tool.fetchDays(['2026-09-01', '2026-09-02'], { fetcher: flaky, wait: 1e9, quick: 5 });
    assert(!got.error && got.rows.size === 2, JSON.stringify(got.error));
    assert(Date.now() - t0 < 5000, 'waited ' + (Date.now() - t0) + ' ms');
  });
  await it('review: when Open-Meteo is limiting requests the run stops, keeps what it has and says so', async () => {
    const d6 = tmp();
    const ok = archive();
    let n = 0;
    const busy = async url => (++n > 2 ? { ok: false, status: 429, error: 'busy' } : ok.fetcher(url));
    const r = await tool.updateHistory({ dir: d6, today: '2026-10-14', fetcher: busy, pause: 0, wait: 0 });
    assert(r.months === 1 && n === 6, 'carried on after a 429: ' + n + ' requests'); // two, then four tries
    assert(r.left === 36 && /limiting requests/.test(tool.describeReport(r)), JSON.stringify(r));
    assert(r.save && fs.existsSync(path.join(d6, 'summary.json')), 'the first month was not kept');
    const slow = await tool.updateHistory({
      dir: tmp(),
      today: '2026-10-14',
      fetcher: ok.fetcher,
      pause: 0,
      budget: -1
    });
    assert(
      slow.months === 0 && slow.left === 37 && /out of time/.test(slow.errors.join()),
      JSON.stringify(slow)
    );
  });
  await it('review: a month the model cannot work out is reported, and the run goes on to the next', async () => {
    const odd = archive((H, kind) => {
      if (kind === 'wind' && H.time[0].startsWith('2026-08-2')) H.time = 5; // September's fetch is damaged
    });
    const r = await tool.updateHistory({
      dir: tmp(),
      today: '2026-10-14',
      fetcher: odd.fetcher,
      pause: 0,
      maxMonths: 2
    });
    assert(
      r.months === 1 && /2026-09 .*could not be worked out/.test(r.errors.join()),
      JSON.stringify(r.errors)
    );
  });
  await it('review: a run never saves over far more days than it ends with, and a stale one shows red', () => {
    const v = (o, y = '2026-10-13') => tool.verdict({ before: 0, last: '2026-10-13', ...o }, y);
    assert(!v({ stored: 0 }).save && v({ stored: 0 }).fail, 'nothing stored');
    const shrunk = v({ stored: 31, before: 1096 });
    assert(!shrunk.save && shrunk.fail, 'a rebuild over three good years');
    const stale = v({ stored: 1096, before: 1096, last: '2026-10-01' });
    assert(stale.save && stale.fail, 'fell behind but kept its work');
    const fine = v({ stored: 1096, before: 1096 });
    assert(fine.save && !fine.fail, 'a normal morning');
  });
  await it('a damaged or newer-format summary is not misread', () => {
    assert(history.readSummary({ v: 2, first: '2026-01-01', days: [] }) === null, 'newer format');
    assert(history.readSummary(null) === null && history.readSummary({ v: 1 }) === null, 'empty');
    const width = history.DAY_COLS.length + history.RAMP_COLS.length * ZONES.length;
    const row = summaryJson.days[0];
    const s = history.readSummary({ v: 1, first: '2026-01-01', days: [row, row.slice(1), null, row] });
    assert(s.days.length === 2 && s.days[1].ds === '2026-01-04', 'short and empty rows are skipped');
    assert(row.length === width, 'row width');
  });
  await it('values from the network are coerced: markup in a stored file never reaches the page', () => {
    const row = summaryJson.days[0].slice();
    row[0] = '<img src=x onerror=alert(1)>';
    assert(
      history.readSummary({ v: 1, first: '2026-01-01', days: [row] }).days.length === 0,
      'damaged row kept'
    );
    const good = summaryJson.days[0].slice();
    good[5] = '<b>'; // tide range: optional, so it reads as missing
    assert(history.readSummary({ v: 1, first: '2026-01-01', days: [good] }).days[0].range === null);
    const month = {
      days: {
        '2026-01-01': {
          sr: '<script>',
          ss: '18:01',
          tides: [
            ['<i>', 100, 1],
            ['03:10', 'x', 0],
            ['09:40', 120, 1]
          ],
          z: [[['<b>'], [], [], [], [['<x>', 9]]]]
        }
      }
    };
    const t = history.dayTides(month, '2026-01-01');
    assert(
      t.sr === null && t.ss === '18:01' && t.tides.length === 1 && t.tides[0].t === '09:40',
      JSON.stringify(t)
    );
    assert(history.rampHours(month, '2026-01-01', 0) === null, 'hours with no figures');
  });
  await it('three years is the most kept: a merge drops the oldest days', () => {
    const row = summaryJson.days[0];
    const rows = new Map();
    for (let ds = '2022-01-01'; ds <= '2026-01-01'; ds = history.addDays(ds, 1)) rows.set(ds, row);
    const m = history.mergeSummary(null, rows, 'now');
    assert(m.first === '2023-01-02' && m.days.length === 1096, m.first + ' ' + m.days.length);
    assert(history.firstKept('2024-03-01') === '2021-03-02', 'leap years');
  });
  await it('week, month and year sums count Go, in-between and no-go days by the forecast’s lines', () => {
    const mk = (score, win) => ({
      overall: score,
      bestId: 'burnett',
      ramps: ZONES.map(z => ({ id: z.id, score: z.id === 'elliott' ? 90 : score, win }))
    });
    const t = history.tally([mk(80, 3), mk(60, 0), mk(30, 0), mk(75, 2.5)]);
    assert(t.go === 2 && t.amber === 1 && t.red === 1 && t.windows === 2 && t.avg === 61, JSON.stringify(t));
    const e = history.tally([mk(80, 3), mk(30, 0)], 'elliott');
    assert(e.go === 2 && e.avg === 90, 'one ramp is judged on its own score');
    assert(history.weekStart('2026-10-14') === '2026-10-12', 'weeks start on Monday');
  });
  await it('the arrows step a day, a week, a month or a year, and never past the stored days', () => {
    const [a, b] = ['2023-10-14', '2026-10-13'];
    assert(ui.histStep('day', '2026-10-13', 1, a, b) === b, 'not past yesterday');
    assert(ui.histStep('week', '2026-10-01', -1, a, b) === '2026-09-24');
    assert(ui.histStep('month', '2026-03-31', -1, a, b) === '2026-02-01', 'a month from the 31st');
    assert(ui.histStep('month', '2023-11-05', -1, a, b) === a, 'held at the first day');
    assert(ui.histStep('year', '2024-02-29', 1, a, b) === '2025-02-28');
    assert(ui.histPeriod('week', '2026-10-14').title === '12–18 Oct 2026');
  });

  /* the tab itself, with the files served by a stand-in fetch */
  const nodes = {};
  globalThis.document = { getElementById: id => (nodes[id] = nodes[id] || { innerHTML: '', value: '' }) };
  const realFetch = globalThis.fetch;
  const served = [];
  const serve = (fail = false) =>
    (globalThis.fetch = async url => {
      served.push(url);
      const rel = url.slice(history.HISTORY_BASE.length);
      const f = path.join(dir, rel);
      if (fail || !url.startsWith(history.HISTORY_BASE) || !fs.existsSync(f))
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
      const body = JSON.parse(fs.readFileSync(f, 'utf8'));
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    });
  const settle = () => new Promise(r => setTimeout(r, 20));
  const clean = html => {
    const bad = html.match(/undefined|NaN|null/);
    assert(
      !bad,
      'found ' + bad + ' near: ' + html.slice(Math.max(0, html.indexOf(bad) - 80), html.indexOf(bad) + 40)
    );
  };

  await it('the Flight log loads nothing until its tab is opened', async () => {
    serve();
    state.tab = 'plan';
    ui.render();
    await settle();
    assert(!served.length && state.hist.status === 'idle', 'fetched ' + served.join());
  });
  await it('opening the Flight log fetches the summary once and shows the month to yesterday', async () => {
    ui.ACTIONS.tab({ dataset: { tab: 'history' } });
    assert(/Loading three years/.test(nodes.app.innerHTML), 'loading message');
    await settle();
    assert(
      state.hist.status === 'ready' && state.hist.ds === '2026-10-13',
      state.hist.status + ' ' + state.hist.ds
    );
    assert(served.length === 1 && served[0] === history.summaryUrl(), served.join());
    const html = nodes.app.innerHTML;
    assert(/October 2026/.test(html) && /class="cal-g"/.test(html), 'month calendar');
    assert(/class="panel hsum"/.test(html) && /class="split"/.test(html), 'month colour and split');
    ui.render();
    await settle();
    assert(served.length === 1, 'fetched again on a repaint');
  });
  await it('every view renders for the best ramp and for each ramp, with no undefined, NaN or null', async () => {
    for (const ramp of ['', ...ZONES.map(z => z.id)]) {
      ui.ACTIONS.histRamp({ dataset: { z: ramp } });
      for (const view of ['week', 'month', 'year', 'day']) {
        ui.ACTIONS.histView({ dataset: { view } });
        await settle(); // the Day view fetches its month's hours
        ui.render();
        clean(nodes.app.innerHTML);
      }
    }
    assert(
      /<svg viewBox="0 0 420 170" role="img" aria-label="Swell, wind and gusts through the day">/.test(
        nodes.app.innerHTML
      ),
      'hourly chart'
    );
    ui.ACTIONS.histRamp({ dataset: { z: '' } });
  });
  await it('the Day view draws the archived hours with the forecast’s own chart', async () => {
    ui.ACTIONS.histDay({ dataset: { id: '2026-09-02' } });
    await settle();
    const html = nodes.app.innerHTML;
    assert(served.includes(history.hoursUrl('2026-09')), 'month of hours fetched');
    assert(/Looking back/.test(html) && /SWELL LIMIT 0.7 M/.test(html), 'hero and chart');
    assert(
      /data-act="histPick"/.test(html) && (html.match(/data-act="histRamp"/g) || []).length === ZONES.length,
      'ramp picker and site list'
    );
  });
  await it('the ramp picker opens in place to list the other ramps, and closes once one is picked', () => {
    const tap = (act, z, inPicker = true) => {
      const el = { dataset: { act, ...(z != null ? { z, i: 'pick' } : {}) } };
      el.closest = sel => (sel === '[data-act]' || inPicker ? el : null);
      ui.onAppClick({ target: el });
    };
    ui.render();
    let html = nodes.app.innerHTML;
    assert(
      !/<select/.test(html) && /aria-expanded="false"/.test(html) && !/class="hpick-list"/.test(html),
      'closed to start'
    );
    tap('histPick');
    html = nodes.app.innerHTML;
    assert(state.hist.pickOpen && /aria-expanded="true"/.test(html), 'did not open');
    const list = html.match(/<div class="hpick-list"[\s\S]*?<\/div>/)[0];
    assert((list.match(/<button/g) || []).length === ZONES.length, 'the other ramps: ' + list);
    assert(
      !/Best ramp each day/.test(list) && ZONES.every(z => list.includes(z.name)),
      'every ramp offered, not the one shown'
    );
    tap('histRamp', 'woodgate');
    html = nodes.app.innerHTML;
    assert(state.hist.ramp === 'woodgate' && !state.hist.pickOpen, 'picked and closed');
    assert(
      /class="hpick-v">Walkers Point \/ Woodgate</.test(html) && !/class="hpick-list"/.test(html),
      'box names the ramp'
    );
    tap('histPick');
    assert(
      !/data-z="woodgate" data-i="pick"/.test(nodes.app.innerHTML),
      'the ramp shown is not offered again'
    );
    // a tap anywhere else closes it without changing the ramp
    const outside = { dataset: {} };
    outside.closest = () => null;
    ui.onAppClick({ target: outside });
    assert(!state.hist.pickOpen && state.hist.ramp === 'woodgate', 'tap outside');
    tap('histPick');
    tap('histRamp', '');
    assert(
      state.hist.ramp === '' && /class="hpick-v">Best ramp each day</.test(nodes.app.innerHTML),
      'back to best'
    );
    const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    assert(!/onAppChange|'change'/.test(app), 'the old drop-down wiring is still there');
  });
  await it('critique: amber is called Hold throughout the Flight log, as on the caution panel', () => {
    for (const view of ['week', 'month', 'year']) {
      ui.ACTIONS.histView({ dataset: { view } });
      const html = nodes.app.innerHTML;
      assert(!/in between/i.test(html), view + ' still says in between');
      assert(/\d+ hold</.test(html), view + ' has no hold count');
    }
  });
  await it('critique: the chart of days names its limit lines, and the year names months in three letters', () => {
    ui.ACTIONS.histView({ dataset: { view: 'month' } });
    const m = nodes.app.innerHTML;
    assert(
      />0\.7<\/text>/.test(m) && />10<\/text>/.test(m) && /Limits \(0\.7 m, 10 kn\)/.test(m),
      'limit lines'
    );
    ui.ACTIONS.histView({ dataset: { view: 'year' } });
    const html = nodes.app.innerHTML;
    const names = [...html.matchAll(/class="ytile[^"]*"[^>]*>\s*<span class="caps">(\w+)</g)].map(m => m[1]);
    assert(names.join() === 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec', names.join());
    assert((html.match(/class="ystack"/g) || []).length === 12, 'a stacked bar per month');
  });
  await it('the year view shows a coloured tile for every month and opens a month on tap', () => {
    ui.ACTIONS.histView({ dataset: { view: 'year' } });
    const html = nodes.app.innerHTML;
    // 2026 is stored to 13 October: ten months to tap, November and December greyed
    assert((html.match(/class="ytile"/g) || []).length === 10, 'ten months in 2026');
    assert((html.match(/class="ytile none"/g) || []).length === 2, 'two months to come');
    ui.ACTIONS.histMonth({ dataset: { id: '2026-02' } });
    assert(
      state.hist.view === 'month' &&
        state.hist.ds === '2026-02-01' &&
        /February 2026/.test(nodes.app.innerHTML)
    );
  });
  await it('a logged session shows a fish on its day, and its notes are escaped', () => {
    const n = state.log.length;
    state.log = state.log.concat([
      store.cleanLogEntry(
        { id: 'h1', date: '2026-02-07', ramp: 'burnett', rating: 3, notes: '<img src=x onerror=alert(1)>' },
        0
      )
    ]);
    ui.render();
    const cell = nodes.app.innerHTML.match(
      /<button class="cal-c"[^>]*data-id="2026-02-07"[\s\S]*?<\/button>/
    );
    assert(cell && /session logged/.test(cell[0]) && /class="logged"/.test(cell[0]), cell && cell[0]);
    ui.ACTIONS.histDay({ dataset: { id: '2026-02-07' } });
    const html = nodes.app.innerHTML;
    assert(
      /Your sessions this day/.test(html) && !html.includes('<img') && html.includes('&lt;img'),
      'escaped'
    );
    assert(!/data-act="delLog"/.test(html), 'no delete button in the Flight log');
    state.log = state.log.slice(0, n);
  });
  await it('a day stored without its hours says so, rather than loading for ever', async () => {
    const ym = '2026-08';
    state.hist.months[ym] = { v: 1, days: {} };
    ui.ACTIONS.histDay({ dataset: { id: ym + '-04' } });
    assert(/No hours are stored for this day/.test(nodes.app.innerHTML), 'stuck on loading');
    delete state.hist.months[ym];
  });
  await it('an app left open fetches the new days when the Flight log is next opened', async () => {
    const summaries = () => served.filter(u => u === history.summaryUrl()).length;
    const before = summaries();
    ui.ACTIONS.tab({ dataset: { tab: 'plan' } });
    ui.ACTIONS.tab({ dataset: { tab: 'history' } });
    await settle();
    assert(summaries() === before, 'refetched while fresh');
    state.hist.at = Date.now() - 7 * util.HOUR;
    ui.ACTIONS.tab({ dataset: { tab: 'history' } });
    await settle();
    assert(summaries() === before + 1 && state.hist.status === 'ready', 'not refreshed');
    serve(true);
    state.hist.at = 0;
    ui.ACTIONS.tab({ dataset: { tab: 'history' } });
    await settle();
    assert(state.hist.status === 'ready' && state.hist.data, 'a failed top-up keeps what was showing');
    serve();
  });
  await it('review: a top-up that adds days drops the hours already loaded for those months', async () => {
    const old = { v: 1, days: {} };
    Object.assign(state.hist, { last: '2026-10-11', at: 0, months: { '2026-10': old, '2026-08': old } });
    ui.ACTIONS.tab({ dataset: { tab: 'history' } });
    await settle();
    assert(state.hist.last === '2026-10-13', state.hist.last);
    assert(state.hist.months['2026-10'] !== old, 'October still shows the hours from before the new days');
    assert(state.hist.months['2026-08'] === old, 'August need not be fetched again');
  });
  await it('without a connection or a saved copy, the Flight log says so and can try again', async () => {
    Object.assign(state.hist, { status: 'idle', data: null, months: {} });
    serve(true);
    ui.render();
    await settle();
    assert(
      state.hist.status === 'error' && /Flight log could not load/.test(nodes.app.innerHTML),
      state.hist.status
    );
    serve();
    ui.ACTIONS.histRetry();
    await settle();
    assert(state.hist.status === 'ready', 'retry');
    state.tab = 'plan';
  });
  globalThis.fetch = realFetch;

  await it('the old My marks list is deleted from the phone when the app loads', () => {
    const removed = [];
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem: k => removed.push(k) };
    store.loadStored();
    assert(removed.includes('fishin-marks') && removed.includes('bundy-marks'), removed.join());
    assert(!('marks' in state) && !('markInfo' in state), 'marks state gone');
  });
  await it('My marks is gone from the code: no importer, no mark list, no sounder import', () => {
    assert(!fs.existsSync(new URL('../importer.js', import.meta.url)), 'importer.js');
    for (const f of [
      'index.html',
      'sw.js',
      'ui.js',
      'store.js',
      'config.js',
      'map.js',
      'advice.js',
      'app.js'
    ])
      assert(
        !/importer|DEFAULT_MARKS|MARK_TYPES|MARK_PREF|state\.marks|importMarks|My marks/.test(
          fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')
        ),
        f
      );
  });
  await it('the daily job writes only to the history-data branch, never to the live site', () => {
    const wf = fs.readFileSync(new URL('../.github/workflows/history.yml', import.meta.url), 'utf8');
    assert(/BRANCH: history-data/.test(wf) && /"HEAD:\$BRANCH"/.test(wf), 'pushes to history-data');
    assert(!/HEAD:main|refs\/heads\/main/.test(wf), 'never main');
    assert(/cron: '37 20 \* \* \*'/.test(wf) && /TZ: Australia\/Brisbane/.test(wf), 'daily, Queensland time');
    assert(history.HISTORY_BASE.endsWith('/' + history.HISTORY_BRANCH + '/'), 'the app reads that branch');
    assert(!/\bpush:/.test(wf), 'runs on a push');
    assert(/elif \[ "\$found" -ne 2 \]/.test(wf), 'a failed look for the branch would start afresh');
    assert(/if: steps\.update\.outputs\.save == 'true'/.test(wf), 'saves whatever the run ends with');
    assert(/if: steps\.update\.outputs\.fail == 'true'/.test(wf), 'a run that fell behind shows green');
  });
  await it('the service worker keeps a saved copy of the Flight log files for offline', () => {
    const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    assert(
      /url\.href\.startsWith\(HISTORY_BASE\)\)\s*return e\.respondWith\(forecast\(e\)\)/.test(sw),
      sw.slice(0, 0)
    );
  });
});

/* ── shell ──────────────────────────────────────────────────────────────── */

await describe('shell', async () => {
  const fs = await import('fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  await it('app version and service worker version match', () => {
    const v = sw.match(/VERSION = 'v([^']+)'/)[1];
    assert(v === config.APP_VERSION, 'sw ' + v + ' vs app ' + config.APP_VERSION);
  });
  await it('index.html has a content security policy', () =>
    assert(html.includes('Content-Security-Policy')));
  await it('index.html has no inline scripts or inline handlers', () => {
    assert(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'inline <script>');
    assert(!/\son[a-z]+="/i.test(html), 'inline handler');
  });
  await it('service worker caches every file the app loads', () => {
    const listed = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(Boolean);
    const onDisk = fs
      .readdirSync(new URL('../', import.meta.url))
      .filter(f => f.endsWith('.js') && f !== 'sw.js');
    onDisk.forEach(f => assert(listed.includes(f), f + ' missing from sw.js'));
    listed.forEach(f =>
      assert(fs.existsSync(new URL('../' + f, import.meta.url)), f + ' listed but missing')
    );
  });
  await it('the site needs no folders (web upload cannot send them)', () => {
    const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)]
      .map(m => m[1])
      .concat([...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(Boolean));
    refs.forEach(r => assert(!r.includes('/'), r + ' is inside a folder'));
  });
  await it('logo has a fixed size so it cannot blow up without the stylesheet', () =>
    assert(/<img class="logo" src="logo-128\.webp" width="38" height="38"/.test(html)));
  await it('loading screen: the real logo, help for a broken upload, and out of the way without JavaScript', () => {
    assert(/<img class="splash-logo" src="logo-448\.webp" width="148" height="148"/.test(html), 'logo');
    const b = fs.readFileSync(new URL('../logo-448.webp', import.meta.url));
    const w = b.toString('ascii', 12, 16) === 'VP8X' ? b.readUIntLE(24, 3) + 1 : b.readUInt16LE(26) & 0x3fff;
    assert(w >= 3 * 148, 'splash logo is ' + w + ' px, blurry on a phone');
    const help = html.indexOf('class="boot-help"');
    assert(help > html.indexOf('id="splash"') && help < html.indexOf('class="wrap"'), 'help hidden under it');
    assert(/<noscript>[\s\S]*\.splash\s*\{\s*display:\s*none/.test(html), 'covers the no-JavaScript note');
    const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    assert(/function fail\(err\) \{[^}]*hideSplash\(\)/.test(app), 'stays up over an error');
    assert(/getData\(splashProgress\)/.test(app), 'bar not wired to the requests');
  });
  await it('every class the app shell writes has a style (the ?check page lost its panel once)', () => {
    const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const used = new Set(
      [...app.matchAll(/class="([^"$]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => c.length > 1)
    );
    used.forEach(c => assert(new RegExp(`\\.${c}\\b`).test(css), '.' + c + ' has no style'));
  });
  await it('an error during start-up never leaves the loading screen up', () => {
    const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    assert(
      /addEventListener\('unhandledrejection', e => \{[^}]*if \(!state\.days\.length\) fail\(/.test(app),
      'an unhandled rejection before the first forecast only logs'
    );
  });
  await it('the loading checklist is not read out line by line', () =>
    assert(
      /class="splash-checks" aria-live="off"/.test(html) && /id="splashPct" aria-live="off"/.test(html)
    ));
  await it('every line of the loading systems check is driven by something the app really does', () => {
    const rows = [...html.matchAll(/class="sc-row" id="(\w+)"/g)].map(m => m[1]);
    const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    assert(rows.length === 4, rows.length + ' rows');
    rows.forEach(id => assert(new RegExp(`check\\(\\s*'${id}'`).test(app), id + ' is never updated'));
  });

  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const listed = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(Boolean);
  const exists = f => fs.existsSync(new URL('../' + f, import.meta.url));
  await it('every file the page and stylesheet refer to exists, and works offline', () => {
    const refs = [
      ...[...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]),
      ...[...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1])
    ];
    assert(refs.length > 15, 'found ' + refs.length);
    refs.forEach(f => {
      assert(exists(f), f + ' is missing');
      assert(listed.includes(f), f + ' is not stored for offline use');
    });
  });
  await it('no outlined text anywhere: nothing else in the app has it', () =>
    assert(!/paint-order|text-stroke/.test(css), 'outlined text in styles.css'));
  await it('every module is preloaded, so the browser fetches them in parallel', () => {
    const pre = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]);
    const mods = fs
      .readdirSync(new URL('../', import.meta.url))
      .filter(f => f.endsWith('.js') && f !== 'sw.js' && f !== 'app.js');
    mods.forEach(f => assert(pre.includes(f), f + ' not preloaded'));
  });
  await it('fonts are served by the site itself, not a third party', () => {
    assert(!/googleapis|gstatic/.test(html + css), 'still loads Google Fonts');
    const fonts = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map(m => m[1]);
    assert(fonts.length === 2, 'expected two font files');
    fonts.forEach(f => {
      const b = fs.readFileSync(new URL('../' + f, import.meta.url));
      assert(b.toString('latin1', 0, 4) === 'wOF2', f + ' is not woff2');
    });
    assert(exists('fonts-OFL.txt'), 'font licence must travel with the fonts');
  });
  await it('the only outside connections the page may make are the forecast and the Flight log files', async () => {
    const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)[1];
    const hosts = [...csp.matchAll(/https:\/\/[^\s;]+/g)].map(m => m[0]);
    const { HISTORY_BASE } = await imp('history');
    // the Flight log is allowed its own branch's folder, not all of GitHub's raw files
    assert(
      hosts.length &&
        hosts.every(h => /^https:\/\/[a-z-]*api\.open-meteo\.com$/.test(h) || h === HISTORY_BASE),
      hosts.join(' ')
    );
    assert(hosts.includes(HISTORY_BASE), 'the Flight log files are blocked');
  });
  await it('the service worker installs fresh files and keeps the saved forecast across updates', () => {
    assert(
      /new Request\(u, \{ cache: 'reload' \}\)/.test(sw),
      'install may store stale files from the HTTP cache'
    );
    assert(/const DATA = 'fishin-data';/.test(sw), 'saved forecast is wiped by every update');
    assert(/e\.waitUntil\(caches\.open\(DATA\)/.test(sw), 'forecast save can be cut short');
  });
  await it('manifest icons exist at the sizes they claim', () => {
    const man = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    man.icons.forEach(ic => {
      const b = fs.readFileSync(new URL('../' + ic.src, import.meta.url));
      const w = b.readUInt32BE(16),
        h = b.readUInt32BE(20);
      assert(ic.sizes === w + 'x' + h, ic.src + ' is ' + w + 'x' + h + ', manifest says ' + ic.sizes);
    });
    assert(man.id === man.start_url, 'id must stay what Chrome already gave the installed app');
  });
  await it('package version matches the app version', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert(pkg.version.startsWith(config.APP_VERSION), pkg.version + ' vs ' + config.APP_VERSION);
  });
});

/* ── report ─────────────────────────────────────────────────────────────── */

let last = '';
for (const r of results) {
  if (r.group !== last) {
    console.log('\n' + r.group);
    last = r.group;
  }
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '\n      ' + r.err}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
