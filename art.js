/**
 * art.js — species illustrations, drawn as inline SVG.
 *
 * Each species is built from a body shape, fins, markings and a palette, so
 * the set stays consistent and nothing has to be downloaded or licensed.
 * Results are cached per species name; drawing happens once per session.
 */
let FID = 0;
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f),
    g = Math.round(((n >> 8) & 255) * f),
    b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};
// spiny dorsal: a row of rays standing proud of the back
function spiky(x0, y0, x1, y1, n, h) {
  let up = 'M' + x0 + ' ' + y0,
    dn = '';
  for (let i = 0; i < n; i++) {
    const t0 = i / n,
      t1 = (i + 0.5) / n,
      t2 = (i + 1) / n;
    const px = x0 + (x1 - x0) * t1,
      py = y0 + (y1 - y0) * t1 - h * (1 - Math.abs(t1 - 0.45) * 1.1);
    const qx = x0 + (x1 - x0) * t2,
      qy = y0 + (y1 - y0) * t2;
    up += ' L' + px.toFixed(1) + ' ' + py.toFixed(1) + ' L' + qx.toFixed(1) + ' ' + qy.toFixed(1);
  }
  return up + ' Z';
}

// Each body is a real silhouette: head slope, body depth, fin shape and tail
// are what tell a snapper from a bream at forty pixels.
const BODY = {
  perch: {
    // snapper, red emperor, mangrove jack — deep, steep forehead
    b: 'M12 29c3-12 12-20 26-22 13-2 26 3 35 11 5 5 9 9 11 11-2 2-6 6-11 11-9 8-22 13-35 11-14-2-23-10-26-22Z',
    t: 'M84 29l15-13-4 13 4 13z',
    d: spiky(31, 10, 60, 7, 5, 9) + 'M60 7c7 1 12 4 16 8l-5 4c-4-4-8-7-13-8z',
    a: 'M46 50c10 4 20 3 28-2l-4-6c-7 4-15 5-23 4z',
    p: 'M42 32c8 2 14 7 17 13-7 2-14-1-19-7z',
    g: 'M31 11c-5 9-5 27 0 36',
    e: [24, 21, 3.2]
  },
  oval: {
    // bream, sweetlip, grunter, blackall — shallower, rounder snout
    b: 'M11 29c4-10 13-17 26-19 13-2 27 3 36 10 5 4 9 8 11 9-2 1-6 5-11 9-9 7-23 12-36 10-13-2-22-9-26-19Z',
    t: 'M84 29l14-11-3 11 3 11z',
    d: spiky(30, 13, 58, 10, 5, 8) + 'M58 10c7 1 12 4 15 7l-4 4c-4-3-8-6-12-7z',
    a: 'M46 48c10 3 20 2 28-2l-4-6c-7 4-15 5-23 4z',
    p: 'M41 32c8 2 13 6 16 11-7 2-13 0-18-5z',
    g: 'M30 13c-4 8-4 24 0 32',
    e: [23, 22, 3]
  },
  trout: {
    // coral trout — long oval body, rounded tail
    b: 'M9 29c4-10 14-16 28-17 15-1 30 4 41 11 4 3 7 5 9 6-2 1-5 3-9 6-11 7-26 12-41 11-14-1-24-7-28-17Z',
    t: 'M87 29c5-7 9-10 12-11v22c-3-1-7-4-12-11z',
    d: 'M27 11c15-4 32-2 44 5l-3 4c-11-5-26-7-39-5z',
    a: 'M46 47c10 3 20 2 27-3l-4-3c-6 3-14 4-21 3z',
    p: 'M40 32c6 1 11 4 14 8-5 2-11 1-15-3z',
    g: 'M28 14c-4 8-4 22 0 30',
    lift: 5,
    e: [21, 23, 2.9]
  },
  tusk: {
    // tuskfish — heavy head, thick lips, paddle tail
    b: 'M13 29c2-12 11-19 25-21 14-2 28 3 38 11 4 4 8 7 10 10-2 3-6 6-10 10-10 8-24 13-38 11-14-2-23-9-25-21Z',
    t: 'M85 29c5-7 10-11 13-12v24c-3-1-8-5-13-12z',
    d: 'M32 9c14-4 30-2 41 6l-4 4c-10-6-24-8-36-6z',
    a: 'M46 50c10 3 20 1 27-4l-4-3c-6 4-15 5-22 3z',
    p: 'M44 32c7 1 12 5 15 9-6 2-12 1-16-3z',
    g: 'M33 12c-5 8-5 26 0 34',
    lift: 5,
    e: [26, 21, 3],
    x: '<path d="M13 26c-4 1-6 3-6 4s2 3 6 4z" fill="#f2f6f8" opacity=".5"/>'
  },
  whiting: {
    // whiting — slender, small headed
    b: 'M10 29c7-5 19-8 33-8 16 0 31 3 42 6 4 1 7 2 9 2-2 0-5 1-9 2-11 3-26 6-42 6-14 0-26-3-33-8Z',
    t: 'M92 29l7-9-2 9 2 9z',
    d: spiky(32, 21, 52, 20, 4, 7) + 'M52 20c8 1 14 2 19 4l-2 3c-6-2-11-3-17-4z',
    a: 'M44 37c11 2 23 1 31-1l-2-4c-8 2-18 3-27 2z',
    p: 'M34 31c6 1 10 3 13 7-5 1-11 0-14-3z',
    g: 'M25 21c-3 5-3 11 0 16',
    e: [19, 26, 2.6]
  },
  flathead: {
    // flathead — broad flat head, long taper
    b: 'M4 31c1-9 13-14 28-15 19-1 40 3 54 8 5 2 9 3 11 4-2 1-6 2-11 4-14 4-35 7-54 6-15-1-25-5-27-7Z',
    t: 'M93 31l6-8v17z',
    d: 'M35 21c16-3 34-1 46 3l-2 4c-12-3-29-5-45-3z',
    a: 'M40 45c14 3 30 2 41-1l-2-3c-11 2-25 3-38 1z',
    p: 'M29 36c8 1 14 4 17 9-7 2-14 0-19-4z',
    g: 'M24 24c-3 5-3 13 0 18',
    lift: 5,
    e: [17, 27, 2.6]
  },
  barra: {
    // barramundi — concave snout, humped back, big paddle tail
    b: 'M9 34c2-6 5-11 11-15 6-4 13-8 22-10 12-3 25-1 35 4 8 4 14 9 18 14-5 6-11 11-19 14-11 4-24 5-35 2-9-3-17-7-22-12-4-4-8-7-10-9Z',
    t: 'M85 32c6-10 11-15 15-16v30c-4-1-9-6-15-14z',
    d: spiky(28, 16, 48, 10, 4, 8),
    d2: 'M53 9c9 2 17 7 23 13l-5 4c-6-6-13-10-20-12z',
    a: 'M50 51c10 2 19 0 26-4l-4-6c-7 4-15 6-23 5z',
    p: 'M38 37c8 2 13 6 16 11-7 2-13 0-18-5z',
    g: 'M30 18c-4 9-4 24 0 32',
    e: [20, 26, 3]
  },
  thread: {
    // threadfin and blue salmon — blunt snout, trailing filaments
    b: 'M12 29c3-10 12-17 25-19 14-2 28 2 38 9 5 4 9 8 11 10-2 2-6 6-11 10-10 7-24 11-38 9-13-2-22-9-25-19Z',
    t: 'M85 29l14-12-3 12 3 12z',
    d: 'M31 12c14-4 29-2 40 4l-3 4c-10-4-24-6-36-4z',
    a: 'M45 48c10 3 20 1 27-3l-4-4c-6 4-15 5-22 3z',
    p: 'M38 33c6 1 11 4 14 8-5 2-11 1-15-3z',
    g: 'M30 13c-4 8-4 24 0 32',
    lift: 5,
    e: [24, 24, 3]
  },
  mack: {
    // mackerel — long torpedo, pointed snout, finlets, deep fork
    b: 'M6 29c10-7 26-11 42-11 14 0 26 3 34 6 5 2 8 3 10 5-2 2-5 3-10 5-8 3-20 6-34 6-16 0-32-4-42-11Z',
    t: 'M92 29l7-14-2 14 2 14z',
    d: 'M34 18c13-3 25-3 34-1l-2 5c-9-2-21-2-31-1z',
    a: 'M44 40c12 3 24 2 32-1l-2-4c-8 2-19 3-29 2z',
    p: 'M32 31c7 1 12 4 15 8-6 2-12 1-16-3z',
    g: 'M22 22c-3 5-3 10 0 15',
    lift: 5,
    e: [16, 26, 2.8],
    x: [74, 80, 86]
      .map(
        x =>
          `<path d="M${x} 21l5-3v3z" fill="currentColor" opacity=".8"/><path d="M${x} 37l5 3v-3z" fill="currentColor" opacity=".8"/>`
      )
      .join('')
  },
  tuna: {
    // longtail and mac tuna — deep chest, crescent tail
    b: 'M8 29c8-9 22-14 36-14 13 0 24 4 32 9 5 3 8 5 10 5-2 0-5 2-10 5-8 5-19 9-32 9-14 0-28-5-36-14Z',
    t: 'M84 29c5-11 11-17 15-18-3 6-4 12-4 18s1 12 4 18c-4-1-10-7-15-18z',
    d: 'M37 15c10-2 20-2 28 0l-2 5c-8-2-17-2-25-1z',
    a: 'M45 42c11 2 21 1 28-1l-2-4c-7 2-16 3-24 2z',
    p: 'M34 32c8 1 14 5 17 10-7 2-14 0-19-5z',
    g: 'M24 20c-3 6-3 12 0 18',
    lift: 5,
    e: [17, 26, 3]
  }
};

function marksFor_(kind) {
  const P = [];
  if (kind === 'spots')
    [
      [36, 20],
      [48, 26],
      [58, 19],
      [42, 35],
      [54, 37],
      [66, 27],
      [30, 28],
      [62, 36]
    ].forEach(([x, y]) => P.push(`<circle cx="${x}" cy="${y}" r="2.2" fill="#dff3ff" opacity=".6"/>`));
  if (kind === 'bluespots')
    [
      [34, 19],
      [46, 25],
      [56, 18],
      [40, 34],
      [52, 36],
      [64, 26],
      [30, 27],
      [60, 35],
      [70, 21]
    ].forEach(([x, y]) => P.push(`<circle cx="${x}" cy="${y}" r="1.9" fill="#6fd0f2" opacity=".75"/>`));
  if (kind === 'bars')
    [30, 40, 50, 60, 70].forEach(x =>
      P.push(
        `<path d="M${x} 8c3 8 0 14 0 21s3 13 0 21" stroke="#06202c" stroke-opacity=".28" stroke-width="3.4" fill="none"/>`
      )
    );
  if (kind === 'wavybars')
    [32, 43, 54, 65, 76].forEach(x =>
      P.push(
        `<path d="M${x} 10c4 7-4 12 0 19s-4 12 0 19" stroke="#0a2a38" stroke-opacity=".3" stroke-width="3" fill="none"/>`
      )
    );
  if (kind === 'blotch')
    [
      [38, 24, 4.5],
      [52, 31, 5],
      [64, 24, 4],
      [46, 37, 3.6],
      [72, 32, 3.4]
    ].forEach(([x, y, r]) =>
      P.push(`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.8}" fill="#0a2a38" opacity=".26"/>`)
    );
  if (kind === 'stripes')
    [22, 26, 30].forEach(y =>
      P.push(
        `<path d="M20 ${y}c20-3 45-3 65 1" stroke="#0a2a38" stroke-opacity=".22" stroke-width="2" fill="none"/>`
      )
    );
  if (kind === 'lines')
    [20, 25, 30].forEach((y, i) =>
      P.push(
        `<path d="M16 ${y}c8-2 16-2 24 ${i - 1}" stroke="#6fd0f2" stroke-opacity=".55" stroke-width="1.5" fill="none"/>`
      )
    );
  if (kind === 'speckle')
    for (let i = 0; i < 22; i++) {
      const x = 26 + ((i * 13) % 56),
        y = 14 + ((i * 7) % 30);
      P.push(`<circle cx="${x}" cy="${y}" r="1.1" fill="#04161f" opacity=".3"/>`);
    }
  if (kind === 'caudalspot') P.push('<circle cx="74" cy="24" r="4.5" fill="#04161f" opacity=".3"/>');
  return P.join('');
}

function fishArt(key, col, pale, marks, extra) {
  const B = BODY[key],
    id = 'f' + FID++;
  const x = (B.x || '') + (extra || '');
  return `<svg viewBox="0 0 100 58" aria-hidden="true" style="color:${col}">
   <defs>
     <clipPath id="c${id}"><path d="${B.b}"/></clipPath>
     <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="${col}"/><stop offset=".55" stop-color="${col}"/>
       <stop offset="1" stop-color="${pale}"/></linearGradient>
   </defs>
   <path d="${B.t}" fill="${shade(col, 0.82)}"/>
   <g transform="translate(0,${-(B.lift || 0)})"><path d="${B.d}" fill="${shade(col, 0.72)}"/>
     ${B.d2 ? `<path d="${B.d2}" fill="${shade(col, 0.72)}"/>` : ''}</g>
   <g transform="translate(0,${B.lift || 0})"><path d="${B.a}" fill="${shade(col, 0.75)}"/></g>
   <path d="${B.b}" fill="url(#g${id})"/>
   <g clip-path="url(#c${id})">${marksFor_(marks)}</g>
   ${B.g ? `<path d="${B.g}" stroke="${pale}" stroke-opacity=".45" stroke-width="1.6" fill="none"/>` : ''}
   <path d="${B.p}" fill="${shade(col, 0.88)}" opacity=".9"/>
   ${x}
   <circle cx="${B.e[0]}" cy="${B.e[1]}" r="${B.e[2]}" fill="#04161f"/>
   <circle cx="${B.e[0] + 1}" cy="${B.e[1] - 1}" r="${B.e[2] * 0.34}" fill="#fff" opacity=".85"/>
  </svg>`;
}

function squidArt() {
  const id = 's' + FID++;
  return `<svg viewBox="0 0 100 58" aria-hidden="true">
   <defs><linearGradient id="q${id}" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="#d98ba0"/><stop offset="1" stop-color="#f3ccd6"/></linearGradient></defs>
   <path d="M50 2c7 8 11 18 11 26 0 6-2 10-4 12H43c-2-2-4-6-4-12 0-8 4-18 11-26Z" fill="url(#q${id})"/>
   <path d="M44 8C33 12 26 18 24 24c6-2 13-8 20-13z" fill="#d98ba0" opacity=".75"/>
   <path d="M56 8c11 4 18 10 20 16-6-2-13-8-20-13z" fill="#d98ba0" opacity=".75"/>
   <path d="M41 40h18c0 4-3 6-9 6s-9-2-9-6z" fill="#c0748a"/>
   ${[42, 46, 50, 54, 58].map((x, i) => `<path d="M${x} 45c${(i - 2) * 3} 5 ${(i - 2) * 2} 9 ${(i - 2) * 4} 12" stroke="#d98ba0" stroke-width="2.4" fill="none" stroke-linecap="round"/>`).join('')}
   <path d="M43 45c-7 4-12 8-15 13" stroke="#c0748a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
   <path d="M57 45c7 4 12 8 15 13" stroke="#c0748a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
   ${[14, 20, 26].map(y => `<circle cx="50" cy="${y}" r="1.2" fill="#b2687d" opacity=".5"/>`).join('')}
   <circle cx="45" cy="36" r="2.4" fill="#04161f"/><circle cx="55" cy="36" r="2.4" fill="#04161f"/>
   <circle cx="45.8" cy="35.2" r=".8" fill="#fff" opacity=".8"/>
  </svg>`;
}

function crabArt() {
  const id = 'k' + FID++;
  const dk = '#1c4a3f',
    md = '#2f7d63',
    lt = '#6fae8c';
  return `<svg viewBox="0 0 100 58" aria-hidden="true">
   <defs><linearGradient id="r${id}" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0" stop-color="${md}"/><stop offset=".6" stop-color="${md}"/>
     <stop offset="1" stop-color="${lt}"/></linearGradient></defs>
   ${[0, 1, 2, 3]
     .map(i => {
       const y = 27 + i * 4.2,
         sp = 13 + i * 4,
         dr = 9 + i * 4;
       return `<path d="M38 ${y}c-8 1 -${sp} 3 -${sp + 4} ${dr}" stroke="${dk}" stroke-width="${3.4 - i * 0.45}"
        fill="none" stroke-linecap="round"/>
      <path d="M62 ${y}c8 1 ${sp} 3 ${sp + 4} ${dr}" stroke="${dk}" stroke-width="${3.4 - i * 0.45}"
        fill="none" stroke-linecap="round"/>`;
     })
     .join('')}
   <g fill="${md}" stroke="${dk}" stroke-width="1">
     <path d="M31 24c-6-5-13-9-20-9 2 3 3 6 2 8 5 0 9 2 12 5z"/>
     <path d="M11 15c-4-3-8-4-10-1 3 1 6 3 8 5z"/>
     <path d="M13 21c-4 1-7 3-7 6 3 1 6 0 9-2z"/>
     <path d="M69 24c6-5 13-9 20-9-2 3-3 6-2 8-5 0-9 2-12 5z"/>
     <path d="M89 15c4-3 8-4 10-1-3 1-6 3-8 5z"/>
     <path d="M87 21c4 1 7 3 7 6-3 1-6 0-9-2z"/>
   </g>
   <path d="M50 14c14 0 25 4 30 10 2 2 2 5 0 7-5 7-16 11-30 11s-25-4-30-11c-2-2-2-5 0-7 5-6 16-10 30-10Z"
     fill="url(#r${id})"/>
   <path d="M20 24c4-4 9-6 13-7m34 0c4 1 9 3 13 7" stroke="${dk}" stroke-opacity=".55"
     stroke-width="1.3" fill="none"/>
   ${[
     [26, 22],
     [31, 20],
     [36, 18],
     [64, 18],
     [69, 20],
     [74, 22]
   ]
     .map(([x, y]) => `<path d="M${x} ${y}l2.5 2.5-2.5 1z" fill="${dk}" opacity=".6"/>`)
     .join('')}
   <path d="M34 31c5 3 11 4 16 4s11-1 16-4" stroke="${dk}" stroke-opacity=".28" stroke-width="1.4" fill="none"/>
   <circle cx="44" cy="22" r="2.6" fill="#04161f"/><circle cx="56" cy="22" r="2.6" fill="#04161f"/>
   <circle cx="44.9" cy="21.2" r=".9" fill="#fff" opacity=".8"/>
   <circle cx="56.9" cy="21.2" r=".9" fill="#fff" opacity=".8"/>
  </svg>`;
}

// name → drawing. Order matters: the first match wins.
const SPECIES_ART = [
  [/squid/, () => squidArt()],
  [/crab/, () => crabArt()],
  [/barramundi/, () => fishArt('barra', '#8fb4cb', '#f0f7fb', '')],
  [/mangrove jack/, () => fishArt('perch', '#c0402f', '#e79a7a', 'caudalspot')],
  [/red emperor/, () => fishArt('perch', '#d9503f', '#f3a48c', 'bars')],
  [/snapper/, () => fishArt('perch', '#e08a86', '#f7d3cd', 'bluespots')],
  [/bream/, () => fishArt('oval', '#9fb0bd', '#e8eff4', '')],
  [/sweetlip|emperor/, () => fishArt('oval', '#c8975c', '#f0dcbd', 'lines')],
  [/grunter/, () => fishArt('oval', '#a8b9c6', '#e9f1f6', 'speckle')],
  [/blackall/, () => fishArt('oval', '#6f7b86', '#c3cdd5', 'blotch')],
  [/coral trout/, () => fishArt('trout', '#cf4b3f', '#eb9e8d', 'bluespots')],
  [/tuskfish/, () => fishArt('tusk', '#4e93b8', '#a8d6e8', '')],
  [/whiting/, () => fishArt('whiting', '#ddc98f', '#f6efd8', '')],
  [/flathead/, () => fishArt('flathead', '#8b9b72', '#d5dcc4', 'speckle')],
  [/spanish mackerel/, () => fishArt('mack', '#5f9fc0', '#cfe7f2', 'wavybars')],
  [/spotted mackerel/, () => fishArt('mack', '#6aa9c8', '#d4e9f4', 'spots')],
  [/school mackerel|mackerel/, () => fishArt('mack', '#74b0cc', '#d8ebf5', 'blotch')],
  [/longtail tuna/, () => fishArt('tuna', '#3f7ea6', '#b9dcec', 'stripes')],
  [/mac tuna|tuna/, () => fishArt('tuna', '#48688a', '#b9cde0', 'stripes')],
  [
    /threadfin/,
    () =>
      fishArt(
        'thread',
        '#b7c9d6',
        '#eef5f9',
        '',
        '<path d="M36 34c-7 8-15 14-24 18" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".85"/>' +
          '<path d="M37 35c-5 9-11 16-19 21" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".6"/>'
      )
  ],
  [/blue salmon|salmon/, () => fishArt('thread', '#8fb6ca', '#e2eef5', '')],
  [/cobia/, () => fishArt('mack', '#5c6b74', '#b7c4cc', 'stripes')],
  [/queenfish|trevally/, () => fishArt('oval', '#c8b978', '#eee5c4', '')]
];
const ART_CACHE = new Map(); // species art never changes; draw each once
export function speciesArt(name) {
  if (ART_CACHE.has(name)) return ART_CACHE.get(name);
  const svg = drawSpecies(name);
  ART_CACHE.set(name, svg);
  return svg;
}
function drawSpecies(name) {
  const n = name.toLowerCase();
  const hit = SPECIES_ART.find(([re]) => re.test(n));
  return hit ? hit[1]() : fishArt('oval', '#8fb2c9', '#dce9f1', '');
}
