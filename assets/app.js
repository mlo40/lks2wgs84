import {
  analyse, convert, decodeBytes, encodeText, inLatvia, lksToWgs84, locate, parseNumber,
  toGeoJSON, toKML, writeCsv,
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

function renderPoint() {
  const out = $("pt-result");
  const x = parseNumber($("pt-x").value);
  const y = parseNumber($("pt-y").value);
  if (x.value === null || y.value === null) {
    out.innerHTML = '<span class="muted">Enter X and Y to see the WGS84 position.</span>';
    return;
  }
  const [lat, lon] = lksToWgs84(x.value, y.value);
  const text = `${lat.toFixed(7)}, ${lon.toFixed(7)}`;
  const osm = `https://www.openstreetmap.org/?mlat=${lat.toFixed(7)}&mlon=${lon.toFixed(7)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}`;
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(7)},${lon.toFixed(7)}`;
  out.replaceChildren();
  const copy = el("button", "", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }
    catch { copy.textContent = "Copy failed"; }
    setTimeout(() => { copy.textContent = "Copy"; }, 1500);
  });
  out.append(el("span", "coords", text), copy, link(osm, "OpenStreetMap"), link(gmaps, "Google Maps"));
  const where = locate(lat, lon);
  if (where.status !== "in") {
    const km = where.km < 10 ? where.km.toFixed(1) : Math.round(where.km);
    const hint = el("span", "warn", `${km} km outside Latvia. `);
    if (locate(...lksToWgs84(y.value, x.value)).status === "in") {
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

const mapState = { map: null, layer: null, markers: new Map(), hidden: false, loading: null };

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
        + ' | border: <a href="https://www.naturalearthdata.com/">Natural Earth</a>',
    }).addTo(mapState.map);
    L.polygon(LATVIA_BORDER.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => [lat, lon]))), {
      color: "#9e1b32", weight: 2, dashArray: "6 4", fillColor: "#9e1b32", fillOpacity: 0.04,
      interactive: false,
    }).addTo(mapState.map);
    mapState.layer = L.featureGroup().addTo(mapState.map);
    mapState.map.setView([56.88, 24.6], 7);
  }
  return mapState.map;
}

function popupFor(result) {
  const { info } = state;
  const northIndex = Number($("opt-x").value);
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
  box.append(el("div", "", `X ${result.row[northIndex]}   Y ${result.row[eastIndex]}`));
  box.append(el("div", "popup-coords", `${result.lat.toFixed(7)}, ${result.lon.toFixed(7)}`));
  if (result.note) box.append(el("div", "popup-warn", result.note));
  return box;
}

async function drawPoints() {
  const legend = $("map-legend");
  if (mapState.hidden || !state.result) return;
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
    legend.append("Click a point for its row, or a row or problem below to find its point.");
    const bounds = mapState.layer.getBounds();
    if (points.length === 1) map.setView(bounds.getCenter(), 15);
    else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  }
  $("preview").classList.toggle("map-on", points.length > 0);
}

function focusPoint(line) {
  const marker = !mapState.hidden && mapState.markers.get(line);
  if (!marker) return;
  mapState.map.setView(marker.getLatLng(), Math.max(mapState.map.getZoom(), 15));
  marker.openPopup();
  $("map").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function toggleMap() {
  mapState.hidden = !mapState.hidden;
  $("map").hidden = mapState.hidden;
  $("map-legend").hidden = mapState.hidden;
  $("map-toggle").textContent = mapState.hidden ? "Show map" : "Hide map";
  $("map-toggle").setAttribute("aria-expanded", String(!mapState.hidden));
  if (!mapState.hidden) drawPoints();
}

// --- CSV -----------------------------------------------------------------------

const state = { name: null, decoded: null, info: null, result: null };

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
  $("only-problems").checked = false;
  reanalyse();
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
  const labels = Array.from({ length: info.width }, (_, i) =>
    (info.header && info.header[i] ? info.header[i] : `Column ${i + 1}`));
  for (const [select, guess] of [[$("opt-x"), info.northIndex], [$("opt-y"), info.eastIndex]]) {
    select.replaceChildren(el("option", "", "– choose –"));
    select.firstChild.value = "-1";
    labels.forEach((label, i) => {
      const opt = el("option", "", label);
      opt.value = String(i);
      select.append(opt);
    });
    select.value = String(guess);
  }
  const encoding = state.decoded.encoding === "utf-8" ? (state.decoded.bom ? "UTF-8 with BOM" : "UTF-8") : "Windows-1257";
  const sep = { ";": "semicolon", ",": "comma", "\t": "tab", "|": "pipe" }[info.delimiter];
  $("file-info").textContent = `${state.name}: ${info.data.length} data rows, ${sep}-separated, ${encoding}, `
    + `${info.newline === "\r\n" ? "Windows" : "Unix"} line endings.`;
  $("csv-panel").hidden = false;
  reconvert();
}

function reconvert() {
  showError("");
  state.result = null;
  $("download").disabled = true;
  const northIndex = Number($("opt-x").value);
  const eastIndex = Number($("opt-y").value);
  if (northIndex < 0 || eastIndex < 0) {
    renderResult(null, "Choose which columns hold X (northing) and Y (easting).");
    return;
  }
  try {
    state.result = convert(state.info, {
      northIndex, eastIndex, swap: $("opt-swap").value,
      decimal: $("opt-decimal").value, outDelimiter: $("opt-outsep").value || null,
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
  if (stats.swappedRows) part("warn", `${stats.swappedRows} with X/Y swapped?`);
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
    const label = head ? (head[i] ?? "") : (i >= width - 2 ? ["wgs84_lat", "wgs84_lon"][i - width + 2] : `${i + 1}`);
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
  $("csv-panel").hidden = true;
  showError(err.message || String(err));
}

// --- export --------------------------------------------------------------------

function exportName() {
  const format = $("opt-format").value;
  const dot = state.name.lastIndexOf(".");
  const stem = dot > 0 ? state.name.slice(0, dot) : state.name;
  const ext = format === "csv" ? (dot > 0 ? state.name.slice(dot) : ".csv") : `.${format}`;
  return `${stem}_wgs84${ext}`;
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
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file).catch(fail);
});
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file-input").click(); }
});
$("example").addEventListener("click", () => loadBytes("example.csv", new TextEncoder().encode(EXAMPLE)));
$("opt-delimiter").addEventListener("change", reanalyse);
$("opt-header").addEventListener("change", reanalyse);
for (const id of ["opt-x", "opt-y", "opt-swap", "opt-decimal", "opt-outsep"]) $(id).addEventListener("change", reconvert);
$("opt-format").addEventListener("change", updateExport);
$("only-problems").addEventListener("change", () => { if (state.result) renderPreview(state.result); });
$("download").addEventListener("click", download);
$("map-toggle").addEventListener("click", toggleMap);
