// NetSight Configuration

// Build stamp — bump this on every release. It is used to bust browser caches
// (asset query strings) and to purge stale service workers.
const NETSIGHT_BUILD = '2026.11.27.4';

const CONFIG = {
  BUILD: NETSIGHT_BUILD,

  // ---------------------------------------------------------------- supabase
  // Paste the two values from Supabase → Project Settings → API.
  //
  // The anon key is public by design — it ships to the browser either way.
  // What protects the data is row level security in the database, not secrecy
  // of this key. Never put the service_role key here.
  //
  // Leave both empty and the app runs in local mode: everything works, but
  // nothing leaves this browser. The sign-in screen says so.
  SUPABASE_URL: 'https://noncjqgdevddkxrvurop.supabase.co',
  SUPABASE_ANON_KEY: '',

  // Accounts sign in with a username. Supabase Auth wants an email, so a
  // username is expanded to this domain internally. Change it before the first
  // signup if you prefer something else; after that it must stay the same or
  // existing accounts can no longer sign in.
  AUTH_EMAIL_DOMAIN: 'netsight.local',

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
    // Vercel serves api/. Netlify serves netlify/functions/ — if you deploy
    // there, change this to '/.netlify/functions/detect'.
    endpoint: '/api/detect',
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

    // The 50 m rule. The shoreline is drawn by hand in Admin -> Shore; every
    // shape there is closed water, and this is how far inside it gear may go.
    minShoreMetres: 50
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























