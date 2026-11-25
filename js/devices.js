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
  // Water is not guessed and not hand-traced. data/water.json holds a 20 m grid
  // built by sampling the OpenStreetMap raster tiles — the same water the map
  // draws — and marking every water cell that is at least 50 m from land.
  //
  // So the red line on the map and the check that refuses a report read the
  // same cells. There is no way for them to disagree.

  const WATER_URL = 'data/water.json';
  let waterGrid = null;      // { area, cols, rows, dLat, dLon, water, permitted }
  let waterPromise = null;

  function unpackBits(b64, length) {
    const bin = atob(b64);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
    }
    return out;
  }

  // Loads the grid once. Safe to call from anywhere; resolves immediately after.
  function loadWater() {
    if (waterGrid) return Promise.resolve(waterGrid);
    if (waterPromise) return waterPromise;

    waterPromise = fetch(WATER_URL, { cache: 'no-cache' })
      .then(res => {
        if (!res.ok) throw new Error('water grid: HTTP ' + res.status);
        return res.json();
      })
      .then(data => {
        const area = data.area;
        const midLat = (area.minLat + area.maxLat) / 2;

        waterGrid = {
          area,
          cols: data.cols,
          rows: data.rows,
          cellMetres: data.cellMetres,
          minShoreMetres: data.minShoreMetres,
          dLat: (area.maxLat - area.minLat) / data.rows,
          dLon: (area.maxLon - area.minLon) / data.cols,
          water: unpackBits(data.water, data.cols * data.rows),
          permitted: unpackBits(data.permitted, data.cols * data.rows),
          midLat
        };

        return waterGrid;
      })
      .catch(err => {
        console.warn('Could not load the water grid:', err);
        waterPromise = null;
        return null;
      });

    return waterPromise;
  }

  function gridReady() {
    return !!waterGrid;
  }

  function cellOf(lat, lon) {
    if (!waterGrid) return null;

    const c = Math.floor((lon - waterGrid.area.minLon) / waterGrid.dLon);
    const r = Math.floor((lat - waterGrid.area.minLat) / waterGrid.dLat);

    if (r < 0 || r >= waterGrid.rows || c < 0 || c >= waterGrid.cols) return null;
    return { r, c, i: r * waterGrid.cols + c };
  }

  function isWater(lat, lon) {
    const cell = cellOf(lat, lon);
    return cell ? waterGrid.water[cell.i] === 1 : false;
  }

  function isPermitted(lat, lon) {
    const cell = cellOf(lat, lon);
    return cell ? waterGrid.permitted[cell.i] === 1 : false;
  }

  // Distance in metres to the nearest land, capped at maxMetres. Walks outward
  // in rings; the grid is 20 m so 500 m is 25 rings and still instant.
  function distanceToLand(lat, lon, maxMetres) {
    if (!waterGrid) return null;

    const cap = maxMetres || 600;
    const cell = cellOf(lat, lon);
    if (!cell) return null;

    const { cols, rows, water, cellMetres } = waterGrid;
    const maxRing = Math.ceil(cap / cellMetres);

    if (water[cell.i] === 0) return 0;

    for (let ring = 1; ring <= maxRing; ring++) {
      let touchedLand = false;

      for (let dr = -ring; dr <= ring && !touchedLand; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;

          const rr = cell.r + dr, cc = cell.c + dc;
          // off the grid counts as land: the edge of the data is not water we
          // can vouch for
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) {
            touchedLand = true;
            break;
          }
          if (water[rr * cols + cc] === 0) {
            touchedLand = true;
            break;
          }
        }
      }

      if (touchedLand) return ring * cellMetres;
    }

    return cap;
  }

  // The one question the app asks: may gear go here?
  function checkGeofence(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { allowed: false, inside: false, shoreDistance: null, reason: 'No coordinates' };
    }

    if (!waterGrid) {
      return {
        allowed: false,
        inside: false,
        shoreDistance: null,
        reason: 'Water data is still loading'
      };
    }

    if (!isWater(lat, lon)) {
      return {
        allowed: false,
        inside: false,
        shoreDistance: 0,
        reason: 'Not on water'
      };
    }

    const shore = distanceToLand(lat, lon, 600);
    const min = CFG.minShoreMetres;

    if (isPermitted(lat, lon)) {
      return {
        allowed: true,
        inside: true,
        shoreDistance: shore,
        reason: `${Math.round(shore)} m from shore`
      };
    }

    return {
      allowed: false,
      inside: true,
      shoreDistance: shore,
      reason: `${Math.round(shore)} m from shore — at least ${min} m required`
    };
  }

  // The permitted shape, as cells, for the map to paint. Returns a run-length
  // encoded list so the map can build it without holding the whole grid.
  function permittedCells() {
    if (!waterGrid) return [];

    const out = [];
    const { cols, rows, permitted } = waterGrid;

    for (let r = 0; r < rows; r++) {
      let runStart = -1;

      for (let c = 0; c <= cols; c++) {
        const on = c < cols && permitted[r * cols + c] === 1;

        if (on && runStart === -1) runStart = c;
        else if (!on && runStart !== -1) {
          out.push({ r, c0: runStart, c1: c - 1 });
          runStart = -1;
        }
      }
    }

    return out;
  }

  // Water cells too, so the map can show the river itself rather than only the
  // band you may use.
  function waterCells() {
    if (!waterGrid) return [];

    const out = [];
    const { cols, rows, water } = waterGrid;

    for (let r = 0; r < rows; r++) {
      let runStart = -1;

      for (let c = 0; c <= cols; c++) {
        const on = c < cols && water[r * cols + c] === 1;

        if (on && runStart === -1) runStart = c;
        else if (!on && runStart !== -1) {
          out.push({ r, c0: runStart, c1: c - 1 });
          runStart = -1;
        }
      }
    }

    return out;
  }

  function gridInfo() {
    if (!waterGrid) return null;
    return {
      area: waterGrid.area,
      cols: waterGrid.cols,
      rows: waterGrid.rows,
      cellMetres: waterGrid.cellMetres,
      minShoreMetres: waterGrid.minShoreMetres
    };
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
    loadWater,
    gridReady,
    isWater,
    isPermitted,
    distanceToLand,
    permittedCells,
    waterCells,
    gridInfo,
    applyTelemetry,
    haversine
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Devices;
} else {
  window.Devices = Devices;
}



