// NetSight Configuration

// Build stamp — bump this on every release. It is used to bust browser caches
// (asset query strings) and to purge stale service workers.
const NETSIGHT_BUILD = '2026.11.26.1';

const CONFIG = {
  BUILD: NETSIGHT_BUILD,

  // ------------------------------------------------------------------ detect
  // One endpoint, one job: send a photo, say whether there is a fishing net
  // in the water. The model itself lives behind that endpoint — the app never
  // talks to a vision provider directly and holds no keys.
  //
  // Expected request  (POST application/json)
  //   { "image": "<base64 jpeg/png, no data: prefix>" }
  //
  // Expected response
  //   {
  //     "fishing_net": true,
  //     "confidence": 0.93,
  //     "class": "net",
  //     "objects": [{ "class": "net", "confidence": 0.93, "box": [0.1, 0.2, 0.5, 0.3] }],
  //     "model": "netsight-net-v1"
  //   }
  //
  // Only `fishing_net` and `confidence` are required. See DETECT.md.
  DETECT: {
    endpoint: '/.netlify/functions/detect',
    minConfidence: 0.5,     // below this the user must confirm the type
    timeoutMs: 30000,
    enabled: true
  },

  MATCH_RADIUS_M: 50,
  MAX_PHOTO_MB: 5,

  // --------------------------------------------------------------- devices
  // The buoy fleet. Thresholds here drive every alert in the app; see
  // docs/HARDWARE.md for what the physical device has to measure.
  DEVICES: {
    storeKey: 'netsight_devices',

    lowBatteryPct: 20,      // <= this shows "swap the pack"
    offlineHours: 6,        // silent longer than this is an alert
    driftMetres: 25,        // moved this far from where it was registered

    // Where gear may legally sit. Gear outside every zone, or closer than
    // minShoreMetres to a zone edge, is refused when reported.
    // Zones are illustrative — replace with the real Riga water boundary.
    minShoreMetres: 50,
    geofence: {
      zones: [
        {
          name: 'Daugava — Riga centre',
          coords: [
            [56.9260, 24.1580], [56.9350, 24.1350], [56.9450, 24.1150],
            [56.9560, 24.0950], [56.9680, 24.0700], [56.9780, 24.0500],
            [56.9830, 24.0580], [56.9730, 24.0800], [56.9610, 24.1050],
            [56.9500, 24.1250], [56.9400, 24.1450], [56.9310, 24.1680]
          ]
        },
        {
          name: 'Ķīšezers',
          coords: [
            [56.9780, 24.1050], [56.9850, 24.1250], [57.0000, 24.1400],
            [57.0080, 24.1350], [57.0020, 24.1100], [56.9900, 24.0980]
          ]
        }
      ]
    }
  },

  // Map configuration
  MAP_CENTER: [56.9496, 24.1052], // Riga
  MAP_ZOOM: 12,
  TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_ATTRIBUTION: '&copy; OpenStreetMap contributors',

  // Status colors
  COLORS: {
    green: '#2E9E57',
    orange: '#FF8A3D',
    red: '#D93636',
    blue: '#1FA6D8',
    grey: '#7D8C99'
  },

  // Gear classes
  GEAR_CLASSES: ['buoy', 'float', 'net', 'trap', 'unknown'],
  DETECT_CLASSES: ['buoy', 'float', 'net', 'trap', 'unknown', 'none'],

  // Status values
  STATUSES: ['new', 'reported', 'checked', 'resolved', 'false_alarm'],

  // ------------------------------------------------------------------- auth
  // Username + password accounts, kept in this browser. The account's role
  // decides which page it lands on. Administrators can promote a user to
  // Water Patrol from Admin -> Users.
  AUTH: {
    usersKey: 'netsight_users',
    sessionKey: 'netsight_session',
    ttlHours: 12,

    // Created automatically the first time the app runs in a browser.
    // Change the password after your first sign-in.
    seedAdmin: {
      username: 'admin',
      password: 'admin123'
    },

    roles: {
      user: {
        label: 'User',
        page: 'index.html',
        desc: 'Report gear you spot on the water'
      },
      patrol: {
        label: 'Water Patrol',
        page: 'patrol.html',
        desc: 'Work the case list — assigned by an administrator'
      },
      admin: {
        label: 'Administrator',
        page: 'admin.html',
        desc: 'Manage points, the model and who gets in'
      }
    }
  },

  DETECT_STORAGE_KEY: 'netsight_detect_settings',
  THEME_STORAGE_KEY: 'netsight_theme'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.CONFIG = CONFIG;
}











