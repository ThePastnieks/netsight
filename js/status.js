// NetSight Status Module
// Status labels, transitions, colours and validation

const StatusModule = (function() {
  'use strict';

  const LABELS = {
    new: 'New',
    reported: 'Reported',
    checked: 'Checked',
    resolved: 'Resolved',
    false_alarm: 'False Alarm'
  };

  const REASONS = ['unmarked', 'abandoned', 'hazard', 'possibly_illegal', 'other'];

  const REASON_LABELS = {
    unmarked: 'Unmarked gear',
    abandoned: 'Abandoned gear',
    hazard: 'Navigation hazard',
    possibly_illegal: 'Possibly illegal',
    other: 'Other'
  };

  // Allowed forward transitions per status
  const TRANSITIONS = {
    new: ['reported', 'checked'],
    reported: ['checked'],
    checked: ['resolved', 'false_alarm'],
    resolved: [],
    false_alarm: []
  };

  // Priority used by the inspector table sorting
  const PRIORITY = {
    reported: 5,
    new: 4,
    checked: 3,
    resolved: 1,
    false_alarm: 0
  };

  function getStatusLabel(status) {
    return LABELS[status] || status || 'Unknown';
  }

  function getReasonLabel(reason) {
    return REASON_LABELS[reason] || reason || '';
  }

  function getAllowedTransitions(status) {
    return TRANSITIONS[status] || [];
  }


  function getStatusPriority(status) {
    return PRIORITY[status] || 0;
  }

  // Colour key for a status badge
  function statusColor(status) {
    switch (status) {
      case 'reported': return 'red';
      case 'new': return 'orange';
      case 'checked': return 'blue';
      case 'resolved': return 'green';
      case 'false_alarm': return 'grey';
      default: return 'grey';
    }
  }

  // Colour key for a map pin - unverified sightings always stand out
  function pinColor(sighting) {
    if (!sighting) return 'grey';
    if (sighting.status === 'resolved' || sighting.status === 'false_alarm') {
      return statusColor(sighting.status);
    }
    if (!sighting.registry_match) return 'orange';
    return statusColor(sighting.status);
  }


  function isGearClass(cls) {
    return CONFIG.GEAR_CLASSES.includes(cls);
  }

  function isStatus(status) {
    return CONFIG.STATUSES.includes(status);
  }

  // Validate and normalise a sighting before it is stored
  function validateSighting(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Sighting data missing'] };
    }

    const lat = Number(data.lat);
    const lon = Number(data.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('Invalid latitude');
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.push('Invalid longitude');

    if (!isGearClass(data.user_class)) errors.push('Invalid gear type');

    const confidence = Number(data.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push('Invalid confidence');
    }

    if (data.status && !isStatus(data.status)) errors.push('Invalid status');

    if (data.report_reason && !REASONS.includes(data.report_reason)) {
      errors.push('Invalid report reason');
    }

    return {
      valid: errors.length === 0,
      errors,
      normalized: {
        photo_url: data.photo_url || '',
        lat,
        lon,
        accuracy_m: data.accuracy_m == null ? null : Math.round(Number(data.accuracy_m)),
        detected_class: isGearClass(data.detected_class) || data.detected_class === 'none'
          ? data.detected_class
          : 'unknown',
        confidence: Number.isFinite(confidence) ? confidence : 0,
        user_class: data.user_class,
        registry_id: data.registry_id || null,
        registry_match: !!data.registry_match,
        status: isStatus(data.status) ? data.status : 'new',
        report_reason: data.report_reason || null,
        note: (data.note || '').slice(0, 500)
      }
    };
  }

  return {
    LABELS,
    REASONS,
    REASON_LABELS,
    TRANSITIONS,
    getStatusLabel,
    getReasonLabel,
    getAllowedTransitions,
    getStatusPriority,
    statusColor,
    pinColor,
    isGearClass,
    isStatus,
    validateSighting
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StatusModule;
} else {
  window.StatusModule = StatusModule;
}


