# NetSight mobile app (boat mode)

The phone app is the website's own code packed with [Capacitor](https://capacitorjs.com), plus one new set of screens (`boat.html`, `js/boat.js`, `css/boat.css`) built for the water: buttons of 72 px or more, one decision per screen, undo instead of "are you sure?".

It uses the **same Supabase project and the same accounts** as the website. Administration stays on the website.

| Role | Sees |
|---|---|
| User (boater / fisherman) | **Report gear**, **My nets** (register a net, show its code, "Taken out"), **My reports** (questions from the patrol, with quick replies) |
| Water Patrol, Administrator | **Cases**: *To decide* (accept with severity / decline with reason), *To collect* (accepted: Collected / Not there) and *Closed by boaters* (Reopen), each with **Open in maps** and **Ask the reporter**; **Identify** (scan QR, "what is here?", type code); **Report gear** |

## "Is it still there?" (gear checks)

Like Waze asking whether the police are still there. While the app is open and a boat is within **50 m** of a reported object, **in daylight**, a full-screen question appears: *Still here* / *It's gone* / *Not sure*. The answer is sent after a 6-second undo window.

- **Only reports nobody registered.** A fisherman's registered nets are never asked about: the owner takes them out and updates the registry himself.
- **Never at night.** From sunset to sunrise (calculated from the phone's position, no network) the questions wait; reports stay on the map. The home screen says "Gear checks paused until sunrise (08:31)".
- **Also not asked:** when GPS is rougher than 50 m, when the person is on land (once shore shapes exist), about your own report from the last 2 hours, or about something you answered in the last 6 hours.
- **"Still here"** confirms the report and forgets earlier "gone" votes. **"Gone"** is a vote: when **2 different people** say gone, an undecided report is closed automatically. An accepted report is **never** closed by boaters; patrol sees "N say gone" on the *To collect* list instead. The rule lives in the database (`008_gear_checks.sql`), not in the app.
- **Votes must come from near the report.** The answer carries the voter's position and the database measures the distance itself (to the nearest point of a net's line), refusing answers from more than 120 m away (`010_vote_distance.sql`). A phone can still fake its position, so this raises the bar rather than proving anything.
- **Patrol can undo boaters' decisions.** Cases has a third tab, *Closed by boaters* (reports closed by two "gone" votes in the last 7 days), showing who said so, with **Reopen**. Reopening resets the vote count so the same two answers cannot close it again.
- **The phone buzzes** when a question appears, and the **screen stays on** while checks are running (released at night, on land, or when the app is put away), because Android stops GPS for an app whose screen is off. Turn this off with `keepAwake: false` in `js/boat-config.js`.
- **Limit:** questions come only while the app is open on screen (Android stops GPS for background apps). Asking with the screen off needs a foreground service and notification: not built.

Settings are in `js/boat-config.js` (`CONFIG.STILL_THERE`). The "2 votes" number is in the SQL.

## Language (Latviešu / English)

A **LV | EN** switch sits at the top right of every screen, and on the sign-in page. The app starts in Latvian when the phone is set to Latvian, otherwise English, and remembers the last choice.

How it works: the app and the website modules it reuses write English. `js/i18n.js` watches the screen and swaps any text it recognises for the Latvian in `js/i18n-lv.js` (exact text, plus patterns for sentences with numbers and names, like "3 h ago" or "NS-123 is registered to anna …"). Nothing in the website is touched. Switching back to English restores the original text. Anything the dictionary does not know stays in English; in the browser console, `I18n.missed()` lists those strings, which makes gaps easy to find. To add or fix a translation, edit `js/i18n-lv.js` only.

The Latvian was written by Claude and **has not been proofread by a native speaker**. Things worth checking: terms (*murds* for trap, *pludiņš* for float, *Jālemj* / *Jāsavāc* for the two case lists), the left/right bank answers, and the grammar of sentences built from names. User-written text (report notes, usernames, net names) is never translated.

## The map

The **Map** button (home screen, every role) opens an interactive OpenStreetMap map: pan, pinch to zoom, tap a pin for details (staff get **Open case**).

- **You** are a dot with an accuracy circle. It is green inside the permitted water, red outside ("Not on the drawn water"), blue when no shoreline has been drawn. **Centre on me** brings you back; the map never moves by itself after the first GPS fix.
- **The red line** is the 50 m limit, drawn from the shoreline an administrator drew in the website (Admin → Shore). It comes from that data, not from the tiles, so it looks the same with any tile source.
- **Reports** are pins coloured by status; nets show as lines. Registered nets: yours in thick blue, others dashed green. Open reports stay on the map day and night; only the "still there?" questions pause at night. Resolved or declined reports are not shown.
- **Back on the map.** A swipe that starts at the very edge of the screen is Android's *Back* gesture, and is easy to trigger by accident while panning. On the map, Back first closes an open pin sheet, and otherwise needs a **second press within 2.5 s** ("Swipe back again to leave the map"). The big ‹ button in the header leaves at once. On a desktop browser, **Escape** stands in for Back.
- **Tiles are OpenStreetMap, for testing and presentations only.** Its [usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy and commercial use and may block app traffic. To switch (for example to MapTiler, free key) build with:
  ```bash
  NETSIGHT_TILE_URL='https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=YOUR_KEY' \
  NETSIGHT_TILE_ATTRIBUTION='&copy; MapTiler &copy; OpenStreetMap contributors' npm run build
  ```
- **A new project has no shoreline, so no red lines.** Draw one: `npm run site` builds the website against your test project (use the same `NETSIGHT_*` variables as the app build) and serves it at <http://localhost:5174/login.html>; sign in as an admin and use Admin → Shore.

### Demo data for a test project

`supabase/demo/demo_data.sql` fills a **test** project (migrations applied, the four test accounts present) with: ten sample reports (undecided, accepted, a registered one, a resolved one); two registered nets; a patrol question to `tboat1`; and two "gone" votes that close one buoy through the real database rule. Run it in the SQL editor. `supabase/demo/demo_cleanup.sql` removes all of it. Everything is marked `demo`. The samples are placed in the Daugava in Riga (about 56.95–56.99 N, 24.09 E), inside the permitted water of the hand-drawn shoreline copied from the live website; every position was checked with the app's own geofence and line rules. If you use another shoreline, regenerate the positions. No shoreline is included in the repo: it is project data, so keep a copy in `supabase/demo/*.local.sql` (git-ignored) or draw one with `npm run site`.

## Run it on your computer (nothing to install but Node)

```bash
npm install
npm run web:local     # local mode: no Supabase, safe to click around
npm run web           # cloud mode: the real Supabase project
```

Open <http://localhost:5173> in Chrome, press `Cmd+Option+I`, then `Cmd+Shift+M` for the phone view. Chrome's **Sensors** panel can fake a GPS position.
In a browser the camera opens a file picker and QR scanning is unavailable (type the code); both are native in the real app.

Local mode creates `admin` / `admin123` in your browser only. Register a normal user on the sign-in page.

**Fake GPS and clock in a desktop browser** (ignored in the phone app). In the browser console:

```js
localStorage.netsight_mock_gps = '{"lat":56.95,"lon":24.10,"accuracy":8}'   // then reload
localStorage.netsight_mock_time = '2026-11-27T20:00:00Z'                     // pretend it is night
```

**On the phone**, open *Test phone* on the home screen: it checks GPS, camera and QR scanning one by one and shows what each returned.

## Run it on an Android phone

Install [Android Studio](https://developer.android.com/studio) (it includes Java). On the phone, turn on Developer options and USB debugging, plug it in, then:

```bash
npm run android       # builds www/, syncs, opens Android Studio; press Run
```

## iOS

Not verified yet. The QR plugin (`@capacitor-mlkit/barcode-scanning`) is not Swift Package Manager compatible, so iOS needs CocoaPods (`brew install cocoapods`) and `xcode-select` pointing at Xcode. Running in the Simulator is free; a real phone and TestFlight need a paid Apple Developer account.

## How the build works

`scripts/build-www.mjs` copies what the app needs into `www/` (not committed), replaces the CDN scripts with pinned local copies, bundles the native plugins from `src/native.js`, and points every role at `boat.html` via `js/boat-config.js`. The website files are not modified by it.

## Before real users

- Run the migrations in the Supabase SQL editor, in this order: `007_hardening.sql`, `008_gear_checks.sql`, `009_function_privileges.sql`, `010_vote_distance.sql`. Try them on a copy of the project first.
- A fresh project needs `003_full_schema.sql`, `006_case_decisions.sql`, then `007`, `008`, `009`, `010` (`001`, `002`, `004` and `005` are not needed).
- Supabase rejects some email domains (it checks they can receive mail). `netsight.lv` was refused by a new project; the test project used `example.com`. A project's domain must never change after its first signup.
- Authentication → Sign In / Providers → Email: **Enable Email provider = on**, **Confirm email = off**. Otherwise sign-up fails (usernames map to addresses that cannot confirm) or hits the mailer's rate limit.

### Building against a test project

```bash
NETSIGHT_AUTH_DOMAIN=example.com \
NETSIGHT_SUPABASE_URL=https://<ref>.supabase.co \
NETSIGHT_SUPABASE_KEY=<publishable key> \
npm run build
```

The build refuses a service key. Only the public publishable/anon key may go in the app.
- Photos: the bucket is still public so the website keeps working; anonymous users can no longer list file names, and names are random. A fully private bucket with signed URLs needs the website changed too.
- The map is not used in boat mode yet. When it is, do not use `tile.openstreetmap.org` from an app: its [tile policy](https://operations.osmfoundation.org/policies/tiles/) wants an identifying User-Agent and restricts app use. Use a tile provider with a key.
- The buoy telemetry endpoint is unauthenticated. Fix it once the hardware and its protocol are known.
