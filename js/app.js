// NetSight Application
// Wires the map, reporting flow, detection and storage together.

const App = (function() {
  'use strict';

  let sightings = [];
  let isInspectorMode = false;
  let unsubRealtime = null;
  let reportLocation = null;
  let reportSpan = null;   // [[lat,lon],[lat,lon]] for nets and traps
  let detecting = false;

  // ------------------------------------------------------------------ init

  async function init() {
    // Every page sits behind the same login. This one is the boater's home.
    const session = await Auth.require(['user', 'patrol', 'admin']);
    if (!session) return;

    Theme.init();
    Auth.mount(session);
    syncAccountCard(session);
    bindAccount();
    Detect.load();

    isInspectorMode = new URLSearchParams(window.location.search).get('inspector') === 'true';

    UIModule.init();
    LocationModule.init();
    syncDetectChrome();

    await RegistryModule.loadRegistry();
    await Shore.load();
    await Devices.load();

    const map = MapModule.initMap('map', CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    if (!map) UIModule.showToast('Map failed to load', 'error');

    setupEventListeners();
    syncDetectChrome();
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

    document.querySelectorAll('.tab[data-screen], .nav-item[data-screen]').forEach(item => {
      item.addEventListener('click', () => {
        const screen = item.dataset.screen;
        if (screen === 'report') { openReportScreen(); return; }
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

    // Nets and traps are a line between two anchors, not a point.
    document.getElementById('btn-draw-span')?.addEventListener('click', openSpanPicker);
    document.getElementById('btn-span-undo')?.addEventListener('click', () => MapModule.clearSpan());
    document.getElementById('btn-span-confirm')?.addEventListener('click', () => MapModule.confirmSpan());
    document.getElementById('btn-span-cancel')?.addEventListener('click', () => MapModule.closeSpanPicker());

    UIModule.setupTypeChips('type-chips');

    // The net line control only exists for gear that spans water.
    document.getElementById('type-chips')?.addEventListener('click', () => {
      setTimeout(syncSpanRow, 0);
    });
    syncSpanRow();

    const registryToggle = document.getElementById('toggle-registry');
    registryToggle?.addEventListener('change', async e => {
      await MapModule.toggleRegistryLayer(e.target.checked);
      UIModule.showToast(e.target.checked ? 'Registry layer on' : 'Registry layer off', 'info');
    });

    // Buoys on the water. On by default — an obstacle you cannot see is the
    // whole problem this app exists to fix.
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
        if (!reportLocation) updateReportLocationDisplay();
      },
      err => console.warn('Location unavailable:', err.message)
    );
  }

  // ------------------------------------------------------------ net span

  // Only gear that spans water gets the line control.
  const SPANNING_TYPES = ['net', 'trap'];

  function syncSpanRow() {
    const row = document.getElementById('span-row');
    if (!row) return;

    const type = UIModule.getSelectedTypeChip('type-chips');
    const wants = SPANNING_TYPES.includes(type);

    row.hidden = !wants;

    // Changing to a type that does not span water drops any line already drawn.
    if (!wants && reportSpan) {
      reportSpan = null;
      MapModule.clearSpan();
    }

    updateSpanSummary();
  }

  function updateSpanSummary() {
    const el = document.getElementById('span-summary');
    const btn = document.getElementById('btn-draw-span');
    if (!el) return;

    if (!reportSpan) {
      el.textContent = 'Not drawn yet';
      if (btn) btn.textContent = 'Draw';
      return;
    }

    const metres = Devices.haversine(
      reportSpan[0][0], reportSpan[0][1],
      reportSpan[1][0], reportSpan[1][1]
    );

    el.textContent = Math.round(metres) + ' m between the anchors';
    if (btn) btn.textContent = 'Redraw';
  }

  function openSpanPicker() {
    const start = reportLocation || LocationModule.getLastPosition() || null;
    MapModule.openSpanPicker(points => {
      reportSpan = points;
      updateSpanSummary();
      UIModule.showToast('Net line set', 'success');
    }, start);
  }
  // ------------------------------------------------------------- report flow

  function openReportScreen() {
    const last = LocationModule.getLastPosition();
    reportLocation = last ? { lat: last.lat, lon: last.lon, accuracy: last.accuracy } : null;
    updateReportLocationDisplay();
    UIModule.showScreen('report');
    LocationModule.stopWatch();
  }

  async function onPhotoSelected(file) {
    if (!file || detecting) return;

    detecting = true;

    UIModule.hideDetectionResult();
    const preview = document.getElementById('photo-preview');
    preview?.classList.add('photo--scanning');
    UIModule.showLoading('Analysing photo…');

    try {
      const result = await Detect.analyze(file, {
        onProgress: p => {
          const msg = document.getElementById('loading-message');
          if (msg) msg.textContent = `Analysing photo… ${Math.round(p * 100)}%`;
        }
      });

      UIModule.showDetectionResult(result);

      if (!result.needsConfirmation && result.primary_class !== 'none') {
        document.querySelectorAll('#type-chips .type-chip').forEach(chip => {
          chip.classList.toggle('chip--active', chip.dataset.class === result.primary_class);
        });
      }
    } catch (err) {
      console.error('Detection failed:', err);
      UIModule.showToast('AI detection failed: ' + err.message, 'error');
    } finally {
      preview?.classList.remove('photo--scanning');
      UIModule.hideLoading();
      detecting = false;
      syncDetectChrome();
    }
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

  async function handleSubmitReport(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-submit-report');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const photoFile = UIModule.getSelectedPhotoFile();
      const userClass = UIModule.getSelectedTypeChip('type-chips');
      const location = reportLocation || LocationModule.getLastPosition();
      const note = (document.getElementById('note-input')?.value || '').trim();

      if (!userClass) { UIModule.showToast('Pick the gear type first', 'warning'); return; }
      if (!location) { UIModule.showToast('Set the location first', 'warning'); return; }

      // Gear may only go in permitted water, at least minShoreMetres from shore.
      const fence = Devices.checkGeofence(location.lat, location.lon);
      if (!fence.allowed) {
        const proceed = await UIModule.confirm(
          fence.reason + '. Report it anyway?',
          { title: 'Outside the permitted area', confirmLabel: 'Report anyway', danger: true }
        );
        if (!proceed) {
          UIModule.showToast('Report cancelled', 'info');
          return;
        }
      }

      const detection = UIModule.getDetectionResult();
      UIModule.showLoading('Saving…');

      const id = (crypto.randomUUID && crypto.randomUUID()) || 'local-' + Date.now().toString(36);
      const photoUrl = photoFile ? await StoreModule.uploadPhoto(photoFile, id) : '';

      const match = RegistryModule.matchRegistry(
        { lat: location.lat, lon: location.lon, user_class: userClass },
        CONFIG.MATCH_RADIUS_M
      );

      const payload = StatusModule.validateSighting({
        photo_url: photoUrl,
        lat: location.lat,
        lon: location.lon,
        accuracy_m: location.accuracy,
        detected_class: detection ? detection.primary_class : 'unknown',
        confidence: detection ? detection.primary_confidence : 0,
        user_class: userClass,
        registry_id: match ? match.item.id : null,
        registry_match: !!match,
        status: 'new',
        report_reason: null,
        note,
        span: reportSpan
      });

      if (!payload.valid) {
        UIModule.showToast('Cannot save: ' + payload.errors.join(', '), 'error');
        return;
      }

      await StoreModule.createSightingUnified({ id, ...payload.normalized });

      UIModule.showToast('Sighting saved', 'success');
      clearReportForm();
      UIModule.showScreen('map');
      startLocationTracking();
      await loadSightings();
    } catch (err) {
      console.error('Save failed:', err);
      UIModule.showToast('Save failed: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function clearReportForm() {
    UIModule.clearPhotoPreview('photo-preview', 'photo-input');
    UIModule.hideDetectionResult();
    const camera = document.getElementById('camera-input');
    if (camera) camera.value = '';
    document.querySelectorAll('#type-chips .type-chip').forEach(c => c.classList.remove('chip--active'));
    const note = document.getElementById('note-input');
    if (note) note.value = '';
    reportLocation = null;
    reportSpan = null;
    MapModule.clearSpan();
    syncSpanRow();
    updateReportLocationDisplay();
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

  // Plain-language state of the photo check. No endpoint, no admin wording.
  function syncDetectChrome() {
    const configured = !!Detect.get().endpoint;

    const pill = document.getElementById('ai-pill');
    if (pill) {
      pill.dataset.mode = configured ? 'live' : 'off';
      const text = pill.querySelector('.pill__text');
      if (text) text.textContent = configured ? 'Photo check on' : 'Photo check off';
    }

    const dot = document.getElementById('ai-dot');
    const headline = document.getElementById('ai-headline');
    const detail = document.getElementById('ai-detail');
    const count = document.getElementById('ai-model-count');

    if (dot) dot.dataset.state = configured ? 'ready' : 'off';

    if (headline) {
      headline.textContent = configured ? 'Ready' : 'Not available';
    }

    if (detail) {
      detail.textContent = configured
        ? 'Photos are checked for fishing nets'
        : 'Photos are not checked right now — pick the type yourself';
    }

    if (count) count.textContent = configured ? 'on' : 'off';

    document.body.dataset.ai = configured ? 'ready' : 'off';
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
    isInspector: () => isInspectorMode,
    getSightings: () => sightings,
    setReportLocation
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
























