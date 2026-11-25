// NetSight UI Module
// Forms, modals, toasts, screen navigation

const UIModule = (function() {
  'use strict';

  let currentScreen = 'map';
  let pendingSighting = null;
  let selectedPhotoFile = null;
  let selectedPhotoUrl = null;
  
  // Toast container
  function ensureToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  // Show toast notification
  function showToast(message, type = 'info', duration = 4000) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <span>${escapeHtml(message)}</span>
      <button type="button" class="toast__close" aria-label="Dismiss">&times;</button>
    `;

    toast.querySelector('.toast__close').addEventListener('click', () => {
      toast.remove();
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.animation = 'toast-in 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);

    return toast;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Loading overlay
  function showLoading(message = 'Loading...') {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = `
        <div class="loading-overlay__content">
          <div class="loading-overlay__spinner spinner"></div>
          <p id="loading-message">${escapeHtml(message)}</p>
        </div>
      `;
      document.body.appendChild(overlay);
    } else {
      overlay.querySelector('#loading-message').textContent = message;
    }
    overlay.hidden = false;
    // Force a reflow so the transition runs from the hidden state
    void overlay.offsetHeight;
    overlay.classList.add('loading-overlay--visible');
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.remove('loading-overlay--visible');
      overlay.hidden = true;
    }
  }

  // Modal
  function showModal(title, content, actions = []) {
    let overlay = document.getElementById('modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-overlay';
      overlay.className = 'modal-overlay';
      document.body.appendChild(overlay);
    }

    const actionsHtml = actions.map(a =>
      `<button type="button" class="btn ${a.class || 'btn--primary'}" data-action="${escapeHtml(a.action)}">${escapeHtml(a.label)}</button>`
    ).join('');

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header">
          <h2 id="modal-title" class="modal__title">${escapeHtml(title)}</h2>
          <button type="button" class="modal__close" aria-label="Close">&times;</button>
        </div>
        <div class="modal__body">${content}</div>
        ${actions.length ? `<div class="modal__footer">${actionsHtml}</div>` : ''}
      </div>
    `;

    const closeModal = () => {
      overlay.classList.remove('modal-overlay--visible');
      overlay.hidden = true;
    };

    overlay.querySelector('.modal__close').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const handler = actions.find(a => a.action === action);
        if (handler && handler.handler) handler.handler();
        closeModal();
      });
    });

    overlay.hidden = false;
    // Force a reflow so the transition runs from the hidden state
    void overlay.offsetHeight;
    overlay.classList.add('modal-overlay--visible');

    return overlay;
  }

  function hideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.classList.remove('modal-overlay--visible');
      overlay.hidden = true;
    }
  }

  // Screen navigation
  function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('screen--active'));
    const screen = document.getElementById(`screen-${screenName}`);
    if (screen) {
      screen.classList.add('screen--active');
      currentScreen = screenName;
    }

    // Update bottom navigation
    document.querySelectorAll('.tab, .nav-item').forEach(item => {
      item.classList.toggle('is-active', item.dataset.screen === screenName);
      item.classList.toggle('nav-item--active', item.dataset.screen === screenName);
    });

    // Hide FAB outside the map screen
    const fab = document.querySelector('.fab');
    if (fab) {
      fab.style.display = screenName === 'map' ? 'flex' : 'none';
    }

    const body = document.querySelector('.screen--active .screen__body');
    if (body) body.scrollTop = 0;
  }

  function getCurrentScreen() {
    return currentScreen;
  }

  // Photo preview handling
  function setupPhotoPreview(inputId, previewId, onChange) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;

    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.match(/^image\/(jpeg|png)$/i)) {
        showToast('Please select a JPEG or PNG image', 'error');
        input.value = '';
        return;
      }

      if (file.size > CONFIG.MAX_PHOTO_MB * 1024 * 1024) {
        showToast(`Image too large. Max ${CONFIG.MAX_PHOTO_MB} MB`, 'error');
        input.value = '';
        return;
      }

      selectedPhotoFile = file;
      selectedPhotoUrl = URL.createObjectURL(file);

      preview.innerHTML = `<img src="${selectedPhotoUrl}" alt="Preview">`;
      preview.classList.remove('photo-preview--empty', 'photo--empty');
      preview.classList.add('has-image');

      // Update photo badge
      const badge = document.getElementById('photo-badge');
      if (badge) {
        badge.hidden = false;
      }

      if (onChange) onChange(file);
    });
  }

  function clearPhotoPreview(previewId, inputId) {
    const preview = document.getElementById(previewId);
    const input = document.getElementById(inputId);
    if (preview) {
      preview.innerHTML = `
        <div class="photo__empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="3" y="3" width="18" height="18" rx="3"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <path d="M21 15l-5-5-9 9"></path>
          </svg>
          <span>Tap to take or upload a photo</span>
        </div>
      `;
      preview.classList.remove('has-image');
      preview.classList.add('photo--empty');
      preview.querySelectorAll('.bbox').forEach(el => el.remove());
    }
    if (input) input.value = '';
    // Only revoke if it's an object URL (not a data URL)
    if (selectedPhotoUrl && selectedPhotoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(selectedPhotoUrl);
    }
    selectedPhotoUrl = null;
    selectedPhotoFile = null;

    // Update photo badge
    const badge = document.getElementById('photo-badge');
    if (badge) {
      badge.hidden = true;
    }
  }

  function getSelectedPhotoFile() {
    return selectedPhotoFile;
  }

  // Type chips. The user picks; nothing preselects for them.
  function setupTypeChips(containerId, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = CONFIG.GEAR_CLASSES.map(cls => `
      <button type="button" class="chip type-chip chip--${cls}" data-class="${cls}">
        ${cls.charAt(0).toUpperCase() + cls.slice(1)}
      </button>
    `).join('');

    container.querySelectorAll('.type-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        container.querySelectorAll('.type-chip').forEach(c => c.classList.remove('chip--active'));
        chip.classList.add('chip--active');
        if (onChange) onChange(chip.dataset.class);
      });
    });
  }

  function getSelectedTypeChip(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const active = container.querySelector('.type-chip.chip--active');
    return active ? active.dataset.class : null;
  }

  // Location display — matches the .location classes used in the markup
  function updateLocationDisplay(lat, lon, accuracy) {
    const container = document.getElementById('location-display');
    if (!container) return;

    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
    const accText = accuracy ? `±${Math.round(accuracy)} m` : 'manual';
    const isPoor = Number.isFinite(accuracy) && accuracy > 50;

    const pin = '<svg class="location__pin" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
      '<circle cx="12" cy="10" r="3"></circle></svg>';

    if (!hasCoords) {
      container.className = 'location location--empty';
      container.innerHTML = pin +
        '<span class="location__coords">No location yet</span>' +
        '<span class="location__accuracy"></span>';
    } else {
      container.className = 'location';
      container.innerHTML = pin +
        '<span class="location__coords">' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</span>' +
        '<span class="location__accuracy' + (isPoor ? ' location__accuracy--poor' : '') + '">' +
        '(' + escapeHtml(accText) + ')</span>';
    }

    const badge = document.getElementById('location-badge');
    if (badge) badge.hidden = !hasCoords;
  }

  // Report modal
  function showReportModal(sighting, onSubmit) {
    const statusModule = window.StatusModule;
    const reasons = statusModule.REASONS || ['unmarked', 'abandoned', 'hazard', 'possibly_illegal', 'other'];

    const content = `
      <form id="report-form" class="report-form">
        <div class="form-group">
          <label class="form-label">Reason</label>
          <select id="report-reason" class="form-select" required>
            <option value="">Select a reason</option>
            ${reasons.map(r => `<option value="${r}">${statusModule.getReasonLabel(r)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Note (optional)</label>
          <textarea id="report-note" class="form-textarea" placeholder="Additional details..." maxlength="500"></textarea>
        </div>
      </form>
    `;

    showModal('Report Suspicious Gear', content, [
      { label: 'Cancel', action: 'cancel', class: 'btn--secondary' },
      { label: 'Submit Report', action: 'submit', class: 'btn--danger', handler: () => {
        const reason = document.getElementById('report-reason').value;
        const note = document.getElementById('report-note').value;
        if (reason && onSubmit) onSubmit(reason, note);
      }}
    ]);
  }

  // Status change modal (inspector)
  function showStatusModal(sighting, onSubmit) {
    const statusModule = window.StatusModule;
    const allowed = statusModule.getAllowedTransitions(sighting.status);

    if (allowed.length === 0) {
      showToast('No status changes available', 'warning');
      return;
    }

    const content = `
      <form id="status-form">
        <div class="form-group">
          <label class="form-label">New Status</label>
          <select id="new-status" class="form-select" required>
            <option value="">Select status</option>
            ${allowed.map(s => `<option value="${s}">${statusModule.getStatusLabel(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Comment ${['resolved', 'false_alarm'].some(s => allowed.includes(s)) ? '(required for resolved/false alarm)' : '(optional)'}</label>
          <textarea id="status-comment" class="form-textarea" placeholder="Inspector comment..." maxlength="500"></textarea>
        </div>
      </form>
    `;

    showModal('Update Status', content, [
      { label: 'Cancel', action: 'cancel', class: 'btn--secondary' },
      { label: 'Update', action: 'submit', class: 'btn--primary', handler: () => {
        const newStatus = document.getElementById('new-status').value;
        const comment = document.getElementById('status-comment').value;
        const requiresComment = ['resolved', 'false_alarm'].includes(newStatus);
        if (newStatus && (!requiresComment || comment.trim()) && onSubmit) {
          onSubmit(newStatus, comment);
        } else if (requiresComment) {
          showToast('Comment is required for this status', 'error');
        }
      }}
    ]);
  }

  // Check if URL is valid for display
  function isValidPhotoUrl(url) {
    if (!url) return false;
    // Data URLs and http(s) URLs are valid
    if (typeof url === 'string' && (url.startsWith('data:') || url.startsWith('http'))) return true;
    return false;
  }

  // Detail view
  function showDetailView(sighting) {
    const statusModule = window.StatusModule;
    const timeStr = new Date(sighting.created_at).toLocaleString();
    const confidencePct = Math.round((sighting.confidence || 0) * 100);
    const pinColor = statusModule.pinColor(sighting);
    const colorHex = CONFIG.COLORS[pinColor] || CONFIG.COLORS.orange;
    const statusLabel = statusModule.getStatusLabel(sighting.status);
    const registryText = sighting.registry_match ? 'Registered' : 'Unverified';
    const registryColor = sighting.registry_match ? CONFIG.COLORS.green : CONFIG.COLORS.orange;

    let photoHtml = '';
    if (sighting.photo_url && isValidPhotoUrl(sighting.photo_url)) {
      photoHtml = `<img src="${sighting.photo_url}" alt="Sighting photo" class="case-detail__photo">`;
    } else {
      photoHtml = `<div class="case-detail__photo case-detail__photo-placeholder">No photo available</div>`;
    }

    const latStr = (sighting.lat && sighting.lon) ? `${sighting.lat.toFixed(5)}, ${sighting.lon.toFixed(5)}` : 'N/A';

    const content = `
      <div class="case-detail">
        ${photoHtml}
        <div class="case-detail__header">
          <div class="case-detail__info">
            <span class="status-badge status-badge--${sighting.status}">${statusLabel}</span>
            <span style="color: ${registryColor}; font-weight: 600;">${registryText}</span>
          </div>
          <span class="monospace">${latStr}</span>
        </div>
        <dl class="case-detail__labels">
          <dt>Type</dt><dd>${sighting.user_class || 'unknown'}</dd>
          <dt>Confidence</dt><dd>${confidencePct}%</dd>
          <dt>Time</dt><dd>${timeStr}</dd>
          <dt>Accuracy</dt><dd>${sighting.accuracy_m ? sighting.accuracy_m + ' m' : 'Manual'}</dd>
        </dl>
        ${sighting.note ? `<div class="case-detail__note">${escapeHtml(sighting.note)}</div>` : ''}
      </div>
    `;

    const actions = [];
    if (sighting.status !== 'resolved' && sighting.status !== 'false_alarm') {
      actions.push({ label: 'Report', action: 'report', class: 'btn--danger', handler: () => {
        hideModal();
        if (window.App && window.App.showReport) window.App.showReport(sighting);
      }});
    }
    if (window.App && window.App.isInspector) {
      actions.push({ label: 'Change Status', action: 'status', class: 'btn--primary', handler: () => {
        hideModal();
        if (window.App && window.App.showStatusChange) window.App.showStatusChange(sighting);
      }});
    }
    actions.push({ label: 'Close', action: 'close', class: 'btn--secondary' });

    showModal('Sighting Details', content, actions);
  }

  // Confirmation dialog - returns Promise<boolean>
  // A one-line text prompt. Resolves to the string, or null if cancelled.
  function prompt(message, value, options = {}) {
    return new Promise((resolve) => {
      const id = 'prompt-input-' + Date.now().toString(36);
      const content =
        `<p>${escapeHtml(message)}</p>` +
        `<label class="field"><span class="visually-hidden">Value</span>` +
        `<input class="input" id="${id}" type="text" value="${escapeHtml(value || '')}"></label>`;

      showModal(options.title || 'Enter a value', content, [
        { label: options.cancelLabel || 'Cancel', action: 'cancel', class: 'btn--secondary', handler: () => resolve(null) },
        { label: options.confirmLabel || 'Save', action: 'confirm', class: 'btn--primary', handler: () => {
            const el = document.getElementById(id);
            resolve(el ? el.value.trim() : '');
          }
        }
      ]);

      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) { el.focus(); el.select(); }
      }, 60);
    });
  }
  function confirm(message, options = {}) {
    return new Promise((resolve) => {
      const content = `<p>${escapeHtml(message)}</p>`;
      showModal(options.title || 'Confirm', content, [
        { label: options.cancelLabel || 'Cancel', action: 'cancel', class: 'btn--secondary', handler: () => resolve(false) },
        { label: options.confirmLabel || 'Confirm', action: 'confirm', class: options.danger ? 'btn--danger' : 'btn--primary', handler: () => resolve(true) }
      ]);
    });
  }


  // A code has to be readable and copyable, not buried in a sentence.
  function showCodeModal(title, code, message) {
    return new Promise((resolve) => {
      const content = [
        '<div class="code-card">',
        message ? '<p class="code-card__note">' + escapeHtml(message) + '</p>' : '',
        '<span class="code-card__value" id="code-value">' + escapeHtml(code) + '</span>',
        '<button type="button" class="btn btn--ghost btn--sm" id="btn-copy-code">Copy</button>',
        '</div>'
      ].join('');

      showModal(title, content, [
        { label: 'Done', action: 'confirm', class: 'btn--primary', handler: () => resolve(true) }
      ]);

      const copy = document.getElementById('btn-copy-code');
      copy?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          copy.textContent = 'Copied';
        } catch {
          // Clipboard access is refused outside a secure context. Selecting the
          // text is the honest fallback.
          const el = document.getElementById('code-value');
          if (el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
          copy.textContent = 'Select and copy';
        }
      });
    });
  }
  // --------------------------------------------------------- verdict card


  // Initialize UI event listeners
  function init() {
    // Bottom navigation (only when the page has no dedicated router)
    document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
      if (item.dataset.bound) return;
      item.dataset.bound = '1';
      item.addEventListener('click', () => showScreen(item.dataset.screen));
    });

    // Filter chips / segmented control — only on pages with a map.
    // The inspector binds its own handler in inspector.js.
    if (!window.MapModule) return;

    document.querySelectorAll('.segment[data-filter], .filter-chip[data-filter]').forEach(chip => {
      if (chip.dataset.bound) return;
      chip.dataset.bound = '1';
      chip.addEventListener('click', () => {
        document.querySelectorAll('.segment[data-filter], .filter-chip[data-filter]').forEach(c => {
          c.classList.remove('is-active', 'filter-chip--active');
        });
        chip.classList.add('is-active', 'filter-chip--active');
        window.MapModule.setFilter(chip.dataset.filter);
      });
    });
  }

  // Public API
  return {
    showToast,
    showLoading,
    hideLoading,
    showModal,
    hideModal,
    showScreen,
    getCurrentScreen,
    setupPhotoPreview,
    clearPhotoPreview,
    getSelectedPhotoFile,
    setupTypeChips,
    getSelectedTypeChip,
    updateLocationDisplay,
    showReportModal,
    showStatusModal,
    showDetailView,
    confirm,
    prompt,
    showCodeModal,
    init,
    escapeHtml
  };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIModule;
} else {
  window.UIModule = UIModule;
}






