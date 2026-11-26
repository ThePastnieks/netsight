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
* **Report flow** — one action per gear type. A buoy is a point: GPS or a
  map-pinned location. A net is a line: stretch it from end to end and drag
  either handle. Nothing can be placed outside the permitted water.
* **Pick on map** — a full-height sheet with a draggable pin. The permitted water
  is drawn on it, and the pin turns red where gear may not go.
* **Live position** — a blue dot that follows the device and changes colour to
  say whether you are inside the permitted water, with a button to recentre.
* **Registered nets** — fishermen register a net and get a code to write on the
  buoy. A report anywhere along that line is matched to its owner.
* **Water Patrol** — built for cold hands: two tabs, every control at least 56 px
  tall, decisions inline on the card. Accept with a severity, or decline with a
  reason. Identify gear without driving to it.
* **Admin panel** — points (delete one, bulk, export, wipe), the buoy fleet, the
  registered nets, the drawn shore, and **Users**.
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
## Reporting

One action, chosen by what the gear is.

**A buoy or a float is a point.** Pick the type, then use GPS or pick a spot on
the map. The pin turns red and the button stops working if the spot is not in
permitted water.

**A net or a trap is a line.** Pick the type and the point card disappears —
there is nothing to place. Instead you stretch the line: tap where it starts,
tap where it ends, drag either end to adjust. Both ends and everything between
them must be inside the permitted water, at least 50 m from the bank. A line that
leaves the water cannot be confirmed; the button reads *Outside the permitted
water*.

There is no "report it anyway". The rule is the rule.

Every report takes an optional photo and a description.

## Water Patrol

`patrol.html` — two tabs, not four, and every control is at least 56 px tall.
That is not decoration: in November a wet thumb misses a 32 px button, and the
person holding the phone is standing in a boat.

### Cases

One card per report, with two buttons: **Accept** and **Not gear**.

Accepting asks how urgent it is — **Critical / High / Medium / Low** — and moves
the case to `checked`. Four levels, because a scale nobody can remember in the
rain is worse than a coarse one everybody agrees on.

Declining asks why, and the reasons are the ones that actually happen:

| Reason | When |
|---|---|
| Not fishing gear | A bottle, rubbish, a branch |
| Registered and legal | The owner has it registered |
| Already gone | Nothing there when you looked |
| Already reported | Same thing, another report |
| Outside our water | Someone else looks after it |

Declining is not a dead end — it closes the case with a reason, so the list stops
filling with bottles. Tap a card to read the description and reply to the
reporter.

### Identify

The point of the panel. You see something floating 200 m away. You find out what
it is without going closer, three ways:

**By code.** Read `NS-7K3M9P` off the buoy and type it in. Exact — the code is
printed on the gear, so there is nothing to infer.

**By position.** Stand near it and press *Identify what is here*, or tap it on the
map. Everything registered or reporting within 500 m comes back, nearest first,
with how far it is from where it was set.

**By device.** A buoy that is itself reporting is matched on its own coordinates.
That is not an inference — the device is saying where it is.

The answer always carries a confidence band, because a position match is
evidence, not proof: two nets can lie in the same bay.

| Distance | Meaning |
|---|---|
| within 15 m | at its registered position |
| within 50 m | close enough to be the same gear |
| within 200 m | probably it, but it has moved |
| further | nothing registered — it is a case |

And a recommendation, so nobody has to reason about it with wet hands: *Legal
gear — leave it*, *Contact the owner*, or *Collect it*.

### Photos

A photo is the evidence. It appears as a thumbnail on the card and full size when
the card is open, tap it for a full-screen view. Without a photo a report is an
assertion; with one it is something a patrol can judge before driving out.

### QR codes

The code is printed on the buoy as text, which is unreadable from a moving boat
in the rain. The owner can show it as a QR from **My nets**, print that, and stick
it on the buoy.

Patrol presses **Scan the QR code** and the camera does the rest — the browser's
own `BarcodeDetector`, so no library, no upload, nothing leaves the device. Where
the browser cannot scan (no camera, no HTTPS, unsupported), the app says so in a
sentence and the typed field is still there. The QR is a convenience, never the
only way in.

### What is not here

No map tab. The cases are the work; a map you have to pan is not. No settings
tab — the theme and sign-out are in the header. No delete — that is the admin's
job, and it is irreversible.

## Registered nets

A fisherman registers a net before setting it, from **My nets** in the app:
stretch it on the map, name it, and get a code like `NS-7K3M9P` to write on the
buoy.

When someone reports a net that matches a registered one — anywhere along the
line, not just the middle — the app says whose it is. Patrol and admin see the
owner's name and code instead of "unregistered", which is the difference between
a legal net and abandoned gear worth a callout.

Patrol can look a code up directly: read it off the buoy, type it in, and get the
owner, the line, and whether it is still valid.

## Photo check

There is no model. Photos are attached as evidence and nothing reads them. The
old detection endpoint, its admin panel and its client are gone — a stub that
always answers "no model wired up" is worse than not having the feature, because
people would act on it.

The seam is gone entirely: no endpoint, no threshold, no stub that answers
"no model wired up". If a model is built later, it gets its own design —
the app no longer promises one.

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
patrol.html                Water Patrol (cases, identify) — two tabs, big buttons
admin.html                 Admin panel (points, devices, nets, users, shore)
vercel.json                Vercel function config
docs/SETUP.md              Ten-minute database setup — start here
docs/HARDWARE.md           What the physical buoy must measure
manifest.webmanifest       PWA metadata (install prompt, no service worker)
css/style.css              Design system (tokens → base → components)
api/
  telemetry.js             Vercel: buoy → database
netlify/functions/
  telemetry.js             Netlify twin of the above
js/
  config.js                Supabase keys, build stamp, thresholds
  theme.js                 system / light / dark, persisted
  status.js                Statuses, transitions, colours, validation
  location.js              Geolocation watch, manual point, Haversine
  registry.js              registry.csv parsing + matching
  gear.js                  Registered nets: codes, owner, line matching
  cases.js                 Severity, accept/decline, the conversation
  identify.js              Remote identification: by code, position or device
  qr.js                    QR render for owners, camera scan for patrol
  map.js                   Leaflet map, pins, filters, shore overlay, pickers
  ui.js                    Screens, sheets, toasts, verdict card, detail view
  store.js                 Sightings CRUD (Supabase, localStorage fallback)
  auth.js                  Accounts: Supabase Auth or local, roles, guards
  shore.js                 Hand-drawn shoreline, 50 m offset, geofence
  devices.js               Buoy fleet: telemetry, alerts
  patrol.js                Water Patrol: cases, decisions, identify
  admin.js                 Points, devices, nets, shore drawing, accounts
  app.js                   Wiring and user flows
data/registry.csv          Registered gear
supabase/migrations/       Postgres schema — run 003 to go live
```

Load order: `config → theme → status → devices → gear → cases → identify →
shore → location → registry → map → ui → store → supabase-js → auth →
page module`.

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
| `003_full_schema.sql` | everything: profiles, sightings, shore, devices, nets, RLS |
| `004_grants.sql` | table privileges, if an older copy skipped them |
| `005_registered_gear.sql` | the nets table alone, for an existing database |
| `006_case_decisions.sql` | severity, verdict, decline reason, the conversation |

Run `003` on a fresh project and the app is fully wired. Setup steps:
[docs/SETUP.md](docs/SETUP.md).

### Server functions

Both hosts are supported; the same logic lives in two places because the
signatures differ:

| Job | Vercel | Netlify |
|---|---|---|
| Buoy → database | `api/telemetry.js` | `netlify/functions/telemetry.js` |

`api/telemetry.js` needs two environment variables on the host, because a buoy
has no user session and cannot write past row level security: `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY`. Without them a report is validated and echoed but not
stored.
## Browser support

Chrome/Edge 90+, Firefox 88+, Safari 14+. Requires ES2020, Geolocation,
FileReader, fetch, `color-mix()` (graceful fallback), CSS Grid.

## License

MIT — prototype for demonstration purposes.

































