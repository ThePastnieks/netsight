// NetSight — telemetry endpoint
//
// The buoy fleet posts here. This is the seam between the physical stoderes and
// the app, the same way detect.js is the seam for the photo model. Replace
// `store()` with your own implementation — the app only cares about the shape
// of the reply.
//
// Request   POST application/json
//           {
//             "device_id": "NS-000123",
//             "nfc": "04:A2:33:1B:7C:80",       // optional, the tag on the buoy
//             "at": "2026-11-25T18:40:00Z",     // optional, defaults to now
//             "lat": 56.9690,
//             "lon": 24.0980,
//             "battery": 78,                    // percent
//             "temperature_c": 4.2,
//             "water_level_cm": 12,
//             "tilt": { "lifted": false, "degrees": 3 },
//             "light_on": true,
//             "signal": -87                     // dBm
//           }
//
// Response  200 application/json
//           {
//             "ok": true,
//             "alerts": [                       // what the app will show
//               { "code": "lifted", "level": "danger", "title": "Lifted out of the water" }
//             ]
//           }
//
// Errors return a non-2xx status with { "error": "…" }.
//
// See docs/HARDWARE.md for what the device has to measure and why a plain
// gyroscope cannot detect a lift on its own.

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Mirrors CONFIG.DEVICES in js/config.js. Keep them in step.
const THRESHOLDS = {
  lowBatteryPct: 20,
  offlineHours: 6,
  driftMetres: 25
};

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  if ((event.body || '').length > MAX_BODY_BYTES) {
    return fail(413, 'Payload too large');
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return fail(400, 'Body is not valid JSON');
  }

  const problem = validate(payload);
  if (problem) return fail(422, problem);

  const report = normalise(payload);

  try {
    const stored = await store(report);

    return {
      statusCode: 200,
      headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS),
      body: JSON.stringify({
        ok: true,
        device_id: report.device_id,
        received_at: report.at,
        alerts: evaluate(report, stored)
      })
    };
  } catch (err) {
    console.error('telemetry failed:', err);
    return fail(500, 'Could not store the report');
  }
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') return 'Body must be an object';
  if (!payload.device_id || typeof payload.device_id !== 'string') return 'Missing device_id';

  if (!Number.isFinite(Number(payload.lat)) || !Number.isFinite(Number(payload.lon))) {
    return 'lat and lon are required and must be numbers';
  }

  if (Math.abs(Number(payload.lat)) > 90) return 'lat out of range';
  if (Math.abs(Number(payload.lon)) > 180) return 'lon out of range';

  if (payload.tilt !== undefined && typeof payload.tilt !== 'object') {
    return 'tilt must be an object { lifted, degrees }';
  }

  return null;
}

function normalise(p) {
  return {
    device_id: String(p.device_id),
    nfc: p.nfc ? String(p.nfc) : null,
    at: p.at ? new Date(p.at).toISOString() : new Date().toISOString(),
    lat: Number(p.lat),
    lon: Number(p.lon),
    battery: Number(p.battery),
    temperature_c: Number(p.temperature_c),
    water_level_cm: Number(p.water_level_cm),
    tilt: {
      lifted: !!(p.tilt && p.tilt.lifted),
      degrees: Number((p.tilt && p.tilt.degrees) || 0)
    },
    light_on: !!p.light_on,
    signal: Number(p.signal)
  };
}

// Same rules as js/devices.js → evaluate(), reduced to what the reply needs.
function evaluate(report, previous) {
  const alerts = [];

  if (report.tilt.lifted) {
    alerts.push({
      code: 'lifted',
      level: 'danger',
      title: 'Lifted out of the water'
    });
  }

  if (Number.isFinite(report.battery) && report.battery <= THRESHOLDS.lowBatteryPct) {
    alerts.push({
      code: 'battery',
      level: report.battery <= 10 ? 'danger' : 'warn',
      title: 'Battery low'
    });
  }

  if (Number.isFinite(report.temperature_c) && report.temperature_c < 1) {
    alerts.push({ code: 'cold', level: 'info', title: 'Near freezing' });
  }

  if (previous && Number.isFinite(previous.lat) && Number.isFinite(previous.lon)) {
    const drift = haversine(report.lat, report.lon, previous.lat, previous.lon);
    if (drift > THRESHOLDS.driftMetres) {
      alerts.push({ code: 'drift', level: 'warn', title: 'Drifted' });
    }
  }

  return alerts;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ------------------------------------------------------------------ storage
//
// Replace this with a real write. Until there is a database the function only
// echoes back what it received, so a device can be tested end to end.

async function store(report) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.log('No database configured — telemetry accepted but not stored:', report.device_id);
    return null;
  }

  const res = await fetch(`${url}/rest/v1/device_telemetry`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      device_id: report.device_id,
      nfc: report.nfc,
      recorded_at: report.at,
      lat: report.lat,
      lon: report.lon,
      battery: report.battery,
      temperature_c: report.temperature_c,
      water_level_cm: report.water_level_cm,
      tilt_lifted: report.tilt.lifted,
      tilt_degrees: report.tilt.degrees,
      light_on: report.light_on,
      signal: report.signal
    })
  });

  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }

  const rows = await res.json();
  return rows[0] || null;
}

function fail(statusCode, message) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS),
    body: JSON.stringify({ error: message })
  };
}