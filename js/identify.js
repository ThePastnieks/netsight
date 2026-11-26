// NetSight — remote identification.
//
// The point of this file: decide what a floating thing is without driving to it.
// A patrol boat sees a buoy 200 m away in the rain. They tap the map where it
// is, or type the code off its side, and the app answers:
//
//   "That is net NS-7K3M9P, registered to Jānis B., set 14 m from here, valid
//    until 30 Nov."
//
// or
//
//   "Nothing registered within 500 m. Treat it as unregistered gear."
//
// Three ways in, because in the field one of them will work:
//
//   1. by code      — read it off the buoy. Exact, no guessing.
//   2. by position  — tap the map. Matches registered nets and reporting buoys
//                     by distance, and says how far off its registered spot it
//                     is.
//   3. by device    — a buoy that is itself reporting is matched by its own
//                     coordinates, which is the strongest evidence of all.
//
// What this deliberately does NOT do is claim certainty it does not have. A
// position match is evidence, not proof: two nets can lie in the same bay. The
// result always carries a confidence band and the distance it was based on, so a
// person can disagree with it.

const IdentifyModule = (function() {
  'use strict';

  // How close counts as what. Metres.
  const BANDS = {
    exact: 15,      // at its registered position
    likely: 50,     // close enough to be the same gear
    drifted: 200,   // probably it, but it has moved
    search: 500     // how far to look at all
  };

  // What a match means in practice.
  const VERDICTS = {
    registered: {
      label: 'Registered',
      tone: 'ok',
      advice: 'Legal gear. Leave it.'
    },
    drifted: {
      label: 'Drifted',
      tone: 'warn',
      advice: 'Registered, but not where it was set. Check with the owner.'
    },
    expired: {
      label: 'Expired',
      tone: 'warn',
      advice: 'Registration has run out. Treat as unregistered.'
    },
    unregistered: {
      label: 'Unregistered',
      tone: 'danger',
      advice: 'Nobody has registered this. It is a case.'
    },
    unknown: {
      label: 'Unknown',
      tone: 'muted',
      advice: 'No shoreline or registry loaded.'
    }
  };

  function haversine(a, b) {
    const R = 6371000;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // Distance from a point to a line segment, in metres. A net is a line, so
  // measuring to its midpoint would miss one end by half its length.
  function distanceToSegment(p, a, b) {
    const latRef = (a[0] + b[0]) / 2;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos((latRef * Math.PI) / 180);

    const px = (p[1] - a[1]) * mPerDegLon;
    const py = (p[0] - a[0]) * mPerDegLat;
    const bx = (b[1] - a[1]) * mPerDegLon;
    const by = (b[0] - a[0]) * mPerDegLat;

    const lenSq = bx * bx + by * by;
    if (lenSq === 0) return Math.hypot(px, py);

    let t = (px * bx + py * by) / lenSq;
    t = Math.max(0, Math.min(1, t));

    return Math.hypot(px - t * bx, py - t * by);
  }

  // How far is this point from a piece of registered gear?
  function distanceToGear(point, gear) {
    if (Array.isArray(gear.span) && gear.span.length === 2) {
      return distanceToSegment(point, gear.span[0], gear.span[1]);
    }
    if (Number.isFinite(gear.lat) && Number.isFinite(gear.lon)) {
      return haversine(point, [gear.lat, gear.lon]);
    }
    return Infinity;
  }

  function band(distance) {
    if (distance <= BANDS.exact) return 'exact';
    if (distance <= BANDS.likely) return 'likely';
    if (distance <= BANDS.drifted) return 'drifted';
    return 'far';
  }

  function gearVerdict(gear, distance) {
    if (typeof GearModule !== 'undefined' && GearModule.isExpired(gear)) {
      return 'expired';
    }
    return distance <= BANDS.likely ? 'registered' : 'drifted';
  }

  // ------------------------------------------------------------------ by code

  // The strongest answer available: the code is printed on the buoy, so if it
  // matches there is nothing to infer.
  function byCode(code) {
    if (typeof GearModule === 'undefined') {
      return { found: false, verdict: 'unknown', reason: 'Registry not loaded' };
    }

    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return { found: false, verdict: 'unknown', reason: 'No code entered' };

    const gear = GearModule.findByCode(clean);

    if (!gear) {
      return {
        found: false,
        code: clean,
        verdict: 'unregistered',
        confidence: 'certain',
        reason: 'No gear registered under ' + clean + '.'
      };
    }

    const expired = GearModule.isExpired(gear);

    return {
      found: true,
      kind: 'gear',
      gear,
      code: gear.code,
      verdict: expired ? 'expired' : 'registered',
      confidence: 'certain',
      distance: null,
      reason: expired
        ? gear.code + ' is registered to ' + gear.ownerName + ', but the registration has expired.'
        : gear.code + ' is registered to ' + gear.ownerName + '.'
    };
  }

  // -------------------------------------------------------------- by position

  // Tap the map where the thing is floating. Everything registered or reporting
  // within the search radius comes back, nearest first.
  function byPosition(lat, lon, options) {
    const opts = options || {};
    const radius = opts.radius || BANDS.search;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { found: false, verdict: 'unknown', reason: 'No position', matches: [] };
    }

    const point = [lat, lon];
    const matches = [];

    // Registered nets and traps.
    if (typeof GearModule !== 'undefined') {
      GearModule.activeOnly().forEach(gear => {
        const d = distanceToGear(point, gear);
        if (d > radius) return;

        matches.push({
          kind: 'gear',
          record: gear,
          distance: d,
          band: band(d),
          verdict: gearVerdict(gear, d)
        });
      });
    }

    // Reporting buoys. A buoy that is here right now is the strongest evidence
    // there is: it is not an inference, it is the device saying so.
    if (typeof Devices !== 'undefined') {
      Devices.all().forEach(device => {
        if (!Number.isFinite(device.lat) || !Number.isFinite(device.lon)) return;

        const d = haversine(point, [device.lat, device.lon]);
        if (d > radius) return;

        matches.push({
          kind: 'device',
          record: device,
          distance: d,
          band: band(d),
          verdict: d <= BANDS.likely ? 'registered' : 'drifted'
        });
      });
    }

    matches.sort((a, b) => a.distance - b.distance);

    if (!matches.length) {
      return {
        found: false,
        verdict: 'unregistered',
        confidence: 'likely',
        matches: [],
        reason: 'Nothing registered within ' + Math.round(radius) + ' m. Treat it as unregistered gear.'
      };
    }

    const best = matches[0];

    return {
      found: true,
      best,
      matches,
      verdict: best.verdict,
      confidence: best.band === 'exact' ? 'certain'
        : best.band === 'likely' ? 'likely'
        : 'weak',
      distance: best.distance,
      reason: explain(best)
    };
  }

  // One sentence a person can act on.
  function explain(match) {
    if (!match) return 'Nothing found.';

    const metres = Math.round(match.distance);
    const r = match.record;

    if (match.kind === 'device') {
      const owner = r.owner ? ' (' + r.owner + ')' : '';
      return 'Buoy ' + r.id + owner + ' is reporting ' + metres + ' m from here.';
    }

    const expired = typeof GearModule !== 'undefined' && GearModule.isExpired(r);
    const suffix = expired ? ' Registration has expired.' : '';

    if (metres <= BANDS.exact) {
      return r.code + ' is registered to ' + r.ownerName +
        ' and sits ' + metres + ' m from here — where it was set.' + suffix;
    }

    if (metres <= BANDS.likely) {
      return r.code + ' is registered to ' + r.ownerName +
        ', ' + metres + ' m from here.' + suffix;
    }

    return r.code + ' is registered to ' + r.ownerName +
      ', but ' + metres + ' m from where it was set. It has moved, or this is a different net.' + suffix;
  }

  // ----------------------------------------------------------- what to do next

  // Turns an identification into a recommendation the patrol can act on with one
  // press, so nobody has to reason about it in the rain.
  function recommendation(result) {
    if (!result || !result.verdict) {
      return { action: 'review', label: 'Look into it', tone: 'warn' };
    }

    switch (result.verdict) {
      case 'registered':
        return { action: 'leave', label: 'Legal gear — leave it', tone: 'ok' };
      case 'drifted':
        return { action: 'contact', label: 'Contact the owner', tone: 'warn' };
      case 'expired':
        return { action: 'collect', label: 'Collect it', tone: 'danger' };
      case 'unregistered':
        return { action: 'collect', label: 'Collect it', tone: 'danger' };
      default:
        return { action: 'review', label: 'Look into it', tone: 'warn' };
    }
  }

  return {
    BANDS,
    VERDICTS,
    byCode,
    byPosition,
    recommendation,
    explain,
    distanceToGear,
    haversine
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IdentifyModule;
} else {
  window.IdentifyModule = IdentifyModule;
}
