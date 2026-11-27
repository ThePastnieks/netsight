// Tiny static server for www/, for looking at the app in a desktop browser.
// Geolocation and camera need localhost or HTTPS; localhost is fine.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// DIR (default www) and PORT (default 5173) can be set from the environment.
const www = join(dirname(fileURLToPath(import.meta.url)), '..', process.env.DIR || 'www');
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.csv': 'text/csv', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path === '/' || path === '\\') path = '/login.html';
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(join(www, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log('NetSight app preview: http://localhost:' + port));
