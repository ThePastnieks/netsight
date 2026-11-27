// Shared by build-www.mjs (the phone app) and build-site.mjs (the website).
// Rewrites a few values in a COPY of js/config.js from environment variables, so a
// test project can be used without editing the committed file.
//
//   NETSIGHT_SUPABASE_URL + NETSIGHT_SUPABASE_KEY   another Supabase project (public key only)
//   NETSIGHT_AUTH_DOMAIN                             email domain usernames map to
//   NETSIGHT_TILE_URL [+ NETSIGHT_TILE_ATTRIBUTION]  another map tile source
//
// The red 50 m lines are drawn from the shore shapes, not from the tiles, so they do
// not change with the tile source.

const esc = v => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function overrideConfig(text, env = process.env) {
  let cfg = text;
  const url = env.NETSIGHT_SUPABASE_URL;
  const key = env.NETSIGHT_SUPABASE_KEY;

  if (url || key) {
    if (!url || !key) throw new Error('Set both NETSIGHT_SUPABASE_URL and NETSIGHT_SUPABASE_KEY');
    let role = '';
    try { role = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64').toString()).role || ''; } catch { /* not a JWT: fine */ }
    if (/service_role/i.test(key) || /service/i.test(role)) {
      throw new Error('That looks like a service key. Only the public publishable/anon key may go in the app.');
    }
    cfg = cfg
      .replace(/SUPABASE_URL:\s*'[^']*'/, () => "SUPABASE_URL: '" + esc(url) + "'")
      .replace(/SUPABASE_ANON_KEY:\s*'[^']*'/, () => "SUPABASE_ANON_KEY: '" + esc(key) + "'");
  }

  if (env.NETSIGHT_AUTH_DOMAIN) {
    cfg = cfg.replace(/AUTH_EMAIL_DOMAIN:\s*'[^']*'/, () => "AUTH_EMAIL_DOMAIN: '" + esc(env.NETSIGHT_AUTH_DOMAIN) + "'");
  }

  if (env.NETSIGHT_TILE_URL) {
    cfg = cfg.replace(/TILE_URL:\s*'[^']*'/, () => "TILE_URL: '" + esc(env.NETSIGHT_TILE_URL) + "'");
    if (env.NETSIGHT_TILE_ATTRIBUTION) {
      cfg = cfg.replace(/TILE_ATTRIBUTION:\s*'[^']*'/, () => "TILE_ATTRIBUTION: '" + esc(env.NETSIGHT_TILE_ATTRIBUTION) + "'");
    }
  }
  return cfg;
}

export function describeOverrides(env = process.env) {
  const bits = [];
  if (env.NETSIGHT_SUPABASE_URL) bits.push('project ' + env.NETSIGHT_SUPABASE_URL);
  if (env.NETSIGHT_AUTH_DOMAIN) bits.push('domain ' + env.NETSIGHT_AUTH_DOMAIN);
  if (env.NETSIGHT_TILE_URL) bits.push('custom tiles');
  return bits.length ? ' [' + bits.join(', ') + ']' : '';
}
