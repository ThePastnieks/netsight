// NetSight UI Module
// Forms, modals, toasts, screen navigation

const UIModule = (function() {
  'use strict';

  let currentScreen = 'map';
  let pendingSighting = null;
  let selectedPhotoFile = null;
  let selectedPhotoUrl = null;
  let detectionResult = null;

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
    requestAnimationFrame(() => overlay.classList.add('loading-overlay--visible'));
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.remove('loading-overlay--visible');
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

    requestAnimationFrame(() => overlay.classList.add('modal-overlay--visible'));

    return overlay;
  }

  function hideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('modal-overlay--visible');
  }

  // Screen navigation
  function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('screen--active'));
    const screen = document.getElementById(`screen-${screenName}`);
    if (screen) {
      screen.classList.add('screen--active');
      currentScreen = screenName;
    }

    // Update bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('nav-item--active', item.dataset.screen === screenName);
    });

    // Hide FAB on non-map screens
    const fab = document.querySelector('.fab');
    if (fab) {
      fab.style.display = screenName === 'map' ? 'flex' : 'none';
    }
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

      if (!file.type.match(/^image\/(jpeg|png)$/)) {
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
      preview.classList.remove('photo-preview--empty');
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
        <div class="photo-preview--empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>Tap to add photo</span>
        </div>
      `;
      preview.classList.add('photo-preview--empty');
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

  function getSelectedPhotoUrl() {
    return selectedPhotoUrl;
  }

  // Detection result display
  function showDetectionResult(result) {
    detectionResult = result;
    const container = document.getElementById('detection-result');
    if (!container) return;

    const confidencePct = Math.round((result.primary_confidence || 0) * 100);
    const className = result.primary_class || 'unknown';
    const isLowConfidence = confidencePct < (CONFIG.CONF_THRESHOLD * 100);
    const isNone = className === 'none';

    let classLabel = className.charAt(0).toUpperCase() + className.slice(1);
    if (className === 'none') classLabel = 'No gear found';

    container.innerHTML = `
      <div class="detection-result__header">
        <span class="detection-result__class">${escapeHtml(classLabel)}</span>
        <span class="detection-result__confidence">${confidencePct}%</span>
      </div>
      <div class="detection-result__explanation">${escapeHtml(result.explanation || '')}</div>
    `;

    container.className = 'detection-result detection-result--visible';
    if (isLowConfidence && !isNone) container.classList.add('detection-result--low-confidence');
    if (isNone) container.classList.add('detection-result--none');
    container.style.display = 'block';

    // Update type chips
    updateTypeChips(className, isLowConfidence || isNone);
  }

  function hideDetectionResult() {
    const container = document.getElementById('detection-result');
    if (container) container.style.display = 'none';
    detectionResult = null;
  }

  function getDetectionResult() {
    return detectionResult;
  }

  // Type chips
  function updateTypeChips(detectedClass, needsConfirmation) {
    const chips = document.querySelectorAll('.type-chip');
    chips.forEach(chip => {
      const isActive = chip.dataset.class === detectedClass && !needsConfirmation;
      chip.classList.toggle('chip--active', isActive);
      if (needsConfirmation && chip.dataset.class === detectedClass) {
        chip.classList.add('chip--active'); // still show detected as active but allow change
      }
    });
  }

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

  // Location display
  function updateLocationDisplay(lat, lon, accuracy) {
    const container = document.getElementById('location-display');
    if (!container) return;

    const latStr = lat.toFixed(5);
    const lonStr = lon.toFixed(5);
    const accText = accuracy ? `±${Math.round(accuracy)} m` : 'Manual';
    const isPoor = accuracy && accuracy > 50;
    const isEmpty = lat === 0 && lon === 0 && !accuracy;

    if (isEmpty) {
      container.className = 'location-display location-display--empty';
      container.innerHTML = `
        <svg class="location-display__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        <span class="location-display__coords">Tap map to set location</span>
        <span class="location-display__accuracy"></span>
      `;
    } else {
      container.className = 'location-display';
      container.innerHTML = `
        <svg class="location-display__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        <span class="location-display__coords">${latStr}, ${lonStr}</span>
        <span class="location-display__accuracy ${isPoor ? 'location-display__accuracy--poor' : ''}">(${accText})</span>
      `;
    }

    // Update badge
    const badge = document.getElementById('location-badge');
    if (badge) {
      badge.hidden = isEmpty;
    }
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
  function confirm(message, options = {}) {
    return new Promise((resolve) => {
      const content = `<p>${escapeHtml(message)}</p>`;
      showModal(options.title || 'Confirm', content, [
        { label: options.cancelLabel || 'Cancel', action: 'cancel', class: 'btn--secondary', handler: () => resolve(false) },
        { label: options.confirmLabel || 'Confirm', action: 'confirm', class: options.danger ? 'btn--danger' : 'btn--primary', handler: () => resolve(true) }
      ]);
    });
  }

  // Initialize UI event listeners
  function init() {
    // Bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        showScreen(item.dataset.screen);
      });
    });

    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (window.MapModule) window.MapModule.setFilter(chip.dataset.filter);
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
    getSelectedPhotoUrl,
    showDetectionResult,
    hideDetectionResult,
    getDetectionResult,
    setupTypeChips,
    getSelectedTypeChip,
    updateLocationDisplay,
    showReportModal,
    showStatusModal,
    showDetailView,
    confirm,
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