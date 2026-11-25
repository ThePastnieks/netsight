# NetSight

Mobile-first web app for reporting lost or abandoned fishing gear on Riga's
waterways. A photo goes to a trained model; the model answers whether there is a
fishing net in the water. Accounts decide whether you report, work the case list,
or administer.

> **First time here?** Read [docs/SETUP.md](docs/SETUP.md) — ten minutes to a
> working database. Without it the app runs in local mode and nothing leaves the
> browser.

```bash
cd C:\claudepro2\netsight
python -m http.server 8000     # or: npx serve .
```

| Page | URL | Who |
|---|---|---|
| Sign in | http://localhost:8000/login.html | everyone |
| User app | http://localhost:8000/ | User |
| Water Patrol | http://localhost:8000/patrol.html | Water Patrol |
| Admin panel | http://localhost:8000/admin.html | Administrator |

Every page except the login screen checks the session and bounces you back to
`login.html` (or to your own role's page) if you are not allowed in.

## Signing in

The app opens on `login.html`, which has two tabs: **Sign in** and **Create
account**.

* **Create account** — username (3–24 characters, letters/numbers/`.`/`-`/`_`)
  and a password (6+, letters and numbers). New accounts are always **User**.
* **Sign in** — username + password. The account's role decides where you land.

| Role | Lands on | Can do |
|---|---|---|
| **User** | `index.html` | Report gear, browse the map, edit settings |
| **Water Patrol** | `patrol.html` | Work the case list, change case statuses |
| **Administrator** | `admin.html` | Everything: points, model, accounts |

### First run

The first time the app runs in a browser it creates one administrator:

    username: admin
    password: admin123

Change that password immediately in **Admin → Security**.

### Giving someone Water Patrol

Water Patrol is not self-service — an administrator assigns it.

1. The person registers normally on the sign-in screen (they become a **User**).
2. An administrator opens **Admin → Users**, finds the account and switches the
   role dropdown to **Water Patrol**.
3. Next time they sign in they land on `patrol.html` with the case list.

The same dropdown promotes to **Administrator** or demotes back to **User**. Two
safeguards: you cannot delete your own account, and the last administrator cannot
be demoted or deleted.

### Where accounts live

Two modes, decided by whether `js/config.js` has Supabase keys:

| | Local (no keys) | Cloud (keys set) |
|---|---|---|
| Accounts | this browser only | Supabase Auth, every device |
| Shore shapes | this browser only | `shore_shapes` table |
| Buoys | this browser only | `devices` table |
| Sightings | this browser only | `sightings` table |
| Photos | data URL in the row | Storage bucket |

The sign-in screen says which mode it is in, so nobody is surprised later.

**Cloud mode** signs in with a username, which is expanded to
`<username>@netsight.local` for Supabase Auth. The first account to sign up
becomes the administrator — a database trigger decides that, not the browser.
Everyone after starts as a User.

Roles are enforced by row level security in the database, not only by the
interface. A User cannot delete a sighting even with the console open.

See [docs/SETUP.md](docs/SETUP.md) for the ten-minute setup.
---

## What is in the box

* **Map** — Leaflet + OpenStreetMap, colour-coded pins, six filters, live
  counters, registry overlay with 50 m match zones.
* **Report flow** — photo → model verdict → gear type → GPS or map-pinned
  location → note → save, with automatic registry matching.
* **Pick on map** — a full-height sheet with a draggable pin for placing a
  sighting by hand.
* **Detection** — one HTTP contract. The app posts a photo, the model answers
  `fishing_net: true|false`. Bounding boxes are drawn over the photo when the
  model supplies them. See [DETECT.md](DETECT.md).
* **Water Patrol** — a map of every case plus a sortable list; open a case and
  move it along (`new → reported → checked → resolved | false alarm`). No delete,
  no model config — that is the admin.
* **Admin panel** — points (delete one, bulk, export, wipe), model endpoint, and
  **Users**: who is a User, who is Water Patrol, who is an Administrator.
* **Modern shell** — light/dark/system theme, glass app bar, bottom tab bar,
  bottom sheets, toasts.

---

## Buoys (the fleet)

A buoy is a stodere with GPS, battery, temperature, level and a lift sensor. The
app is the platform that collects what those sensors report — requirement 10 of
the hardware spec. What the device has to measure, and where the spec is likely
to disappoint, is in **[docs/HARDWARE.md](docs/HARDWARE.md)**.

| Where | What it shows |
|---|---|
| Admin → **Devices** | Every buoy: battery, water temperature, level, light, last report. Alerts at the top, worst first. |
| User map | Buoy markers on by default. Nets draw as a green line between their two anchors. |
| Patrol map | The same buoys and gear lines, with the 50 m limit always drawn. |
| Report screen | A geofence line under the coordinates: which zone, metres from shore, or why the spot is refused. |

### The 50 m line

The map draws two things over the water:

* a **soft green wash** — the water you may legally use
* a **red line** — the 50 m limit, drawn along the edge of that wash

The red line is not decoration. `Devices.checkGeofence()` tests the same cells
the line is painted from, so the boundary you see is the boundary that decides.
### Alerts

| Signal | Threshold | Level |
|---|---|---|
| Lifted out of the water | `tilt.lifted` | **danger** |
| Not reporting | silent > 6 h | **danger** |
| Battery low | ≤ 20 % (≤ 10 % is danger) | warn |
| Drifted | > 25 m from where it was registered | warn |
| Near freezing | < 1 °C | info |

Thresholds live in `CONFIG.DEVICES` in `js/config.js`.

### Drawing the shore

The 50 m limit is not measured from a map layer or a guess. Somebody draws the
bank, and the app measures 50 m inward from what they drew. If nothing is drawn
there is no limit, and the report screen says so instead of inventing one.

Admin → **Shore** has three tools, because a bank is rarely one thing:

| Tool | Use it for | How |
|---|---|---|
| **Polygon** | A river reach, a quay, a basin | Tap the corners, press Finish |
| **Circle** | An island, a pond, a mooring ring | Tap the centre, tap the edge |
| **Freehand** | A natural bank with no straight edges | Press and drag to trace |

Each finished shape is closed water. The red line is that shape offset inward by
`CONFIG.DEVICES.minShoreMetres` — measured, not approximated: a test at every
vertex of the offset returns 50 m.

A shape narrower than twice the limit has no legal interior. The app refuses it
and says why rather than drawing a line down the middle of a stream nobody may
use.

Shapes live in `localStorage` under `netsight_shore`. Draw them once per browser;
move them to the backend when the shoreline is settled.
### Nets are a line

A net is not a point. For `net` and `trap` the report screen shows a **Net line**
control: tap where it starts, tap where it ends, and the app draws the line,
shows the distance and stores both anchors as `span` on the sighting. The map
draws that span as a green line with a dot at each end.

`span` is client-side for now — `store.js` strips it before a Supabase insert
because the column does not exist yet. Add it to `sightings` to make it
persistent across devices.
### Getting data in

`netlify/functions/telemetry.js` accepts a device POST:

```json
{
  "device_id": "NS-000123",
  "lat": 56.9690, "lon": 24.0980,
  "battery": 78, "temperature_c": 4.2, "water_level_cm": 12,
  "tilt": { "lifted": false, "degrees": 3 },
  "light_on": true, "signal": -87
}
```

It answers with the alerts that report raised. Storage goes to
`device_telemetry` (`supabase/migrations/002_device_telemetry.sql`); with no
database configured it validates and echoes, so a buoy can be tested end to end.

---
## Detection — where the model plugs in

There is no prompt, no API key and no provider list in the app. There is one
endpoint.

```
photo ──▶ POST { "image": "<base64>" } ──▶ your model ──▶ { "fishing_net": true, … }
```

**Default endpoint:** `/.netlify/functions/detect`
**Change it:** Admin → AI → Model endpoint.

### The reply the app expects

```json
{
  "fishing_net": true,
  "confidence": 0.93,
  "class": "net",
  "objects": [{ "class": "net", "confidence": 0.93, "box": [0.1, 0.2, 0.5, 0.3] }],
  "model": "netsight-net-v1"
}
```

Only `fishing_net` and `confidence` are required. `box` is
`[x, y, width, height]` normalised to 0–1 and draws the rectangle over the photo.

The client tolerates naming variations (`detected`, `score`, `detections`,
`bbox`, `label`, …) and maps loose class names onto `net` / `buoy` / `float` /
`trap` / `none`. Full rules, error handling and worked examples:
**[DETECT.md](DETECT.md)**.

### What the user sees

| Model says | UI |
|---|---|
| `fishing_net: true`, confident | **"Fishing net detected"** — type `Net` preselected |
| `fishing_net: true`, below threshold | Same verdict, but asks the user to confirm the type |
| `fishing_net: false` | **"No fishing gear found"** — nothing preselected |
| Endpoint down / bad reply | Toast with the reason — no verdict card |

### Wiring a model in

`netlify/functions/telemetry.js  Buoy data in
netlify/functions/detect.js` ships with a stub. Replace `runModel()` with a call
to a hosted detector, in-function inference, or your own GPU box. The function's
return value is the only thing the app cares about. Keep secrets in Netlify
environment variables, never in `js/`.

Test it from **Admin → AI → Test endpoint** — it posts a 1×1 PNG and reports
either the round-trip time and model name, or exactly what went wrong.

---

## Admin panel

`admin.html` — reachable only with an Administrator account.

| Tab | What it does |
|---|---|
| **Points** | Every sighting with thumbnail, status, type, confidence, coordinates and age. Filter, sort, delete one, bulk delete, export JSON, delete all. |
| **Devices** | The buoy fleet: battery, temperature, level, lift alerts. |
| **Shore** | Draw the bank with Polygon, Circle or Freehand; the 50 m limit follows. |
| **AI** | Model endpoint, confidence threshold, connection test, and the reply contract. |
| **Users** | Every account, its role, and a dropdown to promote or demote it. |
| **Security** | Change your own password, sign out. |

Deletion is immediate and permanent.

---

## Project layout

```
login.html                 Sign in / create account — the first screen
index.html                 User app (map, report, settings)
patrol.html                Water Patrol (map, cases, settings)
admin.html                 Admin panel (points, devices, shore, users)
vercel.json                Vercel function config
docs/SETUP.md              Ten-minute database setup — start here
docs/HARDWARE.md           What the physical buoy must measure
DETECT.md                  The model contract — read this to build the AI
manifest.webmanifest       PWA metadata (install prompt, no service worker)
css/style.css              Design system (tokens → base → components)
api/
  detect.js                Vercel: photo → verdict
  telemetry.js             Vercel: buoy → database
netlify/functions/
  detect.js                Netlify twin of the above
  telemetry.js             Netlify twin of the above
js/
  config.js                Supabase keys, build stamp, endpoint, thresholds
  theme.js                 system / light / dark, persisted
  status.js                Statuses, transitions, colours, validation
  location.js              Geolocation watch, manual point, Haversine
  registry.js              registry.csv parsing + matching
  map.js                   Leaflet map, pins, filters, shore overlay, pickers
  ui.js                    Screens, sheets, toasts, verdict card, detail view
  detection.js             Sends the photo, normalises the model's reply
  store.js                 Sightings CRUD (Supabase, localStorage fallback)
  auth.js                  Accounts: Supabase Auth or local, roles, guards
  shore.js                 Hand-drawn shoreline, 50 m offset, geofence
  devices.js               Buoy fleet: telemetry, alerts
  patrol.js                Water Patrol: map + case table + status changes
  admin.js                 Points, devices, shore drawing, accounts
  app.js                   Wiring and user flows
data/registry.csv          Registered gear
supabase/migrations/       Postgres schema — run 003 to go live
```

Load order: `config → theme → status → shore → devices → location → registry →
map → ui → detection → store → supabase-js → auth → page module`.

`shore.js` and `devices.js` come before `map.js` because the map draws from
them. `auth.js` comes after `supabase-js` because it builds the client.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `R` | New report |
| `Esc` | Back to map |

---

## Backend

Supabase provides Postgres, Auth and Storage. Everything the app needs is in
[`supabase/migrations/`](supabase/migrations):

| File | What it does |
|---|---|
| `001_initial_schema.sql` | `sightings` table, indexes, photo bucket |
| `002_device_telemetry.sql` | raw telemetry history, one row per report |
| `003_full_schema.sql` | `profiles`, `shore_shapes`, `devices`, roles, RLS, realtime |

Run `003` on a fresh project and the app is fully wired. Setup steps:
[docs/SETUP.md](docs/SETUP.md).

### Server functions

Both hosts are supported; the same logic lives in two places because the
signatures differ:

| Job | Vercel | Netlify |
|---|---|---|
| Photo → verdict | `api/detect.js` | `netlify/functions/detect.js` |
| Buoy → database | `api/telemetry.js` | `netlify/functions/telemetry.js` |

Deploying to Vercel? `CONFIG.DETECT.endpoint` is `/api/detect` (the default).
Netlify? Change it to `/.netlify/functions/detect`.
## Browser support

Chrome/Edge 90+, Firefox 88+, Safari 14+. Requires ES2020, Geolocation,
FileReader, fetch, `color-mix()` (graceful fallback), CSS Grid.

## License

MIT — prototype for demonstration purposes.





















