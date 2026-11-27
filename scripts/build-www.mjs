// Builds www/ — the folder Capacitor packs into the phone app.
//
// The website is plain <script> tags and globals, so this does not rewrite it.
// It copies the files the app needs, swaps the CDN scripts for pinned local
// copies (the app must not depend on unpkg/jsdelivr being up), bundles the
// native plugins into js/native.bundle.js, and points every role at boat.html.
//
//   npm run build         normal build, uses the Supabase project in js/config.js
//   NETSIGHT_SUPABASE_URL=... NETSIGHT_SUPABASE_KEY=... npm run build
//                         point the build at another Supabase project (a test copy)
//                         without editing js/config.js. The key is the PUBLIC
//                         publishable / anon key, never the service key.
//   npm run build:local   same, but with Supabase blanked: the app runs in local
//                         mode, so you can click through it without touching real data.

import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { overrideConfig, describeOverrides } from './config-overrides.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const local = process.env.NETSIGHT_LOCAL === '1';

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, 'js', 'vendor'), { recursive: true });

// Pages and assets the app uses. Admin stays on the website.
for (const dir of ['assets', 'css', 'data']) {
  if (existsSync(join(root, dir))) cpSync(join(root, dir), join(www, dir), { recursive: true });
}

const skip = new Set(['admin.js', 'patrol.js', 'app.js', 'ui.js']);
for (const f of readdirSync(join(root, 'js'))) {
  if (f.endsWith('.js') && !skip.has(f)) cpSync(join(root, 'js', f), join(www, 'js', f));
}

// Vendored libraries, pinned by package.json.
cpSync(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(www, 'js/vendor/supabase.js'));
cpSync(join(root, 'node_modules/qrcode-generator/qrcode.js'), join(www, 'js/vendor/qrcode.js'));
cpSync(join(root, 'node_modules/leaflet/dist/leaflet.js'), join(www, 'js/vendor/leaflet.js'));
mkdirSync(join(www, 'css', 'vendor'), { recursive: true });
cpSync(join(root, 'node_modules/leaflet/dist/leaflet.css'), join(www, 'css/vendor/leaflet.css'));
cpSync(join(root, 'node_modules/leaflet/dist/images'), join(www, 'css/vendor/images'), { recursive: true });

// Native plugins -> one file exposing window.Native.
await build({
  entryPoints: [join(root, 'src/native.js')],
  outfile: join(www, 'js/native.bundle.js'),
  bundle: true,
  format: 'iife',
  globalName: 'NativeBridge',
  target: 'es2020',
  minify: true,
  logLevel: 'warning'
});

const rewrite = html => html
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2[^"]*"><\/script>/g,
           '<script src="js/vendor/supabase.js"></script>')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode-generator[^"]*"><\/script>/g,
           '<script src="js/vendor/qrcode.js"></script>')
  .replace(/(src|href)="([^"]+)\?v=[^"]*"/g, '$1="$2"')
  .replace(/(<script src="js\/config\.js"><\/script>)/,
           '$1\n  <script src="js/boat-config.js"></script>');

for (const page of ['login.html', 'boat.html']) {
  const src = join(root, page);
  if (!existsSync(src)) continue;
  let html = rewrite(readFileSync(src, 'utf8'));
  // The sign-in page is the website's own page; the app adds the language scripts to its copy.
  if (page === 'login.html') {
    html = html.replace('</body>', '  <script src="js/i18n.js"></script>\n  <script src="js/i18n-lv.js"></script>\n</body>');
  }
  writeFileSync(join(www, page), html);
}

// Capacitor requires www/index.html. The app starts at the sign-in page; a signed-in
// person is forwarded to boat.html from there.
writeFileSync(join(www, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>NetSight</title><script>location.replace("login.html");</script>');

if (local) {
  const cfgPath = join(www, 'js/config.js');
  const cfg = readFileSync(cfgPath, 'utf8')
    .replace(/SUPABASE_URL:\s*'[^']*'/, "SUPABASE_URL: ''")
    .replace(/SUPABASE_ANON_KEY:\s*'[^']*'/, "SUPABASE_ANON_KEY: ''");
  writeFileSync(cfgPath, cfg);
}

// Optional overrides from environment variables (another Supabase project, email
// domain, map tile source). See scripts/config-overrides.mjs.
{
  const cfgPath = join(www, 'js/config.js');
  writeFileSync(cfgPath, overrideConfig(readFileSync(cfgPath, 'utf8')));
}

// Fail loudly if a CDN reference survived: the app would break offline-ish.
for (const page of ['login.html', 'boat.html']) {
  const p = join(www, page);
  if (existsSync(p) && /https:\/\/(unpkg|cdn\.jsdelivr)/.test(readFileSync(p, 'utf8'))) {
    throw new Error(page + ' still loads a script from a CDN');
  }
}

console.log('www/ built' + (local ? ' (LOCAL mode: no Supabase)' : ' (cloud mode)') + describeOverrides());
