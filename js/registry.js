// NetSight Registry Module
// Loads registry.csv, handles Haversine matching

const RegistryModule = (function() {
  'use strict';

  let registryCache = null;
  let loadPromise = null;

  // Load registry from CSV
  async function loadRegistry() {
    if (registryCache) return registryCache;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const response = await fetch('data/registry.csv');
        if (!response.ok) throw new Error('Failed to load registry.csv');
        const text = await response.text();
        registryCache = parseCSV(text);
        return registryCache;
      } catch (err) {
        console.error('Registry load failed:', err);
        registryCache = [];
        return registryCache;
      }
    })();

    return loadPromise;
  }

  // Parse CSV text to array of objects
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const items = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length !== headers.length) continue;

      const item = {};
      headers.forEach((h, idx) => item[h] = values[idx]);

      // Convert numeric fields
      item.lat = parseFloat(item.lat);
      item.lon = parseFloat(item.lon);
      item.active = true;

      if (!isNaN(item.lat) && !isNaN(item.lon)) {
        items.push(item);
      }
    }

    return items;
  }

  // Haversine distance (reuse from location module or inline)
  const R_EARTH_M = 6371000;
  function toRad(deg) { return deg * Math.PI / 180; }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Check type compatibility
  function typesCompatible(sightingClass, registryType) {
    if (sightingClass === 'buoy') return true; // buoys mark any gear
    if (sightingClass === 'float') return registryType === 'net' || registryType === 'buoy';
    return sightingClass === registryType; // net-net, trap-trap
  }

  // Match sighting against registry
  // Accepts either a sighting object or { lat, lon, user_class }
  function matchRegistry(sightingOrObj, radiusM = 50) {
    // Handle both object and separate parameters (backwards compatibility)
    const sighting = sightingOrObj;
    const lat = sighting.lat;
    const lon = sighting.lon;
    const user_class = sighting.user_class;

    if (lat === undefined || lon === undefined || user_class === undefined) {
      return null;
    }

    const registry = registryCache || [];
    let best = null;

    for (const item of registry) {
      if (!item.active || !typesCompatible(user_class, item.type)) continue;
      const d = haversineMeters(lat, lon, item.lat, item.lon);
      if (d <= radiusM && (best === null || d < best.distance)) {
        best = { item: item, distance: d };
      }
    }

    return best; // null means unverified
  }

  // Get registry item by ID

  // Clear cache (for testing)

  // Public API
  return {
    loadRegistry,
    matchRegistry,
    typesCompatible,
    haversineMeters,
    get registry() { return registryCache; }
  };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RegistryModule;
} else {
  window.RegistryModule = RegistryModule;
}