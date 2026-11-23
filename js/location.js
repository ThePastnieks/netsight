// NetSight Location Module
// Geolocation watch, manual coordinates and distance helpers

const LocationModule = (function() {
  'use strict';

  const R_EARTH_M = 6371000;

  let watchId = null;
  let lastPosition = null;
  let supported = typeof navigator !== 'undefined' && !!navigator.geolocation;
  let onUpdateHandler = null;
  let onErrorHandler = null;

  function init() {
    supported = typeof navigator !== 'undefined' && !!navigator.geolocation;
    if (!supported) {
      console.warn('Geolocation is not supported by this browser');
    }
    return supported;
  }

  function isSupported() {
    return supported;
  }

  // Start watching the position; onUpdate receives { lat, lon, accuracy }
  function startWatch(onUpdate, onError) {
    if (!supported) {
      if (onError) onError(new Error('Geolocation unavailable'));
      return false;
    }
    if (watchId !== null) return true;

    onUpdateHandler = onUpdate || null;
    onErrorHandler = onError || null;

    watchId = navigator.geolocation.watchPosition(
      pos => {
        lastPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp
        };
        if (onUpdateHandler) onUpdateHandler(lastPosition);
      },
      err => {
        console.warn('Geolocation error:', err.message);
        if (onErrorHandler) onErrorHandler(err);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return true;
  }

  function stopWatch() {
    if (watchId !== null && supported) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  }

  // One-off position request
  function getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!supported) {
        reject(new Error('Geolocation unavailable'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          lastPosition = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp
          };
          resolve(lastPosition);
        },
        err => reject(new Error(err.message || 'Could not get position')),
        {
          enableHighAccuracy: true,
          maximumAge: options.maximumAge || 0,
          timeout: options.timeout || 15000
        }
      );
    });
  }

  function getLastPosition() {
    return lastPosition;
  }

  function setManualPosition(lat, lon, accuracy = null) {
    lastPosition = { lat, lon, accuracy, timestamp: Date.now(), manual: true };
    return lastPosition;
  }

  function isWatching() {
    return watchId !== null;
  }

  function toRad(deg) {
    return deg * Math.PI / 180;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return {
    init,
    isSupported,
    startWatch,
    stopWatch,
    isWatching,
    getCurrentPosition,
    getLastPosition,
    setManualPosition,
    haversineMeters
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocationModule;
} else {
  window.LocationModule = LocationModule;
}
