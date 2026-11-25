// NetSight Map Module
// Leaflet map, sighting markers, filtering and the location picker

const MapModule = (function() {
  'use strict';

  let map = null;
  let markerLayer = null;
  let registryLayer = null;
  let deviceLayer = null;
  let zoneLayer = null;
  let userMarker = null;

  let pickerMap = null;
  let pickerMarker = null;
  let pickerCallback = null;
  let pickerLatLng = null;

  let allSightings = [];
  let filteredSightings = [];
  let currentFilter = 'all';
  let registryVisible = false;

  // Geofence palette. Red is the 50 m limit, green is gear on the water.
  const LIMIT_LINE = '#E5484D';
  const PERMIT_FILL = '#2FA36B';
  const PERMIT_FILL_SOFT = 'rgba(47, 163, 107, 0.14)';
  const GEAR_LINE = '#2FA36B';
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
      deviceLayer = L.layerGroup();
      zoneLayer = L.layerGroup();

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

  // A sighting that carries a span gets its line drawn as well as its pin.
  function renderSpans(sightings) {
    if (!markerLayer) return;

    (sightings || []).forEach(s => {
      if (!Array.isArray(s.span) || s.span.length !== 2) return;

      L.polyline(s.span, {
        color: GEAR_LINE,
        weight: 3,
        opacity: 0.85,
        lineCap: 'round',
        className: 'gear-line',
        interactive: false
      }).addTo(markerLayer);
    });
  }

  function renderSightings(sightings) {
    allSightings = Array.isArray(sightings) ? sightings.slice() : [];
    applyFilter();
  }

  function applyFilter() {
    filteredSightings = allSightings.filter(s => matchesFilter(s, currentFilter));

    if (markerLayer) {
      markerLayer.clearLayers();
      renderSpans(filteredSightings);
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



  function refresh() {
    return applyFilter();
  }

  function focusOn(lat, lon, zoom) {
    if (!map) return;
    map.setView([lat, lon], zoom || Math.max(map.getZoom(), 14));
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


  // ----------------------------------------------------------- device layer

  // A buoy marker that stays visible at night: a solid core, a bright ring and
  // a soft glow. Colour carries the alert level, not the gear type.
  function deviceIcon(level) {
    const tone = {
      ok: '#2FA36B',
      warn: '#F0920F',
      danger: '#E5484D',
      info: '#1FA6D8'
    }[level] || '#7D8C99';

    return L.divIcon({
      className: 'device-pin',
      html:
        '<span class="device-pin__glow" style="--tone:' + tone + '"></span>' +
        '<span class="device-pin__core" style="--tone:' + tone + '"></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -16]
    });
  }

  function devicePopup(d) {
    const alerts = (typeof Devices !== 'undefined') ? Devices.evaluate(d) : [];
    const level = alerts.length
      ? alerts.reduce((worst, a) => (a.level === 'danger' ? 'danger' : worst), alerts[0].level)
      : 'ok';

    const rows = alerts.length
      ? alerts.map(a => '<li class="device-popup__alert" data-level="' + a.level + '">' +
          UIModule.escapeHtml(a.title) + ' — ' + UIModule.escapeHtml(a.detail) + '</li>').join('')
      : '<li class="device-popup__ok">Reporting normally</li>';

    return '' +
      '<div class="device-popup" data-level="' + level + '">' +
        '<strong class="device-popup__title">' + UIModule.escapeHtml(d.label) + '</strong>' +
        '<div class="device-popup__meta">' +
          '<span>' + UIModule.escapeHtml(d.gearType || 'gear') + '</span>' +
          '<span>' + Math.round(d.battery) + '%</span>' +
          '<span>' + (Number.isFinite(d.temperature_c) ? d.temperature_c + ' °C' : '—') + '</span>' +
        '</div>' +
        '<ul class="device-popup__alerts">' + rows + '</ul>' +
      '</div>';
  }

  function renderDevices(devices) {
    if (!deviceLayer) return;
    deviceLayer.clearLayers();

    (devices || []).forEach(d => {
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return;

      const level = (typeof Devices !== 'undefined') ? Devices.worstLevel(d) : 'ok';

      // A net is strung between two anchors: draw the span first so the marker
      // sits on top of its own line.
      if (Array.isArray(d.span) && d.span.length === 2) {
        L.polyline(d.span, {
          color: GEAR_LINE,
          weight: 3,
          opacity: 0.9,
          lineCap: 'round',
          interactive: false
        }).addTo(deviceLayer);

        d.span.forEach(point => {
          L.circleMarker(point, {
            radius: 3.5,
            color: '#fff',
            weight: 1.5,
            fillColor: GEAR_LINE,
            fillOpacity: 1,
            interactive: false
          }).addTo(deviceLayer);
        });
      }

      L.marker([d.lat, d.lon], {
        icon: deviceIcon(level),
        title: d.label,
        zIndexOffset: 500
      })
        .bindPopup(devicePopup(d), { minWidth: 200 })
        .addTo(deviceLayer);
    });
  }

  function toggleDeviceLayer(show) {
    if (!map || !deviceLayer) return false;

    if (show) deviceLayer.addTo(map);
    else map.removeLayer(deviceLayer);

    return !!show;
  }

  // Draws the permitted water: the bank itself as a hairline, the 50 m limit as
  // the red line, and a soft fill for the area you may actually use.
  // Paints the permitted water from the grid: a soft green wash over the area
  // you may use, and the 50 m limit as a red line along its edge.
  //
  // Drawn into a canvas at 3 px per cell, then handed to Leaflet as one image
  // overlay. That keeps it a single layer however many cells there are, and the
  // browser's own smoothing turns the cell steps into a clean edge.
  const ZONE_SCALE = 3;

  function zoneCanvas() {
    const info = Devices.gridInfo();
    if (!info) return null;

    const cells = Devices.permittedCells();
    if (!cells.length) return null;

    const w = info.cols * ZONE_SCALE;
    const h = info.rows * ZONE_SCALE;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    const at = (r, c) => c >= 0 && c < info.cols && r >= 0 && r < info.rows
      ? Devices.isPermitted(
          info.area.minLat + (r + 0.5) * ((info.area.maxLat - info.area.minLat) / info.rows),
          info.area.minLon + (c + 0.5) * ((info.area.maxLon - info.area.minLon) / info.cols))
      : false;

    // 1. the wash
    ctx.fillStyle = PERMIT_FILL_SOFT;
    cells.forEach(run => {
      ctx.fillRect(run.c0 * ZONE_SCALE, run.r * ZONE_SCALE,
        (run.c1 - run.c0 + 1) * ZONE_SCALE, ZONE_SCALE);
    });

    // 2. the limit: every permitted cell that touches a non-permitted one
    ctx.fillStyle = LIMIT_LINE;
    const t = ZONE_SCALE;

    cells.forEach(run => {
      for (let c = run.c0; c <= run.c1; c++) {
        const edge = !at(run.r - 1, c) || !at(run.r + 1, c)
          || !at(run.r, c - 1) || !at(run.r, c + 1);

        if (!edge) continue;

        // draw the cell's outline on the sides that face out, so the line is
        // one cell thick rather than a filled band
        if (!at(run.r - 1, c)) ctx.fillRect(c * t, run.r * t, t, t * 0.5);
        if (!at(run.r + 1, c)) ctx.fillRect(c * t, run.r * t + t * 0.5, t, t * 0.5);
        if (!at(run.r, c - 1)) ctx.fillRect(c * t, run.r * t, t * 0.5, t);
        if (!at(run.r, c + 1)) ctx.fillRect(c * t + t * 0.5, run.r * t, t * 0.5, t);
      }
    });

    return { canvas, bounds: [[info.area.minLat, info.area.minLon],
                             [info.area.maxLat, info.area.maxLon]] };
  }

  function toggleZones(show) {
    if (!map || !zoneLayer) return false;

    zoneLayer.clearLayers();

    if (!show) {
      map.removeLayer(zoneLayer);
      return false;
    }

    if (typeof Devices === 'undefined' || !Devices.gridReady()) return false;

    const built = zoneCanvas();
    if (!built) return false;

    L.imageOverlay(built.canvas.toDataURL('image/png'), built.bounds, {
      opacity: 1,
      interactive: false,
      className: 'zone-overlay'
    }).addTo(zoneLayer);

    zoneLayer.addTo(map);
    return true;
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

  // ------------------------------------------------------------ net drawing
  //
  // A net is not a point. This lets the reporter put down two anchors and see
  // the line between them, which is what a net actually is on the water.

  let spanMap = null;
  let spanLine = null;
  let spanMarkers = [];
  let spanPoints = [];
  let spanCallback = null;

  function openSpanPicker(onConfirm, initial) {
    const modal = document.getElementById('span-picker-modal');
    if (!modal) {
      console.error('Span picker modal not found');
      return;
    }

    spanCallback = onConfirm || null;
    spanPoints = [];
    clearSpan();

    const start = initial || LocationModule.getLastPosition() || {
      lat: CONFIG.MAP_CENTER[0],
      lon: CONFIG.MAP_CENTER[1]
    };

    modal.hidden = false;
    void modal.offsetHeight;
    modal.classList.add('sheet--visible');

    // The modal has to be laid out before Leaflet can measure the container,
    // otherwise the map is created 0x0 and never shows a tile.
    setTimeout(() => {
      if (!spanMap) {
        spanMap = L.map('span-picker-map').setView([start.lat, start.lon], 15);
        L.tileLayer(CONFIG.TILE_URL, {
          maxZoom: 19,
          attribution: CONFIG.TILE_ATTRIBUTION
        }).addTo(spanMap);

        spanMap.on('click', e => addSpanPoint(e.latlng.lat, e.latlng.lng));
      } else {
        spanMap.setView([start.lat, start.lon], 15);
        spanMap.invalidateSize();
      }

      clearSpan();
    }, 60);

    updateSpanUi();
  }

  function addSpanPoint(lat, lon) {
    if (!spanMap) return;

    // Two points is a net. A third starts a new one, so a mis-tap is one tap to
    // fix rather than a modal to reopen.
    if (spanPoints.length >= 2) clearSpan();

    spanPoints.push({ lat, lon });

    const marker = L.circleMarker([lat, lon], {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: GEAR_LINE,
      fillOpacity: 1
    }).addTo(spanMap);

    spanMarkers.push(marker);

    if (spanPoints.length === 2) {
      const [a, b] = spanPoints;
      spanLine = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
        color: GEAR_LINE,
        weight: 4,
        opacity: 0.95,
        lineCap: 'round'
      }).addTo(spanMap);

      const metres = Devices.haversine(a.lat, a.lon, b.lat, b.lon);
      spanMap.fitBounds([[a.lat, a.lon], [b.lat, b.lon]], { padding: [50, 50] });
      updateSpanUi(metres);
      return;
    }

    updateSpanUi();
  }

  function clearSpan() {
    if (!spanMap) return;

    spanMarkers.forEach(m => spanMap.removeLayer(m));
    spanMarkers = [];

    if (spanLine) {
      spanMap.removeLayer(spanLine);
      spanLine = null;
    }

    spanPoints = [];
    updateSpanUi();
  }

  function updateSpanUi(metres) {
    const hint = document.getElementById('span-hint');
    const btn = document.getElementById('btn-span-confirm');
    const undo = document.getElementById('btn-span-undo');

    if (hint) {
      if (spanPoints.length === 0) {
        hint.textContent = 'Tap the map where the net starts';
        hint.dataset.state = 'idle';
      } else if (spanPoints.length === 1) {
        hint.textContent = 'Now tap where it ends';
        hint.dataset.state = 'idle';
      } else {
        const m = metres !== undefined ? metres
          : Devices.haversine(spanPoints[0].lat, spanPoints[0].lon,
                              spanPoints[1].lat, spanPoints[1].lon);
        hint.textContent = Math.round(m) + ' m between the two anchors';
        hint.dataset.state = 'ok';
      }
    }

    if (btn) btn.disabled = spanPoints.length < 2;
    if (undo) undo.disabled = spanPoints.length === 0;
  }

  function confirmSpan() {
    if (spanPoints.length < 2) return;

    const cb = spanCallback;
    const points = spanPoints.map(p => [p.lat, p.lon]);

    spanCallback = null;
    closeSpanPicker();

    if (cb) cb(points);
  }

  function closeSpanPicker() {
    const modal = document.getElementById('span-picker-modal');
    if (!modal) return;
    modal.classList.remove('sheet--visible');
    modal.hidden = true;
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
    refresh,
    focusOn,
    showUserPosition,
    toggleRegistryLayer,
    renderDevices,
    toggleDeviceLayer,
    toggleZones,
    openPicker,
    closePicker,
    confirmPicker,
    getSpanMap: () => spanMap,
    openSpanPicker,
    closeSpanPicker,
    confirmSpan,
    clearSpan
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MapModule;
} else {
  window.MapModule = MapModule;
}



















