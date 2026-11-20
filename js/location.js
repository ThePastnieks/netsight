// NetSight Location Module
// Handles GPS, EXIF fallback, and manual map placement

const LocationModule = (function() {
  'use strict';

  const R_EARTH_M = 6371000;

  // Convert degrees to radians
  function toRad(deg) {
    return deg * Math.PI / 180;
  }

  // Haversine distance calculation
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Get position from browser Geolocation API
  function getBrowserPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      const opts = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        ...options
      };

      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          source: 'gps'
        }),
        err => reject(err),
        opts
      );
    });
  }

  // Extract GPS from EXIF data
  async function getExifPosition(file) {
    if (typeof ExifReader === 'undefined') {
      throw new Error('ExifReader not loaded');
    }

    try {
      const tags = await ExifReader.load(file);
      const lat = tags.GPSLatitude?.value;
      const lon = tags.GPSLongitude?.value;
      const latRef = tags.GPSLatitudeRef?.value;
      const lonRef = tags.GPSLongitudeRef?.value;

      if (!lat || !lon) {
        throw new Error('No GPS data in EXIF');
      }

      // Convert DMS to decimal degrees
      const convertDMS = (dms, ref) => {
        const degrees = dms[0] + dms[1] / 60 + dms[2] / 3600;
        return (ref === 'S' || ref === 'W') ? -degrees : degrees;
      };

      return {
        lat: convertDMS(lat, latRef),
        lon: convertDMS(lon, lonRef),
        accuracy_m: null,
        source: 'exif'
      };
    } catch (err) {
      throw new Error('EXIF parsing failed: ' + err.message);
    }
  }

  // Get position with fallback chain: GPS -> EXIF -> manual
  async function getPosition(photoFile = null) {
    // 1. Try browser GPS
    try {
      const pos = await getBrowserPosition();
      return pos;
    } catch (err) {
      console.warn('Browser GPS failed:', err.message);
    }

    // 2. Try EXIF from photo
    if (photoFile) {
      try {
        const pos = await getExifPosition(photoFile);
        return pos;
      } catch (err) {
        console.warn('EXIF GPS failed:', err.message);
      }
    }

    // 3. Manual placement required
    throw new Error('MANUAL_PLACEMENT_REQUIRED');
  }

  // Validate coordinates
  function validateCoordinates(lat, lon) {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  // Format position for display
  function formatPosition(lat, lon, accuracy) {
    const latStr = lat.toFixed(5);
    const lonStr = lon.toFixed(5);
    const accStr = accuracy ? ` (±${Math.round(accuracy)} m)` : ' (manual)';
    return `${latStr}, ${lonStr}${accStr}`;
  }

  // Initialize location module (for future expansion)
  function init() {
    // Currently no initialization needed
    return true;
  }

  // Start GPS watch for position updates
  let watchId = null;
  function startWatch(callback) {
    if (!navigator.geolocation) return null;
    watchId = navigator.geolocation.watchPosition(callback, console.warn, {
      enableHighAccuracy: true,
      maximumAge: 0
    });
    return watchId;
  }

  function stopWatch() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  // Public API
  return {
    getPosition,
    getBrowserPosition,
    getExifPosition,
    haversineMeters,
    validateCoordinates,
    formatPosition,
    init,
    startWatch,
    stopWatch
  };
})();

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocationModule;
} else {
  window.LocationModule = LocationModule;
}