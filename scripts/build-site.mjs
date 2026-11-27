// Builds the WEBSITE (including admin.html) into www-site/, with the same optional
// config overrides as the phone app (scripts/config-overrides.mjs). Use it to run
// the website against a test Supabase project, for example to draw the shoreline
// (Admin -> Shore) that the red 50 m lines in the app come from.
//
//   NETSIGHT_AUTH_DOMAIN=example.com NETSIGHT_SUPABASE_URL=... NETSIGHT_SUPABASE_KEY=... npm run site
//
// Then open http://localhost:5174/login.html and sign in as an admin.

import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overrideConfig, describeOverrides } from './config-overrides.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www-site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of readdirSync(root)) {
  if (f.endsWith('.html') || f === 'manifest.webmanifest') cpSync(join(root, f), join(out, f));
}
for (const dir of ['assets', 'css', 'data', 'js']) {
  if (existsSync(join(root, dir))) cpSync(join(root, dir), join(out, dir), { recursive: true });
}

const cfgPath = join(out, 'js/config.js');
writeFileSync(cfgPath, overrideConfig(readFileSync(cfgPath, 'utf8')));

console.log('www-site/ built' + describeOverrides());
