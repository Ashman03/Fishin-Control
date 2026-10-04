/**
 * art.js — species illustrations in a flat, side-on style.
 *
 * Every fish is built the same way, which is what keeps the set consistent:
 *   1. fins that attach to the body are drawn first, BEHIND it, so only their
 *      outer edges show and they meet the body cleanly
 *   2. the body: a smooth outline through measured profile points
 *   3. flat tone bands (darker back, lighter belly) clipped to the body
 *   4. markings (scale crescents, spots, bars) clipped to the body
 *   5. fins that lie ON the body (pectoral), gill cover, mouth, eye
 * No gradients. All fish face right, nose near x = 110, tail to the left,
 * on a 120 × 64 canvas.
 *
 * To add a species: give it top and bottom profile points (tail end first),
 * a palette, and its fins. The helpers place fins along the body outline.
 */

/* ── geometry ───────────────────────────────────────────────────────────── */

const f1 = n => Math.round(n * 10) / 10;
const pt = ([x, y]) => f1(x) + ' ' + f1(y);

/** Catmull-Rom through points, as cubic Bézier segments (no initial M). */
function spline(p, tension = 1) {
  let d = '';
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i],
      b = p[i],
      c = p[i + 1],
      e = p[i + 2] || c;
    const k = tension / 6;
    d += ` C${pt([b[0] + (c[0] - a[0]) * k, b[1] + (c[1] - a[1]) * k])} ${pt([c[0] - (e[0] - b[0]) * k, c[1] - (e[1] - b[1]) * k])} ${pt(c)}`;
  }
  return d;
}

/** Closed smooth shape through points. */
function blob(p, tension = 1) {
  const n = p.length,
    w = i => p[(i + n) % n];
  let d = 'M' + pt(p[0]);
  for (let i = 0; i < n; i++) {
    const a = w(i - 1),
      b = w(i),
      c = w(i + 1),
      e = w(i + 2),
      k = tension / 6;
    d += ` C${pt([b[0] + (c[0] - a[0]) * k, b[1] + (c[1] - a[1]) * k])} ${pt([c[0] - (e[0] - b[0]) * k, c[1] - (e[1] - b[1]) * k])} ${pt(c)}`;
  }
  return d + 'Z';
}

const poly = p => 'M' + p.map(pt).join(' L') + 'Z';

/** y on a polyline of [x, y] points at a given x (points ordered by x either way). */
function yAt(points, x) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (x <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++)
    if (x <= p[i][0]) {
      const [x0, y0] = p[i - 1],
        [x1, y1] = p[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return p[p.length - 1][1];
}

/* ── parts ──────────────────────────────────────────────────────────────── */

/**
 * Tail, attached at the peduncle and reaching left.
 *   fork     classic V            lunate  thin swept sickle (tuna, mackerel)
 *   truncate square, slight dip   round   fan (barra, jack, tuskfish)
 */
function tail(f) {
  const t = f.tail,
    [px, yT] = f.top[0],
    yB = f.bottom[f.bottom.length - 1][1];
  const cy = (yT + yB) / 2,
    L = t.len,
    S = t.spread,
    x = px + 3;
  if (t.type === 'fork' || t.type === 'lunate') {
    const notch = t.type === 'lunate' ? 0.82 : t.notch || 0.58;
    const tipY1 = yT - S,
      tipY2 = yB + S,
      tipX = px - L;
    const bow = t.type === 'lunate' ? 0.55 : 0.3;
    return (
      `M${pt([x, yT])} Q${pt([px - L * bow, yT - S * 0.35])} ${pt([tipX, tipY1])}` +
      ` Q${pt([px - L * notch * 0.9, cy - S * 0.25])} ${pt([px - L * notch, cy])}` +
      ` Q${pt([px - L * notch * 0.9, cy + S * 0.25])} ${pt([tipX, tipY2])}` +
      ` Q${pt([px - L * bow, yB + S * 0.35])} ${pt([x, yB])}Z`
    );
  }
  if (t.type === 'truncate')
    return (
      `M${pt([x, yT])} Q${pt([px - L * 0.5, yT - S * 0.5])} ${pt([px - L, yT - S])}` +
      ` Q${pt([px - L * 0.88, cy])} ${pt([px - L, yB + S])}` +
      ` Q${pt([px - L * 0.5, yB + S * 0.5])} ${pt([x, yB])}Z`
    );
  // round fan
  return blob(
    [
      [x, yT],
      [px - L * 0.45, yT - S * 0.85],
      [px - L, cy - S * 0.55],
      [px - L * 1.04, cy],
      [px - L, cy + S * 0.55],
      [px - L * 0.45, yB + S * 0.85],
      [x, yB]
    ],
    0.9
  );
}

/** Thin ray lines across a fin, from its base towards its edge. */
function rays(base, edge, n, colour) {
  let d = '';
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const b = [base[0][0] + (base[1][0] - base[0][0]) * t, base[0][1] + (base[1][1] - base[0][1]) * t];
    const e = [edge[0][0] + (edge[1][0] - edge[0][0]) * t, edge[0][1] + (edge[1][1] - edge[0][1]) * t];
    const m = [b[0] + (e[0] - b[0]) * 0.86, b[1] + (e[1] - b[1]) * 0.86];
    d += `M${pt(b)} L${pt(m)}`;
  }
  return `<path d="${d}" stroke="${colour}" stroke-width=".55" opacity=".45" stroke-linecap="round" fill="none"/>`;
}

/** Linear interpolation across a profile of control values, t in 0..1. */
function profile(values, t) {
  if (values.length === 1) return values[0];
  const p = t * (values.length - 1),
    i = Math.min(values.length - 2, Math.floor(p));
  return values[i] + (values[i + 1] - values[i]) * (p - i);
}

/**
 * A dorsal or anal fin, built ray by ray from the FRONT (nearest the head) to
 * the back, as fins are on a real fish.
 *
 *   front, back   x positions of the first and last ray
 *   n             number of rays; the first `spines` of them are spines
 *   h             height profile front → back (any number of control values)
 *   membrane      how far the membrane rises between spines (0–1, default 0.74)
 *   notch         membrane height at the spine / soft-ray junction (default = membrane)
 *   edge          'round' trailing edge, or 'point' for a sickle fin
 *   spineW        spine thickness (stout spines on bream, the grunter's javelin)
 *
 * Spines are drawn as stiff lines standing just proud of the membrane, which
 * dips between them. Soft rays share one smooth edge.
 */
function fin(f, spec, side, c) {
  const up = side === 'top';
  const edge = x => yAt(up ? f.top : f.bottom, x);
  const out = up ? -1 : 1;
  const base = x => edge(x) - out * 2.6;
  const { front, back, n, spines = 0 } = spec;
  const H = i => profile(spec.h, n > 1 ? i / (n - 1) : 0);
  const xs = Array.from({ length: n }, (_, i) => front + ((back - front) * i) / Math.max(1, n - 1));
  const tip = i => [xs[i], edge(xs[i]) + out * H(i)];
  const dip = spec.membrane ?? 0.86;

  let d = 'M' + pt([front + 1.3, base(front + 1.3)]);
  for (let i = 0; i < spines; i++) {
    d += ' L' + pt(tip(i));
    if (i < n - 1) {
      const k = i === spines - 1 && spines < n ? (spec.notch ?? dip) : dip;
      const xm = (xs[i] + xs[i + 1]) / 2;
      d += ' L' + pt([xm, edge(xm) + out * Math.min(H(i), H(i + 1)) * k]);
    }
  }
  if (spines < n) {
    const soft = xs.slice(spines).map((_, j) => tip(spines + j));
    if (spec.edge !== 'point') {
      const xl = back - 1.4;
      soft.push([xl, edge(xl) + out * H(n - 1) * 0.5]);
    }
    d += ' L' + pt(soft[0]) + (soft.length > 1 ? spline(soft, spec.tension ?? 0.85) : '');
  }
  d += ' L' + pt([back - 1.3, base(back - 1.3)]) + 'Z';

  const spineLines = xs
    .slice(0, spines)
    .map((x, i) => `M${pt([x, base(x)])} L${pt(tip(i))}`)
    .join('');
  const rayLines = xs
    .slice(spines)
    .map((x, j) => {
      if (j % 2) return '';
      const t = tip(spines + j);
      return `M${pt([x, base(x)])} L${pt([x, base(x) + (t[1] - base(x)) * 0.9])}`;
    })
    .join('');
  return (
    `<path d="${d}" fill="${spec.fill || c.fin}"/>` +
    (rayLines
      ? `<path d="${rayLines}" stroke="${c.ray || c.dark}" stroke-width=".45" opacity=".28" fill="none"/>`
      : '') +
    (spineLines
      ? `<path d="${spineLines}" stroke="${spec.spineColour || c.spine || c.dark}" stroke-width="${spec.spineW ?? 0.5}" opacity=".7" fill="none" stroke-linecap="round"/>`
      : '')
  );
}

/**
 * The mouth, drawn as a fine gape line — a thick stroke reads as a cartoon
 * grin. Big-mouthed predators also get the outline of the upper jawbone
 * (maxilla) running back towards the eye, as on a real fish.
 */
function mouth(m, c) {
  if (!m) return '';
  const [tx, ty] = m.tip,
    [ex, ey] = m.end;
  const mid = [(tx + ex) / 2, (ty + ey) / 2 + (m.sag ?? 0.4)];
  let out = `<path d="M${pt(m.tip)} Q${pt(mid)} ${pt(m.end)}" stroke="${c.mouth || c.dark}" stroke-width=".6" fill="none" stroke-linecap="round" opacity=".85"/>`;
  if (m.maxilla) {
    const back = [ex - 0.4, ey - 1.6];
    out += `<path d="M${pt([tx - 1.2, ty - 0.9])} Q${pt([(tx + ex) / 2, ty - 1.4])} ${pt(back)} Q${pt([ex - 1.4, ey - 0.4])} ${pt([ex + 0.4, ey])}" stroke="${c.mouth || c.dark}" stroke-width=".5" fill="none" opacity=".5" stroke-linecap="round"/>`;
  }
  return out;
}

/** Pelvic fin: a small swept blade under the chest. */
function pelvicFin(f, p, fill) {
  const y = yAt(f.bottom, p.x) - 2;
  return `<path d="${blob(
    [
      [p.x + 3, y],
      [p.x - p.len * 0.55, y + p.len * 0.55],
      [p.x - p.len, y + p.len * 0.62],
      [p.x - p.len * 0.5, y + p.len * 0.25],
      [p.x - 2, y]
    ],
    0.8
  )}" fill="${fill}"/>`;
}

/** Pectoral fin lying on the flank just behind the gill, fanning down and back. */
function pectoralFin(p, fill, ray) {
  const { x, y, len, w = 5, droop = 3 } = p;
  const top = [x, y - w / 2],
    bot = [x, y + w / 2];
  const tip = [x - len, y + droop];
  const shape = blob(
    [
      top,
      [x - len * 0.55, y - w * 0.15 + droop * 0.45],
      tip,
      [x - len * 0.78, y + w * 0.55 + droop],
      [x - len * 0.3, y + w * 0.7 + droop * 0.5],
      bot
    ],
    0.85
  );
  return (
    `<path d="${shape}" fill="${fill}"/>` +
    rays(
      [top, bot],
      [
        [tip[0] + 1.5, tip[1] - 0.5],
        [x - len * 0.7, y + w * 0.6 + droop]
      ],
      5,
      ray
    )
  );
}

function finlets(f, xs, fill) {
  return xs
    .map(x => {
      const t = yAt(f.top, x),
        b = yAt(f.bottom, x);
      return `<path d="M${pt([x + 1.3, t + 1])} L${pt([x - 0.9, t - 1.8])} L${pt([x - 1.3, t + 0.6])}Z M${pt([x + 1.3, b - 1])} L${pt([x - 0.9, b + 1.8])} L${pt([x - 1.3, b - 0.6])}Z" fill="${fill}"/>`;
    })
    .join('');
}

/** Crescent scale marks, convex towards the tail, in staggered rows. */
function scales(f, s, colour) {
  const { x0, x1, r = 2.5, gap = 6.2, opacity = 0.32 } = s;
  let d = '';
  let row = 0;
  for (let y = 4; y < 62; y += r * 2.05, row++) {
    for (let x = x0 + (row % 2) * gap * 0.5; x < x1; x += gap) {
      if (y < yAt(f.top, x) + r * 2.2 || y > yAt(f.bottom, x) - r * 2.4) continue;
      d += `M${pt([x, y - r])} A${r} ${r} 0 0 0 ${pt([x, y + r])}`;
    }
  }
  return `<path d="${d}" stroke="${colour}" stroke-width=".75" fill="none" opacity="${opacity}" stroke-linecap="round"/>`;
}

/** The lateral line: a fine pale line following the back, gill to tail. */
function lateralLine(f, colour) {
  const x0 = f.top[0][0] + 2,
    x1 = f.lateral?.x1 ?? f.scales.x1 + 4;
  const pts = [];
  for (let x = x0; x <= x1; x += 6) {
    const t = yAt(f.top, x),
      b = yAt(f.bottom, x);
    pts.push([x, t + (b - t) * (f.lateral?.at ?? 0.3)]);
  }
  return `<path d="M${pt(pts[0])}${spline(pts)}" stroke="${colour}" stroke-width=".7" fill="none" opacity=".45" stroke-linecap="round"/>`;
}

function eye(e) {
  const [x, y, r, iris = '#f0b43c', ring] = e;
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${ring || '#f4ece0'}"/>` +
    `<circle cx="${x}" cy="${y}" r="${f1(r * 0.78)}" fill="${iris}"/>` +
    `<circle cx="${f1(x + r * 0.08)}" cy="${y}" r="${f1(r * 0.46)}" fill="#141414"/>` +
    `<circle cx="${f1(x + r * 0.32)}" cy="${f1(y - r * 0.3)}" r="${f1(r * 0.16)}" fill="#fff" opacity=".85"/>`
  );
}

/* ── assembly ───────────────────────────────────────────────────────────── */

let uid = 0;

function drawFish(f) {
  const id = 'f' + uid++;
  const c = f.colour;
  const body = 'M' + pt(f.top[0]) + spline(f.top, f.tension ?? 1) + spline(f.bottom, f.tension ?? 1) + 'Z';
  const band = (line, below, fill) =>
    `<path d="M${below ? '0 64' : '0 0'} L0 ${f1(line[0][1])} L${pt(line[0])}${spline(line)} L120 ${f1(line[line.length - 1][1])} L120 ${below ? 64 : 0}Z" fill="${fill}"/>`;

  const behind = [
    `<path d="${tail(f)}" fill="${c.tail || c.fin}"/>`,
    f.tail.rays !== false
      ? rays(
          [
            [f.top[0][0] + 1, f.top[0][1]],
            [f.top[0][0] + 1, f.bottom[f.bottom.length - 1][1]]
          ],
          [
            [f.top[0][0] - f.tail.len + 2, f.top[0][1] - f.tail.spread + 2],
            [f.top[0][0] - f.tail.len + 2, f.bottom[f.bottom.length - 1][1] + f.tail.spread - 2]
          ],
          7,
          c.ray || c.dark
        )
      : '',
    ...(f.dorsal || []).map(d => fin(f, d, 'top', c)),
    ...[].concat(f.anal || []).map(a => fin(f, a, 'bottom', c)),
    f.pelvic ? pelvicFin(f, f.pelvic, f.pelvic.fill || c.fin) : '',
    f.finlets ? finlets(f, f.finlets, c.finlet || c.fin) : ''
  ].join('');

  const inside = [
    f.back ? band(f.back, false, c.back) : '',
    f.belly ? band(f.belly, true, c.belly) : '',
    f.head ? `<path d="${f.head}" fill="${c.head}"/>` : '',
    f.scales ? scales(f, f.scales, c.scale || c.dark) : '',
    f.scales && f.lateral !== false ? lateralLine(f, c.lateralLine || '#ffffff') : '',
    f.marks ? f.marks(c) : ''
  ].join('');

  const front = [
    f.pectoral ? pectoralFin(f.pectoral, f.pectoral.fill || c.pec || c.fin, c.ray || c.dark) : '',
    f.gill
      ? `<path d="${f.gill}" stroke="${c.dark}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".8"/>`
      : '',
    mouth(f.mouth, c),
    f.extra ? f.extra(c) : '',
    eye(f.eye)
  ].join('');

  return (
    `<svg viewBox="0 0 120 64" aria-hidden="true"><defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>` +
    behind +
    `<path d="${body}" fill="${c.body}"/>` +
    `<g clip-path="url(#${id})">${inside}</g>` +
    front +
    `</svg>`
  );
}

/* ── species ────────────────────────────────────────────────────────────── */

const dots = (pts, r, fill, op = 1) =>
  pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${op}"/>`).join('');

/** Deterministic scatter so spots stay put between renders. */
function scatter(n, x0, x1, y0, y1, seed) {
  const out = [];
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) out.push([f1(x0 + rnd() * (x1 - x0)), f1(y0 + rnd() * (y1 - y0))]);
  return out;
}

/* Perch-shaped fish share a frame; each species adjusts it. */
const SPECIES = {
  Snapper: {
    top: [
      [26, 28],
      [36, 22],
      [48, 15.5],
      [62, 11],
      [76, 9.5],
      [88, 12],
      [97, 17],
      [103.5, 23.5],
      [108.5, 30],
      [111, 34]
    ],
    bottom: [
      [111, 34],
      [108, 37.5],
      [101, 41.5],
      [89, 46],
      [74, 48.5],
      [58, 47.5],
      [44, 43.5],
      [34, 39],
      [26, 36]
    ],
    back: [
      [20, 30],
      [48, 23],
      [78, 19],
      [100, 25],
      [114, 32]
    ],
    belly: [
      [20, 35],
      [50, 41],
      [80, 43.5],
      [104, 39],
      [114, 37]
    ],
    tail: { type: 'fork', len: 21, spread: 12 },
    dorsal: [
      {
        front: 93,
        back: 47,
        n: 22,
        spines: 12,
        h: [3.5, 6.5, 7.6, 7.4, 7, 6.6, 6.3, 6, 5.8, 5.7, 5.6, 5.6, 6.6, 7.2, 7.3, 7, 6.4, 5.6, 4.6, 3.6, 2.8]
      }
    ],
    anal: { front: 68, back: 48, n: 11, spines: 3, h: [2.5, 4.6, 5.8, 6.8, 7, 6.6, 6, 5.2, 4.2, 3.2] },
    pelvic: { x: 86, len: 10 },
    pectoral: { x: 91, y: 35.5, len: 12, w: 5.5, droop: 3 },
    scales: { x0: 36, x1: 86 },
    gill: 'M95 22 Q89.5 32 94 42.5',
    mouth: { tip: [110.8, 34.4], end: [105, 36.1], sag: 0.6 },
    eye: [101, 27, 3.1, '#e9a93a'],
    colour: {
      body: '#e9867b',
      back: '#d96f66',
      belly: '#f6c5b8',
      fin: '#e07a72',
      tail: '#d86e66',
      dark: '#b4504b',
      ray: '#b4504b',
      scale: '#c05a54'
    },
    marks: c =>
      dots(
        [
          [52, 23],
          [60, 19],
          [68, 22],
          [76, 18],
          [84, 21],
          [57, 29],
          [66, 27],
          [74, 25],
          [82, 26],
          [90, 24],
          [48, 30],
          [62, 34],
          [70, 32],
          [79, 31],
          [87, 30]
        ],
        1.05,
        '#8fe0ff',
        0.95
      )
  },

  Bream: {
    top: [
      [26, 28],
      [38, 22.5],
      [52, 17],
      [66, 14.5],
      [80, 15],
      [92, 18.5],
      [102, 24.5],
      [108, 30],
      [111.5, 33.5]
    ],
    bottom: [
      [111.5, 33.5],
      [108.5, 36.5],
      [100, 40],
      [86, 44],
      [70, 45.5],
      [54, 44],
      [40, 40.5],
      [26, 36]
    ],
    back: [
      [20, 30],
      [50, 24.5],
      [80, 22],
      [104, 28],
      [115, 32]
    ],
    belly: [
      [20, 34.5],
      [52, 39.5],
      [82, 41],
      [106, 37],
      [116, 36]
    ],
    tail: { type: 'fork', len: 20, spread: 11 },
    dorsal: [
      {
        front: 93,
        back: 49,
        n: 22,
        spines: 11,
        spineW: 0.75,
        membrane: 0.78,
        h: [
          4, 7.8, 8.8, 8.6, 8.1, 7.6, 7.1, 6.6, 6.2, 5.8, 5.4, 5.6, 5.7, 5.5, 5.2, 4.9, 4.5, 4.1, 3.6, 3.1,
          2.6
        ]
      }
    ],
    anal: {
      front: 65,
      back: 50,
      n: 11,
      spines: 3,
      spineW: 0.75,
      fill: '#e7c445',
      spineColour: '#b8962a',
      h: [3, 6.2, 5.8, 5.9, 5.8, 5.4, 5, 4.5, 3.9, 3.2, 2.6]
    },
    pelvic: { x: 86, len: 9, fill: '#e7c445' },
    pectoral: { x: 92, y: 35, len: 11, w: 5, droop: 3, fill: '#a9b4b4' },
    scales: { x0: 34, x1: 92 },
    gill: 'M96 24 Q91 32 95.5 40.5',
    mouth: { tip: [111.3, 33.8], end: [107.4, 35.1], sag: 0.3 },
    eye: [102.5, 28.5, 3, '#d7c27a'],
    colour: {
      body: '#c5cfd1',
      back: '#8f9d97',
      belly: '#e7ecec',
      fin: '#9aa6a3',
      tail: '#8d9894',
      dark: '#6f7d79',
      scale: '#8b9895'
    }
  },

  'Grass sweetlip': {
    top: [
      [26, 28.5],
      [38, 23.5],
      [52, 18],
      [66, 15],
      [80, 15.5],
      [92, 18.5],
      [102, 24],
      [108.5, 30.5],
      [112, 34]
    ],
    bottom: [
      [112, 34],
      [109, 37],
      [100, 40.5],
      [86, 44],
      [70, 45],
      [54, 43.5],
      [40, 40],
      [26, 35.5]
    ],
    back: [
      [20, 30],
      [52, 24],
      [82, 22],
      [104, 28],
      [115, 32]
    ],
    belly: [
      [20, 34.5],
      [52, 39.5],
      [82, 41],
      [106, 37.5],
      [116, 37]
    ],
    tail: { type: 'fork', len: 20, spread: 11 },
    dorsal: [
      {
        front: 93,
        back: 50,
        n: 19,
        spines: 10,
        membrane: 0.9,
        h: [3.4, 5, 5.5, 5.6, 5.6, 5.6, 5.5, 5.4, 5.3, 5.2, 5.7, 6.1, 6.2, 6, 5.6, 5, 4.2, 3.4, 2.8]
      }
    ],
    anal: {
      front: 66,
      back: 51,
      n: 11,
      spines: 3,
      membrane: 0.9,
      h: [2.5, 4, 4.6, 5.2, 5.5, 5.4, 5, 4.5, 3.9, 3.3, 2.7]
    },
    pelvic: { x: 86, len: 9 },
    pectoral: { x: 92, y: 35, len: 11, w: 5, droop: 3 },
    scales: { x0: 34, x1: 92 },
    gill: 'M96 24 Q91 32 95.5 40.5',
    mouth: { tip: [112.4, 33.6], end: [107.4, 35.4], sag: 0.4 },
    eye: [101.5, 27.5, 2.9, '#e2a23c'],
    colour: {
      body: '#b8a476',
      back: '#948259',
      belly: '#dccda5',
      fin: '#cf7f55',
      tail: '#c97650',
      dark: '#7b6a47',
      scale: '#8f7e57',
      lip: '#e39a74'
    },
    marks: c =>
      [44, 56, 68, 80]
        .map(
          x =>
            `<path d="M${x} 16 Q${x - 2} 30 ${x - 1} 44" stroke="#8a7650" stroke-width="3.2" opacity=".45" fill="none" stroke-linecap="round"/>`
        )
        .join(''),
    extra: c =>
      `<path d="M112.6 33.4 Q110 31.5 107 32.5 Q109.5 34.2 112.6 33.4Z M112.6 33.8 Q109.5 37.2 106 36.6 Q109 35.4 112.6 33.8Z" fill="${c.lip}"/>`
  },

  Blackall: {
    top: [
      [26, 28.5],
      [36, 23],
      [48, 16.5],
      [62, 12.5],
      [76, 12],
      [88, 14.5],
      [98, 19.5],
      [105.5, 26.5],
      [110.5, 33]
    ],
    bottom: [
      [110.5, 33],
      [107, 37],
      [98, 41.5],
      [84, 45],
      [68, 46],
      [52, 44],
      [38, 40.5],
      [26, 35.5]
    ],
    back: [
      [20, 30],
      [50, 22],
      [80, 19.5],
      [102, 26],
      [114, 31]
    ],
    belly: [
      [20, 34.5],
      [52, 40.5],
      [82, 42],
      [104, 38.5],
      [116, 38]
    ],
    tail: { type: 'truncate', len: 18, spread: 9 },
    dorsal: [
      {
        front: 90,
        back: 44,
        n: 24,
        spines: 10,
        h: [
          4, 6.4, 7, 7.2, 7.2, 7, 6.8, 6.6, 6.4, 6.2, 6.8, 7.4, 7.6, 7.6, 7.4, 7.1, 6.7, 6.2, 5.6, 5, 4.4,
          3.8, 3.2, 2.6
        ]
      }
    ],
    anal: { front: 64, back: 46, n: 10, spines: 3, h: [3, 5, 6, 7, 7.4, 7.2, 6.6, 5.8, 4.8, 3.6] },
    pelvic: { x: 84, len: 9 },
    pectoral: { x: 90, y: 35, len: 11, w: 5, droop: 3 },
    scales: { x0: 34, x1: 88 },
    gill: 'M93 22.5 Q87.5 32 92.5 42',
    mouth: { tip: [111, 32.8], end: [105.6, 34.2], sag: 0.3 },
    eye: [99, 27, 3, '#e3b04a'],
    colour: {
      body: '#8d99a3',
      back: '#6d7a85',
      belly: '#b8c1c7',
      fin: '#75818b',
      tail: '#6e7a84',
      dark: '#4d5862',
      scale: '#5f6b75',
      lip: '#e1d3c3'
    },
    marks: c => dots(scatter(34, 34, 98, 14, 44, 7), 1.35, '#3f4a54', 0.85),
    extra: c =>
      `<path d="M111.2 32.2 Q108 29.6 103.5 31.2 Q107 33.4 111.2 32.2Z M111.2 33.4 Q108 37.6 103 36.6 Q107 34.8 111.2 33.4Z" fill="${c.lip}"/>`
  },

  'Coral trout': {
    top: [
      [24, 29],
      [36, 25],
      [50, 20.5],
      [64, 17.5],
      [78, 17],
      [90, 19],
      [100, 23.5],
      [107, 29],
      [112, 34]
    ],
    bottom: [
      [112, 34],
      [109, 38],
      [100, 41.5],
      [86, 44.5],
      [70, 45],
      [54, 43.5],
      [40, 40],
      [24, 35]
    ],
    back: [
      [18, 30],
      [50, 25],
      [80, 23.5],
      [104, 29],
      [116, 33]
    ],
    belly: [
      [18, 34],
      [50, 39.5],
      [82, 41],
      [106, 38.5],
      [116, 38]
    ],
    tail: { type: 'truncate', len: 17, spread: 9 },
    dorsal: [
      {
        front: 94,
        back: 52,
        n: 19,
        spines: 8,
        membrane: 0.8,
        notch: 0.85,
        h: [2.5, 3.6, 4, 4.1, 4.1, 4, 3.9, 3.9, 5, 6.2, 7, 7.5, 7.6, 7.4, 7, 6.4, 5.6, 4.6, 3.4]
      }
    ],
    anal: { front: 66, back: 52, n: 11, spines: 3, h: [2, 3.5, 4.5, 6, 7, 7.5, 7.6, 7.2, 6.4, 5.2, 3.6] },
    pelvic: { x: 88, len: 10 },
    pectoral: { x: 94, y: 35, len: 11, w: 5.5, droop: 3 },
    gill: 'M97 24 Q91.5 32 96.5 41',
    mouth: { tip: [112.2, 34.3], end: [101.5, 37], sag: 1.1, maxilla: true },
    eye: [104, 29, 2.8, '#7fcde8'],
    colour: {
      body: '#e65a43',
      back: '#d64b37',
      belly: '#f08a6e',
      fin: '#d84d39',
      tail: '#cf4633',
      dark: '#a8352a',
      ray: '#b13a2d'
    },
    marks: c =>
      dots(scatter(62, 30, 108, 19, 44, 31), 0.85, '#1b2a3d', 0.55) +
      dots(scatter(62, 30, 108, 19, 44, 31), 0.62, '#7fe0ff', 1)
  },

  'Red emperor': {
    top: [
      [26, 28],
      [36, 21.5],
      [48, 14],
      [62, 9],
      [76, 8],
      [88, 10.5],
      [97, 15.5],
      [103.5, 22.5],
      [108.5, 30],
      [111, 34]
    ],
    bottom: [
      [111, 34],
      [107.5, 38],
      [99, 42.5],
      [86, 47.5],
      [70, 50],
      [54, 48.5],
      [40, 44],
      [26, 36]
    ],
    back: [
      [20, 30],
      [50, 21],
      [78, 17],
      [100, 23],
      [114, 31]
    ],
    belly: [
      [20, 35],
      [52, 42.5],
      [82, 45.5],
      [104, 40],
      [114, 37]
    ],
    tail: { type: 'fork', len: 21, spread: 12.5 },
    dorsal: [
      {
        front: 93,
        back: 46,
        n: 21,
        spines: 11,
        notch: 0.6,
        h: [4.5, 7, 8, 8.4, 8.4, 8.2, 8, 7.8, 7.6, 7.4, 7.2, 8, 8.6, 8.8, 8.6, 8.2, 7.6, 6.8, 5.8, 4.6, 3.2]
      }
    ],
    anal: { front: 66, back: 48, n: 11, spines: 3, h: [3, 5.5, 6.5, 7.5, 8, 8, 7.6, 7, 6, 4.8, 3.4] },
    pelvic: { x: 84, len: 11 },
    pectoral: { x: 90, y: 36, len: 12, w: 5.5, droop: 3 },
    scales: { x0: 34, x1: 90 },
    gill: 'M94 21 Q88.5 32 93 44',
    mouth: { tip: [110.8, 34.3], end: [104.6, 36], sag: 0.5 },
    eye: [100, 26.5, 3.1, '#e9b04a'],
    colour: {
      body: '#ee9a8e',
      back: '#e2796d',
      belly: '#f7cbc0',
      fin: '#d4564a',
      tail: '#cb4b40',
      dark: '#a3342c',
      ray: '#a3342c',
      scale: '#c0625a',
      band: '#c84a40'
    },
    marks: c =>
      `<path d="M95.5 10 Q90.5 28 99 50 L106 47 Q98 28 101.5 10Z" fill="${c.band}" opacity=".78"/>` +
      `<path d="M74 4 Q67.5 27 74.5 54 L82 54 Q75.5 27 81 4Z" fill="${c.band}" opacity=".78"/>` +
      `<path d="M52 8 Q44 24 26 32.5 L26 38 Q47 29 59 8Z" fill="${c.band}" opacity=".78"/>`
  },

  'Mangrove jack': {
    top: [
      [25, 28.5],
      [36, 23.5],
      [50, 17.5],
      [64, 14],
      [78, 13.5],
      [90, 16],
      [100, 21],
      [107, 27.5],
      [111.5, 33.5]
    ],
    bottom: [
      [111.5, 33.5],
      [108.5, 37.5],
      [100, 41.5],
      [86, 45],
      [70, 46],
      [54, 44.5],
      [40, 40.5],
      [25, 35.5]
    ],
    back: [
      [18, 30],
      [50, 23],
      [80, 20.5],
      [104, 27],
      [116, 32]
    ],
    belly: [
      [18, 34],
      [50, 40],
      [82, 42],
      [106, 38.5],
      [116, 38]
    ],
    tail: { type: 'truncate', len: 18, spread: 9.5 },
    dorsal: [
      {
        front: 94,
        back: 48,
        n: 24,
        spines: 10,
        h: [
          4, 6, 6.6, 7, 7, 6.9, 6.8, 6.6, 6.4, 6.2, 6.6, 7, 7.2, 7.2, 7, 6.7, 6.3, 5.8, 5.3, 4.7, 4.1, 3.5, 3,
          2.5
        ]
      }
    ],
    anal: { front: 66, back: 48, n: 11, spines: 3, h: [3, 5.5, 7, 7.5, 7.8, 7.6, 7.2, 6.6, 5.8, 4.6, 3.2] },
    pelvic: { x: 86, len: 10 },
    pectoral: { x: 93, y: 35.5, len: 11, w: 5.5, droop: 3 },
    scales: { x0: 32, x1: 92 },
    gill: 'M96 23 Q90.5 32 95.5 41.5',
    mouth: { tip: [111.5, 33.8], end: [102.6, 36.4], sag: 0.9, maxilla: true },
    eye: [102.5, 27.5, 3, '#e6a43a'],
    colour: {
      body: '#cd5a3d',
      back: '#b0452d',
      belly: '#e58a64',
      fin: '#be4c33',
      tail: '#b5462e',
      dark: '#8a3220',
      scale: '#9b3a26'
    }
  },

  Grunter: {
    top: [
      [26, 28.5],
      [38, 23.5],
      [52, 18],
      [66, 15],
      [80, 15],
      [92, 17.5],
      [101, 22.5],
      [107, 28.5],
      [110.5, 33.5]
    ],
    bottom: [
      [110.5, 33.5],
      [108, 37],
      [100, 40.5],
      [86, 44],
      [70, 45],
      [54, 43.5],
      [40, 40],
      [26, 35.5]
    ],
    back: [
      [20, 30],
      [52, 24],
      [82, 22],
      [104, 27.5],
      [115, 31]
    ],
    belly: [
      [20, 34.5],
      [52, 39.5],
      [82, 41],
      [106, 37.5],
      [116, 37]
    ],
    tail: { type: 'fork', len: 20, spread: 11 },
    dorsal: [
      {
        front: 93,
        back: 52,
        n: 26,
        spines: 12,
        notch: 0.42,
        h: [
          4, 7.5, 9.5, 10, 9.6, 8.8, 7.8, 6.8, 5.8, 4.8, 4, 3.4, 3.8, 4.2, 4.4, 4.4, 4.3, 4.1, 3.9, 3.7, 3.5,
          3.2, 3, 2.8, 2.6, 2.4
        ]
      }
    ],
    anal: {
      front: 64,
      back: 51,
      n: 10,
      spines: 3,
      spineW: 0.85,
      notch: 0.55,
      h: [2.5, 7.4, 5, 5, 5, 4.8, 4.5, 4.1, 3.6, 3]
    },
    pelvic: { x: 86, len: 9 },
    pectoral: { x: 92, y: 35, len: 11, w: 5, droop: 3 },
    scales: { x0: 34, x1: 92 },
    gill: 'M96 23.5 Q91 32 95.5 40.5',
    mouth: { tip: [110.4, 34.4], end: [107.6, 35.6], sag: 0.3 },
    eye: [102, 28, 2.9, '#dcc890'],
    colour: {
      body: '#c9d1d4',
      back: '#9ea9ae',
      belly: '#e8ecee',
      fin: '#a7b1b5',
      tail: '#9ca7ab',
      dark: '#7b868b',
      scale: '#9aa4a8',
      spot: '#6d5a48'
    },
    marks: c =>
      dots(
        [
          [50, 22],
          [56, 25],
          [62, 21],
          [68, 24],
          [74, 21],
          [80, 24],
          [86, 21],
          [92, 24],
          [53, 29],
          [59, 28],
          [65, 28],
          [71, 27.5],
          [77, 28],
          [83, 27.5],
          [44, 26],
          [47, 31]
        ],
        1.25,
        c.spot,
        0.9
      )
  },

  Tuskfish: {
    top: [
      [24, 29],
      [34, 23],
      [46, 16.5],
      [60, 12],
      [74, 10.5],
      [86, 11.5],
      [95, 13.5],
      [101.5, 18],
      [106.5, 25.5],
      [110.5, 32.5]
    ],
    bottom: [
      [110.5, 32.5],
      [108.5, 37],
      [101, 42],
      [88, 46],
      [72, 47.5],
      [56, 46],
      [42, 42],
      [24, 35]
    ],
    back: [
      [18, 30],
      [50, 22],
      [82, 19],
      [104, 24],
      [116, 31]
    ],
    belly: [
      [18, 34.5],
      [50, 41],
      [82, 43.5],
      [104, 40],
      [116, 38]
    ],
    tail: { type: 'round', len: 16, spread: 7 },
    dorsal: [
      {
        front: 92,
        back: 42,
        n: 20,
        spines: 13,
        membrane: 0.9,
        h: [2.5, 3.4, 3.6, 3.7, 3.7, 3.7, 3.7, 3.7, 3.7, 3.7, 3.7, 3.7, 3.7, 4.2, 4.6, 4.8, 4.8, 4.5, 3.8, 3]
      }
    ],
    anal: {
      front: 66,
      back: 46,
      n: 13,
      spines: 3,
      membrane: 0.9,
      h: [2, 3.2, 3.8, 4.2, 4.5, 4.6, 4.6, 4.5, 4.3, 4, 3.6, 3.1, 2.5]
    },
    pelvic: { x: 88, len: 10 },
    pectoral: { x: 95, y: 35, len: 10, w: 5.5, droop: 3 },
    scales: { x0: 32, x1: 92 },
    gill: 'M98 21 Q92 32 97 43',
    eye: [102.5, 23.5, 2.8, '#e8b84c'],
    colour: {
      body: '#46a6a2',
      back: '#348783',
      belly: '#88cbc0',
      fin: '#2f8794',
      tail: '#2c7f8c',
      dark: '#24686a',
      scale: '#2f7e7a',
      stripe: '#f0a24a',
      tusk: '#fbf6ea'
    },
    marks: c =>
      `<path d="M106 25 Q100 28 96 34" stroke="${c.stripe}" stroke-width="1.3" fill="none" stroke-linecap="round"/>` +
      `<path d="M108.5 31 Q103 33 99 39" stroke="#7fe0ff" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
    extra: c =>
      `<path d="M110.6 32.2 L113.4 31.2 L111 33.4Z M110 34.6 L112.6 35.6 L110.2 36.2Z" fill="${c.tusk}"/>` +
      `<path d="M110.8 33.6 Q108 35.4 104.5 35" stroke="#24686a" stroke-width=".9" fill="none" stroke-linecap="round"/>`
  },

  Barramundi: {
    top: [
      [24, 29.5],
      [36, 25],
      [50, 19],
      [64, 15],
      [76, 14.5],
      [86, 17.5],
      [94, 22.5],
      [100, 25],
      [106, 27],
      [111.5, 29.5]
    ],
    bottom: [
      [111.5, 29.5],
      [110, 33.5],
      [103, 38],
      [90, 42.5],
      [74, 44.5],
      [58, 43.5],
      [44, 40.5],
      [24, 35]
    ],
    back: [
      [18, 31],
      [50, 25],
      [80, 22.5],
      [100, 26.5],
      [116, 29]
    ],
    belly: [
      [18, 34],
      [50, 39],
      [82, 41],
      [104, 36.5],
      [116, 33]
    ],
    tail: { type: 'round', len: 19, spread: 9 },
    dorsal: [
      { front: 88, back: 68, n: 7, spines: 7, membrane: 0.7, h: [5, 9, 10.5, 9.5, 8, 6, 3.5] },
      { front: 66, back: 50, n: 11, spines: 1, h: [5, 6.5, 7.2, 7.2, 7, 6.6, 6.2, 5.6, 4.8, 3.8, 2.8] }
    ],
    anal: { front: 64, back: 52, n: 11, spines: 3, h: [2.5, 4.5, 6, 7, 7.2, 7, 6.6, 6, 5.2, 4.2, 3] },
    pelvic: { x: 88, len: 9 },
    pectoral: { x: 95, y: 33.5, len: 10, w: 5, droop: 3 },
    scales: { x0: 30, x1: 94 },
    gill: 'M98 24 Q93 31 97.5 39.5',
    mouth: { tip: [111.7, 29.6], end: [100.8, 32.6], sag: 0.8, maxilla: true },
    eye: [104.5, 26.5, 2.7, '#ec6a2a'],
    colour: {
      body: '#c4d0cc',
      back: '#8ea596',
      belly: '#e9efec',
      fin: '#8b9a92',
      tail: '#7f8f86',
      dark: '#62746b',
      scale: '#87988f'
    }
  },

  Flathead: {
    tension: 0.9,
    top: [
      [22, 31],
      [34, 29],
      [48, 26],
      [62, 24.5],
      [76, 24.5],
      [88, 25.5],
      [98, 26.5],
      [106, 28.5],
      [112, 31.5]
    ],
    bottom: [
      [112, 31.5],
      [110, 34.5],
      [100, 37],
      [86, 38.5],
      [70, 38.5],
      [54, 37.5],
      [38, 36],
      [22, 34.5]
    ],
    back: [
      [16, 32],
      [50, 29.5],
      [84, 29],
      [106, 31],
      [116, 32]
    ],
    belly: [
      [16, 34.5],
      [50, 35.5],
      [84, 36],
      [106, 34.5],
      [116, 34]
    ],
    tail: { type: 'truncate', len: 15, spread: 6 },
    dorsal: [
      { front: 84, back: 74, n: 8, spines: 8, membrane: 0.7, h: [1.5, 4.5, 5, 4.6, 4, 3.2, 2.4, 1.6] },
      { front: 70, back: 42, n: 13, h: [3, 3.4, 3.5, 3.5, 3.4, 3.3, 3.2, 3.1, 3, 2.9, 2.7, 2.4, 2] }
    ],
    anal: { front: 70, back: 42, n: 13, h: [2.5, 3, 3.1, 3.1, 3, 3, 2.9, 2.8, 2.7, 2.6, 2.4, 2.2, 2] },
    pelvic: { x: 90, len: 8 },
    pectoral: { x: 92, y: 34, len: 10, w: 4.5, droop: 2.5 },
    gill: 'M95 27 Q92 31 94 36',
    mouth: { tip: [112.3, 31.6], end: [98.5, 33.1], sag: 0.6, maxilla: true },
    eye: [101, 27.2, 2.3, '#e3bf5a'],
    colour: {
      body: '#b39d76',
      back: '#8f7a56',
      belly: '#efe2c6',
      fin: '#a68f6a',
      tail: '#9c8562',
      dark: '#6c5a3e',
      spot: '#5e4d34'
    },
    marks: c => dots(scatter(46, 24, 104, 25, 32, 13), 0.9, c.spot, 0.75),
    extra: c =>
      dots(
        [
          [14, 30],
          [12, 34],
          [15, 37],
          [10, 31.5]
        ],
        1.3,
        '#4d3f2a',
        0.85
      )
  },

  Whiting: {
    top: [
      [24, 30],
      [36, 27.5],
      [50, 25],
      [64, 23.5],
      [78, 23.5],
      [90, 25],
      [100, 27.5],
      [107, 30],
      [112, 32.5]
    ],
    bottom: [
      [112, 32.5],
      [110, 34.5],
      [102, 36.5],
      [88, 38.5],
      [72, 39],
      [56, 38],
      [40, 36.5],
      [24, 34]
    ],
    back: [
      [18, 31],
      [50, 28.5],
      [82, 27.5],
      [104, 30],
      [116, 32]
    ],
    belly: [
      [18, 33.5],
      [50, 35.5],
      [82, 36],
      [104, 34.5],
      [116, 34]
    ],
    tail: { type: 'fork', len: 17, spread: 8 },
    dorsal: [
      {
        front: 82,
        back: 68,
        n: 11,
        spines: 11,
        membrane: 0.7,
        h: [3, 5.5, 6, 5.6, 5, 4.4, 3.8, 3.2, 2.6, 2, 1.5]
      },
      {
        front: 66,
        back: 40,
        n: 18,
        spines: 1,
        h: [3.8, 4, 4, 3.9, 3.8, 3.7, 3.6, 3.5, 3.4, 3.3, 3.2, 3.1, 3, 2.9, 2.8, 2.7, 2.5, 2.2]
      }
    ],
    anal: {
      front: 64,
      back: 40,
      n: 18,
      spines: 2,
      fill: '#e3c66a',
      h: [2, 3.4, 3.6, 3.6, 3.5, 3.4, 3.4, 3.3, 3.2, 3.1, 3, 2.9, 2.8, 2.7, 2.6, 2.5, 2.3, 2]
    },
    pelvic: { x: 86, len: 7, fill: '#e3c66a' },
    pectoral: { x: 96, y: 33.5, len: 8, w: 3.8, droop: 2 },
    gill: 'M98 28 Q95.5 32 97.5 36',
    mouth: { tip: [112.1, 32.9], end: [110, 33.7], sag: 0.2 },
    eye: [104, 30.5, 2.2, '#d9c37e'],
    colour: {
      body: '#e1d6b4',
      back: '#c3b386',
      belly: '#f3eee0',
      fin: '#cbbd8d',
      tail: '#c2b384',
      dark: '#9b8c62'
    },
    marks: c =>
      `<path d="M26 32 Q60 30.8 100 31.4" stroke="#f7f3e6" stroke-width="1" opacity=".7" fill="none"/>`
  },

  Threadfin: threadfin({
    body: '#d4c697',
    back: '#aa9a6c',
    belly: '#efe7cd',
    fin: '#8e8c7d',
    tail: '#83826f',
    dark: '#6d6a52',
    thread: '#e4dabb'
  }),
  'Blue salmon': threadfin({
    body: '#bccbd6',
    back: '#7e9bb2',
    belly: '#e8eef2',
    fin: '#d6bf5a',
    tail: '#8aa0b2',
    dark: '#5f7a90',
    thread: '#dfe7ec'
  }),

  'Spanish mackerel': mackerel({
    colour: {
      body: '#c5d6dd',
      back: '#3e8197',
      belly: '#e9f0f2',
      fin: '#2f6274',
      tail: '#2c5b6c',
      dark: '#24505f',
      finlet: '#3a7486',
      bar: '#4f8aa0'
    },
    marks: c =>
      [40, 46, 52, 58, 64, 70, 76, 82, 88]
        .map(
          x =>
            `<path d="M${x} 25 q-1.6 3 0 5.5 t0 5.5" stroke="${c.bar}" stroke-width="1.15" fill="none" stroke-linecap="round" opacity=".9"/>`
        )
        .join('')
  }),
  'Spotted mackerel': mackerel({
    colour: {
      body: '#c8d8de',
      back: '#3b7b92',
      belly: '#ebf1f3',
      fin: '#2d5f71',
      tail: '#2a586a',
      dark: '#234d5c',
      finlet: '#376f82',
      spot: '#3f7085'
    },
    marks: c =>
      dots(
        [
          [38, 28],
          [46, 27.5],
          [54, 27],
          [62, 27],
          [70, 27],
          [78, 27],
          [86, 27.5],
          [42, 32.5],
          [50, 32],
          [58, 32],
          [66, 32],
          [74, 32],
          [82, 32],
          [46, 36.5],
          [56, 36.5],
          [66, 36.5],
          [76, 36.5]
        ],
        1.4,
        c.spot,
        0.9
      )
  }),
  'School mackerel': mackerel({
    deep: 1.08,
    colour: {
      body: '#c9d5da',
      back: '#4a7c8e',
      belly: '#ecf1f2',
      fin: '#36606f',
      tail: '#335b6a',
      dark: '#2a4e5b',
      finlet: '#3f6b7b',
      blotch: '#56798a'
    },
    marks: c =>
      [
        [40, 29],
        [51, 28.4],
        [62, 28.6],
        [73, 28.4],
        [84, 28.8],
        [45.5, 33.6],
        [56.5, 33.8],
        [67.5, 33.6],
        [78.5, 33.8]
      ]
        .map(
          ([x, y], i) =>
            `<path d="${blob(
              [
                [x - 2.6, y - 0.4],
                [x - 0.6, y - 1.9 + (i % 3) * 0.3],
                [x + 2.4, y - 1.1],
                [x + 2.8, y + 0.8],
                [x + 0.4, y + 1.7],
                [x - 2.2, y + 1.2]
              ],
              0.9
            )}" fill="${c.blotch}" opacity=".78"/>`
        )
        .join('')
  }),

  'Longtail tuna': tuna({
    colour: {
      body: '#d6e0e6',
      back: '#24476f',
      belly: '#eef3f6',
      fin: '#1f3d5f',
      tail: '#1d3858',
      dark: '#172f4b',
      finlet: '#c8b45a',
      pec: '#24476f'
    },
    marks: c =>
      [
        [56, 38],
        [62, 39],
        [68, 38.5],
        [74, 39],
        [80, 38]
      ]
        .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.6" ry=".7" fill="#b9c8d2"/>`)
        .join('')
  }),
  'Mac tuna': tuna({
    deep: 1.06,
    firstDorsal: [10.5, 9.5, 7.6, 6, 4.5, 3.4, 2.6, 2, 1.6, 1.3, 1.1, 1],
    colour: {
      body: '#d8e2e8',
      back: '#3b6c8f',
      belly: '#eef3f6',
      fin: '#2d5677',
      tail: '#2a5070',
      dark: '#203f58',
      finlet: '#3b6c8f',
      pec: '#2d5677',
      stripe: '#1e3a52'
    },
    marks: c =>
      [44, 52, 60, 68, 76, 84]
        .map(
          x =>
            `<path d="M${x} 22 q3 3 1 6 t2 5" stroke="${c.stripe}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".9"/>`
        )
        .join('') +
      dots(
        [
          [86, 38],
          [82, 40],
          [88, 41.5],
          [84, 43]
        ],
        0.9,
        '#1e3a52',
        0.85
      )
  })
};

function threadfin(colour) {
  return {
    top: [
      [24, 29],
      [36, 25],
      [50, 20.5],
      [64, 18],
      [78, 18],
      [90, 19.5],
      [100, 23],
      [106.5, 27],
      [110.5, 31]
    ],
    bottom: [
      [110.5, 31],
      [110, 34],
      [104, 38],
      [90, 42],
      [74, 43.5],
      [58, 42.5],
      [42, 39.5],
      [24, 35]
    ],
    back: [
      [18, 30.5],
      [50, 25.5],
      [82, 24.5],
      [104, 28],
      [116, 30]
    ],
    belly: [
      [18, 34.5],
      [50, 38.5],
      [82, 39.5],
      [104, 37],
      [116, 35]
    ],
    tail: { type: 'fork', len: 24, spread: 13, notch: 0.62 },
    dorsal: [
      { front: 86, back: 74, n: 8, spines: 8, membrane: 0.7, h: [5, 8.5, 8, 7, 5.8, 4.4, 3, 1.8] },
      {
        front: 60,
        back: 48,
        n: 13,
        spines: 1,
        edge: 'point',
        h: [5, 8, 7.5, 6, 5, 4.2, 3.6, 3.2, 2.9, 2.7, 2.5, 2.4, 2.2]
      }
    ],
    anal: {
      front: 60,
      back: 46,
      n: 15,
      spines: 2,
      edge: 'point',
      h: [3, 6.5, 7, 5.6, 4.6, 3.9, 3.4, 3, 2.8, 2.6, 2.5, 2.4, 2.3, 2.2, 2]
    },
    pelvic: { x: 84, len: 8 },
    pectoral: { x: 95, y: 34.5, len: 11, w: 4.5, droop: 3 },
    scales: { x0: 32, x1: 92 },
    gill: 'M98 24 Q93 31 97.5 39',
    mouth: { tip: [108.2, 35.6], end: [99.6, 36.6], sag: 0.4, maxilla: true },
    eye: [104.5, 28, 2.8, '#e8e1c4', '#c9c3a8'],
    colour,
    extra: c =>
      [0, 1, 2, 3]
        .map(
          i =>
            `<path d="M${96 - i} ${37.5 + i * 0.6} Q${88 - i * 2} ${44 + i * 1.2} ${76 - i * 3} ${48 + i * 1.6}" stroke="${c.thread}" stroke-width=".8" fill="none" stroke-linecap="round" opacity="${0.95 - i * 0.12}"/>`
        )
        .join('') +
      `<path d="M110.5 31 Q112.5 32 110.5 34" fill="${colour.body}" stroke="${colour.dark}" stroke-width=".5"/>`
  };
}

function mackerel({ colour, marks, deep = 1 }) {
  const d = v => 32 + (v - 32) * deep;
  return {
    top: [
      [22, d(30.5)],
      [34, d(28)],
      [50, d(25)],
      [66, d(23.5)],
      [82, d(24)],
      [94, d(26)],
      [104, d(28.5)],
      [112, d(31.5)],
      [115, 33]
    ],
    bottom: [
      [115, 33],
      [112, d(34.8)],
      [104, d(36.8)],
      [90, d(39)],
      [72, d(40)],
      [54, d(39.5)],
      [38, d(37.5)],
      [22, d(34)]
    ],
    back: [
      [16, d(31.5)],
      [40, d(29.5)],
      [70, d(29)],
      [100, d(30)],
      [118, 32]
    ],
    belly: [
      [16, d(33.5)],
      [40, d(35.5)],
      [70, d(36.5)],
      [100, d(35)],
      [118, 34]
    ],
    tail: { type: 'lunate', len: 14, spread: 10, rays: false },
    dorsal: [
      {
        front: 92,
        back: 64,
        n: 16,
        spines: 16,
        membrane: 0.6,
        h: [3.6, 3.4, 3.2, 3, 2.8, 2.6, 2.4, 2.2, 2, 1.8, 1.6, 1.4, 1.2, 1.1, 1, 0.8]
      },
      { front: 58, back: 49, n: 10, edge: 'point', h: [6, 5.5, 4.4, 3.4, 2.8, 2.4, 2.1, 1.9, 1.7, 1.5] }
    ],
    anal: { front: 57, back: 48, n: 10, edge: 'point', h: [5.5, 5, 4, 3.2, 2.6, 2.2, 2, 1.8, 1.6, 1.4] },
    finlets: [27, 31, 35, 39, 43],
    pectoral: { x: 99, y: 33.5, len: 8, w: 3.6, droop: 1.5 },
    pelvic: { x: 92, len: 5 },
    gill: 'M101 28 Q98.5 32.5 100.5 37',
    mouth: { tip: [114.6, 33.2], end: [107.4, 34.3], sag: 0.25 },
    eye: [107.5, 31, 2.1, '#cfd8dc', '#9fb0b8'],
    colour,
    marks,
    extra: c => `<path d="M20 31 L14 33 L20 35Z" fill="${c.dark}"/>`
  };
}

function tuna({
  colour,
  marks,
  deep = 1,
  firstDorsal = [8, 7.5, 6.5, 5.5, 4.5, 3.6, 3, 2.6, 2.2, 1.8, 1.4, 1.1]
}) {
  const d = v => 32 + (v - 32) * deep;
  return {
    top: [
      [22, d(30.5)],
      [30, d(28.5)],
      [42, d(23)],
      [56, d(18.5)],
      [70, d(17)],
      [84, d(18.5)],
      [96, d(22.5)],
      [105, d(27)],
      [111, 32]
    ],
    bottom: [
      [111, 32],
      [107, d(36)],
      [98, d(40.5)],
      [84, d(44.5)],
      [70, d(45.5)],
      [56, d(44)],
      [42, d(40)],
      [30, d(35.5)],
      [22, d(33.5)]
    ],
    back: [
      [16, d(31)],
      [40, d(27.5)],
      [64, d(28)],
      [90, d(29)],
      [114, 31]
    ],
    belly: [
      [16, d(33)],
      [40, d(36.5)],
      [66, d(38)],
      [92, d(37)],
      [114, 34]
    ],
    tail: { type: 'lunate', len: 17, spread: 14, rays: false },
    dorsal: [
      { front: 88, back: 70, n: 12, spines: 12, membrane: 0.6, h: firstDorsal },
      { front: 64, back: 54, n: 12, edge: 'point', h: [9, 8.5, 6.5, 5, 4, 3.3, 2.8, 2.4, 2.1, 1.8, 1.6, 1.4] }
    ],
    anal: {
      front: 62,
      back: 53,
      n: 12,
      edge: 'point',
      h: [8, 7.5, 6, 4.6, 3.7, 3.1, 2.6, 2.3, 2, 1.8, 1.6, 1.4]
    },
    finlets: [26, 30, 34, 38, 42, 46],
    pectoral: { x: 93, y: 31, len: 16, w: 3.6, droop: -2 },
    pelvic: { x: 88, len: 6 },
    gill: 'M98 25 Q94 32 97 39',
    mouth: { tip: [110.6, 32.4], end: [104.6, 33.8], sag: 0.3 },
    eye: [104, 29.5, 2.5, '#cfd8dc', '#9fb0b8'],
    colour,
    marks,
    extra: c => `<path d="M20 31 L14 32.8 L20 34.6Z" fill="${c.dark}"/>`
  };
}

/* ── the two that are not fish ─────────────────────────────────────────── */

function squidArt() {
  const body = '#edbfb6',
    back = '#dfa098',
    fin = '#e2aaa1',
    dark = '#b5605c',
    spot = '#a24d4b';
  const mantle = 'M30 32 Q34 23 54 22.2 Q72 22 83 27 Q86.5 32 83 37 Q72 42 54 41.8 Q34 41 30 32Z';
  const id = 'sq' + uid++;
  const arms = [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5]
    .map(
      (o, i) =>
        `<path d="M90 ${32 + o * 0.5} Q101 ${32 + o * 0.9} ${109 + (i % 3)} ${32 + o * 1.35}" stroke="${i % 2 ? fin : body}" stroke-width="${2.3 - Math.abs(o) * 0.12}" fill="none" stroke-linecap="round"/>`
    )
    .join('');
  const tentacles =
    `<path d="M90 30.5 Q104 25 114 26.5" stroke="${fin}" stroke-width="1.1" fill="none" stroke-linecap="round"/>` +
    `<path d="M90 33.5 Q104 39 114 37.5" stroke="${fin}" stroke-width="1.1" fill="none" stroke-linecap="round"/>` +
    `<path d="${blob(
      [
        [111, 26.6],
        [114, 25.4],
        [117, 26.4],
        [114, 27.8]
      ],
      0.9
    )}" fill="${fin}"/>` +
    `<path d="${blob(
      [
        [111, 37.4],
        [114, 36.2],
        [117, 37.4],
        [114, 38.6]
      ],
      0.9
    )}" fill="${fin}"/>`;
  return (
    `<svg viewBox="0 0 120 64" aria-hidden="true"><defs><clipPath id="${id}"><path d="${mantle}"/></clipPath></defs>` +
    `<path d="M33 32 L18 18.5 Q16 32 18 45.5Z" fill="${fin}"/>` +
    `<path d="M33 32 L18 18.5 Q16 32 18 45.5Z" fill="none" stroke="${dark}" stroke-width=".5" opacity=".35"/>` +
    arms +
    tentacles +
    `<path d="M80 26.5 Q90 25.5 93 32 Q90 38.5 80 37.5Z" fill="${body}"/>` +
    `<path d="${mantle}" fill="${body}"/>` +
    `<g clip-path="url(#${id})"><path d="M20 20 L120 20 L120 29.5 Q60 27.5 20 30Z" fill="${back}"/>` +
    dots(scatter(46, 32, 82, 23, 39, 5), 0.7, spot, 0.6) +
    `</g>` +
    `<path d="M34 33 Q58 32 82 32.5" stroke="#f8dcd5" stroke-width=".9" fill="none" opacity=".8"/>` +
    eye([87, 30.4, 2.7, '#7aa9bc']) +
    `</svg>`
  );
}

function crabArt() {
  const shell = '#5e7f56',
    rim = '#4b6845',
    light = '#8fae7c',
    arm = '#678858',
    hand = '#729560',
    tip = '#2b3a28',
    leg = '#557450',
    legDark = '#46623f';

  // three walking legs a side, two segments each, thick and tapered
  const legPair = (y, reach, drop) => {
    const one = side => {
      const sx = side < 0 ? 40 : 80,
        k = side;
      const knee = [sx + k * reach * 0.55, y + drop * 0.35];
      const foot = [sx + k * reach, y + drop];
      return (
        `<path d="M${sx} ${y} L${pt(knee)}" stroke="${leg}" stroke-width="4.2" stroke-linecap="round"/>` +
        `<path d="M${pt(knee)} L${pt(foot)}" stroke="${legDark}" stroke-width="3" stroke-linecap="round"/>`
      );
    };
    return one(-1) + one(1);
  };
  const legs = legPair(31, 15, 6) + legPair(35, 16, 9.5) + legPair(39, 14.5, 12);

  // the rear swimming legs end in flat paddles
  const paddle = side => {
    const sx = side < 0 ? 46 : 74,
      k = side;
    return (
      `<path d="M${sx} 43 L${sx + k * 10} 50" stroke="${leg}" stroke-width="3" stroke-linecap="round"/>` +
      `<ellipse cx="${sx + k * 13.5}" cy="53" rx="4.6" ry="2.6" fill="${legDark}" transform="rotate(${k * 38} ${sx + k * 13.5} 53)"/>`
    );
  };

  // the crushers: a heavy arm, a swollen hand, dark-tipped fingers
  const claw = side => {
    const k = side,
      cx = 60 + k * 31;
    const armPath = `M${60 + k * 16} 25 Q${60 + k * 22} 20 ${60 + k * 25} 19`;
    // the hand: big, swollen, ridged
    const handShape = blob(
      [
        [cx - k * 8, 18.5],
        [cx - k * 4, 11],
        [cx + k * 4, 8.5],
        [cx + k * 10, 10.5],
        [cx + k * 10.5, 16],
        [cx + k * 4, 20.5],
        [cx - k * 3, 21.5]
      ],
      0.9
    );
    const fixed = `M${cx + k * 9} 15.5 Q${cx + k * 15} 13.5 ${cx + k * 20} 15.5 Q${cx + k * 15} 17.5 ${cx + k * 9.5} 18Z`;
    const moving = `M${cx + k * 8} 9.5 Q${cx + k * 14} 6 ${cx + k * 20} 9.5 Q${cx + k * 14} 11 ${cx + k * 9} 13Z`;
    const tips = `M${cx + k * 16} 14.6 L${cx + k * 20} 15.5 L${cx + k * 16} 17.2Z M${cx + k * 16} 7.8 L${cx + k * 20} 9.5 L${cx + k * 16} 10.6Z`;
    const teeth = [11, 13, 15].map(d => `M${cx + k * d} 14.4 l${k * 0.8} 1.2 l${k * 0.8} -1.2`).join(' ');
    return (
      `<path d="${armPath}" stroke="${arm}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
      `<path d="${fixed}" fill="${hand}"/><path d="${moving}" fill="${hand}"/><path d="${tips}" fill="${tip}"/>` +
      `<path d="${teeth}" stroke="${tip}" stroke-width=".6" fill="none" opacity=".7"/>` +
      `<path d="${handShape}" fill="${hand}"/>` +
      `<path d="M${cx - k * 4} 14 Q${cx + k * 2} 10.5 ${cx + k * 8} 11.5" stroke="${light}" stroke-width="1.1" fill="none" opacity=".7" stroke-linecap="round"/>` +
      `<path d="M${cx - k * 3} 18.5 Q${cx + k * 3} 16.5 ${cx + k * 9} 16.5" stroke="${rim}" stroke-width=".8" fill="none" opacity=".6"/>`
    );
  };

  // carapace with the nine teeth along each front edge
  const shellPath = blob(
    [
      [38, 28],
      [43, 20.5],
      [60, 17.5],
      [77, 20.5],
      [82, 28],
      [78, 38],
      [68, 44.5],
      [60, 45.5],
      [52, 44.5],
      [42, 38]
    ],
    0.9
  );
  const teeth = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const lx = 54 - t * 15,
      ly = 18.2 + t * 8.5,
      rx = 66 + t * 15;
    teeth.push(`M${f1(lx)} ${f1(ly)} l-1.8 -1.2 l.8 2.4Z`, `M${f1(rx)} ${f1(ly)} l1.8 -1.2 l-.8 2.4Z`);
  }
  return (
    `<svg viewBox="0 0 120 64" aria-hidden="true">` +
    legs +
    paddle(-1) +
    paddle(1) +
    claw(-1) +
    claw(1) +
    `<path d="${teeth.join(' ')}" fill="${rim}"/>` +
    `<path d="${shellPath}" fill="${shell}"/>` +
    `<path d="${blob(
      [
        [46, 27],
        [60, 22.5],
        [74, 27],
        [70, 35],
        [60, 38],
        [50, 35]
      ],
      0.9
    )}" fill="${light}" opacity=".5"/>` +
    `<path d="M52 30 Q60 34 68 30 M60 33 L60 41" stroke="${rim}" stroke-width=".9" fill="none" opacity=".7" stroke-linecap="round"/>` +
    `<path d="M54 18.5 L54.5 15.5 M66 18.5 L65.5 15.5" stroke="${rim}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="54.5" cy="15" r="1.6" fill="${tip}"/><circle cx="65.5" cy="15" r="1.6" fill="${tip}"/>` +
    `<circle cx="54.9" cy="14.6" r=".45" fill="#fff" opacity=".85"/><circle cx="65.9" cy="14.6" r=".45" fill="#fff" opacity=".85"/>` +
    `</svg>`
  );
}

/* ── public ─────────────────────────────────────────────────────────────── */

const CACHE = new Map();

export function speciesArt(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const key = Object.keys(SPECIES).find(k => k.toLowerCase() === name.toLowerCase());
  let svg;
  if (/squid/i.test(name)) svg = squidArt();
  else if (/crab/i.test(name)) svg = crabArt();
  else svg = drawFish(SPECIES[key] || SPECIES.Bream);
  CACHE.set(name, svg);
  return svg;
}

export const SPECIES_NAMES = [...Object.keys(SPECIES), 'Squid', 'Mud crab'];

/** True if the species has its own drawing rather than the fallback. */
export const hasArt = name =>
  /squid|crab/i.test(name) || Object.keys(SPECIES).some(k => k.toLowerCase() === name.toLowerCase());
