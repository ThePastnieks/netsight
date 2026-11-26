// NetSight — QR codes for gear.
//
// A code printed in 12 px text on a buoy is unreadable from a moving boat in the
// rain. The same code as a QR square is one camera press. That is the whole
// reason this file exists.
//
// Two directions:
//   render()  owner side — shows the code as a QR to print, stick on the buoy,
//             or hold up on a phone.
//   scan()    patrol side — reads a QR with the camera, using the browser's own
//             BarcodeDetector. No library, no upload, nothing leaves the device.
//
// Scanning needs HTTPS and a camera. When either is missing, scan() says so
// plainly instead of failing silently, and typing the code still works — that is
// why the manual field is never removed.

const QrModule = (function() {
  'use strict';

  // ---------------------------------------------------------------- render

  // Returns an SVG string for the given text, or null when the encoder is not
  // loaded. Callers must handle null: a QR is a convenience, never the only way.
  function render(text, options) {
    const opts = options || {};
    const cellSize = opts.cellSize || 6;
    const margin = opts.margin === undefined ? 2 : opts.margin;

    if (!text) return null;

    if (typeof window.qrcode !== 'function') {
      console.warn('QR encoder not loaded');
      return null;
    }

    try {
      // Type 0 lets the encoder pick the smallest version that fits.
      const qr = window.qrcode(0, opts.ecc || 'M');
      qr.addData(String(text));
      qr.make();
      return qr.createSvgTag({ cellSize, margin, scalable: true });
    } catch (err) {
      console.warn('Could not render QR:', err.message);
      return null;
    }
  }

  function available() {
    return typeof window.qrcode === 'function';
  }

  // ---------------------------------------------------------------- scanning

  function scannerSupported() {
    return typeof window.BarcodeDetector !== 'undefined';
  }

  // Opens the camera, looks for a QR, resolves with the decoded text.
  //
  // Resolves with { ok, text } or { ok: false, reason }. Every failure path is a
  // sentence a person can act on, because "scan failed" is useless standing on a
  // jetty.
  async function scan(options) {
    const opts = options || {};

    if (!scannerSupported()) {
      return {
        ok: false,
        reason: 'This browser cannot read QR codes. Type the code instead.'
      };
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        ok: false,
        reason: 'No camera access here. Type the code instead.'
      };
    }

    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const video = document.createElement('video');

      video.setAttribute('playsinline', '');
      video.muted = true;
      video.srcObject = stream;

      await video.play();

      if (opts.onVideo) opts.onVideo(video);

      // Poll rather than listen: BarcodeDetector has no reliable event across
      // browsers, and 8 fps is fast enough for a hand-held scan.
      const deadline = Date.now() + (opts.timeoutMs || 20000);

      while (Date.now() < deadline) {
        if (opts.shouldStop && opts.shouldStop()) break;

        try {
          const found = await detector.detect(video);
          if (found && found.length) {
            const text = found[0].rawValue;
            if (text) return { ok: true, text };
          }
        } catch (err) {
          // A frame that cannot be read is normal; keep looking.
        }

        await new Promise(r => setTimeout(r, 120));
      }

      return { ok: false, reason: 'No QR code found. Try again, or type the code.' };
    } catch (err) {
      const name = err && err.name;

      if (name === 'NotAllowedError') {
        return { ok: false, reason: 'Camera permission refused. Type the code instead.' };
      }
      if (name === 'NotFoundError') {
        return { ok: false, reason: 'No camera found. Type the code instead.' };
      }

      return { ok: false, reason: 'Could not open the camera. Type the code instead.' };
    } finally {
      if (stream) stream.getTracks().forEach(t => t.stop());
    }
  }

  // Pulls a gear code out of whatever the QR actually contained. Owners may
  // print a bare code, or a URL that ends with it — both should work.
  function extractCode(raw) {
    const text = String(raw || '').trim().toUpperCase();
    if (!text) return null;

    // A bare code.
    const bare = text.match(/\bNS-[A-Z0-9]{4,8}\b/);
    if (bare) return bare[0];

    // Anything else that looks like a code fragment.
    const loose = text.match(/\b[A-Z0-9]{6,8}\b/);
    return loose ? loose[0] : null;
  }

  return { render, available, scan, scannerSupported, extractCode };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QrModule;
} else {
  window.QrModule = QrModule;
}
