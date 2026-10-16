/**
 * Dependency‑free Excel (Office Open XML) writer: STORE‑method ZIP, inline
 * strings, numeric cells, a few cell styles and column widths.
 * Works in browsers and Node (returns a Uint8Array).
 */
const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  // files: [{name, data: Uint8Array}]
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  let cdSize = 0; for (const c of central) cdSize += c.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  let total = 0; for (const a of all) total += a.length;
  const out = new Uint8Array(total);
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function col(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/**
 * sheets: [{ name, columns: [{title, width, style}], rows: [[...]], title? }]
 * Cell values: number → numeric cell; string → inline string; null → empty.
 * Styles: 0 default, 1 bold header, 2 title, 3 number 0.0000, 4 number 0.000000, 5 scientific.
 */
export function buildWorkbook(sheets) {
  const files = [];
  const sheetXml = sheets.map((sh) => {
    const rows = [];
    let r = 1;
    if (sh.title) { rows.push(`<row r="${r}"><c r="A${r}" s="2" t="inlineStr"><is><t>${esc(sh.title)}</t></is></c></row>`); r += 2; }
    rows.push(`<row r="${r}">${sh.columns.map((c, i) => `<c r="${col(i)}${r}" s="1" t="inlineStr"><is><t>${esc(c.title)}</t></is></c>`).join('')}</row>`);
    r++;
    for (const row of sh.rows) {
      const cells = row.map((v, i) => {
        const ref = `${col(i)}${r}`;
        if (v == null || v === '') return '';
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) return `<c r="${ref}" t="inlineStr"><is><t>${esc(String(v))}</t></is></c>`;
          const s = sh.columns[i]?.style ?? 0;
          return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      rows.push(`<row r="${r}">${cells}</row>`);
      r++;
    }
    const cols = sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sh === sheets[0] ? ' tabSelected="1"' : ''}/></sheetViews><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
  });

  files.push({ name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) });
  files.push({ name: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) });
  files.push({ name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) });
  files.push({ name: 'xl/styles.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0.0000"/><numFmt numFmtId="165" formatCode="0.000000"/><numFmt numFmtId="166" formatCode="0.000E+00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) });
  sheetXml.forEach((xml, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(xml) }));
  return zipStore(files);
}

/** Build the MS Astra result workbook. */
const polT = (t, key) => (t && !t.length ? t[key] : t);
export function resultWorkbook({ settings, wavelengths, target, weights, R, Rs = null, Rp = null, layers, result, starts = [], exported = null }) {
  const oblique = (settings.angle ?? 0) > 0;
  const dual = oblique && settings.pol === 'both' && target && !target.length && Rs && Rp;   // separate Rs and Rp targets
  const charName = oblique ? (settings.pol === 'both' ? '(Rs+Rp)/2' : settings.polLabel || 'R') : 'R';
  const pols = oblique && Rs && Rp;
  const tS = polT(target, 's'), tP = polT(target, 'p'), wS = polT(weights, 's'), wP = polT(weights, 'p');
  const spectrum = dual ? {
    name: 'Spectrum', title: `Targets and synthesized Rs, Rp at ${settings.angle}° from ${settings.ambient ? settings.ambient.label : 'air'} (Rs & Rp: each polarization to its own target) on the optimization grid`,
    columns: [
      { title: 'Wavelength, nm', width: 16, style: 3 },
      { title: 'Target Rs', width: 12, style: 4 },
      { title: 'Target Rp', width: 12, style: 4 },
      { title: 'Synthesized Rs', width: 15, style: 4 },
      { title: 'Synthesized Rp', width: 15, style: 4 },
      { title: 'ΔRs, p.p.', width: 12, style: 3 },
      { title: 'ΔRp, p.p.', width: 12, style: 3 },
      { title: 'Weight Rs', width: 12, style: 4 },
      { title: 'Weight Rp', width: 12, style: 4 },
    ],
    rows: Array.from(wavelengths, (w, i) => [w, tS[i], tP[i], Rs[i], Rp[i], 100 * (Rs[i] - tS[i]), 100 * (Rp[i] - tP[i]), wS ? wS[i] : 1 / wavelengths.length, wP ? wP[i] : 1 / wavelengths.length]),
  } : {
    name: 'Spectrum', title: `Target and synthesized ${oblique ? `reflectance at ${settings.angle}° from ${settings.ambient ? settings.ambient.label : 'air'} (target characteristic ${settings.polLabel || charName})` : 'reflectance'} on the optimization grid`,
    columns: [
      { title: 'Wavelength, nm', width: 16, style: 3 },
      { title: 'Target R', width: 12, style: 4 },
      { title: 'Target R, %', width: 12, style: 3 },
      { title: `Synthesized ${charName}`, width: 14, style: 4 },
      { title: `Synthesized ${charName}, %`, width: 16, style: 3 },
      { title: 'Difference, p.p.', width: 16, style: 3 },
      { title: 'Merit weight', width: 13, style: 4 },
      ...(pols ? [{ title: 'Rs', width: 12, style: 4 }, { title: 'Rp', width: 12, style: 4 }] : []),
    ],
    rows: Array.from(wavelengths, (w, i) => [w, tS[i], 100 * tS[i], R[i], 100 * R[i], 100 * (R[i] - tS[i]), wS ? wS[i] : 1 / wavelengths.length, ...(pols ? [Rs[i], Rp[i]] : [])]),
  };
  let z = 0;
  const design = {
    name: 'Design', title: 'Synthesized coating (layer 1 is adjacent to the substrate)',
    columns: [
      { title: 'Layer', width: 8 },
      { title: 'Material', width: 14 },
      { title: 'Refractive index', width: 16, style: 3 },
      { title: 'Geometric thickness, nm', width: 22, style: 3 },
      { title: 'Optical thickness, nm', width: 20, style: 3 },
      { title: 'Optical thickness, QWOT @ λc', width: 26, style: 3 },
      { title: 'Position from substrate, nm', width: 24, style: 3 },
    ],
    rows: layers.map((L, i) => { const row = [i + 1, L.m, L.n, L.d, L.n * L.d, 4 * L.n * L.d / settings.lambdaCenter, z]; z += L.d; return row; }),
  };
  const totOpt = layers.reduce((s, L) => s + L.n * L.d, 0);
  const totGeo = layers.reduce((s, L) => s + L.d, 0);
  const summary = {
    name: 'Summary', title: 'Synthesis settings and result',
    columns: [{ title: 'Parameter', width: 36 }, { title: 'Value', width: 28 }],
    rows: [
      ['Application', 'MS Astra ' + settings.version],
      ['Method', 'Needle optimization + gradual evolution (Furman–Tikhonravov admittance formalism)'],
      ['Incidence', oblique ? `${settings.angle}° from ${settings.ambient ? `${settings.ambient.label} (n = ${settings.ambient.n})` : 'air (n = 1)'}; α = n_a sin θ = ${((settings.ambient ? settings.ambient.n : 1) * Math.sin(settings.angle * Math.PI / 180)).toFixed(4)}` : `Normal, from ${settings.ambient ? `${settings.ambient.label} (n = ${settings.ambient.n})` : 'air (n = 1)'}`],
      ['Target characteristic', oblique ? `${settings.polLabel || charName}${settings.pol === 'avg' ? ' — unpolarized light' : settings.pol === 'both' ? ' — Rs and Rp each to its own target, F = ½[⟨(Rs − R̃s)²⟩ + ⟨(Rp − R̃p)²⟩]' : ''}` : 'R (Rs = Rp at normal incidence)'],
      ['Substrate', `${settings.substrate.label} (n = ${settings.substrate.n}), semi‑infinite`],
      ['High‑index material (H)', `${settings.H.key} (n = ${settings.H.n})`],
      ['Low‑index material (L)', `${settings.L.key} (n = ${settings.L.n})`],
      ['Spectral range, nm', `${settings.lambdaMin} – ${settings.lambdaMax}`],
      ['Spectral points', settings.points],
      ['Target bands', settings.dual && settings.bands2
        ? `Rs: ${settings.bands.map((b) => `${b.from.toFixed(1)}–${b.to.toFixed(1)} nm ${(100 * b.R).toFixed(2)} %`).join('; ')} | Rp: ${settings.bands2.map((b) => `${b.from.toFixed(1)}–${b.to.toFixed(1)} nm ${(100 * b.R).toFixed(2)} %`).join('; ')}`
        : settings.bands.map((b) => `${b.from.toFixed(1)}–${b.to.toFixed(1)} nm: R = ${(100 * b.R).toFixed(2)} %`).join('; ')],
      ['Starting design', settings.startMode === 'multi' ? `Multi‑start; ${settings.startRole === 'chosen' ? 'chosen from the explored starts (see the Starts sheet)' : 'best'}: ${settings.startName || '—'}` : `${settings.startMaterial.key}, ${settings.startThickness} nm`],
      ['Transition zone at target jumps, nm', settings.transition ?? 0],
      ['Needle candidates compared per step', settings.candidates === 0 ? 'all' : settings.candidates],
      ['Dense‑grid check / grid enrichment', `${settings.denseCheck ? 'on' : 'off'} / ${settings.denseCheck && settings.enrichGrid ? 'on' : 'off'}`],
      ['Maximum layers', settings.maxLayers],
      ['Maximum total optical thickness, nm', settings.maxTOT],
      [dual ? 'Target merit function F = ½[⟨(Rs − R̃s)²⟩ + ⟨(Rp − R̃p)²⟩]' : `Target merit function F (mean square of ${charName} − R̃)`, settings.targetMerit],
      ['Thin‑layer threshold, nm', settings.thinLayer],
      [],
      ['Result: layers', layers.length],
      ['Result: merit function F', result.F],
      ['Result: RMS deviation of R, %', 100 * Math.sqrt(result.F)],
      ['Result: maximum |R − R̃| on the grid, p.p.', 100 * result.maxDev],
      ['Result: optimization grid points', wavelengths.length],
      ['Result: dense‑grid merit F', result.dense ? result.dense.F : 'not checked'],
      ['Result: dense‑grid RMS deviation, %', result.dense ? 100 * Math.sqrt(result.dense.F) : 'not checked'],
      ['Result: dense‑grid maximum |R − R̃|, p.p.', result.dense ? 100 * result.dense.maxDev : 'not checked'],
      ['Result: total geometric thickness, nm', totGeo],
      ['Result: total optical thickness, nm', totOpt],
      ['Termination', result.reason || ''],
      ...(result.summary ? [
        ['Termination: decisive cause', `${result.summary.headline} — ${result.summary.detail}`],
        ...result.summary.facts.map((f) => [`Stopping condition: ${f.label}`, `${f.hit ? 'holds' : 'does not hold'}${f.decisive ? ' (decisive)' : ''} — ${f.text}`]),
        ['Reported design', result.summary.reported],
        ...(result.summary.guarantee ? [['Best design', result.summary.guarantee]] : []),
        ['Termination reason self‑check', result.verified == null ? '' : result.verified ? 'passed' : 'FAILED'],
      ] : []),
      ...(result.selection ? [['Design selection', result.selection]] : []),
      ['Needles inserted / alternatives refined / rejected', `${result.stats?.needles ?? 0} / ${result.stats?.compared ?? 0} / ${result.stats?.rejected ?? 0}`],
      ['Grid enrichments / points added', `${result.stats?.enrichments ?? 0} / ${result.stats?.pointsAdded ?? 0}`],
      ['Synthesis time, s', result.elapsedMs != null ? result.elapsedMs / 1000 : ''],
      ['Growth steps', result.stats?.growths ?? 0],
      ['Thin layers removed', result.stats?.cleanups ?? 0],
      ['Refinements / LM iterations', `${result.stats?.refinements ?? 0} / ${result.stats?.lmIterations ?? 0}`],
      ['Exported', new Date().toISOString()],
    ],
  };
  const sheets = [spectrum, design, summary];
  if (result.dense) {
    const d = result.dense, dtS = polT(d.target, 's'), dtP = polT(d.target, 'p'), dwS = polT(d.weights, 's'), dwP = polT(d.weights, 'p');
    const dDual = dual && d.Rs && d.Rp && d.target && !d.target.length;
    sheets.push(dDual ? {
      name: 'Verification', title: `Independent dense‑grid check (${d.wavelengths.length} points; zero weight inside transition zones and one grid step around jumps) — Rs and Rp against their own targets`,
      columns: [
        { title: 'Wavelength, nm', width: 16, style: 3 },
        { title: 'Target Rs', width: 12, style: 4 }, { title: 'Target Rp', width: 12, style: 4 },
        { title: 'Synthesized Rs', width: 15, style: 4 }, { title: 'Synthesized Rp', width: 15, style: 4 },
        { title: 'ΔRs, p.p.', width: 12, style: 3 }, { title: 'ΔRp, p.p.', width: 12, style: 3 },
        { title: 'Counted Rs', width: 11 }, { title: 'Counted Rp', width: 11 },
      ],
      rows: Array.from(d.wavelengths, (w, i) => [w, dtS[i], dtP[i], d.Rs[i], d.Rp[i], 100 * (d.Rs[i] - dtS[i]), 100 * (d.Rp[i] - dtP[i]), dwS[i] > 0 ? 'yes' : 'no', dwP[i] > 0 ? 'yes' : 'no']),
    } : {
      name: 'Verification', title: `Independent dense‑grid check (${d.wavelengths.length} points; zero weight inside transition zones and one grid step around jumps)`,
      columns: [
        { title: 'Wavelength, nm', width: 16, style: 3 },
        { title: 'Target R', width: 12, style: 4 },
        { title: `Synthesized ${charName}`, width: 14, style: 4 },
        { title: 'Difference, p.p.', width: 16, style: 3 },
        { title: 'Counted', width: 10 },
        ...(oblique && d.Rs && d.Rp ? [{ title: 'Rs', width: 12, style: 4 }, { title: 'Rp', width: 12, style: 4 }] : []),
      ],
      rows: Array.from(d.wavelengths, (w, i) => [w, dtS[i], d.R[i], 100 * (d.R[i] - dtS[i]), dwS[i] > 0 ? 'yes' : 'no', ...(oblique && d.Rs && d.Rp ? [d.Rs[i], d.Rp[i]] : [])]),
    });
  }
  if (starts && starts.length) {
    // the note names the winner and the start whose design this workbook describes (the winner through its replay, or an explored result chosen in the interface)
    const note = (r, rank) => {
      const parts = [];
      if (rank === 1) parts.push('winner');
      if (exported && r.index === exported.index) parts.push(exported.how === 'replay' ? 'replayed on the dashboard — the design of this workbook' : 'shown on the dashboard — the design of this workbook (explored result)');
      return parts.join('; ');
    };
    sheets.push({
      name: 'Starts', title: 'Multi‑start exploration — ranked by the score max(F, F_dense); the lowest score wins and is replayed; any explored result can be shown and exported instead',
      columns: [
        { title: 'Rank', width: 6 }, { title: 'Starting design', width: 40 }, { title: 'Score max(F, F_dense)', width: 20, style: 5 }, { title: 'Merit F', width: 14, style: 5 }, { title: 'Dense‑grid F', width: 14, style: 5 },
        { title: 'Layers', width: 8 }, { title: 'Optical thickness, nm', width: 20, style: 3 }, { title: 'Decisive cause', width: 36 }, { title: 'Termination', width: 44 }, { title: 'Time, s', width: 9, style: 3 }, { title: 'Note', width: 40 },
      ],
      rows: starts.slice().sort((a, b) => a.score - b.score).map((r, i) => [i + 1, r.name, r.score, r.F, r.Fdense ?? 'not checked', r.layers.length, r.opticalThickness, r.summary ? r.summary.headline : '', r.reason, r.elapsedMs / 1000, note(r, i + 1)]),
    });
  }
  return buildWorkbook(sheets);
}
