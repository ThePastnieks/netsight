// NetSight Detection Client
//
// Sends a photo to the trained fishing-gear model and reports what came back.
// The model lives behind CONFIG.DETECT.endpoint — the app holds no API keys and
// knows nothing about which framework or provider serves the answer.
//
// The contract is documented in DETECT.md and stubbed in
// netlify/functions/detect.js so the model team can drop their work in.

const Detect = (function() {
  'use strict';

  const STORAGE_KEY = CONFIG.DETECT_STORAGE_KEY;

  const LABELS = {
    net: 'Fishing net',
    buoy: 'Buoy',
    float: 'Float',
    trap: 'Trap',
    none: 'No fishing gear',
    unknown: 'Unrecognised object'
  };

  // Captured once at load time. `CONFIG.DETECT` is mutated by save(), so
  // reading it later would make reset() restore the current value instead of
  // the original default.
  const DEFAULTS = Object.freeze({
    endpoint: CONFIG.DETECT.endpoint,
    minConfidence: CONFIG.DETECT.minConfidence
  });

  let settings = null;

  // ------------------------------------------------------------- settings

  function defaults() {
    return Object.assign({}, DEFAULTS);
  }

  function load() {
    if (settings) return settings;
    settings = defaults();

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (typeof stored.endpoint === 'string' && stored.endpoint.trim()) {
          settings.endpoint = stored.endpoint.trim();
        }
        if (Number.isFinite(stored.minConfidence)) {
          settings.minConfidence = clamp01(stored.minConfidence);
        }
      }
    } catch (err) {
      console.warn('Could not read detection settings:', err);
    }

    CONFIG.DETECT.endpoint = settings.endpoint;
    CONFIG.DETECT.minConfidence = settings.minConfidence;
    return settings;
  }

  function save(patch) {
    load();
    settings = Object.assign({}, settings, patch || {});

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('Could not persist detection settings:', err);
    }

    CONFIG.DETECT.endpoint = settings.endpoint;
    CONFIG.DETECT.minConfidence = settings.minConfidence;
    return settings;
  }

  function get() {
    load();
    return Object.assign({}, settings);
  }

  function reset() {
    settings = defaults();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    CONFIG.DETECT.endpoint = settings.endpoint;
    CONFIG.DETECT.minConfidence = settings.minConfidence;
    return settings;
  }

  // ------------------------------------------------------------- detection

  // Analyze a photo. Resolves with a normalized verdict, or rejects with a
  // message that is safe to show the user.
  async function analyze(file, options = {}) {
    const cfg = get();
    const { onProgress, signal } = options;

    if (!CONFIG.DETECT.enabled) {
      throw new Error('Detection is switched off in the admin panel');
    }

    if (onProgress) onProgress(0.15);
    const base64 = await fileToBase64(file);
    if (onProgress) onProgress(0.35);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.DETECT.timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response;
    try {
      response = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('The model took too long to answer');
      }
      throw new Error(
        'Could not reach the model endpoint. Check the URL in Admin → AI, ' +
        'or that the function is running.'
      );
    }
    clearTimeout(timer);

    if (onProgress) onProgress(0.75);

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = body && (body.error || body.message);
      throw new Error(
        `Model endpoint returned ${response.status}` + (detail ? ` — ${detail}` : '')
      );
    }

    if (!body || typeof body !== 'object') {
      throw new Error('The model endpoint returned no JSON');
    }

    if (onProgress) onProgress(1);
    return normalize(body);
  }

  // ------------------------------------------------------------- normalize

  // Accepts the documented shape and a few obvious variations, so a model team
  // can be sloppy about naming without breaking the app.
  function normalize(raw) {
    const cfg = get();

    const netFlag =
      raw.fishing_net === true ||
      raw.fishingNet === true ||
      raw.is_fishing_net === true ||
      raw.detected === true;

    const confidence = clamp01(
      firstNumber(raw.confidence, raw.score, raw.probability, raw.fishing_net_confidence)
    );

    const objects = Array.isArray(raw.objects)
      ? raw.objects
      : (Array.isArray(raw.detections) ? raw.detections : []);

    const boxes = objects.slice(0, 5).map(o => ({
      class: normalizeClass(o.class || o.label || o.name),
      confidence: clamp01(o.confidence || o.score),
      box: normalizeBox(o.box || o.bbox)
    })).filter(o => o.box);

    let gearClass;
    if (netFlag) {
      gearClass = normalizeClass(raw.class || raw.label) || 'net';
      if (gearClass === 'none') gearClass = 'net';
    } else {
      gearClass = 'none';
    }

    // If the model said "no net" but still declared another class, trust it
    if (!netFlag && raw.class) {
      const declared = normalizeClass(raw.class);
      if (declared && declared !== 'none') gearClass = declared;
    }

    const needsConfirmation =
      gearClass !== 'none' && confidence < cfg.minConfidence;

    return {
      fishingNet: gearClass === 'net',
      primary_class: gearClass,
      primary_confidence: confidence,
      needsConfirmation,
      label: LABELS[gearClass] || LABELS.unknown,
      explanation: String(raw.explanation || raw.message || '').slice(0, 300),
      model: String(raw.model || raw.model_version || '').slice(0, 60),
      detections: boxes,
      raw
    };
  }

  function normalizeClass(value) {
    const name = String(value || '').toLowerCase().trim();
    if (!name) return '';
    if (name.includes('net') || name.includes('gill') || name.includes('mesh')) return 'net';
    if (name.includes('buoy') || name.includes('marker')) return 'buoy';
    if (name.includes('float') || name.includes('barrel')) return 'float';
    if (name.includes('trap') || name.includes('pot') || name.includes('cage')) return 'trap';
    if (name === 'none' || name.includes('no gear') || name.includes('nothing')) return 'none';
    if (CONFIG.DETECT_CLASSES.includes(name)) return name;
    return 'unknown';
  }

  function normalizeBox(box) {
    if (!Array.isArray(box) || box.length !== 4) return null;
    const nums = box.map(Number);
    if (nums.some(n => !Number.isFinite(n))) return null;
    return nums.map(n => clamp01(n));
  }

  function firstNumber() {
    for (let i = 0; i < arguments.length; i++) {
      const n = Number(arguments[i]);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  // ------------------------------------------------------------- diagnostics

  // Used by Admin → AI → Test. Sends a tiny 1x1 PNG so the endpoint is
  // exercised exactly the way the app will use it.
  async function testEndpoint(endpoint) {
    const target = (endpoint || get().endpoint || '').trim();
    if (!target) return { ok: false, ms: 0, message: 'No endpoint configured' };

    const started = performance.now();
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: pixel }),
        signal: controller.signal
      });

      const ms = Math.round(performance.now() - started);
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const detail = body && (body.error || body.message);
        return {
          ok: false,
          ms,
          message: `HTTP ${res.status}${detail ? ' — ' + String(detail).slice(0, 120) : ''}`
        };
      }

      if (!body || typeof body !== 'object') {
        return { ok: false, ms, message: 'Reached, but the reply was not JSON' };
      }

      if (body.fishing_net === undefined && body.confidence === undefined) {
        return {
          ok: false,
          ms,
          message: 'Reached, but the reply is missing "fishing_net" / "confidence"'
        };
      }

      return {
        ok: true,
        ms,
        message: `Model answered in ${ms} ms` + (body.model ? ` (${body.model})` : '')
      };
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      if (err.name === 'AbortError') {
        return { ok: false, ms, message: 'Timed out after 15 s' };
      }
      return { ok: false, ms, message: 'Could not reach the endpoint — ' + err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------- utilities

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timer = setTimeout(() => reject(new Error('Reading the photo timed out')), 20000);

      reader.onload = () => {
        clearTimeout(timer);
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma === -1 ? result : result.slice(comma + 1));
      };
      reader.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not read the photo'));
      };
      reader.readAsDataURL(file);
    });
  }

  function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n) || 0));
  }

  return {
    load,
    save,
    get,
    reset,
    analyze,
    normalize,
    testEndpoint,
    labels: LABELS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Detect;
} else {
  window.Detect = Detect;
}

