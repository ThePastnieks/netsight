// NetSight — "is it still there?"
//
// Like Waze asking "is the police still here?": when a boat comes within ~50 m
// of a reported object in DAYLIGHT, ask whether it is still there. "Here"
// confirms the report; "gone" is a vote (the database closes an undecided report
// after 2 different people say gone — see supabase/migrations/008_gear_checks.sql).
//
// What is asked about: open reports that nobody has registered. Registered gear
// (the fisherman's own nets) is never asked about: the owner takes it out and
// updates the registry himself.
//
// What is NOT asked: at night (nobody can see anything, and a wrong answer in the
// dark would clear a real hazard), when the GPS fix is poor, when the person is on
// land, for their own fresh report, or for something they already answered.
// Reports stay on the map at night; the questions simply wait for sunrise.
//
// The pure parts (sun, candidate choice) have no DOM access so Node can test them.

const StillThere = (function () {
  'use strict';

  const DEFAULTS = {
    radiusM: 50,            // ask when this close (to the nearest point, for a net)
    minAccuracyM: 50,       // ignore fixes worse than this
    cooldownHours: 6,       // after an answer (the database enforces the same)
    snoozeMinutes: 30,      // after "not sure"
    ownReportHours: 2,      // do not ask about a report you made this recently
    refreshMs: 120000,      // how often to reload the reports
    tickMs: 3000            // how often to look at the position
  };

  function cfg() {
    const c = (typeof CONFIG !== 'undefined' && CONFIG.STILL_THERE) || {};
    return Object.assign({}, DEFAULTS, c);
  }

  // ================================================================== sun
  // Sunrise and sunset from position and date (the standard solar-position
  // algorithm, accurate to a minute or two). No network, no library.

  const RAD = Math.PI / 180;
  const DAY_MS = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const J0 = 0.0009;
  const OBLIQUITY = RAD * 23.4397;

  const toJulian = d => d.valueOf() / DAY_MS - 0.5 + J1970;
  const fromJulian = j => new Date((j + 0.5 - J1970) * DAY_MS);
  const toDays = d => toJulian(d) - J2000;

  const meanAnomaly = d => RAD * (357.5291 + 0.98560028 * d);

  function eclipticLongitude(M) {
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + RAD * 102.9372 + Math.PI;
  }

  const declination = L => Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * Math.PI));
  const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
  const solarTransit = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

  function hourAngle(h, phi, dec) {
    return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  }

  // -> { rise: Date, set: Date } for the solar day around `date`, or null in
  //    polar day/night (not a case for Latvia, but never crash on it).
  function sunTimes(date, lat, lon) {
    const lw = RAD * -lon;
    const phi = RAD * lat;
    const d = toDays(date);
    const n = julianCycle(d, lw);
    const ds = approxTransit(0, lw, n);
    const M = meanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = declination(L);
    const noon = solarTransit(ds, M, L);

    const w = hourAngle(-0.833 * RAD, phi, dec);
    if (!Number.isFinite(w)) return null;

    const set = solarTransit(approxTransit(w, lw, n), M, L);
    const rise = noon - (set - noon);
    return { rise: fromJulian(rise), set: fromJulian(set) };
  }

  // Daylight means between sunrise and sunset. If the sun times cannot be
  // computed, answer false: asking in doubt is worse than waiting.
  function isDaylight(date, lat, lon) {
    const t = sunTimes(date, lat, lon);
    if (!t) return false;
    return date >= t.rise && date <= t.set;
  }

  // When the questions start again, for the status line. Looks at today's
  // sunrise, and tomorrow's if today's has passed.
  function nextSunrise(date, lat, lon) {
    const today = sunTimes(date, lat, lon);
    if (today && today.rise > date) return today.rise;
    const tomorrow = sunTimes(new Date(date.getTime() + DAY_MS), lat, lon);
    return tomorrow ? tomorrow.rise : null;
  }

  // ============================================================ choosing

  function distanceM(s, lat, lon) {
    const p = [lat, lon];
    if (Array.isArray(s.span) && s.span.length === 2) return IdentifyModule.distanceToGear(p, { span: s.span });
    if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) return IdentifyModule.distanceToGear(p, { lat: s.lat, lon: s.lon });
    return Infinity;
  }

  // Is this report something a boater should be asked about at all?
  function isAskable(s, me, nowMs) {
    if (!s || !CaseModule.isOpen(s)) return false;          // resolved or declined
    if (s.registry_match) return false;                     // the owner looks after it
    if (s.status === 'resolved' || s.status === 'false_alarm') return false;
    if (me && s.reported_by && s.reported_by === me.id) {
      const born = new Date(s.created_at).getTime();
      if (!Number.isFinite(born) || nowMs - born < cfg().ownReportHours * 3600000) return false;
    }
    return true;
  }

  // Nearest askable report within the radius that is not cooling down.
  // `muted` is { [sightingId]: untilMs }.
  function pick(sightings, me, pos, nowMs, muted) {
    const radius = cfg().radiusM;
    let best = null;
    (sightings || []).forEach(s => {
      if (!isAskable(s, me, nowMs)) return;
      if ((muted && muted[s.id]) > nowMs) return;
      const d = distanceM(s, pos.lat, pos.lon);
      if (d <= radius && (!best || d < best.distance)) best = { sighting: s, distance: d };
    });
    return best;
  }

  // =========================================================== cool-downs

  const MUTE_KEY = 'netsight_check_mute';

  function readMuted() {
    try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function writeMuted(map) {
    const now = Date.now();
    Object.keys(map).forEach(k => { if (map[k] <= now) delete map[k]; });
    try { localStorage.setItem(MUTE_KEY, JSON.stringify(map)); } catch (e) { /* the database still enforces its own limit */ }
  }

  function mute(id, ms) {
    const map = readMuted();
    map[id] = Date.now() + ms;
    writeMuted(map);
  }

  // ========================================================== the answer

  const LOCAL_CHECKS = 'netsight_gear_checks';
  const NEEDED = 2;                          // keep equal to 008_gear_checks.sql

  function readLocalChecks() {
    try { return JSON.parse(localStorage.getItem(LOCAL_CHECKS) || '[]') || []; } catch (e) { return []; }
  }

  // Sends one answer. Cloud: one row; the database applies the rules.
  // Local mode (no Supabase): applies the same rules itself so the feature can be tried.
  async function answer(sighting, value, distance, pos) {
    const me = (typeof Auth !== 'undefined' && Auth.current()) || null;
    if (!me) return { ok: false, message: 'Sign in first' };
    if (value !== 'here' && value !== 'gone') return { ok: false, message: 'Unknown answer' };

    const client = (Auth.isCloud && Auth.isCloud()) ? Auth.client() : null;

    if (client) {
      const { error } = await client.from('gear_checks').insert({
        sighting_id: sighting.id,
        user_id: me.id,
        user_name: me.username,
        answer: value,
        distance_m: Number.isFinite(distance) ? Math.round(distance) : null,
        // The database measures the distance itself from this position and
        // refuses answers from far away (supabase/migrations/010_vote_distance.sql).
        user_lat: pos ? pos.lat : null,
        user_lon: pos ? pos.lon : null
      });
      // Already answered in the last 6 hours: nothing to do, not a failure.
      if (error && error.code !== '23505') return { ok: false, message: error.message };
      mute(sighting.id, cfg().cooldownHours * 3600000);
      return { ok: true };
    }

    // ---- local mode, same rules as the database trigger
    const now = new Date().toISOString();
    const checks = readLocalChecks();
    const recent = checks.find(c => c.sightingId === sighting.id && c.userId === me.id &&
      Date.now() - new Date(c.createdAt).getTime() < 6 * 3600000);
    if (recent) { mute(sighting.id, cfg().cooldownHours * 3600000); return { ok: true }; }

    checks.push({ sightingId: sighting.id, userId: me.id, userName: me.username, answer: value, createdAt: now });
    try { localStorage.setItem(LOCAL_CHECKS, JSON.stringify(checks)); } catch (e) { /* ignore */ }

    const s = await StoreModule.getSightingUnified(sighting.id);
    if (s) {
      if (value === 'here') {
        await StoreModule.updateSightingUnified(s.id, { last_confirmed_at: now, confirmations: (s.confirmations || 0) + 1, gone_votes: 0 });
      } else {
        const since = s.last_confirmed_at ? new Date(s.last_confirmed_at).getTime() : -Infinity;
        const voters = new Set(checks.filter(c => c.sightingId === s.id && c.answer === 'gone' &&
          new Date(c.createdAt).getTime() > since).map(c => c.userId));
        if (voters.size >= NEEDED && !s.verdict && (s.status === 'new' || s.status === 'reported')) {
          await StoreModule.updateSightingUnified(s.id, {
            gone_votes: voters.size, status: 'resolved', handled_by: 'boaters', handled_at: now,
            note: ((s.note ? s.note + ' · ' : '') + 'Gone: ' + voters.size + ' boaters').slice(0, 500)
          });
        } else {
          await StoreModule.updateSightingUnified(s.id, { gone_votes: voters.size });
        }
      }
    }
    mute(sighting.id, cfg().cooldownHours * 3600000);
    return { ok: true };
  }

  // Who answered what for one report: [{ userName, answer, createdAt }], oldest first.
  async function votesFor(id) {
    const client = (Auth.isCloud && Auth.isCloud()) ? Auth.client() : null;
    if (client) {
      const { data } = await client.from('gear_checks')
        .select('user_name, answer, created_at').eq('sighting_id', id).order('created_at', { ascending: true });
      return (data || []).map(r => ({ userName: r.user_name, answer: r.answer, createdAt: r.created_at }));
    }
    return readLocalChecks().filter(c => c.sightingId === id)
      .map(c => ({ userName: c.userName, answer: c.answer, createdAt: c.createdAt }));
  }

  function skip(sighting) {
    mute(sighting.id, cfg().snoozeMinutes * 60000);
  }

  // ============================================================ watching

  let sightings = [];
  let loadedAt = 0;
  let loading = false;
  let stopWatch = null;
  let timer = null;
  let lastPos = null;
  let asking = false;
  let handlers = null;
  let state = { kind: 'idle', text: '' };

  function setState(kind, text) {
    if (state.kind === kind && state.text === text) return;
    state = { kind, text };
    if (handlers && handlers.onState) handlers.onState(state);
  }

  async function reload() {
    if (loading) return;
    loading = true;
    try {
      sightings = await StoreModule.getSightingsUnified(500);
      loadedAt = Date.now();
    } catch (e) { /* keep what we had; the next tick tries again */ }
    loading = false;
  }

  function hhmm(d) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // The clock can be replaced for testing (browser only, see boat.js).
  let clock = () => new Date();
  function setClock(fn) { clock = fn || (() => new Date()); }

  function tick() {
    if (!lastPos || !handlers) return;
    const now = clock();

    if (Date.now() - loadedAt > cfg().refreshMs) reload();

    if (!isDaylight(now, lastPos.lat, lastPos.lon)) {
      const next = nextSunrise(now, lastPos.lat, lastPos.lon);
      setState('night', 'Gear checks paused until sunrise' + (next ? ' (' + hhmm(next) + ')' : ''));
      return;
    }
    if (lastPos.accuracy > cfg().minAccuracyM) {
      setState('weak', 'Gear checks waiting for a better GPS fix');
      return;
    }
    if (typeof Shore !== 'undefined') {
      const g = Shore.checkGeofence(lastPos.lat, lastPos.lon);
      if (g && g.onWater === false) { setState('land', 'Gear checks on while you are on the water'); return; }
    }
    setState('on', 'Gear checks on');

    if (asking || (handlers.canAsk && !handlers.canAsk())) return;

    const me = Auth.current();
    const found = pick(sightings, me, lastPos, Date.now(), readMuted());
    if (!found) return;

    asking = true;
    handlers.onAsk(found.sighting, found.distance, () => { asking = false; }, lastPos);
  }

  // handlers: { onAsk(sighting, distance, done), canAsk(), onState({kind,text}) }
  async function start(h) {
    stop();
    handlers = h;
    await reload();
    timer = setInterval(tick, cfg().tickMs);
    stopWatch = await Native.watch(p => { lastPos = p; }, () => setState('weak', 'Gear checks: no GPS'));
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (stopWatch) { stopWatch(); stopWatch = null; }
    asking = false;
    handlers = null;
  }

  const api = { setClock, sunTimes, isDaylight, nextSunrise, isAskable, pick, distanceM, answer, votesFor, skip, start, stop,
    reload, state: () => state };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();

if (typeof window !== 'undefined') window.StillThere = StillThere;
