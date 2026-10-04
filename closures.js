/**
 * closures.js — Queensland closed seasons that apply between Baffle Creek and
 * Walkers Point. Pure: dates in, closures out.
 *
 * Source: DPI Queensland, "Closed seasons in tidal waters", last updated
 * 25 September 2026:
 *   https://www.dpi.qld.gov.au/business-priorities/fisheries/closures/tidal/seasons
 * When the department publishes new coral reef fin fish dates (listed here to
 * 2033), add them to CRFF_DATES. The app warns once the list runs out.
 *
 * Only closures that reach this stretch of coast are listed. Spanish mackerel
 * uses the southern dates (south of 22°S); spanner crab area A covers waters
 * south of 23°S and east of 151°45'E; the coral reef fin fish closure stops at
 * latitude 24°50'S, which falls between Burnett Heads and Elliott Heads.
 */

export const CLOSURES_SOURCE =
  'https://www.dpi.qld.gov.au/business-priorities/fisheries/closures/tidal/seasons';
export const CLOSURES_CHECKED = '2026-09-25';

/** Coral reef fin fish: two 5-day new-moon closures a year, inclusive. */
const CRFF_DATES = {
  2026: [
    ['10-08', '10-12'],
    ['11-06', '11-10']
  ],
  2027: [
    ['10-26', '10-30'],
    ['11-25', '11-29']
  ],
  2028: [
    ['10-15', '10-19'],
    ['11-13', '11-17']
  ],
  2029: [
    ['10-05', '10-09'],
    ['11-03', '11-07']
  ],
  2030: [
    ['10-24', '10-28'],
    ['11-22', '11-26']
  ],
  2031: [
    ['10-13', '10-17'],
    ['11-12', '11-16']
  ],
  2032: [
    ['10-01', '10-05'],
    ['10-31', '11-04']
  ],
  2033: [
    ['10-20', '10-24'],
    ['11-19', '11-23']
  ]
};
export const CRFF_LAST_YEAR = Math.max(...Object.keys(CRFF_DATES).map(Number));

/** 24°50'S. The closure applies north of this line only. */
const CRFF_SOUTH_LIMIT = -(24 + 50 / 60);

/**
 * Each closure: who it covers, where, and when.
 *   species  names as they appear in the seasonal species lists (for badges)
 *   annual   [from, to] as MM-DD, inclusive, may wrap the new year
 *   dated    function(year) → list of [from, to] for year-specific closures
 *   applies  function(zone) → whether this ramp's water is covered
 */
export const CLOSURES = [
  {
    id: 'crff',
    title: 'Coral reef fin fish',
    detail: 'Coral trout, red emperor, cods, tropical snappers and other coral reef fin fish — no take.',
    species: ['Coral trout', 'Red emperor'],
    dated: y => CRFF_DATES[y] || [],
    applies: z => z.mlat > CRFF_SOUTH_LIMIT,
    where: 'north of 24°50′S — Baffle Creek, the Kolan and Burnett Heads, not Elliott Heads or Walkers Point'
  },
  {
    id: 'snapper',
    title: 'Snapper and pearl perch',
    detail: 'Snapper and pearl perch — no take on the east coast.',
    species: ['Snapper'],
    annual: ['07-15', '08-15'],
    applies: () => true
  },
  {
    id: 'spanish',
    title: 'Spanish mackerel',
    detail: 'Spanish mackerel — southern closed season, no take.',
    species: ['Spanish mackerel'],
    annual: [
      ['02-01', '02-21'],
      ['03-01', '03-21']
    ],
    applies: () => true
  },
  {
    id: 'barra',
    title: 'Barramundi',
    detail: 'Barramundi — east coast closed season, no take. Do not target for catch and release either.',
    species: ['Barramundi'],
    annual: ['11-01', '01-31'],
    applies: () => true
  },
  {
    id: 'jewfish',
    title: 'Black jewfish',
    detail: 'Black jewfish — east coast closed season, no take.',
    species: [],
    annual: ['11-01', '01-31'],
    applies: () => true
  },
  {
    id: 'spanner',
    title: 'Spanner crab',
    detail: 'Spanner crab — closed in managed area A, which covers this coast.',
    species: [],
    annual: ['11-01', '12-15'],
    applies: () => true
  }
];

const mmdd = d => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** True if MM-DD `md` falls in [from, to], inclusive, allowing a wrap past 31 December. */
const inRange = (md, [from, to]) => (from <= to ? md >= from && md <= to : md >= from || md <= to);

function ranges(c, year) {
  if (c.dated) return c.dated(year);
  return Array.isArray(c.annual[0]) ? c.annual : [c.annual];
}

/** Closures in force on `date` for the water off `zone`. */
export function activeClosures(date, zone) {
  const md = mmdd(date);
  return CLOSURES.filter(c => c.applies(zone) && ranges(c, date.getFullYear()).some(r => inRange(md, r)));
}

/**
 * Closures starting within `days` after `date` (not already in force).
 * Returns [{ closure, starts }].
 */
export function upcomingClosures(date, zone, days = 14) {
  const out = [];
  const active = new Set(activeClosures(date, zone).map(c => c.id));
  for (let i = 1; i <= days; i++) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + i);
    for (const c of activeClosures(d, zone)) {
      if (!active.has(c.id) && !out.some(x => x.closure.id === c.id)) out.push({ closure: c, starts: d });
    }
  }
  return out;
}

/** Species names closed on `date` at `zone`, for marking the "what's biting" list. */
export function closedSpecies(date, zone) {
  return new Set(activeClosures(date, zone).flatMap(c => c.species));
}

/** True once the published coral reef fin fish dates no longer cover `date`. */
export const closureDatesStale = date => date.getFullYear() > CRFF_LAST_YEAR;
