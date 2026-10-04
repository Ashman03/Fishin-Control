/**
 * model.js — turns raw forecast data into scored days. Pure: no DOM, no
 * network, no shared state. Everything it needs comes in as arguments, so it
 * can be tested by feeding it a fixture and checking what comes out.
 *
 * Pipeline
 *   pointSeries   one hourly series per sample point (20 of them)
 *   zoneSeries    per ramp: the WORST of its 10/15/20 km points each hour
 *   build         per day: windows, scores, tides, moon, probability, bite
 *
 * The go / no-go rule is `passes()`, and it is the only place the user's
 * limits are compared. The charts, the day score, the windows and the
 * ensemble probability all call it, so they cannot disagree with each other.
 */
import { ZONES, POINTS, TUNING, REFERENCE_ZONE } from './config.js';
import {
  clamp,
  lerp,
  mean,
  max,
  min,
  inArc,
  angDiff,
  circularMean,
  localDate,
  pickVar,
  hasData,
  HOUR,
  DAY
} from './util.js';
import { moonIllum, moonEvents } from './astro.js';
import { logHint } from './advice.js';

/* ── Sea state ──────────────────────────────────────────────────────────── */

/**
 * Short-period swell is steeper and rougher than its height suggests:
 * 0.6 m at 5 s is a square chop, 0.6 m at 11 s a lazy roll. The factor scales
 * swell height into an "effective" height before it meets the user's limit.
 */
export function periodFactor(T) {
  if (T == null) return 1.08; // unknown: assume slightly worse than average
  if (T <= 4) return 1.45;
  if (T <= 6) return 1.45 - ((T - 4) / 2) * 0.3; // 1.45 → 1.15
  if (T <= 8) return 1.15 - ((T - 6) / 2) * 0.15; // 1.15 → 1.00
  if (T <= 11) return 1.0 - ((T - 8) / 3) * 0.12; // 1.00 → 0.88
  return 0.88;
}

export function seaWord(T) {
  if (T == null) return 'period unknown';
  if (T <= 5) return 'short and square';
  if (T <= 7) return 'a bit steep';
  if (T <= 9) return 'moderate';
  return 'long and lazy';
}

/* ── The rule ───────────────────────────────────────────────────────────── */

/**
 * The user's go / no-go rule, exactly as stated: swell (period-weighted)
 * at or under the limit, sustained wind at or under the limit, gusts at or
 * under the limit. No discounts for shelter or direction.
 */
export const passes = (swellEff, wind, gust, cfg) =>
  swellEff <= cfg.maxSwell && wind <= cfg.maxWind && gust <= cfg.maxGust;

/** Soft 0–100 score for ranking hours and ramps. Never overrides `passes`. */
export function hourScore(h, z, cfg) {
  const T = TUNING;
  let s =
    T.weightSwell * (100 * (1 - lerp(h.swellEff, T.swellGood, T.swellBad))) +
    T.weightWind * (100 * (1 - lerp(h.wind, T.windGood, T.windBad))) +
    T.weightGust * (100 * (1 - lerp(h.gust, T.gustGood, T.gustBad)));
  const onshore = inArc(h.wdir, z.exposed);
  if (!onshore) s = Math.min(100, s * (1 + T.leeRankBonus)); // ranking only
  const ok = passes(h.swellEff, h.wind, h.gust, cfg);
  return { s: Math.round(ok ? s : Math.min(s, T.breachCap)), ok, onshore };
}

export const riverScore = h =>
  Math.round(
    0.5 * (100 * (1 - lerp(h.wind, 8, 28))) +
      0.3 * (100 * (1 - lerp(h.gust, 12, 34))) +
      0.2 * (100 * (1 - lerp(h.rain, 0, 6)))
  );

/** Unbroken runs of passing hours between `from` and `to`, at least minWindowHours long. */
export function windows(hours, from, to) {
  const out = [];
  let run = null;
  for (const h of hours) {
    if (h.z.ok && h.t >= from && h.t <= to) {
      if (!run) run = { a: h.t, b: h.t, ss: [] };
      run.b = new Date(+h.t + HOUR);
      run.ss.push(h.z.s);
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out
    .filter(w => w.b - w.a >= TUNING.minWindowHours * HOUR)
    .map(w => ({ ...w, avg: Math.round(mean(w.ss)), hrs: (w.b - w.a) / HOUR }));
}

/** High and low water from an hourly level series, refined by a parabolic fit. */
export function extrema(series) {
  const out = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1].v,
      b = series[i].v,
      c = series[i + 1].v;
    if (a == null || b == null || c == null) continue;
    if ((b > a && b >= c) || (b < a && b <= c)) {
      const den = a - 2 * b + c,
        off = den ? (0.5 * (a - c)) / den : 0;
      out.push({ t: new Date(+series[i].t + off * HOUR), v: b - 0.25 * (a - c) * off, hi: b > a });
    }
  }
  return out;
}

/* ── Series ─────────────────────────────────────────────────────────────── */

const hasWaves = h => !!h && (hasData(pickVar(h, 'swell_wave_height')) || hasData(pickVar(h, 'wave_height')));

/**
 * Index of the nearest sample point that has wave data. Inside the bay the
 * wave grids often return nothing; borrowing from the nearest open-water
 * point (same ramp first) beats borrowing from the first point in the list,
 * which before v4 meant Walkers Point borrowed Baffle Creek's swell.
 */
export function nearestWithWaves(i, marine) {
  const p = POINTS[i];
  let best = -1,
    bestD = Infinity;
  POINTS.forEach((q, j) => {
    if (!hasWaves(marine[j] && marine[j].hourly)) return;
    const dx = (q.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180),
      dy = q.lat - p.lat;
    const d = dx * dx + dy * dy - (q.zone === p.zone ? 1e-6 : 0); // same ramp wins a tie
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  });
  return best;
}

/** One hourly series per sample point, every value read by name (suffix-tolerant). */
export function pointSeries(raw) {
  const { fc, mar } = raw;
  const times = fc[0].hourly.time;
  return POINTS.map((p, i) => {
    const F = (fc[i] && fc[i].hourly) || fc[0].hourly;
    const own = mar[i] && mar[i].hourly;
    let W = own,
      borrowed = false;
    if (!hasWaves(own)) {
      const j = nearestWithWaves(i, mar);
      W = j >= 0 ? mar[j].hourly : {};
      borrowed = j >= 0;
    }
    const v = (block, name) => pickVar(block, name) || [];
    const f = {
      wind: v(F, 'wind_speed_10m'),
      gust: v(F, 'wind_gusts_10m'),
      dir: v(F, 'wind_direction_10m'),
      temp: v(F, 'temperature_2m'),
      rain: v(F, 'precipitation'),
      pres: v(F, 'pressure_msl')
    };
    const w = {
      swell: v(W, 'swell_wave_height'),
      wave: v(W, 'wave_height'),
      sp: v(W, 'swell_wave_period'),
      wp: v(W, 'wave_period'),
      chop: v(W, 'wind_wave_height'),
      sst: v(W, 'sea_surface_temperature')
    };
    const lvl = hasData(pickVar(own, 'sea_level_height_msl'))
      ? v(own, 'sea_level_height_msl')
      : v(W, 'sea_level_height_msl');
    return times.map((t, k) => {
      const swell = w.swell[k] ?? w.wave[k] ?? 0;
      return {
        t: localDate(t),
        wind: f.wind[k] ?? 0,
        gust: f.gust[k] ?? 0,
        wdir: f.dir[k] ?? 0,
        temp: f.temp[k] ?? null,
        rain: f.rain[k] ?? 0,
        pres: f.pres[k] ?? null,
        swell,
        period: w.sp[k] ?? w.wp[k] ?? null,
        chop: w.chop[k] ?? 0,
        sea: Math.max(w.wave[k] ?? 0, swell),
        sst: w.sst[k] ?? null,
        lvl: lvl[k] ?? null,
        borrowed
      };
    });
  });
}

/** Per ramp, per hour: the worst conditions across its 10, 15 and 20 km points. */
export function zoneSeries(points, tideDir) {
  return ZONES.map(z =>
    points[0].map((_, k) => {
      const out = z.ptOut.map(i => points[i][k]);
      const mid = points[z.ptMid][k],
        inn = points[z.ptInshore][k];
      const shelter = out.some(h => h.borrowed) ? z.shelterF : 1;
      const swell = max(out.map(h => h.swell)) * shelter;
      const periods = out.map(h => h.period).filter(v => v != null);
      const period = periods.length ? Math.min(...periods) : null; // the short one is the one that hurts
      const td = tideDir[k] || { dir: 0, rate: 0 };

      // wind against tide on the bar: a run-out into an onshore breeze
      const onshoreBar = angDiff(mid.wdir, z.out) < TUNING.onshoreArc;
      let bar = 0;
      if (td.dir < 0 && td.rate > TUNING.barRunning) {
        if (onshoreBar) bar += 1;
        if (inn.wind >= TUNING.barWind) bar += 1;
        if (swell >= TUNING.barSwell) bar += 1;
        if (td.rate >= TUNING.barHard) bar += 1;
        if (!onshoreBar) bar = Math.max(0, bar - 1);
      }
      bar = Math.round(clamp(bar * z.barF, 0, 3));

      return {
        t: mid.t,
        wind: max(out.map(h => h.wind)),
        gust: max(out.map(h => h.gust)),
        wdir: mid.wdir,
        swell,
        period,
        swellEff: swell * periodFactor(period),
        chop: max(out.map(h => h.chop)),
        sea: max(out.map(h => h.sea)) * shelter,
        sst: mid.sst,
        windIn: inn.wind,
        swellIn: inn.swell * (inn.borrowed ? z.shelterF : 1),
        swell20: out[2].swell * shelter,
        tideDir: td.dir,
        tideRate: td.rate,
        bar,
        onshoreBar,
        temp: mid.temp,
        rain: inn.rain,
        pres: inn.pres
      };
    })
  );
}

/** Map of time (ms) → value for one variable of an hourly block. */
function byTime(hourly, name) {
  const m = new Map(),
    vals = pickVar(hourly, name);
  if (!vals || !hourly.time) return m;
  hourly.time.forEach((t, k) => {
    if (vals[k] != null) m.set(+localDate(t), vals[k]);
  });
  return m;
}

/* ── Build ──────────────────────────────────────────────────────────────── */

/**
 * @param raw  payload from data.getData() or data.sampleData()
 * @param ctx  { cfg, log, now? } — the user's limits, catch log, and clock
 * @returns    { days: [...today onward], past: [...earlier days] }
 */
export function build(raw, { cfg, log = [], now = new Date() }) {
  const { fc, windAlt = [], waveAlt = [], ensemble = null, noWaves = false } = raw;
  const times = fc[0].hourly.time;
  const points = pointSeries(raw);

  const refZ = ZONES.find(z => z.id === REFERENCE_ZONE);
  const tidePts = points[refZ.ptTide];
  const lvl = tidePts.map(h => h.lvl);
  const tideDir = lvl.map((_, k) => {
    const a = lvl[k - 1],
      b = lvl[k + 1];
    if (a == null || b == null) return { dir: 0, rate: 0 };
    const d = (b - a) / 2;
    return { dir: Math.sign(d), rate: Math.abs(d) };
  });
  const zones = zoneSeries(points, tideDir);
  const allTides = extrema(tidePts.map(h => ({ t: h.t, v: h.lvl })));

  // ensemble members re-indexed by time so they line up with the forecast
  const ens =
    ensemble && ensemble.members.length
      ? {
          n: ensemble.members.length,
          at: ensemble.members.map(m => {
            const map = new Map();
            ensemble.times.forEach((t, k) => {
              if (m.wind[k] != null) map.set(+t, { wind: m.wind[k], gust: m.gust ? m.gust[k] : null });
            });
            return map;
          })
        }
      : null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const allDates = [...new Set(times.map(t => t.slice(0, 10)))];
  const ref = points[refZ.ptMid];

  function agreement(d0, d1) {
    const inDay = t => t >= d0 && t < d1;
    const base = mean(ref.filter(h => inDay(h.t)).map(h => h.wind));
    const winds = windAlt
      .map(({ sets }) => {
        const m = byTime(sets[refZ.ptMid] && sets[refZ.ptMid].hourly, 'wind_speed_10m');
        const v = [...m].filter(([t]) => inDay(t)).map(([, x]) => x);
        return v.length ? mean(v) : null;
      })
      .filter(v => v != null);
    const baseS = mean(ref.filter(h => inDay(h.t)).map(h => h.swell));
    const swells = waveAlt
      .map(({ sets }) => {
        const h = sets[refZ.ptMid] && sets[refZ.ptMid].hourly;
        const m = byTime(h, 'swell_wave_height').size
          ? byTime(h, 'swell_wave_height')
          : byTime(h, 'wave_height');
        const v = [...m].filter(([t]) => inDay(t)).map(([, x]) => x);
        return v.length ? mean(v) : null;
      })
      .filter(v => v != null);
    const wAll = [base, ...winds],
      sAll = [baseS, ...swells];
    const wSpread = wAll.length > 1 ? Math.max(...wAll) - Math.min(...wAll) : null;
    const sSpread = sAll.length > 1 ? Math.max(...sAll) - Math.min(...sAll) : null;
    const T = TUNING;
    let level = 'unknown';
    if (wSpread != null) {
      const s = sSpread ?? 0;
      level =
        wSpread < T.agreeHighWind && s < T.agreeHighSwell
          ? 'high'
          : wSpread < T.agreeFairWind && s < T.agreeFairSwell
            ? 'fair'
            : 'low';
    }
    return { level, wSpread, sSpread, windModels: wAll.length, waveModels: sAll.length };
  }

  /**
   * Share of ensemble members giving at least minWindowHours in a row inside
   * the limits at this ramp. Members are sampled at the reference point, so
   * each hour is shifted by the deterministic difference between this ramp
   * and the reference point at that same hour. Swell has no ensemble, so the
   * deterministic swell gate applies to every member.
   */
  function probability(zi, from, to) {
    if (!ens) return null;
    const zh = zones[zi].filter(h => h.t >= from && h.t <= to);
    const refAt = new Map(ref.map(h => [+h.t, h]));
    let pass = 0,
      counted = 0;
    for (const member of ens.at) {
      let run = 0,
        best = 0,
        seen = 0;
      for (const h of zh) {
        const e = member.get(+h.t),
          r = refAt.get(+h.t);
        if (!e || !r) {
          run = 0;
          continue;
        }
        seen++;
        const wind = e.wind + (h.wind - r.wind);
        const gustBase = e.gust ?? e.wind * (r.wind > 0 ? r.gust / r.wind : 1.35);
        const gust = gustBase + (h.gust - r.gust);
        if (passes(h.swellEff, wind, gust, cfg)) {
          run++;
          best = Math.max(best, run);
        } else run = 0;
      }
      if (seen >= 3) {
        counted++;
        if (best >= TUNING.minWindowHours) pass++;
      }
    }
    return counted ? Math.round((100 * pass) / counted) : null;
  }

  const built = allDates.map(ds => {
    const d0 = localDate(ds + 'T00:00'),
      d1 = new Date(+d0 + DAY);
    const di = fc[0].daily && fc[0].daily.time ? fc[0].daily.time.indexOf(ds) : -1;
    const sunrise = di >= 0 ? localDate(fc[0].daily.sunrise[di]) : new Date(+d0 + 5.6 * HOUR);
    const sunset = di >= 0 ? localDate(fc[0].daily.sunset[di]) : new Date(+d0 + 17.6 * HOUR);
    const from = new Date(+sunrise - 15 * 6e4),
      to = new Date(+sunset + 15 * 6e4);

    const zs = ZONES.map((z, zi) => {
      const hours = zones[zi]
        .filter(h => h.t >= d0 && h.t < d1)
        .map(h => ({ ...h, z: hourScore(h, z, cfg) }));
      const day = hours.filter(h => h.t >= from && h.t <= to);
      const top = [...day].sort((a, b) => b.z.s - a.z.s).slice(0, TUNING.topHours);
      const goodHrs = day.filter(h => h.z.ok).length;
      const score = Math.round(
        mean(top.map(h => h.z.s)) *
          (TUNING.windowFloor + (1 - TUNING.windowFloor) * clamp(goodHrs / TUNING.targetGoodHours, 0, 1))
      );
      const barWin = [];
      let rb = null;
      for (const h of day) {
        if (h.bar >= 2) {
          if (!rb) rb = { a: h.t, b: h.t, max: h.bar };
          rb.b = new Date(+h.t + HOUR);
          rb.max = Math.max(rb.max, h.bar);
        } else if (rb) {
          barWin.push(rb);
          rb = null;
        }
      }
      if (rb) barWin.push(rb);
      const periods = day.map(h => h.period).filter(v => v != null);
      return {
        z,
        hours,
        win: windows(hours, from, to),
        score: noWaves ? Math.min(score, TUNING.capNoWaves) : score,
        goodHrs,
        barWin,
        prob: probability(zi, from, to),
        swell: min(day.map(h => h.swell)),
        swellMax: max(day.map(h => h.swell)),
        swellEffMax: max(day.map(h => h.swellEff)),
        chop: max(day.map(h => h.chop)),
        period: periods.length ? Math.min(...periods) : null,
        wind: mean(day.map(h => h.wind)),
        windMax: max(day.map(h => h.wind)),
        gust: max(day.map(h => h.gust)),
        wdir: circularMean(
          day.map(h => h.wdir),
          day.map(h => h.wind)
        ),
        swellIn: max(day.map(h => h.swellIn)),
        swell20: max(day.map(h => h.swell20)),
        barMax: max(day.map(h => h.bar))
      };
    }).sort((a, b) => b.score - b.z.drive - (a.score - a.z.drive));

    const refDay = points[refZ.ptInshore].filter(h => h.t >= d0 && h.t < d1);
    const tideDay = tidePts.filter(h => h.t >= d0 && h.t < d1);
    const daylight = refDay.filter(h => h.t >= from && h.t <= to);
    const tides = allTides.filter(t => t.t >= d0 && t.t < d1);
    const range =
      tides.length > 1 ? Math.max(...tides.map(t => t.v)) - Math.min(...tides.map(t => t.v)) : null;
    const moon = moonIllum(new Date(+d0 + 12 * HOUR));
    const me = moonEvents(d0, refZ.mlat, refZ.mlon);
    const rain = refDay.reduce((a, h) => a + (h.rain || 0), 0);
    const pres = refDay.map(h => h.pres).filter(v => v != null);
    const presTrend = pres.length > 1 ? pres[pres.length - 1] - pres[0] : 0;
    const ssts = ref
      .filter(h => h.t >= d0 && h.t < d1)
      .map(h => h.sst)
      .filter(v => v != null);
    const agree = agreement(d0, d1);
    const best = zs[0];

    const T = TUNING;
    let bite = T.biteBase;
    const nf = Math.min(Math.abs(moon.phase), Math.abs(moon.phase - 0.5), Math.abs(moon.phase - 1));
    if (nf < 0.06) bite += T.biteMoon;
    else if (nf < 0.12) bite += T.biteMoonNear;
    else if (Math.abs(nf - 0.25) < 0.05) bite += T.biteQuarter;
    if (presTrend < -1.5) bite += T.biteFalling;
    else if (presTrend > 2.5) bite += T.biteRising;
    if (range != null) {
      if (range > 2.6) bite += T.biteBigTide;
      else if (range < 1.4) bite += T.biteNeap;
    }
    if (rain > 0.5 && rain < 12) bite += T.biteShower;
    else if (rain >= 12) bite += T.biteWet;
    const hint = logHint(log, best, moon);
    if (hint) bite += hint.delta;
    bite = clamp(Math.round(bite), 5, 95);

    let overall = Math.round(clamp(0.74 * best.score + 0.26 * bite, 0, 100));
    const caps = [];
    if (agree.level === 'low') {
      overall = Math.min(overall, T.capLowAgreement);
      caps.push('models disagree');
    }
    if (noWaves) {
      overall = Math.min(overall, T.capNoWaves);
      caps.push('no swell data');
    }
    if (best.prob != null && best.prob < T.lowProbability) {
      overall = Math.min(overall, T.capLowProbability);
      caps.push('most ensemble runs give no window');
    }

    return {
      ds,
      d0,
      sunrise,
      sunset,
      from,
      to,
      zones: zs,
      past: d0 < today,
      river: Math.round(mean(daylight.map(riverScore))),
      tides,
      range,
      moon,
      me,
      rain,
      presTrend,
      agree,
      noWaves,
      caps,
      prob: best.prob,
      ensembleMembers: ens ? ens.n : 0,
      hint,
      sst: ssts.length ? mean(ssts) : null,
      bite,
      overall,
      tideCurve: tideDay.map(h => ({ t: h.t, v: h.lvl }))
    };
  });

  return {
    days: built.filter(d => !d.past).slice(0, TUNING.forecastDays),
    past: built.filter(d => d.past)
  };
}

/** Conditions for one ramp on one date — used to stamp catch-log entries. */
export function conditionsFor(built, ds, zoneId) {
  const d = [...built.past, ...built.days].find(x => x.ds === ds);
  if (!d) return null;
  const z = d.zones.find(x => x.z.id === zoneId) || d.zones[0];
  return { day: d, zone: z };
}
