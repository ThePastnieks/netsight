"""
Build the water mask for Riga by reading the OpenStreetMap tiles themselves.

Why not OSM polygons: the vector data does not describe the Daugava as one
closed area through the centre — is_in() at the middle of the river returns a
park, not water — so any polygon approach inherits that hole. The tiles, on the
other hand, are exactly the picture the user sees, and the renderer paints water
in one flat colour. Sampling that colour is both simpler and truer.

Output: tools/water-mask.json — a bitmask grid plus its bounds, consumed by
build-water.cjs, which turns it into the polygon file the app ships.

Run: python tools/build-mask.py
"""

import json
import math
import os
import sys
import time
import urllib.request
from io import BytesIO

from PIL import Image

ZOOM = 15
# Riga centre and the near waters.
AREA = {"minLat": 56.915, "maxLat": 57.010, "minLon": 24.045, "maxLon": 24.165}

TILE = 256
CACHE = os.path.join(os.environ.get("TEMP", "."), "netsight-tiles")
OUT = os.path.join(os.path.dirname(__file__), "water-mask.json")

# OSM Carto renders water as this flat fill. Tolerance covers JPEG-free PNG
# rendering plus the odd anti-aliased edge pixel.
WATER_RGB = (170, 211, 223)
TOLERANCE = 12

UA = "NetSight/1.0 (water mask builder; prototype)"


def lonlat_to_tile(lat, lon, z):
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def fetch_tile(z, x, y):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{z}_{x}_{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return Image.open(path).convert("RGB")

    url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return Image.open(BytesIO(data)).convert("RGB")
        except Exception as e:
            if attempt == 2:
                print(f"  tile {z}/{x}/{y} failed: {e}", file=sys.stderr)
                return None
            time.sleep(1.5)


def is_water(px):
    r, g, b = px
    return (abs(r - WATER_RGB[0]) <= TOLERANCE
            and abs(g - WATER_RGB[1]) <= TOLERANCE
            and abs(b - WATER_RGB[2]) <= TOLERANCE)


def main():
    x0f, y0f = lonlat_to_tile(AREA["maxLat"], AREA["minLon"], ZOOM)
    x1f, y1f = lonlat_to_tile(AREA["minLat"], AREA["maxLon"], ZOOM)

    tx0, ty0 = int(x0f), int(y0f)
    tx1, ty1 = int(x1f), int(y1f)

    cols = (tx1 - tx0 + 1) * TILE
    rows = (ty1 - ty0 + 1) * TILE
    print(f"tiles {tx1-tx0+1} x {ty1-ty0+1}  ->  {cols} x {rows} px @ z{ZOOM}")

    mask = bytearray(cols * rows)
    water_px = 0
    got = 0

    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            img = fetch_tile(ZOOM, tx, ty)
            if img is None:
                continue
            got += 1

            px = img.load()
            ox = (tx - tx0) * TILE
            oy = (ty - ty0) * TILE

            for y in range(TILE):
                row = (oy + y) * cols + ox
                for x in range(TILE):
                    if is_water(px[x, y]):
                        mask[row + x] = 1
                        water_px += 1
        print(f"  row {ty - ty0 + 1}/{ty1 - ty0 + 1}  water so far {water_px}")

    print(f"tiles fetched: {got}")
    print(f"water pixels : {water_px} ({100.0 * water_px / (cols*rows):.1f}%)")

    # Pixel -> lat/lon helpers for the consumer.
    payload = {
        "zoom": ZOOM,
        "tile": {"x0": tx0, "y0": ty0, "cols": cols, "rows": rows},
        "area": AREA,
        "water": bytes(mask).hex(),
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f)

    print(f"written: {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
