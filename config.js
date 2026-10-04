/**
 * config.js — everything you might want to change, and nothing else.
 *
 * Three kinds of setting live here:
 *   1. The user's limits (DEFAULTS) — overridable from the Limits panel.
 *   2. Model tuning (TUNING) — weights and thresholds that shape the scores.
 *   3. Data sources (MODELS) — every upstream model ID in one place, so when
 *      Open-Meteo renames something there is exactly one line to fix.
 *
 * The ramps and their offshore sample points are also defined here, because
 * moving a sample point changes the forecast as surely as changing a weight.
 */

export const APP_VERSION = '4.7';
export const TZ = 'Australia/Brisbane';

/** The user's go / no-go limits. Swell is swell height, as BOM reports it. */
export const DEFAULTS = Object.freeze({ maxSwell: 0.7, maxWind: 10, maxGust: 12 });

/**
 * Every number that shapes a score. Anything not here is a physical constant
 * or a layout value. The hard go / no-go gate does NOT use these weights — it
 * compares raw wind, raw gust and period-weighted swell against DEFAULTS.
 */
export const TUNING = Object.freeze({
  // soft score used to rank hours and ramps (0–100)
  weightSwell: 0.4,
  weightWind: 0.34,
  weightGust: 0.26,
  swellGood: 0.22,
  swellBad: 1.35, // metres: full marks below, zero above
  windGood: 5,
  windBad: 20, // knots
  gustGood: 8,
  gustBad: 26, // knots
  breachCap: 46, // an hour outside the limits can score no higher
  // Ranking only: an offshore wind leaves the water flatter close in, so a
  // ramp in the lee ranks a little higher. Never applied to the hard gate.
  leeRankBonus: 0.12,
  onshoreArc: 70, // degrees either side of the run-out bearing

  // day score
  topHours: 5,
  targetGoodHours: 6,
  windowFloor: 0.55,
  minWindowHours: 2,

  // confidence guards: caps applied to the overall score
  ensembleTrusted: 70, // at or above this % of runs, the ensemble outranks the three-model spread
  capNoWaves: 55,
  capLowAgreement: 74,
  capLowProbability: 62,
  lowProbability: 35,

  // agreement thresholds between independent models
  agreeHighWind: 3,
  agreeFairWind: 6,
  agreeHighSwell: 0.2,
  agreeFairSwell: 0.4,

  // bite score
  biteBase: 52,
  biteMoon: 14,
  biteMoonNear: 7,
  biteQuarter: -5,
  biteFalling: 9,
  biteRising: -7,
  biteBigTide: 6,
  biteNeap: -3,
  biteShower: 4,
  biteWet: -4,
  logNudgeMax: 6,

  // bar risk: tide run in metres per hour
  barRunning: 0.1,
  barHard: 0.22,
  barWind: 12,
  barSwell: 0.6,

  // network
  fetchTimeoutMs: 15000,
  pastDays: 2,
  forecastDays: 7
});

/**
 * Upstream model IDs. Verified against Open-Meteo's documentation; when a
 * model is renamed upstream, change it here and nowhere else.
 *   primary forecast/marine: Open-Meteo "best match" (no models param)
 *   windCheck / waveCheck:   independent runs used only to measure agreement
 *   ensemble:                perturbed members behind the probability figure
 */
export const MODELS = Object.freeze({
  windCheck: ['ecmwf_ifs', 'gfs_seamless', 'icon_seamless'],
  waveCheck: ['ecmwf_wam', 'ncep_gfswave025', 'meteofrance_wave'],
  waveFallback: 'ncep_gfswave025',
  ensemble: ['ecmwf_ifs025_ensemble', 'ncep_gefs_seamless']
});

/**
 * Launch points, north to south.
 *   mlat/mlon  the ramp itself (map pin, directions link)
 *   out        compass bearing you run out on; sample points sit along it
 *   exposed    compass arc of onshore wind for the ramp (ranking only)
 *   barF       how unforgiving the bar is (1 = shallow and nasty, 0.45 = trained)
 *   shelterF   applied ONLY if this ramp's wave data had to be borrowed from a
 *              neighbouring grid cell, e.g. inside the bay where wave models
 *              do not resolve the coastline
 *   bom        which BOM coastal waters zone covers it
 */
export const ZONES = [
  {
    id: 'baffle',
    name: 'Baffle Creek',
    ramp: 'Winfield ramp, Baffle Creek',
    mlat: -24.499,
    mlon: 152.042,
    out: 60,
    exposed: [30, 140],
    barF: 1,
    shelterF: 1,
    drive: 7,
    bom: 'capricornia',
    grounds:
      'Northern limit of your range. The creek system first, then 5–15 km out off Rules Beach. The bar wants swell under a metre and plenty of water under you.'
  },
  {
    id: 'miara',
    name: 'Kolan River / Miara',
    ramp: 'Miara boat ramp',
    mlat: -24.65,
    mlon: 152.16,
    out: 45,
    exposed: [20, 130],
    barF: 1,
    shelterF: 1,
    drive: 3,
    bom: 'capricornia',
    grounds: 'River, the flats out the front, and the close reefs 6–14 km north-east.'
  },
  {
    id: 'burnett',
    name: 'Burnett Heads',
    ramp: 'Burnett Heads / Port Bundaberg ramp',
    mlat: -24.76,
    mlon: 152.41,
    out: 45,
    exposed: [20, 140],
    barF: 0.45,
    shelterF: 1,
    drive: 0,
    bom: 'capricornia',
    grounds:
      'All-tide ramp and deep water. The Leads, the inshore reefs off Bargara 3–8 km, the 4 and 6 mile, and wider ground out to your 20 km line.'
  },
  {
    id: 'elliott',
    name: 'Elliott Heads',
    ramp: 'Elliott Heads boat ramp',
    mlat: -24.926,
    mlon: 152.49,
    out: 70,
    exposed: [30, 150],
    barF: 1,
    shelterF: 1,
    drive: 0,
    bom: 'herveyBay',
    grounds:
      'Close reefs and rubble 4–12 km out plus the artificial reef ground. Shallow bar — making tide only, and only with the swell well down.'
  },
  {
    id: 'woodgate',
    name: 'Walkers Point / Woodgate',
    ramp: 'Walkers Point ramp, Gregory River',
    mlat: -25.123,
    mlon: 152.56,
    out: 67.5,
    exposed: [0, 140],
    barF: 0.8,
    shelterF: 0.6,
    drive: 9,
    bom: 'herveyBay',
    grounds:
      'Southern limit of your range. Run out east-north-east off the front of Woodgate — flats, wrecks and close bay ground 5–20 km. Loses most of the south-east swell.'
  }
];

/** The zone whose points supply tide, pressure and the ensemble reference. */
export const REFERENCE_ZONE = 'burnett';

/**
 * Sample points. Each ramp is sampled along its run-out bearing; the 10, 15
 * and 20 km points decide go / no-go, the 2 km point feeds rain, pressure and
 * the river score, and the 10 km point feeds the tide curve (the tide model
 * is ~8 km resolution and least reliable right against the coast).
 */
export const OFFSETS_KM = [2, 10, 15, 20];

function destination(lat, lon, bearingDeg, km) {
  const R = 111.32,
    t = (bearingDeg * Math.PI) / 180;
  return [lat + (km * Math.cos(t)) / R, lon + (km * Math.sin(t)) / (R * Math.cos((lat * Math.PI) / 180))];
}

export const POINTS = [];
for (const z of ZONES) {
  z.pts = OFFSETS_KM.map(km => {
    const [lat, lon] = destination(z.mlat, z.mlon, z.out, km);
    POINTS.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3), zone: z.id, km });
    return POINTS.length - 1;
  });
  z.ptInshore = z.pts[0]; // 2 km
  z.ptTide = z.pts[1]; // 10 km
  z.ptMid = z.pts[2]; // 15 km
  z.ptOut = z.pts.slice(1); // 10, 15, 20 km
}

export const BOM_ZONES = {
  capricornia: ['BOM Capricornia Coast', 'https://www.bom.gov.au/qld/forecasts/capricornia-coast.shtml'],
  herveyBay: ['BOM Hervey Bay Waters', 'https://www.bom.gov.au/qld/forecasts/hervey-bay-waters.shtml']
};

export const SOURCES = [
  ['BOM Capricornia Coast', BOM_ZONES.capricornia[1]],
  ['BOM Hervey Bay Waters', BOM_ZONES.herveyBay[1]],
  [
    'BOM all southern zones',
    'https://www.bom.gov.au/marine/lite/forecast/south-queensland-coastal-waters.shtml'
  ],
  ['BOM radar', 'https://www.bom.gov.au/australia/radar/'],
  ['Windy', 'https://www.windy.com/-Waves-waves?waves,-24.800,152.400,9'],
  ['MSQ tide tables', 'https://www.msq.qld.gov.au/Tides/Tide-tables'],
  [
    'Willyweather Burnett Heads',
    'https://tides.willyweather.com.au/qld/wide-bay-and-burnett/burnett-heads.html'
  ],
  ['Seabreeze Bundaberg', 'https://www.seabreeze.com.au/weather/wind-forecast/bundaberg'],
  ['Tackle World Bundaberg', 'https://tackleworldbundy.com.au/'],
  ['Fishing report (Bundaberg Now)', 'https://www.bundabergnow.com/?s=fishing+report'],
  [
    'QLD size and possession limits',
    'https://www.qld.gov.au/recreation/activities/boating-fishing/rec-fishing/rules/limits-tidal'
  ],
  ['Marine safety', 'https://www.msq.qld.gov.au/Safety']
];

export const ESTUARIES = [
  {
    name: 'Baffle Creek',
    z: 'baffle',
    d: 'Deep bends, rock bars and mangrove drains. The best system in the region when it blows.'
  },
  { name: 'Kolan River', z: 'miara', d: 'Mouth on the run-out, then the long weed and rubble edges inside.' },
  {
    name: 'Burnett River',
    z: 'burnett',
    d: 'Rock bars, the gravel beds up from the yacht club, the Bird Bay weed edges and the port walls.'
  },
  {
    name: 'Elliott River',
    z: 'elliott',
    d: 'Snags and drop-offs on the run-out, sand flats up top on the run-in.'
  },
  {
    name: 'Gregory River',
    z: 'woodgate',
    d: 'Timber and rock bars up from Walkers Point, and the flats out front on the run-in.'
  }
];

export const SEASON = {
  0: {
    t: 'Peak summer',
    sp: [
      'Mangrove jack',
      'Threadfin',
      'Grunter',
      'Spanish mackerel',
      'Spotted mackerel',
      'Coral trout',
      'Red emperor',
      'Whiting',
      'Mud crab'
    ],
    bait: ['Live poddy mullet and herring', 'Fresh prawn', 'Whole pilchard and gar', 'Squid strips'],
    lure: [
      '3–5" paddle tails on 1/4–3/8 oz',
      'Topwater walkers at first light',
      'Trolled deep hardbodies along the snags',
      'Flasha spoons and slugs for mackerel'
    ],
    note: 'Barramundi are closed until 1 February. Hot and humid, so first and last light do most of the work.'
  },
  1: {
    t: 'Late wet',
    sp: ['Barramundi', 'Mangrove jack', 'Threadfin', 'Grunter', 'Mud crab', 'Spanish mackerel'],
    bait: ['Live mullet', 'Fresh prawn', 'Mullet fillet'],
    lure: ['Paddle tails', 'Suspending hardbodies', 'Vibes along the ledges'],
    note: 'Run-off colours the rivers. Fish the clean and dirty line and the mouths on the run-out. Crabs move hard after rain.'
  },
  2: {
    t: 'Warm and wet',
    sp: ['Barramundi', 'Mangrove jack', 'Threadfin', 'Grunter', 'Spanish mackerel', 'Coral trout'],
    bait: ['Live baits', 'Fresh prawn', 'Gar for trolling'],
    lure: ['Plastics', 'Trolled hardbodies', 'Stickbaits over bait schools'],
    note: 'Best month of the year for a big spanish close in, if you get a calm window.'
  },
  3: {
    t: 'First cool change',
    sp: ['Snapper', 'Grass sweetlip', 'Spanish mackerel', 'Grunter', 'Whiting', 'Flathead'],
    bait: ['Pilchard', 'Squid', 'Live herring'],
    lure: ['Plastics on the inshore reefs', 'Slugs for pelagics'],
    note: 'Water starts cooling and snapper move onto the close reefs on the change of light.'
  },
  4: {
    t: 'Early winter',
    sp: ['Snapper', 'Grass sweetlip', 'Blackall', 'Bream', 'Longtail tuna', 'Squid'],
    bait: ['Pilchard', 'Squid', 'Mullet fillet', 'Live yakkas'],
    lure: ['5" jerk shads', 'Micro jigs', 'Slugs at working birds'],
    note: 'Clear water and light westerlies — prime for plastics on the inshore reefs.'
  },
  5: {
    t: 'Winter',
    sp: ['Snapper', 'Bream', 'Blackall', 'Tuskfish', 'Longtail tuna', 'Mac tuna', 'Squid'],
    bait: ['Whole pilchard', 'Squid', 'Mullet fillet'],
    lure: ['Plastics', 'Micro jigs', 'Small slugs and stickbaits for tuna'],
    note: 'Coldest water of the year. Slow everything down and fish the top and the bottom of the tide.'
  },
  6: {
    t: 'Deep winter',
    sp: ['Snapper', 'Bream', 'Blackall', 'Flathead', 'School mackerel', 'Longtail tuna'],
    bait: ['Pilchard', 'Squid', 'Prawn'],
    lure: ['Plastics', 'Blades and vibes in the rivers'],
    note: 'Rivers fish well in the middle of the day once the sun has warmed the flats.'
  },
  7: {
    t: 'Late winter',
    sp: ['Flathead', 'Whiting', 'Snapper', 'Blackall', 'School mackerel', 'Squid'],
    bait: ['Live worms and yabbies', 'Pilchard', 'Squid'],
    lure: ['Vibes and plastics on the sand drop-offs', 'Surface poppers for whiting'],
    note: 'Flathead school up to spawn. Let the big girls go.'
  },
  8: {
    t: 'Spring warm-up',
    sp: [
      'Flathead',
      'Whiting',
      'Grunter',
      'School mackerel',
      'Spanish mackerel',
      'Coral trout',
      'Blue salmon',
      'Threadfin',
      'Squid',
      'Mud crab'
    ],
    bait: [
      'Live herring and poddy mullet',
      'Yabbies and worms for whiting',
      'Whole pilchard and gar for mackerel'
    ],
    lure: [
      'Vibes and 3" plastics on the sand edges',
      'Surface poppers over the flats on the run-in',
      'Trolled hardbodies and spoons for mackerel'
    ],
    note: 'Everything is waking up. Mackerel and tuna start showing on the close reefs, so watch for working birds.'
  },
  9: {
    t: 'Building',
    sp: ['Spanish mackerel', 'Grunter', 'Grass sweetlip', 'Coral trout', 'Barramundi', 'Mangrove jack'],
    bait: ['Live baits', 'Gar', 'Pilchard'],
    lure: ['Trolled hardbodies', 'Plastics', 'Topwater at dawn'],
    note: 'Check the coral reef fin fish closures around the new moon before you keep trout or reds.'
  },
  10: {
    t: 'Early summer',
    sp: ['Mangrove jack', 'Threadfin', 'Spanish mackerel', 'Grunter', 'Mud crab', 'Grass sweetlip'],
    bait: ['Live mullet', 'Fresh prawn'],
    lure: ['Hardbodies at the snags', 'Paddle tails', 'Slugs for pelagics'],
    note: 'Barramundi close from 1 November. Jacks switch on once the water pushes past about 24°C.'
  },
  11: {
    t: 'Summer',
    sp: [
      'Mangrove jack',
      'Threadfin',
      'Spanish mackerel',
      'Spotted mackerel',
      'Coral trout',
      'Red emperor',
      'Whiting'
    ],
    bait: ['Live baits', 'Fresh prawn', 'Gar'],
    lure: ['Topwater', 'Trolled hardbodies', 'Plastics and jigs on the wider ground'],
    note: 'Take the wide trip on the neaps when the water is clean.'
  }
};

export const DEFAULT_MARKS = [
  { ramp: 'burnett', name: 'The Leads', km: 2, depth: 8, type: 'channel' },
  { ramp: 'burnett', name: 'Bargara inshore reefs', km: 6, depth: 9, type: 'reef' },
  { ramp: 'burnett', name: 'The Four Mile', km: 12, depth: 15, type: 'reef' },
  { ramp: 'burnett', name: 'Burnett rock walls', km: 1, depth: 4, type: 'rock' },
  { ramp: 'elliott', name: 'Elliott artificial reef', km: 6, depth: 12, type: 'reef' },
  { ramp: 'elliott', name: 'Elliott mouth gutters', km: 1, depth: 3, type: 'sand' },
  { ramp: 'elliott', name: 'Close rubble ground', km: 9, depth: 11, type: 'rubble' },
  { ramp: 'baffle', name: 'Baffle deep bends', km: 1, depth: 6, type: 'snags' },
  { ramp: 'baffle', name: 'Rules Beach reef', km: 10, depth: 13, type: 'reef' },
  { ramp: 'baffle', name: 'Bar gutters', km: 2, depth: 3, type: 'sand' },
  { ramp: 'miara', name: 'Kolan mouth flats', km: 1, depth: 2, type: 'flats' },
  { ramp: 'miara', name: 'Close reefs NE', km: 10, depth: 11, type: 'reef' },
  { ramp: 'woodgate', name: 'Woodgate flats', km: 3, depth: 3, type: 'flats' },
  { ramp: 'woodgate', name: 'Bay wrecks', km: 12, depth: 12, type: 'wreck' },
  { ramp: 'woodgate', name: 'Gregory River snags', km: 1, depth: 5, type: 'snags' }
];

export const MARK_TYPES = ['reef', 'rubble', 'wreck', 'rock', 'channel', 'sand', 'flats', 'snags'];

/** Which ground suits which part of the tide and light, best first. */
export const MARK_PREF = {
  dawn: ['flats', 'snags', 'reef', 'sand'],
  high: ['flats', 'snags', 'rock', 'sand'],
  low: ['reef', 'rubble', 'channel', 'rock', 'wreck'],
  dusk: ['reef', 'snags', 'rock', 'flats'],
  run: ['reef', 'wreck', 'rubble', 'channel']
};

export const RATINGS = ['Nothing', 'Slow', 'Steady', 'On fire'];
