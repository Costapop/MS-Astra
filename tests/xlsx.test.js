import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbook, resultWorkbook } from '../src/xlsx.js';
import zlib from 'node:zlib';

function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = {};
  let p = 0;
  while (p + 4 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nl));
    const data = bytes.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    if (zlib.crc32) assert.equal(zlib.crc32(data) >>> 0, crc, `CRC of ${name}`);
    entries[name] = new TextDecoder().decode(data);
    p += 30 + nl + xl + size;
  }
  assert.equal(dv.getUint32(p, true), 0x02014b50, 'central directory follows the entries');
  return entries;
}

test('workbook ZIP has the required OOXML parts and valid numeric/inline cells', () => {
  const bytes = buildWorkbook([{ name: 'S', columns: [{ title: 'a' }, { title: 'b', style: 3 }], rows: [[1, 2.5], ['x', -3]] }]);
  const z = readZip(bytes);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(z[n], n);
  const sh = z['xl/worksheets/sheet1.xml'];
  assert.match(sh, /<c r="A2" s="0"><v>1<\/v><\/c>/);
  assert.match(sh, /<c r="B2" s="3"><v>2.5<\/v><\/c>/);
  assert.match(sh, /<c r="A3" t="inlineStr"><is><t xml:space="preserve">x<\/t><\/is><\/c>/);
  assert.match(z['xl/workbook.xml'], /<sheet name="S" sheetId="1" r:id="rId1"\/>/);
});

test('result workbook contains spectrum, design and summary sheets with the synthesis data', () => {
  const wl = [400, 500, 600], target = [0, 0, 0], R = [0.001, 0.002, 0.0015];
  const layers = [{ m: 'TiO2', n: 2.45, d: 14.9 }, { m: 'MgF2', n: 1.38, d: 28.1 }];
  const bytes = resultWorkbook({ settings: { version: '2.0.0', substrate: { label: 'BK7', n: 1.52 }, H: { key: 'TiO2', n: 2.45 }, L: { key: 'MgF2', n: 1.38 }, lambdaMin: 400, lambdaMax: 600, lambdaCenter: 500, points: 3, bands: [{ from: 400, to: 600, R: 0 }], startMaterial: { key: 'TiO2' }, startThickness: 100, maxLayers: 12, maxTOT: 1500, targetMerit: 1e-6, thinLayer: 1 }, wavelengths: wl, target, R, layers, result: { F: 2e-6, maxDev: 0.002, reason: 'Target merit reached', stats: { needles: 3, rejected: 0, growths: 0, cleanups: 1, refinements: 4, lmIterations: 100 } } });
  const z = readZip(bytes);
  assert.match(z['xl/workbook.xml'], /Spectrum.*Design.*Summary/);
  assert.match(z['xl/worksheets/sheet1.xml'], /<v>500<\/v>.*<v>0.002<\/v>/);
  assert.match(z['xl/worksheets/sheet2.xml'], /MgF2/);
  assert.match(z['xl/worksheets/sheet2.xml'], /<v>28.1<\/v>/);
  assert.match(z['xl/worksheets/sheet3.xml'], /Target merit reached/);
  assert.match(z['xl/worksheets/sheet3.xml'], /&amp;|Furman/);
});

test('result workbook carries the termination summary, the design selection and the ranked starts', () => {
  const wl = [400, 500, 600], target = [0, 0, 0], R = [0.001, 0.002, 0.0015];
  const layers = [{ m: 'TiO2', n: 2.45, d: 14.9 }, { m: 'MgF2', n: 1.38, d: 28.1 }];
  const summary = { decisive: 'layers', headline: 'Layer limit reached', detail: '12 of 12 layers at termination', reported: 'the design at termination (cycle 3) after the final refinement',
    facts: [{ key: 'target', label: 'Target merit', hit: false, decisive: false, text: 'not reached: F = 2.00e-6 > 1e-6', short: 'not reached' }, { key: 'layers', label: 'Layer limit', hit: true, decisive: true, text: 'reached: 12 of 12 layers', short: 'reached: 12 of 12' }] };
  const starts = [{ name: 'B', F: 3e-6, Fdense: 4e-6, score: 4e-6, layers, opticalThickness: 75, reason: 'Layer limit', summary: { headline: 'Layer limit reached' }, elapsedMs: 1200 }, { name: 'A', F: 2e-6, Fdense: null, score: 2e-6, layers, opticalThickness: 75, reason: 'Target merit reached (F = 2e-6)', summary: { headline: 'Target merit reached' }, elapsedMs: 800 }];
  const bytes = resultWorkbook({ settings: { version: '2.2.2', substrate: { label: 'BK7', n: 1.52 }, H: { key: 'TiO2', n: 2.45 }, L: { key: 'MgF2', n: 1.38 }, lambdaMin: 400, lambdaMax: 600, lambdaCenter: 500, points: 3, bands: [{ from: 400, to: 600, R: 0 }], startMode: 'multi', startName: 'A', startMaterial: { key: 'TiO2' }, startThickness: 100, maxLayers: 12, maxTOT: 1500, targetMerit: 1e-6, thinLayer: 1 }, wavelengths: wl, target, R, layers, result: { F: 2e-6, maxDev: 0.002, reason: 'No further progress in three cycles: the layer limit (12) blocks further needles', stats: {}, summary, verified: true, selection: 'Chosen as the best of 2 explored starting designs by the merit F: «A» 2.00e-6 vs runner-up «B» 4.00e-6 (2.00× higher).' }, starts });
  const z = readZip(bytes);
  const s3 = z['xl/worksheets/sheet3.xml'];
  assert.match(s3, /Termination: decisive cause.*Layer limit reached — 12 of 12 layers at termination/);
  assert.match(s3, /Stopping condition: Layer limit.*holds \(decisive\) — reached: 12 of 12 layers/);
  assert.match(s3, /Stopping condition: Target merit.*does not hold — not reached/);
  assert.match(s3, /Reported design.*the design at termination \(cycle 3\)/);
  assert.match(s3, /Termination reason self‑check.*passed/);
  assert.match(s3, /Design selection.*Chosen as the best of 2 explored starting designs/);
  const s4 = z['xl/worksheets/sheet4.xml'];   // Starts (no dense sheet in this fixture)
  assert.match(z['xl/workbook.xml'], /Starts/);
  assert.match(s4, /Score max\(F, F_dense\)/);
  const a = s4.indexOf('>A<'), b = s4.indexOf('>B<');
  assert.ok(a > 0 && b > a, 'starts are ranked by score, the winner first');
  assert.match(s4, /Decisive cause.*Target merit reached/);
});
