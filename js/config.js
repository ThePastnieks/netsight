// NetSight Configuration

// Build stamp — bump this on every release. It is used to bust browser caches
// (asset query strings) and to purge stale service workers.
const NETSIGHT_BUILD = '2026.11.24.4';

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
  MAX_IMAGE_SIDE_PX: 1280,

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
  REPORT_REASONS: ['unmarked', 'abandoned', 'hazard', 'possibly_illegal', 'other'],

  // Registry type compatibility
  COMPATIBILITY: {
    buoy: ['buoy', 'net', 'trap'],
    float: ['net', 'buoy'],
    net: ['net'],
    trap: ['trap'],
    unknown: []
  },

  // ------------------------------------------------------------------ admin
  ADMIN: {
    // Change the PIN in Admin -> Security. Stored as a SHA-256 hash locally.
    defaultPin: '2468',
    sessionKey: 'netsight_admin_session',
    pinKey: 'netsight_admin_pin'
  },

  // ------------------------------------------------------------------- auth
  // One login at the start of the app. The chosen role decides which page
  // you land on and which tabs that page shows. PINs are per role and stored
  // as SHA-256 hashes in this browser only.
  AUTH: {
    sessionKey: 'netsight_session',
    pinPrefix: 'netsight_pin_',
    changedFlag: 'netsight_pins_changed',
    ttlHours: 12,
    roles: {
      boater: {
        label: 'Boater',
        short: 'Boater',
        page: 'index.html',
        defaultPin: '1111',
        desc: 'Report fishing gear you spot on the water',
        icon: 'anchor'
      },
      patrol: {
        label: 'Water Patrol',
        short: 'Patrol',
        page: 'patrol.html',
        defaultPin: '2222',
        desc: 'Work the case list and update what you find',
        icon: 'shield'
      },
      admin: {
        label: 'Administrator',
        short: 'Admin',
        page: 'admin.html',
        defaultPin: '2468',
        desc: 'Manage points, the model and who gets in',
        icon: 'gear'
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


