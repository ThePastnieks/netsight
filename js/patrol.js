// NetSight Water Patrol
//
// The patrol sees every case on a map and in a list, opens one, and moves it
// along: new → reported → checked → resolved | false alarm.
// They cannot delete points or touch the model — that is the admin's job.

const Patrol = (function() {
  'use strict';

  let cases = [];
  let tableFilter = 'all';
  let tableSort = 'priority';
  let mapFilter = 'all';

  // ------------------------------------------------------------------ init

  async function init() {
    const session = Auth.require(['patrol', 'admin']);
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

    await RegistryModule.loadRegistry();

    const map = MapModule.initMap('patrol-map', CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
    if (!map) UIModule.showToast('Map failed to load', 'error');

    // Patrol needs the fleet on the map: an alerting buoy is the case.
    MapModule.renderDevices(Devices.all());
    MapModule.toggleDeviceLayer(true);
    MapModule.toggleZones(true);

    await loadCases();
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
    set('p-resolved', cases.filter(c => c.status === 'resolved').length);

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

    tbody.innerHTML = list.map(c => {
      const confidence = Math.round((c.confidence || 0) * 100);
      const registry = c.registry_match
        ? `<span class="registry-yes">${UIModule.escapeHtml(c.registry_id || 'registered')}</span>`
        : '<span class="registry-no">unverified</span>';

      return `
        <tr data-id="${UIModule.escapeHtml(c.id)}">
          <td class="cell-id"><code>${UIModule.escapeHtml(String(c.id).slice(0, 8))}</code></td>
          <td class="cell-type">${UIModule.escapeHtml(c.user_class || '?')}</td>
          <td><span class="status-badge status-badge--${c.status}">${UIModule.escapeHtml(StatusModule.getStatusLabel(c.status))}</span></td>
          <td>${registry}</td>
          <td class="cell-confidence">${confidence}%</td>
          <td class="cell-time">${UIModule.escapeHtml(relativeTime(c.created_at))}</td>
          <td class="cell-actions">
            <button type="button" class="btn btn--ghost btn--sm" data-act="view" data-id="${UIModule.escapeHtml(c.id)}">View</button>
            <button type="button" class="btn btn--primary btn--sm" data-act="status" data-id="${UIModule.escapeHtml(c.id)}">Status</button>
          </td>
        </tr>`;
    }).join('');

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


