// NetSight Inspector Module
// Dashboard for inspectors to review and manage cases

const InspectorModule = (function() {
  'use strict';

  let allCases = [];
  let filteredCases = [];
  let currentFilter = 'all';
  let currentSort = 'created_desc';
  let unsubRealtime = null;

  // Initialize inspector dashboard
  async function init() {
    UIModule.init();

    // Load cases
    await loadCases();

    // Setup event listeners
    setupEventListeners();

    // Subscribe to realtime
    unsubRealtime = StoreModule.subscribeToSightings(handleRealtimeChange);

    console.log('Inspector dashboard initialized');
  }

  // Load cases from store
  async function loadCases() {
    UIModule.showLoading('Loading cases...');
    try {
      allCases = await StoreModule.getSightingsUnified(1000);
      applyFilterAndSort();
      updateCaseCount();
    } catch (err) {
      console.error('Failed to load cases:', err);
      UIModule.showToast('Failed to load cases', 'error');
    } finally {
      UIModule.hideLoading();
    }
  }

  // Handle realtime changes
  function handleRealtimeChange(payload) {
    console.log('Realtime change:', payload);
    loadCases();
  }

  // Setup event listeners
  function setupEventListeners() {
    // Filter chips
    document.querySelectorAll('.filter-chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip[data-filter]').forEach(c => c.classList.remove('filter-chip--active'));
        chip.classList.add('filter-chip--active');
        currentFilter = chip.dataset.filter;
        applyFilterAndSort();
      });
    });

    // Sort select
    document.getElementById('sort-select')?.addEventListener('change', e => {
      currentSort = e.target.value;
      applyFilterAndSort();
    });
  }

  // Apply filter and sort
  function applyFilterAndSort() {
    // Filter
    filteredCases = allCases.filter(c => {
      if (currentFilter === 'all') return true;
      return c.status === currentFilter;
    });

    // Sort
    filteredCases.sort((a, b) => {
      switch (currentSort) {
        case 'created_asc':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'status_priority':
          return getStatusPriority(b.status) - getStatusPriority(a.status);
        case 'confidence_desc':
          return (b.confidence || 0) - (a.confidence || 0);
        case 'created_desc':
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });

    renderTable();
  }

  // Status priority for sorting (higher = more urgent)
  function getStatusPriority(status) {
    const priorities = {
      reported: 5,
      new: 4,
      checked: 3,
      resolved: 1,
      false_alarm: 0
    };
    return priorities[status] || 0;
  }

  // Render cases table
  function renderTable() {
    const tbody = document.getElementById('cases-tbody');
    const emptyState = document.getElementById('empty-state');

    if (!tbody) return;

    if (filteredCases.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    tbody.innerHTML = filteredCases.map(c => buildRowHtml(c)).join('');

    // Add click handlers for detail buttons
    tbody.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const c = allCases.find(x => x.id === id);
        if (c) UIModule.showDetailView(c);
      });
    });

    // Add click handlers for status buttons
    tbody.querySelectorAll('.btn-status').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const c = allCases.find(x => x.id === id);
        if (c) showStatusChange(c);
      });
    });

    // Row click for detail (but not from action buttons)
    tbody.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', e => {
        // Don't open detail if click was on an action button
        if (e.target.closest('.cell-actions')) return;
        const id = row.dataset.id;
        const c = allCases.find(x => x.id === id);
        if (c) UIModule.showDetailView(c);
      });
    });
  }

  // Build row HTML
  function buildRowHtml(c) {
    const statusModule = window.StatusModule;
    const statusLabel = statusModule.getStatusLabel(c.status);
    const confidencePct = Math.round((c.confidence || 0) * 100);
    const timeStr = formatDateTime(c.created_at);
    const registryText = c.registry_match ? 'Registered' : 'Unverified';
    const registryClass = c.registry_match ? 'registry-yes' : 'registry-no';

    // Short ID for display
    const shortId = c.id.slice(0, 8);

    return `
      <tr data-id="${escapeHtml(c.id)}" style="cursor: pointer;">
        <td class="cell-id"><code>${escapeHtml(shortId)}</code></td>
        <td class="cell-type">${escapeHtml(c.user_class || '?')}</td>
        <td class="cell-status">
          <span class="status-badge status-badge--${c.status}">${escapeHtml(statusLabel)}</span>
        </td>
        <td class="cell-registry ${registryClass}">${escapeHtml(registryText)}</td>
        <td class="cell-confidence">${confidencePct}%</td>
        <td class="cell-location">${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</td>
        <td class="cell-time">${escapeHtml(timeStr)}</td>
        <td class="cell-actions">
          <button type="button" class="btn btn--outline btn--sm btn-detail" data-id="${escapeHtml(c.id)}" aria-label="View details">View</button>
          <button type="button" class="btn btn--primary btn--sm btn-status" data-id="${escapeHtml(c.id)}" aria-label="Change status">Status</button>
        </td>
      </tr>
    `;
  }

  // Format date/time
  function formatDateTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Update case count
  function updateCaseCount() {
    const countEl = document.getElementById('case-count');
    if (countEl) {
      countEl.textContent = `${filteredCases.length} of ${allCases.length} cases`;
    }
  }

  // Show status change modal
  function showStatusChange(c) {
    UIModule.showStatusModal(c, async (newStatus, comment) => {
      UIModule.showLoading('Updating status...');
      try {
        const updated = await StoreModule.updateSightingStatusUnified(
          c.id,
          newStatus,
          comment,
          'inspector-demo'
        );

        // Update local arrays
        const allIdx = allCases.findIndex(x => x.id === c.id);
        if (allIdx !== -1) allCases[allIdx] = updated;

        const filteredIdx = filteredCases.findIndex(x => x.id === c.id);
        if (filteredIdx !== -1) filteredCases[filteredIdx] = updated;

        applyFilterAndSort();
        UIModule.showToast('Status updated to ' + StatusModule.getStatusLabel(newStatus), 'success');
      } catch (err) {
        console.error('Status update failed:', err);
        UIModule.showToast('Failed to update status', 'error');
      } finally {
        UIModule.hideLoading();
      }
    });
  }

  // Cleanup
  window.addEventListener('beforeunload', () => {
    if (unsubRealtime) unsubRealtime();
  });

  // Public API
  return {
    init,
    showStatusChange
  };
})();

// Initialize on DOM ready - only in inspector mode (when ?inspector=true)
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isInInspectorMode = urlParams.get('inspector') === 'true';
  if (!isInInspectorMode) {
    // Not in inspector mode - do nothing
    return;
  }
  InspectorModule.init();
});