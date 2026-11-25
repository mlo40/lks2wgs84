# LKS-92 / LKS-2020 ⇄ WGS84 (web)

A static web page for checking and converting coordinates between Latvian TM X/Y (LKS-92,
EPSG:3059 and LKS-2020, EPSG:10306) and WGS84 latitude/longitude, in both directions. Load a CSV
file to see every point on a map with Latvia's border, get a list of suspicious rows, then export
as CSV, GeoJSON or KML. Single points work too.

Everything runs in the browser. There is no server side and files are never uploaded.
No build step: plain HTML, CSS and JavaScript modules, plus a bundled copy of Leaflet for the map.

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
| `assets/lks.js` | conversion in both directions, position check, CSV handling, GeoJSON/KML export (no browser APIs except TextDecoder/TextEncoder) |
| `assets/latvia.js` | Latvia's border (Natural Earth 1:10m, public domain) |
| `assets/app.js` | page logic: single point, file loading, settings, preview, download |
| `assets/style.css` | layout, light and dark theme |
| `assets/vendor/leaflet/` | Leaflet 1.9.4 (BSD-2-Clause), loaded once a file is opened |
| `tests/` | tests for `lks.js` with PROJ reference points (`node --test tests/lks.test.mjs`) |

## What it does

- **Single point:** type LKS X/Y and get lat/long, or type lat/long (decimal, or degrees-minutes-seconds
  like `56°57'05"N`) and get X/Y. Which one you typed is recognised from the numbers. Copy and map
  links are included, and points outside Latvia get a warning (X/Y has a "swap X and Y?" button).
- **CSV import:**
  - separator `;` `,` tab `|`, detected automatically
  - numbers like `311980.51`, `311980,51`, `311 980,51`
  - UTF-8 (with or without BOM) or Windows-1257
  - quoted fields
  - **LKS X/Y or WGS84 lat/long**, recognised from the column names (`X`/`Y`, `Northing`/`Easting`,
    `lks92_x`, `Ziemeli`/`Austrumi`, `lat`/`lon`, `Latitude`/`Longitude`, `Platums`/`Garums`, …)
    and the values, or chosen by hand; columns can also be picked by hand
  - degrees as decimals (`56.951389`, `56,951389`) or degrees-minutes-seconds
  - a whole file with X and Y swapped is detected and corrected
- **Check:** the points appear on a map with Latvia's border as soon as a file is loaded.
  - Each point is compared with the border and coastline (Natural Earth 1:10m, accurate to a few
    hundred metres): **in Latvia** (or within 1 km), **near** (1–25 km outside, e.g. across the
    border or at sea) or **far** (further, usually a typo or mixed-up columns).
  - Also listed: rows without coordinates, rows where X and Y look swapped, and duplicate coordinates.
  - Clicking a problem or a table row jumps to the point; clicking a point shows its row.
  - A line connects the points in file order (switch off with "Connect points"), so a wrong point
    shows up as a spike in the line.
  - "Only rows with problems" filters the preview.
  - Limit: in the middle of Latvia a swapped X/Y can still land inside the country, so only the map
    shows that mistake.
- **Export:**
  - **CSV**: the input file with `wgs84_lat`/`wgs84_lon` added (for X/Y input), or `lks_x`/`lks_y`
    (northing/easting in metres, 2 decimals, valid for LKS-92 and LKS-2020) for lat/long input. By default in the input's own
    separator, decimal style, encoding and line endings; the separator and decimals can be changed.
  - **GeoJSON** (QGIS and other GIS tools) and **KML** (Google Earth): one point per converted row
    with all its columns, plus the check result.

With default settings the CSV export is byte-identical to the command-line tool `lks2wgs84.py`.

**Privacy:** nothing leaves the browser. The only outside requests are the map's background tiles
from OpenStreetMap, made once a file is loaded
([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)); they show which map
area is viewed, not the file.

## Accuracy

Both systems use the same Transverse Mercator projection on GRS80 (central meridian 24°E,
scale 0.9996, false easting 500 000, false northing −6 000 000; X = northing, Y = easting).
EPSG defines LKS-92 → WGS84 (transformation 1958) and LKS-2020 → WGS84 (10840) as a zero
shift with 1 m accuracy, so one calculation serves both systems.

- The projection matches PROJ (what QGIS uses) to well under a millimetre.
- The 1 m figure is the gap between these ETRS89-based systems and today's WGS84. That's fine for maps,
  GIS and devices, not for survey work.
