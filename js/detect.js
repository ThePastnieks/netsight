// NetSight Detection Module
// API client for gear detection with demo mode support

const DetectModule = (function() {
  'use strict';

  // Call detection API
  async function detectGear(imageFile, options = {}) {
    const { signal, onProgress } = options;

    if (CONFIG.DEMO_MODE) {
      return runDemoDetection(imageFile, onProgress);
    }

    return runLiveDetection(imageFile, { signal, onProgress });
  }

  // Demo mode: simulate detection with stored results
  async function runDemoDetection(imageFile, onProgress) {
    // Simulate network delay
    await delay(1500 + Math.random() * 1000);
    if (onProgress) onProgress(0.3);

    await delay(500);
    if (onProgress) onProgress(0.6);

    // Get demo results from config, or use defaults
    const storedResults = CONFIG.DEMO_DETECTION_RESULTS || {};

    // Pick a demo result based on filename or random
    const classKeys = Object.keys(storedResults);
    if (classKeys.length === 0) {
      // Return a default result if no demos configured
      return {
        primary_class: 'none',
        primary_confidence: 0.95,
        explanation: 'Open water with no fishing gear visible.',
        model: 'demo-model',
        detections: []
      };
    }

    const randomKey = classKeys[Math.floor(Math.random() * classKeys.length)];
    const result = { ...storedResults[randomKey] };

    await delay(500);
    if (onProgress) onProgress(1.0);

    // Add some variation to confidence
    result.primary_confidence = Math.max(0.1, Math.min(0.99,
      result.primary_confidence + (Math.random() - 0.5) * 0.1
    ));

    return result;
  }

  // Live detection via serverless function
  async function runLiveDetection(imageFile, options = {}) {
    const { signal, onProgress } = options;

    // Convert to base64
    const base64 = await fileToBase64(imageFile);
    if (onProgress) onProgress(0.2);

    const response = await fetch(CONFIG.DETECT_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
      signal
    });

    if (onProgress) onProgress(0.7);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Detection failed: ${response.status}`);
    }

    if (onProgress) onProgress(1.0);

    return response.json();
  }

  // Convert file to base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timeout = setTimeout(() => {
        console.error('File read timeout');
        reject(new Error('File read timed out. Try a smaller image.'));
      }, 10000);

      reader.onload = () => {
        clearTimeout(timeout);
        resolve(reader.result.split(',')[1]);
      };
      reader.onerror = (e) => {
        clearTimeout(timeout);
        console.error('FileReader error:', e);
        reject(new Error('Failed to read file: ' + (e?.message || 'Unknown error')));
      };
      reader.readAsDataURL(file);
    });
  }

  // Utility delay
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Validate detection result structure
  function validateResult(result) {
    if (!result || typeof result !== 'object') return false;
    if (!result.primary_class) return false;
    const validClasses = ['buoy', 'float', 'net', 'trap', 'none', 'unknown'];
    if (!validClasses.includes(result.primary_class)) {
      console.warn('Invalid primary_class:', result.primary_class);
      return false;
    }
    if (typeof result.primary_confidence !== 'number' || result.primary_confidence < 0 || result.primary_confidence > 1) {
      console.warn('Invalid primary_confidence:', result.primary_confidence);
      return false;
    }
    if (!result.explanation || typeof result.explanation !== 'string') {
      console.warn('Missing or invalid explanation');
      return false;
    }
    return true;
  }

  // Get available demo classes
  function getDemoClasses() {
    return Object.keys(CONFIG.DEMO_DETECTION_RESULTS || {});
  }

  // Public API
  return {
    detectGear,
    validateResult,
    getDemoClasses,
    demoResults: CONFIG.DEMO_DETECTION_RESULTS
  };
})();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DetectModule;
} else {
  window.DetectModule = DetectModule;
}