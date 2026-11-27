// NetSight — boat mode.
//
// One file, one decision per screen. It reuses the website's modules (Auth,
// StoreModule, GearModule, CaseModule, IdentifyModule, Shore, Devices) and adds
// only what a phone on the water needs: big targets, native camera / GPS / QR,
// and undo instead of confirmation dialogs.
//
// Nothing here is offline-capable on purpose. A failed send keeps the report on
// screen with a big Retry.

(function () {
  'use strict';

  const UNDO_MS = 6000;      // how long an action can be taken back
  const SEND_DELAY_MS = 5000; // report is sent after this unless undone
  const GPS_REFRESH_MS = 4000;
  // Screens where a gear-check question may appear. Never mid-report or mid-decision.
  const CALM = ['home', 'nets', 'cases', 'identify', 'my-reports'];

  const CLASSES = {
    buoy:  { label: 'Buoy',  line: false },
    float: { label: 'Float', line: false },
    net:   { label: 'Net',   line: true },
    trap:  { label: 'Trap',  line: true }
  };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let session = null;
  let stack = ['home'];
  let gps = null;            // { lat, lon, accuracy, at } or { error }
  let gpsTimer = null;
  let draft = null;          // the report being made
  let sendTimer = null;
  let netDraft = null;
  let allCases = [];
  let closedCases = [];          // closed by boaters' votes in the last week
  let casesTab = 'decide';
  let thread = null;
  const decidingIds = new Set();   // decided but still inside the undo window: hidden from the list
  let currentCase = null;

  // ============================================================ navigation

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('is-active', s.id === 'screen-' + id));
    const el = $('screen-' + id);
    $('bar-title').textContent = (el && el.dataset.title) || 'NetSight';
    $('bar').dataset.home = id === 'home' ? 'true' : 'false';
    window.scrollTo(0, 0);
    onEnter(id);
  }

  function go(id) {
    if (stack[stack.length - 1] !== id) stack.push(id);
    show(id);
  }

  function replace(id) {
    stack[stack.length - 1] = id;
    show(id);
  }

  function goHome() {
    stack = ['home'];
    show('home');
  }

  // Returns true if it moved back; false when already home (Android back uses this).
  function back() {
    const leaving = stack[stack.length - 1];
    if (leaving === 'report-send') cancelSend();
    if (leaving === 'report-done') { goHome(); return true; }
    if (stack.length <= 1) return false;
    stack.pop();
    show(stack[stack.length - 1]);
    return true;
  }

  function onEnter(id) {
    stopGpsLoop();
    if (id === 'home') { refreshGps(); renderHome(); }
    if (id === 'report-place') { startGpsLoop(); renderPlace(); }
    if (id === 'report-photo') renderPhoto();
    if (id === 'nets') renderNets();
    if (id === 'net-new') { startGpsLoop(); renderNetNew(); }
    if (id === 'cases') { refreshGps(); loadCases(); }
    if (id === 'my-reports') renderMyReports();
    if (id === 'diag') renderDiag();
    if (id === 'identify') $('id-code').value = '';
  }

  // =============================================================== feedback

  let toastTimer = null;
  function toast(message, ok) {
    const t = $('toast');
    t.textContent = message;
    t.classList.toggle('toast--ok', !!ok);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  // Runs `run` after UNDO_MS unless the person presses Undo. Only one at a time:
  // starting a second one commits the first straight away.
  let pending = null;

  function withUndo(message, run, onUndo) {
    flushPending();

    const bar = $('undo');
    $('undo-text').textContent = message;
    const timeEl = $('undo-bar');
    timeEl.style.setProperty('--ms', UNDO_MS + 'ms');
    timeEl.classList.remove('run');
    void timeEl.offsetWidth;            // restart the animation
    timeEl.classList.add('run');
    bar.hidden = false;

    const entry = { run, onUndo, timer: null };
    entry.timer = setTimeout(() => flushPending(), UNDO_MS);
    pending = entry;
  }

  function flushPending() {
    if (!pending) return;
    const entry = pending;
    pending = null;
    clearTimeout(entry.timer);
    $('undo').hidden = true;
    Promise.resolve(entry.run()).catch(err => toast(friendly(err)));
  }

  function undoPending() {
    if (!pending) return;
    const entry = pending;
    pending = null;
    clearTimeout(entry.timer);
    $('undo').hidden = true;
    if (entry.onUndo) entry.onUndo();
  }

  // An action still counting down when the app is put away must not be lost.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });

  function friendly(err) {
    const m = String((err && err.message) || err || 'Something went wrong');
    if (/failed to fetch|network|load failed/i.test(m)) return 'No connection. Check your signal and try again.';
    return m;
  }

  // ====================================================================== GPS

  async function refreshGps() {
    try {
      const p = await Native.position();
      gps = { lat: p.lat, lon: p.lon, accuracy: p.accuracy, at: Date.now() };
    } catch (err) {
      gps = { error: friendly(err) };
    }
    paintGps();
  }

  function paintGps() {
    const dot = $('gps-dot');
    const text = $('status-text');
    if (!gps) { dot.dataset.state = ''; text.textContent = 'Looking for GPS…'; }
    else if (gps.error) { dot.dataset.state = 'bad'; text.textContent = gps.error; }
    else {
      const m = Math.round(gps.accuracy);
      dot.dataset.state = m <= 25 ? 'ok' : (m <= 100 ? 'weak' : 'bad');
      text.textContent = 'GPS ±' + m + ' m';
    }
    const active = stack[stack.length - 1];
    if (active === 'report-place') renderPlace();
    if (active === 'net-new') renderNetNew();
  }

  function startGpsLoop() {
    stopGpsLoop();
    refreshGps();
    gpsTimer = setInterval(refreshGps, GPS_REFRESH_MS);
  }

  function stopGpsLoop() {
    clearInterval(gpsTimer);
    gpsTimer = null;
  }

  function haveFix() { return gps && !gps.error && Number.isFinite(gps.lat); }

  function fixLine() {
    if (!gps) return 'Looking for GPS…';
    if (gps.error) return gps.error;
    return gps.lat.toFixed(5) + ', ' + gps.lon.toFixed(5);
  }

  // ===================================================================== home

  function renderHome() {
    const role = session.role;
    document.querySelectorAll('[data-role-show]').forEach(el => {
      el.hidden = !el.dataset.roleShow.split(' ').includes(role);
    });
    // Staff see Cases and Identify; the boater's "My nets" is for owners only.
    $('admin-note').hidden = role !== 'admin';
    if (role === 'patrol' || role === 'admin') updateCaseCount();
    if (role === 'user') updateReplyCount();
  }

  // Same rule as the website's To-do list: open, and nobody has decided yet.
  function needsDecision(c) { return CaseModule.isOpen(c) && !c.verdict; }

  async function updateCaseCount() {
    try {
      const all = await StoreModule.getSightingsUnified(500);
      const open = all.filter(needsDecision).length;
      const b = $('case-count');
      b.textContent = open;
      b.hidden = open === 0;
    } catch (e) { /* the list screen reports errors; the badge just stays hidden */ }
  }

  // ================================================================== report

  function newDraft(cls) {
    const id = (crypto.randomUUID && crypto.randomUUID()) || 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return { id, cls, lat: null, lon: null, accuracy: null, span: null, file: null, photoUrl: '', previewUrl: null, ends: [] };
  }

  function renderPlace() {
    const body = $('place-body');
    if (!draft) { body.innerHTML = ''; return; }
    const line = CLASSES[draft.cls].line;

    if (!line) {
      const fence = haveFix() ? Devices.checkGeofence(gps.lat, gps.lon) : null;
      const blocked = fence && !fence.allowed;
      body.innerHTML =
        '<div class="pos ' + (haveFix() ? (blocked ? 'pos--bad' : 'pos--ok') : '') + '">' +
          'Your position' +
          '<small>' + esc(fixLine()) + (haveFix() ? ' · ±' + Math.round(gps.accuracy) + ' m' : '') + '</small>' +
          (blocked ? '<small>' + esc(fence.reason) + '</small>' : '') +
        '</div>' +
        '<p class="sub">Stop next to the ' + esc(CLASSES[draft.cls].label.toLowerCase()) + ', then confirm.</p>' +
        '<button type="button" class="btn btn--hero btn--go" id="btn-place" ' + (!haveFix() || blocked ? 'disabled' : '') + '>' +
          '<span class="btn__icon">◎</span>Confirm location</button>';
      $('btn-place').onclick = () => {
        draft.lat = gps.lat; draft.lon = gps.lon; draft.accuracy = Math.round(gps.accuracy);
        go('report-photo');
      };
      return;
    }

    // A net or trap is a line: two ends, each marked where the boat is.
    const a = draft.ends[0];
    const b = draft.ends[1];
    const ready = haveFix();
    const label = !a ? 'Mark first end' : (!b ? 'Mark second end' : '');
    let check = null;
    if (a && b) check = Shore.checkSpan([a.lat, a.lon], [b.lat, b.lon]);

    body.innerHTML =
      '<div class="pos ' + (ready ? 'pos--ok' : '') + '">' +
        'Your position<small>' + esc(fixLine()) + (ready ? ' · ±' + Math.round(gps.accuracy) + ' m' : '') + '</small>' +
      '</div>' +
      '<div class="kv"><b>First end</b><span>' + (a ? esc(a.lat.toFixed(5) + ', ' + a.lon.toFixed(5)) : 'not marked') + '</span></div>' +
      '<div class="kv"><b>Second end</b><span>' + (b ? esc(b.lat.toFixed(5) + ', ' + b.lon.toFixed(5)) : 'not marked') + '</span></div>' +
      (check && !check.allowed ? '<div class="pos pos--bad">' + esc(check.reason) + '</div>' : '') +
      (label
        ? '<button type="button" class="btn btn--hero btn--go" id="btn-mark" ' + (ready ? '' : 'disabled') + '><span class="btn__icon">◎</span>' + label + '</button>'
        : (check && check.allowed
            ? '<button type="button" class="btn btn--hero btn--go" id="btn-place-line"><span class="btn__icon">✓</span>Confirm net line</button>'
            : ''));

    if (a) {
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'btn btn--quiet'; reset.textContent = 'Start over';
      reset.onclick = () => { draft.ends = []; renderPlace(); };
      body.appendChild(reset);
    }

    const mark = $('btn-mark');
    if (mark) mark.onclick = () => {
      draft.ends.push({ lat: gps.lat, lon: gps.lon, accuracy: gps.accuracy });
      renderPlace();
    };
    const done = $('btn-place-line');
    if (done) done.onclick = () => {
      const [p, q] = draft.ends;
      draft.span = [[p.lat, p.lon], [q.lat, q.lon]];
      const mid = Shore.spanMidpoint(draft.span[0], draft.span[1]);
      draft.lat = mid[0]; draft.lon = mid[1];
      draft.accuracy = null;
      go('report-photo');
    };
  }

  function renderPhoto() {
    const has = !!draft.file;
    $('photo-preview').hidden = !has;
    if (has) $('photo-img').src = draft.previewUrl;
    $('btn-photo-text').textContent = has ? 'Retake photo' : 'Take photo';
    $('btn-send').hidden = !has;
    $('btn-send-nophoto').hidden = has;
  }

  async function takePhoto() {
    try {
      const file = await Native.photo();
      if (!file) return;
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      draft.file = file;
      draft.photoUrl = '';               // a new photo must be uploaded again
      draft.previewUrl = URL.createObjectURL(file);
      renderPhoto();
    } catch (err) {
      toast(friendly(err));
    }
  }

  function startSend() {
    go('report-send');
    let left = Math.round(SEND_DELAY_MS / 1000);
    $('send-count').textContent = left;
    $('send-text').textContent = 'Sending…';
    clearInterval(sendTimer);
    sendTimer = setInterval(() => {
      left -= 1;
      $('send-count').textContent = Math.max(left, 0);
      if (left <= 0) { clearInterval(sendTimer); sendTimer = null; doSend(); }
    }, 1000);
  }

  function cancelSend() {
    clearInterval(sendTimer);
    sendTimer = null;
  }

  async function doSend() {
    $('send-text').textContent = 'Sending…';
    try {
      const d = draft;
      if (d.file && !d.photoUrl) d.photoUrl = await StoreModule.uploadPhoto(d.file, d.id);

      const gearMatch = GearModule.matchAt(d.lat, d.lon, d.cls, CONFIG.MATCH_RADIUS_M);
      const csvMatch = RegistryModule.matchRegistry({ lat: d.lat, lon: d.lon, user_class: d.cls }, CONFIG.MATCH_RADIUS_M);

      const v = StatusModule.validateSighting({
        photo_url: d.photoUrl,
        lat: d.lat, lon: d.lon, accuracy_m: d.accuracy,
        detected_class: 'unknown', confidence: 0,
        user_class: d.cls,
        registry_id: gearMatch ? gearMatch.gear.code : (csvMatch ? csvMatch.item.id : null),
        registry_match: !!(gearMatch || csvMatch),
        status: 'new', report_reason: null, note: '',
        span: d.span
      });
      if (!v.valid) throw new Error('Cannot save: ' + v.errors.join(', '));

      try {
        // The id is made once per report, so a retry after a lost reply cannot
        // create a second case.
        // In the cloud the database fills these in. In local mode nothing does, and
        // "My reports" and the age of a report need them.
        const localFields = Auth.isCloud() ? {} :
          { created_at: new Date().toISOString(), reported_by: session.id, reporter_name: session.username };
        await StoreModule.createSightingUnified(Object.assign({ id: d.id }, v.normalized, localFields));
      } catch (err) {
        if (!(err && (err.code === '23505' || /duplicate key/i.test(err.message || '')))) throw err;
      }

      $('done-text').textContent = gearMatch
        ? 'Reported. Registered to ' + gearMatch.gear.ownerName + '.'
        : 'Reported. Thank you.';
      endDraft();
      replace('report-done');
    } catch (err) {
      $('failed-text').textContent = friendly(err);
      replace('report-failed');
    }
  }

  function endDraft() {
    if (draft && draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    draft = null;
  }

  // ================================================================= my nets

  function lengthOf(g) {
    if (!Array.isArray(g.span) || g.span.length !== 2) return '';
    return Math.round(Shore.haversine(g.span[0][0], g.span[0][1], g.span[1][0], g.span[1][1])) + ' m';
  }

  async function renderNets() {
    const host = $('nets-list');
    host.innerHTML = '<p class="sub">Loading…</p>';
    try { await GearModule.load(); } catch (e) { /* mine() works from what is cached */ }
    const mine = GearModule.mine();

    if (!mine.length) {
      host.innerHTML = '<p class="lead">No nets yet.</p><p class="sub">Register a net so a patrol can see it is yours.</p>';
      return;
    }

    host.innerHTML = mine.map(g =>
      '<div class="card" style="cursor:default">' +
        '<div class="card__top"><span class="grow">' + esc(g.label) + '</span><span class="chip">' + esc(g.type) + '</span></div>' +
        '<div class="card__sub">' + esc(g.code) + (lengthOf(g) ? ' · ' + esc(lengthOf(g)) : '') + '</div>' +
        '<div class="grid">' +
          '<button type="button" class="btn" data-qr="' + esc(g.id) + '">Show code</button>' +
          '<button type="button" class="btn btn--warn" data-out="' + esc(g.id) + '">Taken out</button>' +
        '</div>' +
      '</div>').join('');

    host.querySelectorAll('[data-qr]').forEach(b => b.onclick = () => showNetQr(b.dataset.qr));
    host.querySelectorAll('[data-out]').forEach(b => b.onclick = () => takeNetOut(b.dataset.out));
  }

  function showNetQr(id) {
    const g = GearModule.get(id);
    if (!g) return;
    const svg = QrModule.render(g.code, { cellSize: 8 });
    $('qr-box').innerHTML = svg || '<p class="sub">QR is not available. Use the code below.</p>';
    $('qr-code').textContent = g.code;
    go('net-qr');
  }

  // "Taken out" removes the registration. It is hidden at once and only removed
  // for real when the undo time runs out.
  function takeNetOut(id) {
    const g = GearModule.get(id);
    if (!g) return;
    const card = document.querySelector('[data-out="' + CSS.escape(id) + '"]');
    const holder = card && card.closest('.card');
    if (holder) holder.hidden = true;

    withUndo(g.label + ' taken out', async () => {
      const ok = await GearModule.remove(id);
      if (!ok) toast('Could not remove ' + g.label + '. Try again.');
      if (stack[stack.length - 1] === 'nets') renderNets();
    }, () => { if (holder) holder.hidden = false; });
  }

  function renderNetNew() {
    const host = $('net-new-body');
    if (!host) return;
    if (!netDraft) {
      const d = new Date();
      netDraft = {
        type: 'net', ends: [],
        label: 'Net ' + d.getDate() + '.' + (d.getMonth() + 1)
      };
    }
    // Keep what was typed while the GPS line redraws.
    const typed = $('net-name');
    if (typed) netDraft.label = typed.value;

    const a = netDraft.ends[0], b = netDraft.ends[1];
    const ready = haveFix();
    const label = !a ? 'Mark first end' : (!b ? 'Mark second end' : '');
    const check = a && b ? Shore.checkSpan([a.lat, a.lon], [b.lat, b.lon]) : null;

    host.innerHTML =
      '<input class="input" id="net-name" type="text" maxlength="40" value="' + esc(netDraft.label) + '" aria-label="Net name">' +
      '<div class="grid">' +
        '<button type="button" class="tile tile--row' + (netDraft.type === 'net' ? ' is-on' : '') + '" data-type="net">🕸️ Net</button>' +
        '<button type="button" class="tile tile--row' + (netDraft.type === 'trap' ? ' is-on' : '') + '" data-type="trap">🧺 Trap</button>' +
      '</div>' +
      '<div class="pos ' + (ready ? 'pos--ok' : '') + '">Your position<small>' + esc(fixLine()) + '</small></div>' +
      '<div class="kv"><b>First end</b><span>' + (a ? 'marked' : 'not marked') + '</span></div>' +
      '<div class="kv"><b>Second end</b><span>' + (b ? 'marked' : 'not marked') + '</span></div>' +
      (check && !check.allowed ? '<div class="pos pos--bad">' + esc(check.reason) + '</div>' : '') +
      (label
        ? '<button type="button" class="btn btn--hero btn--go" id="btn-net-mark" ' + (ready ? '' : 'disabled') + '>◎ ' + label + '</button>'
        : (check && check.allowed ? '<button type="button" class="btn btn--hero btn--primary" id="btn-net-save">Save net</button>' : '')) +
      (a ? '<button type="button" class="btn btn--quiet" id="btn-net-reset">Start over</button>' : '');

    host.querySelectorAll('[data-type]').forEach(t => t.onclick = () => {
      netDraft.label = $('net-name').value;
      netDraft.type = t.dataset.type;
      renderNetNew();
    });
    const mark = $('btn-net-mark');
    if (mark) mark.onclick = () => {
      netDraft.label = $('net-name').value;
      netDraft.ends.push({ lat: gps.lat, lon: gps.lon });
      renderNetNew();
    };
    const reset = $('btn-net-reset');
    if (reset) reset.onclick = () => { netDraft.label = $('net-name').value; netDraft.ends = []; renderNetNew(); };
    const save = $('btn-net-save');
    if (save) save.onclick = saveNet;
  }

  async function saveNet() {
    const btn = $('btn-net-save');
    btn.disabled = true;
    const [p, q] = netDraft.ends;
    const result = await GearModule.add({
      label: $('net-name').value,
      type: netDraft.type,
      span: [[p.lat, p.lon], [q.lat, q.lon]]
    });
    if (!result.ok) { btn.disabled = false; toast(result.message || 'Could not save the net'); return; }
    netDraft = null;
    toast(result.gear.code + ' saved', true);
    stack.pop();                  // back to "My nets"
    show('nets');
  }

  // ================================================================= cases

  // Two lists, like the website: "To decide" (open, nobody has decided) and
  // "To collect" (accepted by patrol, still out there).
  async function loadCases() {
    const host = $('cases-list');
    host.innerHTML = '<p class="sub">Loading…</p>';
    try {
      await GearModule.load();
      const raw = await StoreModule.getSightingsUnified(500);
      allCases = raw.filter(c => CaseModule.isOpen(c));
      closedCases = raw.filter(isBoaterClosed);
    } catch (err) {
      host.innerHTML = '<p class="lead">Could not load cases.</p><p class="sub">' + esc(friendly(err)) + '</p>' +
        '<button type="button" class="btn btn--hero btn--go" id="btn-cases-retry">↻ Retry</button>';
      $('btn-cases-retry').onclick = loadCases;
      return;
    }
    renderCases();
  }

  const WEEK_MS = 7 * 86400000;
  // Closed automatically because 2 boaters said "gone": patrol should be able to see and undo that.
  function isBoaterClosed(c) {
    if (c.status !== 'resolved' || c.handled_by !== 'boaters') return false;
    const t = new Date(c.handled_at || c.updated_at || 0).getTime();
    return !Number.isFinite(t) || t === 0 || Date.now() - t < WEEK_MS;
  }

  const visibleCase = c => !decidingIds.has(c.id);
  const toDecide = () => CaseModule.sortForPatrol(allCases.filter(c => !c.verdict && visibleCase(c)));
  const toCollect = () => CaseModule.sortForPatrol(allCases.filter(c => c.verdict === 'accepted' && visibleCase(c)));
  const toClosed = () => closedCases.filter(visibleCase)
    .sort((a, b) => new Date(b.handled_at || 0) - new Date(a.handled_at || 0));

  function ageOf(iso) {
    if (!iso || Number.isNaN(new Date(iso).getTime())) return 'time unknown';
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return mins + ' min ago';
    if (mins < 60 * 48) return Math.round(mins / 60) + ' h ago';
    return Math.round(mins / 1440) + ' days ago';
  }

  function distanceText(c) {
    if (!haveFix() || !Number.isFinite(c.lat)) return '';
    const m = Devices.haversine(gps.lat, gps.lon, c.lat, c.lon);
    return m < 1000 ? Math.round(m) + ' m away' : (m / 1000).toFixed(1) + ' km away';
  }

  function renderCases() {
    const host = $('cases-list');
    const decide = toDecide();
    const collect = toCollect();
    const closed = toClosed();
    $('n-decide').textContent = decide.length;
    $('n-collect').textContent = collect.length;
    $('n-closed').textContent = closed.length;
    $('tab-closed').hidden = closed.length === 0 && casesTab !== 'closed';
    $('tab-decide').classList.toggle('is-on', casesTab === 'decide');
    $('tab-collect').classList.toggle('is-on', casesTab === 'collect');
    $('tab-closed').classList.toggle('is-on', casesTab === 'closed');

    if (casesTab === 'closed') {
      if (!closed.length) {
        host.innerHTML = '<p class="lead">Nothing closed by boaters.</p><p class="sub">Reports that two boaters say are gone appear here for a week, so you can reopen them.</p>';
        return;
      }
      host.innerHTML = closed.map(c =>
        '<button type="button" class="card" data-case="' + esc(c.id) + '">' +
          '<div class="card__top"><span class="grow">' + esc((CLASSES[c.user_class] || {}).label || 'Gear') + '</span>' +
            '<span class="chip chip--warn">Closed by boaters</span></div>' +
          '<div class="card__sub">Closed ' + esc(ageOf(c.handled_at)) + (distanceText(c) ? ' · ' + esc(distanceText(c)) : '') + '</div>' +
          '<div class="card__sub">Reported ' + esc(ageOf(c.created_at)) + '</div>' +
        '</button>').join('');
      host.querySelectorAll('[data-case]').forEach(b => b.onclick = () => openClosed(b.dataset.case));
      return;
    }

    const list = casesTab === 'decide' ? decide : collect;
    if (!list.length) {
      host.innerHTML = casesTab === 'decide'
        ? '<p class="lead">All clear.</p><p class="sub">Nothing is waiting for a decision.</p>'
        : '<p class="lead">Nothing to collect.</p><p class="sub">Accepted cases appear here until they are collected or gone.</p>';
      return;
    }

    host.innerHTML = list.map(c => {
      const sev = CaseModule.severityInfo(c.severity);
      const gone = Number(c.gone_votes) > 0;
      return '<button type="button" class="card" data-case="' + esc(c.id) + '">' +
        '<div class="card__top"><span class="grow">' + esc((CLASSES[c.user_class] || {}).label || 'Gear') + '</span>' +
          (gone ? '<span class="chip chip--warn">' + esc(c.gone_votes) + ' say gone</span>' : '') +
          (sev ? '<span class="chip chip--' + esc(sev.tone) + '">' + esc(sev.label) + '</span>' : '') + '</div>' +
        '<div class="card__sub">' + esc(ageOf(c.created_at)) + (distanceText(c) ? ' · ' + esc(distanceText(c)) : '') + '</div>' +
        '<div class="card__sub">' + (c.registry_match ? 'Registered' : 'Nobody registered it') +
          (c.last_confirmed_at ? ' · still there ' + esc(ageOf(c.last_confirmed_at)) : '') + '</div>' +
      '</button>';
    }).join('');
    host.querySelectorAll('[data-case]').forEach(b => b.onclick = () => openCase(b.dataset.case));
  }

  function openCase(id) {
    currentCase = allCases.find(c => c.id === id);
    if (!currentCase) return;
    const c = currentCase;
    const accepted = c.verdict === 'accepted';
    const gear = c.registry_match && c.registry_id ? GearModule.findByCode(c.registry_id) : null;
    const len = Array.isArray(c.span) && c.span.length === 2
      ? Math.round(Devices.haversine(c.span[0][0], c.span[0][1], c.span[1][0], c.span[1][1])) + ' m long' : '';
    const gone = Number(c.gone_votes) > 0;

    $('case-body').innerHTML =
      (c.photo_url ? '<img class="photo" src="' + esc(c.photo_url) + '" alt="Photo of the report">' : '') +
      '<div class="kv"><b>' + esc((CLASSES[c.user_class] || {}).label || 'Gear') + (len ? ' · ' + esc(len) : '') + '</b>' +
        '<span>' + esc(ageOf(c.created_at)) + (distanceText(c) ? ' · ' + esc(distanceText(c)) : '') + '</span></div>' +
      '<div class="kv"><b>' + (gear ? esc(gear.ownerName) + ' · ' + esc(gear.code) : (c.registry_match ? 'Registered' : 'Nobody registered it')) + '</b>' +
        (c.reporter_name ? '<span>Reported by ' + esc(c.reporter_name) + '</span>' : '') + '</div>' +
      (gone ? '<div class="pos pos--bad">' + esc(c.gone_votes) + ' boater' + (c.gone_votes > 1 ? 's' : '') + ' say it is gone. Check before you go out.</div>' : '') +
      (c.last_confirmed_at ? '<div class="kv"><span>Boaters saw it still there ' + esc(ageOf(c.last_confirmed_at)) + '</span></div>' : '') +
      (c.note ? '<div class="kv"><span>' + esc(c.note) + '</span></div>' : '') +
      (accepted
        ? '<button type="button" class="btn btn--hero btn--go" id="btn-collected"><span class="btn__icon">✓</span>Collected</button>' +
          '<button type="button" class="btn btn--hero" id="btn-gonenow"><span class="btn__icon">✕</span>Not there</button>'
        : '<button type="button" class="btn btn--hero btn--go" id="btn-accept">Accept</button>' +
          '<button type="button" class="btn btn--hero" id="btn-decline">Decline</button>') +
      '<button type="button" class="btn btn--big" id="btn-map"><span class="btn__icon">📍</span>Open in maps</button>' +
      (c.reported_by ? '<button type="button" class="btn btn--big" id="btn-ask"><span class="btn__icon">💬</span>Ask the reporter</button>' : '');

    if (accepted) {
      $('btn-collected').onclick = () => closeOut(c, 'Collected');
      $('btn-gonenow').onclick = () => closeOut(c, 'Not there');
    } else {
      $('btn-accept').onclick = () => go('case-accept');
      $('btn-decline').onclick = () => go('case-decline');
    }
    $('btn-map').onclick = () => Native.openMap(c.lat, c.lon, (CLASSES[c.user_class] || {}).label || 'Gear');
    const ask = $('btn-ask');
    if (ask) ask.onclick = () => openThread(c);
    go('case');
  }

  // A report closed because 2 boaters said it is gone. Patrol sees who said so
  // and can reopen it. Reopening also resets the vote count, so the same two
  // answers cannot close it again straight away.
  async function openClosed(id) {
    const c = closedCases.find(x => x.id === id);
    if (!c) return;
    currentCase = c;
    $('case-body').innerHTML = '<p class="sub">Loading…</p>';
    go('case');

    let votes = [];
    try { votes = (await StillThere.votesFor(c.id)).filter(v => v.answer === 'gone'); } catch (e) { /* the page still works without the list */ }
    if (currentCase !== c) return;

    $('case-body').innerHTML =
      (c.photo_url ? '<img class="photo" src="' + esc(c.photo_url) + '" alt="Photo of the report">' : '') +
      '<div class="pos pos--bad">Closed by boaters ' + esc(ageOf(c.handled_at)) + '. Check it before you trust it.</div>' +
      '<div class="kv"><b>' + esc((CLASSES[c.user_class] || {}).label || 'Gear') + '</b>' +
        '<span>Reported ' + esc(ageOf(c.created_at)) + (c.reporter_name ? ' by ' + esc(c.reporter_name) : '') + '</span></div>' +
      '<div class="kv"><b>Said it is gone</b><span>' + (votes.length
        ? votes.map(v => esc(v.userName) + ' · ' + esc(ageOf(v.createdAt))).join('<br>')
        : 'No names available') + '</span></div>' +
      '<button type="button" class="btn btn--hero btn--primary" id="btn-reopen"><span class="btn__icon">↺</span>Reopen</button>' +
      '<button type="button" class="btn btn--big" id="btn-map"><span class="btn__icon">📍</span>Open in maps</button>';

    $('btn-reopen').onclick = () => reopenCase(c);
    $('btn-map').onclick = () => Native.openMap(c.lat, c.lon, (CLASSES[c.user_class] || {}).label || 'Gear');
  }

  function reopenCase(c) {
    decidingIds.add(c.id);
    stack = ['home', 'cases'];
    show('cases');
    withUndo('Reopened: ' + ((CLASSES[c.user_class] || {}).label || 'gear'), async () => {
      try {
        await StoreModule.updateSightingUnified(c.id, {
          status: 'reported',
          handled_by: null,
          handled_at: null,
          gone_votes: 0,
          last_confirmed_at: new Date().toISOString(),
          note: ((c.note ? c.note + ' · ' : '') + 'Reopened by ' + session.username).slice(0, 500)
        });
      } catch (err) {
        toast(friendly(err));
      } finally {
        decidingIds.delete(c.id);
        if (stack[stack.length - 1] === 'cases') loadCases();
      }
    }, () => {
      decidingIds.delete(c.id);
      if (stack[stack.length - 1] === 'cases') renderCases();
    });
  }

  // Closing an accepted case: hidden at once, written for real after the undo time.
  function closeOut(c, what) {
    decidingIds.add(c.id);
    stack = ['home', 'cases'];
    show('cases');
    withUndo(what + ': ' + ((CLASSES[c.user_class] || {}).label || 'gear'), async () => {
      try {
        await StoreModule.updateSightingUnified(c.id, {
          status: 'resolved',
          handled_by: session.username,
          handled_at: new Date().toISOString(),
          note: ((c.note ? c.note + ' · ' : '') + what).slice(0, 500)
        });
      } catch (err) {
        toast(friendly(err));
      } finally {
        decidingIds.delete(c.id);
        if (stack[stack.length - 1] === 'cases') loadCases();
      }
    }, () => {
      decidingIds.delete(c.id);
      if (stack[stack.length - 1] === 'cases') renderCases();
    });
  }

  // Severity and decline reasons are big tiles. Pressing one is the decision;
  // it is sent after the undo time.
  function paintTiles(hostId, entries, onPick) {
    $(hostId).innerHTML = entries.map(e =>
      '<button type="button" class="tile tile--row tile--' + esc(e.tone || 'muted') + '" data-pick="' + esc(e.id) + '">' +
        '<span>' + esc(e.label) + '<span class="tile__hint">' + esc(e.hint) + '</span></span></button>').join('');
    $(hostId).querySelectorAll('[data-pick]').forEach(b => b.onclick = () => onPick(b.dataset.pick));
  }

  function decide(kind, key, label) {
    const c = currentCase;
    // Back to the list straight away; the case disappears from it.
    decidingIds.add(c.id);
    stack = ['home', 'cases'];
    show('cases');

    withUndo(label, async () => {
      try {
        const r = await CaseModule.decide(c.id, kind === 'accept' ? { kind, severity: key } : { kind, reason: key });
        if (!r.ok) toast(r.message || 'Could not save the decision');
      } finally {
        decidingIds.delete(c.id);
        if (stack[stack.length - 1] === 'cases') loadCases();
      }
    }, () => {
      decidingIds.delete(c.id);
      if (stack[stack.length - 1] === 'cases') renderCases();
    });
  }

  function initCasePickers() {
    paintTiles('accept-body',
      CaseModule.SEVERITY_ORDER.map(id => Object.assign({}, CaseModule.SEVERITY[id], { hint: CaseModule.SEVERITY[id].short + ' · ' + CaseModule.SEVERITY[id].hint })),
      id => decide('accept', id, 'Accepted as ' + CaseModule.SEVERITY[id].label));
    paintTiles('decline-body',
      Object.keys(CaseModule.DECLINE_REASONS).map(id => CaseModule.DECLINE_REASONS[id]),
      id => decide('decline', id, 'Declined: ' + CaseModule.DECLINE_REASONS[id].label));
  }

  // ================================================================ messages
  //
  // The patrol asks the reporter a question; the reporter answers. Both sides use
  // big tiles with the common sentences, plus a text box. Sending has the same
  // undo window as everything else.

  const STAFF_TILES = ['Which side of the water is it?', 'Is it still there?', 'How big is it?', 'Thank you.'];
  const REPORTER_TILES = ['It is still there.', 'It is gone now.', 'Left bank.', 'Right bank.'];

  function openThread(c) {
    thread = { c };
    go('thread');
    renderThread();
  }

  async function renderThread() {
    if (!thread) return;
    const c = thread.c;
    const host = $('thread-body');
    host.innerHTML = '<p class="sub">Loading…</p>';
    const msgs = await CaseModule.messages(c.id);
    if (!thread || thread.c.id !== c.id) return;

    const staff = session.role === 'patrol' || session.role === 'admin';
    const tiles = staff ? STAFF_TILES : REPORTER_TILES;

    host.innerHTML =
      '<div class="kv"><b>' + esc((CLASSES[c.user_class] || {}).label || 'Gear') + ' report</b><span>' + esc(ageOf(c.created_at)) + '</span></div>' +
      '<div class="bubbles">' + (msgs.length
        ? msgs.map(m => '<div class="bubble ' + (m.authorName === session.username ? 'bubble--me' : 'bubble--them') + '">' +
            '<small>' + esc(m.authorName) + (m.authorRole !== 'user' ? ' · patrol' : '') + ' · ' + esc(ageOf(m.createdAt)) + '</small>' + esc(m.text) + '</div>').join('')
        : '<p class="sub">No messages yet.</p>') + '</div>' +
      '<div class="grid grid--one">' + tiles.map((t, i) =>
        '<button type="button" class="tile tile--row" data-msg="' + i + '">' + esc(t) + '</button>').join('') + '</div>' +
      '<div class="send-row"><input class="input" id="msg-text" type="text" maxlength="300" placeholder="Write a message" aria-label="Message">' +
        '<button type="button" class="btn btn--big btn--primary" id="msg-send">Send</button></div>';

    host.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => queueMessage(tiles[Number(b.dataset.msg)]));
    $('msg-send').onclick = () => {
      const t = $('msg-text').value.trim();
      if (!t) { toast('Write something first.'); return; }
      queueMessage(t);
    };
  }

  function queueMessage(text) {
    const c = thread && thread.c;
    if (!c) return;
    withUndo('Message sent', async () => {
      const r = await CaseModule.sendMessage(c.id, text);
      if (!r.ok) toast(r.message || 'Message not sent');
      if (stack[stack.length - 1] === 'thread') renderThread();
    }, () => {});
  }

  // Reports I made, with the ones the patrol has written to marked.
  async function myReportsState() {
    const all = await StoreModule.getSightingsUnified(500);
    const mine = all.filter(s => s.reported_by && s.reported_by === session.id)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 15);
    return Promise.all(mine.map(async s => {
      const msgs = await CaseModule.messages(s.id);
      const last = msgs[msgs.length - 1] || null;
      return { s, last, waiting: !!(last && last.authorRole !== 'user') };
    }));
  }

  async function renderMyReports() {
    const host = $('myreports-list');
    host.innerHTML = '<p class="sub">Loading…</p>';
    let rows;
    try { rows = await myReportsState(); } catch (err) {
      host.innerHTML = '<p class="lead">Could not load.</p><p class="sub">' + esc(friendly(err)) + '</p>';
      return;
    }
    if (!rows.length) {
      host.innerHTML = '<p class="lead">No reports yet.</p><p class="sub">Reports you send appear here, with any question from the patrol.</p>';
      return;
    }
    host.innerHTML = rows.map(r =>
      '<button type="button" class="card" data-rep="' + esc(r.s.id) + '">' +
        '<div class="card__top"><span class="grow">' + esc((CLASSES[r.s.user_class] || {}).label || 'Gear') + '</span>' +
          (r.waiting ? '<span class="chip chip--warn">Reply waiting</span>' : '') +
          '<span class="chip">' + esc((StatusModule.LABELS || {})[r.s.status] || r.s.status) + '</span></div>' +
        '<div class="card__sub">' + esc(ageOf(r.s.created_at)) + '</div>' +
        (r.last ? '<div class="card__sub">“' + esc(r.last.text.slice(0, 70)) + '”</div>' : '') +
      '</button>').join('');
    host.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => {
      const row = rows.find(r => r.s.id === b.dataset.rep);
      if (row) openThread(row.s);
    });
  }

  async function updateReplyCount() {
    try {
      const rows = await myReportsState();
      const n = rows.filter(r => r.waiting).length;
      const b = $('reply-count');
      b.textContent = n;
      b.hidden = n === 0;
    } catch (e) { /* the list screen reports errors; the badge just stays hidden */ }
  }

  // ============================================================ gear checks

  // "Is it still there?" pop-up. The answer is sent after the undo time; Undo
  // brings the question back.
  function showAsk(s, distance, done, pos) {
    const type = ((CLASSES[s.user_class] || {}).label || 'Gear').toLowerCase();
    $('ask-title').textContent = 'Is the ' + type + ' still here?';
    $('ask-dist').textContent = Math.round(distance) + ' m away';
    $('ask-sub').textContent = 'Reported ' + ageOf(s.created_at) +
      (s.last_confirmed_at ? ' · seen ' + ageOf(s.last_confirmed_at) : '');
    const img = $('ask-photo');
    img.hidden = !s.photo_url;
    if (s.photo_url) img.src = s.photo_url;
    $('ask').hidden = false;
    if (!pos) pos = lastKnownPos();
    Native.buzz();

    const send = value => {
      $('ask').hidden = true;
      withUndo(value === 'here' ? '“Still here” sent' : '“Gone” sent', async () => {
        const r = await StillThere.answer(s, value, distance, pos);
        if (!r.ok) { toast(r.message || 'Answer not sent'); StillThere.skip(s); }
        done();
        StillThere.reload();
      }, () => showAsk(s, distance, done, pos));
    };
    $('ask-here').onclick = () => send('here');
    $('ask-gone').onclick = () => send('gone');
    $('ask-skip').onclick = () => { $('ask').hidden = true; StillThere.skip(s); done(); };
  }

  // Questions only appear on calm screens, never in the middle of a report.
  function canAsk() {
    return CALM.includes(stack[stack.length - 1]) && $('ask').hidden && !pending;
  }

  function lastKnownPos() {
    return haveFix() ? { lat: gps.lat, lon: gps.lon, accuracy: gps.accuracy } : null;
  }

  // Keep the screen on while gear checks run: Android stops GPS for an app whose
  // screen is off. Released at night, on land, and when the app is put away.
  let wake = null;
  let wantAwake = false;

  async function wakeOn() {
    if (wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch (e) { /* not allowed right now: checks still run while the screen is on */ }
  }

  function wakeOff() {
    if (wake) { wake.release().catch(() => {}); wake = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantAwake) wakeOn();
  });

  function paintWatch(st) {
    const cfgAwake = !!(CONFIG.STILL_THERE && CONFIG.STILL_THERE.keepAwake);
    wantAwake = cfgAwake && !!st && (st.kind === 'on' || st.kind === 'weak');
    if (wantAwake) wakeOn(); else wakeOff();

    const line = $('watch-line');
    line.hidden = !st || !st.text;
    $('watch-text').textContent = st ? st.text : '';
    $('watch-dot').dataset.state = st && st.kind === 'on' ? 'ok' : (st && (st.kind === 'night' || st.kind === 'weak') ? 'weak' : '');
  }

  function startGearChecks() {
    // Desktop testing only: localStorage.netsight_mock_time = an ISO time.
    if (!Native.isNative) {
      StillThere.setClock(() => {
        try { const m = localStorage.getItem('netsight_mock_time'); if (m) return new Date(m); } catch (e) { /* real clock */ }
        return new Date();
      });
    }
    StillThere.start({ onAsk: showAsk, canAsk, onState: paintWatch })
      .catch(err => { console.warn('Gear checks did not start:', err); });
  }

  // ======================================================== test this phone

  function renderDiag() {
    const t = StillThere.sunTimes(new Date(), gps && gps.lat ? gps.lat : CONFIG.MAP_CENTER[0], gps && gps.lon ? gps.lon : CONFIG.MAP_CENTER[1]);
    const clock = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('diag-body').innerHTML =
      '<p class="sub">' + (Native.isNative ? 'Phone app' : 'Browser: the camera opens a file picker and QR scanning is not available here') +
        ' · build ' + esc(CONFIG.BUILD) + '</p>' +
      '<div class="diag"><button type="button" class="btn btn--big" id="d-gps">◎ Test GPS</button><div class="diag__out" id="d-gps-out"></div></div>' +
      '<div class="diag"><button type="button" class="btn btn--big" id="d-cam">📷 Test camera</button><div class="diag__out" id="d-cam-out"></div></div>' +
      '<div class="diag"><button type="button" class="btn btn--big" id="d-qr">▦ Test QR scan</button><div class="diag__out" id="d-qr-out"></div></div>' +
      '<div class="diag"><div class="diag__out">' + (t
        ? 'Today: sunrise ' + esc(clock(t.rise)) + ', sunset ' + esc(clock(t.set)) + '. Gear checks are ' +
          (StillThere.isDaylight(new Date(), gps && gps.lat ? gps.lat : CONFIG.MAP_CENTER[0], gps && gps.lon ? gps.lon : CONFIG.MAP_CENTER[1]) ? 'running now.' : 'paused now (night).')
        : 'Sun times unavailable.') + '</div></div>';

    const out = (id, text, kind) => { const el = $(id); el.textContent = text; el.className = 'diag__out ' + (kind || ''); };

    $('d-gps').onclick = async () => {
      out('d-gps-out', 'Looking for GPS…');
      try {
        const p = await Native.position();
        gps = { lat: p.lat, lon: p.lon, accuracy: p.accuracy, at: Date.now() };
        out('d-gps-out', '✓ ' + p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) + ' · ±' + Math.round(p.accuracy) + ' m' +
          (p.accuracy > 50 ? ' (too rough for gear checks: go outside)' : ''), p.accuracy > 50 ? '' : 'ok');
      } catch (err) { out('d-gps-out', '✗ ' + friendly(err), 'bad'); }
    };

    $('d-cam').onclick = async () => {
      out('d-cam-out', 'Opening camera…');
      try {
        const f = await Native.photo();
        if (!f) { out('d-cam-out', 'Cancelled'); return; }
        const url = URL.createObjectURL(f);
        $('d-cam-out').className = 'diag__out ok';
        $('d-cam-out').innerHTML = '✓ ' + Math.round(f.size / 1024) + ' KB<br><img alt="Test photo" src="' + url + '">';
      } catch (err) { out('d-cam-out', '✗ ' + friendly(err), 'bad'); }
    };

    $('d-qr').onclick = async () => {
      out('d-qr-out', 'Opening scanner…');
      try {
        const raw = await Native.scanQr();
        out('d-qr-out', raw ? '✓ Read: ' + raw : 'Nothing scanned', raw ? 'ok' : '');
      } catch (err) { out('d-qr-out', '✗ ' + friendly(err), 'bad'); }
    };
  }

  // =============================================================== identify

  function showIdentification(result) {
    const rec = IdentifyModule.recommendation(result);
    const meta = (IdentifyModule.VERDICTS && IdentifyModule.VERDICTS[result.verdict]) || null;
    const tone = rec.tone === 'ok' ? 'ok' : (rec.tone === 'danger' ? 'danger' : 'warn');
    $('identify-body').innerHTML =
      '<div class="verdict verdict--' + tone + '"><b>' + esc(meta ? meta.label : (result.verdict || 'Unknown')) + '</b>' +
        '<span>' + esc(rec.label) + '</span></div>' +
      '<div class="kv"><span>' + esc(result.reason || '') + '</span></div>' +
      '<button type="button" class="btn btn--hero btn--primary" id="btn-id-again">Identify another</button>';
    $('btn-id-again').onclick = () => { stack.pop(); show('identify'); };
    go('identify-result');
  }

  async function identifyByQr() {
    try {
      await Promise.all([GearModule.load(), Devices.load()]);
      const raw = await Native.scanQr();
      if (!raw) return;
      const code = QrModule.extractCode(raw);
      if (!code) { toast('That QR is not a NetSight code.'); return; }
      showIdentification(IdentifyModule.byCode(code));
    } catch (err) { toast(friendly(err)); }
  }

  async function identifyHere() {
    try {
      await Promise.all([GearModule.load(), Devices.load()]);
      const p = await Native.position();
      gps = { lat: p.lat, lon: p.lon, accuracy: p.accuracy, at: Date.now() };
      showIdentification(IdentifyModule.byPosition(p.lat, p.lon));
    } catch (err) { toast(friendly(err)); }
  }

  async function identifyByCode() {
    const code = $('id-code').value.trim();
    if (!code) { toast('Type the code first.'); return; }
    await GearModule.load();
    showIdentification(IdentifyModule.byCode(code));
  }

  // ==================================================================== boot

  function bind() {
    $('btn-back').onclick = () => { back(); };
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      if (b.dataset.go === 'report-type') { endDraft(); draft = null; }
      go(b.dataset.go);
    });

    document.querySelectorAll('#screen-report-type [data-class]').forEach(t => t.onclick = () => {
      endDraft();
      draft = newDraft(t.dataset.class);
      go('report-place');
    });

    $('btn-photo').onclick = takePhoto;
    $('btn-send').onclick = startSend;
    $('btn-send-nophoto').onclick = startSend;
    $('btn-send-undo').onclick = () => { cancelSend(); back(); };
    $('btn-done').onclick = goHome;
    $('btn-retry').onclick = () => { replace('report-send'); stack[stack.length - 1] = 'report-photo'; startSend(); };
    $('btn-failed-home').onclick = () => { endDraft(); goHome(); };

    $('btn-net-new').onclick = () => { netDraft = null; go('net-new'); };

    $('btn-id-scan').onclick = identifyByQr;
    $('btn-id-here').onclick = identifyHere;
    $('btn-id-code').onclick = identifyByCode;
    $('id-code').addEventListener('keydown', e => { if (e.key === 'Enter') identifyByCode(); });

    $('tab-decide').onclick = () => { casesTab = 'decide'; renderCases(); };
    $('tab-collect').onclick = () => { casesTab = 'collect'; renderCases(); };
    $('tab-closed').onclick = () => { casesTab = 'closed'; renderCases(); };
    $('btn-diag').onclick = () => go('diag');

    $('undo-btn').onclick = undoPending;
    $('btn-signout').onclick = () => Auth.logout();

    Native.onBack(() => back());
  }

  async function init() {
    session = await Auth.require(['user', 'patrol', 'admin']);
    if (!session) return;
    Auth.mount(session);

    LocationModule.init();
    // These fill the caches the match and identify code read from. A failure here
    // is not fatal: each screen that needs them loads again and says what failed.
    await Promise.allSettled([RegistryModule.loadRegistry(), Shore.load(), Devices.load(), GearModule.load()]);

    bind();
    initCasePickers();
    show('home');
    startGearChecks();
  }

  init().catch(err => {
    console.error('Boat mode failed to start:', err);
    toast(friendly(err));
  });
})();
