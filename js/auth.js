// NetSight Auth
//
// One login for the whole app. The role picked here decides which page opens
// and which tabs that page shows. PINs are per role and kept as SHA-256 hashes
// in this browser — there is no server and no user database.
//
// This is a prototype lock, not real authentication: anyone with devtools can
// read the session. It is here to route three kinds of user to three different
// screens, nothing more.

const Auth = (function() {
  'use strict';

  const CFG = CONFIG.AUTH;
  const SESSION_KEY = CFG.sessionKey;
  const PIN_PREFIX = CFG.pinPrefix;
  const CHANGED_FLAG = CFG.changedFlag;

  // ------------------------------------------------------------- hashing

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ------------------------------------------------------------- roles

  function roleIds() {
    return Object.keys(CFG.roles);
  }

  function roles() {
    return roleIds().map(id => Object.assign({ id }, CFG.roles[id]));
  }

  function role(id) {
    return CFG.roles[id] || null;
  }

  function pageFor(id) {
    const r = role(id);
    return r ? r.page : 'login.html';
  }

  function label(id) {
    const r = role(id);
    return r ? r.label : 'Unknown';
  }

  // ------------------------------------------------------------- pin store

  async function pinHash(id) {
    const stored = localStorage.getItem(PIN_PREFIX + id);
    if (stored) return stored;

    // Seed from the documented default the first time this browser sees a role
    const r = role(id);
    if (!r) return null;

    const hash = await sha256(r.defaultPin);
    localStorage.setItem(PIN_PREFIX + id, hash);
    return hash;
  }

  async function verifyPin(id, pin) {
    const expected = await pinHash(id);
    if (!expected) return false;
    return (await sha256(pin)) === expected;
  }

  async function setPin(id, pin) {
    if (!role(id)) throw new Error('Unknown role: ' + id);
    if (String(pin).length < 4) throw new Error('PIN must be at least 4 characters');

    localStorage.setItem(PIN_PREFIX + id, await sha256(pin));
    localStorage.setItem(CHANGED_FLAG, '1');
    return true;
  }

  // True while every role still uses its documented demo PIN
  function usingDefaultPins() {
    return localStorage.getItem(CHANGED_FLAG) !== '1';
  }

  function defaultPins() {
    return roles().map(r => ({ id: r.id, label: r.label, pin: r.defaultPin }));
  }

  // ------------------------------------------------------------- session

  function readSession() {
    let raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch { return null; }
    if (!raw) return null;

    let session;
    try { session = JSON.parse(raw); } catch { return null; }

    if (!session || !role(session.role)) return null;

    const age = Date.now() - Number(session.at || 0);
    if (!Number.isFinite(age) || age > CFG.ttlHours * 3600 * 1000) {
      clearSession();
      return null;
    }

    return session;
  }

  function current() {
    return readSession();
  }

  function currentRole() {
    const s = readSession();
    return s ? s.role : null;
  }

  async function login(id, pin) {
    if (!role(id)) return { ok: false, message: 'Pick a role first' };

    if (!(await verifyPin(id, pin))) {
      return { ok: false, message: 'Wrong PIN' };
    }

    const session = {
      role: id,
      label: label(id),
      at: Date.now()
    };

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      return { ok: false, message: 'Could not start a session in this browser' };
    }

    return { ok: true, session };
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  function logout() {
    clearSession();
    location.replace('login.html');
  }

  // Guard for a page. Redirects to the login screen when there is no session,
  // and to the role's own page when the session belongs to someone else.
  function require(allowedRoles) {
    const session = readSession();

    if (!session) {
      location.replace('login.html');
      return null;
    }

    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(session.role)) {
      location.replace(pageFor(session.role));
      return null;
    }

    return session;
  }

  // ------------------------------------------------------------- chrome

  // Fills the role chip and wires every sign-out control on the page.
  function mount(session) {
    const s = session || readSession();
    if (!s) return;

    document.querySelectorAll('[data-role-label]').forEach(el => {
      el.textContent = s.label;
    });

    document.querySelectorAll('[data-role-short]').forEach(el => {
      el.textContent = role(s.role) ? role(s.role).short : s.label;
    });

    document.body.dataset.role = s.role;

    document.querySelectorAll('[data-signout]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        logout();
      });
    });
  }

  return {
    roles,
    roleIds,
    role,
    label,
    pageFor,
    login,
    logout,
    current,
    currentRole,
    require,
    mount,
    verifyPin,
    setPin,
    usingDefaultPins,
    defaultPins,
    clearSession
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
} else {
  window.Auth = Auth;
}
