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
    bindUsers();
    bindSecurity();

    await loadPoints();
    renderProviders();
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



