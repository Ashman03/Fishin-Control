/**
 * importer.js — reads waypoints exported from a Humminbird sounder (DATA.HWR)
 * or any GPX file, and turns them into marks. Pure: bytes or text in, marks
 * out. Nothing leaves the phone; the marks are saved like any other.
 *
 * Humminbird .HWR layout (as documented by GPSBabel's reader, humminbird.cc):
 * a run of big-endian records, each starting with a 4-byte signature.
 *   0x02020024 / 0x02030024  waypoint, 32 bytes:
 *       u16 number, u16 zero, u8 status, u8 icon, u16 depth (cm),
 *       u32 time, i32 east, i32 north, char name[12]
 *   0x03030088               route, 132 bytes (skipped)
 *   anything else            tracks or padding: the waypoints have ended
 * Positions are Mercator on the International 1924 ellipsoid with a
 * geocentric latitude, converted back here exactly as GPSBabel does.
 */
import { ZONES, MARK_TYPES } from './config.js';

const WPT = [0x02020024, 0x02030024];
const RTE = 0x03030088;
const EQ_AXIS = 6378388.0; // International 1924
const EAST_SCALE = 20038297.0; // EQ_AXIS × π
const COS2_AE = 0.9966349016452 ** 2;
const DEG = 180 / Math.PI;

/** Humminbird east / north to latitude and longitude in degrees. */
export function hwrToLatLon(east, north) {
  const geocentric = Math.atan(Math.sinh(north / EQ_AXIS));
  return { lat: Math.atan(Math.tan(geocentric) / COS2_AE) * DEG, lon: (east / EAST_SCALE) * 180 };
}

/** Waypoints from a DATA.HWR file (ArrayBuffer). Throws if it is not one. */
export function parseHWR(buf) {
  const v = new DataView(buf);
  const out = [];
  let o = 0,
    records = 0;
  while (o + 4 <= v.byteLength) {
    const sig = v.getUint32(o);
    if (WPT.includes(sig) && o + 36 <= v.byteLength) {
      records++;
      const r = o + 4;
      const status = v.getUint8(r + 4);
      const depth = v.getUint16(r + 6);
      const { lat, lon } = hwrToLatLon(v.getInt32(r + 12), v.getInt32(r + 16));
      let name = '';
      for (let i = 0; i < 12; i++) {
        const c = v.getUint8(r + 20 + i);
        if (!c) break;
        name += String.fromCharCode(c);
      }
      // 1 permanent, 2 temporary, 3 man overboard; others are unused slots and groups
      if (status >= 1 && status <= 3)
        out.push({ name: name.trim(), lat, lon, depth: depth ? depth / 100 : null });
      o += 36;
    } else if (sig === RTE) {
      records++;
      o += 4 + 132;
    } else break;
  }
  if (!records) throw new Error('This is not a Humminbird waypoint file (DATA.HWR).');
  return out;
}

const decode = s =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** Waypoints from GPX text. Throws if there are none. */
export function parseGPX(text) {
  const out = [];
  for (const m of String(text).matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g)) {
    const lat = +(/\blat\s*=\s*["']([^"']+)["']/.exec(m[1]) || [])[1];
    const lon = +(/\blon\s*=\s*["']([^"']+)["']/.exec(m[1]) || [])[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = decode((/<name>([\s\S]*?)<\/name>/.exec(m[2]) || [, ''])[1]);
    const depthTag = /<(?:\w+:)?depth>([\d.]+)<\/(?:\w+:)?depth>/.exec(m[2]);
    out.push({ name, lat, lon, depth: depthTag ? +depthTag[1] : null });
  }
  if (!out.length) throw new Error('No waypoints found in this GPX file.');
  return out;
}

/** Kilometres between two points (equirectangular: plenty for 20 km). */
export function kmBetween(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(x, lat2 - lat1) * 111.32;
}

/** Nearest ramp and the distance to it. */
export function nearestRamp(lat, lon) {
  let best = null;
  for (const z of ZONES) {
    const km = kmBetween(z.mlat, z.mlon, lat, lon);
    if (!best || km < best.km) best = { z, km };
  }
  return best;
}

/** A ground type guessed from the waypoint's name, reef if nothing fits. */
export function guessType(name) {
  const n = name.toLowerCase();
  const rules = [
    ['wreck', /wreck|barge|hull/],
    ['rubble', /rubble|rubb|gravel/],
    ['rock', /rock|wall|bar\b/],
    ['channel', /chan|lead|drop/],
    ['flats', /flat|bank/],
    ['snags', /snag|tree|timber/],
    ['sand', /sand|gutter|beach/],
    ['reef', /reef|bommie|lump|shoal|patch/]
  ];
  const hit = rules.find(([, rx]) => rx.test(n));
  return hit && MARK_TYPES.includes(hit[0]) ? hit[0] : 'reef';
}

/**
 * Waypoints → marks: each one assigned to its nearest ramp with its real
 * distance. Points more than `maxKm` from every ramp (a lake, another town)
 * are left out, as are exact repeats of marks already saved.
 * Returns { marks, outside, repeats }.
 */
export function toMarks(points, existing = [], maxKm = 25, stamp = Date.now()) {
  const key = m => (m.name || '').toLowerCase() + '@' + (+m.lat).toFixed(4) + ',' + (+m.lon).toFixed(4);
  const have = new Set(existing.filter(m => m.lat != null).map(key));
  const marks = [];
  let outside = 0,
    repeats = 0;
  points.forEach((p, i) => {
    const near = nearestRamp(p.lat, p.lon);
    if (near.km > maxKm) return void outside++;
    const m = {
      id: 'h' + stamp.toString(36) + i,
      name: p.name || 'Mark ' + (i + 1),
      ramp: near.z.id,
      km: Math.round(near.km * 10) / 10,
      depth: p.depth != null ? Math.round(p.depth) : 0,
      type: guessType(p.name || ''),
      lat: +p.lat.toFixed(5),
      lon: +p.lon.toFixed(5),
      imported: true
    };
    if (have.has(key(m))) return void repeats++;
    have.add(key(m));
    marks.push(m);
  });
  return { marks, outside, repeats };
}

/** The closest mark with a position within `maxKm` of a point, or null. */
export function nearestMark(lat, lon, marks, maxKm = 2) {
  let best = null;
  for (const m of marks) {
    if (m.lat == null || m.lon == null) continue;
    const km = kmBetween(lat, lon, m.lat, m.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { mark: m, km };
  }
  return best && best.mark;
}
