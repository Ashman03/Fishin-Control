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
 * An hour with no wind or gust figure (`gap`) never passes, and a forecast
 * thunderstorm ends a launch window: neither is a limit, so neither lives in
 * `passes()`, but both apply wherever it does.
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
  fromNewOrFull,
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
 * The swell figure the limit is checked against: weighted for period, so
 * short, steep swell counts as more than its height, but never counted as
 * less than the forecast height. Long, lazy swell still breaks hard on a
 * shallow bar, so anything over the limit is a no go whatever its period.
 */
export const swellCheck = (swell, swellEff) => Math.max(swell, swellEff);

/**
 * The user's go / no-go rule, exactly as stated: swell (as `swellCheck`)
 * at or under the limit, sustained wind at or under the limit, gusts at or
 * under the limit. No discounts for shelter or direction.
 */
export const passes = (swellChk, wind, gust, cfg) =>
  swellChk <= cfg.maxSwell && wind <= cfg.maxWind && gust <= cfg.maxGust;

/**
 * Soft score deductions for things that make the water worse than its
 * numbers, from the user's own experience. Points, never a gate:
 *   north    a northerly, scaled by strength against the limit; fades to
 *            nothing by east and west
 *   current  wind blowing against the tidal stream (h.against, 0–1)
 *   storm    a forecast thunderstorm hour, or the hour before one; less for
 *            a hot, unstable, showery hour
 */
export function softPenalties(h, cfg) {
  const T = TUNING;
  const fromNorth = Math.max(0, Math.cos((angDiff(h.wdir, 0) * Math.PI) / 180));
  const north = T.northerly * fromNorth * clamp(h.wind / cfg.maxWind, 0, 1);
  const current = T.windCurrent * (h.against || 0);
  const storm = h.storm === 2 ? T.storm : h.storm === 1 ? T.stormUnstable : 0;
  return { north, current, storm, total: north + current + storm };
}

/** Soft 0–100 score for ranking hours and ramps. Never overrides `passes`. */
export function hourScore(h, z, cfg) {
  const T = TUNING;
  let s =
    T.weightSwell * (100 * (1 - lerp(h.swellEff, T.swellGood, T.swellBad))) +
    T.weightWind * (100 * (1 - lerp(h.wind, T.windGood, T.windBad))) +
    T.weightGust * (100 * (1 - lerp(h.gust, T.gustGood, T.gustBad)));
  const onshore = inArc(h.wdir, z.exposed);
  if (!onshore) s = Math.min(100, s * (1 + T.leeRankBonus)); // ranking only
  s = Math.max(0, s - softPenalties(h, cfg).total);
  const ok = !h.gap && passes(h.swellChk, h.wind, h.gust, cfg);
  return { s: Math.round(ok ? s : Math.min(s, T.breachCap)), ok, onshore };
}

/** Storm signal for one hour: 2 thunderstorm forecast, 1 unstable and showery, 0 none. */
export const stormLevel = (code, cape, rain) =>
  code >= 95 ? 2 : cape != null && cape >= TUNING.unstableCape && rain > 0.2 ? 1 : 0;

/**
 * How squarely the wind opposes the current, 0–1, scaled by both strengths.
 * The wind direction is where it comes FROM; the current's is where it is
 * GOING — so they oppose when the two bearings are the same.
 */
export function windAgainstCurrent(wind, wdir, curKn, curDir) {
  if (curKn == null || curDir == null) return 0;
  const T = TUNING;
  const head = Math.max(0, Math.cos((angDiff(wdir, curDir) * Math.PI) / 180));
  return head * lerp(wind, 5, 15) * lerp(curKn, T.currentWeak, T.currentStrong);
}

/**
 * River and creek score, 0–100. Rivers fish on the tide and the moon, so
 * those lead; wind only counts once it is genuinely strong close in, and a
 * big three-day rain total marks the water as run-off dirty.
 *   c = { range, turns, nf, major, presTrend, rain, rain72, windIn }
 *   (nf: distance of the moon phase from new or full, 0–0.25)
 */
export function riverScore(c) {
  const T = TUNING;
  let s = T.riverBase;
  if (c.range != null) {
    if (c.range > 2.4) s += T.riverSprings;
    else if (c.range >= 1.6) s += T.riverMidTide;
    else if (c.range < 1.4) s += T.riverNeaps;
  }
  s += T.riverTurn * Math.min(2, c.turns);
  if (c.nf < 0.06) s += T.riverMoon;
  else if (c.nf < 0.12) s += T.riverMoonNear;
  else if (Math.abs(c.nf - 0.25) < 0.05) s += T.riverMoonQuarter;
  if (c.major) s += T.riverMajor;
  if (c.presTrend < -1.5) s += T.riverFalling;
  else if (c.presTrend > 2.5) s += T.riverRising;
  const runoff = c.rain72 >= T.riverRunoffMm;
  if (runoff) s += T.riverRunoff;
  else if (c.rain > 0.5 && c.rain < 12) s += T.riverShower;
  const windStrong = c.windIn >= T.riverWindStrong;
  if (windStrong) s += T.riverWindPenalty;
  return { score: clamp(Math.round(s), 5, 95), runoff, windStrong };
}

/**
 * The rules besides the limits that keep an hour out of a launch window: a
 * wind or gust figure missing, or a thunderstorm forecast in the hour or the
 * hour after (zone hour `storm` 2 carries that buffer). A showery, unstable
 * hour only costs points. Shared by the windows and the ensemble probability.
 */
export const windowRules = h => !h.gap && h.storm !== 2;

/** Whether an hour can sit inside a launch window: inside the limits, and clear of `windowRules`. */
export const launchable = h => h.z.ok && windowRules(h);

/**
 * Unbroken runs of launchable hours inside the fishing hours [from, to], at
 * least minWindowHours long. Each hour covers t to t + 1 h; a window never
 * runs past `to`, so the hour that starts at the cut-off adds nothing.
 */
export function windows(hours, from, to) {
  const out = [];
  let run = null;
  for (const h of hours) {
    if (launchable(h) && h.t >= from && h.t < to) {
      if (!run) run = { a: h.t, b: h.t, ss: [] };
      run.b = new Date(Math.min(+h.t + HOUR, +to));
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

/**
 * Where each forecast hour sits in another block's time axis (-1 if absent).
 * The wave forecast normally starts at the same hour as the wind, but a saved
 * copy from an earlier day does not, so values are matched by timestamp and
 * never by position: matched by position, yesterday's copy would put every
 * swell figure a day out.
 */
export function alignTo(times, block) {
  if (!block || !Array.isArray(block.time)) return times.map((_, k) => k);
  const at = new Map(block.time.map((t, k) => [t, k]));
  return times.map(t => at.get(t) ?? -1);
}

/**
 * One hourly series per sample point, every value read by name (suffix-tolerant).
 * A missing wind or gust figure reads as 0 for the charts and sums, but marks
 * the hour `gap`, and a gap hour never passes: an unknown gust is not a calm
 * one. A point the forecast left out entirely is all gaps, not a copy of
 * another point. (A missing swell figure reads as 0 m by the owner's choice.)
 */
export function pointSeries(raw) {
  const { fc, mar } = raw;
  const times = fc[0].hourly.time;
  return POINTS.map((p, i) => {
    const F = (fc[i] && fc[i].hourly) || {};
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
      rain: v(F, 'precipitation'),
      pres: v(F, 'pressure_msl'),
      code: v(F, 'weather_code'),
      cape: v(F, 'cape')
    };
    const w = {
      swell: v(W, 'swell_wave_height'),
      wave: v(W, 'wave_height'),
      sp: v(W, 'swell_wave_period'),
      wp: v(W, 'wave_period'),
      chop: v(W, 'wind_wave_height'),
      sst: v(W, 'sea_surface_temperature'),
      cur: v(W, 'ocean_current_velocity'), // km/h
      curDir: v(W, 'ocean_current_direction')
    };
    const lvlBlock = hasData(pickVar(own, 'sea_level_height_msl')) ? own : W;
    const lvl = v(lvlBlock, 'sea_level_height_msl');
    const wAt = alignTo(times, W),
      lAt = alignTo(times, lvlBlock);
    return times.map((t, k) => {
      const m = wAt[k];
      const swell = w.swell[m] ?? w.wave[m] ?? 0;
      const gap = f.wind[k] == null || f.gust[k] == null;
      const wind = f.wind[k] ?? 0,
        wdir = f.dir[k] ?? 0,
        rain = f.rain[k] ?? 0;
      const cur = w.cur[m] != null ? w.cur[m] / 1.852 : null; // knots
      return {
        t: localDate(t),
        wind,
        gust: f.gust[k] ?? 0,
        wdir,
        rain,
        storm: stormLevel(f.code[k] ?? 0, f.cape[k] ?? null, rain),
        against: windAgainstCurrent(wind, wdir, cur, w.curDir[m] ?? null),
        pres: f.pres[k] ?? null,
        swell,
        period: w.sp[m] ?? w.wp[m] ?? null,
        chop: w.chop[m] ?? 0,
        sea: Math.max(w.wave[m] ?? 0, swell),
        sst: w.sst[m] ?? null,
        lvl: lvl[lAt[k]] ?? null,
        borrowed,
        gap
      };
    });
  });
}

/** Per ramp, per hour: the worst conditions across its 10, 15 and 20 km points. */
export function zoneSeries(points, tideDir) {
  const buffer = TUNING.stormBufferHours;
  return ZONES.map(z =>
    points[0].map((_, k) => {
      const out = z.ptOut.map(i => points[i][k]);
      // storms anywhere on the ramp's line, including close in, and the hour(s) before one
      const stormAt = j => max(z.pts.map(i => (points[i][j] ? points[i][j].storm : 0)));
      let storm = stormAt(k);
      for (let b = 1; b <= buffer; b++) storm = Math.max(storm, stormAt(k + b));
      const mid = points[z.ptMid][k],
        inn = points[z.ptInshore][k];
      const shelter = out.some(h => h.borrowed) ? z.shelterF : 1;
      const swell = max(out.map(h => h.swell)) * shelter;
      const periods = out.map(h => h.period).filter(v => v != null);
      const period = periods.length ? Math.min(...periods) : null; // the short one is the one that hurts
      const swellEff = swell * periodFactor(period);
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
        swellEff,
        swellChk: swellCheck(swell, swellEff),
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
        storm,
        stormNow: stormAt(k), // without the buffer: when the storm itself is forecast
        against: max(out.map(h => h.against)),
        rain: inn.rain,
        pres: inn.pres,
        gap: out.some(h => h.gap) // wind or gust missing at a point that decides go / no-go
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
            (m.times || ensemble.times).forEach((t, k) => {
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
  const refAt = new Map(ref.map(h => [+h.t, h]));

  /**
   * How closely the independent models agree, over daylight only.
   * Sea state is compared as TOTAL wave height: at short periods the models
   * split "swell" from "wind sea" very differently, so comparing the swell
   * partition reads a labelling difference as a disagreement about the water.
   */
  function agreement(from, to) {
    const inDay = t => t >= from && t <= to;
    const base = mean(ref.filter(h => inDay(h.t)).map(h => h.wind));
    const winds = windAlt
      .map(({ sets }) => {
        // cross-check requests carry only the reference point, so it is the first set
        const m = byTime(sets[0] && sets[0].hourly, 'wind_speed_10m');
        const v = [...m].filter(([t]) => inDay(t)).map(([, x]) => x);
        return v.length ? mean(v) : null;
      })
      .filter(v => v != null);
    const baseS = mean(ref.filter(h => inDay(h.t)).map(h => h.sea));
    const swells = waveAlt
      .map(({ sets }) => {
        const h = sets[0] && sets[0].hourly;
        const total = byTime(h, 'wave_height');
        const m = total.size ? total : byTime(h, 'swell_wave_height');
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
   * deterministic swell gate applies to every member, and so do the gap and
   * thunderstorm rules that end a window.
   */
  function probability(zi, from, to) {
    if (!ens) return null;
    const zh = zones[zi].filter(h => h.t >= from && h.t <= to);
    let pass = 0,
      counted = 0;
    for (const member of ens.at) {
      let run = 0,
        best = 0,
        seen = 0;
      for (const h of zh) {
        const e = member.get(+h.t),
          r = refAt.get(+h.t);
        if (!e || !r || r.gap) {
          run = 0;
          continue;
        }
        seen++;
        const wind = e.wind + (h.wind - r.wind);
        const gustBase = e.gust ?? e.wind * (r.wind > 0 ? r.gust / r.wind : 1.35);
        const gust = gustBase + (h.gust - r.gust);
        if (windowRules(h) && passes(h.swellChk, wind, gust, cfg)) {
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
    // fishing hours: never earlier or later than this around first and last light
    const from = new Date(+sunrise - TUNING.fishBeforeSunrise * 6e4),
      to = new Date(+sunset + TUNING.fishAfterSunset * 6e4);

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
      const stormy = day.filter(h => h.stormNow > 0);
      const win = windows(hours, from, to);
      // scattered passing hours can rank high, but without a window there is no launch
      const noWindow = !win.length && score > TUNING.capNoWindow;
      let capped = noWindow ? TUNING.capNoWindow : score;
      if (noWaves) capped = Math.min(capped, TUNING.capNoWaves);
      return {
        z,
        hours,
        win,
        score: capped,
        noWindow, // scored high enough to read as a Go, but had no window
        goodHrs,
        barWin,
        prob: probability(zi, from, to),
        swell: min(day.map(h => h.swell)),
        swellMax: max(day.map(h => h.swell)),
        swellChkMax: max(day.map(h => h.swellChk)),
        gapHrs: day.filter(h => h.gap).length, // hours with no wind or gust figure
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
        barMax: max(day.map(h => h.bar)),
        stormFrom: stormy.length ? stormy[0].t : null, // first fishing hour with storm risk
        stormMax: max(stormy.map(h => h.stormNow)) // 2 thunderstorm, 1 unstable
      };
    })
      // a ramp you can launch from always ranks above one you can't
      .sort((a, b) => !!b.win.length - !!a.win.length || b.score - b.z.drive - (a.score - a.z.drive));

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
    const agree = agreement(from, to);

    // rivers and creeks: tide, moon and rain; wind only when strong
    const inHours = t => t && t >= from && t <= to;
    const nf = fromNewOrFull(moon.phase);
    const turns = tides.filter(t => inHours(t.t));
    const majors = [me.over, me.under].filter(inHours).sort((a, b) => a - b);
    const rain72 = points[refZ.ptInshore]
      .filter(h => h.t >= new Date(+d0 - 2 * DAY) && h.t < d1)
      .reduce((a, h) => a + (h.rain || 0), 0);
    const windIn = mean(daylight.map(h => h.wind));
    const riverInfo = {
      ...riverScore({
        range,
        turns: turns.length,
        nf,
        major: majors.length > 0,
        presTrend,
        rain,
        rain72,
        windIn
      }),
      rain72,
      windIn,
      turns, // tide turns inside the fishing hours
      majors // moon overhead / underfoot inside the fishing hours
    };
    const best = zs[0];

    const T = TUNING;
    let bite = T.biteBase;
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
    // The ensemble is the purpose-built measure of forecast uncertainty, so when
    // it is available and confident, a spread between the headline models does
    // not override it. Without a confident ensemble the spread still caps the day.
    const ensembleConfident = best.prob != null && best.prob >= T.ensembleTrusted;
    if (agree.level === 'low' && !ensembleConfident) {
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
    // a Go needs somewhere to go: the best ramp must have a launch window
    if (!best.win.length && (best.noWindow || overall > T.capNoWindow)) {
      overall = Math.min(overall, T.capNoWindow);
      caps.push('no ' + T.minWindowHours + '-hour window inside your limits');
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
      river: riverInfo.score,
      riverInfo,
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
