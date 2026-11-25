// Tests for assets/lks.js:  node --test tests/
// Reference coordinates in fixtures.json were computed with PROJ (see its "source" field).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyse, columnKind, convert, decodeBytes, detectDelimiter, encodeText, lksToWgs84, locate,
  parseCsv, parseNumber, toGeoJSON, toKML, writeCsv,
} from "../assets/lks.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const metres = (lat1, lon1, lat2, lon2) =>
  Math.hypot((lat1 - lat2) * 111320, (lon1 - lon2) * 111320 * Math.cos(lat1 * Math.PI / 180));

const run = (text, opts = {}, analyseOpts = {}) => {
  const info = analyse(text, analyseOpts);
  const result = convert(info, { northIndex: info.northIndex, eastIndex: info.eastIndex, ...opts });
  return { info, result, out: writeCsv(result.outRows, info.delimiter, info.newline) };
};

test("matches PROJ for LKS-92 and LKS-2020 (300 points)", () => {
  for (const p of fixtures.points) {
    const [lat, lon] = lksToWgs84(p.x, p.y);
    assert.ok(metres(p.lat, p.lon, lat, lon) < 1e-5, `${p.crs} ${p.x} ${p.y}`);
  }
});

test("Riga Freedom Monument", () => {
  const [lat, lon] = lksToWgs84(311980.51, 506893.71);
  assert.equal(lat.toFixed(6), "56.951389");
  assert.equal(lon.toFixed(6), "24.113333");
});

test("number formats", () => {
  assert.deepEqual(parseNumber("311 980,51"), { value: 311980.51, comma: true });
  assert.deepEqual(parseNumber("311980.51"), { value: 311980.51, comma: false });
  assert.deepEqual(parseNumber("311.980,51"), { value: 311980.51, comma: true });
  assert.deepEqual(parseNumber("311,980.51"), { value: 311980.51, comma: false });
  assert.equal(parseNumber("").value, null);
  assert.equal(parseNumber("abc").value, null);
});

test("delimiter: ';' wins over decimal commas", () => {
  assert.equal(detectDelimiter("X;Y\n311980,51;506893,71\n"), ";");
  assert.equal(detectDelimiter("id,x,y\n1,2,3\n"), ",");
  assert.equal(detectDelimiter("a\tb\n1\t2\n"), "\t");
});

test("CSV reader/writer handle quotes and newlines", () => {
  const rows = parseCsv('a;"b;c";"say ""hi"""\r\n1;"two\nlines";3\r\n', ";");
  assert.deepEqual(rows, [["a", "b;c", 'say "hi"'], ["1", "two\nlines", "3"]]);
  assert.equal(writeCsv(rows, ";", "\r\n"), 'a;"b;c";"say ""hi"""\r\n1;"two\nlines";3\r\n');
});

test("column names", () => {
  for (const n of ["X", "x", "Northing", "N", "lks92_x", "X_LKS2020", "Ziemeli", "x koord"]) assert.equal(columnKind(n), "north", n);
  for (const n of ["Y", "Easting", "E", "lks92_y", "Y_LKS-2020", "Austrumi"]) assert.equal(columnKind(n), "east", n);
  for (const n of ["id", "name", "lat", "Nr"]) assert.equal(columnKind(n), null, n);
});

test("Latvian Excel style file: same separator, decimal comma, BOM kept", () => {
  const bytes = new TextEncoder().encode("﻿Nosaukums;X;Y\r\nBrīvības piemineklis;311 980,51;506 893,71\r\n");
  const decoded = decodeBytes(bytes);
  assert.equal(decoded.bom, true);
  const { out, result } = run(decoded.text);
  assert.equal(out, "Nosaukums;X;Y;wgs84_lat;wgs84_lon\r\nBrīvības piemineklis;311 980,51;506 893,71;56,9513890;24,1133330\r\n");
  assert.equal(result.decimalComma, true);
  const back = encodeText(out, decoded.encoding, decoded.bom);
  assert.deepEqual([...back.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("Windows-1257 file round-trips", () => {
  // "Jēkabpils" in Windows-1257: ē = 0xE7
  const bytes = Uint8Array.from([..."kamera;311980,51;506893,71;J"].map((c) => c.charCodeAt(0))
    .concat([0xe7], [..."kabpils\n"].map((c) => c.charCodeAt(0))));
  const decoded = decodeBytes(bytes);
  assert.equal(decoded.encoding, "windows-1257");
  const info = analyse(decoded.text, { noHeader: true });
  const result = convert(info, { northIndex: 1, eastIndex: 2 });
  const out = writeCsv(result.outRows, info.delimiter, info.newline);
  assert.equal(out, "kamera;311980,51;506893,71;Jēkabpils;56,9513890;24,1133330\n");
  const back = encodeText(out, decoded.encoding, decoded.bom);
  assert.ok(back.includes(0xe7));
  assert.equal(new TextDecoder("windows-1257").decode(back), out);
});

test("swapped X/Y detected", () => {
  const text = "name,xcoord,ycoord\nriga,506893.71,311980.51\ndaug,618500.0,177900.0\n";
  const { result, out } = run(text);
  assert.equal(result.swapped, true);
  assert.match(out, /56\.9513890,24\.1133330/);
  assert.equal(run(text, { swap: "no" }).result.swapped, false);
});

test("bad rows reported, outside Latvia flagged", () => {
  const { result, out } = run("id,X,Y\n1,311980.51,506893.71\n2,,\n3,900000,506893\n");
  assert.equal(result.stats.rows, 3);
  assert.equal(result.stats.converted, 2);
  assert.equal(result.stats.skipped, 1);
  assert.equal(result.stats.far, 1);
  assert.equal(out.split("\n")[2], "2,,,,");
  assert.ok(result.messages.some((m) => m.line === 3));
  assert.ok(result.messages.some((m) => m.line === 4 && /km outside Latvia/.test(m.text)));
});

test("position check against Latvia's border", () => {
  assert.equal(locate(56.951389, 24.113333).status, "in");      // Riga
  assert.equal(locate(57.3976, 21.5605).status, "in");          // Ventspils port, at the coast
  assert.equal(locate(57.7778, 26.0473).status, "near");        // Valga, Estonian side of the border
  assert.equal(locate(56.2011, 24.7569).status, "near");        // Birzai, Lithuania
  assert.equal(locate(54.6872, 25.2797).status, "far");         // Vilnius
  assert.ok(locate(54.6872, 25.2797).km > 100);
});

test("swapped rows, duplicates and near points are listed", () => {
  const text = "name;X;Y\nriga;311980,51;506893,71\nswapped;506893,71;311980,51\n"
    + "birzai;228719,61;546960,26\ndup;311980,51;506893,71\n";
  const { result } = run(text);
  const s = result.stats;
  assert.equal(result.swapped, false);
  // a swap is only detectable when the swapped order lands outside Latvia
  const ambiguous = run("name;X;Y\nventspils;364275,95;353408,13\nswapped;353408,13;364275,95\n").result;
  assert.equal(ambiguous.stats.swappedRows, 0);
  assert.equal(s.converted, 4);
  assert.equal(s.swappedRows, 1);
  assert.equal(s.near, 1);
  assert.equal(s.duplicates, 1);
  const byLine = Object.fromEntries(result.results.map((r) => [r.line, r]));
  assert.equal(byLine[2].status, "in");
  assert.match(byLine[3].note, /X and Y look swapped/);
  assert.equal(byLine[4].status, "near");
  assert.match(byLine[5].note, /same coordinates as line 2/);
});

test("output separator and decimals can be chosen", () => {
  const text = "name;X;Y\nriga;311980,51;506893,71\n";
  const info = analyse(text);
  const asTab = convert(info, { northIndex: 1, eastIndex: 2, outDelimiter: "\t" });
  assert.equal(writeCsv(asTab.outRows, asTab.delimiter, "\n").split("\n")[1], "riga\t311980,51\t506893,71\t56,9513890\t24,1133330");
  const asComma = convert(info, { northIndex: 1, eastIndex: 2, outDelimiter: "," });
  // decimal commas would clash with ',' so lat/lon switch to dots; text fields with commas get quoted
  assert.equal(writeCsv(asComma.outRows, asComma.delimiter, "\n").split("\n")[1], 'riga,"311980,51","506893,71",56.9513890,24.1133330');
});

test("GeoJSON and KML export", () => {
  const text = "Nosaukums;X;Y\nA & <B>;311980,51;506893,71\nempty;;\n";
  const info = analyse(text);
  const result = convert(info, { northIndex: 1, eastIndex: 2 });
  const gj = JSON.parse(toGeoJSON(info, result));
  assert.equal(gj.features.length, 1);
  assert.deepEqual(gj.features[0].geometry.coordinates, [24.113333, 56.951389]);
  assert.equal(gj.features[0].properties.Nosaukums, "A & <B>");
  assert.equal(gj.features[0].properties.check, "in Latvia");
  const kml = toKML(info, result, { northIndex: 1, eastIndex: 2, title: "t.csv" });
  assert.match(kml, /<name>A &amp; &lt;B&gt;<\/name>/);
  assert.match(kml, /<coordinates>24\.1133330,56\.9513890<\/coordinates>/);
  assert.equal((kml.match(/<Placemark>/g) || []).length, 1);
});

test("errors", () => {
  assert.throws(() => run("id,X,Y\n1,56.95,24.11\n"), /degrees/);
  const info = analyse("id,lat,lon\n1,56.95,24.11\n");
  assert.equal(info.northIndex, -1);
  assert.throws(() => convert(info, { northIndex: -1, eastIndex: -1 }), /Choose/);
});
