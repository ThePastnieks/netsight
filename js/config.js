// NetSight Configuration

// Build stamp — bump this on every release. It is used to bust browser caches
// (asset query strings) and to purge stale service workers.
const NETSIGHT_BUILD = '2026.11.26.2';

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

    // Where gear may legally sit.
    //
    // `shorelines` is the water body outline — the actual bank. The permitted
    // boundary is that polygon offset inward by minShoreMetres, and it is drawn
    // as the red line on the map. A point is allowed only if it falls inside
    // that offset, so "50 m from shore" means one thing everywhere in the app.
    //
    // These outlines are hand-traced approximations of the Riga centre
    // waterfront, good enough to build against. Replace them with the real
    // municipal water boundary before anything here is legally binding.
    minShoreMetres: 50,
    geofence: {
      shorelines: [
        {
          name: 'Daugava — Riga centre',
          coords: [
            // east bank, south to north
            [56.9385, 24.1185],
            [56.9445, 24.1095],
            [56.9515, 24.1050],
            [56.9590, 24.1055],
            [56.9645, 24.1025],
            [56.9688, 24.0990],
            // north end, across to the west bank
            [56.9692, 24.0905],
            // west bank, north to south
            [56.9645, 24.0915],
            [56.9590, 24.0925],
            [56.9515, 24.0962],
            [56.9445, 24.1020],
            [56.9392, 24.1105]
          ]
        },
        {
          name: 'Ķīšezers',
          coords: [
            [56.9820, 24.1080],
            [56.9860, 24.1250],
            [56.9970, 24.1400],
            [57.0060, 24.1420],
            [57.0100, 24.1300],
            [57.0040, 24.1120],
            [56.9930, 24.1040]
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












