// NetSight — registered gear.
//
// A fisherman registers a net before he sets it: a short code, what it is, and
// where it lies. Then when someone finds a net in the water and reports it, the
// app can say "this is registered gear, owner X" instead of treating a legal net
// as abandoned gear. That is the difference between a patrol callout and nothing.
//
// Two sources feed the same list:
//   - this table, for nets owners registered here
//   - data/registry.csv, for gear registered elsewhere
//
// Cloud mode stores rows in `registered_gear`; local mode keeps them in this
// browser so the app still works with no database.

const GearModule = (function() {
  'use strict';

  const STORE_KEY = 'netsight_gear';
  const R_EARTH_M = 6371000;

  let rows = null;
  let loaded = null;

  // ------------------------------------------------------------------ helpers

  function db() {
    if (typeof Auth === 'undefined' || !Auth.isCloud()) return null;
    return Auth.client();
  }

  function toRad(deg) { return deg * Math.PI / 180; }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Distance from a point to a segment, in metres. A registered net is a line,
  // so measuring to its middle would miss a report at either end.
  function distanceToSegment(lat, lon, a, b) {
    if (!a || !b) return Infinity;

    // Work in a local flat projection: over a few hundred metres this is exact
    // enough and keeps the maths readable.
    const latRef = (a[0] + b[0]) / 2;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(toRad(latRef));

    const px = (lon - a[1]) * mPerDegLon;
    const py = (lat - a[0]) * mPerDegLat;
    const bx = (b[1] - a[1]) * mPerDegLon;
    const by = (b[0] - a[0]) * mPerDegLat;

    const lenSq = bx * bx + by * by;
    if (lenSq === 0) return Math.hypot(px, py);

    let t = (px * bx + py * by) / lenSq;
    t = Math.max(0, Math.min(1, t));

    return Math.hypot(px - t * bx, py - t * by);
  }

  // A short, readable code. Ambiguous characters are left out so it can be read
  // off a buoy in bad light and typed without guessing.
  const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  function newCode() {
    let out = '';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return 'NS-' + out;
  }

  // ------------------------------------------------------------------ storage

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('Could not read registered gear:', err);
    }
    return [];
  }

  function writeLocal(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Could not save registered gear:', err);
    }
  }

  function rowToGear(row) {
    return {
      id: row.id,
      code: row.code,
      label: row.label,
      type: row.gear_type,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      span: row.span || null,
      lat: row.lat,
      lon: row.lon,
      validUntil: row.valid_until,
      createdAt: row.created_at
    };
  }

  // Everyone must be able to see every registered net: a patrol checking a
  // report needs to know whether the net in front of them is legal.
  function load() {
    if (loaded) return loaded;

    loaded = (async () => {
      const client = db();

      if (!client) {
        rows = readLocal();
        return rows;
      }

      const { data, error } = await client
        .from('registered_gear')
        .select('id, code, label, gear_type, owner_id, owner_name, span, lat, lon, valid_until, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Could not load registered gear:', error.message);
        rows = [];
        return rows;
      }

      rows = (data || []).map(rowToGear);
      return rows;
    })();

    return loaded;
  }

  function reload() {
    loaded = null;
    rows = null;
    return load();
  }

  function all() {
    return (rows || []).map(r => Object.assign({}, r));
  }

  function mine() {
    const me = (typeof Auth !== 'undefined' && Auth.current()) || null;
    if (!me) return [];

    // Compare the username as well as the id: a net registered before ids were
    // stored still belongs to the person who registered it.
    return all().filter(r =>
      (me.id && r.ownerId === me.id) ||
      (me.username && r.ownerName === me.username)
    );
  }

  function get(id) {
    return (rows || []).find(r => r.id === id) || null;
  }

  function findByCode(code) {
    const wanted = String(code || '').trim().toUpperCase();
    return (rows || []).find(r => String(r.code).toUpperCase() === wanted) || null;
  }

  function isExpired(gear) {
    if (!gear.validUntil) return false;
    return new Date(gear.validUntil).getTime() < Date.now();
  }

  // "Active" means: not expired, and not withdrawn.
  function activeOnly(list) {
    return (list || all()).filter(g => !isExpired(g) && !g.withdrawn);
  }

  // ------------------------------------------------------------------- write

  async function add(gear) {
    const me = (typeof Auth !== 'undefined' && Auth.current()) || null;
    if (!me) return { ok: false, message: 'Sign in first' };

    const label = String(gear.label || '').trim();
    if (label.length < 3) return { ok: false, message: 'Give the net a name of at least 3 characters' };

    if (gear.span && !Array.isArray(gear.span[0])) {
      return { ok: false, message: 'The net line is not usable' };
    }

    const code = String(gear.code || '').trim().toUpperCase() || newCode();

    if (findByCode(code)) {
      return { ok: false, message: 'That code is already registered' };
    }

    const clean = {
      code,
      label,
      type: gear.type || 'net',
      ownerId: me.id,
      ownerName: me.username,
      span: gear.span || null,
      lat: gear.span ? (gear.span[0][0] + gear.span[1][0]) / 2 : (gear.lat ?? null),
      lon: gear.span ? (gear.span[0][1] + gear.span[1][1]) / 2 : (gear.lon ?? null),
      validUntil: gear.validUntil || null
    };

    const client = db();

    if (!client) {
      clean.id = 'gear-' + Date.now().toString(36);
      clean.createdAt = new Date().toISOString();
      rows = (rows || []).concat([clean]);
      writeLocal(rows);
      return { ok: true, gear: clean };
    }

    const { data, error } = await client
      .from('registered_gear')
      .insert({
        code: clean.code,
        label: clean.label,
        gear_type: clean.type,
        owner_id: clean.ownerId,
        owner_name: clean.ownerName,
        span: clean.span,
        lat: clean.lat,
        lon: clean.lon,
        valid_until: clean.validUntil
      })
      .select('id, code, label, gear_type, owner_id, owner_name, span, lat, lon, valid_until, created_at')
      .single();

    if (error) return { ok: false, message: error.message };

    const saved = rowToGear(data);
    rows = (rows || []).concat([saved]);
    return { ok: true, gear: saved };
  }

  async function remove(id) {
    const client = db();

    if (!client) {
      const before = (rows || []).length;
      rows = (rows || []).filter(r => r.id !== id);
      if (rows.length === before) return false;
      writeLocal(rows);
      return true;
    }

    const { error } = await client.from('registered_gear').delete().eq('id', id);
    if (error) {
      console.warn('Could not withdraw gear:', error.message);
      return false;
    }

    rows = (rows || []).filter(r => r.id !== id);
    return true;
  }

  // ------------------------------------------------------------------ match

  function typesCompatible(sightingClass, gearType) {
    if (sightingClass === 'buoy') return true;          // a buoy marks any gear
    if (sightingClass === 'float') return gearType === 'net' || gearType === 'buoy';
    return sightingClass === gearType;                  // net-net, trap-trap
  }

  // Finds the registered gear a report belongs to, if any.
  //
  // A net is matched against the whole line, not its midpoint — a report at one
  // end of a 600 m net is still that net.
  function matchAt(lat, lon, gearClass, radiusM) {
    const radius = radiusM || 50;
    let best = null;

    activeOnly().forEach(gear => {
      if (!typesCompatible(gearClass, gear.type)) return;

      let distance;
      if (Array.isArray(gear.span) && gear.span.length === 2) {
        distance = distanceToSegment(lat, lon, gear.span[0], gear.span[1]);
      } else if (Number.isFinite(gear.lat) && Number.isFinite(gear.lon)) {
        distance = haversineMeters(lat, lon, gear.lat, gear.lon);
      } else {
        return;
      }

      if (distance <= radius && (best === null || distance < best.distance)) {
        best = { gear, distance };
      }
    });

    return best;
  }

  return {
    load,
    reload,
    all,
    mine,
    get,
    findByCode,
    add,
    remove,
    isExpired,
    activeOnly,
    matchAt,
    newCode,
    haversineMeters,
    distanceToSegment
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GearModule;
} else {
  window.GearModule = GearModule;
}

