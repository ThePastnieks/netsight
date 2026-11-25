// Pack the tile-derived water mask into data/water.json.
//
// Input : tools/water-mask.json   (build-mask.py — one bit per tile pixel)
// Output: data/water.json         two packed bit grids the app reads directly
//
// The app does not get polygons. It gets the grid, because the grid is what is
// actually known to be right: earlier attempts to trace an outline from it kept
// producing rings that missed the river, and a boundary that disagrees with the
// water is worse than no boundary.
//
// Chain: downsample to 20 m cells -> close seams -> chamfer distance transform
// -> permitted = water at least 50 m from land. Both grids ship packed.
//
// Run: node tools/build-water.cjs

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'water-mask.json');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'water.json');

const CELL_M = 20;
const MIN_SHORE_M = 50;
const CLOSE_CELLS = 1;

// --------------------------------------------------------------- read mask

const mask = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const srcCols = mask.tile.cols;
const srcRows = mask.tile.rows;
const water = Buffer.from(mask.water, 'hex');
const AREA = mask.area;

const midLat = (AREA.minLat + AREA.maxLat) / 2;
const mPerPx = (156543.03392 * Math.cos(midLat * Math.PI / 180)) / Math.pow(2, mask.zoom);

const dLat = CELL_M / 111320;
const dLon = CELL_M / (111320 * Math.cos(midLat * Math.PI / 180));

const rows = Math.ceil((AREA.maxLat - AREA.minLat) / dLat);
const cols = Math.ceil((AREA.maxLon - AREA.minLon) / dLon);
const pxPerCell = CELL_M / mPerPx;

console.log(`source ${srcCols}x${srcRows} px @ ${mPerPx.toFixed(2)} m/px`);
console.log(`grid   ${cols}x${rows} cells @ ${CELL_M} m`);

// ------------------------------------------------------------ downsample

const grid = new Uint8Array(cols * rows);
const gIdx = (r, c) => r * cols + c;

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const px0 = Math.floor(c * pxPerCell);
    const px1 = Math.min(srcCols, Math.floor((c + 1) * pxPerCell));
    const py0 = Math.floor(r * pxPerCell);
    const py1 = Math.min(srcRows, Math.floor((r + 1) * pxPerCell));

    let hit = 0, total = 0;
    for (let y = py0; y < py1; y++) {
      const off = y * srcCols;
      for (let x = px0; x < px1; x++) {
        total++;
        if (water[off + x]) hit++;
      }
    }

    // majority vote, not "any": one stray pixel should not make a cell wet
    grid[gIdx(r, c)] = (total && hit / total >= 0.5) ? 1 : 0;
  }
}

console.log(`water cells: ${grid.reduce((n, v) => n + v, 0)}`);

// ---------------------------------------------------------------- closing

function dilate(src, radius) {
  const out = new Uint8Array(src.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!src[gIdx(r, c)]) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (dr * dr + dc * dc > radius * radius) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          out[gIdx(rr, cc)] = 1;
        }
      }
    }
  }
  return out;
}

function erode(src, radius) {
  const out = new Uint8Array(src.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let all = true;
      for (let dr = -radius; dr <= radius && all; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (dr * dr + dc * dc > radius * radius) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || !src[gIdx(rr, cc)]) {
            all = false;
            break;
          }
        }
      }
      out[gIdx(r, c)] = all ? 1 : 0;
    }
  }
  return out;
}

const closed = erode(dilate(grid, CLOSE_CELLS), CLOSE_CELLS);

// ------------------------------------------------- distance to nearest land
//
// Chamfer transform: two passes with weights 1 and sqrt(2), within a couple of
// percent of true Euclidean distance.

const D1 = CELL_M;
const D2 = CELL_M * Math.SQRT2;
const INF = 1e9;
const dist = new Float32Array(cols * rows);

for (let i = 0; i < dist.length; i++) dist[i] = closed[i] ? INF : 0;

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const i = gIdx(r, c);
    if (dist[i] === 0) continue;
    let best = dist[i];
    if (r > 0) {
      best = Math.min(best, dist[gIdx(r - 1, c)] + D1);
      if (c > 0) best = Math.min(best, dist[gIdx(r - 1, c - 1)] + D2);
      if (c < cols - 1) best = Math.min(best, dist[gIdx(r - 1, c + 1)] + D2);
    }
    if (c > 0) best = Math.min(best, dist[gIdx(r, c - 1)] + D1);
    dist[i] = best;
  }
}

for (let r = rows - 1; r >= 0; r--) {
  for (let c = cols - 1; c >= 0; c--) {
    const i = gIdx(r, c);
    if (dist[i] === 0) continue;
    let best = dist[i];
    if (r < rows - 1) {
      best = Math.min(best, dist[gIdx(r + 1, c)] + D1);
      if (c > 0) best = Math.min(best, dist[gIdx(r + 1, c - 1)] + D2);
      if (c < cols - 1) best = Math.min(best, dist[gIdx(r + 1, c + 1)] + D2);
    }
    if (c < cols - 1) best = Math.min(best, dist[gIdx(r, c + 1)] + D1);
    dist[i] = best;
  }
}

// ---------------------------------------------------------- permitted mask

const permitted = new Uint8Array(cols * rows);
for (let i = 0; i < permitted.length; i++) {
  permitted[i] = (closed[i] && dist[i] >= MIN_SHORE_M) ? 1 : 0;
}

console.log(`permitted cells: ${permitted.reduce((n, v) => n + v, 0)}`);

// ------------------------------------------------------------------- pack

function packBits(arr) {
  const bytes = Buffer.alloc(Math.ceil(arr.length / 8));
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  return bytes.toString('base64');
}

const payload = {
  source: 'OpenStreetMap raster tiles — © OpenStreetMap contributors, ODbL',
  generated: new Date().toISOString().slice(0, 10),
  method: `water sampled from tiles at z${mask.zoom}; ${CELL_M} m cells; ` +
          `chamfer distance; permitted = water >= ${MIN_SHORE_M} m from land`,
  cellMetres: CELL_M,
  minShoreMetres: MIN_SHORE_M,
  area: AREA,
  cols,
  rows,
  water: packBits(closed),
  permitted: packBits(permitted)
};

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');

const bytes = fs.statSync(OUT).size;
console.log(`\nfile: ${(bytes / 1024).toFixed(1)} KB`);
console.log(`grid: ${cols} x ${rows} @ ${CELL_M} m`);

// ------------------------------------------------------------------ check
//
// Sanity: a handful of spots that must be water, and spots that must not.

const toLL = (r, c) => [
  AREA.minLat + (r + 0.5) * dLat,
  AREA.minLon + (c + 0.5) * dLon
];
const at = (lat, lon) => {
  const c = Math.floor((lon - AREA.minLon) / dLon);
  const r = Math.floor((lat - AREA.minLat) / dLat);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return { water: 0, perm: 0 };
  return { water: closed[gIdx(r, c)], perm: permitted[gIdx(r, c)] };
};

// Find the widest water point near the middle so the check does not depend on
// hand-picked coordinates.
let best = null;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (!permitted[gIdx(r, c)]) continue;
    const [lat, lon] = toLL(r, c);
    if (lat < 56.94 || lat > 56.97) continue;
    if (!best || dist[gIdx(r, c)] > best.d) {
      best = { lat, lon, d: dist[gIdx(r, c)] };
    }
  }
}

if (best) {
  const got = at(best.lat, best.lon);
  console.log(`\nwidest point near the centre: ${best.lat.toFixed(4)}, ${best.lon.toFixed(4)}`);
  console.log(`  ${Math.round(best.d)} m from land, water=${got.water} permitted=${got.perm}`);
}
