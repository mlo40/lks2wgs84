// Tests for assets/lks.js:  node --test tests/
// Reference coordinates in fixtures.json were computed with PROJ (see its "source" field).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyse, columnKind, convert, decodeBytes, detectDelimiter, encodeText, lksToWgs84,
  parseCsv, parseNumber, writeCsv,
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
  assert.deepEqual(result.stats, { rows: 3, converted: 2, skipped: 1, outside: 1 });
  assert.equal(out.split("\n")[2], "2,,,,");
  assert.ok(result.messages.some((m) => m.line === 3));
  assert.ok(result.messages.some((m) => m.line === 4 && /outside Latvia/.test(m.text)));
});

test("errors", () => {
  assert.throws(() => run("id,X,Y\n1,56.95,24.11\n"), /degrees/);
  const info = analyse("id,lat,lon\n1,56.95,24.11\n");
  assert.equal(info.northIndex, -1);
  assert.throws(() => convert(info, { northIndex: -1, eastIndex: -1 }), /Choose/);
});
