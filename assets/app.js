import {
  analyse, convert, decodeBytes, encodeText, inLatvia, lksToWgs84, parseNumber, writeCsv,
} from "./lks.js";

const $ = (id) => document.getElementById(id);
const PREVIEW_ROWS = 25;
const MAX_MESSAGES = 200;

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
  const coords = el("span", "coords", text);
  const copy = el("button", "", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; }
    catch { copy.textContent = "Copy failed"; }
    setTimeout(() => { copy.textContent = "Copy"; }, 1500);
  });
  out.append(coords, copy, link(osm, "OpenStreetMap"), link(gmaps, "Google Maps"));
  if (!inLatvia(lat, lon)) {
    const [slat, slon] = lksToWgs84(y.value, x.value);
    const hint = el("span", "warn", "This is outside Latvia. ");
    if (inLatvia(slat, slon)) {
      const swap = el("button", "link", "Swap X and Y?");
      swap.type = "button";
      swap.addEventListener("click", () => {
        [$("pt-x").value, $("pt-y").value] = [$("pt-y").value, $("pt-x").value];
        renderPoint();
      });
      hint.append(swap);
    } else {
      hint.append("Check the numbers.");
    }
    out.append(hint);
  }
}

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

$("pt-x").addEventListener("input", renderPoint);
$("pt-y").addEventListener("input", renderPoint);

// --- CSV -----------------------------------------------------------------------

const state = { name: null, decoded: null, info: null, result: null };

function showError(message) {
  $("csv-error").textContent = message;
  $("csv-error").hidden = !message;
}

async function loadFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  loadBytes(file.name, bytes);
}

function loadBytes(name, bytes) {
  showError("");
  state.name = name;
  state.decoded = decodeBytes(bytes);
  $("opt-delimiter").value = "";
  $("opt-header").checked = true;
  $("opt-swap").value = "auto";
  $("opt-decimal").value = "auto";
  reanalyse(true);
}

function reanalyse(guessColumns) {
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
    (info.header && info.header[i] !== undefined && info.header[i] !== "" ? info.header[i] : `Column ${i + 1}`));
  for (const [select, guess] of [[$("opt-x"), info.northIndex], [$("opt-y"), info.eastIndex]]) {
    const previous = select.value;
    select.replaceChildren(el("option", "", "– choose –"));
    select.firstChild.value = "-1";
    labels.forEach((label, i) => {
      const opt = el("option", "", label);
      opt.value = String(i);
      select.append(opt);
    });
    select.value = guessColumns || previous === "" ? String(guess) : previous;
    if (!select.value) select.value = "-1";
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
      northIndex, eastIndex, swap: $("opt-swap").value, decimal: $("opt-decimal").value,
    });
  } catch (err) {
    renderResult(null, err.message);
    return;
  }
  renderResult(state.result);
  $("download").disabled = false;
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
    return;
  }
  const { stats, messages } = result;
  const parts = [`${stats.converted} of ${stats.rows} rows converted`];
  if (stats.skipped) parts.push(`${stats.skipped} without valid coordinates`);
  if (stats.outside) parts.push(`${stats.outside} outside Latvia`);
  summary.append(el("span", stats.skipped || stats.outside ? "warn" : "ok", parts.join(" · ")));

  if (messages.length) {
    $("messages-box").hidden = false;
    $("messages-box").open = messages.length <= 10;
    $("messages-title").textContent = `Messages (${messages.length})`;
    for (const m of messages.slice(0, MAX_MESSAGES)) {
      $("messages").append(el("li", m.level, m.line ? `Line ${m.line}: ${m.text}` : m.text));
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
  const warnLines = new Set(result.messages.filter((m) => m.line).map((m) => m.line));
  const head = info.header ? result.outRows[0] : null;
  const body = info.header ? result.outRows.slice(1) : result.outRows;
  const width = Math.max(...result.outRows.map((r) => r.length));
  const newCols = new Set([width - 2, width - 1]);
  const thead = el("thead");
  const hr = el("tr");
  hr.append(el("th", "line", "line"));
  for (let i = 0; i < width; i++) {
    const label = head ? (head[i] ?? "") : (i >= width - 2 ? ["wgs84_lat", "wgs84_lon"][i - width + 2] : `${i + 1}`);
    hr.append(el("th", newCols.has(i) ? "new" : "", label));
  }
  thead.append(hr);
  const tbody = el("tbody");
  const firstLine = info.header ? 2 : 1;
  body.slice(0, PREVIEW_ROWS).forEach((row, r) => {
    const line = firstLine + r;
    const tr = el("tr", warnLines.has(line) ? "warn" : "");
    tr.append(el("td", "line", String(line)));
    for (let i = 0; i < width; i++) {
      const isNew = newCols.has(i) && row.length === width;
      tr.append(el("td", `${isNew ? "new num" : ""}`, row[i] ?? ""));
    }
    tbody.append(tr);
  });
  table.append(thead, tbody);
  if (body.length > PREVIEW_ROWS) {
    $("preview-note").textContent = `Showing the first ${PREVIEW_ROWS} of ${body.length} rows. The download contains all rows.`;
  }
}

function fail(err) {
  state.info = null;
  state.result = null;
  $("csv-panel").hidden = true;
  showError(err.message || String(err));
}

function download() {
  if (!state.result) return;
  const { info, result } = state;
  const text = writeCsv(result.outRows, info.delimiter, info.newline);
  const bytes = encodeText(text, state.decoded.encoding, state.decoded.bom);
  const type = state.decoded.encoding === "utf-8" ? "text/csv;charset=utf-8" : "text/csv;charset=windows-1257";
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const dot = state.name.lastIndexOf(".");
  const a = el("a");
  a.href = url;
  a.download = dot > 0 ? `${state.name.slice(0, dot)}_wgs84${state.name.slice(dot)}` : `${state.name}_wgs84.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXAMPLE = "﻿Nosaukums;X;Y;Piezīmes\r\n"
  + "Brīvības piemineklis;311 980,51;506 893,71;Rīga\r\n"
  + "Daugavpils;177 900,00;618 500,00;\r\n"
  + "Liepāja;251 200,00;312 500,00;\r\n"
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
$("opt-delimiter").addEventListener("change", () => reanalyse(true));
$("opt-header").addEventListener("change", () => reanalyse(true));
for (const id of ["opt-x", "opt-y", "opt-swap", "opt-decimal"]) $(id).addEventListener("change", reconvert);
$("download").addEventListener("click", download);
