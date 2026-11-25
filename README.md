# NetSight

Mobile-first web app for reporting lost or abandoned fishing gear on Riga's
waterways. A photo goes to a trained model; the model answers whether there is a
fishing net in the water. Accounts decide whether you report, work the case
list, or administer.

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
| Cache reset | http://localhost:8000/reset.html | troubleshooting |

Every page except the login and reset screens checks the session and bounces you
back to `login.html` (or to your own role's page) if you are not allowed in.

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

### How accounts are stored

Passwords are hashed with **PBKDF2-SHA256** (120 000 iterations, a unique 16-byte
salt per account) and kept in this browser's `localStorage` under
`netsight_users`. The plain password is never written anywhere. A session lasts
12 hours.

> This is a prototype: accounts live in the browser, not on a server. It routes
> three kinds of user to three screens. It is not a substitute for real
> server-side authentication.

---
## Signing in


> The build number lives in `js/config.js → NETSIGHT_BUILD`. Bump it on every
> release — the HTML pages append `?v=<build>` to every local asset and purge
> stale service workers, so the browser always loads the new files. There is no
> service worker any more — an old one from a previous build is unregistered
> automatically, and `reset.html` clears everything in one click.

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

`netlify/functions/detect.js` ships with a stub. Replace `runModel()` with a call
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
admin.html                 Admin panel (points, detection, security)
reset.html                 One-click cache purge (also removes old service workers)
DETECT.md                  The model contract — read this to build the AI
manifest.webmanifest       PWA metadata (install prompt, no service worker)
css/style.css              Design system (tokens → base → components)
js/
  config.js                Build stamp, detection endpoint, map, thresholds
  theme.js                 system / light / dark, persisted
  status.js                Statuses, transitions, colours, validation
  location.js              Geolocation watch, manual point, Haversine
  registry.js              registry.csv parsing + matching
  map.js                   Leaflet map, pins, filters, location picker
  ui.js                    Screens, sheets, toasts, verdict card, detail view
  detection.js             Sends the photo, normalises the model's reply
  store.js                 Supabase CRUD with localStorage fallback
  auth.js                  Accounts, PBKDF2 hashes, session, role guards
  patrol.js                Water Patrol: map + case table + status changes
  admin.js                 Points, detection config, accounts, password
  app.js                   Wiring and user flows
netlify/functions/detect.js The seam: replace runModel() with your model
data/registry.csv          Registered gear
supabase/migrations/       Postgres schema for the live backend
```

Load order: `config → theme → status → location → registry → map → ui →
detection → store → auth → app` (patrol and admin swap the last two for their
own module).

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `R` | New report |
| `Esc` | Back to map |

---

## Live backend (Supabase)

1. Create a project, run `supabase/migrations/001_initial_schema.sql`.
2. Create a public storage bucket `sightings-photos`.
3. Put `SUPABASE_URL` / `SUPABASE_ANON_KEY` into `js/config.js`.

Without a backend the app keeps its sightings in `localStorage` — nothing breaks.

## Browser support

Chrome/Edge 90+, Firefox 88+, Safari 14+. Requires ES2020, Geolocation,
FileReader, fetch, `color-mix()` (graceful fallback), CSS Grid.

## License

MIT — prototype for demonstration purposes.







