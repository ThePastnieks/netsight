// NetSight Configuration
const CONFIG = {
  // Detection settings
  CONF_THRESHOLD: 0.60,
  MATCH_RADIUS_M: 50,
  MAX_PHOTO_MB: 5,
  MAX_IMAGE_SIDE_PX: 1280,

  // API endpoints
  DETECT_API_ENDPOINT: '/api/detect',

  // Demo mode - uses stored results instead of live API calls
  DEMO_MODE: true,

  // Demo detection results for different scenarios
  DEMO_DETECTION_RESULTS: {
    buoy: {
      primary_class: 'buoy',
      primary_confidence: 0.87,
      explanation: 'Orange spherical float with a flag and a rope in the water.',
      model: 'demo-model',
      detections: [{ class: 'buoy', confidence: 0.87, box: [0.41, 0.33, 0.12, 0.18] }]
    },
    float: {
      primary_class: 'float',
      primary_confidence: 0.72,
      explanation: 'Small white floats along a net line on the water surface.',
      model: 'demo-model',
      detections: [{ class: 'float', confidence: 0.72, box: [0.35, 0.45, 0.3, 0.2] }]
    },
    net: {
      primary_class: 'net',
      primary_confidence: 0.78,
      explanation: 'Green netting visible on the water surface near shore.',
      model: 'demo-model',
      detections: [{ class: 'net', confidence: 0.78, box: [0.2, 0.3, 0.6, 0.4] }]
    },
    trap: {
      primary_class: 'trap',
      primary_confidence: 0.81,
      explanation: 'Wire mesh trap or pot sitting on the bottom, visible in shallow water.',
      model: 'demo-model',
      detections: [{ class: 'trap', confidence: 0.81, box: [0.4, 0.3, 0.2, 0.3] }]
    },
    low_confidence: {
      primary_class: 'unknown',
      primary_confidence: 0.42,
      explanation: 'Unclear object, possibly a buoy or debris in glare.',
      model: 'demo-model',
      detections: [{ class: 'unknown', confidence: 0.42, box: [0.45, 0.4, 0.1, 0.15] }]
    },
    none: {
      primary_class: 'none',
      primary_confidence: 0.95,
      explanation: 'Open water with no fishing gear visible.',
      model: 'demo-model',
      detections: []
    }
  },

  // Map configuration
  MAP_CENTER: [56.9496, 24.1052], // Riga
  MAP_ZOOM: 12,
  TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_ATTRIBUTION: '&copy; OpenStreetMap contributors',

  // Status colors
  COLORS: {
    green: '#2E9E57',
    orange: '#FF8A3D',
    red: '#D93636',
    blue: '#1FA6D8',
    grey: '#7D8C99'
  },

  // Gear classes
  GEAR_CLASSES: ['buoy', 'float', 'net', 'trap', 'unknown'],
  DETECT_CLASSES: ['buoy', 'float', 'net', 'trap', 'unknown', 'none'],

  // Status values
  STATUSES: ['new', 'reported', 'checked', 'resolved', 'false_alarm'],
  REPORT_REASONS: ['unmarked', 'abandoned', 'hazard', 'possibly_illegal', 'other'],

  // Registry type compatibility
  COMPATIBILITY: {
    buoy: ['buoy', 'net', 'trap'],
    float: ['net', 'buoy'],
    net: ['net'],
    trap: ['trap'],
    unknown: []
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.CONFIG = CONFIG;
}