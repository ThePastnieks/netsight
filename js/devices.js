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

    // Every buoy sits inside the Daugava or Ķīšezers permitted area, and every
    // net carries a `span`: the two anchors it is strung between. The map draws
    // that span as the green gear line.
    return [
      {
        id: 'NS-000101', nfc: '04:A2:33:1B:7C:80', label: 'Zivju tīkls — Daugava, Andrejosta',
        gearType: 'net', owner: 'Fisher A',
        lat: 56.9520, lon: 24.1008,
        span: [[56.9517, 24.10035], [56.9523, 24.10125]],
        battery: 82, temperature_c: 4.1, water_level_cm: 14,
        tilt: { lifted: false, degrees: 4 }, light_on: true, signal: -79,
        lastSeen: mins(8), registeredAt: mins(60 * 24 * 12)
      },
      {
        id: 'NS-000102', nfc: '04:A2:33:1B:7C:81', label: 'Boja — Daugava, pie Vanšu tilta',
        gearType: 'buoy', owner: 'Fisher B',
        lat: 56.9600, lon: 24.0990,
        battery: 17, temperature_c: 3.8, water_level_cm: 11,
        tilt: { lifted: false, degrees: 2 }, light_on: true, signal: -91,
        lastSeen: mins(42), registeredAt: mins(60 * 24 * 30)
      },
      {
        id: 'NS-000103', nfc: '04:A2:33:1B:7C:82', label: 'Slazds — Daugava, ziemeļu posms',
        gearType: 'trap', owner: 'Fisher C',
        lat: 56.9650, lon: 24.0960,
        span: [[56.9647, 24.09555], [56.9653, 24.09645]],
        battery: 64, temperature_c: 4.4, water_level_cm: 16,
        tilt: { lifted: true, degrees: 51 }, light_on: false, signal: -88,
        lastSeen: mins(3), registeredAt: mins(60 * 24 * 5)
      },
      {
        id: 'NS-000104', nfc: '04:A2:33:1B:7C:83', label: 'Tīkls — Daugava, pretī Zaķusalai',
        gearType: 'net', owner: 'Fisher D',
        lat: 56.9470, lon: 24.1055,
        span: [[56.9467, 24.10505], [56.9473, 24.10595]],
        battery: 91, temperature_c: 4.0, water_level_cm: 13,
        tilt: { lifted: false, degrees: 1 }, light_on: true, signal: -74,
        lastSeen: mins(15), registeredAt: mins(60 * 24 * 3)
      },
      {
        id: 'NS-000105', nfc: '04:A2:33:1B:7C:84', label: 'Pludiņš — Daugava, dienvidu posms',
        gearType: 'float', owner: 'Fisher E',
        lat: 56.9420, lon: 24.1100,
        battery: 46, temperature_c: 0.6, water_level_cm: 9,
        tilt: { lifted: false, degrees: 6 }, light_on: false, signal: -95,
        lastSeen: mins(60 * 9), registeredAt: mins(60 * 24 * 20)
      },
      {
        id: 'NS-000106', nfc: '04:A2:33:1B:7C:85', label: 'Tīkls — Daugava, vidus',
        gearType: 'net', owner: 'Fisher A',
        lat: 56.9570, lon: 24.0980,
        span: [[56.9567, 24.09755], [56.9573, 24.09845]],
        battery: 73, temperature_c: 4.2, water_level_cm: 15,
        tilt: { lifted: false, degrees: 3 }, light_on: true, signal: -82,
        lastSeen: mins(21), registeredAt: mins(60 * 24 * 8)
      },
      {
        id: 'NS-000107', nfc: '04:A2:33:1B:7C:86', label: 'Boja — Ķīšezers, ziemeļu gals',
        gearType: 'buoy', owner: 'Fisher B',
        lat: 56.9980, lon: 24.1250,
        battery: 88, temperature_c: 3.4, water_level_cm: 12,
        tilt: { lifted: false, degrees: 2 }, light_on: true, signal: -86,
        lastSeen: mins(19), registeredAt: mins(60 * 24 * 16)
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
  //
  // The shoreline is drawn by hand in Admin -> Shore. This module only needs to
  // ask it one question, and to keep the old call sites working.

  function checkGeofence(lat, lon) {
    if (typeof Shore === 'undefined') {
      return { allowed: true, onWater: null, shoreDistance: null, reason: 'Shoreline module missing' };
    }
    return Shore.checkGeofence(lat, lon);
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




