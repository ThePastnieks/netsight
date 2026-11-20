// NetSight Status Module
// Handles status model, transitions, pin colors, and history

const StatusModule = (function() {
  'use strict';

  // Status transition rules
  const ALLOWED_TRANSITIONS = {
    new: ['reported', 'checked'],
    reported: ['checked'],
    checked: ['resolved', 'false_alarm'],
    resolved: ['checked'],
    false_alarm: ['checked']
  };

  // Status display labels
  const STATUS_LABELS = {
    new: 'New',
    reported: 'Reported',
    checked: 'Checked',
    resolved: 'Resolved',
    false_alarm: 'False Alarm'
  };

  // Report reason labels
  const REASON_LABELS = {
    unmarked: 'Unmarked gear',
    abandoned: 'Abandoned gear',
    hazard: 'Navigation hazard',
    possibly_illegal: 'Possibly illegal',
    other: 'Other'
  };

  // Check if transition is allowed
  function canTransition(from, to) {
    return (ALLOWED_TRANSITIONS[from] || []).includes(to);
  }

  // Get allowed next statuses
  function getAllowedTransitions(from) {
    return ALLOWED_TRANSITIONS[from] || [];
  }

  // Get status label
  function getStatusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  // Get reason label
  function getReasonLabel(reason) {
    return REASON_LABELS[reason] || reason;
  }

  // Pin color function
  function pinColor(sighting) {
    const status = sighting.status;
    const registryMatch = sighting.registry_match;

    if (status === 'resolved' || status === 'false_alarm') return 'grey';
    if (status === 'checked') return 'blue';
    if (status === 'reported') return 'red';
    if (registryMatch) return 'green';
    return 'orange'; // new and unverified
  }

  // Pin color from status and registry_match directly
  function pinColorFromValues(status, registryMatch) {
    if (status === 'resolved' || status === 'false_alarm') return 'grey';
    if (status === 'checked') return 'blue';
    if (status === 'reported') return 'red';
    if (registryMatch) return 'green';
    return 'orange';
  }

  // Status color mapping
  const STATUS_COLORS = {
    new: 'orange',
    reported: 'red',
    checked: 'blue',
    resolved: 'grey',
    false_alarm: 'grey'
  };

  function statusColor(status) {
    return STATUS_COLORS[status] || 'grey';
  }

  // Validate sighting object
  function validateSighting(sighting) {
    const errors = [];

    if (!sighting.lat || !sighting.lon) {
      errors.push('Missing coordinates');
    }

    if (!sighting.user_class || !['buoy', 'float', 'net', 'trap', 'unknown'].includes(sighting.user_class)) {
      errors.push('Invalid user_class');
    }

    if (typeof sighting.confidence !== 'number' || sighting.confidence < 0 || sighting.confidence > 1) {
      errors.push('Invalid confidence');
    }

    if (!['new', 'reported', 'checked', 'resolved', 'false_alarm'].includes(sighting.status)) {
      errors.push('Invalid status');
    }

    return errors;
  }

  // Create initial sighting object
  function createSighting(data) {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : generateId(),
      created_at: now,
      photo_url: data.photo_url || '',
      lat: data.lat,
      lon: data.lon,
      accuracy_m: data.accuracy_m || null,
      detected_class: data.detected_class || 'unknown',
      confidence: data.confidence || 0,
      user_class: data.user_class || 'unknown',
      registry_id: data.registry_id || null,
      registry_match: data.registry_match || false,
      status: 'new',
      report_reason: data.report_reason || null,
      note: data.note || ''
    };
  }

  // Generate a simple UUID fallback
  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Public API
  return {
    canTransition,
    getAllowedTransitions,
    getStatusLabel,
    getReasonLabel,
    pinColor,
    pinColorFromValues,
    statusColor,
    validateSighting,
    createSighting,
    STATUSES: Object.keys(STATUS_LABELS),
    REASONS: Object.keys(REASON_LABELS)
  };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StatusModule;
} else {
  window.StatusModule = StatusModule;
}