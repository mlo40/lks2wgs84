# LKS-92 / LKS-2020 → WGS84 (web)

A static web page that converts Latvian TM coordinates (LKS-92, EPSG:3059 and
LKS-2020, EPSG:10306) to WGS84 latitude/longitude. It converts one point at a time, or
a whole CSV file, which comes back as the same file with `wgs84_lat` and `wgs84_lon` added.

Everything runs in the browser. There is no server side and files are never uploaded.
No build step and no external libraries: plain HTML, CSS and JavaScript modules.

## Publish on GitHub Pages

1. Push this folder as a repository (the files at the top level: `index.html`, `assets/`, …).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repository>/` after a minute.

`.nojekyll` tells GitHub Pages to serve the files as they are.

## Run locally

JavaScript modules don't load from `file://`, so use any small web server:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

## Files

| File | Purpose |
|---|---|
| `index.html` | the page |
| `assets/lks.js` | conversion and CSV handling (no browser APIs except TextDecoder/TextEncoder) |
| `assets/app.js` | page logic: single point, file loading, settings, preview, download |
| `assets/style.css` | layout, light and dark theme |
| `tests/` | tests for `lks.js` with PROJ reference points (`node --test tests/lks.test.mjs`) |

## What it does

- **Single point:** X (northing) and Y (easting) → lat/lon, with copy and map links. If the
  point lands outside Latvia but would be inside with X and Y swapped, it offers to swap them.
- **CSV files:**
  - separator `;` `,` tab `|`, detected automatically
  - numbers like `311980.51`, `311980,51`, `311 980,51`
  - UTF-8 (with or without BOM) or Windows-1257
  - quoted fields
  - coordinate columns found by name (`X`/`Y`, `Northing`/`Easting`, `N`/`E`, `lks92_x`,
    `Ziemeli`/`Austrumi`, …), or chosen in the settings
  - swapped X/Y columns detected
  - rows without coordinates or outside Latvia listed with their line numbers
  - the download keeps the file's separator, decimal style, encoding and line endings

It behaves the same as the command-line tool `lks2wgs84.py`: on the same input both produce
byte-identical output.

## Accuracy

Both systems use the same Transverse Mercator projection on GRS80 (central meridian 24°E,
scale 0.9996, false easting 500 000, false northing −6 000 000; X = northing, Y = easting).
EPSG defines LKS-92 → WGS84 (transformation 1958) and LKS-2020 → WGS84 (10840) as a zero
shift with 1 m accuracy, so one calculation serves both systems.

- The projection matches PROJ (what QGIS uses) to well under a millimetre.
- The 1 m figure is the gap between these ETRS89-based systems and today's WGS84. That's fine for maps,
  GIS and devices, not for survey work.
