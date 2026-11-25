// NetSight — telemetry endpoint, Vercel form.
//
// The buoy fleet posts here. Replace `store()` with your own implementation; the
// app only cares about the shape of the reply.
//
// Request   POST application/json
//           {
//             "device_id": "NS-000123",
//             "nfc": "04:A2:33:1B:7C:80",       // optional
//             "at": "2026-11-25T18:40:00Z",     // optional, defaults to now
//             "lat": 56.9690,
//             "lon": 24.0980,
//             "battery": 78,
//             "temperature_c": 4.2,
//             "water_level_cm": 12,
//             "tilt": { "lifted": false, "degrees": 3 },
//             "light_on": true,
//             "signal": -87
//           }
//
// Response  200 application/json
//           { "ok": true, "alerts": [ { "code": "lifted", "level": "danger", … } ] }
//
// This is the Vercel twin of netlify/functions/telemetry.js.

const MAX_BODY_BYTES = 64 * 1024;

// Mirrors CONFIG.DEVICES in js/config.js. Keep them in step.
const THRESHOLDS = {
  lowBatteryPct: 20,
  driftMetres: 25
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (raw.length > MAX_BODY_BYTES) return res.status(413).json({ error: 'Payload too large' });

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Body is not valid JSON' });
  }

  const problem = validate(payload);
  if (problem) return res.status(422).json({ error: problem });

  const report = normalise(payload);

  try {
    const previous = await store(report);

    return res.status(200).json({
      ok: true,
      device_id: report.device_id,
      received_at: report.at,
      alerts: evaluate(report, previous)
    });
  } catch (err) {
    console.error('telemetry failed:', err);
    return res.status(500).json({ error: 'Could not store the report' });
  }
};

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
    alerts.push({ code: 'lifted', level: 'danger', title: 'Lifted out of the water' });
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
// Updates the device row and returns its previous position, so drift can be
// judged against where it was. Uses the service key: a buoy has no user session,
// and the anon key could not write past row level security.

async function store(report) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.log('No database configured — telemetry accepted but not stored:', report.device_id);
    return null;
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  const before = await fetch(
    `${url}/rest/v1/devices?id=eq.${encodeURIComponent(report.device_id)}&select=lat,lon`,
    { headers }
  );

  if (!before.ok) throw new Error(`Supabase read ${before.status}: ${await before.text()}`);
  const rows = await before.json();
  const previous = rows[0] || null;

  const patch = await fetch(
    `${url}/rest/v1/devices?id=eq.${encodeURIComponent(report.device_id)}`,
    {
      method: 'PATCH',
      headers: Object.assign({ Prefer: 'return=representation' }, headers),
      body: JSON.stringify({
        lat: report.lat,
        lon: report.lon,
        battery: report.battery,
        temperature_c: report.temperature_c,
        water_level_cm: report.water_level_cm,
        tilt: report.tilt,
        light_on: report.light_on,
        signal: report.signal,
        last_seen: report.at
      })
    }
  );

  if (!patch.ok) throw new Error(`Supabase write ${patch.status}: ${await patch.text()}`);

  return previous;
}
