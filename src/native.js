// The only file that talks to Capacitor plugins. Everything returns plain
// values and degrades to the browser, so the same screens run in a desktop
// browser during development and as a native app on the phone.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { AppLauncher } from '@capacitor/app-launcher';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

const isNative = Capacitor.isNativePlatform();

// ------------------------------------------------------- browser-only fake GPS
// For trying the app on a desktop: localStorage.netsight_mock_gps =
// '{"lat":56.95,"lon":24.1,"accuracy":8}'. Never used in the phone app.
function mockFix() {
  if (isNative) return null;
  try {
    const m = JSON.parse(localStorage.getItem('netsight_mock_gps') || 'null');
    if (m && Number.isFinite(m.lat) && Number.isFinite(m.lon)) return { lat: m.lat, lon: m.lon, accuracy: m.accuracy || 8 };
  } catch (e) { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------- position
// -> { lat, lon, accuracy }  (throws an Error with a sentence a person can read)
async function position() {
  const fake = mockFix();
  if (fake) return fake;
  if (isNative) {
    const perm = await Geolocation.requestPermissions();
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      throw new Error('Location is switched off for NetSight. Turn it on in Settings.');
    }
  }
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 });
    return { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
  } catch (e) {
    throw new Error('No GPS fix yet. Move away from cover and try again.');
  }
}

// Continuous position, for the "is it still there?" checks. Resolves to a stop
// function. onPos gets { lat, lon, accuracy }; onErr is called when GPS is lost.
async function watch(onPos, onErr) {
  if (mockFix()) {
    const t = setInterval(() => { const f = mockFix(); if (f) onPos(f); }, 1000);
    return () => clearInterval(t);
  }
  if (isNative) {
    const perm = await Geolocation.requestPermissions();
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      if (onErr) onErr(new Error('Location is switched off'));
      return () => {};
    }
  }
  const id = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 },
    (p, err) => {
      if (err || !p) { if (onErr) onErr(err); return; }
      onPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
    }
  );
  return () => { Geolocation.clearWatch({ id }); };
}

// ------------------------------------------------------------------- photo
// -> File (JPEG) or null when the person cancels.
async function photo() {
  if (!isNative) return pickFileFromBrowser();
  try {
    const shot = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 80,
      width: 1600,
      correctOrientation: true,
      saveToGallery: false
    });
    const blob = await (await fetch(shot.webPath)).blob();
    return new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
  } catch (e) {
    if (/cancel/i.test(String(e && e.message))) return null;
    throw new Error('Could not open the camera. Check that NetSight may use it in Settings.');
  }
}

function pickFileFromBrowser() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// --------------------------------------------------------------------- QR
// -> string (raw QR text), null if cancelled, or throws when unsupported.
async function scanQr() {
  if (!isNative) throw new Error('Scanning works in the phone app. Type the code instead.');

  const { camera } = await BarcodeScanner.requestPermissions();
  if (camera !== 'granted' && camera !== 'limited') {
    throw new Error('Camera is switched off for NetSight. Turn it on in Settings.');
  }

  // On Android the scanner model comes from Google Play services.
  if (Capacitor.getPlatform() === 'android') {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      throw new Error('Preparing the scanner. Try again in a few seconds.');
    }
  }

  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
  return barcodes && barcodes[0] ? barcodes[0].rawValue : null;
}

// ------------------------------------------------------------------- buzz
// A short vibration, for when a gear-check question appears and the phone is in
// a pocket or on a dashboard. Silent failure: a missing vibrator is not an error.
async function buzz() {
  try {
    if (isNative) {
      await Haptics.notification({ type: NotificationType.Warning });
      await Haptics.vibrate({ duration: 300 });
    } else if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------ open in maps
// Shows a position in whatever map app the phone has (geo: link). Falls back to
// the web map when there is none, or in a desktop browser.
async function openMap(lat, lon, label) {
  const q = lat + ',' + lon;
  if (isNative) {
    try {
      await AppLauncher.openUrl({ url: 'geo:' + q + '?q=' + q + '(' + encodeURIComponent(label || 'NetSight') + ')' });
      return;
    } catch (e) { /* no map app: use the web map below */ }
  }
  window.open('https://www.google.com/maps/search/?api=1&query=' + q, '_blank');
}

// ------------------------------------------------------------ back button
// Android's back button walks back through screens before leaving the app.
function onBack(handler) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp();
  });
}

window.Native = { isNative, position, watch, photo, scanQr, buzz, openMap, onBack };
