/**
 * advice.js — turns a scored day into plain-language advice: which sessions
 * to fish, which marks suit them, what to throw, and what your own catch log
 * says. Pure: everything comes in as arguments.
 */
import { SEASON, MARK_PREF, TUNING } from './config.js';
import { mean, clamp, dirOf, HOUR } from './util.js';

/** Up to two marks for this ramp that suit this part of the tide and light. */
export function marksFor(marks, zoneId, kind, swell) {
  const pref = MARK_PREF[kind] || MARK_PREF.run;
  return marks
    .filter(m => m.ramp === zoneId)
    .map(m => {
      let q = pref.indexOf(m.type);
      q = q < 0 ? 9 : q;
      if (swell > 0.6 && m.km > 12) q += 3; // lumpy: favour closer ground
      return { ...m, q };
    })
    .sort((a, b) => a.q - b.q || a.km - b.km)
    .slice(0, 2);
}

export function tidePhaseAt(t, tides) {
  if (!tides || !tides.length) return 'unknown';
  const near = tides.find(x => Math.abs(x.t - t) <= 45 * 6e4);
  if (near) return near.hi ? 'high' : 'low';
  const next = tides.find(x => x.t > t);
  if (!next) return 'unknown';
  return next.hi ? 'run-in' : 'run-out';
}

export function moonBucket(phase) {
  if (Math.min(Math.abs(phase), Math.abs(phase - 1)) < 0.08) return 'new';
  if (Math.abs(phase - 0.5) < 0.08) return 'full';
  if (Math.abs(phase - 0.25) < 0.09 || Math.abs(phase - 0.75) < 0.09) return 'quarter';
  return 'between';
}
export const moonLabel = b => (b === 'between' ? 'mid-phase' : b);

/**
 * A small nudge to the bite score from the user's own record. Capped so it can
 * never talk anyone into a bad day — it only touches bite, never the limits.
 */
export function logHint(log, zone, moon) {
  if (log.length < 6) return null;
  const mb = moonBucket(moon.phase);
  let hits = log.filter(e => e.ramp === zone.z.id && e.moon === mb),
    how = 'on a ' + moonLabel(mb) + ' moon';
  if (hits.length < 3) {
    hits = log.filter(e => e.ramp === zone.z.id);
    how = 'overall';
  }
  if (hits.length < 4) return null;
  const avg = mean(hits.map(e => e.rating));
  const cap = TUNING.logNudgeMax;
  const delta = Math.round(clamp((avg - 1.5) * 4, -cap, cap));
  if (!delta) return null;
  return {
    delta,
    n: hits.length,
    avg,
    text:
      (delta > 0 ? 'Your log likes ' : 'Your log is cool on ') +
      zone.z.name +
      ' ' +
      how +
      ' — ' +
      hits.length +
      ' sessions averaging ' +
      avg.toFixed(1) +
      ' out of 3.'
  };
}

/** Average rating grouped by tide, moon, ramp and wind; most-logged species. */
export function patterns(log) {
  if (log.length < 4) return null;
  const by = key => {
    const m = {};
    log.forEach(e => {
      const k = e[key];
      if (k) (m[k] = m[k] || []).push(e.rating);
    });
    return Object.entries(m)
      .map(([k, v]) => ({ k, n: v.length, avg: mean(v) }))
      .filter(x => x.n >= 2)
      .sort((a, b) => b.avg - a.avg);
  };
  const sp = {};
  log.forEach(e =>
    (e.species || '')
      .split(/,\s*/)
      .filter(Boolean)
      .forEach(x => {
        sp[x] = (sp[x] || 0) + 1;
      })
  );
  return {
    tide: by('tide'),
    moon: by('moon'),
    ramp: by('ramp'),
    wind: by('windDir'),
    species: Object.entries(sp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  };
}

const COPY = {
  dawn: [
    'First light',
    'The best hour of the day for no reason other than being there. Work the shallow edges and the reef tops before the sun is on the water — topwater first, plastics once it lifts. Pelagics pin bait against the surface early, so watch for birds on the way out.'
  ],
  high: [
    'Top of the tide',
    'Fish are up on the flats and hard against the mangrove lines. Poppers and small plastics over the sand, live baits along the edges. Out wide the run eases at the top, which is the best window to sit on a mark and drop baits.'
  ],
  low: [
    'Bottom of the tide',
    'Everything is off the flats and pinned to the deeper edges. Rock bars, drains and drop-offs with vibes and paddle tails, or anchor up-current and wash a bait back. Good time to mark new structure on the sounder.'
  ],
  dusk: [
    'Last of the light',
    'Second bite of the day. Slow down, rework the structure that produced this morning, and leave yourself enough light to get back over the bar.'
  ],
  run: [
    'Mid-tide run',
    'Plenty of water moving. Troll the reef edges or drift with the run, and spot-lock up-current once you find them.'
  ]
};

/**
 * Up to three non-overlapping sessions inside the day's passing windows,
 * anchored on first light, tide turns and dusk, ranked by light and moon.
 * With no passing window it falls back to a river day.
 */
export function sessions(day, zone, marks) {
  const maj = [day.me.over, day.me.under].filter(Boolean);
  let wins = zone.win.slice(),
    where = zone.z.name,
    riverDay = false;
  if (!wins.length) {
    wins = [{ a: new Date(+day.sunrise - 0.5 * HOUR), b: new Date(+day.sunset), avg: day.river }];
    where = 'Burnett River, or Baffle Creek for the best shelter';
    riverDay = true;
  }
  const clip = (a, b, w) => ({ a: new Date(Math.max(+a, +w.a)), b: new Date(Math.min(+b, +w.b)) });
  const cand = [];
  for (const w of wins) {
    const an = [];
    if (day.sunrise >= new Date(+w.a - 0.75 * HOUR) && day.sunrise <= w.b)
      an.push({
        kind: 'dawn',
        ...clip(new Date(+day.sunrise - 0.5 * HOUR), new Date(+day.sunrise + 2.5 * HOUR), w)
      });
    day.tides
      .filter(t => t.t >= new Date(+w.a - HOUR) && t.t <= new Date(+w.b + HOUR))
      .forEach(t =>
        an.push({
          kind: t.hi ? 'high' : 'low',
          ...clip(new Date(+t.t - 1.75 * HOUR), new Date(+t.t + 1.75 * HOUR), w)
        })
      );
    if (day.sunset >= w.a && day.sunset <= new Date(+w.b + 0.75 * HOUR))
      an.push({
        kind: 'dusk',
        ...clip(new Date(+day.sunset - 2.5 * HOUR), new Date(+day.sunset + 0.5 * HOUR), w)
      });
    if (!an.length) an.push({ kind: 'run', a: w.a, b: new Date(Math.min(+w.b, +w.a + 4 * HOUR)) });
    an.forEach(x => {
      if (x.b - x.a >= 1.25 * HOUR) cand.push({ ...x, win: w });
    });
  }
  for (const c of cand) {
    let q = c.win.avg || 50;
    if (c.kind === 'dawn') q += 22;
    else if (c.kind === 'dusk') q += 12;
    if (c.kind === 'high' || c.kind === 'low') q += 8;
    c.solunar = maj.some(m => m >= c.a && m <= c.b);
    if (c.solunar) q += 14;
    c.q = q;
  }
  cand.sort((a, b) => b.q - a.q);
  const picked = [];
  for (const c of cand) if (picked.length < 3 && !picked.some(p => c.a < p.b && c.b > p.a)) picked.push(c);
  picked.sort((a, b) => a.a - b.a);

  return picked.map(c => {
    const [title, base] = COPY[c.kind];
    let how = riverDay ? 'Outside is out today, so fish the system instead. ' + base : base;
    if (c.solunar)
      how +=
        ' The moon is overhead or underfoot inside this window — if you only get one session, take this one.';
    const inWin = zone.hours.filter(h => h.t >= c.a && h.t < c.b);
    const bar = inWin.length ? Math.max(...inWin.map(h => h.bar)) : 0;
    const swell = inWin.length ? Math.max(...inWin.map(h => h.swell)) : 0;
    return {
      a: c.a,
      b: c.b,
      hrs: Math.round(((c.b - c.a) / HOUR) * 10) / 10,
      title,
      how,
      where,
      bar,
      kind: c.kind,
      tide: tidePhaseAt(new Date((+c.a + +c.b) / 2), day.tides),
      marks: riverDay ? [] : marksFor(marks, zone.z.id, c.kind, swell)
    };
  });
}

export function techniques(day) {
  const m = SEASON[day.d0.getMonth()],
    mods = [];
  if (day.range != null && day.range > 2.6)
    mods.push(
      'Big tides and a lot of water moving. Heavier jig heads, fish the last of the run-out at the mouths, and get the pots in.'
    );
  if (day.range != null && day.range < 1.6)
    mods.push(
      'Neaps — less run and cleaner water outside. Good day to go wide, sit on a mark and work plastics and live baits.'
    );
  if (day.rain > 4)
    mods.push(
      'Rain about, so the rivers will colour up. Switch to scent — mullet fillet, prawn, live bait — and fish the edge where dirty meets clean.'
    );
  if (day.presTrend < -2)
    mods.push('Barometer falling ahead of a change, which is often the best bite of the week. Go early.');
  if (day.presTrend > 2.5)
    mods.push(
      'Barometer climbing behind a change. Fish deeper, slow the retrieve right down, expect a shorter window.'
    );
  if (day.sst != null && day.sst < 21)
    mods.push(
      'Water around ' +
        day.sst.toFixed(1) +
        '°C and cool. Long pauses, deeper holes, and the middle of the day is no bad shift.'
    );
  if (day.sst != null && day.sst > 25)
    mods.push(
      'Water around ' +
        day.sst.toFixed(1) +
        '°C and warm. Jacks and pelagics are on, and the light changes do the damage.'
    );
  const nf = Math.min(Math.abs(day.moon.phase), Math.abs(day.moon.phase - 0.5), Math.abs(day.moon.phase - 1));
  if (nf < 0.06)
    mods.push(
      'Right on the ' +
        (Math.abs(day.moon.phase - 0.5) < 0.06 ? 'full' : 'new') +
        ' moon — big tides, strong night bite, crabs on the move.'
    );
  return { m, mods };
}

export function launchNotes(zone, cfg) {
  const n = [],
    w = dirOf(zone.wdir);
  if (zone.z.id === 'woodgate' && zone.score >= 48)
    n.push('Walkers Point is the pick today — the top of the bay knocks that ' + w + ' right down.');
  if (zone.swellEffMax > cfg.maxSwell)
    n.push(
      'Swell reaches ' +
        zone.swellMax.toFixed(1) +
        ' m' +
        (zone.period ? ' at ' + Math.round(zone.period) + ' s' : '') +
        ' at its worst, which is over your limit once period is allowed for. Watch the bar and be honest about it.'
    );
  if (zone.chop >= 0.5)
    n.push(
      'Wind chop on top of the swell reaches ' +
        zone.chop.toFixed(1) +
        ' m — expect it lumpier than the swell figure alone suggests.'
    );
  if (['elliott', 'baffle'].includes(zone.z.id))
    n.push('Shallow bar here. Cross on a making tide, never on a big run-out into the wind.');
  if (zone.z.drive >= 11) n.push('That is a fair tow from Bundaberg, so it wants to be worth the drive.');
  return n;
}
