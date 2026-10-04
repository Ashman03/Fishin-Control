/**
 * astro.js — sun and moon positions, computed on the device.
 *
 * Standard low-precision formulae (after Meeus, and the widely used SunCalc
 * approach). Good to a few minutes for rise, set and transit, which is far
 * finer than the feeding-period windows built on them.
 */
const rad = Math.PI / 180,
  dayMs = 864e5,
  J1970 = 2440588,
  J2000 = 2451545,
  eps = rad * 23.4397;
const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
const RA = (l, b) => Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
const DEC = (l, b) => Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const altitude = (H, phi, dec) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  return { dec: DEC(L, 0), ra: RA(L, 0) };
}
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d),
    M = rad * (134.963 + 13.064993 * d),
    F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M),
    b = rad * 5.128 * Math.sin(F),
    dt = 385001 - 20905 * Math.cos(M);
  return { ra: RA(l, b), dec: DEC(l, b), dist: dt };
}
export function moonIllum(date) {
  const d = toDays(date),
    s = sunCoords(d),
    m = moonCoords(d),
    sd = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const ang = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (ang < 0 ? -1 : 1)) / Math.PI };
}
function moonAlt(date, lat, lon) {
  const lw = rad * -lon,
    phi = rad * lat,
    d = toDays(date),
    c = moonCoords(d),
    H = sidereal(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  return h + (rad * 0.017) / Math.tan(h + (rad * 10.26) / (h / rad + 5.1));
}
export function moonEvents(start, lat, lon) {
  let rise = null,
    set = null,
    over = null,
    under = null,
    prev = null,
    cur = moonAlt(start, lat, lon);
  const step = 6e5;
  for (let t = step; t <= 26 * 36e5; t += step) {
    const dt = new Date(+start + t),
      a = moonAlt(dt, lat, lon);
    // interpolate the horizon crossing inside the 10-minute step
    if (cur < 0 && a >= 0 && !rise) rise = new Date(+dt - (step * a) / (a - cur));
    if (cur > 0 && a <= 0 && !set) set = new Date(+dt - (step * a) / (a - cur));
    if (prev !== null) {
      if (cur > prev && cur > a && !over) over = new Date(+dt - step);
      if (cur < prev && cur < a && !under) under = new Date(+dt - step);
    }
    prev = cur;
    cur = a;
  }
  return { rise, set, over, under };
}
