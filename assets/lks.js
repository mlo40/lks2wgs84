// LKS-92 / LKS-2020 (Latvia TM) <-> WGS84, plus the CSV handling used by the page.
// LKS -> WGS84 behaves like lks2wgs84.py. No dependencies; runs in browsers and in Node (tests).
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

// Krueger series coefficients alpha_j, forward direction (Karney 2011, eq. 35)
const ALPHA = [
  N / 2 - 2 * N ** 2 / 3 + 5 * N ** 3 / 16 + 41 * N ** 4 / 180 - 127 * N ** 5 / 288 + 7891 * N ** 6 / 37800,
  13 * N ** 2 / 48 - 3 * N ** 3 / 5 + 557 * N ** 4 / 1440 + 281 * N ** 5 / 630 - 1983433 * N ** 6 / 1935360,
  61 * N ** 3 / 240 - 103 * N ** 4 / 140 + 15061 * N ** 5 / 26880 + 167603 * N ** 6 / 181440,
  49561 * N ** 4 / 161280 - 179 * N ** 5 / 168 + 6601661 * N ** 6 / 7257600,
  34729 * N ** 5 / 80640 - 3418889 * N ** 6 / 1995840,
  212378941 * N ** 6 / 319334400,
];

/** WGS84 (lat, lon degrees) -> LKS-92 / LKS-2020 Latvia TM [X northing, Y easting] metres. */
export function wgs84ToLks(lat, lon) {
  const phi = lat * Math.PI / 180;
  const lam = (lon - LON0) * Math.PI / 180;
  const tau = Math.tan(phi);
  const sig = Math.sinh(E * Math.atanh(E * tau / Math.hypot(1, tau)));
  const taup = tau * Math.hypot(1, sig) - sig * Math.hypot(1, tau);
  const xip = Math.atan2(taup, Math.cos(lam));
  const etap = Math.asinh(Math.sin(lam) / Math.hypot(taup, Math.cos(lam)));
  let xi = xip;
  let eta = etap;
  ALPHA.forEach((alpha, idx) => {
    const j = idx + 1;
    xi += alpha * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
    eta += alpha * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
  });
  return [FALSE_NORTHING + K0 * RECT * xi, FALSE_EASTING + K0 * RECT * eta];
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

/**
 * Degrees: '56.951389', '56,951389', '56°57'05.0"N', '56 57 05', '24°06.8'E', 'N 56°57.08''.
 * Returns { value, comma } (value null if not readable; S and W give negative values).
 */
export function parseDegrees(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { value: null, comma: false };
  const plain = parseNumber(raw);
  if (plain.value !== null && !/\s/.test(raw)) return plain;
  let s = raw.toUpperCase().replace(/[\u2032\u2019]/g, "'").replace(/[\u2033\u201d]|''/g, '"');
  let sign = 1;
  const hemi = s.match(/^([NSEW])\s*|\s*([NSEW])$/);
  if (hemi) {
    if ("SW".includes(hemi[1] || hemi[2])) sign = -1;
    s = s.replace(/^[NSEW]\s*|\s*[NSEW]$/, "");
  }
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:°|º|D|\s)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:'|M|\s)?\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|S)?)?$/);
  if (!m) return { value: null, comma: false };
  const num = (x) => (x ? Number(x.replace(",", ".")) : 0);
  const [d, min, sec] = [num(m[1]), num(m[2]), num(m[3])];
  if (min >= 60 || sec >= 60) return { value: null, comma: false };
  return { value: sign * (d + min / 60 + sec / 3600), comma: /\d,\d/.test(raw) };
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

const LAT_NAMES = new Set(["lat", "latitude", "platums", "platuma", "fi", "phi", "wgs84lat", "lat84"]);
const LON_NAMES = new Set(["lon", "lng", "long", "longitude", "garums", "garuma", "lambda", "wgs84lon",
  "wgs84lng", "wgs84long", "lon84"]);

export function columnKind(name) {
  const lower = String(name).toLowerCase().replace(/[āa]/g, "a").replace(/[ūu]/g, "u").replace(/[^a-z0-9]/g, "");
  if (LAT_NAMES.has(lower) || LAT_NAMES.has(lower.replace(/wgs84|wgs/g, ""))) return "lat";
  if (LON_NAMES.has(lower) || LON_NAMES.has(lower.replace(/wgs84|wgs/g, ""))) return "lon";
  const core = lower.replace(NAME_NOISE, "");
  if (NORTH_NAMES.has(core)) return "north";
  if (EAST_NAMES.has(core)) return "east";
  return null;
}

/** Guess [firstIndex, secondIndex] of two column kinds from header names; -1 when not found or ambiguous. */
export function guessColumns(header, kinds = ["north", "east"]) {
  return kinds.map((kind) => {
    const hits = header.map((h, i) => (columnKind(h) === kind ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  });
}

/** Median of the readable values in a column, and the share of non-empty cells that are readable. */
function columnValues(data, index, parse) {
  const values = [];
  let filled = 0;
  for (const row of data.slice(0, 500)) {
    const cell = row[index];
    if (!cell || !cell.trim()) continue;
    filled++;
    const v = parse(cell).value;
    if (v !== null) values.push(v);
  }
  values.sort((a, b) => a - b);
  return { share: filled ? values.length / filled : 0, median: values.length ? values[values.length >> 1] : null };
}

const isLatLike = (v) => v !== null && v >= 50 && v <= 62;   // latitudes around Latvia
const isLonLike = (v) => v !== null && v >= 15 && v <= 35;   // longitudes around Latvia
const isLksLike = (v) => v !== null && Math.abs(v) >= 50000 && Math.abs(v) <= 2000000;

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
 * { delimiter, newline, rows, header, data, width, mode, northIndex, eastIndex, latIndex, lonIndex }
 * mode is 'lks' (X/Y in metres) or 'wgs' (latitude/longitude in degrees), detected from column
 * names and values; the four indexes are the best guesses for each mode (-1 when unknown).
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
  let [northIndex, eastIndex] = header ? guessColumns(header, ["north", "east"]) : [-1, -1];
  let [latIndex, lonIndex] = header ? guessColumns(header, ["lat", "lon"]) : [-1, -1];

  const stats = Array.from({ length: width }, (_, i) => ({
    lks: columnValues(data, i, parseNumber), deg: columnValues(data, i, parseDegrees),
  }));
  const lksCol = (i) => i >= 0 && stats[i].lks.share >= 0.5 && isLksLike(stats[i].lks.median);
  const latCol = (i) => i >= 0 && stats[i].deg.share >= 0.5 && isLatLike(stats[i].deg.median);
  const lonCol = (i) => i >= 0 && stats[i].deg.share >= 0.5 && isLonLike(stats[i].deg.median);

  let mode = "lks";
  if (lksCol(northIndex) && lksCol(eastIndex)) {
    mode = "lks";
  } else if (latIndex >= 0 && lonIndex >= 0 && (latCol(latIndex) || lonCol(latIndex))) {
    mode = "wgs";
  } else if (northIndex >= 0 && eastIndex >= 0 && [northIndex, eastIndex].every((i) => latCol(i) || lonCol(i))) {
    // columns named X/Y that hold degrees (GIS exports): decide by the values
    mode = "wgs";
    [latIndex, lonIndex] = latCol(eastIndex) && lonCol(northIndex) ? [eastIndex, northIndex] : [northIndex, eastIndex];
  } else {
    // no usable names: look at the values of every column
    const lks = stats.map((_, i) => i).filter(lksCol);
    const lats = stats.map((_, i) => i).filter(latCol);
    const lons = stats.map((_, i) => i).filter((i) => lonCol(i) && !lats.includes(i));
    if (lks.length === 2 && (northIndex < 0 || eastIndex < 0)) {
      // X (northing, ~170 000-440 000) is the smaller one in Latvia
      [northIndex, eastIndex] = stats[lks[0]].lks.median <= stats[lks[1]].lks.median ? lks : [lks[1], lks[0]];
    } else if (!lks.length && lats.length === 1 && lons.length === 1) {
      mode = "wgs";
      [latIndex, lonIndex] = [lats[0], lons[0]];
    }
  }
  return { delimiter: delim, newline, rows, header, data, width, mode, northIndex, eastIndex, latIndex, lonIndex };
}

// --- position check ------------------------------------------------------------

const NEAR_KM = 0.05; // within this distance of the outline counts as in Latvia (data accuracy)
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
 * 'in' includes points up to 50 m outside (the outline is accurate to about 10 m);
 * 'near' is 50 m - 25 km outside (across the border or at sea); 'far' is further.
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

/** '135 m', '1.4 km', '377 km' */
export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

// --- conversion ---------------------------------------------------------------

/**
 * Convert analysed data.
 * options: mode ('lks' | 'wgs'), northIndex/eastIndex (mode lks) or latIndex/lonIndex (mode wgs),
 *          swap ('auto'|'yes'|'no'), decimal ('auto'|'dot'|'comma'), decimals,
 *          outDelimiter (default: the input's separator)
 * Mode lks adds wgs84_lat / wgs84_lon; mode wgs adds lks_x / lks_y (X northing, Y easting).
 * Returns { outRows, stats, messages, swapped, decimalComma, delimiter, mode, added, results }.
 * results[i] = { line, row, lat, lon, x, y, status: 'in'|'near'|'far'|'invalid', km, note }
 */
export function convert(info, {
  mode = "lks", northIndex = -1, eastIndex = -1, latIndex = -1, lonIndex = -1,
  swap = "auto", decimal = "auto", decimals = null, outDelimiter = null,
} = {}) {
  const wgs = mode === "wgs";
  const [ia, ib] = wgs ? [latIndex, lonIndex] : [northIndex, eastIndex];
  if (ia < 0 || ib < 0) {
    throw new Error(wgs ? "Choose the latitude and longitude columns." : "Choose the X (northing) and Y (easting) columns.");
  }
  if (ia === ib) throw new Error(wgs ? "Latitude and longitude must be different columns." : "X and Y must be different columns.");
  const { header, data } = info;
  const delimiter = outDelimiter || info.delimiter;
  const firstLine = header ? 2 : 1;
  const parse = wgs ? parseDegrees : parseNumber;
  let usedComma = false;
  const parsed = data.map((row) => {
    if (!row.some((c) => c.trim())) return "blank";
    const a = parse(row[ia]);
    const b = parse(row[ib]);
    usedComma = usedComma || a.comma || b.comma;
    return a.value !== null && b.value !== null ? [a.value, b.value] : null;
  });
  const valid = parsed.filter((p) => Array.isArray(p));
  if (!wgs && valid.length && valid.every(([n, e]) => Math.abs(n) <= 90 && Math.abs(e) <= 180)) {
    throw new Error("These columns look like degrees, not LKS coordinates in metres: choose latitude/longitude as the input.");
  }
  if (wgs && valid.length && valid.every(([la, lo]) => Math.abs(la) > 90 || Math.abs(lo) > 180)) {
    throw new Error("These columns look like LKS coordinates in metres, not degrees: choose LKS X/Y as the input.");
  }

  // [lat, lon] of a parsed pair, in the given order or swapped
  const toLatLon = wgs ? (p, swapPair) => (swapPair ? [p[1], p[0]] : [p[0], p[1]])
    : (p, swapPair) => (swapPair ? lksToWgs84(p[1], p[0]) : lksToWgs84(p[0], p[1]));
  const messages = [];
  let swapped = swap === "yes";
  if (swap === "auto" && valid.length) {
    const share = (sw) => valid.filter((p) => inLatvia(...toLatLon(p, sw))).length / valid.length;
    if (share(false) < 0.5 && share(true) >= 0.9) {
      swapped = true;
      const names = header ? [header[ia], header[ib]] : [ia + 1, ib + 1];
      messages.push({ level: "note", text: wgs
        ? `“${names[0]}” holds longitudes and “${names[1]}” latitudes in this file `
          + "(only that order puts the points in Latvia), so the two were swapped."
        : `“${names[0]}” holds eastings and “${names[1]}” northings in this file `
          + "(only that order puts the points in Latvia), so the two were swapped." });
    }
  }

  // decimal comma only where it cannot clash with the separator, unless asked for explicitly
  const decimalComma = decimal === "comma" || (decimal === "auto" && usedComma && delimiter !== ",");
  const places = decimals ?? (wgs ? 2 : 7);
  const added = wgs ? ["lks_x", "lks_y"] : ["wgs84_lat", "wgs84_lon"];

  const stats = { rows: 0, converted: 0, skipped: 0, near: 0, far: 0, duplicates: 0, swappedRows: 0 };
  const results = [];
  const seen = new Map(); // coordinates -> first line
  const outRows = header ? [[...header, ...added]] : [];
  data.forEach((row, i) => {
    const line = firstLine + i;
    const p = parsed[i];
    if (p === "blank") { outRows.push(row); return; }
    stats.rows++;
    if (p === null) {
      stats.skipped++;
      messages.push({ level: "warn", line, text: "no valid coordinates, left empty" });
      outRows.push([...row, "", ""]);
      results.push({ line, row, lat: null, lon: null, x: null, y: null, status: "invalid", km: null, note: "no valid coordinates" });
      return;
    }
    const [lat, lon] = toLatLon(p, swapped);
    const [x, y] = wgs ? wgs84ToLks(lat, lon) : (swapped ? [p[1], p[0]] : p);
    const where = locate(lat, lon);
    const notes = [];
    if (where.status !== "in") {
      stats[where.status]++;
      const dist = formatDistance(where.km);
      notes.push(where.status === "near"
        ? `${dist} outside Latvia (across the border or at sea)`
        : `${dist} outside Latvia, check the input`);
      if (locate(...toLatLon(p, !swapped)).status === "in") {
        stats.swappedRows++;
        notes.push(wgs ? "latitude and longitude look swapped on this line" : "X and Y look swapped on this line");
      }
    }
    const key = `${p[0]}|${p[1]}`;
    if (seen.has(key)) {
      stats.duplicates++;
      notes.push(`same coordinates as line ${seen.get(key)}`);
    } else seen.set(key, line);
    if (notes.length) messages.push({ level: where.status === "far" ? "bad" : "warn", line, text: notes.join("; ") });
    stats.converted++;
    const out = wgs ? [x, y] : [lat, lon];
    outRows.push([...row, formatNumber(out[0], places, decimalComma), formatNumber(out[1], places, decimalComma)]);
    results.push({ line, row, lat, lon, x, y, status: where.status, km: where.km, note: notes.join("; ") });
  });
  return { outRows, stats, messages, swapped, decimalComma, delimiter, mode: wgs ? "wgs" : "lks", added, results };
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
    if (result.mode === "wgs") {
      properties.lks_x = Number(r.x.toFixed(2));
      properties.lks_y = Number(r.y.toFixed(2));
    }
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
