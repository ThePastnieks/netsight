# NetSight

Mobile-first web app for reporting lost or abandoned fishing gear on Riga's
waterways. A photo goes to a trained model; the model answers whether there is a
fishing net in the water. A PIN-gated admin panel manages the stored points.

```bash
cd C:\claudepro2\netsight
python -m http.server 8000     # or: npx serve .
```

| Page | URL |
|---|---|
| Boater app | http://localhost:8000/ |
| Inspector dashboard | http://localhost:8000/inspector.html |
| Admin panel | http://localhost:8000/admin.html |
| Cache reset | http://localhost:8000/reset.html |

> The build number lives in `js/config.js → NETSIGHT_BUILD`. Bump it on every
> release — the HTML pages append `?v=<build>` to every local asset and purge
> stale service workers, so the browser always loads the new files.

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
* **Inspector dashboard** — sortable/filterable case table, detail sheet, status
  transitions with a mandatory comment for `resolved` / `false_alarm`.
* **Admin panel** — PIN-gated. Delete single points, bulk delete, export JSON,
  wipe, set the model endpoint, change the PIN.
* **Modern shell** — light/dark/system theme, glass app bar, bottom tab bar,
  bottom sheets, toasts, PWA install + offline.

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

`admin.html` — PIN gated. First visit asks you to create one (`2468` is the
documented default if you skip it). Stored as a SHA-256 hash in this browser
only; the session ends when the tab closes.

| Tab | What it does |
|---|---|
| **Points** | Every sighting with thumbnail, status, type, confidence, coordinates and age. Filter, sort, delete one, bulk delete, export JSON, delete all. |
| **AI** | Model endpoint, confidence threshold, connection test, and the reply contract. |
| **Security** | Change PIN, lock the panel. |

Deletion is immediate and permanent.

---

## Project layout

```
index.html                 Boater app (map, report, settings)
inspector.html             Inspector dashboard
admin.html                 Admin panel (PIN, points, detection, security)
reset.html                 One-click cache + service worker purge
DETECT.md                  The model contract — read this to build the AI
manifest.webmanifest       PWA metadata
sw.js                      Offline app-shell service worker
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
  inspector.js             Inspector table logic
  admin.js                 PIN gate, point deletion, detection config
  app.js                   Wiring and user flows
netlify/functions/detect.js The seam: replace runModel() with your model
data/registry.csv          Registered gear
supabase/migrations/       Postgres schema for the live backend
```

Load order: `config → theme → status → location → registry → map → ui →
detection → store → app`.

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
