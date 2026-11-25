// LKS-92 / LKS-2020 (Latvia TM) -> WGS84, plus the CSV handling used by the page.
// Same behaviour as lks2wgs84.py. No dependencies; runs in browsers and in Node (tests).
//
// EPSG:3059 (LKS-92 / Latvia TM) and EPSG:10306 (LKS-2020 / Latvia TM) share one
// Transverse Mercator projection on GRS80: central meridian 24 E, scale 0.9996,
// false easting 500000, false northing -6000000, axes X = northing, Y = easting.
// EPSG defines both datums -> WGS84 as a zero shift with 1 m accuracy
// (transformations 1958 and 10840), so the conversion is the inverse projection.

import { LATVIA_BORDER } from "./latvia.js";

/** Latvia's outline as a list of polygons (each a list of [lon, lat] rings). */
const LATVIA_BORDER_POLYGONS = LATVIA_BORDER;

const A = 6378137.0;                 // GRS80 semi-major axis
const F = 1 / 298.257222101;         // GRS80 flattening
const K0 = 0.9996;
const LON0 = 24.0;
const FALSE_EASTING = 500000.0;
const FALSE_NORTHING = -6000000.0;

/** EPSG area of use for both systems (onshore + offshore), degrees. */
export const LATVIA = { south: 55.67, west: 19.06, north: 58.09, east: 28.24 };
const MARGIN = 0.2;

const N = F / (2 - F);
const E = Math.sqrt(F * (2 - F));
const E2 = E * E;
// rectifying radius (Karney 2011, eq. 14)
const RECT = A / (1 + N) * (1 + N ** 2 / 4 + N ** 4 / 64 + N ** 6 / 256);
// Krueger series coefficients beta_j, inverse direction (Karney 2011, eq. 36)
const BETA = [
  N / 2 - 2 * N ** 2 / 3 + 37 * N ** 3 / 96 - N ** 4 / 360 - 81 * N ** 5 / 512 + 96199 * N ** 6 / 604800,
  N ** 2 / 48 + N ** 3 / 15 - 437 * N ** 4 / 1440 + 46 * N ** 5 / 105 - 1118711 * N ** 6 / 3870720,
  17 * N ** 3 / 480 - 37 * N ** 4 / 840 - 209 * N ** 5 / 4480 + 5569 * N ** 6 / 90720,
  4397 * N ** 4 / 161280 - 11 * N ** 5 / 504 - 830251 * N ** 6 / 7257600,
  4583 * N ** 5 / 161280 - 108847 * N ** 6 / 3991680,
  20648693 * N ** 6 / 638668800,
];

/** tan(geodetic latitude) from tan(conformal latitude) (Karney 2011, eqs. 19-21). */
function tauFromConformal(taup) {
  let tau = taup / (1 - E2);
  for (let i = 0; i < 10; i++) {
    const tau1 = Math.hypot(1, tau);
    const sig = Math.sinh(E * Math.atanh(E * tau / tau1));
    const taupa = Math.hypot(1, sig) * tau - sig * tau1;
    const dtau = (taup - taupa) / Math.hypot(1, taupa)
      * (1 + (1 - E2) * tau * tau) / ((1 - E2) * tau1);
    tau += dtau;
    if (Math.abs(dtau) < 1e-15 * Math.max(1, Math.abs(tau))) break;
  }
  return tau;
}

/** LKS-92 or LKS-2020 Latvia TM (X = northing, Y = easting, metres) -> [lat, lon] degrees. */
export function lksToWgs84(northing, easting) {
  const xi = (northing - FALSE_NORTHING) / (K0 * RECT);
  const eta = (easting - FALSE_EASTING) / (K0 * RECT);
  let xip = xi;
  let etap = eta;
  BETA.forEach((beta, idx) => {
    const j = idx + 1;
    xip -= beta * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etap -= beta * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  });
  const taup = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip));
  const lat = Math.atan(tauFromConformal(taup)) * 180 / Math.PI;
  const lon = LON0 + Math.atan2(Math.sinh(etap), Math.cos(xip)) * 180 / Math.PI;
  return [lat, lon];
}

export function inLatvia(lat, lon, margin = MARGIN) {
  return lat >= LATVIA.south - margin && lat <= LATVIA.north + margin
    && lon >= LATVIA.west - margin && lon <= LATVIA.east + margin;
}

// --- numbers ------------------------------------------------------------------

/** '312 345,67' / '312345.67' / '312.345,67' -> { value, comma } (value null if not a number). */
export function parseNumber(text) {
  let s = String(text ?? "").trim().replace(/[   ']/g, "");
  if (!s) return { value: null, comma: false };
  let comma = false;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) { s = s.replace(/\./g, "").replace(",", "."); comma = true; }
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", "."); comma = true;
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { value: null, comma: false };
  return { value: Number(s), comma };
}

export function formatNumber(value, decimals, comma) {
  const text = value.toFixed(decimals);
  return comma ? text.replace(".", ",") : text;
}

// --- CSV ----------------------------------------------------------------------

/**
 * First of ; TAB , | that appears equally often (and at least once) on every line.
 * ';' goes first: in files with decimal commas the commas inside numbers would
 * otherwise look like a separator.
 */
export function detectDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 50);
  for (const cand of [";", "\t", ",", "|"]) {
    const counts = new Set(lines.map((l) => l.split(cand).length - 1));
    if (lines.length && counts.size === 1 && [...counts][0] > 0) return cand;
  }
  if (!lines.length) return ",";
  return [";", "\t", ",", "|"].reduce((best, c) =>
    (lines[0].split(c).length > lines[0].split(best).length ? c : best), ";");
}

/** RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(field); rows.push(row); row = []; field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Writer with minimal quoting (like Python's csv module). */
export function writeCsv(rows, delimiter, newline) {
  const needsQuote = (f) => f.includes(delimiter) || f.includes('"') || f.includes("\n") || f.includes("\r");
  return rows.map((row) => row.map((f) => {
    const s = String(f ?? "");
    return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(delimiter)).join(newline) + (rows.length ? newline : "");
}

// --- columns ------------------------------------------------------------------

const NAME_NOISE = /lks|2020|92|koordinates|koordinate|koordinata|koord|coordinates|coordinate|coord|tm/g;
const NORTH_NAMES = new Set(["x", "n", "north", "northing", "ziemeli"]);
const EAST_NAMES = new Set(["y", "e", "east", "easting", "austrumi"]);

export function columnKind(name) {
  const core = String(name).toLowerCase().replace(/[^a-z0-9]/g, "").replace(NAME_NOISE, "");
  if (NORTH_NAMES.has(core)) return "north";
  if (EAST_NAMES.has(core)) return "east";
  return null;
}

/** Guess [northingIndex, eastingIndex] from header names; -1 when not found or ambiguous. */
export function guessColumns(header) {
  const north = header.map((h, i) => (columnKind(h) === "north" ? i : -1)).filter((i) => i >= 0);
  const east = header.map((h, i) => (columnKind(h) === "east" ? i : -1)).filter((i) => i >= 0);
  return [north.length === 1 ? north[0] : -1, east.length === 1 ? east[0] : -1];
}

// --- text encoding ------------------------------------------------------------

/** bytes -> { text, encoding: 'utf-8' | 'windows-1257', bom } */
export function decodeBytes(bytes) {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
    return { text, encoding: "utf-8", bom };
  } catch {
    return { text: new TextDecoder("windows-1257").decode(bytes), encoding: "windows-1257", bom: false };
  }
}

let cp1257Table = null;
/** text -> bytes in the input's encoding (Windows-1257 table built from the browser's decoder). */
export function encodeText(text, encoding, bom) {
  if (encoding !== "windows-1257") {
    const body = new TextEncoder().encode(text);
    if (!bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]); out.set(body, 3);
    return out;
  }
  if (!cp1257Table) {
    cp1257Table = new Map();
    const dec = new TextDecoder("windows-1257");
    for (let b = 0; b < 256; b++) cp1257Table.set(dec.decode(new Uint8Array([b])), b);
  }
  const out = new Uint8Array(text.length);
  let i = 0;
  for (const ch of text) out[i++] = cp1257Table.get(ch) ?? 0x3f; // '?' if not representable
  return out.subarray(0, i);
}

// --- conversion ---------------------------------------------------------------

/**
 * Analyse a decoded CSV text. Returns everything the page needs to show and convert:
 * { delimiter, newline, rows, header, data, northIndex, eastIndex, decimalComma }
 */
export function analyse(text, { delimiter = null, noHeader = false } = {}) {
  const delim = delimiter || detectDelimiter(text);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const rows = parseCsv(text, delim);
  while (rows.length && !rows[rows.length - 1].some((c) => c.trim())) rows.pop();
  if (!rows.length) throw new Error("The file has no rows.");
  const header = noHeader ? null : rows[0];
  const data = noHeader ? rows : rows.slice(1);
  const width = Math.max(...rows.map((r) => r.length));
  const [northIndex, eastIndex] = header ? guessColumns(header) : [-1, -1];
  return { delimiter: delim, newline, rows, header, data, width, northIndex, eastIndex };
}

// --- position check ------------------------------------------------------------

const NEAR_KM = 1;    // within this distance of the outline counts as in Latvia (data accuracy)
const FAR_KM = 25;    // beyond this a point is almost certainly wrong data

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance in km from (lat, lon) to the nearest edge of the polygons (local flat approximation). */
function distanceToEdgesKm(lat, lon, polygons) {
  const kx = 111.32 * Math.cos(lat * Math.PI / 180);
  const ky = 110.57;
  let best = Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lon) * kx; const ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lon) * kx; const by = (ring[i][1] - lat) * ky;
        const dx = bx - ax; const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

/**
 * Where a point lies relative to Latvia's outline:
 * { status: 'in' | 'near' | 'far', km } with km = distance outside the outline (0 when inside).
 * 'in' includes points up to 1 km outside (the outline is accurate to a few hundred metres);
 * 'near' is 1-25 km outside (across the border or at sea); 'far' is further.
 */
export function locate(lat, lon, polygons = LATVIA_BORDER_POLYGONS) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { status: "far", km: Infinity };
  const inside = polygons.some((poly) => pointInRing(lon, lat, poly[0])
    && !poly.slice(1).some((hole) => pointInRing(lon, lat, hole)));
  if (inside) return { status: "in", km: 0 };
  // cheap exit for points obviously far away
  const b = LATVIA, m = 1;
  if (lat < b.south - m || lat > b.north + m || lon < b.west - 2 * m || lon > b.east + 2 * m) {
    return { status: "far", km: distanceToEdgesKm(lat, lon, polygons) };
  }
  const km = distanceToEdgesKm(lat, lon, polygons);
  return { status: km <= NEAR_KM ? "in" : km <= FAR_KM ? "near" : "far", km };
}

// --- conversion ---------------------------------------------------------------

/**
 * Convert analysed data.
 * options: northIndex, eastIndex, swap ('auto'|'yes'|'no'), decimal ('auto'|'dot'|'comma'),
 *          decimals, outDelimiter (default: the input's separator)
 * Returns { outRows, stats, messages, swapped, decimalComma, results }.
 * results[i] = { line, row, lat, lon, status: 'in'|'near'|'far'|'invalid', km, note }
 */
export function convert(info, {
  northIndex, eastIndex, swap = "auto", decimal = "auto", decimals = 7, outDelimiter = null,
} = {}) {
  if (northIndex < 0 || eastIndex < 0) throw new Error("Choose the X (northing) and Y (easting) columns.");
  if (northIndex === eastIndex) throw new Error("X and Y must be different columns.");
  const { header, data } = info;
  const delimiter = outDelimiter || info.delimiter;
  const firstLine = header ? 2 : 1;
  let usedComma = false;
  const parsed = data.map((row) => {
    if (!row.some((c) => c.trim())) return "blank";
    const n = parseNumber(row[northIndex]);
    const e = parseNumber(row[eastIndex]);
    usedComma = usedComma || n.comma || e.comma;
    return n.value !== null && e.value !== null ? [n.value, e.value] : null;
  });
  const valid = parsed.filter((p) => Array.isArray(p));
  if (valid.length && valid.every(([n, e]) => Math.abs(n) <= 90 && Math.abs(e) <= 180)) {
    throw new Error("These columns look like degrees already, not LKS coordinates in metres.");
  }

  const messages = [];
  let swapped = swap === "yes";
  if (swap === "auto" && valid.length) {
    const share = (pick) => valid.filter((p) => inLatvia(...lksToWgs84(...pick(p)))).length / valid.length;
    if (share(([n, e]) => [n, e]) < 0.5 && share(([n, e]) => [e, n]) >= 0.9) {
      swapped = true;
      const names = header ? [header[northIndex], header[eastIndex]] : [northIndex + 1, eastIndex + 1];
      messages.push({ level: "note", text: `“${names[0]}” holds eastings and “${names[1]}” northings in this file `
        + "(only that order puts the points in Latvia), so the two were swapped." });
    }
  }

  // decimal comma only where it cannot clash with the separator, unless asked for explicitly
  const decimalComma = decimal === "comma" || (decimal === "auto" && usedComma && delimiter !== ",");

  const stats = { rows: 0, converted: 0, skipped: 0, near: 0, far: 0, duplicates: 0, swappedRows: 0 };
  const results = [];
  const seen = new Map(); // "northing|easting" -> first line
  const outRows = header ? [[...header, "wgs84_lat", "wgs84_lon"]] : [];
  data.forEach((row, i) => {
    const line = firstLine + i;
    const p = parsed[i];
    if (p === "blank") { outRows.push(row); return; }
    stats.rows++;
    if (p === null) {
      stats.skipped++;
      messages.push({ level: "warn", line, text: "no valid coordinates, left empty" });
      outRows.push([...row, "", ""]);
      results.push({ line, row, lat: null, lon: null, status: "invalid", km: null, note: "no valid coordinates" });
      return;
    }
    const [northing, easting] = swapped ? [p[1], p[0]] : p;
    const [lat, lon] = lksToWgs84(northing, easting);
    const where = locate(lat, lon);
    const notes = [];
    if (where.status !== "in") {
      stats[where.status]++;
      const km = where.km < 10 ? where.km.toFixed(1) : Math.round(where.km).toString();
      notes.push(where.status === "near"
        ? `${km} km outside Latvia (across the border or at sea)`
        : `${km} km outside Latvia, check the input`);
      if (locate(...lksToWgs84(easting, northing)).status === "in") {
        stats.swappedRows++;
        notes.push("X and Y look swapped on this line");
      }
    }
    const key = `${northing}|${easting}`;
    if (seen.has(key)) {
      stats.duplicates++;
      notes.push(`same coordinates as line ${seen.get(key)}`);
    } else seen.set(key, line);
    if (notes.length) messages.push({ level: where.status === "far" ? "bad" : "warn", line, text: notes.join("; ") });
    stats.converted++;
    outRows.push([...row, formatNumber(lat, decimals, decimalComma), formatNumber(lon, decimals, decimalComma)]);
    results.push({ line, row, lat, lon, status: where.status, km: where.km, note: notes.join("; ") });
  });
  return { outRows, stats, messages, swapped, decimalComma, delimiter, results };
}

// --- export formats ------------------------------------------------------------

/** Unique property names for the columns ("Column 3" for empty or missing headers). */
function columnNames(info) {
  const used = new Set();
  return Array.from({ length: info.width }, (_, i) => {
    let name = (info.header && info.header[i] && info.header[i].trim()) || `Column ${i + 1}`;
    while (used.has(name)) name += "_";
    used.add(name);
    return name;
  });
}

const LABEL_NAMES = /^(name|nosaukums|title|label|id|nr|numurs|kods|code)$/i;

/** Index of the column used as a point's label: a name/id-like column, else the first text column. */
function labelColumn(info, northIndex, eastIndex) {
  const names = columnNames(info);
  const byName = names.findIndex((n, i) => i !== northIndex && i !== eastIndex && LABEL_NAMES.test(n.trim()));
  if (byName >= 0) return byName;
  return names.findIndex((_, i) => i !== northIndex && i !== eastIndex);
}

const STATUS_TEXT = { in: "in Latvia", near: "near Latvia", far: "far outside Latvia" };

/** GeoJSON FeatureCollection of the converted points (WGS84, [lon, lat]). */
export function toGeoJSON(info, result, decimals = 7) {
  const names = columnNames(info);
  const features = result.results.filter((r) => r.lat !== null).map((r) => {
    const properties = { line: r.line };
    names.forEach((name, i) => { properties[name] = r.row[i] ?? ""; });
    properties.check = STATUS_TEXT[r.status];
    if (r.note) properties.note = r.note;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(r.lon.toFixed(decimals)), Number(r.lat.toFixed(decimals))] },
      properties,
    };
  });
  return JSON.stringify({ type: "FeatureCollection", features }, null, 1) + "\n";
}

const xml = (s) => String(s ?? "").replace(/[<>&"']/g,
  (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

/** KML document (Google Earth) with one placemark per converted point, coloured by the check. */
export function toKML(info, result, { northIndex, eastIndex, title = "Points", decimals = 7 } = {}) {
  const names = columnNames(info);
  const label = labelColumn(info, northIndex, eastIndex);
  const styles = { in: "ff467a1e", near: "ff007be0", far: "ff2b1cd6" }; // aabbggrr
  const styleXml = Object.entries(styles).map(([k, color]) =>
    `  <Style id="${k}"><IconStyle><color>${color}</color><scale>0.9</scale>`
    + "<Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>"
    + "</IconStyle></Style>").join("\n");
  const marks = result.results.filter((r) => r.lat !== null).map((r) => {
    const name = label >= 0 && String(r.row[label] ?? "").trim() ? r.row[label] : `Line ${r.line}`;
    const fields = names.map((n, i) => `<Data name="${xml(n)}"><value>${xml(r.row[i])}</value></Data>`).join("");
    const extra = `<Data name="line"><value>${r.line}</value></Data><Data name="check"><value>${STATUS_TEXT[r.status]}</value></Data>`
      + (r.note ? `<Data name="note"><value>${xml(r.note)}</value></Data>` : "");
    return `  <Placemark><name>${xml(name)}</name><styleUrl>#${r.status}</styleUrl>`
      + `<ExtendedData>${fields}${extra}</ExtendedData>`
      + `<Point><coordinates>${r.lon.toFixed(decimals)},${r.lat.toFixed(decimals)}</coordinates></Point></Placemark>`;
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n'
    + `  <name>${xml(title)}</name>\n${styleXml}\n${marks}\n</Document>\n</kml>\n`;
}
