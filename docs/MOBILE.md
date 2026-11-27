# NetSight mobile app (boat mode)

The phone app is the website's own code packed with [Capacitor](https://capacitorjs.com), plus one new set of screens (`boat.html`, `js/boat.js`, `css/boat.css`) built for the water: buttons of 72 px or more, one decision per screen, undo instead of "are you sure?".

It uses the **same Supabase project and the same accounts** as the website. Administration stays on the website.

| Role | Sees |
|---|---|
| User (boater / fisherman) | **Report gear**, **My nets** (register a net, show its code, "Taken out"), **My reports** (questions from the patrol, with quick replies) |
| Water Patrol, Administrator | **Cases**: *To decide* (accept with severity / decline with reason) and *To collect* (accepted: Collected / Not there), with **Ask the reporter**; **Identify** (scan QR, "what is here?", type code); **Report gear** |

## "Is it still there?" (gear checks)

Like Waze asking whether the police are still there. While the app is open and a boat is within **50 m** of a reported object, **in daylight**, a full-screen question appears: *Still here* / *It's gone* / *Not sure*. The answer is sent after a 6-second undo window.

- **Only reports nobody registered.** A fisherman's registered nets are never asked about: the owner takes them out and updates the registry himself.
- **Never at night.** From sunset to sunrise (calculated from the phone's position, no network) the questions wait; reports stay on the map. The home screen says "Gear checks paused until sunrise (08:31)".
- **Also not asked:** when GPS is rougher than 50 m, when the person is on land (once shore shapes exist), about your own report from the last 2 hours, or about something you answered in the last 6 hours.
- **"Still here"** confirms the report and forgets earlier "gone" votes. **"Gone"** is a vote: when **2 different people** say gone, an undecided report is closed automatically. An accepted report is **never** closed by boaters; patrol sees "N say gone" on the *To collect* list instead. The rule lives in the database (`008_gear_checks.sql`), not in the app.
- **Limit:** questions come only while the app is open on screen (Android stops GPS for background apps). Asking with the screen off needs a foreground service and notification: not built.

Settings are in `js/boat-config.js` (`CONFIG.STILL_THERE`). The "2 votes" number is in the SQL.

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

- Run `supabase/migrations/007_hardening.sql`, then `008_gear_checks.sql`, in the Supabase SQL editor (in that order). Try them on a copy of the project first.
- The map is not used in boat mode yet. When it is, do not use `tile.openstreetmap.org` from an app: its [tile policy](https://operations.osmfoundation.org/policies/tiles/) wants an identifying User-Agent and restricts app use. Use a tile provider with a key.
- The buoy telemetry endpoint is unauthenticated. Fix it once the hardware and its protocol are known.
