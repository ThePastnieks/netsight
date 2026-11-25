// NetSight Auth — accounts in Supabase, or in this browser if Supabase is absent
//
// Two modes, one API:
//
//   cloud  Supabase Auth. Accounts live in the database, so a signup on one
//          phone is visible on every other device. The role lives in
//          `profiles` and is created by a database trigger, never by the client.
//
//   local  No Supabase configured. Accounts live in localStorage and nothing
//          leaves this browser. Useful for development, and honest about it.
//
// Usernames, not emails: Supabase Auth wants an email, so a username is expanded
// to <username>@<CONFIG.AUTH_EMAIL_DOMAIN>. The expansion is deterministic, so
// no lookup is needed at sign-in and no username list is exposed.
//
// `require()` is async because restoring a Supabase session is async. Every page
// awaits it before doing anything else.

const Auth = (function() {
  'use strict';

  const CFG = CONFIG.AUTH;
  const ROLES = CFG.roles;
  const ROLE_ORDER = ['user', 'patrol', 'admin'];

  // Local mode keys
  const USERS_KEY = CFG.usersKey;
  const SESSION_KEY = CFG.sessionKey;
  const ITERATIONS = 120000;

  let client = null;
  let session = null;          // cached so current() can stay synchronous
  let ready = null;            // the promise returned by init()
  let lastError = null;        // why the last cloud session attempt failed

  // ---------------------------------------------------------------- helpers

  function isCloud() {
    return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
  }

  function mode() {
    return isCloud() ? 'cloud' : 'local';
  }

  // The one client for the whole app. A second client would hold its own auth
  // state, so queries through it would run as anon and row level security would
  // return nothing. Everything must share this one.
  function sharedClient() {
    return isCloud() ? cloudClient() : null;
  }

  function emailFor(username) {
    const name = String(username || '').trim().toLowerCase();
    return name + '@' + (CONFIG.AUTH_EMAIL_DOMAIN || 'netsight.local');
  }

  function normalise(name) {
    return String(name || '').trim().toLowerCase();
  }

  // ------------------------------------------------------------ validation

  function checkUsernameRules(username) {
    const value = String(username || '').trim();
    if (value.length < 3) return 'Username must be at least 3 characters';
    if (value.length > 24) return 'Username must be at most 24 characters';
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
      return 'Username may only use letters, numbers, dot, dash and underscore';
    }
    return null;
  }

  function checkPasswordRules(password) {
    const value = String(password || '');
    if (value.length < 6) return 'Password must be at least 6 characters';
    if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
      return 'Password must contain letters and numbers';
    }
    return null;
  }

  // ================================================================ cloud

  function cloudClient() {
    if (client) return client;

    if (typeof window.supabase === 'undefined') {
      console.error('supabase-js is not loaded — cannot use cloud mode');
      return null;
    }

    client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    return client;
  }

  // Reads the profile row for a user id. Returns null when the account has no
  // profile — which is how a deleted account behaves: the auth user may still
  // exist, but without a profile there is no role and therefore no entry.
  // Returns { profile } or { error }. The error is not swallowed: "profile
  // missing" and "permission denied" look identical to the user, and the second
  // one is a setup problem with a specific fix.
  async function cloudProfile(userId) {
    const db = cloudClient();
    if (!db) return { error: 'Cloud mode is not available' };

    const { data, error } = await db
      .from('profiles')
      .select('id, username, role')
      .eq('id', userId)
      .maybeSingle();

    if (error) return { error: error.message, code: error.code };

    return { profile: data };
  }

  // Turns a Supabase session into the app's session, or explains why it cannot.
  async function cloudSessionFrom(supabaseSession) {
    if (!supabaseSession || !supabaseSession.user) {
      return { error: 'No session' };
    }

    const { profile, error, code } = await cloudProfile(supabaseSession.user.id);

    if (error) {
      // Distinguish "the database refused to answer" from "there is no row".
      // They look the same to the user and need opposite fixes.
      if (code === '42501' || /permission denied/i.test(error)) {
        return {
          error: 'The database refused to read profiles. Run the grant statements ' +
                 'at the end of supabase/migrations/003_full_schema.sql.',
          fatal: true
        };
      }
      return { error: 'Could not read your profile: ' + error, fatal: true };
    }

    if (!profile) {
      return {
        error: 'That account has no profile row. The signup trigger did not run — ' +
               're-run supabase/migrations/003_full_schema.sql and check ' +
               'Database → Triggers for on_auth_user_created.',
        fatal: true
      };
    }

    return {
      session: {
        id: profile.id,
        username: profile.username,
        displayName: profile.username,
        role: profile.role,
        at: Date.now()
      }
    };
  }

  async function cloudRegister(username, password, confirm) {
    const nameError = checkUsernameRules(username);
    if (nameError) return { ok: false, message: nameError };

    if (password !== confirm) return { ok: false, message: 'The two passwords do not match' };

    const passwordError = checkPasswordRules(password);
    if (passwordError) return { ok: false, message: passwordError };

    const db = cloudClient();
    if (!db) return { ok: false, message: 'Cloud mode is not available' };

    const { data, error } = await db.auth.signUp({
      email: emailFor(username),
      password,
      options: { data: { username: String(username).trim() } }
    });

    if (error) return { ok: false, message: friendlyAuthError(error) };

    // With email confirmation on, there is no session yet.
    if (!data.session) {
      return {
        ok: false,
        message: 'Account created, but Supabase still wants an email confirmation. ' +
                 'Turn off Auth → Providers → Email → Confirm email, then sign in.'
      };
    }

    const resolved = await cloudSessionFrom(data.session);

    if (!resolved.session) {
      return { ok: false, message: resolved.error };
    }

    session = resolved.session;
    return { ok: true, session: resolved.session };
  }

  async function cloudLogin(username, password) {
    const db = cloudClient();
    if (!db) return { ok: false, message: 'Cloud mode is not available' };

    const { data, error } = await db.auth.signInWithPassword({
      email: emailFor(username),
      password
    });

    if (error) {
      // Do not distinguish "no such user" from "wrong password": that tells an
      // attacker which usernames exist.
      return { ok: false, message: 'Wrong username or password' };
    }

    const resolved = await cloudSessionFrom(data.session);

    if (!resolved.session) {
      await db.auth.signOut();
      return { ok: false, message: resolved.error };
    }

    session = resolved.session;
    return { ok: true, session: resolved.session };
  }

  async function cloudChangePassword(currentPassword, nextPassword, confirm) {
    const db = cloudClient();
    if (!db) return { ok: false, message: 'Cloud mode is not available' };

    if (nextPassword !== confirm) return { ok: false, message: 'The two passwords do not match' };

    const ruleError = checkPasswordRules(nextPassword);
    if (ruleError) return { ok: false, message: ruleError };

    // Supabase will not verify the old password for us; sign in again to do it.
    if (currentPassword !== undefined && currentPassword !== null && currentPassword !== '') {
      const me = session;
      if (!me) return { ok: false, message: 'Not signed in' };

      const check = await db.auth.signInWithPassword({
        email: emailFor(me.username),
        password: currentPassword
      });

      if (check.error) return { ok: false, message: 'Current password is wrong' };
    }

    const { error } = await db.auth.updateUser({ password: nextPassword });
    if (error) return { ok: false, message: friendlyAuthError(error) };

    return { ok: true };
  }

  async function cloudListUsers() {
    const db = cloudClient();
    if (!db) return [];

    const { data, error } = await db
      .from('profiles')
      .select('id, username, role, created_at')
      .order('role', { ascending: true })
      .order('username', { ascending: true });

    if (error) {
      // An empty list and a refused list mean opposite things: one is a fresh
      // install, the other is a broken one. Record which, so the sign-in screen
      // can tell them apart instead of cheerfully saying "Connected".
      console.warn('Could not list users:', error.message);
      if (error.code === '42501' || /permission denied/i.test(error.message)) {
        lastError = 'The database refused to read profiles. Run the grant statements ' +
                    'at the end of supabase/migrations/003_full_schema.sql.';
      }
      return [];
    }

    return (data || []).map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.username,
      role: u.role,
      createdAt: u.created_at
    }));
  }

  async function cloudSetRole(username, role) {
    const db = cloudClient();
    if (!db) return { ok: false, message: 'Cloud mode is not available' };

    const me = session;
    if (!me || me.role !== 'admin') return { ok: false, message: 'Administrators only' };
    if (!ROLES[role]) return { ok: false, message: 'Unknown role' };

    const target = normalise(username);

    // Never leave the system without an admin.
    if (role !== 'admin') {
      const admins = (await cloudListUsers()).filter(u => u.role === 'admin');
      const targetIsAdmin = admins.some(u => u.username === target);
      if (targetIsAdmin && admins.length <= 1) {
        return { ok: false, message: 'That is the last administrator' };
      }
    }

    const { error } = await db
      .from('profiles')
      .update({ role })
      .eq('username', target);

    if (error) return { ok: false, message: error.message };

    return { ok: true, user: { username: target, role } };
  }

  // Deleting the auth user needs the service key, which must never reach the
  // browser. Deleting the profile is enough: without a profile there is no
  // role, and every page refuses the session.
  async function cloudDeleteUser(username) {
    const db = cloudClient();
    if (!db) return { ok: false, message: 'Cloud mode is not available' };

    const me = session;
    if (!me || me.role !== 'admin') return { ok: false, message: 'Administrators only' };

    const target = normalise(username);
    if (me.username === target) return { ok: false, message: 'You cannot delete your own account' };

    const users = await cloudListUsers();
    const user = users.find(u => u.username === target);
    if (!user) return { ok: false, message: 'No such user' };

    if (user.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
      return { ok: false, message: 'That is the last administrator' };
    }

    const { error } = await db.from('profiles').delete().eq('username', target);
    if (error) return { ok: false, message: error.message };

    return { ok: true };
  }

  function friendlyAuthError(error) {
    const msg = String(error && error.message || '');

    if (/already registered|already exists/i.test(msg)) return 'That username is taken';
    if (/password/i.test(msg) && /short|weak/i.test(msg)) {
      return 'Password must be at least 6 characters';
    }
    if (/invalid.*email|email.*invalid/i.test(msg)) {
      return 'That username cannot be used as an account name';
    }
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts — wait a minute';

    return msg || 'Could not reach the server';
  }

  // ================================================================ local

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
      'raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(saltHex), iterations: ITERATIONS, hash: 'SHA-256' },
      baseKey, 256
    );

    return toHex(bits);
  }

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

  function findUser(name) {
    const key = normalise(name);
    return readUsers().find(u => u.username === key) || null;
  }

  let seeded = false;

  async function seedLocal() {
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

  async function localRegister(username, password, confirm) {
    await seedLocal();

    const name = String(username || '').trim();
    const nameError = checkUsernameRules(name);
    if (nameError) return { ok: false, message: nameError };

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
      hash: await derive(password, salt),
      role: 'user',
      createdAt: new Date().toISOString()
    });

    writeUsers(users);

    const next = localSession(findUser(name));
    session = next;
    return { ok: true, session: next };
  }

  async function localLogin(username, password) {
    await seedLocal();

    const user = findUser(username);
    if (!user) return { ok: false, message: 'Wrong username or password' };

    const hash = await derive(password, user.salt);
    if (hash !== user.hash) return { ok: false, message: 'Wrong username or password' };

    const next = localSession(user);
    session = next;
    return { ok: true, session: next };
  }

  function localSession(user) {
    const s = {
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role,
      at: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  function readLocalSession() {
    let raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch { return null; }
    if (!raw) return null;

    let s;
    try { s = JSON.parse(raw); } catch { return null; }

    if (!s || !s.username || !ROLES[s.role]) return null;

    const age = Date.now() - Number(s.at || 0);
    if (!Number.isFinite(age) || age > CFG.ttlHours * 3600 * 1000) {
      clearLocalSession();
      return null;
    }

    const user = findUser(s.username);
    if (!user) { clearLocalSession(); return null; }

    if (user.role !== s.role) {
      s.role = user.role;
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    }

    return s;
  }

  function clearLocalSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  async function localChangePassword(username, currentPassword, nextPassword, confirm) {
    await seedLocal();

    const user = findUser(username);
    if (!user) return { ok: false, message: 'No such user' };

    if (currentPassword !== undefined && currentPassword !== null && currentPassword !== '') {
      const hash = await derive(currentPassword, user.salt);
      if (hash !== user.hash) return { ok: false, message: 'Current password is wrong' };
    }

    if (nextPassword !== confirm) return { ok: false, message: 'The two passwords do not match' };

    const ruleError = checkPasswordRules(nextPassword);
    if (ruleError) return { ok: false, message: ruleError };

    const users = readUsers();
    const target = users.find(u => u.username === user.username);
    target.salt = randomSalt();
    target.hash = await derive(nextPassword, target.salt);
    writeUsers(users);

    return { ok: true };
  }

  function localListUsers() {
    return readUsers()
      .slice()
      .sort((a, b) => {
        const rank = ROLE_ORDER.indexOf(b.role) - ROLE_ORDER.indexOf(a.role);
        if (rank !== 0) return rank;
        return String(a.username).localeCompare(String(b.username));
      })
      .map(u => ({
        id: u.username,
        username: u.username,
        displayName: u.displayName || u.username,
        role: u.role,
        createdAt: u.createdAt
      }));
  }

  function localSetRole(username, role) {
    const me = session || readLocalSession();
    if (!me || me.role !== 'admin') return { ok: false, message: 'Administrators only' };
    if (!ROLES[role]) return { ok: false, message: 'Unknown role' };

    const users = readUsers();
    const user = users.find(u => u.username === normalise(username));
    if (!user) return { ok: false, message: 'No such user' };

    if (user.role === 'admin' && role !== 'admin' &&
        users.filter(u => u.role === 'admin').length <= 1) {
      return { ok: false, message: 'That is the last administrator' };
    }

    user.role = role;
    writeUsers(users);

    return { ok: true, user: { username: user.username, role } };
  }

  function localDeleteUser(username) {
    const me = session || readLocalSession();
    if (!me || me.role !== 'admin') return { ok: false, message: 'Administrators only' };

    const key = normalise(username);
    if (me.username === key) return { ok: false, message: 'You cannot delete your own account' };

    const users = readUsers();
    const user = users.find(u => u.username === key);
    if (!user) return { ok: false, message: 'No such user' };

    if (user.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
      return { ok: false, message: 'That is the last administrator' };
    }

    writeUsers(users.filter(u => u.username !== key));
    return { ok: true };
  }

  // ================================================================== api

  // Restores the session. Await this once per page, before require().
  function init() {
    if (ready) return ready;

    ready = (async () => {
      if (!isCloud()) {
        // Local mode cannot have a cloud failure. Clearing it stops a stale
        // message from a previous configuration being shown as if it were
        // current.
        lastError = null;
        await seedLocal();
        session = readLocalSession();
        return session;
      }

      const db = cloudClient();
      if (!db) { session = null; return null; }

      const { data, error } = await db.auth.getSession();
      if (error || !data.session) { session = null; return null; }

      const resolved = await cloudSessionFrom(data.session);

      // A stored session whose profile cannot be read is a setup problem, not a
      // sign-out. Keep the reason so the sign-in screen can show it instead of
      // silently pretending nobody is signed in.
      if (!resolved.session) {
        lastError = resolved.error;
        session = null;
        return null;
      }

      session = resolved.session;

      // Keep the cache in step when Supabase refreshes or ends the session.
      db.auth.onAuthStateChange(async (event, s) => {
        if (event === 'SIGNED_OUT' || !s) { session = null; return; }
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          const next = await cloudSessionFrom(s);
          session = next.session || null;
          if (!next.session) lastError = next.error;
        }
      });

      return session;
    })();

    return ready;
  }

  async function register(username, password, confirm) {
    return isCloud()
      ? cloudRegister(username, password, confirm)
      : localRegister(username, password, confirm);
  }

  async function login(username, password) {
    return isCloud()
      ? cloudLogin(username, password)
      : localLogin(username, password);
  }

  async function logout() {
    if (isCloud()) {
      const db = cloudClient();
      if (db) await db.auth.signOut();
    } else {
      clearLocalSession();
    }

    session = null;
    location.replace(loginUrl());
  }

  function current() {
    return session;
  }

  function loginUrl() {
    const build = (window.CONFIG && CONFIG.BUILD) || '';
    return build ? 'login.html?v=' + encodeURIComponent(build) : 'login.html';
  }

  // Page guard. Async because the session may still be restoring.
  async function require(allowedRoles) {
    await init();

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

  async function listUsers() {
    return isCloud() ? cloudListUsers() : localListUsers();
  }

  async function setRole(username, role) {
    return isCloud() ? cloudSetRole(username, role) : localSetRole(username, role);
  }

  async function deleteUser(username) {
    return isCloud() ? cloudDeleteUser(username) : localDeleteUser(username);
  }

  async function changePassword(username, currentPassword, nextPassword, confirm) {
    return isCloud()
      ? cloudChangePassword(currentPassword, nextPassword, confirm)
      : localChangePassword(username, currentPassword, nextPassword, confirm);
  }

  function mount(s) {
    const active = s || session;
    if (!active) return;

    const name = active.displayName || active.username;

    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = name;
    });

    document.querySelectorAll('[data-role-label]').forEach(el => {
      el.textContent = roleLabel(active.role);
    });

    document.querySelectorAll('[data-role-short]').forEach(el => {
      el.textContent = name;
    });

    document.body.dataset.role = active.role;
    document.body.dataset.authMode = mode();

    document.querySelectorAll('[data-signout]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        logout();
      });
    });
  }

  return {
    init,
    mode,
    isCloud,
    client: sharedClient,
    register,
    login,
    logout,
    current,
    lastError: () => lastError,
    clearError: () => { lastError = null; },
    require,
    mount,
    loginUrl,
    pageFor,
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







