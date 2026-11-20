// NetSight Map Module
// Leaflet map, pins, popups, filters

const MapModule = (function() {
  'use strict';

  let map = null;
  let markersLayer = null;
  let currentFilter = 'all';
  let sightingsData = [];

  // Color mapping
  const COLORS = {
    green: '#2E9E57',
    orange: '#FF8A3D',
    red: '#D93636',
    blue: '#1FA6D8',
    grey: '#7D8C99'
  };

  // Initialize map
  function initMap(containerId = 'map', center = [56.9496, 24.1052], zoom = 12) {
    if (typeof L === 'undefined') {
      console.error('Leaflet not loaded');
      return null;
    }

    map = L.map(containerId).setView(center, zoom);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    return map;
  }

  // Get map instance
  function getMap() {
    return map;
  }

  // Build popup HTML for a sighting
  function buildPopupHtml(sighting) {
    const statusModule = window.StatusModule;
    const statusLabel = statusModule ? statusModule.getStatusLabel(sighting.status) : sighting.status;
    const pinColor = statusModule ? statusModule.pinColor(sighting) : 'orange';
    const colorHex = COLORS[pinColor] || COLORS.orange;
    const timeStr = new Date(sighting.created_at).toLocaleString();
    const confidencePct = Math.round((sighting.confidence || 0) * 100);
    const registryText = sighting.registry_match ? 'Registered' : 'Unverified';
    const registryColor = sighting.registry_match ? COLORS.green : COLORS.orange;

    let html = `
      <div class="popup">
        <div class="popup__header">
          <span class="popup__type">${sighting.user_class || 'unknown'}</span>
          <span class="popup__status" style="color: ${colorHex}; font-weight: 600;">${statusLabel}</span>
        </div>
        <dl class="popup__meta">
          <dt>Time</dt><dd>${timeStr}</dd>
          <dt>Confidence</dt><dd>${confidencePct}%</dd>
          <dt>Registry</dt><dd style="color: ${registryColor}; font-weight: 600;">${registryText}</dd>
          <dt>Accuracy</dt><dd>${sighting.accuracy_m ? sighting.accuracy_m + ' m' : 'Manual'}</dd>
        </dl>
    `;

    if (sighting.note) {
      html += `<div class="popup__note">${escapeHtml(sighting.note)}</div>`;
    }

    html += `
        <div class="popup__actions">
          <button type="button" class="btn btn--primary btn--sm" onclick="window.MapModule?.openDetail('${sighting.id}')">Details</button>
          <button type="button" class="btn btn--outline btn--sm" onclick="window.MapModule?.reportSighting('${sighting.id}')">Report</button>
        </div>
      </div>
    `;

    return html;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Add a pin to the map
  function addPin(sighting) {
    if (!map || !markersLayer) return null;

    const pinColor = window.StatusModule ? window.StatusModule.pinColor(sighting) : 'orange';
    const colorHex = COLORS[pinColor] || COLORS.orange;

    const marker = L.circleMarker([sighting.lat, sighting.lon], {
      radius: 9,
      color: '#07263D',
      weight: 2,
      fillColor: colorHex,
      fillOpacity: 0.95
    });

    marker.bindPopup(buildPopupHtml(sighting), {
      minWidth: 240,
      maxWidth: 300
    });

    marker.sightingId = sighting.id;
    marker.addTo(markersLayer);

    return marker;
  }

  // Clear all pins
  function clearPins() {
    if (markersLayer) {
      markersLayer.clearLayers();
    }
  }

  // Render all sightings with current filter
  function renderSightings(sightings) {
    sightingsData = sightings || [];
    clearPins();

    const filtered = filterSightings(sightingsData, currentFilter);
    filtered.forEach(addPin);

    // Fit bounds if there are markers
    if (filtered.length > 0 && markersLayer.getLayers().length > 0) {
      const group = new L.featureGroup(markersLayer.getLayers());
      map.fitBounds(group.getBounds().pad(0.1));
    }

    return filtered.length;
  }

  // Filter sightings
  function filterSightings(sightings, filter) {
    if (!filter || filter === 'all') return sightings;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return sightings.filter(s => {
      switch (filter) {
        case 'unverified':
          return s.status === 'new' && !s.registry_match;
        case 'reported':
          return s.status === 'reported';
        case '24h':
          return new Date(s.created_at).getTime() > now - dayMs;
        case 'checked':
          return s.status === 'checked';
        case 'resolved':
          return s.status === 'resolved' || s.status === 'false_alarm';
        default:
          return true;
      }
    });
  }

  // Set filter and re-render
  function setFilter(filter) {
    currentFilter = filter;
    if (sightingsData.length > 0) {
      renderSightings(sightingsData);
    }
    updateFilterUI(filter);
  }

  // Update filter chip UI
  function updateFilterUI(activeFilter) {
    document.querySelectorAll('.filter-chip').forEach(chip => {
      const filter = chip.dataset.filter;
      if (filter === activeFilter) {
        chip.classList.add('filter-chip--active');
      } else {
        chip.classList.remove('filter-chip--active');
      }
    });
  }

  // Open detail view (to be implemented by app)
  function openDetail(sightingId) {
    const sighting = sightingsData.find(s => s.id === sightingId);
    if (sighting && window.App && window.App.showDetail) {
      window.App.showDetail(sighting);
    }
  }

  // Report sighting (to be implemented by app)
  function reportSighting(sightingId) {
    const sighting = sightingsData.find(s => s.id === sightingId);
    if (sighting && window.App && window.App.showReport) {
      window.App.showReport(sighting);
    }
  }

  // Get current filter
  function getFilter() {
    return currentFilter;
  }

  // Get sighting by ID
  function getSighting(id) {
    return sightingsData.find(s => s.id === id) || null;
  }

  // Pan to sighting
  function panToSighting(sighting) {
    if (map && sighting) {
      map.setView([sighting.lat, sighting.lon], 15);
    }
  }

  // Public API
  return {
    initMap,
    getMap,
    addPin,
    clearPins,
    renderSightings,
    setFilter,
    getFilter,
    getSighting,
    panToSighting,
    openDetail,
    reportSighting,
    filterSightings,
    buildPopupHtml
  };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MapModule;
} else {
  window.MapModule = MapModule;
}