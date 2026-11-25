// NetSight Water Patrol
//
// The patrol sees every case on a map and in a list, opens one, and moves it
// along: new → reported → checked → resolved | false alarm.
//
// They cannot delete points — that is the admin's job. What they can do that
// nobody else can is decide whether the net in front of them is legal, which is
// why the Nets tab exists: read the code off the buoy and the app says whose it
// is and whether it is still valid.

const Patrol = (function() {
  'use strict';

  let cases = [];
  let gear = [];
  let tableFilter = 'all';
  let tableSort = 'priority';
  let mapFilter = 'all';

  // ------------------------------------------------------------------ init

  async function init() {
    const session = await Auth.require(['patrol', 'admin']);
    if (!session) return;

    Theme.init();
    Auth.mount(session);

    // UIModule.showDetailView asks window.App what this user may do.
    window.App = {
      isInspector: () => true,
      showStatusChange: changeStatus,
      showReport: null
    };

    bindTabs();
    bindMapFilters();
    bindTableControls();
    bindGearLookup();

    await RegistryModule.loadRegistry();
    await Shore.load();
    await Devices.load();
    await GearModule.load();

    const map = MapModule.initMap('patrol-map', CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    if (!map) UIModule.showToast('Map failed to load', 'error');

    // Patrol needs the fleet on the map: an alerting buoy is the case.
    MapModule.renderDevices(Devices.all());
    MapModule.toggleDeviceLayer(true);
    MapModule.toggleZones(true);

    await loadCases();
    renderGearList();
    console.log('Water Patrol ready');
  }

  async function loadCases() {
    try {
      cases = await StoreModule.getSightingsUnified(1000);
    } catch (err) {
      console.error('Could not load cases:', err);
      UIModule.showToast('Could not load cases', 'error');
      cases = [];
    }

    MapModule.renderSightings(cases);
    MapModule.setFilter(mapFilter);
    renderTable();
    renderStats();
  }

  // ------------------------------------------------------------------ tabs

  function bindTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');

        document.querySelectorAll('[data-pane]').forEach(pane => {
          pane.classList.toggle('is-active', pane.dataset.pane === btn.dataset.tab);
        });

        document.querySelector('.screen__body').scrollTop = 0;

        // Leaflet needs a nudge after its container becomes visible again
        if (btn.dataset.tab === 'map') {
          setTimeout(() => {
            const map = MapModule.getMap();
            if (map) map.invalidateSize();
          }, 120);
        }

        if (btn.dataset.tab === 'gear') renderGearList();
      });
    });
  }

  function bindMapFilters() {
    document.querySelectorAll('[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        mapFilter = chip.dataset.filter;
        MapModule.setFilter(mapFilter);
      });
    });
  }

  function bindTableControls() {
    document.querySelectorAll('[data-case-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-case-filter]').forEach(c => {
          c.classList.remove('filter-chip--active', 'is-active');
        });
        chip.classList.add('filter-chip--active', 'is-active');
        tableFilter = chip.dataset.caseFilter;
        renderTable();
      });
    });

    document.getElementById('patrol-sort')?.addEventListener('change', e => {
      tableSort = e.target.value;
      renderTable();
    });
  }

  // ----------------------------------------------------------------- stats

  function renderStats() {
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n);
    };

    set('p-total', cases.length);
    set('p-reported', cases.filter(c => c.status === 'reported').length);
    set('p-new', cases.filter(c => c.status === 'new').length);
    set('p-registered', cases.filter(c => c.registry_match).length);

    const sub = document.getElementById('patrol-sub');
    if (sub) sub.textContent = cases.length + ' case' + (cases.length === 1 ? '' : 's');
  }

  // ----------------------------------------------------------------- table

  function visibleCases() {
    const list = cases.filter(c => tableFilter === 'all' || c.status === tableFilter);

    list.sort((a, b) => {
      if (tableSort === 'created_asc') return time(a) - time(b);
      if (tableSort === 'created_desc') return time(b) - time(a);
      return StatusModule.getStatusPriority(b.status) - StatusModule.getStatusPriority(a.status);
    });

    return list;
  }

  function time(c) {
    return new Date(c.created_at).getTime() || 0;
  }

  // How the report relates to registered gear. This is the column a patrol
  // reads first: "legal net, leave it" versus "nobody's, pull it".
  function ownershipCell(c) {
    if (!c.registry_match) {
      return '<span class="owner owner--unknown">Unregistered</span>';
    }

    const registered = GearModule.findByCode(c.registry_id);

    if (registered) {
      return '<span class="owner owner--known">' + UIModule.escapeHtml(registered.ownerName) +
        '<span class="owner__code">' + UIModule.escapeHtml(registered.code) + '</span></span>';
    }

    // Matched against the CSV rather than a registered net.
    return '<span class="owner owner--known">' +
      UIModule.escapeHtml(c.registry_id || 'Registered') + '</span>';
  }

  function lengthCell(c) {
    if (!Array.isArray(c.span) || c.span.length !== 2) {
      return '<span class="cell-muted">—</span>';
    }
    const m = Shore.spanLength(c.span[0], c.span[1]);
    return Math.round(m) + ' m';
  }

  function renderTable() {
    const tbody = document.getElementById('patrol-tbody');
    const empty = document.getElementById('patrol-empty');
    if (!tbody) return;

    const list = visibleCases();

    if (!list.length) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

    tbody.innerHTML = list.map(c => `
      <tr data-id="${UIModule.escapeHtml(c.id)}">
        <td class="cell-type">
          <span class="gear-type">${UIModule.escapeHtml(c.user_class || '?')}</span>
        </td>
        <td>
          <span class="status-badge status-badge--${c.status}">
            ${UIModule.escapeHtml(StatusModule.getStatusLabel(c.status))}
          </span>
        </td>
        <td>${ownershipCell(c)}</td>
        <td class="cell-length">${lengthCell(c)}</td>
        <td class="cell-time">${UIModule.escapeHtml(relativeTime(c.created_at))}</td>
        <td class="cell-actions">
          <button type="button" class="btn btn--ghost btn--sm" data-act="view" data-id="${UIModule.escapeHtml(c.id)}">View</button>
          <button type="button" class="btn btn--primary btn--sm" data-act="status" data-id="${UIModule.escapeHtml(c.id)}">Status</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const point = cases.find(c => c.id === btn.dataset.id);
        if (!point) return;
        if (btn.dataset.act === 'view') UIModule.showDetailView(point);
        if (btn.dataset.act === 'status') changeStatus(point);
      });
    });

    tbody.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.cell-actions')) return;
        const point = cases.find(c => c.id === row.dataset.id);
        if (point) UIModule.showDetailView(point);
      });
    });
  }

  function relativeTime(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';

    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';

    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';

    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';

    return new Date(iso).toLocaleDateString();
  }

  // ------------------------------------------------------------------ gear

  function bindGearLookup() {
    const input = document.getElementById('gear-lookup');
    const button = document.getElementById('btn-gear-lookup');
    if (!input || !button) return;

    const run = () => lookUpGear(input.value);
    button.addEventListener('click', run);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });
  }

  function lookUpGear(rawCode) {
    const host = document.getElementById('gear-result');
    if (!host) return;

    const code = String(rawCode || '').trim();
    if (!code) {
      host.hidden = true;
      return;
    }

    const found = GearModule.findByCode(code);
    host.hidden = false;

    if (!found) {
      host.dataset.state = 'unknown';
      host.innerHTML = [
        '<span class="gear-result__headline">Not registered</span>',
        '<span class="gear-result__sub">No net with the code ' + UIModule.escapeHtml(code) + '.',
        ' Treat it as unregistered gear.</span>'
      ].join('');
      return;
    }

    const expired = GearModule.isExpired(found);
    const metres = Array.isArray(found.span)
      ? Math.round(Shore.spanLength(found.span[0], found.span[1]))
      : null;

    host.dataset.state = expired ? 'expired' : 'ok';
    host.innerHTML = [
      '<span class="gear-result__headline">',
      UIModule.escapeHtml(found.ownerName),
      expired ? ' · expired' : ' · valid',
      '</span>',
      '<span class="gear-result__sub">',
      UIModule.escapeHtml(found.label),
      metres ? ' · ' + metres + ' m' : '',
      found.validUntil ? ' · until ' + new Date(found.validUntil).toLocaleDateString() : '',
      '</span>'
    ].join('');

    // Put it on the map: seeing the line is faster than reading coordinates.
    if (Array.isArray(found.span) && found.span.length === 2) {
      MapModule.focusOn(found.span[0][0], found.span[0][1], 15);
    } else if (Number.isFinite(found.lat) && Number.isFinite(found.lon)) {
      MapModule.focusOn(found.lat, found.lon, 16);
    }
  }

  function renderGearList() {
    const host = document.getElementById('gear-table');
    const none = document.getElementById('gear-none');
    const total = document.getElementById('gear-total');
    if (!host) return;

    gear = GearModule.activeOnly();

    if (total) total.textContent = String(gear.length);

    if (!gear.length) {
      host.innerHTML = '';
      if (none) none.hidden = false;
      return;
    }

    if (none) none.hidden = true;

    host.innerHTML = gear.map(item => {
      const metres = Array.isArray(item.span)
        ? Math.round(Shore.spanLength(item.span[0], item.span[1]))
        : null;

      return [
        '<article class="gear-item" data-gear="' + UIModule.escapeHtml(item.id) + '">',
        '  <div class="gear-item__code">',
        '    <span class="gear-item__code-label">Code</span>',
        '    <span class="gear-item__code-value">' + UIModule.escapeHtml(item.code) + '</span>',
        '  </div>',
        '  <div class="gear-item__body">',
        '    <span class="gear-item__label">' + UIModule.escapeHtml(item.ownerName) + '</span>',
        '    <span class="gear-item__meta">',
        UIModule.escapeHtml(item.label),
        metres ? ' · ' + metres + ' m' : '',
        '    </span>',
        '  </div>',
        '  <button type="button" class="btn btn--ghost btn--sm" data-locate="' +
          UIModule.escapeHtml(item.id) + '">Show</button>',
        '</article>'
      ].join('');
    }).join('');

    host.querySelectorAll('[data-locate]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = GearModule.get(btn.dataset.locate);
        if (!item) return;

        // Jump to the map tab, then to the net.
        document.querySelector('[data-tab="map"]')?.click();

        setTimeout(() => {
          if (Array.isArray(item.span) && item.span.length === 2) {
            MapModule.focusOn(item.span[0][0], item.span[0][1], 15);
          } else if (Number.isFinite(item.lat)) {
            MapModule.focusOn(item.lat, item.lon, 16);
          }
        }, 180);
      });
    });
  }

  // ---------------------------------------------------------------- status

  function changeStatus(point) {
    UIModule.showStatusModal(point, async (newStatus, comment) => {
      UIModule.showLoading('Updating…');
      try {
        await StoreModule.updateSightingStatusUnified(point.id, newStatus, comment, 'patrol');
        UIModule.showToast('Status → ' + StatusModule.getStatusLabel(newStatus), 'success');
        await loadCases();
      } catch (err) {
        console.error('Status update failed:', err);
        UIModule.showToast('Could not update: ' + err.message, 'error');
      } finally {
        UIModule.hideLoading();
      }
    });
  }

  return { init, reload: loadCases };
})();

document.addEventListener('DOMContentLoaded', () => Patrol.init());
window.Patrol = Patrol;
