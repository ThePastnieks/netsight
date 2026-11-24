// NetSight Map Module
// Leaflet map, sighting markers, filtering and the location picker

const MapModule = (function() {
  'use strict';

  let map = null;
  let markerLayer = null;
  let registryLayer = null;
  let userMarker = null;

  let pickerMap = null;
  let pickerMarker = null;
  let pickerCallback = null;
  let pickerLatLng = null;

  let allSightings = [];
  let filteredSightings = [];
  let currentFilter = 'all';
  let registryVisible = false;

  const FILTER_LABELS = {
    all: 'All sightings',
    unverified: 'Unverified only',
    reported: 'Reported only',
    new: 'New only',
    '24h': 'Last 24 hours',
    checked: 'Checked',
    resolved: 'Resolved'
  };

  function leafletAvailable() {
    if (typeof L === 'undefined') {
      console.error('Leaflet is not loaded');
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- main map

  function initMap(containerId, center, zoom) {
    const el = document.getElementById(containerId);
    if (!el) {
      console.error('Map container #' + containerId + ' not found');
      return null;
    }
    if (!leafletAvailable()) return null;

    try {
      map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true
      }).setView(center || CONFIG.MAP_CENTER, zoom || CONFIG.MAP_ZOOM);

      L.tileLayer(CONFIG.TILE_URL, {
        maxZoom: 19,
        attribution: CONFIG.TILE_ATTRIBUTION
      }).addTo(map);

      markerLayer = L.layerGroup().addTo(map);
      registryLayer = L.layerGroup();

      // Keep tiles crisp after screen changes
      setTimeout(() => map && map.invalidateSize(), 200);

      return map;
    } catch (err) {
      console.error('Map initialisation failed:', err);
      return null;
    }
  }

  function getMap() {
    return map;
  }

  function pinIcon(color) {
    const hex = (CONFIG.COLORS && CONFIG.COLORS[color]) || CONFIG.COLORS.grey;
    return L.divIcon({
      className: 'map-pin',
      html: `<span class="map-pin__dot" style="--pin-color:${hex}"></span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14]
    });
  }

  function popupHtml(s) {
    const statusLabel = StatusModule.getStatusLabel(s.status);
    const confidencePct = Math.round((s.confidence || 0) * 100);
    const registryText = s.registry_match ? 'Registered' : 'Unverified';
    const registryClass = s.registry_match ? 'registry-yes' : 'registry-no';

    return `
      <div class="map-popup">
        <div class="map-popup__row">
          <span class="status-badge status-badge--${s.status}">${UIModule.escapeHtml(statusLabel)}</span>
          <span class="${registryClass}">${registryText}</span>
        </div>
        <div class="map-popup__meta">
          <span>${UIModule.escapeHtml(s.user_class || 'unknown')}</span>
          <span>${confidencePct}%</span>
        </div>
        <button type="button" class="btn btn--outline btn--sm map-popup__btn" data-id="${UIModule.escapeHtml(s.id)}">Details</button>
      </div>
    `;
  }

  function addMarker(s) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return;

    const marker = L.marker([s.lat, s.lon], {
      icon: pinIcon(StatusModule.pinColor(s)),
      title: s.user_class || 'sighting'
    }).addTo(markerLayer);

    marker.bindPopup(popupHtml(s), { minWidth: 180 });

    marker.on('popupopen', e => {
      const popupEl = e.popup.getElement();
      if (!popupEl) return;
      const btn = popupEl.querySelector('.map-popup__btn');
      if (btn) {
        btn.addEventListener('click', () => {
          const found = allSightings.find(x => x.id === btn.dataset.id);
          if (found) UIModule.showDetailView(found);
        });
      }
    });
  }

  function matchesFilter(s, filter) {
    switch (filter) {
      case 'all':
        return true;
      case 'unverified':
        return !s.registry_match;
      case '24h': {
        const created = new Date(s.created_at).getTime();
        return Number.isFinite(created) && (Date.now() - created) <= 86400000;
      }
      case 'new':
        return s.status === 'new';
      case 'checked':
        return s.status === 'checked';
      case 'reported':
        return s.status === 'reported';
      case 'resolved':
        return s.status === 'resolved';
      default:
        return true;
    }
  }

  function renderSightings(sightings) {
    allSightings = Array.isArray(sightings) ? sightings.slice() : [];
    applyFilter();
  }

  function applyFilter() {
    filteredSightings = allSightings.filter(s => matchesFilter(s, currentFilter));

    if (markerLayer) {
      markerLayer.clearLayers();
      filteredSightings.forEach(addMarker);
    }

    const label = document.getElementById('filter-label');
    if (label) {
      const text = FILTER_LABELS[currentFilter] || 'All sightings';
      label.textContent = `${text} · ${filteredSightings.length}`;
    }

    return filteredSightings;
  }

  function setFilter(filter) {
    currentFilter = filter || 'all';
    return applyFilter();
  }

  function getFilter() {
    return currentFilter;
  }

  function getVisibleSightings() {
    return filteredSightings.slice();
  }

  function refresh() {
    return applyFilter();
  }

  function focusOn(lat, lon, zoom) {
    if (!map) return;
    map.setView([lat, lon], zoom || Math.max(map.getZoom(), 14));
  }

  function focusSighting(id) {
    const s = allSightings.find(x => x.id === id);
    if (s) focusOn(s.lat, s.lon, 16);
  }

  // --------------------------------------------------------- user position

  function showUserPosition(lat, lon, accuracy) {
    if (!map || !leafletAvailable()) return;
    const latlng = [lat, lon];

    if (!userMarker) {
      userMarker = L.circleMarker(latlng, {
        radius: 7,
        color: '#1FA6D8',
        weight: 2,
        fillColor: '#1FA6D8',
        fillOpacity: 0.5
      }).addTo(map);
    } else {
      userMarker.setLatLng(latlng);
    }

    if (accuracy && accuracy < 500) {
      if (!userMarker._accuracyCircle) {
        userMarker._accuracyCircle = L.circle(latlng, {
          radius: accuracy,
          color: '#1FA6D8',
          weight: 1,
          opacity: 0.4,
          fillColor: '#1FA6D8',
          fillOpacity: 0.08
        }).addTo(map);
      } else {
        userMarker._accuracyCircle.setLatLng(latlng).setRadius(accuracy);
      }
    }
  }

  // ---------------------------------------------------------- registry layer

  async function toggleRegistryLayer(show) {
    if (!map) return false;
    registryVisible = !!show;

    if (!registryVisible) {
      registryLayer.clearLayers();
      map.removeLayer(registryLayer);
      return false;
    }

    const registry = RegistryModule.registry || await RegistryModule.loadRegistry();
    registryLayer.clearLayers();

    registry.forEach(item => {
      L.circle([item.lat, item.lon], {
        radius: CONFIG.MATCH_RADIUS_M,
        color: '#2E9E57',
        weight: 1,
        opacity: 0.7,
        fillColor: '#2E9E57',
        fillOpacity: 0.12
      })
        .bindPopup(
          `<strong>${UIModule.escapeHtml(item.id)}</strong><br>` +
          `${UIModule.escapeHtml(item.type)} · ${UIModule.escapeHtml(item.owner_label || '')}`
        )
        .addTo(registryLayer);
    });

    registryLayer.addTo(map);
    return true;
  }

  // ---------------------------------------------------------- location picker

  function openPicker(onConfirm, initial) {
    const modal = document.getElementById('map-picker-modal');
    if (!modal) {
      console.error('Map picker modal not found');
      return;
    }

    pickerCallback = onConfirm || null;
    const start = initial || LocationModule.getLastPosition() || {
      lat: CONFIG.MAP_CENTER[0],
      lon: CONFIG.MAP_CENTER[1]
    };
    pickerLatLng = { lat: start.lat, lon: start.lon };

    modal.hidden = false;
    void modal.offsetHeight;
    modal.classList.add('sheet--visible');

    if (!pickerMap) {
      pickerMap = L.map('map-picker-map').setView([start.lat, start.lon], 14);
      L.tileLayer(CONFIG.TILE_URL, {
        maxZoom: 19,
        attribution: CONFIG.TILE_ATTRIBUTION
      }).addTo(pickerMap);

      pickerMap.on('click', e => {
        setPickerPoint(e.latlng.lat, e.latlng.lng);
      });
    } else {
      pickerMap.setView([start.lat, start.lon], 14);
    }

    setPickerPoint(start.lat, start.lon);
    setTimeout(() => pickerMap.invalidateSize(), 150);
  }

  function setPickerPoint(lat, lon) {
    pickerLatLng = { lat, lon };
    if (!pickerMap) return;

    if (!pickerMarker) {
      pickerMarker = L.marker([lat, lon], { draggable: true, icon: pinIcon('blue') }).addTo(pickerMap);
      pickerMarker.on('dragend', () => {
        const p = pickerMarker.getLatLng();
        pickerLatLng = { lat: p.lat, lon: p.lng };
      });
    } else {
      pickerMarker.setLatLng([lat, lon]);
    }
  }

  function closePicker() {
    const modal = document.getElementById('map-picker-modal');
    if (!modal) return;
    modal.classList.remove('sheet--visible');
    modal.hidden = true;
  }

  function confirmPicker() {
    const cb = pickerCallback;
    const point = pickerLatLng;
    pickerCallback = null;
    closePicker();
    if (cb && point) cb(point.lat, point.lon);
  }

  return {
    initMap,
    getMap,
    renderSightings,
    setFilter,
    getFilter,
    getVisibleSightings,
    refresh,
    focusOn,
    focusSighting,
    showUserPosition,
    toggleRegistryLayer,
    openPicker,
    closePicker,
    confirmPicker
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MapModule;
} else {
  window.MapModule = MapModule;
}


