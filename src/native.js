// The only file that talks to Capacitor plugins. Everything returns plain
// values and degrades to the browser, so the same screens run in a desktop
// browser during development and as a native app on the phone.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

const isNative = Capacitor.isNativePlatform();

// ---------------------------------------------------------------- position
// -> { lat, lon, accuracy }  (throws an Error with a sentence a person can read)
async function position() {
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

// ------------------------------------------------------------ back button
// Android's back button walks back through screens before leaving the app.
function onBack(handler) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp();
  });
}

window.Native = { isNative, position, photo, scanQr, onBack };
