// NetSight Store Module
// Supabase client for sightings CRUD, photo upload, and realtime

const StoreModule = (function() {
  'use strict';

  let supabase = null;
  let channel = null;

  // Initialize Supabase client
  function initClient() {
    if (typeof window.supabase === 'undefined') {
      console.warn('Supabase not loaded - using demo mode only');
      return null;
    }

    const url = CONFIG.SUPABASE_URL;
    const key = CONFIG.SUPABASE_ANON_KEY;

    if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_ANON_KEY')) {
      console.warn('Supabase not configured - using demo mode only');
      return null;
    }

    supabase = window.supabase.createClient(url, key);
    return supabase;
  }

  // Get Supabase client
  function getClient() {
    return supabase || initClient();
  }

  // Upload photo - handles both demo mode (blob URL) and production (Supabase)
  async function uploadPhoto(file, sightingId) {
    // Validate file
    if (!file || !(file instanceof File) || file.size === 0) {
      throw new Error('Invalid or empty file');
    }

    const client = getClient();
    if (!client) {
      // Demo mode: convert blob URL to data URL for persistence
      return await blobToDataURL(file);
    }

    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    // Use a more descriptive path to avoid conflicts
    const path = `${sightingId}-${Date.now()}.${ext}`;

    const { data, error } = await client.storage
      .from('sightings-photos')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = client.storage
      .from('sightings-photos')
      .getPublicUrl(path);

    return publicUrl;
  }

  // Convert blob/file to data URL
  async function blobToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timeout = setTimeout(() => {
        console.error('File read timeout');
        reject(new Error('File read timed out. Try a smaller image.'));
      }, 10000); // 10 second timeout

      reader.onload = () => {
        clearTimeout(timeout);
        resolve(reader.result);
      };
      reader.onerror = (e) => {
        clearTimeout(timeout);
        console.error('FileReader error:', e);
        reject(new Error('Failed to read file: ' + (e?.message || 'Unknown error')));
      };
      reader.readAsDataURL(file);
    });
  }

  // Check if URL is a data URL

  // Create a new sighting
  async function createSighting(sighting) {
    const client = getClient();
    if (!client) {
      // Demo mode: return local ID
      return { ...sighting, id: sighting.id || crypto.randomUUID() };
    }

    // Stamp the reporter. The database policy requires auth.uid() = reported_by,
    // so a sighting can only ever be filed as the person filing it.
    const me = (typeof Auth !== 'undefined' && Auth.current()) || null;

    const row = Object.assign({}, sighting, {
      reported_by: me ? me.id : null,
      reporter_name: me ? me.username : null
    });

    const { data, error } = await client
      .from('sightings')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Get all sightings
  async function getSightings(limit = 500) {
    const client = getClient();
    if (!client) return [];

    const { data, error } = await client
      .from('sightings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // Get sighting by ID
  async function getSighting(id) {
    const client = getClient();
    if (!client) return null;

    const { data, error } = await client
      .from('sightings')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  // Update sighting status (inspector action)
  async function updateSightingStatus(id, status, comment, inspectorId) {
    const client = getClient();
    if (!client) throw new Error('Supabase not configured');

    const updates = {
      status,
      updated_at: new Date().toISOString()
    };

    if (comment) updates.note = comment;
    if (inspectorId) updates.inspector_id = inspectorId;

    const { data, error } = await client
      .from('sightings')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Update sighting (for report action)
  async function updateSighting(id, updates) {
    const client = getClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client
      .from('sightings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Subscribe to realtime changes
  function subscribeToSightings(callback) {
    const client = getClient();
    if (!client) {
      console.warn('Realtime not available in demo mode');
      return () => {};
    }

    channel = client
      .channel('sightings-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sightings'
      }, callback)
      .subscribe();

    return () => {
      if (channel) {
        client.removeChannel(channel);
        channel = null;
      }
    };
  }

  // Unsubscribe from realtime

  // Demo mode: use localStorage for offline persistence
  const DEMO_STORAGE_KEY = 'netsight_sightings';


  // No seeded sightings. A map that shows gear nobody reported is a map that
  // lies: a patrol cannot tell a demo pin from a real one, and the first thing
  // anyone does is try to act on it. An empty map is honest; demo data is not.
  const DEMO_SIGHTINGS = [];

  function getDemoSightings() {
    try {
      const stored = localStorage.getItem(DEMO_STORAGE_KEY);
      // Return them as they are. A report with no photo has no photo —
      // inventing a coloured rectangle so the card looks full is a small lie
      // that makes a real photo impossible to tell from a placeholder.
      if (stored) return JSON.parse(stored);
    } catch (err) {
      console.warn('Could not read stored sightings:', err);
    }
    return DEMO_SIGHTINGS.map(s => ({ ...s }));
  }

  function saveDemoSightings(sightings) {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(sightings));
    } catch (e) {
      console.error('Failed to save demo sightings:', e);
    }
  }

  // Demo create
  async function demoCreateSighting(sighting) {
    const sightings = getDemoSightings();
    sightings.unshift(sighting);
    saveDemoSightings(sightings);
    return sighting;
  }

  // Demo get all
  function demoGetSightings(limit = 500) {
    return getDemoSightings().slice(0, limit);
  }

  // Demo get by ID
  function demoGetSighting(id) {
    return getDemoSightings().find(s => s.id === id) || null;
  }

  // Demo update
  async function demoUpdateSighting(id, updates) {
    const sightings = getDemoSightings();
    const idx = sightings.findIndex(s => s.id === id);
    if (idx === -1) return null;

    sightings[idx] = { ...sightings[idx], ...updates, updated_at: new Date().toISOString() };
    saveDemoSightings(sightings);
    return sightings[idx];
  }

  // ------------------------------------------------------------- deletion

  // Supabase delete
  async function deleteSighting(id) {
    const client = getClient();
    if (!client) throw new Error('Supabase not configured');

    const { error } = await client.from('sightings').delete().eq('id', id);
    if (error) throw error;
    return true;
  }

  // Demo delete
  async function demoDeleteSighting(id) {
    const sightings = getDemoSightings();
    const next = sightings.filter(s => s.id !== id);
    if (next.length === sightings.length) return false;
    saveDemoSightings(next);
    return true;
  }

  async function deleteSightingUnified(id) {
    const client = getClient();
    if (client) return deleteSighting(id);
    return demoDeleteSighting(id);
  }

  // Bulk delete — returns { deleted, failed }
  async function deleteManyUnified(ids) {
    const list = Array.isArray(ids) ? ids.slice() : [];
    let deleted = 0;
    const failed = [];

    if (list.length === 0) return { deleted, failed };

    const client = getClient();
    if (client) {
      const { error } = await client.from('sightings').delete().in('id', list);
      if (error) return { deleted: 0, failed: list };
      return { deleted: list.length, failed };
    }

    const sightings = getDemoSightings();
    const drop = new Set(list);
    const kept = sightings.filter(s => !drop.has(s.id));
    deleted = sightings.length - kept.length;
    saveDemoSightings(kept);
    list.forEach(id => {
      if (kept.some(s => s.id === id)) failed.push(id);
    });
    return { deleted, failed };
  }

  // Wipe every sighting (demo store only — the live backend refuses this)
  async function deleteAllUnified() {
    const client = getClient();
    if (client) throw new Error('Bulk wipe is disabled against the live backend');
    const before = getDemoSightings().length;
    saveDemoSightings([]);
    return { deleted: before };
  }

  // Unified API that falls back to demo mode
  async function createSightingUnified(sighting) {
    const client = getClient();
    if (client) return createSighting(sighting);
    return demoCreateSighting(sighting);
  }

  async function getSightingsUnified(limit = 500) {
    const client = getClient();
    if (client) return getSightings(limit);
    return demoGetSightings(limit);
  }

  async function getSightingUnified(id) {
    const client = getClient();
    if (client) return getSighting(id);
    return demoGetSighting(id);
  }

  async function updateSightingUnified(id, updates) {
    const client = getClient();
    if (client) return updateSighting(id, updates);
    return demoUpdateSighting(id, updates);
  }

  async function updateSightingStatusUnified(id, status, comment, inspectorId) {
    const client = getClient();
    if (client) return updateSightingStatus(id, status, comment, inspectorId);
    return demoUpdateSighting(id, { status, note: comment, inspector_id: inspectorId, updated_at: new Date().toISOString() });
  }

  // Public API
  return {
    initClient,
    getClient,
    uploadPhoto,
    createSighting,
    getSightings,
    getSighting,
    updateSighting,
    updateSightingStatus,
    subscribeToSightings,
    // Unified (demo-aware) methods
    createSightingUnified,
    getSightingsUnified,
    getSightingUnified,
    updateSightingUnified,
    updateSightingStatusUnified,
    // Deletion
    deleteSightingUnified,
    deleteManyUnified,
    deleteAllUnified
  };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StoreModule;
} else {
  window.StoreModule = StoreModule;
}



