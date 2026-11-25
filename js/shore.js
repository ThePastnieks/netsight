// NetSight Shore — the shoreline, drawn by hand
//
// There is no automatic water detection any more. A person draws the bank, and
// the app measures 50 m inward from whatever they drew. That is honest: a
// hand-drawn bank is a decision someone made, not a guess dressed as data.
//
// Three shape kinds, because a bank is rarely one thing:
//
//   polygon  — tap points, straight edges. A river reach, a quay, a basin.
//   circle   — centre and radius. An island, a pond, a mooring ring.
//   freehand — drag to trace. A natural bank with no straight edges anywhere.
//
// Each shape is a closed area of water. The permitted zone is that area offset
// inward by CONFIG.DEVICES.minShoreMetres, and it is drawn as the red line.

const Shore = (function() {
  'use strict';

  const STORE_KEY = 'netsight_shore';

  const KINDS = {
    polygon: 'Polygon',
    circle: 'Circle',
    freehand: 'Freehand'
  };

  let shapes = null;

  // ---------------------------------------------------------------- storage

  function read() {
    if (shapes) return shapes;

    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          shapes = parsed;
          return shapes;
        }
      }
    } catch (err) {
      console.warn('Could not read shore shapes:', err);
    }

    shapes = [];
    return shapes;
  }

  function write(list) {
    shapes = list;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Could not save shore shapes:', err);
    }
  }

  function all() {
    return read().map(s => Object.assign({}, s));
  }

  function get(id) {
    return read().find(s => s.id === id) || null;
  }

  function add(shape) {
    const list = read();

    const clean = normalise(shape);
    if (!clean) return { ok: false, message: 'That shape is not usable' };

    clean.id = clean.id || 'shore-' + Date.now().toString(36);
    clean.createdAt = new Date().toISOString();

    list.push(clean);
    write(list);

    return { ok: true, shape: clean };
  }

  function update(id, patch) {
    const list = read();
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return { ok: false, message: 'No such shape' };

    const merged = normalise(Object.assign({}, list[idx], patch, { id }));
    if (!merged) return { ok: false, message: 'That shape is not usable' };

    merged.createdAt = list[idx].createdAt;
    list[idx] = merged;
    write(list);

    return { ok: true, shape: merged };
  }

  function remove(id) {
    const list = read();
    const next = list.filter(s => s.id !== id);
    if (next.length === list.length) return false;
    write(next);
    return true;
  }

  function clear() {
    write([]);
  }

  function count() {
    return read().length;
  }

  // ------------------------------------------------------------ validation

  function normalise(shape) {
    if (!shape || !KINDS[shape.kind]) return null;

    const name = String(shape.name || '').trim().slice(0, 60) || KINDS[shape.kind];

    if (shape.kind === 'circle') {
      const lat = Number(shape.lat);
      const lon = Number(shape.lon);
      const radius = Number(shape.radius);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      if (!Number.isFinite(radius) || radius < 10) return null;

      return { id: shape.id, kind: 'circle', name, lat, lon, radius: Math.round(radius) };
    }

    const coords = Array.isArray(shape.coords)
      ? shape.coords
          .filter(p => Array.isArray(p) && p.length === 2)
          .map(p => [Number(p[0]), Number(p[1])])
          .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : [];

    // a closed area needs at least a triangle
    if (coords.length < 3) return null;

    // close it if the caller left it open
    const first = coords[0], last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);

    if (Math.abs(area(coords)) < 1e-9) return null;

    return { id: shape.id, kind: shape.kind, name, coords };
  }

  // -------------------------------------------------------------- geometry

  function area(coords) {
    let a = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      a += coords[j][1] * coords[i][0] - coords[i][1] * coords[j][0];
    }
    return a / 2;
  }

  function pointInPolygon(lat, lon, coords) {
    let inside = false;

    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const yi = coords[i][0], xi = coords[i][1];
      const yj = coords[j][0], xj = coords[j][1];

      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }

    return inside;
  }

  // Distance in metres from a point to the nearest edge of a shape.
  function distanceToShape(lat, lon, shape) {
    if (shape.kind === 'circle') {
      const toCentre = haversine(lat, lon, shape.lat, shape.lon);
      return Math.abs(toCentre - shape.radius);
    }

    return distanceToEdge(lat, lon, shape.coords);
  }

  function distanceToEdge(lat, lon, coords) {
    let min = Infinity;

    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const d = distanceToSegment(lat, lon, coords[j][0], coords[j][1], coords[i][0], coords[i][1]);
      if (d < min) min = d;
    }

    return Number.isFinite(min) ? min : 0;
  }

  function distanceToSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    const mPerLat = 111320;
    const mPerLon = 111320 * Math.cos(pLat * Math.PI / 180);

    const px = (pLon - aLon) * mPerLon;
    const py = (pLat - aLat) * mPerLat;
    const bx = (bLon - aLon) * mPerLon;
    const by = (bLat - aLat) * mPerLat;

    const len2 = bx * bx + by * by;
    if (len2 === 0) return Math.hypot(px, py);

    let t = (px * bx + py * by) / len2;
    t = Math.max(0, Math.min(1, t));

    return Math.hypot(px - t * bx, py - t * by);
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ------------------------------------------------------------- the offset
  //
  // The permitted zone is the drawn bank moved inward by `metres`. For a circle
  // that is simply a smaller circle; for a polygon it is a miter offset.
  //
  // Shapes are worked in a local metre plane so a metre is a metre, and sharp
  // corners are capped so they cannot shoot off to infinity.

  function offsetInward(coords, metres) {
    if (!Array.isArray(coords) || coords.length < 4) return [];

    // Drop an explicit closing point. A repeated first/last vertex would give
    // the first corner a zero-length incoming edge, and its normal would then
    // be meaningless — which is exactly how an offset ends up sitting on the
    // line it was meant to be 50 m inside.
    const ring = coords.slice();
    const a0 = ring[0], aN = ring[ring.length - 1];
    if (a0[0] === aN[0] && a0[1] === aN[1]) ring.pop();

    if (ring.length < 3) return [];

    const latRef = ring.reduce((sum, c) => sum + c[0], 0) / ring.length;
    const mPerLat = 111320;
    const mPerLon = 111320 * Math.cos(latRef * Math.PI / 180);

    const pts = ring.map(c => ({ x: c[1] * mPerLon, y: c[0] * mPerLat }));

    // Shoelace sign tells us which side is interior. Positive area means the
    // ring runs counterclockwise, so the inside is to the left of travel.
    let signed = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      signed += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    const flip = signed >= 0 ? 1 : -1;

    const n = pts.length;
    const out = [];

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];

      const a = inwardNormal(prev, cur, flip);
      const b = inwardNormal(cur, next, flip);

      let bx = a.x + b.x;
      let by = a.y + b.y;
      const len = Math.hypot(bx, by);

      if (len < 1e-9) {
        out.push(cur);
        continue;
      }

      bx /= len;
      by /= len;

      const cos = bx * a.x + by * a.y;
      const scale = cos < 0.25 ? 4 : 1 / cos;

      out.push({ x: cur.x + bx * metres * scale, y: cur.y + by * metres * scale });
    }

    // close the result so callers can treat it as a ring
    const closed = out.map(p => [p.y / mPerLat, p.x / mPerLon]);
    closed.push(closed[0].slice());
    return closed;
  }

  function inwardNormal(a, b, flip) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    return { x: -dy * flip, y: dx * flip };
  }

  // The permitted shape for one drawn shape. Null when the offset collapses —
  // a pond narrower than twice the limit has no legal interior at all, and
  // saying so is better than drawing a line through the middle of it.
  function permittedOf(shape, metres) {
    const limit = Number.isFinite(metres) ? metres : CONFIG.DEVICES.minShoreMetres;

    if (shape.kind === 'circle') {
      const radius = shape.radius - limit;
      if (radius < 5) return null;
      return { kind: 'circle', lat: shape.lat, lon: shape.lon, radius };
    }

    const coords = offsetInward(shape.coords, limit);
    if (coords.length < 4) return null;

    // An offset that flipped inside out means the shape is thinner than the
    // limit. Detect it by area: the offset cannot be bigger than the original.
    const before = Math.abs(area(shape.coords));
    const after = Math.abs(area(coords));
    if (after >= before) return null;

    return { kind: 'polygon', coords };
  }

  // Every permitted area, paired with the shape it came from.
  function permittedAreas() {
    const limit = CONFIG.DEVICES.minShoreMetres;

    return read()
      .map(shape => {
        const zone = permittedOf(shape, limit);
        return zone ? Object.assign({ source: shape.id, name: shape.name }, zone) : null;
      })
      .filter(Boolean);
  }

  // ------------------------------------------------------------- the check

  function checkGeofence(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { allowed: false, onWater: false, shoreDistance: null, reason: 'No coordinates' };
    }

    const list = read();

    if (!list.length) {
      return {
        allowed: true,
        onWater: null,
        shoreDistance: null,
        reason: 'No shoreline drawn yet'
      };
    }

    const limit = CONFIG.DEVICES.minShoreMetres;

    // Inside any drawn water?
    let onWater = false;
    let nearest = Infinity;
    let inZone = false;

    for (const shape of list) {
      const inside = shape.kind === 'circle'
        ? haversine(lat, lon, shape.lat, shape.lon) <= shape.radius
        : pointInPolygon(lat, lon, shape.coords);

      if (!inside) continue;

      onWater = true;
      nearest = Math.min(nearest, distanceToShape(lat, lon, shape));

      const zone = permittedOf(shape, limit);
      if (!zone) continue;

      const inThisZone = zone.kind === 'circle'
        ? haversine(lat, lon, zone.lat, zone.lon) <= zone.radius
        : pointInPolygon(lat, lon, zone.coords);

      if (inThisZone) inZone = true;
    }

    if (!onWater) {
      return {
        allowed: false,
        onWater: false,
        shoreDistance: null,
        reason: 'Not on the drawn water'
      };
    }

    if (!inZone) {
      return {
        allowed: false,
        onWater: true,
        shoreDistance: nearest,
        reason: `${Math.round(nearest)} m from shore — at least ${limit} m required`
      };
    }

    return {
      allowed: true,
      onWater: true,
      shoreDistance: nearest,
      reason: `${Math.round(nearest)} m from shore`
    };
  }

  return {
    KINDS,
    all,
    get,
    add,
    update,
    remove,
    clear,
    count,
    permittedOf,
    permittedAreas,
    offsetInward,
    checkGeofence,
    distanceToShape,
    distanceToEdge,
    pointInPolygon,
    area,
    haversine
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Shore;
} else {
  window.Shore = Shore;
}
