// NetSight Main Application
// Coordinates all modules, handles app state and user flows

const App = (function() {
  'use strict';

  let sightings = [];
  let currentLocation = null;
  let isInspector = false;
  let unsubRealtime = null;

  // Initialize app
  async function init() {
    // Check if inspector mode (via URL param)
    const urlParams = new URLSearchParams(window.location.search);
    isInspector = urlParams.get('inspector') === 'true';

    // Initialize modules
    UIModule.init();
    LocationModule.init();
    await RegistryModule.loadRegistry();

    // Initialize map with CONFIG settings
    const map = MapModule.initMap('map', CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    if (!map) {
      UIModule.showToast('Failed to load map', 'error');
      return;
    }

    // Load sightings
    await loadSightings();

    // Setup event listeners
    setupEventListeners();

    // Setup demo mode toggle
    setupDemoMode();

    // Start location tracking for map screen
    if (UIModule.getCurrentScreen() === 'map') {
      startLocationTracking();
    }

    // Subscribe to realtime updates
    unsubRealtime = StoreModule.subscribeToSightings(handleRealtimeChange);

    console.log('NetSight initialized');
  }

  // Load sightings from store
  async function loadSightings() {
    try {
      sightings = await StoreModule.getSightingsUnified(500);
      MapModule.renderSightings(sightings);
      if (sightings.length > 0) {
        UIModule.showToast(`Loaded ${sightings.length} sightings`, 'success');
      }
    } catch (err) {
      console.error('Failed to load sightings:', err);
      UIModule.showToast('Failed to load sightings', 'error');
    }
  }

  // Handle realtime changes
  function handleRealtimeChange(payload) {
    console.log('Realtime change:', payload);
    loadSightings(); // Simple refresh for prototype
  }

  // Setup event listeners
  function setupEventListeners() {
    // FAB - open report screen
    document.getElementById('fab-add')?.addEventListener('click', () => {
      openReportScreen();
    });

    // Back buttons
    document.getElementById('btn-back-report')?.addEventListener('click', () => {
      UIModule.showScreen('map');
      startLocationTracking();
    });

    document.getElementById('btn-back-settings')?.addEventListener('click', () => {
      UIModule.showScreen('map');
      startLocationTracking();
    });

    // Report form
    const form = document.getElementById('sighting-form');
    form?.addEventListener('submit', handleSubmitReport);

    // Clear form
    document.getElementById('btn-clear-report')?.addEventListener('click', clearReportForm);

    // Photo inputs
    UIModule.setupPhotoPreview('photo-input', 'photo-preview', onPhotoSelected);
    UIModule.setupPhotoPreview('camera-input', 'photo-preview', onPhotoSelected);

    // Location buttons
    document.getElementById('btn-use-gps')?.addEventListener('click', useCurrentGPS);
    document.getElementById('btn-pick-map')?.addEventListener('click', openMapPicker);

    // Type chips
    UIModule.setupTypeChips('type-chips', onTypeChipChange);

    // Demo mode toggle
    document.getElementById('toggle-demo-mode')?.addEventListener('change', toggleDemoMode);

    // Registry toggle
    document.getElementById('toggle-registry')?.addEventListener('change', toggleRegistryLayer);

    // Report all unverified button
    document.getElementById('btn-report-all')?.addEventListener('click', reportAllUnverified);

    // Screen change - stop/start location tracking
    const originalShowScreen = UIModule.showScreen;
    UIModule.showScreen = function(screenName) {
      if (screenName === 'map') {
        startLocationTracking();
      } else {
        stopLocationTracking();
      }
      return originalShowScreen.call(this, screenName);
    };
  }

  // Start GPS tracking on map screen
  function startLocationTracking() {
    LocationModule.startWatch(position => {
      currentLocation = position;
      // Could auto-center map here, but let user control
    });
  }

  function stopLocationTracking() {
    LocationModule.stopWatch();
  }

  // Open report screen
  function openReportScreen() {
    clearReportForm();
    UIModule.showScreen('report');

    // Try to get current location
    if (currentLocation) {
      setLocationFromPosition(currentLocation);
    } else {
      LocationModule.getBrowserPosition()
        .then(pos => {
          const wrappedPos = {
            coords: {
              latitude: pos.lat,
              longitude: pos.lon,
              accuracy: pos.accuracy_m || 0
            },
            timestamp: Date.now()
          };
          setLocationFromPosition(wrappedPos);
        })
        .catch(err => {
          console.log('Could not get GPS:', err.message);
          UIModule.showToast('GPS unavailable - tap map to set location', 'info');
        });
    }
  }

  // Set location from GeolocationPosition
  function setLocationFromPosition(pos) {
    currentLocation = pos;
    UIModule.updateLocationDisplay(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    MapModule.getMap()?.setView([pos.coords.latitude, pos.coords.longitude], 15);
  }

  // Clear report form
  function clearReportForm() {
    document.getElementById('sighting-form')?.reset();
    UIModule.clearPhotoPreview('photo-preview', 'photo-input');
    UIModule.clearPhotoPreview('photo-preview', 'camera-input');
    UIModule.hideDetectionResult();
    UIModule.updateLocationDisplay(0, 0, null); // Shows "Tap map to set location"
    currentLocation = null;

    // Reset type chips - none selected
    document.querySelectorAll('#type-chips .type-chip').forEach(c => c.classList.remove('chip--active'));
  }

  // Photo selected handler
  async function onPhotoSelected(file) {
    UIModule.showLoading('Analyzing photo...');

    try {
      const result = await DetectModule.detectGear(file, {
        onProgress: (p) => {
          const msg = p < 0.5 ? 'Uploading...' : 'Detecting gear...';
          UIModule.showLoading(msg);
        }
      });

      if (!result) {
        throw new Error('No detection result returned');
      }

      if (!DetectModule.validateResult(result)) {
        throw new Error('Invalid detection result: ' + JSON.stringify(result));
      }

      UIModule.showDetectionResult(result);

      // Auto-select detected type if confident
      if (result.primary_class !== 'none' && result.primary_confidence >= CONFIG.CONF_THRESHOLD) {
        const chip = document.querySelector(`#type-chips .type-chip[data-class="${result.primary_class}"]`);
        if (chip) {
          chip.click();
        }
      } else if (result.primary_class !== 'none') {
        // Show message for low confidence
        UIModule.showToast('Low confidence detection - please verify or select manually', 'warning');
      } else {
        UIModule.showToast('No fishing gear detected in image', 'info');
      }
    } catch (err) {
      console.error('Detection failed:', err);
      UIModule.showToast('Detection failed: ' + (err?.message || 'Unknown error'), 'error');
      UIModule.hideDetectionResult();
    } finally {
      UIModule.hideLoading();
    }
  }

  // Type chip changed
  function onTypeChipChange(selectedClass) {
    console.log('Type selected:', selectedClass);
  }

  // Use current GPS
  async function useCurrentGPS() {
    UIModule.showLoading('Getting GPS location...');
    try {
      const pos = await LocationModule.getBrowserPosition({ timeout: 10000 });
      setLocationFromPosition(pos);
      UIModule.showToast('Location set from GPS', 'success');
    } catch (err) {
      UIModule.showToast('GPS failed: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  // Open map picker modal
  function openMapPicker() {
    const template = document.getElementById('map-picker-template');
    const content = template.content.cloneNode(true);

    // Initialize picker map after modal shows
    const modal = UIModule.showModal('Pick Location', content, []);

    // Wait for modal to render, then init map
    setTimeout(() => {
      const pickerMap = L.map('map-picker-map').setView(
        currentLocation ? [currentLocation.coords.latitude, currentLocation.coords.longitude] : [56.9496, 24.1052],
        14
      );

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(pickerMap);

      let pickerMarker = null;

      pickerMap.on('click', e => {
        if (pickerMarker) pickerMap.removeLayer(pickerMarker);
        pickerMarker = L.marker(e.latlng).addTo(pickerMap);
      });

      // Confirm button
      document.getElementById('btn-map-picker-confirm')?.addEventListener('click', () => {
        if (pickerMarker) {
          const latlng = pickerMarker.getLatLng();
          currentLocation = {
            coords: { latitude: latlng.lat, longitude: latlng.lng, accuracy: 0 },
            timestamp: Date.now()
          };
          UIModule.updateLocationDisplay(latlng.lat, latlng.lng, 0);
          UIModule.hideModal();
          UIModule.showToast('Location set from map', 'success');
        }
      });

      // Cancel button
      document.getElementById('btn-map-picker-cancel')?.addEventListener('click', () => {
        UIModule.hideModal();
      });
    }, 100);
  }

  // Handle form submission
  async function handleSubmitReport(e) {
    e.preventDefault();

    const photoFile = UIModule.getSelectedPhotoFile();
    const photoUrl = UIModule.getSelectedPhotoUrl();
    const detection = UIModule.getDetectionResult();
    const userClass = UIModule.getSelectedTypeChip('type-chips');

    // Validation
    if (!photoFile) {
      UIModule.showToast('Please add a photo', 'error');
      return;
    }

    if (!userClass) {
      UIModule.showToast('Please select a gear type', 'error');
      return;
    }

    if (!currentLocation || !currentLocation.coords) {
      UIModule.showToast('Please set a location', 'error');
      return;
    }

    const submitBtn = document.getElementById('btn-submit-report');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn__text').textContent = 'Saving...';
    submitBtn.querySelector('.btn__loading').hidden = false;

    UIModule.showLoading('Saving report...');

    try {
      // Upload photo (converts blob URL to data URL in demo mode)
      const tempId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
      const finalPhotoUrl = await StoreModule.uploadPhoto(photoFile, tempId);

      // Match registry
      const match = RegistryModule.matchRegistry({
        lat: currentLocation.coords.latitude,
        lon: currentLocation.coords.longitude,
        user_class: userClass
      });

      // Create sighting object
      const sightingData = {
        photo_url: finalPhotoUrl,
        lat: currentLocation.coords.latitude,
        lon: currentLocation.coords.longitude,
        accuracy_m: currentLocation.coords.accuracy > 0 ? Math.round(currentLocation.coords.accuracy) : null,
        detected_class: detection?.primary_class || userClass,
        confidence: detection?.primary_confidence || 0,
        user_class: userClass,
        registry_id: match?.item?.id || null,
        registry_match: !!match,
        note: document.getElementById('sighting-note').value.trim()
      };

      const sighting = StatusModule.createSighting(sightingData);

      // Validate
      const errors = StatusModule.validateSighting(sighting);
      if (errors.length > 0) {
        throw new Error(errors.join(', '));
      }

      // Save
      const saved = await StoreModule.createSightingUnified(sighting);
      sightings.unshift(saved);
      MapModule.renderSightings(sightings);

      UIModule.showToast('Report saved!', 'success');
      clearReportForm();
      UIModule.showScreen('map');

    } catch (err) {
      console.error('Save failed:', err);
      UIModule.showToast('Failed to save: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
      submitBtn.disabled = false;
      submitBtn.querySelector('.btn__text').textContent = 'Save Report';
      submitBtn.querySelector('.btn__loading').hidden = true;
    }
  }

  // Open detail view (called by MapModule)
  function showDetail(sighting) {
    if (!sighting) return;
    UIModule.showDetailView(sighting);
  }

  // Show report modal
  function showReport(sighting) {
    UIModule.showReportModal(sighting, async (reason, note) => {
      UIModule.showLoading('Submitting report...');
      try {
        const updated = await StoreModule.updateSightingUnified(sighting.id, {
          status: 'reported',
          report_reason: reason,
          note: sighting.note + (note ? '\n\nReport: ' + note : '')
        });

        // Update local
        const idx = sightings.findIndex(s => s.id === sighting.id);
        if (idx !== -1) sightings[idx] = updated;
        MapModule.renderSightings(sightings);

        UIModule.showToast('Report submitted', 'success');
      } catch (err) {
        console.error('Report failed:', err);
        UIModule.showToast('Failed to submit report', 'error');
      } finally {
        UIModule.hideLoading();
      }
    });
  }

  // Show status change modal (inspector)
  function showStatusChange(sighting) {
    if (!isInspector) return;

    UIModule.showStatusModal(sighting, async (newStatus, comment) => {
      UIModule.showLoading('Updating status...');
      try {
        const updated = await StoreModule.updateSightingStatusUnified(
          sighting.id,
          newStatus,
          comment,
          'inspector-demo' // In real app, get from auth
        );

        const idx = sightings.findIndex(s => s.id === sighting.id);
        if (idx !== -1) sightings[idx] = updated;
        MapModule.renderSightings(sightings);

        UIModule.showToast('Status updated to ' + StatusModule.getStatusLabel(newStatus), 'success');
      } catch (err) {
        console.error('Status update failed:', err);
        UIModule.showToast('Failed to update status', 'error');
      } finally {
        UIModule.hideLoading();
      }
    });
  }

  // Demo mode toggle
  function setupDemoMode() {
    const toggle = document.getElementById('toggle-demo-mode');
    const note = document.getElementById('demo-mode-note');

    // Set initial state from config
    if (toggle) {
      toggle.checked = CONFIG.DEMO_MODE;
      updateDemoModeUI(CONFIG.DEMO_MODE);
    }
  }

  function toggleDemoMode(e) {
    const enabled = e.target.checked;
    CONFIG.DEMO_MODE = enabled;
    updateDemoModeUI(enabled);
    UIModule.showToast(enabled ? 'Demo mode enabled' : 'Live mode enabled', 'info');

    // Reload sightings in new mode
    loadSightings();
  }

  function updateDemoModeUI(enabled) {
    const note = document.getElementById('demo-mode-note');
    if (note) {
      note.textContent = enabled
        ? 'Demo mode active - using stored detection results'
        : 'Live mode - using detection API';
    }
  }

  // Registry layer toggle
  function toggleRegistryLayer(e) {
    const enabled = e.target.checked;
    if (enabled) {
      renderRegistryLayer();
    } else {
      removeRegistryLayer();
    }
  }

  let registryLayer = null;
  function renderRegistryLayer() {
    const map = MapModule.getMap();
    if (!map) return;

    if (registryLayer) map.removeLayer(registryLayer);

    const registry = RegistryModule.registry || [];
    registryLayer = L.layerGroup();

    registry.forEach(item => {
      if (!item.active) return;
      const marker = L.circleMarker([item.lat, item.lon], {
        radius: 6,
        color: '#07263D',
        weight: 1.5,
        fillColor: CONFIG.COLORS.green,
        fillOpacity: 0.8,
        dashArray: '4, 4'
      });
      marker.bindTooltip(`${item.name} (${item.type})`, { permanent: false, direction: 'top' });
      marker.addTo(registryLayer);
    });

    registryLayer.addTo(map);
  }

  function removeRegistryLayer() {
    const map = MapModule.getMap();
    if (map && registryLayer) {
      map.removeLayer(registryLayer);
      registryLayer = null;
    }
  }

  // Report all unverified button handler
  async function reportAllUnverified() {
    const unverified = sightings.filter(s => s.status === 'new' && !s.registry_match);

    if (unverified.length === 0) {
      UIModule.showToast('No unverified cases to report', 'info');
      return;
    }

    const confirmed = await confirm(`Report all ${unverified.length} unverified cases to authorities?`);
    if (!confirmed) {
      return;
    }

    UIModule.showLoading('Submitting reports...');

    try {
      let updatedCount = 0;
      for (const sighting of unverified) {
        const updated = await StoreModule.updateSightingUnified(sighting.id, {
          status: 'reported',
          report_reason: 'other'
        });
        const idx = sightings.findIndex(s => s.id === sighting.id);
        if (idx !== -1) sightings[idx] = updated;
        updatedCount++;
      }

      MapModule.renderSightings(sightings);
      UIModule.showToast(`Reported ${updatedCount} cases successfully`, 'success');
    } catch (err) {
      console.error('Report all failed:', err);
      UIModule.showToast('Failed to report cases: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (unsubRealtime) unsubRealtime();
    LocationModule.stopWatch();
  });

  // Public API
  return {
    init,
    showDetail,
    showReport,
    showStatusChange,
    isInspector: () => isInspector,
    getSightings: () => sightings
  };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// Export for other modules
window.App = App;