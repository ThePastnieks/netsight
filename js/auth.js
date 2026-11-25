// NetSight Auth — username + password accounts
//
// There is no server. Accounts live in this browser's localStorage with a
// salted PBKDF2 hash per user. The account decides the role, and the role
// decides which page you get:
//
//   user   -> index.html    report gear, browse the map
//   patrol -> patrol.html   work the case list (given by an admin)
//   admin  -> admin.html    everything, including who is what
//
// This is a prototype lock — it routes people to the right screen. It is not a
// substitute for real server-side authentication.

const Auth = (function() {
  'use strict';

  const CFG = CONFIG.AUTH;
  const USERS_KEY = CFG.usersKey;
  const SESSION_KEY = CFG.sessionKey;

  const ROLES = CFG.roles;
  const ROLE_ORDER = ['user', 'patrol', 'admin'];

  // PBKDF2-SHA256, ~120k iterations: slow enough that a stolen hash is not
  // trivially reversible, fast enough (~60 ms) to feel instant.
  const ITERATIONS = 120000;

  // ---------------------------------------------------------------- crypto

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return toHex(bytes);
  }

  async function derive(password, saltHex) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(password)),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: fromHex(saltHex),
        iterations: ITERATIONS,
        hash: 'SHA-256'
      },
      baseKey,
      256
    );

    return toHex(bits);
  }

  // --------------------------------------------------------------- storage

  function readUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function normalise(name) {
    return String(name || '').trim().toLowerCase();
  }

  function findUser(name) {
    const key = normalise(name);
    return readUsers().find(u => u.username === key) || null;
  }

  // ---------------------------------------------------------------- seeding

  let seeded = false;

  // Make sure there is always a way in. Runs once per browser.
  async function seed() {
    if (seeded) return;
    seeded = true;

    if (readUsers().length > 0) return;

    const seedAdmin = CFG.seedAdmin;
    const salt = randomSalt();

    writeUsers([{
      username: normalise(seedAdmin.username),
      displayName: seedAdmin.username,
      salt,
      hash: await derive(seedAdmin.password, salt),
      role: 'admin',
      createdAt: new Date().toISOString()
    }]);
  }

  // ------------------------------------------------------------- password

  async function hashFor(password, salt) {
    return derive(password, salt);
  }

  function checkPasswordRules(password) {
    const value = String(password || '');
    if (value.length < 6) return 'Password must be at least 6 characters';
    if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
      return 'Password must contain letters and numbers';
    }
    return null;
  }

  function checkUsernameRules(username) {
    const value = String(username || '').trim();
    if (value.length < 3) return 'Username must be at least 3 characters';
    if (value.length > 24) return 'Username must be at most 24 characters';
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
      return 'Username may only use letters, numbers, dot, dash and underscore';
    }
    return null;
  }

  // ---------------------------------------------------------------- register

  async function register(username, password, confirm) {
    await seed();

    const name = String(username || '').trim();
    const usernameError = checkUsernameRules(name);
    if (usernameError) return { ok: false, message: usernameError };

    if (password !== confirm) return { ok: false, message: 'The two passwords do not match' };

    const passwordError = checkPasswordRules(password);
    if (passwordError) return { ok: false, message: passwordError };

    if (findUser(name)) return { ok: false, message: 'That username is taken' };

    const users = readUsers();
    const salt = randomSalt();

    users.push({
      username: normalise(name),
      displayName: name,
      salt,
      hash: await hashFor(password, salt),
      role: 'user',              // everyone starts as a normal user
      createdAt: new Date().toISOString()
    });

    writeUsers(users);

    return { ok: true, session: startSession(findUser(name)) };
  }

  // ------------------------------------------------------------------ login

  async function login(username, password) {
    await seed();

    const user = findUser(username);
    if (!user) return { ok: false, message: 'No account with that username' };

    const hash = await hashFor(password, user.salt);
    if (hash !== user.hash) return { ok: false, message: 'Wrong password' };

    return { ok: true, session: startSession(user) };
  }

  function startSession(user) {
    const session = {
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role,
      at: Date.now()
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  // ---------------------------------------------------------------- session

  function readSession() {
    let raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch { return null; }
    if (!raw) return null;

    let session;
    try { session = JSON.parse(raw); } catch { return null; }

    if (!session || !session.username || !ROLES[session.role]) return null;

    const age = Date.now() - Number(session.at || 0);
    if (!Number.isFinite(age) || age > CFG.ttlHours * 3600 * 1000) {
      clearSession();
      return null;
    }

    // The account may have been deleted or demoted while the tab was open
    const user = findUser(session.username);
    if (!user) {
      clearSession();
      return null;
    }
    if (user.role !== session.role) {
      session.role = user.role;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    return session;
  }

  function current() {
    return readSession();
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  function logout() {
    clearSession();
    location.replace(loginUrl());
  }

  // Page guard: no session -> login, wrong role -> that role's own page.
  function require(allowedRoles) {
    const session = readSession();

    if (!session) {
      location.replace(loginUrl());
      return null;
    }

    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(session.role)) {
      location.replace(pageFor(session.role));
      return null;
    }

    return session;
  }

  // ------------------------------------------------------------------ roles

  // Login URL carries the build stamp so a stale service worker or HTTP cache
  // cannot answer with an older copy of the page.
  function loginUrl() {
    var build = (window.CONFIG && CONFIG.BUILD) || '';
    return build ? 'login.html?v=' + encodeURIComponent(build) : 'login.html';
  }

  function pageFor(roleId) {
    const r = ROLES[roleId];
    return r ? r.page : 'login.html';
  }

  function roleInfo(roleId) {
    return ROLES[roleId] || null;
  }

  function roleLabel(roleId) {
    const r = ROLES[roleId];
    return r ? r.label : 'Unknown';
  }

  function allRoles() {
    return ROLE_ORDER.map(id => Object.assign({ id }, ROLES[id]));
  }

  // ------------------------------------------------------------ user admin

  function listUsers() {
    return readUsers()
      .slice()
      .sort((a, b) => {
        const rank = ROLE_ORDER.indexOf(b.role) - ROLE_ORDER.indexOf(a.role);
        if (rank !== 0) return rank;
        return String(a.username).localeCompare(String(b.username));
      })
      .map(u => ({
        username: u.username,
        displayName: u.displayName || u.username,
        role: u.role,
        createdAt: u.createdAt
      }));
  }

  function countAdmins() {
    return readUsers().filter(u => u.role === 'admin').length;
  }

  function setRole(username, role) {
    const me = readSession();
    if (!me || me.role !== 'admin') return { ok: false, message: 'Administrators only' };
    if (!ROLES[role]) return { ok: false, message: 'Unknown role' };

    const users = readUsers();
    const user = users.find(u => u.username === normalise(username));
    if (!user) return { ok: false, message: 'No such user' };

    if (user.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
      return { ok: false, message: 'That is the last administrator' };
    }

    user.role = role;
    writeUsers(users);

    return { ok: true, user: { username: user.username, role } };
  }

  function deleteUser(username) {
    const me = readSession();
    if (!me || me.role !== 'admin') return { ok: false, message: 'Administrators only' };

    const key = normalise(username);
    if (me.username === key) return { ok: false, message: 'You cannot delete your own account' };

    const users = readUsers();
    const user = users.find(u => u.username === key);
    if (!user) return { ok: false, message: 'No such user' };

    if (user.role === 'admin' && countAdmins() <= 1) {
      return { ok: false, message: 'That is the last administrator' };
    }

    writeUsers(users.filter(u => u.username !== key));
    return { ok: true };
  }

  async function changePassword(username, currentPassword, nextPassword, confirm) {
    await seed();

    const user = findUser(username);
    if (!user) return { ok: false, message: 'No such user' };

    if (currentPassword !== undefined && currentPassword !== null) {
      const hash = await hashFor(currentPassword, user.salt);
      if (hash !== user.hash) return { ok: false, message: 'Current password is wrong' };
    }

    if (nextPassword !== confirm) return { ok: false, message: 'The two passwords do not match' };

    const ruleError = checkPasswordRules(nextPassword);
    if (ruleError) return { ok: false, message: ruleError };

    const users = readUsers();
    const target = users.find(u => u.username === user.username);

    target.salt = randomSalt();
    target.hash = await hashFor(nextPassword, target.salt);
    writeUsers(users);

    return { ok: true };
  }

  // ---------------------------------------------------------------- chrome

  // Fills every [data-user-name] / [data-role-label] and wires sign-out.
  function mount(session) {
    const s = session || readSession();
    if (!s) return;

    const name = s.displayName || s.username;

    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = name;
    });

    document.querySelectorAll('[data-role-label]').forEach(el => {
      el.textContent = roleLabel(s.role);
    });

    document.querySelectorAll('[data-role-short]').forEach(el => {
      el.textContent = name;
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
    seed,
    register,
    login,
    logout,
    current,
    require,
    mount,
    clearSession,
    pageFor,
    loginUrl,
    roleInfo,
    roleLabel,
    allRoles,
    listUsers,
    setRole,
    deleteUser,
    changePassword,
    checkPasswordRules,
    checkUsernameRules
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
} else {
  window.Auth = Auth;
}

