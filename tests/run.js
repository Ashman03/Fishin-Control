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
    const h = { swellEff: 0.3, wind: 13, gust: 13, wdir: 270 };
    assert(model.hourScore(h, offshoreZ, CFG).ok === false);
  });
  await it('passes() is inclusive at the limit and strict beyond it', () => {
    assert(
      model.passes(0.7, 10, 12, CFG) && !model.passes(0.71, 10, 12, CFG) && !model.passes(0.7, 10.1, 12, CFG)
    );
  });
  await it('short-period swell counts as bigger', () =>
    assert(model.periodFactor(5) > 1.2 && model.periodFactor(11) < 1));

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
    const h = { swellEff: 0.4, wind: 10, gust: 12, wdir: 0, against: 0, storm: 0 };
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
  await it('marksFor favours closer ground when it is lumpy', () => {
    const m = advice.marksFor(
      [
        { ramp: 'burnett', name: 'far', km: 18, type: 'reef' },
        { ramp: 'burnett', name: 'near', km: 6, type: 'rubble' }
      ],
      'burnett',
      'low',
      0.9
    );
    assert(m[0].name === 'near');
  });
  await it('sessions never overlap', () => {
    const b = model.build(calm(), { cfg: CFG });
    const ss = advice.sessions(b.days[0], b.days[0].zones[0], []);
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
  const day = (ds, overall) => ({
    ds,
    overall,
    past: false,
    zones: [{ z: { name: 'Elliott Heads' }, win: [] }]
  });
  await it('a go day for alerts is one the app calls Go: 75 or more, not 70', () =>
    assert(
      al
        .goDays([day('a', 70), day('b', 74), day('c', 75), day('d', 88)])
        .map(d => d.ds)
        .join() === 'c,d'
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

/* ── importer ───────────────────────────────────────────────────────────── */

await describe('importer', async () => {
  const imp_ = await imp('importer');
  // Humminbird's encoding, as GPSBabel writes it, to build test files
  const EQ = 6378388.0,
    COS2 = 0.9966349016452 ** 2;
  const enc = (lat, lon) => {
    const gc = Math.atan(COS2 * Math.tan((lat * Math.PI) / 180));
    return {
      east: Math.round((lon / 180) * 20038297.0),
      north: Math.round(Math.log(Math.tan(Math.PI / 4 + gc / 2)) * EQ)
    };
  };
  function hwr(points, { route = false, status = 1 } = {}) {
    const recs = points.length * 36 + (route ? 136 : 0) + 64; // trailing zero padding, as on the card
    const v = new DataView(new ArrayBuffer(recs));
    let o = 0;
    points.forEach(([name, lat, lon, depthCm], i) => {
      v.setUint32(o, 0x02030024);
      const { east, north } = enc(lat, lon);
      v.setUint16(o + 4, i);
      v.setUint8(o + 8, status);
      v.setUint16(o + 10, depthCm || 0);
      v.setInt32(o + 16, east);
      v.setInt32(o + 20, north);
      [...name].slice(0, 12).forEach((c, k) => v.setUint8(o + 24 + k, c.charCodeAt(0)));
      o += 36;
      if (route && i === 0) {
        v.setUint32(o, 0x03030088);
        o += 136;
      }
    });
    return v.buffer;
  }
  const MARKS = [
    ['Four Mile', -24.718, 152.505, 1500],
    ['Barge wreck', -24.93, 152.56, 1200],
    ['Lake Monduran', -24.87, 151.85, 0] // inland, 30 km away: left out
  ];

  await it('reads a Humminbird DATA.HWR: names, positions to a metre, depth', () => {
    const w = imp_.parseHWR(hwr(MARKS, { route: true }));
    assert(w.length === 3, 'got ' + w.length);
    near(w[0].lat, -24.718, 1e-5, 'lat');
    near(w[0].lon, 152.505, 1e-5, 'lon');
    assert(w[0].name === 'Four Mile' && w[0].depth === 15, JSON.stringify(w[0]));
    assert(w[1].name === 'Barge wreck', 'name');
  });
  await it('skips unused waypoint slots and refuses a file that is not one', () => {
    assert(imp_.parseHWR(hwr(MARKS, { status: 0 })).length === 0, 'status 0 slots are empty');
    let threw = false;
    try {
      imp_.parseHWR(new TextEncoder().encode('<gpx></gpx>').buffer);
    } catch (e) {
      threw = /not a Humminbird/.test(e.message);
    }
    assert(threw);
  });
  await it('reads GPX waypoints, including escaped names and depth', () => {
    const gpx = `<?xml version="1.0"?><gpx><wpt lat="-24.80" lon="152.47"><name><![CDATA[Bargara bommie]]></name>
      <extensions><h:depth>9.5</h:depth></extensions></wpt><wpt lon='152.5' lat='-24.9'><name>Pete &amp; Al's</name></wpt></gpx>`;
    const w = imp_.parseGPX(gpx);
    assert(
      w.length === 2 && w[0].name === 'Bargara bommie' && w[0].depth === 9.5 && w[1].name === "Pete & Al's",
      JSON.stringify(w)
    );
  });
  await it('each mark goes to its nearest ramp, with its real distance; far-off and repeat marks are left out', () => {
    const pts = imp_.parseHWR(hwr(MARKS));
    const { marks, outside } = imp_.toMarks(pts, []);
    assert(outside === 1 && marks.length === 2, JSON.stringify({ outside, n: marks.length }));
    const [a, b] = marks;
    assert(a.ramp === 'burnett' && b.ramp === 'elliott', a.ramp + ' ' + b.ramp);
    near(a.km, imp_.kmBetween(-24.76, 152.41, -24.718, 152.505), 0.1, 'distance');
    assert(b.type === 'wreck' && a.type === 'reef', 'types');
    assert(imp_.toMarks(pts, marks).repeats === 2, 'importing twice adds nothing');
  });
  await it('the nearest mark is found within 2 km, and only marks with a position count', () => {
    const marks = [
      { name: 'A', lat: -24.7, lon: 152.5 },
      { name: 'B', lat: -24.71, lon: 152.5 },
      { name: 'Hand', km: 3 }
    ];
    assert(imp_.nearestMark(-24.709, 152.5, marks).name === 'B');
    assert(imp_.nearestMark(-24.9, 152.9, marks) === null, 'nothing within 2 km');
  });
  await it('a blank or damaged position is dropped, never read as 0°, 0°', () => {
    const m = store.cleanMark({ id: 'x', name: 'n', ramp: 'burnett', km: 3, lat: '', lon: '' }, 0);
    assert(!('lat' in m) && !('lon' in m), JSON.stringify(m));
    const half = store.cleanMark({ id: 'x', name: 'n', ramp: 'burnett', km: 3, lat: -24.7, lon: 'x' }, 0);
    assert(!('lat' in half), 'half a position is no position');
  });
  await it('imported marks keep their position through storage', () => {
    const { marks } = imp_.toMarks(imp_.parseHWR(hwr(MARKS)), []);
    const back = store.cleanMark(JSON.parse(JSON.stringify(marks[0])), 0);
    assert(back.lat === marks[0].lat && back.lon === marks[0].lon && back.imported, JSON.stringify(back));
    const hand = store.cleanMark({ id: 'x', name: 'n', ramp: 'burnett', km: 3 }, 0);
    assert(!('lat' in hand), 'a hand-entered mark has no position');
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
  await it('stored marks and log entries come back as clean values, never markup', () => {
    const mem = {
      'fishin-marks': JSON.stringify({
        v: 1,
        data: [
          { id: 'a', name: 'Lump', ramp: 'burnett', km: '<img src=x onerror=alert(1)>', depth: 9, type: 'x' }
        ]
      }),
      'fishin-log': JSON.stringify({
        v: 1,
        data: [
          { id: 'b', date: '2026-09-01', ramp: 'burnett', rating: 99, wind: 'lots' },
          { id: 'c', date: '<script>', ramp: 'burnett', rating: 1 }
        ]
      })
    };
    globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem() {} };
    store.loadStored();
    const [m] = store.state.marks;
    assert(m.km === 0 && m.depth === 9 && m.type === 'reef', JSON.stringify(m));
    assert(store.state.log.length === 1, 'entry with a bad date kept');
    const [e] = store.state.log;
    assert(e.rating === 3 && e.wind === null, JSON.stringify(e));
  });
  await it('discards corrupt stored data instead of crashing', () => {
    globalThis.localStorage = { getItem: () => '{not json', setItem() {} };
    const warn = console.warn;
    console.warn = () => {};
    store.loadStored();
    console.warn = warn;
    assert(Array.isArray(store.state.log) && store.state.marks.length > 0);
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

  for (const tab of ['plan', 'marks', 'log']) {
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
  await it('a hostile mark name is escaped everywhere it appears', () => {
    state.marks = [
      { id: 'x"y', name: '<img src=x onerror=alert(1)>"', ramp: 'burnett', km: 5, depth: 9, type: 'reef' }
    ];
    state.tab = 'marks';
    ui.render();
    assert(!nodes.app.innerHTML.includes('<img') && nodes.app.innerHTML.includes('&lt;img'));
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
      areas.includes("'a b' 't t' 'p p' 'c c' 'g g' 'f f'"),
      'mid width: countdown and panel under score and chart, then sites'
    );
    assert(
      areas.includes("'a b c' 't t c' 'p p c' 'g g g' 'f f f'"),
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
    ['Forecast', 'My marks', 'Catch log'].forEach(l => assert(nav.includes(l), l));
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
      const ens = html.match(/<em style="color:([^"]+)">\d+%<\/em>/);
      const check = html.match(/<p class="sub"><b style="color:([^"]+)">\d+%<\/b>/);
      assert(row && row[1] === lamp, prob + ': lamp ' + (row && row[1]));
      assert(ens && ens[1] === colour, prob + ': ensemble ' + (ens && ens[1]));
      assert(check && check[1] === colour, prob + ': pre-launch checks ' + (check && check[1]));
    }
    Object.assign(d, { prob: saved.prob, ensembleMembers: saved.members });
    d.agree.level = saved.level;
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
    assert(/<em style="color:var\(--mid\)">80%<\/em>/.test(html), 'ensemble % not amber with its HOLD lamp');
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
    const odd = ui.controlKey(el('BUTTON', { act: 'delMark', id: 'm1\nx"y' }));
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
    state.marks = [];
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
    const ss = advice.sessions(d, z, state.marks, config.ESTUARIES[2]);
    assert(ss.length > 0 && ss.every(x => x.where === 'Burnett River' && !/Outside is out/.test(x.how)));
  });
  await it('importing a file from the Marks tab adds the marks and reports what happened', async () => {
    const before = state.marks.length;
    const gpx =
      '<gpx><wpt lat="-24.718" lon="152.505"><name>Four Mile</name></wpt><wpt lat="-24.87" lon="151.85"><name>Dam</name></wpt></gpx>';
    const file = {
      name: 'marks.gpx',
      text: async () => gpx,
      arrayBuffer: async () => new TextEncoder().encode(gpx).buffer
    };
    state.tab = 'marks';
    await ui.importMarks(file);
    assert(state.marks.length === before + 1, 'one mark in range');
    assert(/Imported 1 mark\. 1 more than 25 km/.test(state.importMsg), state.importMsg);
    assert(nodes.app.innerHTML.includes('Four Mile') && nodes.app.innerHTML.includes('clearImported'));
    await ui.importMarks({
      name: 'junk.bin',
      text: async () => 'nothing',
      arrayBuffer: async () => new ArrayBuffer(8)
    });
    assert(/Couldn't read junk\.bin/.test(state.importMsg), state.importMsg);
  });
  await it('imported marks show on the map for the selected ramp only, with details on tap', async () => {
    const { mapSVG } = await imp('map');
    const m = state.marks.find(x => x.imported);
    const svg = mapSVG(state.days[0], 'burnett', state.marks, null);
    assert(
      (svg.match(/class="mk-dot"/g) || []).length ===
        state.marks.filter(x => x.ramp === 'burnett' && x.lat != null).length
    );
    assert(!/class="mk-dot"/.test(mapSVG(state.days[0], 'baffle', state.marks, null)), 'other ramp');
    state.tab = 'plan';
    state.view = 'ocean';
    state.zsel = 'burnett';
    ui.ACTIONS.markInfo({ dataset: { id: m.id } });
    assert(/class="sub mark-info"><b>Four Mile<\/b>/.test(nodes.app.innerHTML), 'caption');
    ui.ACTIONS.markInfo({ dataset: { id: m.id } });
    assert(!/mark-info/.test(nodes.app.innerHTML), 'second tap hides it');
    state.marks = state.marks.filter(x => !x.imported);
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
  await it('saving on the water tags the nearest mark from the phone location', async () => {
    const pos = { coords: { latitude: -24.7182, longitude: 152.5051 } };
    // Node has its own read-only navigator: swap it for one with a GPS fix, then put it back
    const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: { getCurrentPosition: ok => ok(pos) } },
      configurable: true
    });
    state.marks = [
      {
        id: 'a',
        name: 'Four Mile',
        ramp: 'burnett',
        km: 10,
        depth: 15,
        type: 'reef',
        lat: -24.718,
        lon: 152.505
      },
      { id: 'b', name: 'Far reef', ramp: 'burnett', km: 15, depth: 18, type: 'reef', lat: -24.6, lon: 152.6 }
    ];
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
    await ui.ACTIONS.addLog();
    const e = state.log[state.log.length - 1];
    assert(state.log.length === n + 1, 'saved');
    assert(
      e.species === 'Snapper, Grass sweetlip' && e.rating === 3 && e.mark === 'Four Mile',
      JSON.stringify(e)
    );
    assert(e.notes === 'early bite' && state.logDraft === null, 'notes kept, form cleared');
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
    else delete globalThis.navigator;
    state.log = state.log.slice(0, n);
    state.marks = [];
    ['ld', 'lr', 'lnotes'].forEach(k => delete nodes[k]);
  });
  await it('a second tap on Save while the location is coming does not log twice', async () => {
    const waiting = [];
    const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: { getCurrentPosition: ok => waiting.push(ok) } },
      configurable: true
    });
    state.marks = [
      {
        id: 'a',
        name: 'Four Mile',
        ramp: 'burnett',
        km: 10,
        depth: 15,
        type: 'reef',
        lat: -24.718,
        lon: 152.505
      }
    ];
    const today = util.isoDay(new Date());
    nodes.ld = { value: today };
    nodes.lr = { value: 'burnett' };
    nodes.lnotes = { value: '' };
    state.logDraft = { date: today, ramp: 'burnett', picked: ['Snapper'], rating: 2, notes: '' };
    const n = state.log.length;
    const first = ui.ACTIONS.addLog();
    const second = ui.ACTIONS.addLog(); // tapped again before the GPS answers
    waiting.forEach(ok => ok({ coords: { latitude: -24.718, longitude: 152.505 } }));
    await Promise.all([first, second]);
    assert(state.log.length === n + 1, 'saved ' + (state.log.length - n) + ' times');
    assert(state.savingLog === false, 'guard released');
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
    else delete globalThis.navigator;
    state.log = state.log.slice(0, n);
    state.marks = [];
    ['ld', 'lr', 'lnotes'].forEach(k => delete nodes[k]);
  });
  await it('the map is a group of controls, not an image (an image hides its buttons from screen readers)', async () => {
    const { mapSVG } = await imp('map');
    const svg = mapSVG(state.days[0], 'burnett', [], null);
    assert(/^<svg class="chart-map"[^>]*role="group"/.test(svg) && /role="button"/.test(svg));
  });
  await it('the file picker stays reachable from the keyboard', () => {
    state.tab = 'marks';
    ui.render();
    const input = nodes.app.innerHTML.match(/<input type="file"[^>]*>/)[0];
    assert(!/\shidden\b/.test(input) && /class="vh"/.test(input), input);
    state.tab = 'plan';
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
    state.marks = [];
    ui.render();
    assert(nodes.app.innerHTML.includes('Saved forecast'));
    state.raw.cached = false;
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
  await it('the only outside connection the page may make is the forecast', () => {
    const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)[1];
    const hosts = [...csp.matchAll(/https:\/\/[^\s;]+/g)].map(m => m[0]);
    assert(
      hosts.length && hosts.every(h => /^https:\/\/[a-z-]*api\.open-meteo\.com$/.test(h)),
      hosts.join(' ')
    );
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
