// NetSight Application
// Wires the map, the reporting flow and storage together.
//
// The rule this file enforces: gear only goes in permitted water. Not a warning
// to click past — a refusal. A net is a line, so the line itself is checked, not
// just its ends.

const App = (function() {
  'use strict';

  let sightings = [];
  let unsubRealtime = null;
  let reportLocation = null;   // { lat, lon, accuracy } — a point, for buoys
  let reportSpan = null;       // [[lat,lon],[lat,lon]] — a line, for nets
  let submitting = false;

  // Gear that lies across the water rather than sitting at one spot.
  const SPANNING_TYPES = ['net', 'trap'];

  // ------------------------------------------------------------------ init

  async function init() {
    // Every page sits behind the same login. This one is the boater's home.
    const session = await Auth.require(['user', 'patrol', 'admin']);
    if (!session) return;

    Theme.init();
    Auth.mount(session);
    syncAccountCard(session);
    bindAccount();

    UIModule.init();
    LocationModule.init();

    await RegistryModule.loadRegistry();
    await Shore.load();
    await Devices.load();
    await GearModule.load();

    const map = MapModule.initMap('map', CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    if (!map) UIModule.showToast('Map failed to load', 'error');

    setupEventListeners();
    await loadSightings();

    if (UIModule.getCurrentScreen() === 'map') startLocationTracking();

    unsubRealtime = StoreModule.subscribeToSightings(() => loadSightings());

    console.log('NetSight ready');
  }

  async function loadSightings() {
    try {
      sightings = await StoreModule.getSightingsUnified(500);
      MapModule.renderSightings(sightings);
      updateCounters();
    } catch (err) {
      console.error('Failed to load sightings:', err);
      UIModule.showToast('Could not load sightings', 'error');
    }
  }

  function updateCounters() {
    const counts = {
      total: sightings.length,
      unverified: sightings.filter(s => !s.registry_match).length,
      reported: sightings.filter(s => s.status === 'reported').length,
      resolved: sightings.filter(s => s.status === 'resolved').length
    };
    Object.entries(counts).forEach(([key, value]) => {
      const el = document.getElementById('count-' + key);
      if (el) el.textContent = String(value);
    });
  }

  // -------------------------------------------------------------- listeners

  function setupEventListeners() {
    document.getElementById('fab-add')?.addEventListener('click', openReportScreen);

    document.getElementById('btn-back-report')?.addEventListener('click', () => {
      UIModule.showScreen('map');
      startLocationTracking();
    });
    document.getElementById('btn-back-settings')?.addEventListener('click', () => {
      UIModule.showScreen('map');
      startLocationTracking();
    });
    document.getElementById('btn-back-gear')?.addEventListener('click', () => {
      UIModule.showScreen('map');
      startLocationTracking();
    });
    document.getElementById('btn-register-net')?.addEventListener('click', startRegisterNet);

    document.querySelectorAll('.tab[data-screen], .nav-item[data-screen]').forEach(item => {
      item.addEventListener('click', () => {
        const screen = item.dataset.screen;
        if (screen === 'report') { openReportScreen(); return; }
        if (screen === 'gear') { openGearScreen(); return; }
        UIModule.showScreen(screen);
        if (screen === 'map') {
          startLocationTracking();
          setTimeout(() => MapModule.refresh(), 60);
        }
      });
    });

    document.getElementById('sighting-form')?.addEventListener('submit', handleSubmitReport);
    document.getElementById('btn-clear-report')?.addEventListener('click', clearReportForm);

    UIModule.setupPhotoPreview('photo-input', 'photo-preview', onPhotoSelected);
    UIModule.setupPhotoPreview('camera-input', 'photo-preview', onPhotoSelected);

    const preview = document.getElementById('photo-preview');
    preview?.addEventListener('click', () => document.getElementById('photo-input')?.click());
    preview?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        document.getElementById('photo-input')?.click();
      }
    });

    document.getElementById('btn-use-gps')?.addEventListener('click', useCurrentGPS);
    document.getElementById('btn-pick-map')?.addEventListener('click', openMapPicker);
    document.getElementById('btn-map-picker-cancel')?.addEventListener('click', () => MapModule.closePicker());
    document.getElementById('btn-map-picker-confirm')?.addEventListener('click', () => MapModule.confirmPicker());

    // One action for a net: stretch it. There is no separate point to place.
    document.getElementById('btn-draw-span')?.addEventListener('click', openSpanPicker);
    document.getElementById('btn-span-undo')?.addEventListener('click', () => MapModule.clearSpan());
    document.getElementById('btn-span-start-here')?.addEventListener('click', () => {
      if (!MapModule.spanStartHere()) {
        UIModule.showToast('No GPS fix yet — tap the map instead', 'warning');
      }
    });
    document.getElementById('btn-span-confirm')?.addEventListener('click', () => MapModule.confirmSpan());
    document.getElementById('btn-span-cancel')?.addEventListener('click', () => MapModule.closeSpanPicker());

    UIModule.setupTypeChips('type-chips');

    // Which input a type needs depends on whether it spans water.
    document.getElementById('type-chips')?.addEventListener('click', () => {
      setTimeout(syncReportCards, 0);
    });
    syncReportCards();

    document.getElementById('btn-recentre')?.addEventListener('click', () => {
      if (!MapModule.recentre()) {
        UIModule.showToast('Waiting for a GPS fix', 'info');
      }
    });

    const registryToggle = document.getElementById('toggle-registry');
    registryToggle?.addEventListener('change', async e => {
      await MapModule.toggleRegistryLayer(e.target.checked);
      UIModule.showToast(e.target.checked ? 'Registry layer on' : 'Registry layer off', 'info');
    });

    const deviceToggle = document.getElementById('toggle-devices');
    if (deviceToggle) {
      MapModule.renderDevices(Devices.all());
      MapModule.toggleDeviceLayer(deviceToggle.checked);
      deviceToggle.addEventListener('change', e => {
        MapModule.toggleDeviceLayer(e.target.checked);
        UIModule.showToast(e.target.checked ? 'Buoys shown' : 'Buoys hidden', 'info');
      });
    }

    const zoneToggle = document.getElementById('toggle-zones');
    if (zoneToggle) {
      zoneToggle.addEventListener('change', e => {
        MapModule.toggleZones(e.target.checked);
        UIModule.showToast(
          e.target.checked ? 'Permitted areas shown' : 'Permitted areas hidden',
          'info'
        );
      });
    }

    // Keyboard: R = new report, Esc = back to map
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) openReportScreen();
      if (e.key === 'Escape' && UIModule.getCurrentScreen() !== 'map') {
        UIModule.showScreen('map');
        startLocationTracking();
      }
    });
  }

  // ------------------------------------------------------- location tracking

  function startLocationTracking() {
    LocationModule.startWatch(
      pos => {
        MapModule.showUserPosition(pos.lat, pos.lon, pos.accuracy);
        if (!reportLocation && !reportSpan) updateReportLocationDisplay();
      },
      err => {
        console.warn('Location unavailable:', err.message);
        const readout = document.getElementById('me-readout');
        if (readout) {
          readout.dataset.state = 'idle';
          readout.textContent = 'Location unavailable — pick a spot on the map';
        }
      }
    );
  }

  // ----------------------------------------------------------- report cards

  // A net gets the stretch control and no location card, because the line *is*
  // the location. A buoy gets the location card and no stretch control. Asking
  // for both was the thing that made this confusing.
  function syncReportCards() {
    const spanCard = document.getElementById('span-card');
    const locationCard = document.getElementById('location-card');

    const type = UIModule.getSelectedTypeChip('type-chips');
    const wantsLine = SPANNING_TYPES.includes(type);

    // Nothing is shown until a type is chosen. Showing both cards and asking
    // for a point and a line was the confusion this replaces.
    if (spanCard) spanCard.hidden = !wantsLine;
    if (locationCard) locationCard.hidden = !type || wantsLine;

    const minShore = document.getElementById('span-min-shore');
    if (minShore) minShore.textContent = String(CONFIG.DEVICES.minShoreMetres);

    // Switching type drops whatever the other one had collected, so a stale
    // line cannot be saved as a buoy or the other way round.
    if (wantsLine && reportLocation) {
      reportLocation = null;
      updateReportLocationDisplay();
    }
    if (!wantsLine && reportSpan) {
      reportSpan = null;
      MapModule.clearSpan();
    }

    updateSpanSummary();
  }

  function updateSpanSummary() {
    const summary = document.getElementById('span-summary');
    const title = document.getElementById('draw-launch-title');
    const badge = document.getElementById('span-badge');
    const fence = document.getElementById('span-fence');

    if (!summary) return;

    if (!reportSpan) {
      summary.textContent = 'Nothing drawn yet';
      if (title) title.textContent = 'Draw the net';
      if (badge) badge.hidden = true;
      if (fence) fence.hidden = true;
      return;
    }

    const metres = Shore.spanLength(reportSpan[0], reportSpan[1]);
    const check = Shore.checkSpan(reportSpan[0], reportSpan[1]);

    summary.textContent = Math.round(metres) + ' m long';
    if (title) title.textContent = 'Redraw the net';
    if (badge) badge.hidden = false;

    if (fence) {
      fence.hidden = false;
      fence.dataset.state = check.allowed ? 'ok' : 'blocked';
      fence.textContent = check.allowed
        ? check.reason
        : check.reason + ' — redraw it inside the water';
    }
  }

  function openSpanPicker() {
    const start = reportLocation || LocationModule.getLastPosition() || null;
    MapModule.openSpanPicker((points, check) => {
      reportSpan = points;
      updateSpanSummary();
      UIModule.showToast(
        check && check.allowed ? 'Net line set' : 'Net line set',
        'success'
      );
    }, start);
  }

  // ------------------------------------------------------------- report flow

  function openReportScreen() {
    const last = LocationModule.getLastPosition();
    reportLocation = last ? { lat: last.lat, lon: last.lon, accuracy: last.accuracy } : null;
    updateReportLocationDisplay();
    syncReportCards();
    UIModule.showScreen('report');
    LocationModule.stopWatch();
  }

  function onPhotoSelected() {
    // The photo is evidence, nothing more. No model reads it.
    const preview = document.getElementById('photo-preview');
    const badge = document.getElementById('photo-badge');
    if (preview && preview.dataset.hasPhoto === '1' && badge) badge.hidden = false;
  }

  async function useCurrentGPS() {
    UIModule.showLoading('Locating…');
    try {
      const pos = await LocationModule.getCurrentPosition();
      setReportLocation(pos.lat, pos.lon, pos.accuracy);
      UIModule.showToast('Location set from GPS', 'success');
    } catch (err) {
      UIModule.showToast('GPS unavailable: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  function openMapPicker() {
    const start = reportLocation || LocationModule.getLastPosition();
    MapModule.openPicker((lat, lon) => {
      setReportLocation(lat, lon, null);
      UIModule.showToast('Location pinned on map', 'success');
    }, start);
  }

  function setReportLocation(lat, lon, accuracy) {
    reportLocation = { lat, lon, accuracy };
    updateReportLocationDisplay();
  }

  function updateReportLocationDisplay() {
    if (reportLocation) {
      UIModule.updateLocationDisplay(reportLocation.lat, reportLocation.lon, reportLocation.accuracy);
      updateFenceHint(reportLocation.lat, reportLocation.lon);
      return;
    }
    const last = LocationModule.getLastPosition();
    if (last) {
      UIModule.updateLocationDisplay(last.lat, last.lon, last.accuracy);
      updateFenceHint(last.lat, last.lon);
    } else {
      UIModule.updateLocationDisplay(0, 0, null);
      updateFenceHint(null, null);
    }
  }

  // Tells the reporter, before they save, whether this spot is inside the
  // permitted water and far enough from shore.
  function updateFenceHint(lat, lon) {
    const hint = document.getElementById('fence-hint');
    if (!hint) return;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      hint.hidden = true;
      return;
    }

    const fence = Devices.checkGeofence(lat, lon);
    const minShore = CONFIG.DEVICES.minShoreMetres;

    hint.hidden = false;

    // "idle" is only for the case where nobody has drawn a shoreline yet — a
    // real refusal (off the water, too close) is always "blocked".
    if (fence.onWater === null) {
      hint.dataset.state = 'idle';
      hint.textContent = fence.reason;
      return;
    }

    hint.dataset.state = fence.allowed ? 'ok' : 'blocked';
    hint.textContent = fence.allowed
      ? Math.round(fence.shoreDistance) + ' m from shore (min ' + minShore + ' m)'
      : fence.reason;
  }

  // The one place that decides whether a report may be saved. Returns null when
  // it is fine, or the reason it is not.
  function checkReport() {
    const type = UIModule.getSelectedTypeChip('type-chips');

    if (!type) return 'Pick what you found first';

    if (SPANNING_TYPES.includes(type)) {
      if (!reportSpan) return 'Stretch the net on the map first';

      const check = Shore.checkSpan(reportSpan[0], reportSpan[1]);
      if (!check.allowed) return check.reason;

      return null;
    }

    const location = reportLocation || LocationModule.getLastPosition();
    if (!location) return 'Set the location first';

    const fence = Devices.checkGeofence(location.lat, location.lon);
    if (!fence.allowed) return fence.reason;

    return null;
  }

  async function handleSubmitReport(e) {
    e.preventDefault();
    if (submitting) return;

    const submitBtn = document.getElementById('btn-submit-report');

    try {
      const userClass = UIModule.getSelectedTypeChip('type-chips');
      const note = (document.getElementById('note-input')?.value || '').trim();

      // No override, no "report anyway". The rule is the rule, and saying so
      // here is kinder than letting someone file a report that cannot be acted
      // on because it is on a pavement.
      const problem = checkReport();
      if (problem) {
        UIModule.showToast(problem, 'error');
        return;
      }

      submitting = true;
      if (submitBtn) submitBtn.disabled = true;

      const photoFile = UIModule.getSelectedPhotoFile();
      const isLine = SPANNING_TYPES.includes(userClass);

      // A net's anchor is the middle of the line; the line itself travels in
      // `span`. One coordinate pair keeps the map, the list and the database
      // working without a special case for lines.
      const location = isLine
        ? { lat: Shore.spanMidpoint(reportSpan[0], reportSpan[1])[0],
            lon: Shore.spanMidpoint(reportSpan[0], reportSpan[1])[1],
            accuracy: null }
        : (reportLocation || LocationModule.getLastPosition());

      UIModule.showLoading('Saving…');

      const id = (crypto.randomUUID && crypto.randomUUID()) || 'local-' + Date.now().toString(36);
      const photoUrl = photoFile ? await StoreModule.uploadPhoto(photoFile, id) : '';

      // Registered gear wins over the CSV: it carries the owner's own code.
      const gearMatch = GearModule.matchAt(location.lat, location.lon, userClass, CONFIG.MATCH_RADIUS_M);
      const csvMatch = RegistryModule.matchRegistry(
        { lat: location.lat, lon: location.lon, user_class: userClass },
        CONFIG.MATCH_RADIUS_M
      );

      const payload = StatusModule.validateSighting({
        photo_url: photoUrl,
        lat: location.lat,
        lon: location.lon,
        accuracy_m: location.accuracy,
        detected_class: 'unknown',
        confidence: 0,
        user_class: userClass,
        registry_id: gearMatch ? gearMatch.gear.code : (csvMatch ? csvMatch.item.id : null),
        registry_match: !!(gearMatch || csvMatch),
        status: 'new',
        report_reason: null,
        note,
        span: isLine ? reportSpan : null
      });

      if (!payload.valid) {
        UIModule.showToast('Cannot save: ' + payload.errors.join(', '), 'error');
        return;
      }

      await StoreModule.createSightingUnified({ id, ...payload.normalized });

      UIModule.showToast(
        gearMatch
          ? 'Saved — registered to ' + gearMatch.gear.ownerName
          : (csvMatch ? 'Saved — matches registered gear' : 'Report saved'),
        'success'
      );

      clearReportForm();
      UIModule.showScreen('map');
      startLocationTracking();
      await loadSightings();
    } catch (err) {
      console.error('Save failed:', err);
      UIModule.showToast('Save failed: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
      submitting = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function clearReportForm() {
    UIModule.clearPhotoPreview('photo-preview', 'photo-input');
    const badge = document.getElementById('photo-badge');
    if (badge) badge.hidden = true;

    const camera = document.getElementById('camera-input');
    if (camera) camera.value = '';

    document.querySelectorAll('#type-chips .type-chip').forEach(c => c.classList.remove('chip--active'));
    const note = document.getElementById('note-input');
    if (note) note.value = '';

    reportLocation = null;
    reportSpan = null;
    MapModule.clearSpan();
    syncReportCards();
    updateReportLocationDisplay();
  }


  // -------------------------------------------------------------- my nets

  let registering = false;

  async function openGearScreen() {
    await GearModule.load();
    renderGearList();
    UIModule.showScreen('gear');
    LocationModule.stopWatch();
  }

  function renderGearList() {
    const host = document.getElementById('gear-list');
    const empty = document.getElementById('gear-empty');
    const count = document.getElementById('gear-count');
    if (!host) return;

    const list = GearModule.mine();
    if (count) count.textContent = String(list.length);

    if (!list.length) {
      host.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

    host.innerHTML = list.map(gear => {
      const expired = GearModule.isExpired(gear);
      const metres = Array.isArray(gear.span)
        ? Math.round(Shore.spanLength(gear.span[0], gear.span[1]))
        : null;

      return [
        '<article class="gear-item' + (expired ? ' gear-item--expired' : '') + '" data-gear="' + escapeAttr(gear.id) + '">',
        '  <div class="gear-item__code">',
        '    <span class="gear-item__code-label">Code</span>',
        '    <span class="gear-item__code-value">' + escapeHtml(gear.code) + '</span>',
        '  </div>',
        '  <div class="gear-item__body">',
        '    <span class="gear-item__label">' + escapeHtml(gear.label) + '</span>',
        '    <span class="gear-item__meta">',
        escapeHtml(gear.type),
        metres ? ' · ' + metres + ' m' : '',
        expired ? ' · expired' : ' · active',
        '    </span>',
        '  </div>',
        '  <button type="button" class="icon-btn icon-btn--sm" data-withdraw="' + escapeAttr(gear.id) + '"',
        '          aria-label="Withdraw ' + escapeAttr(gear.code) + '">',
        '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">',
        '      <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
        '    </svg>',
        '  </button>',
        '</article>'
      ].join('');
    }).join('');

    host.querySelectorAll('[data-withdraw]').forEach(btn => {
      btn.addEventListener('click', () => withdrawGear(btn.dataset.withdraw));
    });
  }

  async function withdrawGear(id) {
    const gear = GearModule.get(id);
    if (!gear) return;

    const ok = await UIModule.confirm(
      'Withdraw ' + gear.code + '? Reports near it will no longer be matched to you.',
      { title: 'Withdraw this net', confirmLabel: 'Withdraw', danger: true }
    );
    if (!ok) return;

    if (await GearModule.remove(id)) {
      renderGearList();
      UIModule.showToast('Net withdrawn', 'success');
    } else {
      UIModule.showToast('Could not withdraw it', 'error');
    }
  }

  // Registering is one flow: stretch the net, name it, get a code. The code is
  // the point — it is what gets written on the buoy so a finder can identify it.
  async function startRegisterNet() {
    if (registering) return;
    registering = true;

    const status = document.getElementById('gear-status');
    const say = (msg, tone) => {
      if (status) { status.textContent = msg; status.dataset.tone = tone; }
    };

    try {
      say('Draw the net on the map…', 'info');

      const span = await new Promise(resolve => {
        MapModule.openSpanPicker((points) => resolve(points), LocationModule.getLastPosition());
      });

      if (!span) { say('', 'muted'); return; }

      const label = await UIModule.prompt(
        'What do you call this net?',
        'Net ' + new Date().toLocaleDateString(),
        { title: 'Name the net', confirmLabel: 'Next' }
      );
      if (label === null) { say('', 'muted'); return; }

      const result = await GearModule.add({
        label: label || 'Net',
        type: 'net',
        span
      });

      if (!result.ok) {
        say(result.message, 'error');
        UIModule.showToast(result.message, 'error');
        return;
      }

      renderGearList();
      say('Registered as ' + result.gear.code, 'ok');

      // The code is the deliverable: show it large enough to read off a phone
      // and write on a buoy.
      await UIModule.showCodeModal(
        'Your net code',
        result.gear.code,
        'Write this on the buoy. A finder can look it up, and patrol sees it is yours.'
      );

      UIModule.showToast('Net registered', 'success');
    } catch (err) {
      console.error('Register failed:', err);
      say('Could not register: ' + err.message, 'error');
    } finally {
      registering = false;
    }
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function escapeAttr(v) {
    return escapeHtml(v);
  }
  // ------------------------------------------------------- detail / actions

  function showDetail(sighting) {
    UIModule.showDetailView(sighting);
  }

  function showReport(sighting) {
    UIModule.showReportModal(sighting, async (reason, note) => {
      UIModule.showLoading('Reporting…');
      try {
        await StoreModule.updateSightingUnified(sighting.id, {
          status: 'reported',
          report_reason: reason,
          note: note || sighting.note || ''
        });
        UIModule.showToast('Reported to authorities', 'success');
        await loadSightings();
      } catch (err) {
        UIModule.showToast('Report failed', 'error');
      } finally {
        UIModule.hideLoading();
      }
    });
  }

  function showStatusChange(sighting) {
    UIModule.showStatusModal(sighting, async (newStatus, comment) => {
      UIModule.showLoading('Updating…');
      try {
        await StoreModule.updateSightingStatusUnified(sighting.id, newStatus, comment, 'inspector');
        UIModule.showToast('Status → ' + StatusModule.getStatusLabel(newStatus), 'success');
        await loadSightings();
      } catch (err) {
        UIModule.showToast('Update failed', 'error');
      } finally {
        UIModule.hideLoading();
      }
    });
  }

  // --------------------------------------------------------- account + status

  // Fills the account card. A normal user never sees anything about roles,
  // patrol or the admin panel — just who they are.
  function syncAccountCard(session) {
    const name = (session && (session.displayName || session.username)) || '—';
    const initial = name.charAt(0).toUpperCase();

    const avatar = document.getElementById('account-avatar');
    const nameEl = document.getElementById('account-name');
    const metaEl = document.getElementById('account-meta');

    if (avatar) avatar.textContent = initial;
    if (nameEl) nameEl.textContent = name;
    if (metaEl) {
      metaEl.textContent = session && session.role === 'user'
        ? 'Signed in · you can report sightings'
        : 'Signed in';
    }
  }

  function bindAccount() {
    document.getElementById('btn-change-pw')?.addEventListener('click', async () => {
      const session = Auth.current();
      if (!session) return;

      const status = document.getElementById('pw-status');
      const say = (msg, tone) => {
        status.textContent = msg;
        status.dataset.tone = tone;
      };

      const result = await Auth.changePassword(
        session.username,
        document.getElementById('pw-old').value,
        document.getElementById('pw-new').value,
        document.getElementById('pw-new2').value
      );

      if (!result.ok) return say(result.message, 'error');

      document.getElementById('pw-old').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-new2').value = '';
      say('Password updated', 'ok');
      UIModule.showToast('Password updated', 'success');
    });
  }

  // ----------------------------------------------------------------- cleanup

  window.addEventListener('beforeunload', () => {
    if (unsubRealtime) unsubRealtime();
    LocationModule.stopWatch();
  });

  return {
    init,
    showDetail,
    showReport,
    showStatusChange,
    getSightings: () => sightings,
    setReportLocation,
    checkReport
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;





