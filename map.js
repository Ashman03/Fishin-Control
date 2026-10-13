/**
 * map.js — the go / no-go chart of the coast.
 *
 * Coastline: GSHHG full resolution (Wessel & Smith, GNU LGPL), clipped to
 * this stretch of coast and simplified to about 50 m, so river mouths and
 * headlands read properly. Stored as whole 1/10 000ths of a degree, each
 * point as the step from the one before, which keeps it to ~5 KB.
 *
 * Projection: plain latitude / longitude with longitude squeezed for the
 * latitude, so a kilometre is the same length across and down the chart and
 * range rings are true circles of true size.
 *
 * Depth contours are deliberately absent: no open inshore bathymetry exists at
 * a usable resolution, and wrong depth lines are worse than none. The pale band
 * along the shore is styling, not a depth claim.
 */
import { POINTS, ZONES } from './config.js';
import { light, esc } from './util.js';

const LAND_ENC = [
  '-243001,1519588,-24,0,-67,33,-17,-1,-41,34,-17,0,-25,25,-34,0,-8,9,-58,8,-58,25,-25,0,-59,25,-24,0,-34,17,-16,17,-68,7,-58,25,-24,0,-42,26,-83,8,-34,25,-50,7,-25,17,-41,9,-34,17,-17,0,-41,25,-142,41,-166,84,-13,-4,0,-17,12,-13,58,-25,38,-62,21,-21,29,-12,-12,-13,-54,37,-17,43,-12,12,-17,0,-16,-17,-5,30,-55,37,-15,0,-26,-17,-24,34,-92,16,-13,13,0,25,-50,41,13,4,16,-16,34,-9,41,-33,34,0,50,-34,29,5,0,16,-13,13,-50,17,-41,33,-42,8,-92,42,-67,50,-33,8,-99,59,-34,8,-59,42,-16,0,-50,25,-25,24,-8,0,-71,71,0,9,-63,54,-17,-16,-29,-5,-4,-54,-16,25,-21,-4,-9,-51,-25,-7,1,-42,8,-8,-31,-11,-36,11,-8,8,0,41,8,9,9,41,24,26,0,16,-25,17,0,75,21,21,17,0,8,8,38,-38,4,-29,21,13,4,13,16,-9,5,21,-71,63,-17,8,-33,0,-50,24,-17,0,-33,25,-17,1,-16,16,-17,0,-25,17,-42,42,-158,108,-59,59,-8,0,-46,46,-21,45,-33,-8,-4,-13,12,-12,9,8,13,-4,24,-50,42,-41,4,-30,-16,0,-5,30,-37,37,-17,0,-13,12,1,17,-55,37,-41,50,-17,1,-42,-34,-58,9,-33,-26,-41,0,-9,9,-25,0,-25,25,-34,0,0,8,50,0,42,-16,25,32,84,-7,25,33,33,17,24,-9,59,-58,25,-8,12,11,-103,105,-34,8,-33,34,-25,8,-42,42,-83,58,-146,146,0,9,-59,66,-24,50,0,17,-17,25,-8,50,-34,58,-54,46,-17,8,-12,-12,13,-13,24,-8,30,-38,-13,-4,-8,9,-4,-13,41,-51,0,-24,-12,-5,-12,38,-26,17,0,17,-16,25,-58,58,-9,41,-34,17,-8,34,-33,25,-8,41,-30,29,-66,-17,-38,-28,-8,-50,-33,-42,-26,-83,-41,-58,0,-34,-25,-58,-38,-30,-74,9,-13,-13,-21,-46,-8,1,-25,-26,-50,-25,-17,0,-4,5,13,12,33,8,63,71,0,17,24,25,9,67,16,33,0,17,17,24,0,17,-29,29,-25,9,-37,29,45,4,80,-71,-9,-8,0,-25,-17,-17,0,-17,-16,-24,0,-42,-9,-8,13,-21,41,-8,29,37,9,75,17,33,-1,25,9,8,0,34,8,9,0,99,50,108,13,13,12,-4,-16,-24,0,-34,-9,-9,5,-21,16,0,58,42,59,17,21,20,0,42,-42,51,0,32,-33,50,3,5,22,-4,25,-42,0,-33,50,-42,8,-33,34,-34,8,-24,25,-25,12,-30,21,13,0,25,-84,125,0,17,-16,15,-8,26,-42,50,-8,25,-25,25,0,8,-63,63,-83,50,-21,29,-34,25,0,9,-66,74,-25,50,-12,4,-17,25,-9,0,-4,14,-25,23,-8,26,-42,50,-16,34,0,24,-17,17,-17,33,-8,42,-34,50,-8,41,-16,34,0,25,-8,8,-1,34,-12,3,-4,-37,8,-8,0,-34,9,-8,24,-91,25,-42,-4,-13,-21,21,0,17,-25,25,0,50,-33,33,8,42,-16,25,0,34,-9,7,17,9,0,17,-8,8,-8,50,-17,17,-9,41,-8,9,0,133,-9,9,9,50,-8,8,0,25,-13,12,-12,-4,-9,-50,-8,-9,0,-66,-21,-29,-12,4,16,25,9,125,8,8,0,17,25,25,-17,25,0,17,26,33,0,133,-22,21,-41,8,-21,-21,9,-16,-5,-4,-16,-9,-34,1,-58,-34,-67,0,-50,25,-33,42,-17,8,-42,0,-16,17,-17,0,-8,8,-159,0,-12,-13,0,-50,16,-33,1,-75,-17,-8,0,-8,-29,-30,-33,-16,-92,0,-17,17,-25,8,-21,20,-8,26,-71,54,-91,0,-13,13,21,13,49,-1,9,8,17,-8,33,0,25,-17,33,-9,92,-82,67,-9,21,21,-8,175,29,30,24,7,92,0,9,8,24,0,9,9,58,0,50,-24,75,0,13,12,-9,25,30,12,20,29,0,16,-17,9,0,8,26,26,0,25,-25,41,0,42,33,50,-45,37,-34,0,-42,33,-33,1,-46,45,-8,34,-9,8,1,17,-22,20,-41,17,-25,34,-50,17,-71,70,-25,84,-21,21,-25,8,-21,20,0,17,-29,12,-50,59,-58,0,-25,-8,-8,8,-26,0,-41,42,-33,8,-42,51,-17,7,-17,-7,-41,0,-101,49,-49,-8,-8,-9,-34,17,-34,0,-24,-25,-13,4,0,-25,-12,-13,-4,13,-21,13,-13,-13,0,-16,-12,-4,-4,12,16,33,30,4,37,30,0,8,-63,4,-41,42,-50,-25,-67,0,-41,25,-67,0,-17,17,-58,0,-17,17,-41,7,-43,-16,-11,-13,0,-17,20,-3,4,-13,-33,-42,0,-16,17,-9,-9,-33,34,-25,0,-17,-4,-4,-26,17,-42,8,-20,-21,-8,-24,-30,-30,-25,-17,-25,0,-25,-24,-41,-9,-17,-41,-4,29,-21,4,-12,13,3,20,51,-8,50,58,67,8,21,21,16,42,0,25,-17,17,0,25,17,32,-4,14,-84,-9,-16,-16,-142,0,-9,-9,-41,8,-33,17,-42,-1,-25,-32,-4,21,-29,21,-25,0,-92,41,-17,0,-124,67,-17,-8,-100,66,-25,25,-17,0,-42,25,-16,0,-26,33,-28,12,-13,22,-17,0,-58,66,-33,8,-50,34,-75,33,-4,21,-13,13,-67,33,-50,50,-8,0,-42,50,-16,8,-17,0,-12,-12,3,-12,22,-5,-1,-58,-45,-38,-25,-8,-21,-29,0,-17,13,-12,41,-9,21,-20,8,-17,-4,-30,-33,42,-17,0,-25,25,-20,4,-1,26,17,24,-4,14,-13,3,17,25,-8,42,53,21,5,20,-29,13,-42,34,-84,16,-83,41,-195,180,0,8,-84,100,-8,25,-33,33,0,18,-50,74,0,17,-42,75,0,26,-25,49,-58,75,-17,50,-30,29,-41,-9,-67,-32,-24,-26,-42,-8,-29,-29,-9,-50,-8,-9,0,-65,25,-59,0,-42,8,-8,1,-84,-9,-8,0,-50,17,-25,8,-42,8,-9,0,-49,-49,-117,0,-42,16,-33,-25,-16,16,-34,1,-66,-17,-34,8,-33,-4,-4,-12,12,0,75,8,25,-17,42,0,25,-12,13,-21,-13,-33,-50,-55,-55,-16,-7,-50,-1,-76,50,-49,-33,-4,5,37,45,50,0,16,-17,26,0,58,25,54,63,17,67,-8,8,0,58,-17,42,0,25,-25,33,0,142,-8,9,0,41,17,16,8,42,8,9,0,50,17,24,0,34,-71,71,-13,4,0,9,-29,28,-25,9,-42,33,-25,0,-12,13,-4,20,-17,9,-33,0,-42,33,-41,8,-9,17,-29,12,-9,34,-16,8,-17,42,-21,21,-20,4,8,-42,-21,-12,-25,-33,-4,20,33,26,-16,74,-13,4,-38,38,0,8,-37,29,-25,1,-4,-13,25,-33,0,-33,9,-18,49,-7,-20,-14,-17,0,-25,18,-42,8,-12,20,0,18,-33,24,29,4,24,-33,13,5,0,16,-25,33,0,17,-8,8,42,59,-1,58,-16,33,-100,117,-8,33,-26,34,1,16,-51,100,0,50,-8,8,-8,75,-21,13,-13,-13,0,-16,-16,0,0,16,20,22,9,0,12,21,-8,107,-8,9,0,66,-9,9,0,25,9,8,0,33,-9,9,0,76,8,8,1,41,-9,8,9,175,-9,8,0,34,9,8,8,75,8,9,0,25,9,8,0,33,8,17,17,0,-9,-16,4,-21,33,41,34,8,25,-8,50,-50,8,0,13,13,0,50,8,16,17,8,0,75,-8,9,-30,104,-58,-33,-84,-1,-32,26,-67,17,-46,37,-16,50,-1,25,-49,84,-1,41,-8,8,8,58,9,9,0,17,-9,8,0,117,9,8,16,108,9,9,0,108,-17,34,-63,54,-83,8,-33,-34,0,-10062,10000,0',
  '-247288,1523741,-17,25,1,25,-100,92,0,9,-71,71,-17,0,-12,-13,-17,-59,-17,-33,-20,-21,-34,0,-79,-54,20,-12,59,33,9,-8,41,0,8,-9,50,-8,5,21,-17,17,12,20,13,-4,-8,-16,20,-13,76,9,37,-38,0,-50,12,-13,9,26,13,-5,-9,-8,0,-58,-17,-26,5,-12,29,21,0,58,16,17',
  '-252888,1529500,17,-8,29,-54,25,0,17,-9,24,17,9,-8,25,0,8,-17,4,4,-8,50,-25,25'
];

/** Land polygons as [[lat, lon], ...], decoded once. */
export const LAND = LAND_ENC.map(s => {
  const n = s.split(',').map(Number),
    out = [];
  let lat = 0,
    lon = 0;
  for (let i = 0; i < n.length; i += 2) {
    lat += n[i];
    lon += n[i + 1];
    out.push([lat / 1e4, lon / 1e4]);
  }
  return out;
});

/* ── Frame and projection ──────────────────────────────────────────────── */

const LON0 = 151.97,
  LON1 = 152.87,
  LAT0 = -24.37,
  LAT1 = -25.24;
const KM_DEG = 111.32;
const SQUEEZE = Math.cos(((LAT0 + LAT1) / 2) * (Math.PI / 180));
export const MAPW = 600;
export const MAPH = Math.round((MAPW * (LAT0 - LAT1)) / ((LON1 - LON0) * SQUEEZE));
const PX_KM = MAPW / ((LON1 - LON0) * SQUEEZE * KM_DEG); // pixels per kilometre, both ways
const mx = lon => ((lon - LON0) / (LON1 - LON0)) * MAPW;
const my = lat => ((lat - LAT0) / (LAT1 - LAT0)) * MAPH;
const f1 = n => n.toFixed(1);

/* ── Static layers, built once ─────────────────────────────────────────── */

// the coastline in chart coordinates, projected once: drawn as a path, and
// used to keep labels off the land
const LAND_XY = LAND.map(poly => poly.map(([lat, lon]) => [mx(lon), my(lat)]));
const LAND_D = LAND_XY.map(
  pts => pts.map(([x, y], i) => (i ? 'L' : 'M') + f1(x) + ' ' + f1(y)).join('') + 'Z'
).join('');

/** Whether a chart point is on land (even-odd ray casting). */
export function onLand(x, y) {
  let inside = false;
  for (const poly of LAND_XY)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i],
        [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** Whether a label's box, with a margin, touches land anywhere (checked on a grid). */
const touchesLand = (x, y, w) => {
  for (let i = 0; i <= 6; i++)
    for (const dy of [-16, -8, 0, 6]) if (onLand(x - 6 + ((w + 12) * i) / 6, y + dy)) return true;
  return false;
};

// faint chart grid every 10 minutes of latitude and longitude
const LATS = [],
  LONS = [];
for (let m = Math.ceil(-LAT0 * 6); m <= -LAT1 * 6; m++) LATS.push(-m / 6);
for (let m = Math.ceil(LON0 * 6); m <= LON1 * 6; m++) LONS.push(m / 6);
const GRID =
  LATS.map(v => `<path d="M0 ${f1(my(v))}H${MAPW}"/>`).join('') +
  LONS.map(v => `<path d="M${f1(mx(v))} 0V${MAPH}"/>`).join('');

// the water you fish: every ramp's 20 km reach (the limits stay in the model, not on the chart)
const RANGE = ZONES.map(
  z => `<circle cx="${f1(mx(z.mlon))}" cy="${f1(my(z.mlat))}" r="${f1(20 * PX_KM)}"/>`
).join('');

/* ── Labels ─────────────────────────────────────────────────────────────
 * No outlined text: labels follow the app's own type — ramp names in Outfit
 * on a pill like the app's tags, small spaced capitals for distances.
 * SVG text can't size its own background, so the pills are sized from
 * Outfit's real advance widths (weight 500, thousandths of an em, for the
 * printable ASCII characters).
 */
const OUTFIT = [
  200, 262, 426, 641, 584, 658, 669, 242, 299, 299, 491, 547, 276, 461, 290, 401, 655, 355, 541, 540, 599,
  545, 562, 522, 548, 562, 271, 269, 547, 547, 547, 506, 737, 702, 622, 683, 740, 590, 566, 772, 712, 267,
  494, 672, 550, 842, 717, 794, 604, 820, 628, 556, 619, 690, 696, 982, 698, 672, 589, 341, 401, 341, 451,
  481, 293, 580, 580, 487, 580, 534, 403, 575, 551, 234, 242, 511, 232, 861, 551, 563, 580, 580, 425, 430,
  378, 517, 510, 754, 509, 518, 451, 326, 282, 326, 547
];
/** Width of `text` set in Outfit at `size`, plus any letter-spacing. */
export const textWidth = (text, size, spacing = 0) =>
  [...String(text)].reduce(
    (w, ch) => w + (OUTFIT[ch.charCodeAt(0) - 32] || 560) * (size / 1000) + spacing,
    0
  ) - (text ? spacing : 0);

/** Small spaced capitals, like the app's section labels. */
const caps = (x, y, text, fill, anchor = 'start', size = 13) =>
  `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" class="caps" fill="${fill}" font-size="${size}">${esc(text.toUpperCase())}</text>`;

const TOWNS = [
  ['Bundaberg', -24.866, 152.348],
  ['Bargara', -24.817, 152.462]
]
  .map(
    ([n, lat, lon]) => `<circle cx="${f1(mx(lon))}" cy="${f1(my(lat))}" r="2.4" fill="#95b8cd"/>
    <text x="${f1(mx(lon) - 7)}" y="${f1(my(lat) + 4.5)}" text-anchor="end" fill="#95b8cd" font-size="12" font-weight="500">${n}</text>`
  )
  .join('');

// compass and 10 km scale, top right over open water
const CX = MAPW - 48,
  CY = 58;
const COMPASS = `<g opacity=".8">
    <circle cx="${CX}" cy="${CY}" r="17" fill="none" stroke="#7ad3f5" stroke-opacity=".35"/>
    <path d="M${CX} ${CY - 15}l5 15h-10z" fill="#7ad3f5"/><path d="M${CX} ${CY + 15}l5 -15h-10z" fill="#7ad3f5" opacity=".3"/>
    ${caps(CX, CY - 23, 'N', '#7ad3f5', 'middle', 12)}
    <path d="M${f1(MAPW - 28 - 10 * PX_KM)} ${CY + 46}h${f1(10 * PX_KM)}" stroke="#7ad3f5" stroke-width="2"/>
    <path d="M${f1(MAPW - 28 - 10 * PX_KM)} ${CY + 41}v10M${MAPW - 28} ${CY + 41}v10" stroke="#7ad3f5" stroke-width="1.4"/>
    ${caps(MAPW - 28 - 5 * PX_KM, CY + 66, '10 km', '#7ad3f5', 'middle', 12)}
  </g>`;

// HUD corner brackets, in keeping with the launch-control look
const B = 22,
  I = 9;
const CORNERS = `<path d="M${I} ${I + B}V${I}H${I + B}M${MAPW - I - B} ${I}H${MAPW - I}V${I + B}M${MAPW - I} ${MAPH - I - B}V${MAPH - I}H${MAPW - I - B}M${I + B} ${MAPH - I}H${I}V${MAPH - I - B}"
    fill="none" stroke="#7ad3f5" stroke-width="2" stroke-opacity=".55"/>`;

const DEFS = `<defs>
      <linearGradient id="mSea" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0d4560"/><stop offset=".55" stop-color="#082c40"/><stop offset="1" stop-color="#041824"/></linearGradient>
      <linearGradient id="mLand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1f4d66"/><stop offset="1" stop-color="#173c51"/></linearGradient>
      <pattern id="mDots" width="9" height="9" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r=".9" fill="#7ad3f5" opacity=".16"/></pattern>
      <filter id="mGlow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6"/></filter>
      <clipPath id="mFrame"><rect width="${MAPW}" height="${MAPH}"/></clipPath>
    </defs>`;

/* ── The chart ─────────────────────────────────────────────────────────── */

/**
 * @param day     a built day
 * @param selId   the selected ramp
 * @param marks   the user's marks; those with a position for the selected
 *                ramp are drawn as ringed dots, unlike the plain forecast
 *                sample points (they never leave the phone)
 * @param infoId  the mark whose details are showing, drawn larger
 */
export function mapSVG(day, selId, marks = [], infoId = null) {
  const sel = day.zones.find(z => z.z.id === selId) || day.zones[0];
  const zc = sel.z;
  const cx = mx(zc.mlon),
    cy = my(zc.mlat);

  // range rings from the selected ramp — true distances, drawn under the land
  const rings = [5, 10, 15, 20]
    .map(
      km => `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(km * PX_KM)}" fill="none" stroke="#7ad3f5"
      stroke-opacity="${km === 20 ? 0.6 : 0.25}" stroke-width="${km === 20 ? 1.5 : 1}" stroke-dasharray="${km === 20 ? '7 5' : '3 6'}"/>`
    )
    .join('');
  // distances just outside each ring: east-south-east, clear of the run-out
  // line and samples, unless that lands on the coast — then east-north-east
  const ringLabels = [10, 20]
    .map(km => {
      const text = km + ' km',
        w = textWidth(text.toUpperCase(), 12, 1.92);
      const spot = [0.42, -0.34]
        .map(s => [cx + km * PX_KM * Math.sqrt(1 - s * s) + 6, cy + km * PX_KM * s + 4])
        .find(([x, y]) => !touchesLand(x, y, w));
      return spot ? caps(spot[0], spot[1], text, '#7ad3f5', 'start', 12) : '';
    })
    .join('');

  // where the forecast is actually sampled for this ramp
  const samples = zc.pts
    .slice(1)
    .map(i => `<circle cx="${f1(mx(POINTS[i].lon))}" cy="${f1(my(POINTS[i].lat))}" r="3" fill="#bde9fb"/>`)
    .join('');

  const dots = marks
    .filter(m => m.ramp === zc.id && m.lat != null && m.lon != null)
    .map(m => {
      const x = f1(mx(m.lon)),
        y = f1(my(m.lat)),
        on = m.id === infoId;
      return `<g class="mk-dot" data-act="markInfo" data-id="${esc(m.id)}" role="button" tabindex="0" aria-label="${esc(m.name)}">
      <circle cx="${x}" cy="${y}" r="11" fill="transparent"/>
      <circle cx="${x}" cy="${y}" r="${on ? 6 : 4.6}" fill="${on ? '#eaf4fb' : '#061420'}" stroke="#eaf4fb" stroke-width="2"/>
      <circle cx="${x}" cy="${y}" r="1.6" fill="${on ? '#061420' : '#eaf4fb'}"/>
    </g>`;
    })
    .join('');

  const pins = day.zones
    .map(z => {
      const x = mx(z.z.mlon),
        y = my(z.z.mlat),
        c = light(z.score),
        on = z.z.id === selId,
        r = on ? 15 : 13,
        name = z.z.name.split(' /')[0].split(' (')[0],
        size = on ? 16 : 15,
        w = textWidth(name, size) * (on ? 1.02 : 1) + 18,
        lx = x + r + 5;
      // a square score marker, and the name on a dark plate with a bar of the
      // ramp's colour down its left edge, like the launch sites list
      return `<g class="pin" data-act="zone" data-z="${z.z.id}" role="button" tabindex="0"
      aria-label="${esc(z.z.name)}, score ${z.score}" style="cursor:pointer">
      <rect x="${f1(x - r - 9)}" y="${f1(y - r - 9)}" width="${(r + 9) * 2}" height="${(r + 9) * 2}" fill="${c}" opacity="${on ? 0.22 : 0.1}"/>
      <rect x="${f1(lx)}" y="${f1(y - 12)}" width="${f1(w)}" height="24" fill="#061420" fill-opacity=".9"/>
      <text x="${f1(lx + 9)}" y="${f1(y + 5.2)}" font-size="${size}" font-weight="${on ? 600 : 500}"
        fill="${on ? '#e9f4fb' : '#bde9fb'}">${esc(name)}</text>
      <rect x="${f1(lx)}" y="${f1(y - 12)}" width="3" height="24" fill="${c}"/>
      <rect x="${f1(x - r)}" y="${f1(y - r)}" width="${r * 2}" height="${r * 2}" fill="${c}"
        stroke="${on ? '#e9f4fb' : '#04121c'}" stroke-width="${on ? 2.4 : 1.8}"/>
      <text x="${f1(x)}" y="${f1(y + 5)}" class="score" text-anchor="middle" font-size="${on ? 15 : 14}" font-weight="700"
        fill="#04121c">${z.score}</text>
    </g>`;
    })
    .join('');

  // role="group", not "img": an image hides its contents from screen readers,
  // and the ramp markers and marks inside are buttons
  return `<svg class="chart-map" viewBox="0 0 ${MAPW} ${MAPH}" role="group" aria-label="Go / no-go by launch point">
    ${DEFS}
    <g clip-path="url(#mFrame)">
      <rect width="${MAPW}" height="${MAPH}" fill="url(#mSea)"/>
      <g stroke="#7ad3f5" stroke-opacity=".07" stroke-width="1">${GRID}</g>
      <g fill="#7ad3f5" opacity=".07">${RANGE}</g>
      ${rings}
      <path d="${LAND_D}" fill="none" stroke="#2c93bd" stroke-width="20" stroke-opacity=".45" filter="url(#mGlow)"/>
      <path d="${LAND_D}" fill="none" stroke="#7ad3f5" stroke-width="5" stroke-opacity=".18"/>
      <path d="${LAND_D}" fill="url(#mLand)"/>
      <path d="${LAND_D}" fill="url(#mDots)"/>
      <path d="${LAND_D}" fill="none" stroke="#9fe2fb" stroke-width="1.3" stroke-opacity=".85" stroke-linejoin="round"/>
      ${TOWNS}
      ${samples}${ringLabels}
      ${COMPASS}
      ${dots}
      ${pins}
    </g>
    ${CORNERS}
  </svg>`;
}
