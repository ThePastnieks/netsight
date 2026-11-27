# NetSight phone app: test plan (Samsung, Android)

Tick each box. For every failure write: screen, what you did, what you expected, what happened (a screenshot helps).

## 0. Before you start

- Build against the test project (see `docs/MOBILE.md`, "Building against a test project"), run from Android Studio.
- Test project has demo data loaded (`supabase/demo/demo_data.sql`) and the Daugava shoreline.
- Accounts (passwords in `.test-accounts.local.md`): `tadmin` (admin), `tpatrol` (patrol), `tboat1`, `tboat2` (boaters).
- Phone: location switch ON, location permission "While using the app", camera permission allowed, internet on.
- **Where you stand matters.** Most gear tests need a position on the drawn water. You are probably on land. Two options:
  - Android mock location: Settings -> About phone -> tap Build number 7 times -> Developer options -> "Select mock location app" -> install a free GPS-spoof app, set position to the Daugava (about 56.95 N, 24.09 E).
  - Or test real GPS only on the Test phone screen and the "on land" behaviour (that is itself a test case).
- Do tests in the order below. Use two sources if possible: the phone as one user, a browser (`npm run web` or the website) as the second user/patrol.

---

## 1. Sign-in and language

| # | Do | Expect | OK |
|---|---|---|---|
| 1.1 | Open app, not signed in | Sign-in page, LV\|EN switch visible | [ ] |
| 1.2 | Switch LV, then EN | All text changes; choice remembered after closing the app | [ ] |
| 1.3 | Sign in as `tboat1` with a wrong password | Clear error, no crash | [ ] |
| 1.4 | Sign in as `tboat1` | Boater home: Report gear, My nets, My reports, Map, Test phone | [ ] |
| 1.5 | Sign out, sign in as `tpatrol` | Inspector home: Cases, Identify, Report gear, Map | [ ] |
| 1.6 | Sign in as `tadmin` | Inspector home (admin stays on the website) | [ ] |
| 1.7 | Register a new user (e.g. `tboat3`) | Works, lands on boater home | [ ] |
| 1.8 | Kill the app and reopen | Still signed in | [ ] |
| 1.9 | Phone in airplane mode, open app | Understandable offline message, no crash | [ ] |

## 2. Test phone screen (any account)

| # | Do | Expect | OK |
|---|---|---|---|
| 2.1 | Run GPS check with location ON | Position and accuracy shown | [ ] |
| 2.2 | Turn phone location OFF, run again | Message says location is off (known: wording should be friendlier) | [ ] |
| 2.3 | Deny location permission, run again | Message explains permission | [ ] |
| 2.4 | Camera check | Camera opens, photo returned | [ ] |
| 2.5 | QR check: scan `docs/netsight-qr-demo.png` on a screen | Code text returned | [ ] |
| 2.6 | Dim light / blurry QR | Handles failure without freezing | [ ] |

## 3. Boater: Report gear (as `tboat1`)

Stand (or mock) on the drawn water, 50 m or more from shore.

| # | Do | Expect | OK |
|---|---|---|---|
| 3.1 | Report gear -> each type tile (buoy, float, trap, net, etc.) | One decision per screen, buttons large (about 72 px+) | [ ] |
| 3.2 | Buoy/float: "Confirm location" | Enabled on water; shows GPS accuracy | [ ] |
| 3.3 | Move/mock to land, or within 50 m of shore | Button disabled with the reason shown | [ ] |
| 3.4 | Trap/net: Mark first end, move, Mark second end | Line checked as a whole; refuses if any part is on land | [ ] |
| 3.5 | Take a photo | Photo shown, can retake | [ ] |
| 3.6 | Add a note, send | 5 s Undo bar appears | [ ] |
| 3.7 | Tap Undo within 5 s | Nothing is sent | [ ] |
| 3.8 | Let it send | Success screen; report visible to patrol (Section 6) | [ ] |
| 3.9 | Send in airplane mode | Fails with Retry button; Retry works after network returns | [ ] |
| 3.10 | Poor GPS (indoors) | Accuracy warning, no silent bad position | [ ] |

## 4. Boater: My nets (as `tboat1`)

| # | Do | Expect | OK |
|---|---|---|---|
| 4.1 | My nets | Demo registered nets listed (with validity dates) | [ ] |
| 4.2 | Register a net: mark two ends on water | Net saved with a code (NS-...) | [ ] |
| 4.3 | Register with an end on land | Blocked with reason | [ ] |
| 4.4 | Show QR code | QR displayed, scannable by another phone / Identify | [ ] |
| 4.5 | Taken out + Undo | 5-6 s undo; net removed after | [ ] |
| 4.6 | Expired net (demo) | Shown as expired | [ ] |

## 5. Boater: My reports and messages (as `tboat1`)

| # | Do | Expect | OK |
|---|---|---|---|
| 5.1 | My reports | Own reports with plain-language status | [ ] |
| 5.2 | Open the demo patrol question | Question shown with quick-reply buttons | [ ] |
| 5.3 | Tap a quick reply, incl. "I do not know" | Reply sent; patrol sees it (Section 6.8) | [ ] |
| 5.4 | Close my own report (resolved) | Works; report leaves the map | [ ] |
| 5.5 | Left/right bank answers (if asked) | Sensible wording in LV and EN | [ ] |

## 6. Inspector: Cases (as `tpatrol`)

| # | Do | Expect | OK |
|---|---|---|---|
| 6.1 | Cases | Three lists: To decide, To collect, Closed by boaters | [ ] |
| 6.2 | To decide -> open a case | Photo, type, position, reporter, note | [ ] |
| 6.3 | Accept with severity | Moves to To collect; boater sees "accepted, will be collected" | [ ] |
| 6.4 | Decline with a reason | Leaves the list; reporter sees declined | [ ] |
| 6.5 | To collect -> Collected / Not there | Case closes accordingly | [ ] |
| 6.6 | "N say gone" on an accepted case | Count shown; case NOT auto-closed | [ ] |
| 6.7 | Closed by boaters tab | Voter names shown; Reopen puts it back and resets votes | [ ] |
| 6.8 | Ask the reporter | Message arrives for `tboat1`; reply appears in the case | [ ] |
| 6.9 | Open in maps | Opens Google Maps at the position | [ ] |
| 6.10 | Patrol Report gear | Works like boater flow | [ ] |

## 7. Inspector: Identify (as `tpatrol`)

| # | Do | Expect | OK |
|---|---|---|---|
| 7.1 | Scan a net's QR code | Owner, code, validity, matched reports | [ ] |
| 7.2 | Type a code (e.g. an NS- code from My nets) | Same result | [ ] |
| 7.3 | Type a wrong code | "Not found", no crash | [ ] |
| 7.4 | "What is here?" on water near a demo net | Lists nearby gear/reports | [ ] |
| 7.5 | "What is here?" far from anything | Empty result message | [ ] |

## 8. Map (all roles)

| # | Do | Expect | OK |
|---|---|---|---|
| 8.1 | Open Map | Tiles load (OSM may block app traffic: note if grey) | [ ] |
| 8.2 | Wait for GPS | Dot + accuracy circle; green on water, red on land, blue if no shoreline | [ ] |
| 8.3 | Red 50 m line | Visible along the Daugava shore | [ ] |
| 8.4 | Pan, pinch zoom | Smooth; map does not recentre by itself | [ ] |
| 8.5 | Centre on me | Returns to dot | [ ] |
| 8.6 | Pins | Coloured by status; resolved/declined not shown | [ ] |
| 8.7 | Registered nets | Own = thick blue, others dashed green, expired red | [ ] |
| 8.8 | **Back guard:** swipe from the left edge while panning | First Back: message "Swipe back again to leave the map" (or closes open sheet); second Back within 2.5 s leaves | [ ] |
| 8.9 | Header arrow | Leaves the map at once | [ ] |
| 8.10 | Drag from left edge to pan (the reported bug) | Does NOT drop to start screen on first swipe | [ ] |
| 8.11 | Open in maps from a pin sheet | Opens Google Maps | [ ] |

### 8.12 Tap a point: who sees what

Tap the same pin as each account; compare with the table in `docs/MOBILE.md`.

| # | Pin | tboat1 (reporter) | tboat2 (other boater) | tpatrol | OK |
|---|---|---|---|---|---|
| a | Undecided report by tboat1 | "Your report", status in words, no GPS accuracy | No reporter name, no accuracy | Name, exact status, accuracy, Open case | [ ] |
| b | Accepted report | Plain status | Plain status | Severity, who decided, Open case | [ ] |
| c | Registered net (tboat1's) | Name, code, Show QR, Taken out | Type/length/valid only, no owner | Owner, code, Identify | [ ] |
| d | Expired net | Date shown | "Expired" only | Date + owner | [ ] |

## 9. "Is it still there?" pop-up

Needs: position within 50 m of an unregistered demo report, daylight, GPS better than 50 m, app open, screen on, a calm screen (not mid-report). Use mock location, or the browser mock (`localStorage.netsight_mock_gps`, `netsight_mock_time`).

| # | Do | Expect | OK |
|---|---|---|---|
| 9.1 | Come within 50 m of a report in daylight | Full-screen question, phone buzzes | [ ] |
| 9.2 | Screen stays awake while checks run | No screen timeout | [ ] |
| 9.3 | Answer "Still here" | 6 s undo, then sent; earlier "gone" votes reset | [ ] |
| 9.4 | Answer "It's gone" as tboat1, then as tboat2 | After 2 different people, an undecided report closes | [ ] |
| 9.5 | Same person answers again within 6 h | Not asked again | [ ] |
| 9.6 | Registered net nearby | Never asked | [ ] |
| 9.7 | Own report from last 2 h | Never asked | [ ] |
| 9.8 | Night (mock time after sunset) | No question; home says "Gear checks paused until sunrise (HH:MM)" | [ ] |
| 9.9 | GPS worse than 50 m | No question | [ ] |
| 9.10 | Answer from more than 120 m away (spoofed) | Database refuses | [ ] |
| 9.11 | Accepted report, two "gone" votes | Stays open; patrol sees "2 say gone" | [ ] |
| 9.12 | Screen off / app in background | No question (known limit, not built) | [ ] |
| 9.13 | Not sure | Dismisses without vote | [ ] |

## 10. Latvian pass (switch to LV, walk every screen above)

- [ ] No English left on any screen (note each leftover; in a browser, `I18n.missed()` lists them)
- [ ] No text cut off or overflowing buttons (longer words)
- [ ] Wording sounds natural. Flag: *murds* (trap), *pludiņš* (float), *Jālemj* / *Jāsavāc*, left/right bank, sentences with names and numbers
- [ ] User-written text is untouched

## 11. Robustness

| # | Do | Expect | OK |
|---|---|---|---|
| 11.1 | Rotate phone | Layout holds or stays portrait | [ ] |
| 11.2 | Android Back on every screen | Goes back one step, never exits unexpectedly (except home) | [ ] |
| 11.3 | Switch to another app and back mid-report | State kept | [ ] |
| 11.4 | Large font / display size | Buttons still usable | [ ] |
| 11.5 | Dark mode on | Readable | [ ] |
| 11.6 | Slow connection | Loading states, no frozen buttons | [ ] |
| 11.7 | Use 20 min with map open | No crash, battery not unreasonable | [ ] |

## 12. Security spot checks (browser, two accounts)

| # | Do | Expect | OK |
|---|---|---|---|
| 12.1 | As boater, try to open Cases | No patrol screens | [ ] |
| 12.2 | Boater cannot see another boater's reporter name on the map | Hidden (note: names are still readable by API, known issue) | [ ] |
| 12.3 | Boater tries to mark someone else's report resolved | Refused | [ ] |

---

## Result log

| Date | Tester | Phone / Android version | Sections passed | Bugs found |
|---|---|---|---|---|
| | | | | |
