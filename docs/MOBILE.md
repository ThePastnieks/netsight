# NetSight mobile app (boat mode)

The phone app is the website's own code packed with [Capacitor](https://capacitorjs.com), plus one new set of screens (`boat.html`, `js/boat.js`, `css/boat.css`) built for the water: buttons of 72 px or more, one decision per screen, undo instead of "are you sure?".

It uses the **same Supabase project and the same accounts** as the website. Administration stays on the website.

| Role | Sees |
|---|---|
| User (boater / fisherman) | **Report gear**, **My nets** (register a net, show its code, "Taken out") |
| Water Patrol, Administrator | **Cases** (accept with severity / decline with reason), **Identify** (scan QR, "what is here?", type code), **Report gear** |

## Run it on your computer (nothing to install but Node)

```bash
npm install
npm run web:local     # local mode: no Supabase, safe to click around
npm run web           # cloud mode: the real Supabase project
```

Open <http://localhost:5173> in Chrome, press `Cmd+Option+I`, then `Cmd+Shift+M` for the phone view. Chrome's **Sensors** panel can fake a GPS position.
In a browser the camera opens a file picker and QR scanning is unavailable (type the code); both are native in the real app.

Local mode creates `admin` / `admin123` in your browser only. Register a normal user on the sign-in page.

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

- Run `supabase/migrations/007_hardening.sql` in the Supabase SQL editor.
- The map is not used in boat mode yet. When it is, do not use `tile.openstreetmap.org` from an app: its [tile policy](https://operations.osmfoundation.org/policies/tiles/) wants an identifying User-Agent and restricts app use. Use a tile provider with a key.
- The buoy telemetry endpoint is unauthenticated. Fix it once the hardware and its protocol are known.
