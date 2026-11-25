// NetSight Devices — the buoy fleet
//
// A device is a stodere with GPS, battery, temperature, level and a lift sensor.
// This module owns the device records, evaluates their telemetry into alerts, and
// answers the geofence question: may gear be placed at this point?
//
// Telemetry arrives from real hardware over HTTP (see docs/HARDWARE.md). Until
// hardware exists, a seeded demo fleet keeps the screens honest about shape and
// thresholds without pretending a device is talking to us.

const Devices = (function() {
  'use strict';

  const CFG = CONFIG.DEVICES;
  const STORE_KEY = CFG.storeKey;

  const LEVELS = { danger: 3, warn: 2, info: 1 };

  let cache = null;

  // ---------------------------------------------------------------- storage

  function seed() {
    const now = Date.now();
    const mins = m => new Date(now - m * 60000).toISOString();

    return [
      {
        id: 'NS-000101', nfc: '04:A2:33:1B:7C:80', label: 'Zivju tīkls — Daugava, Andrejosta',
        gearType: 'net', owner: 'Fisher A',
        lat: 56.9496, lon: 24.1052,
        battery: 82, temperature_c: 4.1, water_level_cm: 14,
        tilt: { lifted: false, degrees: 4 }, light_on: true, signal: -79,
        lastSeen: mins(8), registeredAt: mins(60 * 24 * 12)
      },
      {
        id: 'NS-000102', nfc: '04:A2:33:1B:7C:81', label: 'Boja — Ķīšezers, ziemeļu gals',
        gearType: 'buoy', owner: 'Fisher B',
        lat: 56.9835, lon: 24.1121,
        battery: 17, temperature_c: 3.8, water_level_cm: 11,
        tilt: { lifted: false, degrees: 2 }, light_on: true, signal: -91,
        lastSeen: mins(42), registeredAt: mins(60 * 24 * 30)
      },
      {
        id: 'NS-000103', nfc: '04:A2:33:1B:7C:82', label: 'Slazds — Buļļupe',
        gearType: 'trap', owner: 'Fisher C',
        lat: 57.0385, lon: 24.2720,
        battery: 64, temperature_c: 4.4, water_level_cm: 16,
        tilt: { lifted: true, degrees: 51 }, light_on: false, signal: -88,
        lastSeen: mins(3), registeredAt: mins(60 * 24 * 5)
      },
      {
        id: 'NS-000104', nfc: '04:A2:33:1B:7C:83', label: 'Tīkls — Daugava, Zaķusala',
        gearType: 'net', owner: 'Fisher D',
        lat: 56.9440, lon: 24.1180,
        battery: 91, temperature_c: 4.0, water_level_cm: 13,
        tilt: { lifted: false, degrees: 1 }, light_on: true, signal: -74,
        lastSeen: mins(15), registeredAt: mins(60 * 24 * 3)
      },
      {
        id: 'NS-000105', nfc: '04:A2:33:1B:7C:84', label: 'Pludiņš — Lielupe, grīva',
        gearType: 'float', owner: 'Fisher E',
        lat: 56.9951, lon: 24.1990,
        battery: 46, temperature_c: 0.6, water_level_cm: 9,
        tilt: { lifted: false, degrees: 6 }, light_on: false, signal: -95,
        lastSeen: mins(60 * 9), registeredAt: mins(60 * 24 * 20)
      },
      {
        id: 'NS-000106', nfc: '04:A2:33:1B:7C:85', label: 'Tīkls — Daugava, Ķengarags',
        gearType: 'net', owner: 'Fisher A',
        lat: 56.9290, lon: 24.1420,
        battery: 73, temperature_c: 4.2, water_level_cm: 15,
        tilt: { lifted: false, degrees: 3 }, light_on: true, signal: -82,
        lastSeen: mins(21), registeredAt: mins(60 * 24 * 8)
      }
    ];
  }

  function read() {
    if (cache) return cache;

    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          cache = parsed;
          return cache;
        }
      }
    } catch (err) {
      console.warn('Could not read devices:', err);
    }

    cache = seed();
    write(cache);
    return cache;
  }

  function write(list) {
    cache = list;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Could not persist devices:', err);
    }
  }

  function all() {
    return read().map(d => Object.assign({}, d));
  }

  function get(id) {
    return read().find(d => d.id === id) || null;
  }

  function update(id, patch) {
    const list = read();
    const idx = list.findIndex(d => d.id === id);
    if (idx === -1) return null;

    list[idx] = Object.assign({}, list[idx], patch, {
      lastSeen: patch.lastSeen || new Date().toISOString()
    });
    write(list);
    return list[idx];
  }

  function remove(id) {
    const list = read();
    const next = list.filter(d => d.id !== id);
    if (next.length === list.length) return false;
    write(next);
    return true;
  }

  function reset() {
    write(seed());
    return all();
  }

  // ---------------------------------------------------------------- alerts

  // Turns one device's telemetry into the list of things a human should see.
  function evaluate(device, nowMs) {
    const now = nowMs || Date.now();
    const out = [];

    if (device.tilt && device.tilt.lifted) {
      out.push({
        code: 'lifted',
        level: 'danger',
        title: 'Lifted out of the water',
        detail: `Tilt ${Math.round(device.tilt.degrees || 0)}° — gear is probably being removed`
      });
    }

    const ageMs = now - new Date(device.lastSeen).getTime();
    if (Number.isFinite(ageMs) && ageMs > CFG.offlineHours * 3600 * 1000) {
      const hours = Math.round(ageMs / 3600000);
      out.push({
        code: 'offline',
        level: 'danger',
        title: 'Not reporting',
        detail: `Silent for ${hours} h — check the buoy`
      });
    }

    if (Number.isFinite(device.battery) && device.battery <= CFG.lowBatteryPct) {
      out.push({
        code: 'battery',
        level: device.battery <= 10 ? 'danger' : 'warn',
        title: 'Battery low',
        detail: `${device.battery}% left — swap the pack`
      });
    }

    const drift = driftFromRegistered(device);
    if (drift !== null && drift > CFG.driftMetres) {
      out.push({
        code: 'drift',
        level: 'warn',
        title: 'Drifted',
        detail: `${Math.round(drift)} m from the registered position`
      });
    }

    if (Number.isFinite(device.temperature_c) && device.temperature_c < 1) {
      out.push({
        code: 'cold',
        level: 'info',
        title: 'Near freezing',
        detail: `${device.temperature_c} °C — ice may form around the buoy`
      });
    }

    return out;
  }

  function driftFromRegistered(device) {
    if (!device.registeredLatLon) return null;
    if (!Number.isFinite(device.lat) || !Number.isFinite(device.lon)) return null;
    return haversine(device.lat, device.lon, device.registeredLatLon[0], device.registeredLatLon[1]);
  }

  // Whole fleet, worst first.
  function alerts(nowMs) {
    const list = [];

    all().forEach(d => {
      evaluate(d, nowMs).forEach(a => {
        list.push(Object.assign({ deviceId: d.id, label: d.label, at: d.lastSeen }, a));
      });
    });

    return list.sort((a, b) => (LEVELS[b.level] || 0) - (LEVELS[a.level] || 0));
  }

  function worstLevel(device, nowMs) {
    const list = evaluate(device, nowMs);
    if (!list.length) return 'ok';
    return list.reduce((worst, a) =>
      (LEVELS[a.level] || 0) > (LEVELS[worst] || 0) ? a.level : worst, 'info');
  }

  function summary(nowMs) {
    const list = all();
    const counts = { total: list.length, ok: 0, warn: 0, danger: 0, offline: 0 };

    list.forEach(d => {
      const level = worstLevel(d, nowMs);
      if (level === 'ok') counts.ok++;
      else if (level === 'danger') counts.danger++;
      else if (level === 'warn') counts.warn++;

      const ageMs = (nowMs || Date.now()) - new Date(d.lastSeen).getTime();
      if (Number.isFinite(ageMs) && ageMs > CFG.offlineHours * 3600 * 1000) counts.offline++;
    });

    return counts;
  }

  // -------------------------------------------------------------- geofence

  // Allowed water polygons. Gear outside every zone, or closer than
  // CFG.minShoreMetres to a zone edge, is not permitted.
  function checkGeofence(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { allowed: false, reason: 'No coordinates', inside: false, shoreDistance: null };
    }

    const zones = CFG.geofence.zones || [];
    if (!zones.length) {
      return { allowed: true, reason: 'No zones configured', inside: true, shoreDistance: null };
    }

    let best = null;

    for (const zone of zones) {
      if (!pointInPolygon(lat, lon, zone.coords)) continue;

      const shore = distanceToPolygonEdge(lat, lon, zone.coords);
      if (best === null || shore > best.shoreDistance) {
        best = { zone: zone.name, shoreDistance: shore };
      }
    }

    if (best === null) {
      return {
        allowed: false,
        inside: false,
        shoreDistance: null,
        reason: 'Outside the permitted water area'
      };
    }

    if (best.shoreDistance < CFG.minShoreMetres) {
      return {
        allowed: false,
        inside: true,
        zone: best.zone,
        shoreDistance: best.shoreDistance,
        reason: `${Math.round(best.shoreDistance)} m from shore — at least ` +
                `${CFG.minShoreMetres} m required`
      };
    }

    return {
      allowed: true,
      inside: true,
      zone: best.zone,
      shoreDistance: best.shoreDistance,
      reason: `${Math.round(best.shoreDistance)} m from shore`
    };
  }

  function pointInPolygon(lat, lon, coords) {
    let inside = false;

    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const yi = coords[i][0], xi = coords[i][1];
      const yj = coords[j][0], xj = coords[j][1];

      const crosses = (yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

      if (crosses) inside = !inside;
    }

    return inside;
  }

  // Shortest distance in metres from a point to the polygon boundary.
  function distanceToPolygonEdge(lat, lon, coords) {
    let min = Infinity;

    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const d = distanceToSegment(lat, lon, coords[j][0], coords[j][1], coords[i][0], coords[i][1]);
      if (d < min) min = d;
    }

    return Number.isFinite(min) ? min : 0;
  }

  // Point-to-segment distance, good enough at city scale.
  function distanceToSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    const latRef = pLat * Math.PI / 180;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRef);

    const px = (pLon - aLon) * mPerDegLon;
    const py = (pLat - aLat) * mPerDegLat;
    const bx = (bLon - aLon) * mPerDegLon;
    const by = (bLat - aLat) * mPerDegLat;

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

  // ------------------------------------------------------------- telemetry

  // Applies an incoming device report. This is the shape a real device posts.
  function applyTelemetry(report) {
    if (!report || !report.device_id) return { ok: false, message: 'Missing device_id' };

    const existing = get(report.device_id);

    const patch = {
      lat: Number(report.lat),
      lon: Number(report.lon),
      battery: Number(report.battery),
      temperature_c: Number(report.temperature_c),
      water_level_cm: Number(report.water_level_cm),
      tilt: report.tilt || { lifted: false, degrees: 0 },
      light_on: !!report.light_on,
      signal: Number(report.signal),
      lastSeen: report.at || new Date().toISOString()
    };

    if (!existing) return { ok: false, message: 'Unknown device ' + report.device_id };

    const updated = update(report.device_id, patch);
    return { ok: true, device: updated, alerts: evaluate(updated) };
  }

  return {
    all,
    get,
    update,
    remove,
    reset,
    evaluate,
    alerts,
    summary,
    worstLevel,
    checkGeofence,
    applyTelemetry,
    haversine
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Devices;
} else {
  window.Devices = Devices;
}
