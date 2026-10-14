/**
 * Minimal, dependency-free Excel export. Numbers stay numeric, text is written
 * as inline strings, and the ZIP uses the universally supported STORE method.
 * Layers are exported in the solver's order: air → substrate.
 */
const encoder = new TextEncoder();
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function finite(value, label) {
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return Object.is(number, -0) ? 0 : number;
}

function vector(value, label) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return Array.from(value, (entry, index) => finite(entry, `${label}[${index}]`));
}

function textCell(reference, value, style = 6) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference, value, style = 4, formula) {
  return `<c r="${reference}" s="${style}">${formula ? `<f>${escapeXml(formula)}</f>` : ''}<v>${finite(value, reference)}</v></c>`;
}

function row(index, cells, height) {
  return `<row r="${index}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;
}

function columnLetter(index) {
  let name = '';
  for (let remaining = index + 1; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    name = String.fromCharCode(65 + (remaining - 1) % 26) + name;
  }
  return name;
}

function sheet({ title, subtitle, headers, widths, data, total, filter = true }) {
  const lastColumn = columnLetter(headers.length - 1);
  const lastDataRow = Math.max(4, data.length + 4);
  const lastRow = lastDataRow + (total ? 1 : 0);
  const rows = [
    row(1, [textCell('A1', title, 1)], 34),
    row(2, [textCell('A2', subtitle, 2)], 28),
    row(4, headers.map((header, index) => textCell(`${columnLetter(index)}4`, header, 3)), 28),
    ...data.map((cells, index) => row(index + 5, cells, cells.height ?? 23)),
  ];
  if (total) rows.push(row(lastRow, total(lastRow), 27));
  return `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">`
    + `<dimension ref="A1:${lastColumn}${lastRow}"/>`
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="23"/>'
    + `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
    + (filter ? `<autoFilter ref="A4:${lastColumn}${lastDataRow}"/>` : '')
    + `<mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>`
    + '<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
}

const styles = `${XML}<styleSheet xmlns="${MAIN}">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="0.000000"/><numFmt numFmtId="166" formatCode="0.000000E+00"/></numFmts>
  <fonts count="5">
    <font><sz val="11"/><color rgb="FF253A52"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="19"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF60758D"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF253A52"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF142840"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF4FC"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="hair"><color rgb="FFDEE7F0"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="164" fontId="4" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

function materialLabel(material) {
  if (material && typeof material === 'object') return material.name ?? material.label ?? material.id ?? JSON.stringify(material);
  return material ?? '';
}

function roleMaterialLabel(role, config) {
  const name = role === 'L' ? config.materialLName : role === 'H' ? config.materialHName : undefined;
  return typeof name === 'string' && name.trim() ? `${role} · ${name}` : role;
}

function normalizeLayers(layers, config) {
  if (!Array.isArray(layers)) throw new TypeError('layers must be an array.');
  return layers.map((layer, index) => {
    const n = finite(layer.n ?? layer.index ?? layer.material?.n, `Layer ${index + 1} index`);
    const d = finite(layer.d ?? layer.thickness ?? layer.thicknessNm, `Layer ${index + 1} thickness`);
    if (n <= 0 || d < 0) throw new RangeError('Layer indices must be positive and thicknesses must be nonnegative.');
    const material = layer.material ?? layer.type ?? layer.kind;
    const name = layer.name ?? (material === 'L' || material === 'H' ? roleMaterialLabel(material, config) : material) ?? `Layer ${index + 1}`;
    return { n, d, name: materialLabel(name) };
  });
}

const labels = {
  lambdaMin: 'Wavelength minimum (nm)', lambdaMax: 'Wavelength maximum (nm)',
  wavelengthMin: 'Wavelength minimum (nm)', wavelengthMax: 'Wavelength maximum (nm)',
  minWavelength: 'Wavelength minimum (nm)', maxWavelength: 'Wavelength maximum (nm)',
  points: 'Spectral sample count', numPoints: 'Spectral sample count',
  maxLayers: 'Maximum layer count', maxOpticalThickness: 'Maximum optical thickness (nm)',
  maxThickness: 'Maximum optical thickness (nm)', maxMerit: 'Maximum accepted merit',
  targetMerit: 'Maximum accepted merit', meritTarget: 'Maximum accepted merit',
  nL: 'Low-index material: refractive index', nH: 'High-index material: refractive index',
  nSub: 'Substrate refractive index', ns: 'Substrate refractive index', nSubstrate: 'Substrate refractive index',
  initialThickness: 'Starting geometric thickness (nm)', startThickness: 'Starting geometric thickness (nm)',
  initialMaterial: 'Starting layer material', startMaterial: 'Starting layer material',
  lowMaterial: 'Low-index material', highMaterial: 'High-index material',
  materialLName: 'Low-index material', materialHName: 'High-index material',
  materialL: 'Low-index material selection ID', materialH: 'High-index material selection ID',
  substrate: 'Substrate refractive index', segments: 'Target piecewise-constant segments',
  maxCycles: 'Maximum evolution cycles', cleanupThickness: 'Cleanup geometric thickness threshold (nm)',
  wavelengths: 'Spectral wavelengths', target: 'Sampled target reflectance', bands: 'Piecewise-constant target bands',
};

function configEntries(config, prefix = '') {
  return Object.entries(config ?? {}).flatMap(([key, value]) => {
    if (value === undefined || typeof value === 'function') return [];
    // These two values are dropdown positions, not optical material identities.
    if (!prefix && ((key === 'materialL' && config.materialLName) || (key === 'materialH' && config.materialHName))) return [];
    const label = `${prefix}${labels[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')}`;
    if (!prefix && key === 'wavelengths') return [[label, 'See Spectrum sheet, Wavelength (nm) column.']];
    if (!prefix && key === 'target') return [[label, 'See Spectrum sheet, Target R column.']];
    if (!prefix && key === 'bands' && Array.isArray(value)) return [[label, `${value.length} bands; see Target bands sheet for wavelength boundaries and R.`]];
    if (!prefix && ['startMaterial', 'initialMaterial'].includes(key) && ['L', 'H'].includes(value)) return [[label, roleMaterialLabel(value, config)]];
    if (value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)) {
      return configEntries(value, `${label} / `);
    }
    return [[label, Array.isArray(value) || ArrayBuffer.isView(value) ? JSON.stringify(Array.from(value)) : value]];
  });
}

function settingCells(entries) {
  return entries.map(([label, value], index) => {
    const r = index + 5;
    const numericStyle = /merit|residual/i.test(label) || (value !== 0 && Math.abs(value) < 0.001) ? 10 : Number.isInteger(value) ? 6 : 4;
    const cells = [textCell(`A${r}`, label, 9), typeof value === 'number' && Number.isFinite(value)
      ? numberCell(`B${r}`, value, numericStyle)
      : textCell(`B${r}`, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value && typeof value === 'object' ? JSON.stringify(value) : value, 11)];
    cells.height = Math.min(400, Math.max(23, Math.ceil(String(value ?? '').length / 100) * 17));
    return cells;
  });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function zip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [path, content] of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lh = new DataView(local.buffer);
    lh.setUint32(0, 0x04034B50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x0021, true); // DOS date: 1980-01-01; deterministic export.
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const ch = new DataView(central.buffer);
    ch.setUint32(0, 0x02014B50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x0021, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralDirectory = concatenate(centralParts);
  const end = new Uint8Array(22);
  const eh = new DataView(end.buffer);
  eh.setUint32(0, 0x06054B50, true);
  eh.setUint16(8, files.length, true);
  eh.setUint16(10, files.length, true);
  eh.setUint32(12, centralDirectory.length, true);
  eh.setUint32(16, offset, true);
  return concatenate([...localParts, centralDirectory, end]);
}

/** Return an OOXML workbook as bytes, suitable for Blob or filesystem use. */
export function createWorkbook({ config = {}, layers = [], wavelengths = [], target = [], R = [], history = [], status = 'Exported' } = {}) {
  const wl = vector(wavelengths, 'wavelengths');
  const targets = vector(target, 'target');
  const achieved = vector(R, 'R');
  if (wl.length !== targets.length || wl.length !== achieved.length) {
    throw new RangeError('wavelengths, target, and R must have the same length.');
  }
  if (wl.some(value => value <= 0)) throw new RangeError('Wavelengths must be positive.');
  const coating = normalizeLayers(layers, config);
  const residuals = achieved.map((value, index) => value - targets[index]);
  const mse = residuals.length ? residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length : 0;
  const geometricTotal = coating.reduce((sum, layer) => sum + layer.d, 0);
  const opticalTotal = coating.reduce((sum, layer) => sum + layer.n * layer.d, 0);
  const finalStatus = status && typeof status === 'object' ? status.reason ?? status.message ?? status.status ?? JSON.stringify(status) : status;
  const sheets = [
    ['Spectrum', sheet({
      title: 'MS Astra · Spectral response',
      subtitle: 'Normal incidence · air → coating → semi-infinite substrate · R is an energy coefficient (0–1).',
      headers: ['Wavelength (nm)', 'Target R', 'Achieved R', 'Residual (achieved − target)'],
      widths: [23, 23, 23, 34],
      data: wl.map((wavelength, index) => {
        const r = index + 5;
        return [numberCell(`A${r}`, wavelength), numberCell(`B${r}`, targets[index], 5), numberCell(`C${r}`, achieved[index], 5), numberCell(`D${r}`, residuals[index], 10, `C${r}-B${r}`)];
      }),
    })],
    ['Coating', sheet({
      title: 'MS Astra · Coating design',
      subtitle: 'Layer 1 faces air. Thicknesses are in nm. Optical thickness = refractive index × geometric thickness.',
      headers: ['Layer (air → substrate)', 'Material', 'Refractive index n', 'Geometric thickness (nm)', 'Optical thickness (nm)'],
      widths: [25, 28, 23, 29, 28],
      data: coating.map((layer, index) => {
        const r = index + 5;
        return [numberCell(`A${r}`, index + 1, 6), textCell(`B${r}`, layer.name), numberCell(`C${r}`, layer.n, 5), numberCell(`D${r}`, layer.d), numberCell(`E${r}`, layer.n * layer.d, 4, `C${r}*D${r}`)];
      }),
      total: r => [textCell(`A${r}`, 'Total', 8), textCell(`B${r}`, `${coating.length} layers`, 8), textCell(`C${r}`, '', 8), numberCell(`D${r}`, geometricTotal, 7, coating.length ? `SUM(D5:D${r - 1})` : '0'), numberCell(`E${r}`, opticalTotal, 7, coating.length ? `SUM(E5:E${r - 1})` : '0')],
    })],
    ['Run settings', sheet({
      title: 'MS Astra · Synthesis record',
      subtitle: 'Gradual evolution · analytical derivatives · Levenberg–Marquardt thickness refinement.',
      headers: ['Parameter', 'Value'], widths: [49, 91], filter: false,
      data: settingCells([
        ['Termination status', finalStatus],
        ['Achieved mean squared reflectance residual', mse],
        ['Achieved RMS reflectance residual', Math.sqrt(mse)],
        ['Spectral sample count (exported)', wl.length],
        ['Layer count (exported)', coating.length],
        ['Total geometric thickness (nm)', geometricTotal],
        ['Total optical thickness (nm)', opticalTotal],
        ['Incident medium', 'Air, n = 1'],
        ['Angle of incidence', 'Normal incidence (0°)'],
        ['Material assumptions', 'Isotropic, homogeneous, lossless, nondispersive; constant real refractive indices.'],
        ['Substrate model', 'Semi-infinite; no rear-surface reflection.'],
        ['Layer ordering', 'Incident air → layer 1 → … → final layer → substrate'],
        ['Thickness units', 'Nanometers (nm); optical thickness is Σ(n × d).'],
        ...configEntries(config),
      ]),
    })],
  ];
  if (Array.isArray(config.bands) && config.bands.length) {
    const minimum = finite(config.lambdaMin, 'Target band wavelength minimum');
    const maximum = finite(config.lambdaMax, 'Target band wavelength maximum');
    if (!(maximum > minimum && minimum > 0)) throw new RangeError('Target band wavelength limits must be positive and increasing.');
    let previousEnd = 0;
    const bandData = config.bands.map((band, index) => {
      const end = finite(band.end, `Band ${index + 1} end fraction`);
      const reflectance = finite(band.R, `Band ${index + 1} target R`);
      if (!(end > previousEnd && end <= 1) || reflectance < 0 || reflectance > 1) {
        throw new RangeError('Target bands must have increasing end fractions within (0, 1] and R within [0, 1].');
      }
      const from = minimum + previousEnd * (maximum - minimum);
      const to = minimum + end * (maximum - minimum);
      previousEnd = end;
      const r = index + 5;
      return [numberCell(`A${r}`, index + 1, 6), numberCell(`B${r}`, from), numberCell(`C${r}`, to), numberCell(`D${r}`, reflectance, 5)];
    });
    if (previousEnd !== 1) throw new RangeError('Target bands must cover the complete wavelength range.');
    sheets.push(['Target bands', sheet({
      title: 'MS Astra · Piecewise-constant target',
      subtitle: 'Lower boundary included; upper boundary excluded, except the final band. R is an energy coefficient (0–1).',
      headers: ['Band', 'From wavelength (nm)', 'To wavelength (nm)', 'Target R'],
      widths: [18, 28, 28, 23],
      data: bandData,
    })]);
  }
  if (Array.isArray(history) && history.length) {
    sheets.push(['Evolution', sheet({
      title: 'MS Astra · Evolution history',
      subtitle: 'Recorded synthesis checkpoints. Merit values follow the solver definition.',
      headers: ['Checkpoint', 'Stage', 'Merit', 'Layers', 'Optical thickness (nm)'],
      widths: [18, 35, 25, 18, 29],
      data: history.map((entry, index) => {
        const r = index + 5;
        const item = typeof entry === 'number' ? { merit: entry } : entry ?? {};
        const count = Array.isArray(item.layers) ? item.layers.length : item.layerCount ?? item.layers ?? item.count;
        const optical = item.opticalThickness ?? item.totalOpticalThickness ?? item.optical;
        const merit = item.merit ?? item.error ?? item.cost;
        const optionalNumber = (ref, value, style) => value != null && Number.isFinite(Number(value)) ? numberCell(ref, Number(value), style) : textCell(ref, '');
        return [numberCell(`A${r}`, item.iteration ?? item.step ?? index, 6), textCell(`B${r}`, item.stage ?? item.phase ?? item.label ?? ''), optionalNumber(`C${r}`, merit, 10), optionalNumber(`D${r}`, count, 6), optionalNumber(`E${r}`, optical, 4)];
      }),
    })]);
  }

  const files = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ['docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>MS Astra — Optical coating synthesis</dc:title><dc:creator>MS Astra</dc:creator><dc:description>Lossless isotropic multilayer coating; normal incidence; thicknesses in nm.</dc:description></cp:coreProperties>`],
    ['docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MS Astra</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map(([name]) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts></Properties>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map(([name], index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ...sheets.map(([, xml], index) => [`xl/worksheets/sheet${index + 1}.xml`, xml]),
  ];
  return zip(files);
}

/** Generate and download a genuine .xlsx workbook in a browser. */
export function downloadWorkbook(input) {
  const bytes = createWorkbook(input);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ms-astra-design.xlsx';
  link.style.display = 'none';
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    // Safari may read the URL asynchronously after the click event returns.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return bytes;
}
