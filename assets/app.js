import {
  analyse, convert, decodeBytes, encodeText, formatDistance, inLatvia, lksToWgs84, locate, parseDegrees, parseNumber,
  toGeoJSON, toKML, wgs84ToLks, writeCsv,
} from "./lks.js";
import { LATVIA_BORDER } from "./latvia.js";

const $ = (id) => document.getElementById(id);
const PREVIEW_ROWS = 25;
const MAX_MESSAGES = 300;
const COLORS = { in: "#1e9e55", near: "#e8890c", far: "#d0263c" };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href, text) {
  const a = el("a", "", text);
  a.href = href; a.target = "_blank"; a.rel = "noopener";
  return a;
}

// --- single point --------------------------------------------------------------

/** Read the two single-point fields: LKS X/Y (metres) or lat/long (degrees, either order). */
function readPoint() {
  const a = $("pt-x").value;
  const b = $("pt-y").value;
  const da = parseDegrees(a).value;
  const db = parseDegrees(b).value;
  if (da !== null && db !== null && Math.abs(da) <= 90 && Math.abs(db) <= 180) {
    // degrees; around Latvia latitude (55-58) is larger than longitude (21-28)
    const swapped = da < db && Math.abs(db) <= 90 && inLatvia(db, da) && !inLatvia(da, db);
    const [lat, lon] = swapped ? [db, da] : [da, db];
    const [x, y] = wgs84ToLks(lat, lon);
    return { kind: "wgs", lat, lon, x, y, swapped };
  }
  const x = parseNumber(a).value;
  const y = parseNumber(b).value;
  if (x === null || y === null) return null;
  const [lat, lon] = lksToWgs84(x, y);
  return { kind: "lks", lat, lon, x, y, swapped: false };
}

function copyButton(text) {
  const copy = el("button", "", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }
    catch { copy.textContent = "Copy failed"; }
    setTimeout(() => { copy.textContent = "Copy"; }, 1500);
  });
  return copy;
}

function renderPoint() {
  const out = $("pt-result");
  const pt = readPoint();
  if (!pt) {
    out.innerHTML = '<span class="muted">Enter LKS X/Y or WGS84 latitude/longitude. The other system is shown here.</span>';
    showSinglePoint(null);
    return;
  }
  showSinglePoint(pt);
  const { lat, lon, x, y } = pt;
  const latlon = `${lat.toFixed(7)}, ${lon.toFixed(7)}`;
  const xy = `X ${x.toFixed(2)}  Y ${y.toFixed(2)}`;
  const osm = `https://www.openstreetmap.org/?mlat=${lat.toFixed(7)}&mlon=${lon.toFixed(7)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}`;
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(7)},${lon.toFixed(7)}`;
  out.replaceChildren();
  if (pt.kind === "lks") {
    out.append(el("span", "muted", "WGS84"), el("span", "coords", latlon), copyButton(latlon));
  } else {
    out.append(el("span", "muted", "LKS"), el("span", "coords", xy), copyButton(`${x.toFixed(2)}\t${y.toFixed(2)}`));
    if (pt.swapped) out.append(el("span", "muted small", "(read as longitude, latitude)"));
  }
  out.append(link(osm, "OpenStreetMap"), link(gmaps, "Google Maps"));
  const where = locate(lat, lon);
  if (where.status !== "in") {
    const hint = el("span", "warn", `${formatDistance(where.km)} outside Latvia. `);
    if (pt.kind === "lks" && locate(...lksToWgs84(y, x)).status === "in") {
      const swap = el("button", "link", "Swap X and Y?");
      swap.type = "button";
      swap.addEventListener("click", () => {
        [$("pt-x").value, $("pt-y").value] = [$("pt-y").value, $("pt-x").value];
        renderPoint();
      });
      hint.append(swap);
    } else if (!inLatvia(lat, lon)) {
      hint.append("Check the numbers.");
    }
    out.append(hint);
  }
}

$("pt-x").addEventListener("input", renderPoint);
$("pt-y").addEventListener("input", renderPoint);

// --- map -------------------------------------------------------------------------

const mapState = { map: null, layer: null, pointLayer: null, markers: new Map(), loading: null };
const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (mapState.loading) return mapState.loading;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "assets/vendor/leaflet/leaflet.css";
  document.head.append(css);
  mapState.loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "assets/vendor/leaflet/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("The map library could not be loaded."));
    document.head.append(script);
  });
  return mapState.loading;
}

async function ensureMap() {
  const L = await loadLeaflet();
  if (!mapState.map) {
    mapState.map = L.map("map", { preferCanvas: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        + ' | border: Geoportal of Latvia via <a href="https://www.geoboundaries.org/">geoBoundaries</a> (CC BY 4.0)',
    }).addTo(mapState.map);
    L.polygon(LATVIA_BORDER.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => [lat, lon]))), {
      color: "#9e1b32", weight: 2, dashArray: "6 4", fillColor: "#9e1b32", fillOpacity: 0.04,
      interactive: false,
    }).addTo(mapState.map);
    mapState.layer = L.featureGroup().addTo(mapState.map);
    mapState.pointLayer = L.featureGroup().addTo(mapState.map);
    mapState.map.fitBounds([[55.67, 20.97], [58.08, 28.24]], fitOptions());
  }
  return mapState.map;
}

/** Padding that keeps fitted points clear of the floating windows. */
function fitOptions(maxZoom = 16) {
  if (isPhone()) return { padding: [20, 20], maxZoom };
  const wide = window.innerWidth > 1150;
  const table = $("win-table");
  const bottom = wide && !table.hidden ? table.getBoundingClientRect().height + 50 : 24;
  return { paddingTopLeft: [376, 24], paddingBottomRight: [wide && !$("win-check").hidden ? 376 : 24, bottom], maxZoom };
}

/** Show the single point (blue) on the map; null removes it. */
async function showSinglePoint(pt) {
  const map = await ensureMap().catch(() => null);
  if (!map) return;
  mapState.pointLayer.clearLayers();
  if (!pt) return;
  const box = el("div");
  box.append(el("div", "popup-line", "Single point"));
  box.append(el("div", "popup-coords", `X ${pt.x.toFixed(2)}  Y ${pt.y.toFixed(2)}`));
  box.append(el("div", "popup-coords", `${pt.lat.toFixed(7)}, ${pt.lon.toFixed(7)}`));
  window.L.circleMarker([pt.lat, pt.lon], {
    radius: 8, color: "#ffffff", weight: 2, fillColor: "#2563eb", fillOpacity: 1,
  }).bindPopup(box).addTo(mapState.pointLayer);
  map.fitBounds(window.L.latLng(pt.lat, pt.lon).toBounds(1500), fitOptions());
}

function popupFor(result) {
  const { info } = state;
  const northIndex = Number($("opt-x").value);   // the two coordinate columns of the input
  const eastIndex = Number($("opt-y").value);
  const box = el("div");
  box.append(el("div", "popup-line", `Line ${result.line}`));
  let shown = 0;
  result.row.forEach((value, i) => {
    if (i === northIndex || i === eastIndex || !String(value).trim() || shown >= 4) return;
    const name = info.header && info.header[i] ? info.header[i] : `Column ${i + 1}`;
    box.append(el("div", "", `${name}: ${value}`));
    shown++;
  });
  box.append(el("div", "popup-coords", `X ${result.x.toFixed(2)}  Y ${result.y.toFixed(2)}`));
  box.append(el("div", "popup-coords", `${result.lat.toFixed(7)}, ${result.lon.toFixed(7)}`));
  if (result.note) box.append(el("div", "popup-warn", result.note));
  return box;
}

async function drawPoints({ fit = true } = {}) {
  const legend = $("map-legend");
  if (!state.result) { await ensureMap().catch(() => null); return; }
  let map;
  try {
    map = await ensureMap();
  } catch (err) {
    legend.textContent = err.message;
    return;
  }
  map.invalidateSize();
  const L = window.L;
  mapState.layer.clearLayers();
  mapState.markers.clear();
  const points = state.result.results.filter((r) => r.lat !== null);
  // line through the points in file order, under the points: a wrong point shows up as a spike
  if ($("map-line").checked && points.length > 1) {
    L.polyline(points.map((r) => [r.lat, r.lon]), {
      color: "#2563eb", weight: 2, opacity: 0.7, interactive: false,
    }).addTo(mapState.layer);
  }
  // draw problems last so they sit on top
  const order = { in: 0, near: 1, far: 2 };
  for (const r of [...points].sort((a, b) => order[a.status] - order[b.status])) {
    const marker = L.circleMarker([r.lat, r.lon], {
      radius: r.status === "in" ? 5 : 7, color: "#ffffff", weight: 1.5,
      fillColor: COLORS[r.status], fillOpacity: 0.95,
    }).bindPopup(() => popupFor(r));
    marker.addTo(mapState.layer);
    mapState.markers.set(r.line, marker);
  }
  legend.replaceChildren();
  if (!points.length) {
    legend.textContent = "No converted points to show.";
  } else {
    legend.append("Click a point for its row, or a row or problem to find its point.");
    const bounds = mapState.layer.getBounds();
    if (!fit) { /* keep the current view */ }
    else if (points.length === 1) map.fitBounds(bounds.getCenter().toBounds(1500), fitOptions());
    else map.fitBounds(bounds, fitOptions());
  }
  $("preview").classList.toggle("map-on", points.length > 0);
}

function focusPoint(line) {
  const marker = mapState.markers.get(line);
  if (!marker) return;
  mapState.map.fitBounds(marker.getLatLng().toBounds(1200), fitOptions(Math.max(mapState.map.getZoom(), 15)));
  marker.openPopup();
  if (isPhone()) window.scrollTo({ top: 0, behavior: "smooth" });
}

// --- CSV -----------------------------------------------------------------------

const state = { name: null, decoded: null, info: null, result: null };

function setLoaded(loaded) {
  for (const node of document.querySelectorAll(".needs-file")) node.hidden = !loaded;
}

function showError(message) {
  $("csv-error").textContent = message;
  $("csv-error").hidden = !message;
}

async function loadFile(file) {
  loadBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

function loadBytes(name, bytes) {
  showError("");
  state.name = name;
  state.decoded = decodeBytes(bytes);
  $("opt-delimiter").value = "";
  $("opt-header").checked = true;
  $("opt-swap").value = "auto";
  $("opt-mode").value = "auto";
  $("only-problems").checked = false;
  reanalyse();
}

/** The input system in use: the user's choice, or what the file looks like. */
function currentMode() {
  const chosen = $("opt-mode").value;
  return chosen === "auto" ? state.info.mode : chosen;
}

/** Fill the two column pickers for the current mode and preselect the guessed columns. */
function fillColumnPickers() {
  const { info } = state;
  const wgs = currentMode() === "wgs";
  $("lbl-x").innerHTML = wgs ? "Latitude column" : 'X column <span class="hint">northing</span>';
  $("lbl-y").innerHTML = wgs ? "Longitude column" : 'Y column <span class="hint">easting</span>';
  $("lbl-swap").textContent = wgs ? "Lat/long order" : "X/Y order";
  $("fmt-csv").textContent = wgs ? "CSV: the file with lks_x / lks_y added" : "CSV: the file with wgs84_lat / wgs84_lon added";
  const guesses = wgs ? [info.latIndex, info.lonIndex] : [info.northIndex, info.eastIndex];
  const labels = Array.from({ length: info.width }, (_, i) =>
    (info.header && info.header[i] ? info.header[i] : `Column ${i + 1}`));
  [$("opt-x"), $("opt-y")].forEach((select, k) => {
    select.replaceChildren(el("option", "", "– choose –"));
    select.firstChild.value = "-1";
    labels.forEach((label, i) => {
      const opt = el("option", "", label);
      opt.value = String(i);
      select.append(opt);
    });
    select.value = String(guesses[k]);
  });
}

function reanalyse() {
  showError("");
  try {
    state.info = analyse(state.decoded.text, {
      delimiter: $("opt-delimiter").value || null,
      noHeader: !$("opt-header").checked,
    });
  } catch (err) {
    fail(err);
    return;
  }
  const { info } = state;
  fillColumnPickers();
  const encoding = state.decoded.encoding === "utf-8" ? (state.decoded.bom ? "UTF-8 with BOM" : "UTF-8") : "Windows-1257";
  const sep = { ";": "semicolon", ",": "comma", "\t": "tab", "|": "pipe" }[info.delimiter];
  $("file-info").textContent = `${state.name}: ${info.data.length} data rows, ${sep}-separated, ${encoding}, `
    + `${info.newline === "\r\n" ? "Windows" : "Unix"} line endings, `
    + `${info.mode === "wgs" ? "latitude/longitude" : "LKS X/Y"} coordinates.`;
  setLoaded(true);
  reconvert();
}

function reconvert() {
  showError("");
  state.result = null;
  $("download").disabled = true;
  const first = Number($("opt-x").value);
  const second = Number($("opt-y").value);
  const mode = currentMode();
  if (first < 0 || second < 0) {
    renderResult(null, mode === "wgs" ? "Choose which columns hold latitude and longitude."
      : "Choose which columns hold X (northing) and Y (easting).");
    return;
  }
  try {
    state.result = convert(state.info, {
      mode, northIndex: first, eastIndex: second, latIndex: first, lonIndex: second,
      swap: $("opt-swap").value, decimal: $("opt-decimal").value, outDelimiter: $("opt-outsep").value || null,
    });
  } catch (err) {
    renderResult(null, err.message);
    return;
  }
  renderResult(state.result);
  updateExport();
  drawPoints();
}

function renderResult(result, problem) {
  const summary = $("summary");
  summary.replaceChildren();
  $("messages").replaceChildren();
  $("messages-box").hidden = true;
  $("preview").replaceChildren();
  $("preview-note").textContent = "";
  if (!result) {
    summary.append(el("span", "warn", problem));
    if (mapState.layer) mapState.layer.clearLayers();
    mapState.markers.clear();
    $("map-legend").textContent = "";
    updateExport();
    return;
  }
  const { stats, messages } = result;
  const inside = stats.converted - stats.near - stats.far;
  const part = (cls, text, dot) => {
    const span = el("span", `part ${cls}`, text);
    if (dot) span.prepend(el("span", `dot ${dot}`));
    summary.append(span, " ");
  };
  part("", `${stats.rows} rows:`);
  part("ok", `${inside} in Latvia`, "in");
  if (stats.near) part("warn", `${stats.near} near Latvia`, "near");
  if (stats.far) part("bad", `${stats.far} far outside`, "far");
  if (stats.skipped) part("warn", `${stats.skipped} without valid coordinates`);
  if (stats.swappedRows) part("warn", `${stats.swappedRows} with ${result.mode === "wgs" ? "lat/long" : "X/Y"} swapped?`);
  if (stats.duplicates) part("warn", `${stats.duplicates} duplicate${stats.duplicates === 1 ? "" : "s"}`);
  if (!stats.near && !stats.far && !stats.skipped && !stats.duplicates) part("ok", "✓ no problems found");

  if (messages.length) {
    const box = $("messages-box");
    box.hidden = false;
    box.open = true;
    const problems = messages.filter((m) => m.line).length;
    $("messages-title").textContent = problems ? `Problems (${problems})` : "Notes";
    for (const m of messages.slice(0, MAX_MESSAGES)) {
      const item = el("li", m.level, m.line ? `Line ${m.line}: ${m.text}` : m.text);
      if (m.line && result.results.some((r) => r.line === m.line && r.lat !== null)) {
        item.classList.add("jump");
        item.title = "Show on the map";
        item.addEventListener("click", () => focusPoint(m.line));
      }
      $("messages").append(item);
    }
    if (messages.length > MAX_MESSAGES) {
      $("messages").append(el("li", "note", `… and ${messages.length - MAX_MESSAGES} more`));
    }
  }
  renderPreview(result);
}

function renderPreview(result) {
  const { info } = state;
  const table = $("preview");
  table.replaceChildren();
  const byLine = new Map(result.results.map((r) => [r.line, r]));
  const head = info.header ? result.outRows[0] : null;
  const firstLine = info.header ? 2 : 1;
  let body = (info.header ? result.outRows.slice(1) : result.outRows).map((row, i) => ({ row, line: firstLine + i }));
  const onlyProblems = $("only-problems").checked;
  if (onlyProblems) {
    body = body.filter(({ line }) => byLine.has(line) && (byLine.get(line).status !== "in" || byLine.get(line).note));
  }
  const width = Math.max(...result.outRows.map((r) => r.length));
  const newCols = new Set([width - 2, width - 1]);
  const hr = el("tr");
  hr.append(el("th", "line", "line"));
  for (let i = 0; i < width; i++) {
    const label = head ? (head[i] ?? "") : (i >= width - 2 ? result.added[i - width + 2] : `${i + 1}`);
    hr.append(el("th", newCols.has(i) ? "new" : "", label));
  }
  const thead = el("thead");
  thead.append(hr);
  const tbody = el("tbody");
  for (const { row, line } of body.slice(0, PREVIEW_ROWS)) {
    const r = byLine.get(line);
    const cls = !r ? "" : r.status === "far" ? "bad" : (r.status !== "in" || r.note) ? "warn" : "";
    const tr = el("tr", cls);
    tr.addEventListener("click", () => focusPoint(line));
    tr.append(el("td", "line", String(line)));
    for (let i = 0; i < width; i++) {
      tr.append(el("td", newCols.has(i) && row.length === width ? "new num" : "", row[i] ?? ""));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  if (!body.length) {
    $("preview-note").textContent = onlyProblems ? "No rows with problems." : "";
  } else if (body.length > PREVIEW_ROWS) {
    $("preview-note").textContent = `Showing ${PREVIEW_ROWS} of ${body.length} rows. The export contains all rows.`;
  } else {
    $("preview-note").textContent = `${body.length} row${body.length === 1 ? "" : "s"}`;
  }
}

function fail(err) {
  state.info = null;
  state.result = null;
  setLoaded(false);
  showError(err.message || String(err));
}

// --- export --------------------------------------------------------------------

function exportName() {
  const format = $("opt-format").value;
  const dot = state.name.lastIndexOf(".");
  const stem = dot > 0 ? state.name.slice(0, dot) : state.name;
  const ext = format === "csv" ? (dot > 0 ? state.name.slice(dot) : ".csv") : `.${format}`;
  const suffix = state.result && state.result.mode === "wgs" && format === "csv" ? "_lks" : "_wgs84";
  return `${stem}${suffix}${ext}`;
}

function updateExport() {
  const csv = $("opt-format").value === "csv";
  for (const node of document.querySelectorAll(".csv-only")) node.hidden = !csv;
  $("download").disabled = !state.result;
  $("download-name").textContent = state.result ? exportName() : "";
}

function download() {
  if (!state.result) return;
  const { info, result } = state;
  const format = $("opt-format").value;
  let bytes;
  let type;
  if (format === "csv") {
    const text = writeCsv(result.outRows, result.delimiter, info.newline);
    bytes = encodeText(text, state.decoded.encoding, state.decoded.bom);
    type = state.decoded.encoding === "utf-8" ? "text/csv;charset=utf-8" : "text/csv;charset=windows-1257";
  } else if (format === "geojson") {
    bytes = new TextEncoder().encode(toGeoJSON(info, result));
    type = "application/geo+json";
  } else {
    bytes = new TextEncoder().encode(toKML(info, result, {
      northIndex: Number($("opt-x").value), eastIndex: Number($("opt-y").value), title: state.name,
    }));
    type = "application/vnd.google-earth.kml+xml";
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el("a");
  a.href = url;
  a.download = exportName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- wiring --------------------------------------------------------------------

const EXAMPLE = "\ufeffNosaukums;X;Y;Piezīmes\r\n"
  + "Brīvības piemineklis;311 980,51;506 893,71;Rīga\r\n"
  + "Daugavpils cietoksnis;197 720,39;656 042,57;\r\n"
  + "Liepājas bāka;267 198,50;316 173,00;\r\n"
  + "Ventspils osta;364 275,95;353 408,13;\r\n"
  + "X un Y samainīti;506 893,71;311 980,51;kļūda\r\n"
  + "Biržai (Lietuva);228 719,61;546 960,26;pāri robežai\r\n"
  + "Pārrakstīšanās kļūda;811 980,51;506 893,71;kļūda\r\n"
  + "Dublikāts;311 980,51;506 893,71;\r\n"
  + "Bez koordinātām;;;tukšs\r\n";

$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file).catch(fail);
  e.target.value = "";
});
$("drop").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file-input").click(); }
});
// a file can be dropped anywhere on the page
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; $("drop-veil").hidden = false; } });
window.addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $("drop-veil").hidden = true; } });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("drop-veil").hidden = true;
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file).catch(fail);
});

// windows: collapse with the arrow, drag by the title bar, double-click the title bar to dock again
for (const win of document.querySelectorAll(".win")) {
  const head = win.querySelector(".win-head");
  win.querySelector(".win-min").addEventListener("click", () => win.classList.toggle("collapsed"));
  head.addEventListener("dblclick", (e) => {
    if (e.target.closest(".win-min")) return;
    win.classList.remove("floating");
    win.style.cssText = "";
  });
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".win-min") || isPhone()) return;
    const rect = win.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!moved) {
        moved = true;
        win.style.width = `${rect.width}px`;
        win.classList.add("floating", "dragging");
      }
      const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - 60);
      const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 36);
      win.style.left = `${left}px`;
      win.style.top = `${top}px`;
    };
    const up = () => {
      win.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

const EXAMPLE_WGS = "\ufeffNosaukums;Platums;Garums\r\n"
  + "Brīvības piemineklis;56,951389;24,113333\r\n"
  + "Daugavpils cietoksnis;55°53'58.6\"N;26°29'44.9\"E\r\n"
  + "Liepājas bāka;56,5132;21,0123\r\n"
  + "Garums un platums samainīti;24,113333;56,951389\r\n"
  + "Biržai (Lietuva);56,2011;24,7569\r\n";

$("example").addEventListener("click", () => loadBytes("example.csv", new TextEncoder().encode(EXAMPLE)));
$("example-wgs").addEventListener("click", () => loadBytes("example_latlong.csv", new TextEncoder().encode(EXAMPLE_WGS)));
$("opt-mode").addEventListener("change", () => { fillColumnPickers(); reconvert(); });
$("opt-delimiter").addEventListener("change", reanalyse);
$("opt-header").addEventListener("change", reanalyse);
for (const id of ["opt-x", "opt-y", "opt-swap", "opt-decimal", "opt-outsep"]) $(id).addEventListener("change", reconvert);
$("opt-format").addEventListener("change", updateExport);
$("only-problems").addEventListener("change", () => { if (state.result) renderPreview(state.result); });
$("download").addEventListener("click", download);
drawPoints(); // the map is there from the start
$("map-line").addEventListener("change", () => drawPoints({ fit: false }));
