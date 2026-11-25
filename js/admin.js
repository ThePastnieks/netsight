// NetSight Admin
// Administrator panel: manage points (delete), configure the model, manage PINs.
// Reached through the app-wide login; this page only accepts the admin role.

const Admin = (function() {
  'use strict';

  let sightings = [];
  let selected = new Set();
  let filter = 'all';
  let sort = 'created_desc';

  // ---------------------------------------------------------------- boot

  async function boot(session) {
    Theme.init();
    Auth.mount(session);
    Detect.load();

    bindTabs();
    bindPoints();
    bindProviders();
    bindDevices();
    bindShore();
    bindUsers();
    bindSecurity();

    await loadPoints();
    renderProviders();
    renderDevices();
    renderShoreList();
    syncDetection();

  }

  function bindTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');

        document.querySelectorAll('[data-pane]').forEach(pane => {
          pane.classList.toggle('is-active', pane.dataset.pane === btn.dataset.tab);
        });

        document.querySelector('.screen__body').scrollTop = 0;

        // Leaflet cannot measure a hidden container, so the shore map is built
        // the first time its tab is opened.
        if (btn.dataset.tab === 'shore') {
          setTimeout(() => {
            initShoreMap();
            if (shoreMap) shoreMap.invalidateSize();
          }, 60);
        }
      });
    });
  }

  // -------------------------------------------------------------- points

  async function loadPoints() {
    try {
      sightings = await StoreModule.getSightingsUnified(1000);
    } catch (err) {
      console.error('Could not load sightings:', err);
      UIModule.showToast('Could not load sightings', 'error');
      sightings = [];
    }
    selected.clear();
    renderPoints();
    renderStats();
  }

  function renderStats() {
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n);
    };

    set('s-total', sightings.length);
    set('s-unverified', sightings.filter(s => !s.registry_match).length);
    set('s-reported', sightings.filter(s => s.status === 'reported').length);
    set('s-resolved', sightings.filter(s => s.status === 'resolved').length);

    const sub = document.getElementById('admin-sub');
    if (sub) sub.textContent = sightings.length + ' sightings';
  }

  function visiblePoints() {
    const list = sightings.filter(s => filter === 'all' || s.status === filter);

    list.sort((a, b) => {
      const ta = new Date(a.created_at).getTime() || 0;
      const tb = new Date(b.created_at).getTime() || 0;
      return sort === 'created_asc' ? ta - tb : tb - ta;
    });

    return list;
  }

  function renderPoints() {
    const host = document.getElementById('points-list');
    const empty = document.getElementById('points-empty');
    if (!host) return;

    const list = visiblePoints();

    if (list.length === 0) {
      host.innerHTML = '';
      if (empty) empty.hidden = false;
      updateSelectionUI();
      return;
    }

    if (empty) empty.hidden = true;

    host.innerHTML = list.map(pointCard).join('');

    host.querySelectorAll('[data-pick]').forEach(box => {
      box.addEventListener('change', () => {
        if (box.checked) selected.add(box.dataset.pick);
        else selected.delete(box.dataset.pick);
        updateSelectionUI();
      });
    });

    host.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (btn.dataset.act === 'delete') removeOne(id);
        if (btn.dataset.act === 'view') viewOne(id);
      });
    });

    updateSelectionUI();
  }

  function pointCard(s) {
    const statusLabel = StatusModule.getStatusLabel(s.status);
    const confidence = Math.round((s.confidence || 0) * 100);
    const photo = s.photo_url && String(s.photo_url).startsWith('data:')
      ? `<img src="${s.photo_url}" alt="">`
      : `<span class="point__noimg">${UIModule.escapeHtml((s.user_class || '?').slice(0, 3))}</span>`;

    const coords = Number.isFinite(s.lat) && Number.isFinite(s.lon)
      ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`
      : 'no coords';

    const when = timeAgo(s.created_at);
    const registry = s.registry_match
      ? `<span class="registry-yes">${UIModule.escapeHtml(s.registry_id || 'registered')}</span>`
      : '<span class="registry-no">unverified</span>';

    return `
      <article class="point" data-id="${UIModule.escapeHtml(s.id)}">
        <label class="point__check" aria-label="Select sighting">
          <input type="checkbox" data-pick="${UIModule.escapeHtml(s.id)}"
            ${selected.has(s.id) ? 'checked' : ''}>
        </label>

        <div class="point__thumb">${photo}</div>

        <div class="point__body">
          <div class="point__row">
            <span class="status-badge status-badge--${s.status}">${UIModule.escapeHtml(statusLabel)}</span>
            <span class="point__type">${UIModule.escapeHtml(s.user_class || 'unknown')}</span>
            <span class="point__conf">${confidence}%</span>
            ${registry}
          </div>
          <div class="point__meta">
            <span class="monospace">${UIModule.escapeHtml(coords)}</span>
            <span>${UIModule.escapeHtml(when)}</span>
          </div>
        </div>

        <div class="point__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-act="view" data-id="${UIModule.escapeHtml(s.id)}">View</button>
          <button type="button" class="btn btn--danger btn--sm" data-act="delete" data-id="${UIModule.escapeHtml(s.id)}">Delete</button>
        </div>
      </article>
    `;
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return 'unknown';
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function updateSelectionUI() {
    const badge = document.getElementById('sel-count');
    const del = document.getElementById('btn-delete-selected');
    const n = selected.size;

    if (badge) {
      badge.hidden = n === 0;
      badge.textContent = n + ' selected';
    }
    if (del) del.disabled = n === 0;
  }

  async function removeOne(id) {
    const point = sightings.find(s => s.id === id);
    if (!point) return;

    const ok = await UIModule.confirm(
      `Delete this ${point.user_class || 'sighting'} point permanently?`,
      { title: 'Delete point', confirmLabel: 'Delete', danger: true }
    );
    if (!ok) return;

    UIModule.showLoading('Deleting…');
    try {
      await StoreModule.deleteSightingUnified(id);
      selected.delete(id);
      await loadPoints();
    renderUsers();
      UIModule.showToast('Point deleted', 'success');
    } catch (err) {
      console.error('Delete failed:', err);
      UIModule.showToast('Delete failed: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  async function removeSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const ok = await UIModule.confirm(
      `Delete ${ids.length} selected point(s) permanently?`,
      { title: 'Delete selected', confirmLabel: 'Delete ' + ids.length, danger: true }
    );
    if (!ok) return;

    UIModule.showLoading('Deleting…');
    try {
      const result = await StoreModule.deleteManyUnified(ids);
      selected.clear();
      await loadPoints();
    renderUsers();
      UIModule.showToast(`Deleted ${result.deleted} point(s)`, 'success');
    } catch (err) {
      console.error('Bulk delete failed:', err);
      UIModule.showToast('Delete failed: ' + err.message, 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  async function wipeAll() {
    const ok = await UIModule.confirm(
      `Delete all ${sightings.length} sightings? This cannot be undone.`,
      { title: 'Delete everything', confirmLabel: 'Delete all', danger: true }
    );
    if (!ok) return;

    UIModule.showLoading('Clearing…');
    try {
      const result = await StoreModule.deleteAllUnified();
      selected.clear();
      await loadPoints();
    renderUsers();
      UIModule.showToast(`Removed ${result.deleted} point(s)`, 'success');
    } catch (err) {
      UIModule.showToast(err.message, 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(sightings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netsight-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    UIModule.showToast('Exported ' + sightings.length + ' sightings', 'success');
  }

  function viewOne(id) {
    const point = sightings.find(s => s.id === id);
    if (point) UIModule.showDetailView(point);
  }

  function bindPoints() {
    document.getElementById('admin-filter')?.addEventListener('change', e => {
      filter = e.target.value;
      renderPoints();
    });

    document.getElementById('admin-sort')?.addEventListener('change', e => {
      sort = e.target.value;
      renderPoints();
    });

    document.getElementById('btn-select-all')?.addEventListener('click', () => {
      const list = visiblePoints();
      const allPicked = list.every(s => selected.has(s.id));

      if (allPicked) list.forEach(s => selected.delete(s.id));
      else list.forEach(s => selected.add(s.id));

      renderPoints();
    });

    document.getElementById('btn-delete-selected')?.addEventListener('click', removeSelected);
    document.getElementById('btn-wipe')?.addEventListener('click', wipeAll);
    document.getElementById('btn-export')?.addEventListener('click', exportJson);
  }

  // ------------------------------------------------------------- detection

  function renderProviders() {
    const cfg = Detect.get();

    const endpoint = document.getElementById('detect-endpoint');
    if (endpoint && document.activeElement !== endpoint) {
      endpoint.value = cfg.endpoint || '';
    }

    const threshold = document.getElementById('ai-threshold');
    const thrVal = document.getElementById('thr-val');
    if (threshold && document.activeElement !== threshold) {
      threshold.value = Math.round(cfg.minConfidence * 100);
      if (thrVal) thrVal.textContent = Math.round(cfg.minConfidence * 100) + '%';
      paintRange(threshold);
    }

    syncDetection();
  }

  function syncDetection() {
    const cfg = Detect.get();
    const ready = !!cfg.endpoint;
    const badge = document.getElementById('ai-ready');

    if (badge) {
      badge.textContent = ready ? 'connected' : 'not set';
      badge.dataset.state = ready ? 'ready' : 'off';
    }

    const hint = document.getElementById('ai-hint');
    if (hint) {
      hint.textContent = ready
        ? 'Photos are sent to ' + cfg.endpoint + '. The app shows whatever the model answers.'
        : 'No endpoint set. Uploads will report that detection is unavailable.';
      hint.dataset.tone = ready ? 'ok' : 'error';
    }
  }

  function bindProviders() {
    const endpoint = document.getElementById('detect-endpoint');
    endpoint?.addEventListener('change', () => {
      Detect.save({ endpoint: endpoint.value.trim() });
      renderProviders();
      UIModule.showToast('Endpoint saved', 'success');
    });

    const threshold = document.getElementById('ai-threshold');
    threshold?.addEventListener('input', () => {
      const thrVal = document.getElementById('thr-val');
      if (thrVal) thrVal.textContent = threshold.value + '%';
      paintRange(threshold);
    });
    threshold?.addEventListener('change', () => {
      Detect.save({ minConfidence: Number(threshold.value) / 100 });
      const thrVal = document.getElementById('thr-val');
      if (thrVal) thrVal.textContent = threshold.value + '%';
      syncDetection();
    });

    document.getElementById('btn-detect-test')?.addEventListener('click', async () => {
      const note = document.getElementById('ai-hint');
      const btn = document.getElementById('btn-detect-test');

      if (note) {
        note.textContent = 'Contacting the model…';
        note.dataset.tone = 'info';
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Testing…';
      }

      const res = await Detect.testEndpoint(endpoint ? endpoint.value.trim() : undefined);

      if (note) {
        note.textContent = res.message;
        note.dataset.tone = res.ok ? 'ok' : 'error';
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Test endpoint';
      }

      UIModule.showToast(
        res.ok ? 'Model reachable' : 'Test failed: ' + res.message,
        res.ok ? 'success' : 'error'
      );
    });

    document.getElementById('btn-detect-reset')?.addEventListener('click', () => {
      Detect.reset();
      renderProviders();
      UIModule.showToast('Detection settings reset', 'info');
    });
  }

  function paintRange(el) {
    const pct = ((Number(el.value) - Number(el.min)) /
      (Number(el.max) - Number(el.min))) * 100;
    el.style.setProperty('--fill', pct + '%');
  }
  // --------------------------------------------------------------- shore
  //
  // Hand-drawn shoreline. Three tools: tap a polygon, drop a circle, or drag a
  // freehand trace. Each finished shape is closed water; the app offsets it
  // inward by minShoreMetres and that offset is the red line.

  let shoreMap = null;
  let drawLayer = null;      // the shape being drawn right now
  let draftLayer = null;     // committed shapes, for reference
  let draft = [];            // points of the shape in progress
  let tool = 'polygon';
  let drawing = false;       // freehand: pointer is down
  let circleCentre = null;   // circle: first tap
  let circlePreview = null;

  function initShoreMap() {
    const host = document.getElementById('shore-map');
    if (!host || shoreMap) return;

    shoreMap = L.map(host, {
      zoomControl: true,
      attributionControl: true
    }).setView(CONFIG.MAP_CENTER, 13);

    L.tileLayer(CONFIG.TILE_URL, {
      maxZoom: 19,
      attribution: CONFIG.TILE_ATTRIBUTION
    }).addTo(shoreMap);

    drawLayer = L.layerGroup().addTo(shoreMap);
    draftLayer = L.layerGroup().addTo(shoreMap);

    shoreMap.on('click', e => onMapClick(e.latlng.lat, e.latlng.lng));

    // Freehand needs press / move / release rather than clicks.
    const el = shoreMap.getContainer();
    el.addEventListener('pointerdown', e => {
      if (tool !== 'freehand') return;
      drawing = true;
      draft = [];
      const p = shoreMap.mouseEventToLatLng(e);
      draft.push([p.lat, p.lng]);
    });
    el.addEventListener('pointermove', e => {
      if (tool !== 'freehand' || !drawing) return;
      const p = shoreMap.mouseEventToLatLng(e);
      const last = draft[draft.length - 1];
      // keep the trace light: only add a point once it has moved
      if (!last || Shore.haversine(last[0], last[1], p.lat, p.lng) > 8) {
        draft.push([p.lat, p.lng]);
        redrawDraft();
      }
    });
    el.addEventListener('pointerup', () => {
      if (tool !== 'freehand' || !drawing) return;
      drawing = false;
      updateDrawUi();
    });

    renderShoreShapes();
    setTimeout(() => shoreMap.invalidateSize(), 200);
  }

  function onMapClick(lat, lon) {
    if (tool === 'circle') {
      if (!circleCentre) {
        circleCentre = { lat, lon };
        updateDrawUi();
        redrawDraft();
        return;
      }

      // second tap sets the radius
      const radius = Shore.haversine(circleCentre.lat, circleCentre.lon, lat, lon);
      if (radius < 10) {
        UIModule.showToast('That circle is too small', 'warning');
        return;
      }

      finishShape({
        kind: 'circle',
        name: 'Circle',
        lat: circleCentre.lat,
        lon: circleCentre.lon,
        radius
      });

      circleCentre = null;
      redrawDraft();
      updateDrawUi();
      return;
    }

    draft.push([lat, lon]);
    redrawDraft();
    updateDrawUi();
  }

  function redrawDraft() {
    if (!drawLayer) return;
    drawLayer.clearLayers();

    if (circleCentre) {
      L.circleMarker([circleCentre.lat, circleCentre.lon], {
        radius: 5, color: '#fff', weight: 2,
        fillColor: '#1FA6D8', fillOpacity: 1
      }).addTo(drawLayer);
    }

    if (tool === 'circle') return;

    if (draft.length === 1) {
      L.circleMarker(draft[0], {
        radius: 5, color: '#fff', weight: 2,
        fillColor: '#1FA6D8', fillOpacity: 1
      }).addTo(drawLayer);
      return;
    }

    if (draft.length >= 2) {
      L.polyline(draft, {
        color: '#1FA6D8',
        weight: 3,
        opacity: 0.95,
        lineCap: 'round'
      }).addTo(drawLayer);
    }

    if (draft.length >= 3) {
      L.polygon(draft, {
        color: 'transparent',
        fillColor: '#1FA6D8',
        fillOpacity: 0.12,
        interactive: false
      }).addTo(drawLayer);
    }
  }

  function renderShoreShapes() {
    if (!draftLayer) return;
    draftLayer.clearLayers();

    const limit = CONFIG.DEVICES.minShoreMetres;

    Shore.all().forEach(shape => {
      const pts = shape.kind === 'circle'
        ? circlePoints(shape.lat, shape.lon, shape.radius)
        : shape.coords;

      L.polygon(pts, {
        color: '#7D8C99',
        weight: 1.5,
        opacity: 0.6,
        dashArray: '4 6',
        fillColor: '#2FA36B',
        fillOpacity: 0.06,
        interactive: false
      }).addTo(draftLayer);

      // the offset, so the consequence is visible while editing
      const zone = Shore.permittedOf(shape, limit);
      if (!zone) {
        L.polyline(pts, { color: '#E5484D', weight: 2, opacity: 0.5, interactive: false })
          .bindTooltip('Too narrow for a ' + limit + ' m limit', { sticky: true })
          .addTo(draftLayer);
        return;
      }

      const zpts = zone.kind === 'circle'
        ? circlePoints(zone.lat, zone.lon, zone.radius)
        : zone.coords;

      L.polygon(zpts, {
        color: '#E5484D',
        weight: 2.5,
        opacity: 0.95,
        fillColor: '#2FA36B',
        fillOpacity: 0.1,
        interactive: false
      }).addTo(draftLayer);
    });
  }

  function circlePoints(lat, lon, radius) {
    const out = [];
    const R = 6371000;
    const dLat = (radius / R) * 180 / Math.PI;

    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      out.push([
        lat + dLat * Math.cos(a),
        lon + (radius / (R * Math.cos(lat * Math.PI / 180))) * Math.sin(a) * 180 / Math.PI
      ]);
    }
    return out;
  }

  function updateDrawUi() {
    const hint = document.getElementById('draw-hint');
    const finish = document.getElementById('btn-draw-finish');
    const undo = document.getElementById('btn-draw-undo');
    const clear = document.getElementById('btn-draw-clear');
    if (!hint) return;

    const limit = CONFIG.DEVICES.minShoreMetres;

    if (tool === 'circle') {
      hint.dataset.state = 'idle';
      hint.textContent = circleCentre
        ? 'Now tap the edge to set the radius'
        : 'Tap the centre of the circle';
      if (finish) finish.disabled = true;
      if (undo) undo.disabled = !circleCentre;
      if (clear) clear.disabled = !circleCentre;
      return;
    }

    if (tool === 'freehand') {
      hint.dataset.state = draft.length >= 3 ? 'ok' : 'idle';
      hint.textContent = draft.length >= 3
        ? `${draft.length} points traced — press Finish shape`
        : 'Press and drag to trace the bank';
      if (finish) finish.disabled = draft.length < 3;
      if (undo) undo.disabled = draft.length === 0;
      if (clear) clear.disabled = draft.length === 0;
      return;
    }

    hint.dataset.state = draft.length >= 3 ? 'ok' : 'idle';
    hint.textContent = draft.length === 0
      ? 'Tap points around the water, then press Finish shape'
      : draft.length < 3
        ? `${draft.length} point${draft.length === 1 ? '' : 's'} — at least 3 needed`
        : `${draft.length} points — press Finish shape`;
    if (finish) finish.disabled = draft.length < 3;
    if (undo) undo.disabled = draft.length === 0;
    if (clear) clear.disabled = draft.length === 0 && !circleCentre;
  }

  async function finishShape(shape) {
    const limit = CONFIG.DEVICES.minShoreMetres;

    const zone = Shore.permittedOf(shape, limit);
    if (!zone) {
      UIModule.showToast(
        `That shape is narrower than ${limit} m across — there is no legal water inside it`,
        'error'
      );
      return;
    }

    const name = await UIModule.prompt(
      'Name this stretch of water',
      shape.name || 'Water',
      { title: 'Name the shape', confirmLabel: 'Save' }
    );

    if (name === null) return;

    const result = Shore.add(Object.assign({}, shape, { name: name || shape.name }));
    if (!result.ok) {
      UIModule.showToast(result.message, 'error');
      return;
    }

    UIModule.showToast('Shore added', 'success');
    renderShoreList();
    renderShoreShapes();
    refreshMapZones();
  }

  function commitDraft() {
    if (tool === 'circle') return;

    if (draft.length < 3) {
      UIModule.showToast('A shape needs at least 3 points', 'warning');
      return;
    }

    finishShape({
      kind: tool,
      name: tool === 'freehand' ? 'Freehand water' : 'Polygon water',
      coords: draft.slice()
    });

    draft = [];
    redrawDraft();
    updateDrawUi();
  }

  function renderShoreList() {
    const host = document.getElementById('shore-list');
    const empty = document.getElementById('shore-empty');
    const count = document.getElementById('shore-count');
    if (!host) return;

    const list = Shore.all();
    const limit = CONFIG.DEVICES.minShoreMetres;

    if (count) {
      count.textContent = list.length + (list.length === 1 ? ' shape' : ' shapes');
    }

    if (!list.length) {
      host.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

    host.innerHTML = list.map(shape => {
      const zone = Shore.permittedOf(shape, limit);
      const area = shape.kind === 'circle'
        ? Math.PI * shape.radius * shape.radius
        : Math.abs(Shore.area(shape.coords)) * 111320 * 111320 *
          Math.cos(shape.coords[0][0] * Math.PI / 180);

      const kindLabel = Shore.KINDS[shape.kind] || shape.kind;

      return `
        <article class="shore-item" data-shore="${UIModule.escapeHtml(shape.id)}">
          <div class="shore-item__head">
            <span class="shore-item__name">${UIModule.escapeHtml(shape.name)}</span>
            <span class="shore-item__kind">${UIModule.escapeHtml(kindLabel)}</span>
          </div>

          <div class="shore-item__meta">
            <span>${Math.round(area / 10000)} ha</span>
            <span>${zone ? 'limit drawn' : 'too narrow'}</span>
          </div>

          <div class="shore-item__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-shore-zoom="${UIModule.escapeHtml(shape.id)}">
              Show
            </button>
            <button type="button" class="btn btn--danger btn--sm" data-shore-delete="${UIModule.escapeHtml(shape.id)}">
              Delete
            </button>
          </div>
        </article>`;
    }).join('');

    host.querySelectorAll('[data-shore-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteShore(btn.dataset.shoreDelete));
    });

    host.querySelectorAll('[data-shore-zoom]').forEach(btn => {
      btn.addEventListener('click', () => zoomToShape(btn.dataset.shoreZoom));
    });
  }

  async function deleteShore(id) {
    const shape = Shore.get(id);
    if (!shape) return;

    const ok = await UIModule.confirm(
      `Delete “${shape.name}”? The 50 m limit for it goes with it.`,
      { title: 'Delete shape', confirmLabel: 'Delete', danger: true }
    );
    if (!ok) return;

    Shore.remove(id);
    UIModule.showToast('Shape deleted', 'success');
    renderShoreList();
    renderShoreShapes();
    refreshMapZones();
  }

  function zoomToShape(id) {
    const shape = Shore.get(id);
    if (!shape || !shoreMap) return;

    if (shape.kind === 'circle') {
      shoreMap.fitBounds(
        L.circle([shape.lat, shape.lon], { radius: shape.radius }).getBounds(),
        { padding: [30, 30] }
      );
      return;
    }

    shoreMap.fitBounds(L.latLngBounds(shape.coords), { padding: [30, 30] });
  }

  // The user and patrol maps draw the same shapes, so they need a nudge after
  // an edit. Admin has its own map; the others pick it up on next load.
  function refreshMapZones() {
    if (typeof MapModule === 'undefined' || !MapModule.getMap) return;
    try { MapModule.toggleZones(true); } catch (err) { /* admin has no zone layer */ }
  }

  function bindShore() {
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');

        tool = btn.dataset.tool;
        draft = [];
        circleCentre = null;
        drawing = false;

        redrawDraft();
        updateDrawUi();
      });
    });

    document.getElementById('btn-draw-finish')?.addEventListener('click', commitDraft);
    document.getElementById('btn-draw-undo')?.addEventListener('click', () => {
      if (tool === 'circle') {
        circleCentre = null;
      } else {
        draft.pop();
      }
      redrawDraft();
      updateDrawUi();
    });

    document.getElementById('btn-draw-clear')?.addEventListener('click', () => {
      draft = [];
      circleCentre = null;
      redrawDraft();
      updateDrawUi();
    });

    const limitEl = document.getElementById('shore-limit');
    if (limitEl) limitEl.textContent = CONFIG.DEVICES.minShoreMetres;

    updateDrawUi();
    renderShoreList();
  }

  // ------------------------------------------------------------- devices

  function renderDevices() {
    const list = Devices.all();
    const summary = Devices.summary();

    setText('d-total', summary.total);
    setText('d-ok', summary.ok);
    setText('d-warn', summary.warn);
    setText('d-danger', summary.danger);
    setText('devices-count', list.length + (list.length === 1 ? ' buoy' : ' buoys'));

    renderAlerts();
    renderFleet(list);
  }

  function renderAlerts() {
    const host = document.getElementById('devices-alerts');
    if (!host) return;

    const alerts = Devices.alerts();

    if (!alerts.length) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = alerts.map(a => `
      <article class="alert" data-level="${a.level}">
        <span class="alert__dot"></span>
        <div class="alert__body">
          <span class="alert__title">${UIModule.escapeHtml(a.title)}</span>
          <span class="alert__detail">${UIModule.escapeHtml(a.label)} · ${UIModule.escapeHtml(a.detail)}</span>
        </div>
      </article>`).join('');
  }

  function renderFleet(list) {
    const host = document.getElementById('devices-list');
    const empty = document.getElementById('devices-empty');
    if (!host) return;

    if (!list.length) {
      host.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

    host.innerHTML = list.map(d => {
      const level = Devices.worstLevel(d);
      const age = timeAgo(d.lastSeen);
      const temp = Number.isFinite(d.temperature_c) ? d.temperature_c + ' °C' : '—';
      const levelCm = Number.isFinite(d.water_level_cm) ? d.water_level_cm + ' cm' : '—';

      return `
        <article class="device" data-level="${level}">
          <div class="device__head">
            <span class="device__id">${UIModule.escapeHtml(d.id)}</span>
            <span class="device__age">${UIModule.escapeHtml(age)}</span>
          </div>

          <div class="device__label">${UIModule.escapeHtml(d.label)}</div>

          <div class="device__grid">
            <div class="device__stat">
              <span class="device__stat-value">${Math.round(d.battery)}%</span>
              <span class="device__stat-label">battery</span>
            </div>
            <div class="device__stat">
              <span class="device__stat-value">${UIModule.escapeHtml(temp)}</span>
              <span class="device__stat-label">water</span>
            </div>
            <div class="device__stat">
              <span class="device__stat-value">${UIModule.escapeHtml(levelCm)}</span>
              <span class="device__stat-label">level</span>
            </div>
            <div class="device__stat">
              <span class="device__stat-value">${d.light_on ? 'on' : 'off'}</span>
              <span class="device__stat-label">light</span>
            </div>
          </div>

          <div class="device__foot">
            <span class="device__nfc">${UIModule.escapeHtml(d.nfc)}</span>
            <button type="button" class="btn btn--danger btn--sm"
                    data-device-delete="${UIModule.escapeHtml(d.id)}">Remove</button>
          </div>
        </article>`;
    }).join('');

    host.querySelectorAll('[data-device-delete]').forEach(btn => {
      btn.addEventListener('click', () => removeDevice(btn.dataset.deviceDelete));
    });
  }

  async function removeDevice(id) {
    const ok = await UIModule.confirm(
      `Remove buoy ${id} from the fleet? Its history is lost.`,
      { title: 'Remove buoy', confirmLabel: 'Remove', danger: true }
    );
    if (!ok) return;

    if (Devices.remove(id)) {
      UIModule.showToast('Buoy removed', 'success');
      renderDevices();
    } else {
      UIModule.showToast('Buoy not found', 'error');
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';

    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';

    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + ' h ago';

    return Math.round(hours / 24) + ' d ago';
  }

  function bindDevices() {
    renderDevices();
    // Telemetry ages while the panel is open, so refresh the "x min ago" text.
    setInterval(() => {
      if (document.querySelector('[data-pane="devices"]')?.classList.contains('is-active')) {
        renderDevices();
      }
    }, 60000);
  }

  // ---------------------------------------------------------------- users

  function renderUsers() {
    const host = document.getElementById('users-list');
    const empty = document.getElementById('users-empty');
    const count = document.getElementById('user-count');
    if (!host) return;

    const users = Auth.listUsers();
    const me = Auth.current();

    if (count) count.textContent = users.length + (users.length === 1 ? ' account' : ' accounts');

    if (!users.length) {
      host.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

    host.innerHTML = users.map(u => {
      const isMe = me && me.username === u.username;
      const role = Auth.roleInfo(u.role);

      const options = Auth.allRoles().map(r =>
        `<option value="${r.id}"${r.id === u.role ? ' selected' : ''}>${UIModule.escapeHtml(r.label)}</option>`
      ).join('');

      return `
        <article class="user${isMe ? ' user--me' : ''}" data-user="${UIModule.escapeHtml(u.username)}">
          <div class="user__avatar" data-role="${u.role}">
            ${UIModule.escapeHtml((u.displayName || u.username).slice(0, 1).toUpperCase())}
          </div>

          <div class="user__body">
            <div class="user__name">
              ${UIModule.escapeHtml(u.displayName || u.username)}
              ${isMe ? '<span class="user__you">you</span>' : ''}
            </div>
            <div class="user__meta">
              <span class="status-badge status-badge--${u.role === 'admin' ? 'reported' : u.role === 'patrol' ? 'checked' : 'new'}">
                ${UIModule.escapeHtml(role ? role.label : u.role)}
              </span>
              <span class="user__since">joined ${UIModule.escapeHtml(shortDate(u.createdAt))}</span>
            </div>
          </div>

          <div class="user__actions">
            <label class="select-wrapper">
              <span class="visually-hidden">Role for ${UIModule.escapeHtml(u.username)}</span>
              <select class="input form-select--sm" data-role-select="${UIModule.escapeHtml(u.username)}">
                ${options}
              </select>
            </label>
            <button type="button" class="btn btn--danger btn--sm"
                    data-user-delete="${UIModule.escapeHtml(u.username)}"
                    ${isMe ? 'disabled title="You cannot delete your own account"' : ''}>
              Delete
            </button>
          </div>
        </article>`;
    }).join('');

    host.querySelectorAll('[data-role-select]').forEach(sel => {
      sel.addEventListener('change', () => {
        const result = Auth.setRole(sel.dataset.roleSelect, sel.value);

        if (!result.ok) {
          UIModule.showToast(result.message, 'error');
          renderUsers();
          return;
        }

        UIModule.showToast(
          `${sel.dataset.roleSelect} is now ${Auth.roleLabel(sel.value)}`,
          'success'
        );
        renderUsers();
      });
    });

    host.querySelectorAll('[data-user-delete]').forEach(btn => {
      btn.addEventListener('click', () => removeUser(btn.dataset.userDelete));
    });
  }

  async function removeUser(username) {
    const ok = await UIModule.confirm(
      `Delete the account “${username}”? They will be signed out and cannot sign back in.`,
      { title: 'Delete account', confirmLabel: 'Delete', danger: true }
    );
    if (!ok) return;

    const result = Auth.deleteUser(username);

    if (!result.ok) {
      UIModule.showToast(result.message, 'error');
      return;
    }

    UIModule.showToast('Account deleted', 'success');
    renderUsers();
  }

  function shortDate(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function bindUsers() {
    renderUsers();
  }

  // -------------------------------------------------------------- security

  function bindSecurity() {
    document.getElementById('btn-change-pw')?.addEventListener('click', async () => {
      const session = Auth.current();
      if (!session) return;

      const current = document.getElementById('pw-old').value;
      const next = document.getElementById('pw-new').value;
      const again = document.getElementById('pw-new2').value;
      const status = document.getElementById('pw-status');

      const say = (msg, tone) => {
        status.textContent = msg;
        status.dataset.tone = tone;
      };

      const result = await Auth.changePassword(session.username, current, next, again);

      if (!result.ok) return say(result.message, 'error');

      document.getElementById('pw-old').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-new2').value = '';
      say('Password updated', 'ok');
      UIModule.showToast('Password updated', 'success');
    });
  }

  // ------------------------------------------------------------------ init

  function init() {
    const session = Auth.require(['admin']);
    if (!session) return;
    boot(session);
  }

  return { init, reload: boot };
})();

document.addEventListener('DOMContentLoaded', () => Admin.init());
window.Admin = Admin;






