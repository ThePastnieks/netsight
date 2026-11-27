# NetSight — project description

## Problem

Fishing nets, traps and set lines sit on or just under the surface, marked only
by a buoy or a flag. In poor light, in swell, in fog, or at dusk those markers are
easy to miss. Some buoys carry GPS or AIS transmitters, but most do not, because
the devices cost money and are not required everywhere. For a large share of the
gear on Riga's waterways there is no reliable digital record of where it is, who
set it, or whether anyone is still watching it.

## Why existing solutions fall short

GPS and AIS buoys work well, but only for the gear that carries them. Fitting
every buoy is too expensive, especially for small-scale and recreational fishers.
Paper and manual registries are not live, not searchable, and not visible to
anyone else on the water. Patrols cover limited areas at limited times, so gear
goes unnoticed for long periods. And ad hoc reports from boaters — a phone call,
a message to a friend — are never collected in one place and rarely carry an
exact position or a photo.

## Consequences

**Safety.** Boats hit gear or foul propellers on lines, causing damage and putting
people at risk.

**Enforcement.** An inspector has to establish whether a net is legal,
registered, abandoned or illegal — work that takes time and usually means going
out to look.

**Environment.** Abandoned and lost gear keeps drifting or sits in the water,
harming wildlife and polluting the waterway.

**Trust.** Boaters, fishers and authorities each hold a fragment of the picture,
and nobody holds the whole of it.

## The core gap

The problem is not that the technology to track gear is missing. It is that there
is no cheap, shared way to record and look up gear that carries no tracker at
all — and no way for the people already on the water to contribute what they see.

## The opportunity

Almost every boater carries a phone with a camera, a GPS and a data connection.
That is already enough to place a piece of gear on a map, to identify it against
a registry, and to hand a patrol a documented case instead of a rumour. Nothing
has to be fitted to the gear itself.

## Solution — NetSight

NetSight is a mobile-first web platform that makes untracked fishing gear
visible on Riga's waterways. A shared live map carries every report and every
registered net. A registry gives each declared net a code and a QR mark. A
patrol can identify gear from a distance, decide on it, and talk to the person
who reported it — all before leaving the dock.

## How it works

**Record.** A boater opens the map, taps where the gear is, picks the type, and
optionally adds a photo and a note. A single point for a buoy or a marker; a net
is stretched between two points, so it has a length and a bearing rather than
just a dot.

**Register.** An owner registers a net once and receives a code and a QR mark.
That code is the net's identity from then on. Patrols and administrators who
register gear mark it as official, which is the platform's way of saying somebody
is accountable for it.

**Share.** Everything lands on one live map: report pins, registered nets, and
the permitted water itself. Other boaters see the same picture at the same time.

**Identify.** A patrol identifies gear without going close. Scan the QR or type
the code for an exact answer, or use the position alone and let the platform
compare the distance against every registered net, reporting it in distance bands
— exact, likely, drifted, or search wider.

**Resolve.** The patrol accepts the case with a severity, or declines it with a
reason, and can reply to the reporter in a two-way thread. The reporter answers
in the same report, so a question asked at the dock is answered by the person who
was there.

## Key features

- Live shared map with report pins, registered nets and permitted water
- Permitted water drawn by hand, with a rule per zone
- A hard geofence: a point or a net cannot be placed outside permitted water
- A duplicate prompt when a report lands close to an existing one
- Gear registry with codes and QR marks
- Remote identification by code and by position, reported in distance bands
- Water Patrol panel built for cold, wet hands: large controls, severity, decline
  reasons, photo evidence, and a map view
- Admin panel for reports, shoreline, devices and accounts
- Three roles, assigned by the database rather than chosen by the client

## Technology

**Frontend.** Plain HTML, CSS and JavaScript, Leaflet with OpenStreetMap tiles,
no build step and no framework — it loads fast on a phone held on a boat.

**Backend.** Supabase: PostgreSQL, authentication, file storage for photos, and
realtime updates. Row-level security is enforced in the database, so a user
cannot read or write another user's rows even with the public key in hand.

**Roles.** Created by a database trigger when an account is made; the first
account on a fresh install becomes the administrator.

**Identification.** Registry matching and distance calculation run in the
browser; QR marks are generated client-side and scanned with the phone's built-in
barcode reader.

An object-detection model — recognising buoys and nets directly in photographs —
was scoped early on and then deliberately dropped. It was the least reliable part
of the plan and by far the most expensive: it answers with a probability, needs
training data nobody has, and can be wrong in exactly the situation that matters,
in fog and at dusk. Checking a code against a registry answers with a fact, costs
nothing per use, and works in the dark.

## Who benefits

**Boaters** get safer navigation and fewer collisions with gear.

**Inspectors** get documented reports with a photo, a position and a history, and
a list sorted by how much the report matters.

**Fishers** gain a simple way to register gear, a code that proves it is theirs,
and less false suspicion.

**The environment** benefits from abandoned gear being found sooner, before it
drifts.

## Why it works

It avoids the cost of fitting trackers to every buoy by using what people already
carry. What turns scattered observations into a useful picture is the registry:
a sighting means nothing on its own, but a sighting checked against a register of
declared gear says whether this is somebody's legal net, an expired registration,
or gear nobody will claim. That answer needs no new hardware on the water — only
a record and a way to share it.

## What's done so far

- **Problem analysis** — the visibility and information gap around untracked
  gear, and who it affects.
- **Solution design** — the full flow: record, register, share, identify, resolve.
- **A working platform** — accounts and roles, the live map, the reporting flow,
  the gear registry with QR codes, remote identification, the Water Patrol panel
  and the admin panel. Built and running, not mocked up.
- **A backend** — Supabase with row-level security on every table, realtime
  updates, and photo storage.
- **Data model** — reports, registered gear, shoreline zones, devices, cases and
  their conversations.
- **Hardware design** — specification for a physical marker buoy, with a
  telemetry endpoint for reporting battery and position.
- **Branding** — name, mark and interface.
- **Next** — field testing on the Daugava with patrols, a proximity warning for
  boaters, and an offline queue for areas with no signal.