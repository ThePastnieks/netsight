// NetSight Application
// Wires the map, reporting flow, detection and storage together.

const App = (function() {
  'use strict';

  let sightings = [];
  let isInspectorMode = false;
  let unsubRealtime = null;
  let reportLocation = null;
  let detecting = false;

  // ------------------------------------------------------------------ init

  async function init() {
    // Every page sits behind the same login. This one is the boater's home.
    const session = Auth.require(['user', 'patrol', 'admin']);
    if (!session) return;

    Theme.init();
    Auth.mount(session);
    Detect.load();

    isInspectorMode = new URLSearchParams(window.location.search).get('inspector') === 'true';

    UIModule.init();
    LocationModule.init();
    syncDetectChrome();

    await RegistryModule.loadRegistry();

    const map = MapModule.initMap('map', CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    if (!map) UIModule.showToast('Map failed to load', 'error');

    setupEventListeners();
    syncDetectChrome();
    await loadSightings();

    if (UIModule.getCurrentScreen() === 'map') startLocationTracking();

    unsubRealtime = StoreModule.subscribeToSightings(() => loadSightings());
    registerServiceWorker();

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

    UIModule.setupTypeChips('type-chips');

    const registryToggle = document.getElementById('toggle-registry');
    registryToggle?.addEventListener('change', async e => {
      await MapModule.toggleRegistryLayer(e.target.checked);
      UIModule.showToast(e.target.checked ? 'Registry layer on' : 'Registry layer off', 'info');
    });

    document.getElementById('btn-report-all')?.addEventListener('click', reportAllUnverified);

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
    preview?.classList.add('photo-preview--scanning');
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
      preview?.classList.remove('photo-preview--scanning');
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
      return;
    }
    const last = LocationModule.getLastPosition();
    if (last) UIModule.updateLocationDisplay(last.lat, last.lon, last.accuracy);
    else UIModule.updateLocationDisplay(0, 0, null);
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
        note
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

  async function reportAllUnverified() {
    const targets = sightings.filter(s => !s.registry_match && s.status === 'new');
    if (targets.length === 0) {
      UIModule.showToast('Nothing unverified to report', 'info');
      return;
    }
    const ok = await UIModule.confirm(
      `Report ${targets.length} unverified sighting(s)?`,
      { confirmLabel: 'Report all', danger: true }
    );
    if (!ok) return;

    UIModule.showLoading('Reporting…');
    let updated = 0;
    try {
      for (const s of targets) {
        try {
          await StoreModule.updateSightingUnified(s.id, { status: 'reported', report_reason: 'other' });
          updated++;
        } catch (err) {
          console.warn('Failed for', s.id, err);
        }
      }
      await loadSightings();
      UIModule.showToast(`Reported ${updated} case(s)`, 'success');
    } finally {
      UIModule.hideLoading();
    }
  }

  // --------------------------------------------------------- detection status

  function syncDetectChrome() {
    const cfg = Detect.get();
    const configured = !!cfg.endpoint;

    const pill = document.getElementById('ai-pill');
    if (pill) {
      pill.dataset.mode = configured ? 'live' : 'off';
      const text = pill.querySelector('.pill__text');
      if (text) text.textContent = configured ? 'AI on' : 'AI off';
    }

    const dot = document.getElementById('ai-dot');
    const headline = document.getElementById('ai-headline');
    const detail = document.getElementById('ai-detail');
    const count = document.getElementById('ai-model-count');

    if (dot) dot.dataset.state = configured ? 'ready' : 'off';

    if (headline) {
      headline.textContent = configured ? 'Model connected' : 'Not connected';
    }

    if (detail) {
      detail.textContent = configured
        ? cfg.endpoint
        : 'Set the model endpoint in Admin → AI.';
    }

    if (count) {
      count.textContent = Math.round(cfg.minConfidence * 100) + '% threshold';
    }

    document.body.dataset.ai = configured ? 'ready' : 'off';
  }
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker not registered:', err.message);
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
    isInspector: () => isInspectorMode,
    getSightings: () => sightings
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;





