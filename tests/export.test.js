import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbook, downloadWorkbook } from '../src/export.js';
import { MATERIALS, PRESETS, grid, targetAt, validate } from '../src/config.js';

const decoder = new TextDecoder();

// Read the actual ZIP records, including central-directory offsets and CRCs.
// This catches corrupted or incorrectly packaged OOXML, not only XML contents.
function openZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054B50);
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  let cursor = centralOffset;
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(cursor, true), 0x02014B50);
    assert.equal(view.getUint16(cursor + 10, true), 0, 'ZIP uses the STORE method');
    const length = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localOffset = view.getUint32(cursor + 42, true);
    assert.equal(view.getUint32(localOffset, true), 0x04034B50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    assert.equal(localNameLength, nameLength);
    assert.equal(decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + nameLength)), path);
    const start = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true);
    const content = bytes.subarray(start, start + length);
    let crc = 0xFFFFFFFF;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    assert.equal(view.getUint32(localOffset + 14, true), crc, `${path}: local CRC`);
    assert.equal(view.getUint32(cursor + 16, true), crc, `${path}: central CRC`);
    assert.equal(view.getUint32(localOffset + 18, true), length);
    files.set(path, decoder.decode(content));
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  assert.equal(cursor, end);
  assert.equal(cursor - centralOffset, view.getUint32(end + 12, true));
  return files;
}

function cell(xml, reference) {
  const match = xml.match(new RegExp(`<c r="${reference}"[^>]*>([\\s\\S]*?)<\\/c>`));
  assert.ok(match, `Cell ${reference} exists`);
  return match[1];
}

function cellNumber(xml, reference) {
  const value = cell(xml, reference).match(/<v>([^<]+)<\/v>/);
  assert.ok(value, `Cell ${reference} is numeric`);
  return Number(value[1]);
}

const sample = {
  config: { lambdaMin: 400, lambdaMax: 700, nL: 1.46, nH: 2.1, nSub: 1.52, maxLayers: 30, maxOpticalThickness: 2500, startMaterial: 'L', startThickness: 100 },
  layers: [{ name: 'SiO2', n: 1.46, d: 100 }, { name: 'Ta2O5', n: 2.1, d: 50 }],
  wavelengths: [400, 550, 700],
  target: [0.1, 0.9, 0.1],
  R: [0.12, 0.85, 0.14],
  history: [{ iteration: 0, stage: 'Initial', merit: 0.1, layerCount: 1, opticalThickness: 146 }, { iteration: 1, stage: 'Refine', merit: 0.0015, layerCount: 2, opticalThickness: 251 }],
  status: 'Merit target reached',
};

test('exports a valid ZIP package with four related workbook sheets', () => {
  const bytes = createWorkbook(sample);
  assert.ok(bytes instanceof Uint8Array);
  const files = openZip(bytes);
  assert.equal(files.size, 11);
  const workbook = files.get('xl/workbook.xml');
  for (const name of ['Spectrum', 'Coating', 'Run settings', 'Evolution']) assert.ok(workbook.includes(`name="${name}"`));
  const rels = files.get('xl/_rels/workbook.xml.rels');
  for (let index = 1; index <= 4; index++) {
    assert.ok(rels.includes(`Target="worksheets/sheet${index}.xml"`));
    assert.ok(files.has(`xl/worksheets/sheet${index}.xml`));
    assert.ok(files.get('[Content_Types].xml').includes(`/xl/worksheets/sheet${index}.xml`));
  }
  assert.match(files.get('xl/worksheets/sheet1.xml'), /<pane ySplit="4"[^>]*state="frozen"/);
  assert.match(files.get('xl/worksheets/sheet1.xml'), /<autoFilter ref="A4:D7"\/>/);
  assert.match(files.get('xl/worksheets/sheet2.xml'), /<autoFilter ref="A4:E6"\/>/);
  assert.match(files.get('xl/styles.xml'), /<cellXfs count="12">/);
});

test('stores exact numeric spectra, signed residuals, and cached formulas', () => {
  const files = openZip(createWorkbook(sample));
  const spectrum = files.get('xl/worksheets/sheet1.xml');
  for (let index = 0; index < 3; index++) {
    const row = index + 5;
    assert.equal(cellNumber(spectrum, `A${row}`), sample.wavelengths[index]);
    assert.equal(cellNumber(spectrum, `B${row}`), sample.target[index]);
    assert.equal(cellNumber(spectrum, `C${row}`), sample.R[index]);
    assert.equal(cellNumber(spectrum, `D${row}`), sample.R[index] - sample.target[index]);
    assert.equal(cell(spectrum, `D${row}`).match(/<f>(.*?)<\/f>/)[1], `C${row}-B${row}`);
  }
});

test('exports air-to-substrate layers, optical thickness, and formula totals', () => {
  const files = openZip(createWorkbook(sample));
  const coating = files.get('xl/worksheets/sheet2.xml');
  assert.match(cell(coating, 'B5'), /SiO2/);
  assert.match(cell(coating, 'B6'), /Ta2O5/);
  assert.equal(cellNumber(coating, 'C5'), 1.46);
  assert.equal(cellNumber(coating, 'D5'), 100);
  assert.equal(cellNumber(coating, 'E5'), 146);
  assert.match(cell(coating, 'E5'), /<f>C5\*D5<\/f>/);
  assert.equal(cellNumber(coating, 'D7'), 150);
  assert.equal(cellNumber(coating, 'E7'), 251);
  assert.match(cell(coating, 'D7'), /<f>SUM\(D5:D6\)<\/f>/);
  assert.match(cell(coating, 'E7'), /<f>SUM\(E5:E6\)<\/f>/);
  const settings = files.get('xl/worksheets/sheet3.xml');
  assert.match(settings, /Merit target reached/);
  assert.match(settings, /Maximum optical thickness \(nm\)/);
  assert.match(settings, /Isotropic, homogeneous, lossless, nondispersive/);
  const mse = sample.R.reduce((sum, value, index) => sum + (value - sample.target[index]) ** 2, 0) / sample.R.length;
  assert.equal(cellNumber(settings, 'B6'), mse);
  assert.equal(cellNumber(settings, 'B7'), Math.sqrt(mse));
  assert.equal(cellNumber(files.get('xl/worksheets/sheet4.xml'), 'E6'), 251);
});

test('escapes XML and preserves Unicode and formula-like material names as text', () => {
  const input = { ...sample, config: { note: 'L < H & "quoted"\u0000' }, layers: [{ n: 1.54, d: 40, material: 'Ситалл & <film> "a" \'b\'' }, { n: 1.46, d: 12, material: '=HYPERLINK("https://example.com")' }] };
  const files = openZip(createWorkbook(input));
  const coating = files.get('xl/worksheets/sheet2.xml');
  assert.match(coating, /Ситалл &amp; &lt;film&gt; &quot;a&quot; &apos;b&apos;/);
  assert.match(coating, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;https:\/\/example.com&quot;\)/);
  assert.doesNotMatch(cell(coating, 'B6'), /<f>/);
  assert.match(files.get('xl/worksheets/sheet3.xml'), /L &lt; H &amp; &quot;quoted&quot;/);
  assert.doesNotMatch(files.get('xl/worksheets/sheet3.xml'), /\u0000/);
});

test('supports typed spectra and material objects without losing numeric precision', () => {
  const files = openZip(createWorkbook({
    ...sample,
    wavelengths: new Float64Array(sample.wavelengths), target: new Float64Array(sample.target), R: new Float64Array(sample.R),
    layers: [{ material: { name: 'TiO2', n: 2.45 }, thickness: 10.123456789 }],
  }));
  const coating = files.get('xl/worksheets/sheet2.xml');
  assert.equal(cellNumber(coating, 'D5'), 10.123456789);
  assert.equal(cellNumber(coating, 'E5'), 2.45 * 10.123456789);
  assert.match(cell(coating, 'B5'), /TiO2/);
});

test('exports the current app config, compound names, band boundaries, and numeric history', () => {
  // Match readConfig() and applySnapshot() in app.js, including dropdown indices.
  const bands = structuredClone(PRESETS.split);
  const config = {
    materialL: 1, materialH: 4, substrate: 1.52, startMaterial: 'L', startThickness: 100,
    points: 11, maxLayers: 30, maxOpticalThickness: 2500, targetMerit: 1e-4,
    cleanupThickness: 0.25, maxCycles: 12, lambdaMin: 400, lambdaMax: 1000,
  };
  config.nL = MATERIALS[config.materialL][1];
  config.nH = MATERIALS[config.materialH][1];
  config.ns = config.substrate;
  config.materialLName = MATERIALS[config.materialL][0];
  config.materialHName = MATERIALS[config.materialH][0];
  validate(config, bands);
  config.wavelengths = grid(config.lambdaMin, config.lambdaMax, config.points);
  config.target = config.wavelengths.map(w => targetAt(w, config.lambdaMin, config.lambdaMax, bands));
  config.bands = structuredClone(bands);
  const files = openZip(createWorkbook({
    config,
    layers: [{ id: 'initial', material: 'L', n: 1.46, d: 100 }, { id: 'needle-1', material: 'H', n: 2.1, d: 50 }],
    wavelengths: config.wavelengths, target: config.target, R: config.target.map(r => r - 0.001),
    history: [{ iteration: 1, cycle: 1, stage: 'refine', merit: 0.1, layers: 2, opticalThickness: 251 }],
    status: 'In progress snapshot',
  }));
  assert.equal(files.size, 12);
  assert.match(files.get('xl/workbook.xml'), /name="Target bands" sheetId="4"/);
  assert.match(files.get('xl/workbook.xml'), /name="Evolution" sheetId="5"/);
  const coating = files.get('xl/worksheets/sheet2.xml');
  assert.match(cell(coating, 'B5'), /L · SiO2/);
  assert.match(cell(coating, 'B6'), /H · Ta2O5/);
  const targetBands = files.get('xl/worksheets/sheet4.xml');
  assert.equal(cellNumber(targetBands, 'B5'), 400);
  assert.equal(cellNumber(targetBands, 'C5'), 580);
  assert.equal(cellNumber(targetBands, 'B6'), 580);
  assert.equal(cellNumber(targetBands, 'C6'), 820);
  assert.equal(cellNumber(targetBands, 'B7'), 820);
  assert.equal(cellNumber(targetBands, 'C7'), 1000);
  assert.equal(cellNumber(targetBands, 'D5'), 0.02);
  assert.equal(cellNumber(targetBands, 'D6'), 0.95);
  assert.equal(cellNumber(targetBands, 'D7'), 0.02);
  assert.match(targetBands, /upper boundary excluded, except the final band/);
  const settings = files.get('xl/worksheets/sheet3.xml');
  const findSetting = label => {
    const settingRow = settings.match(/<row\b[^>]*>[\s\S]*?<\/row>/g).find(content => content.includes(`>${label}</t>`));
    assert.ok(settingRow, `Setting ${label} is exported`);
    const reference = settingRow.match(/<c r="(B\d+)"/)[1];
    return { reference, content: cell(settingRow, reference) };
  };
  assert.match(findSetting('Low-index material').content, />SiO2</);
  assert.match(findSetting('High-index material').content, />Ta2O5</);
  assert.match(findSetting('Starting layer material').content, />L · SiO2</);
  assert.equal(cellNumber(settings, findSetting('Spectral sample count').reference), 11);
  assert.equal(cellNumber(settings, findSetting('Maximum evolution cycles').reference), 12);
  assert.equal(cellNumber(settings, findSetting('Cleanup geometric thickness threshold (nm)').reference), 0.25);
  assert.match(findSetting('Piecewise-constant target bands').content, /3 bands; see Target bands/);
  assert.match(findSetting('Spectral wavelengths').content, /See Spectrum sheet/);
  assert.doesNotMatch(settings, /selection ID/);
  for (const xml of files.values()) assert.doesNotMatch(xml, /\[object Object\]/);
  const history = files.get('xl/worksheets/sheet5.xml');
  assert.equal(cellNumber(history, 'D5'), 2);
  assert.equal(cellNumber(history, 'E5'), 251);
});

test('rejects invalid piecewise-constant target boundaries', () => {
  const input = { ...sample, config: { ...sample.config, bands: [{ end: 0.5, R: 0.1 }, { end: 1, R: 0.9 }] } };
  assert.doesNotThrow(() => createWorkbook(input));
  assert.throws(() => createWorkbook({ ...input, config: { ...input.config, bands: [{ end: 0.5, R: 0.1 }, { end: 0.4, R: 0.9 }] } }), /increasing end fractions/);
  assert.throws(() => createWorkbook({ ...input, config: { ...input.config, bands: [{ end: 0.5, R: 0.1 }] } }), /complete wavelength range/);
  assert.throws(() => createWorkbook({ ...input, config: { ...input.config, bands: [{ end: 1, R: 1.1 }] } }), /R within/);
});

test('empty export is well formed and omits an empty evolution sheet', () => {
  const files = openZip(createWorkbook());
  assert.equal(files.size, 10);
  assert.doesNotMatch(files.get('xl/workbook.xml'), /name="Evolution"/);
  assert.match(files.get('xl/worksheets/sheet1.xml'), /dimension ref="A1:D4"/);
  const coating = files.get('xl/worksheets/sheet2.xml');
  assert.equal(cellNumber(coating, 'D5'), 0);
  assert.equal(cellNumber(coating, 'E5'), 0);
  assert.match(cell(coating, 'E5'), /<f>0<\/f>/);
});

test('rejects mismatched spectra, non-finite data, and invalid optical parameters', () => {
  assert.throws(() => createWorkbook({ ...sample, R: [0.2] }), /same length/);
  assert.throws(() => createWorkbook({ ...sample, R: [0.2, NaN, 0.1] }), /finite number/);
  assert.throws(() => createWorkbook({ ...sample, target: [0.2, Infinity, 0.1] }), /finite number/);
  assert.throws(() => createWorkbook({ ...sample, wavelengths: [-1, 550, 700] }), /positive/);
  assert.throws(() => createWorkbook({ ...sample, layers: [{ n: 0, d: 10 }] }), /positive/);
  assert.throws(() => createWorkbook({ ...sample, layers: [{ n: 1.46, d: -10 }] }), /nonnegative/);
  assert.throws(() => createWorkbook({ ...sample, layers: [{ n: 1.46 }] }), /finite number/);
});

test('browser download uses the correct filename, MIME type, and URL lifecycle', () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalTimeout = globalThis.setTimeout;
  const events = [];
  let callback;
  const link = { style: {}, click() { events.push('click'); }, remove() { events.push('remove'); } };
  globalThis.document = {
    createElement(tag) { assert.equal(tag, 'a'); return link; },
    body: { appendChild(element) { assert.equal(element, link); events.push('append'); } },
  };
  URL.createObjectURL = blob => {
    assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(blob.size > 1000);
    return 'blob:test-workbook';
  };
  URL.revokeObjectURL = url => { assert.equal(url, 'blob:test-workbook'); events.push('revoke'); };
  globalThis.setTimeout = (fn, delay) => { callback = fn; assert.equal(delay, 30_000); return 1; };
  try {
    assert.ok(downloadWorkbook(sample) instanceof Uint8Array);
    assert.equal(link.download, 'ms-astra-design.xlsx');
    assert.equal(link.href, 'blob:test-workbook');
    assert.deepEqual(events, ['append', 'click', 'remove']);
    callback();
    assert.deepEqual(events, ['append', 'click', 'remove', 'revoke']);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalTimeout;
  }
});
