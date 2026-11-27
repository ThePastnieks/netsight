// NetSight Configuration

// Build stamp — bump this on every release. It is used to bust browser caches
// (asset query strings) and to purge stale service workers.
const NETSIGHT_BUILD = '2026.11.29.4';

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
  SUPABASE_ANON_KEY: 'sb_publishable_AkDlQCwWCCqAHJFGn4AN7A_y5somorJ',

  // Accounts sign in with a username. Supabase Auth wants an email, so a
  // username is expanded to this domain internally:
  //   kalas  ->  kalas@netsight.lv
  //
  // The domain must be one Supabase considers real. It rejects reserved names
  // outright — netsight.local gives "email_address_invalid" — so a normal TLD is
  // used instead. Nothing is ever sent to it, because email confirmation is off.
  //
  // Change it before the first signup if you prefer. After that it must stay
  // the same, or existing accounts can no longer sign in.
  AUTH_EMAIL_DOMAIN: 'netsight.lv',



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

  THEME_STORAGE_KEY: 'netsight_theme'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.CONFIG = CONFIG;
}










































