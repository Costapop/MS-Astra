/**
 * MS Astra — application controller: settings, target editor, synthesis
 * runner with demonstration pacing and animation, multi‑start exploration in
 * a background worker, dashboard updates, export.
 */
import { LAYER_MATERIALS, SUBSTRATES, PRESETS, DEFAULTS, materialByKey, uniformGrid, sampleTarget, bandsFromPreset, validateConfig } from './config.js';
import { reflectance, merit, totalOpticalThickness } from './optics.js';
import { synthesize, explore, startDesigns } from './synthesis.js';
import { SpectrumChart, NeedleChart, StructureChart, MeritChart, fmt } from './charts.js';
import { resultWorkbook } from './xlsx.js';

export const VERSION = '2.1.3';
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/*  Settings model                                                     */
/* ------------------------------------------------------------------ */
const settings = {
  preset: DEFAULTS.preset,
  lambdaMin: 450, lambdaMax: 650, points: DEFAULTS.points,
  bands: [{ from: 450, to: 650, R: 0.95 }],
  transition: DEFAULTS.transition,
  H: 'Ta2O5', L: 'SiO2', substrate: DEFAULTS.substrate,
  startMode: DEFAULTS.multiStart ? 'multi' : 'single', startMaterial: 'H', startThickness: 100, exploreBudget: DEFAULTS.exploreBudget,
  maxLayers: 30, maxTOT: 5000, targetMerit: 1e-4,
  thinLayer: DEFAULTS.thinLayer, needleWidth: DEFAULTS.needleWidth, candidates: DEFAULTS.candidates,
  denseCheck: DEFAULTS.denseCheck, enrichGrid: DEFAULTS.enrichGrid,
};

function applyPreset(key) {
  const p = PRESETS[key]; if (!p) return;
  settings.preset = key;
  settings.lambdaMin = p.range[0]; settings.lambdaMax = p.range[1];
  settings.bands = bandsFromPreset(p);
  settings.transition = p.transition ?? 0;
  settings.H = p.H; settings.L = p.L;
  settings.startMaterial = p.start.material === p.H ? 'H' : 'L';
  settings.startThickness = p.start.thickness;
  settings.maxLayers = p.maxLayers; settings.maxTOT = p.maxTOT; settings.targetMerit = p.merit;
}

function materialH() { return materialByKey(settings.H); }
function materialL() { return materialByKey(settings.L); }
function substrate() { return materialByKey(settings.substrate); }
function startMat() { return settings.startMaterial === 'H' ? materialH() : materialL(); }
const lambdaCenter = () => (settings.lambdaMin + settings.lambdaMax) / 2;

function buildProblem() {
  const grid = uniformGrid(settings.lambdaMin, settings.lambdaMax, settings.points);
  const s = sampleTarget(settings.bands, grid, settings.transition);
  return { grid, target: s.target, weights: s.weights, excluded: s.excluded };
}

function engineConfig() {
  const { grid, target, weights } = buildProblem();
  const H = { n: materialH().n, m: materialH().key }, L = { n: materialL().n, m: materialL().key };
  return {
    wavelengths: grid, target, weights, ns: substrate().n, na: 1,
    bands: settings.bands.map((b) => ({ ...b })), transition: settings.transition,
    materials: { H, L },
    start: { material: startMat().key, thickness: settings.startThickness },
    maxLayers: settings.maxLayers, maxOpticalThickness: settings.maxTOT, targetMerit: settings.targetMerit,
    thinLayer: settings.thinLayer, needleWidth: settings.needleWidth, candidates: settings.candidates, compare: true,
    dense: { enabled: settings.denseCheck }, enrich: { enabled: settings.denseCheck && settings.enrichGrid },
  };
}

/* ------------------------------------------------------------------ */
/*  Sidebar binding                                                    */
/* ------------------------------------------------------------------ */
function fillSelect(sel, list, value) {
  sel.innerHTML = '';
  for (const m of list) { const o = document.createElement('option'); o.value = m.key; o.textContent = `${m.label} — ${m.n.toFixed(2)}`; sel.appendChild(o); }
  sel.value = value;
}

function renderPresets() {
  const box = $('presets'); box.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (settings.preset === key ? ' active' : ''); b.textContent = p.name;
    b.addEventListener('click', () => { applyPreset(key); syncForm(); resetRun(); });
    box.appendChild(b);
  }
}

function renderBands() {
  const box = $('bands'); box.innerHTML = '';
  const head = document.createElement('div'); head.className = 'band-head'; head.innerHTML = '<span>from, nm</span><span>to, nm</span><span>R, %</span>'; box.appendChild(head);
  settings.bands.forEach((b, i) => {
    const row = document.createElement('div'); row.className = 'band';
    const from = document.createElement('input'); from.type = 'number'; from.value = Math.round(b.from); from.step = 1; from.disabled = i > 0; from.title = i > 0 ? 'Set by the previous band' : 'Lower bound of the spectral range';
    const to = document.createElement('input'); to.type = 'number'; to.value = Math.round(b.to); to.step = 1;
    const R = document.createElement('input'); R.type = 'number'; R.value = +(100 * b.R).toFixed(2); R.step = 0.5; R.min = 0; R.max = 100;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'Merge this band'; x.disabled = settings.bands.length === 1;
    from.addEventListener('change', () => { const v = Math.max(100, Math.min(b.to - 1, Number(from.value))); settings.lambdaMin = v; b.from = v; onSettingsChanged(); });
    to.addEventListener('change', () => {
      const next = settings.bands[i + 1];
      const lo = b.from + 1, hi = next ? next.to - 1 : 20000;
      const v = Math.max(lo, Math.min(hi, Number(to.value)));
      b.to = v; if (next) next.from = v; else settings.lambdaMax = v;
      onSettingsChanged();
    });
    R.addEventListener('change', () => { b.R = Math.max(0, Math.min(1, Number(R.value) / 100)); onSettingsChanged(); });
    x.addEventListener('click', () => {
      if (settings.bands.length === 1) return;
      if (i > 0) { settings.bands[i - 1].to = b.to; settings.bands.splice(i, 1); }
      else { settings.bands[1].from = b.from; settings.bands.splice(0, 1); }
      onSettingsChanged();
    });
    row.append(from, to, R, x); box.appendChild(row);
  });
  const add = document.createElement('button'); add.type = 'button'; add.className = 'chip band-add'; add.textContent = '+ Split widest band';
  add.addEventListener('click', () => {
    let wi = 0; settings.bands.forEach((b, i) => { if (b.to - b.from > settings.bands[wi].to - settings.bands[wi].from) wi = i; });
    const b = settings.bands[wi]; const mid = Math.round((b.from + b.to) / 2);
    if (mid - b.from < 2) return;
    settings.bands.splice(wi, 1, { from: b.from, to: mid, R: b.R }, { from: mid, to: b.to, R: b.R });
    onSettingsChanged();
  });
  box.appendChild(add);
}

function syncForm() {
  $('lambda-min').value = settings.lambdaMin; $('lambda-max').value = settings.lambdaMax; $('points').value = settings.points;
  $('transition').value = settings.transition;
  fillSelect($('mat-h'), LAYER_MATERIALS, settings.H); fillSelect($('mat-l'), LAYER_MATERIALS, settings.L); fillSelect($('substrate'), SUBSTRATES, settings.substrate);
  for (const b of $('start-material').querySelectorAll('button')) { const on = b.dataset.start === settings.startMaterial; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); }
  $('multi-start').checked = settings.startMode === 'multi';
  $('start-thickness').value = settings.startThickness;
  $('explore-budget').value = settings.exploreBudget;
  $('row-budget').hidden = settings.startMode !== 'multi';
  $('max-layers').value = settings.maxLayers; $('max-tot').value = settings.maxTOT; $('target-merit').value = settings.targetMerit.toExponential(0).replace('e+', 'e');
  $('thin-layer').value = settings.thinLayer; $('needle-width').value = settings.needleWidth; $('candidates').value = settings.candidates;
  $('dense-check').checked = settings.denseCheck; $('enrich-grid').checked = settings.enrichGrid; $('enrich-grid').disabled = !settings.denseCheck;
  $('legend-zone').hidden = !(settings.transition > 0 && settings.bands.length > 1);
  renderPresets(); renderBands(); updateMeritHint(); updateLegendMaterials(); updateStartHint();
}

function updateMeritHint() {
  const F = settings.targetMerit;
  $('merit-hint').textContent = Number.isFinite(F) && F > 0 ? `Equivalent RMS deviation of R ≈ ${(100 * Math.sqrt(F)).toPrecision(2)} %` : 'Enter a positive number, e.g. 1e-4';
}
function updateLegendMaterials() {
  $('legend-h').textContent = `${materialH()?.label ?? 'H'} (H)`;
  $('legend-l').textContent = `${materialL()?.label ?? 'L'} (L)`;
}
function updateStartHint() {
  if (settings.startMode !== 'multi') { $('start-hint').textContent = ''; return; }
  try {
    const list = startDesigns(engineConfig(), lambdaCenter());
    $('start-hint').textContent = `${list.length} starting designs are synthesized in the background (your single layer, L and H layers of 1–8 quarter‑waves, a quarter‑wave stack); the best result is then replayed on the dashboard.`;
  } catch { $('start-hint').textContent = ''; }
}

function bindForm() {
  const num = (id, key, parse = Number) => $(id).addEventListener('change', () => { settings[key] = parse($(id).value); onSettingsChanged(); });
  $('lambda-min').addEventListener('change', () => { const v = Number($('lambda-min').value); settings.lambdaMin = v; settings.bands[0].from = v; onSettingsChanged(); });
  $('lambda-max').addEventListener('change', () => { const v = Number($('lambda-max').value); settings.lambdaMax = v; settings.bands[settings.bands.length - 1].to = v; onSettingsChanged(); });
  num('points', 'points', (v) => Math.round(Number(v)));
  num('transition', 'transition');
  $('mat-h').addEventListener('change', () => { settings.H = $('mat-h').value; onSettingsChanged(); });
  $('mat-l').addEventListener('change', () => { settings.L = $('mat-l').value; onSettingsChanged(); });
  $('substrate').addEventListener('change', () => { settings.substrate = $('substrate').value; onSettingsChanged(); });
  for (const b of $('start-material').querySelectorAll('button')) b.addEventListener('click', () => { settings.startMaterial = b.dataset.start; onSettingsChanged(); });
  $('multi-start').addEventListener('change', () => { settings.startMode = $('multi-start').checked ? 'multi' : 'single'; onSettingsChanged(); });
  num('start-thickness', 'startThickness');
  num('explore-budget', 'exploreBudget');
  num('max-layers', 'maxLayers', (v) => Math.round(Number(v)));
  num('max-tot', 'maxTOT');
  $('target-merit').addEventListener('change', () => { settings.targetMerit = Number($('target-merit').value); onSettingsChanged(); });
  num('thin-layer', 'thinLayer'); num('needle-width', 'needleWidth'); num('candidates', 'candidates', (v) => Math.round(Number(v)));
  $('dense-check').addEventListener('change', () => { settings.denseCheck = $('dense-check').checked; onSettingsChanged(); });
  $('enrich-grid').addEventListener('change', () => { settings.enrichGrid = $('enrich-grid').checked; onSettingsChanged(); });
}

function onSettingsChanged() {
  settings.bands.sort((a, b) => a.from - b.from);
  settings.bands[0].from = settings.lambdaMin; settings.bands[settings.bands.length - 1].to = settings.lambdaMax;
  for (let i = 0; i < settings.bands.length - 1; i++) settings.bands[i + 1].from = settings.bands[i].to;
  settings.preset = null;
  syncForm();
  resetRun();
}

function validate() {
  const c = { ...settings, H: materialH(), L: materialL(), startMaterial: startMat() };
  const v = validateConfig(c);
  const box = $('errors'); box.hidden = v.ok; box.innerHTML = v.errors.map((e) => `<div>${e}</div>`).join('');
  $('btn-run').disabled = !v.ok;
  return v.ok;
}

/* ------------------------------------------------------------------ */
/*  Charts and display state                                           */
/* ------------------------------------------------------------------ */
const spectrum = new SpectrumChart($('spectrum'), $('tt-spectrum'));
const needle = new NeedleChart($('needle'), $('tt-needle'));
const structure = new StructureChart($('structure'), $('tt-structure'));
const meritChart = new MeritChart($('merit'));

spectrum.onChange = ({ bands, lambdaMin, lambdaMax, commit }) => {
  settings.bands = bands; settings.lambdaMin = lambdaMin; settings.lambdaMax = lambdaMax; settings.preset = null;
  if (commit) { onSettingsChanged(); } else {
    const { grid, target, weights } = buildProblem();
    spectrum.set({ bands, lambdaMin, lambdaMax, grid, target, weights });
    $('lambda-min').value = lambdaMin; $('lambda-max').value = lambdaMax; renderBands();
  }
};

const DISPLAY_POINTS = 361;
const view = {
  R: null, goalR: null, tauR: 0.08,
  layers: [], tauD: 0.08,
  xmax: 1, goalXmax: 1,
  highlight: null, insertion: null, candidate: null,
  displayGrid: null, curve: null, curveDirty: true, hideCurve: false,
};
const run = {
  gen: null, running: false, paused: false, finished: false, exploring: false, worker: null,
  speed: 'live', holdUntil: 0, lastTime: 0,
  stepTo: null,
  history: [], events: 0, F0: null, lastResult: null, cycle: 0, stage: '', engineLayers: [], problem: null, added: new Set(),
  dense: null, startName: null, exploreResults: [], exploreRanked: null, cfg: null,
  ghosts: [], logExpanded: false,
};
const LOG_TAIL = 5;
const SPEED = { cinematic: 2.2, live: 1, fast: 0.25, instant: 0 };
const HOLD = { start: 500, stage: 0, refine: 5, refined: 260, cycle: 200, scan: 950, compare: 900, needle: 1500, 'needle-rejected': 450, growth: 1400, cleanup: 950, note: 500, dense: 250, grid: 900, done: 0 };

function toDisplayLayers(layers) {
  const Hk = settings.H;
  return layers.map((L) => ({ m: L.m, n: L.n, d: L.d, goal: L.d, isH: L.m === Hk, inserted: !!L.inserted }));
}

function setInitialDesign() {
  const { grid, target, weights } = buildProblem();
  run.problem = { grid, target, weights };
  run.added = new Set(); run.dense = null; run.startName = null; run.exploreResults = []; run.exploreRanked = null;
  const sm = startMat();
  const layers = [{ n: sm.n, m: sm.key, d: settings.startThickness }];
  const R = reflectance(layers, grid, substrate().n);
  view.R = Float64Array.from(R); view.goalR = R;
  view.layers = toDisplayLayers(layers);
  view.displayGrid = uniformGrid(settings.lambdaMin, settings.lambdaMax, DISPLAY_POINTS); view.curveDirty = true;
  view.goalXmax = Math.max(50, settings.startThickness * 1.08); view.xmax = view.goalXmax;
  view.highlight = null; view.insertion = null; view.candidate = null;
  spectrum.set({ lambdaMin: settings.lambdaMin, lambdaMax: settings.lambdaMax, bands: settings.bands, grid, target, weights, added: run.added, transition: settings.transition, R: view.R, curve: null, editable: true });
  needle.set({ xmax: view.xmax, layers: view.layers, scan: null, candidate: null, insertion: null, stale: false });
  structure.set({ xmax: view.xmax, layers: view.layers, nmax: Math.max(materialH().n, materialL().n), highlight: null, substrate: substrate().label, ns: substrate().n });
  meritChart.set({ history: [], targetF: settings.targetMerit });
  const F = merit(R, target, weights);
  updateTiles({ F, layers, stage: 'Ready' });
  $('progress-bar').style.width = '0%';
  $('result-line').textContent = ''; $('result-line').classList.remove('good');
  $('cycle-label').textContent = 'Not started';
  $('explore-list').hidden = true; $('explore-list').innerHTML = ''; $('btn-starts').hidden = true; document.querySelector('#card-stats .tiles').hidden = false;
  run.ghosts = []; view.hideCurve = false; spectrum.set({ ghosts: [], ghostHighlight: null }); $('legend-ghost').hidden = true;
  needle.set({ annotations: null, banner: null });
  $('log').innerHTML = ''; run.logExpanded = false; $('btn-log-all').hidden = true;
  $('btn-export').disabled = true;
  run.lastResult = null; run.history = []; run.F0 = F; run.events = 0; run.engineLayers = layers;
  updateCurve(true);
}

function updateTiles({ F, layers, stage }) {
  const tot = totalOpticalThickness(layers);
  $('t-merit').textContent = fmt.sci(F);
  $('t-rms').textContent = `${(100 * Math.sqrt(Math.max(F, 0))).toFixed(3)} %`;
  if (run.dense) $('t-maxdev').textContent = `dense grid: ${(100 * Math.sqrt(run.dense.F)).toFixed(3)} % · max ${(100 * run.dense.maxDev).toFixed(2)} p.p.`;
  else if (run.problem && view.goalR) {
    let md = 0; for (let i = 0; i < view.goalR.length; i++) if (run.problem.weights[i] > 0) md = Math.max(md, Math.abs(view.goalR[i] - run.problem.target[i]));
    $('t-maxdev').textContent = `max |ΔR| ${(100 * md).toFixed(2)} p.p.`;
  }
  $('t-layers').textContent = String(layers.length); $('t-layers-sub').textContent = `of ${settings.maxLayers} max`;
  $('t-tot').textContent = `${tot.toFixed(0)} nm`; $('t-tot-sub').textContent = `of ${settings.maxTOT} nm max · ${(tot / (settings.lambdaMin + settings.lambdaMax) * 8).toFixed(1)} QWOT`;
  $('t-merit-sub').textContent = `target ${settings.targetMerit.toExponential(0)} · ${run.problem ? run.problem.grid.length : settings.points} points`;
  if (run.F0 && settings.targetMerit < run.F0) {
    const p = Math.max(0, Math.min(1, Math.log(run.F0 / Math.max(F, 1e-300)) / Math.log(run.F0 / settings.targetMerit)));
    $('progress-bar').style.width = `${(100 * p).toFixed(1)}%`;
  }
  if (stage) $('cycle-label').textContent = stage;
}

function setStage(text, cls) {
  $('stage-text').textContent = text;
  const el = $('stage-indicator'); el.className = 'stage-indicator' + (cls ? ' ' + cls : '');
}

function log(kind, html) {
  const ol = $('log');
  const li = document.createElement('li'); li.className = kind;
  li.innerHTML = `<span class="tag">${kind}</span><span>${html}</span>`;
  ol.appendChild(li);
  while (ol.children.length > 400) ol.removeChild(ol.firstChild);
  updateLogView();
}

function updateLogView() {
  const ol = $('log'); const items = ol.children; const n = items.length;
  for (let i = 0; i < n; i++) items[i].classList.toggle('folded', !run.logExpanded && i < n - LOG_TAIL);
  const btn = $('btn-log-all'); btn.hidden = n <= LOG_TAIL;
  btn.textContent = run.logExpanded ? `Last ${LOG_TAIL} only` : `Show all (${n})`;
  ol.scrollTop = ol.scrollHeight;
}

function pushHistory(F, mark) { run.history.push({ F, mark }); meritChart.set({ history: run.history }); }

function updateCurve(force) {
  if (view.hideCurve) { if (spectrum.state.curve) spectrum.set({ curve: null }); return; }
  if (!view.displayGrid || (!view.curveDirty && !force)) return;
  const layers = view.layers.map((L) => ({ n: L.n, d: Math.max(0, L.d) }));
  const R = reflectance(layers, view.displayGrid, substrate().n);
  view.curve = { wl: view.displayGrid, R };
  view.curveDirty = false;
  spectrum.set({ curve: view.curve });
}

function syncStructure() { structure.set({ layers: view.layers, xmax: view.xmax, highlight: view.highlight }); }
function highlightGhost(index) {
  const list = run.ghosts.filter(Boolean);
  const gh = index != null ? run.ghosts[index] : null;
  spectrum.set({ ghostHighlight: gh ? list.indexOf(gh) : null });
  if (gh) {
    const disp = toDisplayLayers(gh.design); const total = gh.design.reduce((a, L) => a + L.d, 0);
    structure.set({ layers: disp, xmax: Math.max(view.xmax, total * 1.06), highlight: null });
  } else syncStructure();
}
function matLabel(n) { return n === materialH().n ? materialH().label : materialL().label; }

/* ------------------------------------------------------------------ */
/*  Event application                                                  */
/* ------------------------------------------------------------------ */
function layersFromEvent(evLayers, { animate = true } = {}) {
  const same = evLayers.length === view.layers.length;
  if (same) {
    for (let i = 0; i < evLayers.length; i++) { const v = view.layers[i], L = evLayers[i]; v.goal = L.d; v.m = L.m; v.n = L.n; v.isH = L.m === settings.H; if (!animate) v.d = L.d; }
  } else {
    view.layers = toDisplayLayers(evLayers);
  }
  const total = evLayers.reduce((s, L) => s + L.d, 0);
  view.goalXmax = Math.max(50, total * 1.06, view.scanTotal ? view.scanTotal * 1.06 : 0);
  run.engineLayers = evLayers;
  view.curveDirty = true;
}

function applyEvent(ev, snap) {
  run.events++;
  switch (ev.type) {
    case 'start': {
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      layersFromEvent(ev.layers, { animate: !snap });
      run.F0 = ev.F; pushHistory(ev.F, null);
      if (ev.name) run.startName = ev.name;
      log('start', `Starting design${ev.name ? ` «${ev.name}»` : ''}: ${ev.layers.map((L) => `${L.m} ${L.d.toFixed(1)} nm`).join(', ')} · F = ${fmt.sci(ev.F)}`);
      setStage('Initial refinement', 'running'); run.stage = 'Initial refinement';
      updateTiles({ F: ev.F, layers: ev.layers, stage: 'Initial refinement' });
      break;
    }
    case 'stage': {
      const names = { refine: ev.label || 'Refinement', needle: 'Needle search', cleanup: 'Thin‑layer cleanup', growth: 'Thickness growth', final: 'Final optimization' };
      run.stage = names[ev.stage] || ev.stage;
      setStage(`${run.cycle ? `Cycle ${run.cycle} · ` : ''}${run.stage}`, 'running');
      $('cycle-label').textContent = run.cycle ? `Cycle ${run.cycle}` : 'Starting';
      if (ev.stage === 'needle' || ev.stage === 'growth' || ev.stage === 'cleanup' || ev.stage === 'final') { view.highlight = null; view.insertion = null; syncStructure(); needle.set({ insertion: null }); }
      if (ev.stage === 'refine') { view.tauD = 0.08; if (needle.state.scan) needle.set({ stale: true }); }
      break;
    }
    case 'cycle': { run.cycle = ev.cycle; break; }
    case 'refine': {
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      layersFromEvent(ev.layers, { animate: !snap });
      updateTiles({ F: ev.F, layers: ev.layers });
      break;
    }
    case 'refined': {
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      layersFromEvent(ev.layers, { animate: !snap });
      pushHistory(ev.F, null);
      updateTiles({ F: ev.F, layers: ev.layers });
      log('refine', `${run.stage}: F = <span class="v">${fmt.sci(ev.F)}</span> after ${ev.iterations} LM iterations (${ev.reason}).`);
      run.lastResult = { layers: ev.layers, R: ev.R, F: ev.F, reason: null, stats: null };
      $('btn-export').disabled = false;
      view.highlight = null; syncStructure();
      break;
    }
    case 'dense': {
      run.dense = { F: ev.F, maxDev: ev.maxDev, points: ev.points };
      updateTiles({ F: ev.Fgrid, layers: run.engineLayers });
      log('dense', `Independent check on ${ev.points} points: F = <span class="v">${fmt.sci(ev.F)}</span> (grid F = ${fmt.sci(ev.Fgrid)}), max |ΔR| = ${(100 * ev.maxDev).toFixed(2)} p.p.`);
      break;
    }
    case 'grid': {
      run.problem = { grid: ev.wavelengths, target: ev.target, weights: ev.weights };
      for (const w of ev.added) run.added.add(w);
      spectrum.set({ grid: ev.wavelengths, target: ev.target, weights: ev.weights, added: run.added });
      view.goalR = ev.R; view.R = Float64Array.from(ev.R);
      layersFromEvent(ev.layers, { animate: !snap });
      updateTiles({ F: ev.F, layers: ev.layers });
      log('grid', `Grid enriched: +${ev.added.length} spectral points where the dense check found the largest errors (${ev.added.map((w) => w.toFixed(1)).join(', ')} nm) → ${ev.wavelengths.length} points. F on the new grid = ${fmt.sci(ev.F)}.`);
      break;
    }
    case 'scan': {
      view.scanTotal = ev.total;
      const scanLayers = toDisplayLayers(ev.layers);
      const c = ev.candidates[0] || null;
      view.candidate = c ? { ...c, pulse: 0, label: `best g: ${matLabel(c.nm)} at z = ${c.z.toFixed(1)} nm (g = ${(c.g).toExponential(2)})` } : null;
      needle.set({ scan: { z: ev.z, g: ev.g, layer: ev.layer }, layers: scanLayers, candidate: view.candidate, insertion: null, stale: false });
      view.insertion = null;
      view.goalXmax = Math.max(view.goalXmax, ev.total * 1.06);
      break;
    }
    case 'compare': {
      const rows = ev.trials.map((t) => {
        const where = t.kind === 'interior' ? `layer ${t.layer + 1}` : t.kind === 'substrate' ? 'substrate side' : 'air side';
        const ok = t.ok && t.Frefined != null;
        const gain = ok ? `${(100 * (1 - t.Frefined / ev.parentF)).toFixed(1)} %` : '—';
        return { ok, html: `<tr><td>${t.material} in ${where}</td><td>${t.z.toFixed(1)} nm</td><td>${t.g.toExponential(2)}</td><td>${ok ? fmt.sci(t.Frefined) : (t.why || 'rejected')}</td><td>${gain}</td></tr>`, F: ok ? t.Frefined : Infinity };
      });
      let bi = -1; rows.forEach((r, i) => { if (r.F < (bi < 0 ? Infinity : rows[bi].F)) bi = i; });
      const table = `<table class="cmp"><tr><th>candidate</th><th>z</th><th>g, nm⁻¹</th><th>F after refinement</th><th>gain</th></tr>${rows.map((r, i) => r.html.replace('<tr>', i === bi && r.F < ev.parentF ? '<tr class="chosen">' : '<tr>')).join('')}</table>`;
      log('compare', `${ev.trials.length} needle candidate${ev.trials.length > 1 ? 's' : ''} refined independently (parent F = ${fmt.sci(ev.parentF)}):${table}`);
      break;
    }
    case 'needle': {
      const c = ev.candidate;
      const idx = ev.layers.findIndex((L) => L.inserted);
      const disp = toDisplayLayers(ev.layers);
      if (idx >= 0 && !snap) { disp[idx].d = 0; disp[idx].goal = ev.layers[idx].d; }
      view.layers = disp; run.engineLayers = ev.layers; view.curveDirty = true;
      view.highlight = { index: idx, kind: 'inserted', pulse: 1 };
      view.insertion = { z: c.z, width: snap ? ev.eta : 0, goal: ev.eta };
      view.candidate = { ...c, pulse: 1, label: `insert ${matLabel(c.nm)} at z = ${c.z.toFixed(1)} nm (g = ${c.g.toExponential(2)})` };
      needle.set({ insertion: view.insertion, candidate: view.candidate, stale: false });
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      view.tauD = 0.35;
      pushHistory(ev.F, 'needle');
      updateTiles({ F: ev.F, layers: ev.layers });
      const where = c.kind === 'interior' ? `inside layer ${c.layer + 1}` : c.kind === 'substrate' ? 'at the substrate' : 'at the outer surface';
      log('needle', `Needle of ${ev.material} inserted ${where}, z = <span class="v">${c.z.toFixed(1)} nm</span>, width ${ev.eta.toFixed(2)} nm · g = ${c.g.toExponential(2)} nm⁻¹ · F ${fmt.sci(ev.Fparent)} → ${fmt.sci(ev.F)}${ev.alternatives > 1 ? ` · best of ${ev.alternatives} refined alternatives` : ''}.`);
      break;
    }
    case 'needle-rejected': {
      log('reject', `Needle candidate in layer ${ev.candidate.layer + 1} (z = ${ev.candidate.z.toFixed(1)} nm) rejected: ${ev.why}.`);
      if (ev.layers) { layersFromEvent(ev.layers, { animate: !snap }); view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R); updateTiles({ F: ev.F, layers: ev.layers }); }
      view.highlight = null; view.insertion = null; syncStructure();
      needle.set({ insertion: null, stale: true });
      break;
    }
    case 'growth': {
      layersFromEvent(ev.layers, { animate: !snap });
      view.highlight = { index: ev.layer, kind: 'growth', pulse: 1 };
      view.tauD = 0.6;
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      pushHistory(ev.F, 'growth');
      updateTiles({ F: ev.F, layers: ev.layers });
      needle.set({ stale: true, candidate: null, insertion: null });
      log('growth', `Layer ${ev.layer + 1} (${ev.layers[ev.layer].m}) grown ${ev.from.toFixed(1)} → <span class="v">${ev.to.toFixed(1)} nm</span> to the nearest merit minimum · F ${fmt.sci(ev.Fparent)} → ${fmt.sci(ev.F)}.`);
      break;
    }
    case 'cleanup': {
      layersFromEvent(ev.layers, { animate: false });
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      pushHistory(ev.F, 'cleanup');
      updateTiles({ F: ev.F, layers: ev.layers });
      needle.set({ stale: true, candidate: null, insertion: null });
      log('cleanup', `${ev.removed} thin layer${ev.removed > 1 ? 's' : ''} (< ${settings.thinLayer} nm) removed; ${ev.before.length} → ${ev.layers.length} layers · F = ${fmt.sci(ev.F)} before re‑optimization.`);
      break;
    }
    case 'note': { log('note', ev.text); break; }
    case 'final-scan': {
      view.scanTotal = ev.total;
      const annotations = ev.trials.map((t) => ({ z: t.z, g: t.g, gain: t.delta != null && t.delta < -1e-6, label: t.delta == null ? 'no admissible width' : `ΔF ${t.delta >= 0 ? '+' : '−'}${(100 * Math.abs(t.delta)).toFixed(2)} %` }));
      needle.set({ scan: { z: ev.z, g: ev.g, layer: ev.layer }, layers: toDisplayLayers(ev.layers), candidate: null, insertion: null, stale: false, annotations, banner: ev.verdict.text, bannerKind: ev.verdict.kind });
      view.goalXmax = Math.max(50, ev.total * 1.06);
      const rows = ev.trials.map((t) => `<tr><td>${t.material} in ${t.kind === 'interior' ? `layer ${t.layer + 1}` : t.kind === 'substrate' ? 'substrate side' : 'air side'}</td><td>${t.z.toFixed(1)} nm</td><td>${t.g.toExponential(2)}</td><td>${t.Frefined != null ? fmt.sci(t.Frefined) : (t.eta == null ? 'no admissible width' : '—')}</td><td>${t.delta != null ? `${t.delta >= 0 ? '+' : '−'}${(100 * Math.abs(t.delta)).toFixed(2)} %` : '—'}</td></tr>`).join('');
      log('final', `Final needle check (F = ${fmt.sci(ev.F)}): ${ev.verdict.text}${ev.trials.length ? `<table class="cmp"><tr><th>candidate</th><th>z</th><th>g, nm⁻¹</th><th>F after refinement</th><th>ΔF</th></tr>${rows}</table>` : ''}`);
      break;
    }
    case 'done': {
      layersFromEvent(ev.layers, { animate: !snap });
      view.goalR = ev.R; if (snap) view.R = Float64Array.from(ev.R);
      view.highlight = null; view.insertion = null; syncStructure();
      needle.set({ insertion: null, candidate: null, stale: true });
      pushHistory(ev.F, 'done');
      if (ev.dense) run.dense = { F: ev.dense.F, maxDev: ev.dense.maxDev, points: ev.dense.wavelengths.length };
      run.problem = { grid: ev.grid.wavelengths, target: ev.grid.target, weights: ev.grid.weights };
      updateTiles({ F: ev.F, layers: ev.layers, stage: `Finished · ${ev.reason.split(' · ')[0]}` });
      run.lastResult = { layers: ev.layers, R: ev.R, F: ev.F, reason: ev.reason, stats: ev.stats, dense: ev.dense, grid: ev.grid, elapsedMs: ev.elapsedMs };
      run.finished = true; run.running = false;
      const ok = ev.F <= settings.targetMerit && (!ev.dense || ev.dense.F <= settings.targetMerit);
      setStage(`Finished — ${ev.reason.split(' · ')[0]}`, 'done'); $('stage-text').title = ev.reason;
      const rl = $('result-line');
      rl.innerHTML = `<b>${ev.reason}.</b> ${run.startName ? `Start «${run.startName}»${run.exploreRanked ? ` (best of ${run.exploreRanked.length})` : ''}. ` : ''}${ev.layers.length} layers, F = ${fmt.sci(ev.F)}, RMS ${(100 * Math.sqrt(ev.F)).toFixed(3)} %${ev.dense ? ` (dense grid ${(100 * Math.sqrt(ev.dense.F)).toFixed(3)} %, max ${(100 * ev.dense.maxDev).toFixed(2)} p.p.)` : ''}, optical thickness ${ev.opticalThickness.toFixed(0)} nm.`;
      rl.classList.toggle('good', ok);
      log('done', `${ev.reason}. Final design: ${ev.layers.length} layers, F = <span class="v">${fmt.sci(ev.F)}</span>${ev.dense ? `, dense‑grid F = ${fmt.sci(ev.dense.F)}` : ''}. Needles ${ev.stats.needles} (of ${ev.stats.compared} refined alternatives), growth steps ${ev.stats.growths}, thin layers removed ${ev.stats.cleanups}${ev.stats.pointsAdded ? `, grid points added ${ev.stats.pointsAdded}` : ''}, ${(ev.elapsedMs / 1000).toFixed(1)} s of computation.`);
      $('btn-run').textContent = 'Start synthesis'; $('btn-export').disabled = false; $('btn-step').disabled = true;
      unlockSidebar();
      break;
    }
    default: break;
  }
}

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */
function lockSidebar() { $('sidebar').classList.add('locked'); spectrum.set({ editable: false }); }
function unlockSidebar() { $('sidebar').classList.remove('locked'); spectrum.set({ editable: true }); }

function startRun() {
  if (!validate()) return;
  setInitialDesign();
  run.cfg = engineConfig();
  run.running = true; run.paused = false; run.finished = false; run.holdUntil = 0; run.cycle = 0; run.stepTo = null;
  lockSidebar();
  $('btn-run').textContent = 'Pause'; $('btn-step').disabled = false; $('btn-export').disabled = true;
  if (settings.startMode === 'multi') startExploration();
  else { run.gen = synthesize(run.cfg); setStage('Starting…', 'running'); }
}

function startExploration() {
  const cfg = { ...run.cfg, budgetMs: 1000 * settings.exploreBudget };
  const list = startDesigns(cfg, lambdaCenter());
  run.exploring = true; run.gen = null; run.exploreResults = [];
  const ol = $('explore-list'); ol.hidden = false; ol.innerHTML = ''; ol.classList.add('exploring'); document.querySelector('#card-stats .tiles').hidden = true;
  list.forEach((s, i) => {
    const li = document.createElement('li'); li.id = `explore-${i}`; li.innerHTML = `<span class="n">${i + 1}. ${s.name}</span><span class="f">—</span><span class="l"></span>`;
    li.addEventListener('mouseenter', () => highlightGhost(i)); li.addEventListener('mouseleave', () => highlightGhost(null));
    ol.appendChild(li);
  });
  view.hideCurve = true; spectrum.set({ curve: null, R: null, ghosts: run.ghosts, ghostHighlight: null }); $('legend-ghost').hidden = false;
  setStage(`Exploring ${list.length} starting designs in the background…`, 'running');
  $('cycle-label').textContent = 'Exploration';
  log('explore', `Multi‑start: ${list.length} starting designs, up to ${settings.exploreBudget} s each. The best result is replayed afterwards.`);
  const onEvent = (ev) => {
    if (!run.exploring) return;
    if (ev.type === 'explore-start') {
      const li = $(`explore-${ev.index}`); if (li) li.classList.add('running');
      setStage(`Exploring starting design ${ev.index + 1} of ${ev.total}: ${ev.name}`, 'running');
    } else if (ev.type === 'explore-result') {
      run.exploreResults.push(ev);
      const Rg = reflectance(ev.layers.map((L) => ({ n: L.n, d: L.d })), view.displayGrid, substrate().n);
      run.ghosts[ev.index] = { wl: view.displayGrid, R: Rg, name: ev.name, F: ev.score, layers: ev.layers.length, design: ev.layers, best: false };
      let bi = -1; run.ghosts.forEach((g, i) => { if (g && (bi < 0 || g.F < run.ghosts[bi].F)) bi = i; }); run.ghosts.forEach((g, i) => { if (g) g.best = i === bi; });
      spectrum.set({ ghosts: run.ghosts.filter(Boolean).map((g) => g) });
      const li = $(`explore-${ev.index}`);
      if (li) { li.classList.remove('running'); li.querySelector('.f').textContent = `F ${fmt.sci(ev.score)}`; li.querySelector('.l').textContent = `${ev.layers.length} L`; }
      log('explore', `Start «${ev.name}»: ${ev.layers.length} layers, F = <span class="v">${fmt.sci(ev.F)}</span>${ev.Fdense != null ? ` (dense ${fmt.sci(ev.Fdense)})` : ''}, ${ev.reason.toLowerCase()}, ${(ev.elapsedMs / 1000).toFixed(1)} s.`);
    } else if (ev.type === 'explore-done') {
      run.exploring = false;
      if (run.worker) { run.worker.terminate(); run.worker = null; }
      const best = ev.best;
      ev.results.forEach((r, rank) => { const li = $(`explore-${r.index}`); if (li) { li.classList.toggle('best', rank === 0); if (rank === 0) li.querySelector('.n').textContent = `★ ${r.name}`; } });
      log('explore', `Best starting design: «${best.name}» (F = ${fmt.sci(best.F)}, ${best.layers.length} layers). Replaying its evolution.`);
      run.startName = best.name; run.exploreRanked = ev.results;
      document.querySelector('#card-stats .tiles').hidden = false; $('btn-starts').hidden = false; $('explore-list').classList.remove('exploring');
      view.hideCurve = false; view.curveDirty = true;
      // replay deterministically: a budget-limited start is replayed with the same amount of work
      const replayCfg = { ...run.cfg, start: { ...best.start, name: best.name } };
      if (best.stopKind === 'budget') { replayCfg.maxRefinements = best.refinements; replayCfg.budgetReason = best.baseReason; }
      run.gen = synthesize(replayCfg);
      run.holdUntil = 0;
      setStage(`Replaying the best start: ${best.name}`, 'running');
    } else if (ev.type === 'explore-error') {
      log('note', `Exploration failed: ${ev.message}. Falling back to the single starting layer.`);
      run.exploring = false; if (run.worker) { run.worker.terminate(); run.worker = null; }
      run.gen = synthesize(run.cfg);
    }
  };
  try {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => onEvent(e.data);
    w.onerror = (e) => { onEvent({ type: 'explore-error', message: e.message || 'worker error' }); };
    w.postMessage(cfg);
    run.worker = w;
  } catch (err) {
    // no worker support: run the exploration cooperatively on the main thread
    const it = explore(cfg);
    const step = () => { if (!run.exploring) return; const r = it.next(); if (r.done) return; onEvent(r.value); setTimeout(step, 0); };
    setTimeout(step, 0);
  }
}

function resetRun() {
  run.gen = null; run.running = false; run.paused = false; run.finished = false; run.stepTo = null; run.exploring = false;
  if (run.worker) { run.worker.terminate(); run.worker = null; }
  unlockSidebar();
  validate();
  setInitialDesign();
  $('btn-run').textContent = 'Start synthesis'; $('btn-step').disabled = false;
  setStage('Ready — draw the target and press Start', '');
}

function pullEvent(snap) {
  if (!run.gen) return null;
  const r = run.gen.next();
  if (r.done) { run.running = false; return null; }
  applyEvent(r.value, snap);
  return r.value;
}

const SIGNIFICANT = new Set(['scan', 'compare', 'needle', 'growth', 'cleanup', 'grid', 'done', 'refined']);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (run.lastTime || now)) / 1000); run.lastTime = now;
  const factor = SPEED[run.speed];
  if (run.gen && (run.running && !run.paused || run.stepTo)) {
    if (run.stepTo) {
      for (let i = 0; i < 20000; i++) { const ev = pullEvent(true); if (!ev || SIGNIFICANT.has(ev.type)) break; }
      run.stepTo = null; run.paused = true; if (!run.finished) { $('btn-run').textContent = 'Resume'; setStage(`${$('stage-text').textContent} · paused`, 'paused'); }
    } else if (factor === 0) {
      const t0 = performance.now();
      while (performance.now() - t0 < 12) { const ev = pullEvent(true); if (!ev) break; }
    } else {
      let guard = 0;
      while (now >= run.holdUntil && guard++ < 400) {
        const ev = pullEvent(false); if (!ev) break;
        const hold = (HOLD[ev.type] ?? 0) * factor;
        if (hold > 0) { run.holdUntil = now + hold; break; }
      }
    }
  }
  animate(dt, factor === 0);
}

function animate(dt, snap) {
  if (view.goalR) {
    if (!view.R || view.R.length !== view.goalR.length) view.R = Float64Array.from(view.goalR);
    const a = snap ? 1 : 1 - Math.exp(-dt / view.tauR);
    let moved = false;
    for (let i = 0; i < view.R.length; i++) { const d = view.goalR[i] - view.R[i]; if (Math.abs(d) > 1e-7) { view.R[i] += d * a; moved = true; } }
    if (moved || snap) spectrum.set({ R: view.R });
  }
  let moved = false;
  const a = snap ? 1 : 1 - Math.exp(-dt / view.tauD);
  for (const L of view.layers) { const d = L.goal - L.d; if (Math.abs(d) > 1e-4) { L.d += d * a; moved = true; } else if (L.d !== L.goal) { L.d = L.goal; moved = true; } }
  const dx = view.goalXmax - view.xmax; if (Math.abs(dx) > 0.5) { view.xmax += dx * (snap ? 1 : 1 - Math.exp(-dt / 0.4)); moved = true; }
  if (view.highlight) { view.highlight.pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180); moved = true; }
  if (view.insertion) { const w = view.insertion.goal - view.insertion.width; if (Math.abs(w) > 1e-3) { view.insertion.width += w * (snap ? 1 : 1 - Math.exp(-dt / 0.3)); needle.set({ insertion: view.insertion }); } }
  if (view.candidate && needle.state.candidate && !needle.state.stale) { view.candidate.pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200); needle.set({ candidate: view.candidate }); }
  if (moved) {
    structure.set({ layers: view.layers, xmax: view.xmax, highlight: view.highlight });
    needle.set({ xmax: view.xmax });
    view.curveDirty = true;
  }
  updateCurve(false);
}

/* ------------------------------------------------------------------ */
/*  Export and recipe                                                  */
/* ------------------------------------------------------------------ */
function exportExcel() {
  const res = run.lastResult; if (!res) return;
  const grid = res.grid ? res.grid.wavelengths : run.problem.grid, target = res.grid ? res.grid.target : run.problem.target, weights = res.grid ? res.grid.weights : run.problem.weights;
  let md = 0; for (let i = 0; i < grid.length; i++) if (weights[i] > 0) md = Math.max(md, Math.abs(res.R[i] - target[i]));
  const bytes = resultWorkbook({
    settings: {
      version: VERSION, substrate: substrate(), H: materialH(), L: materialL(), lambdaMin: settings.lambdaMin, lambdaMax: settings.lambdaMax, lambdaCenter: lambdaCenter(), points: settings.points, bands: settings.bands,
      transition: settings.transition, startMaterial: startMat(), startThickness: settings.startThickness, startMode: settings.startMode, startName: run.startName, maxLayers: settings.maxLayers, maxTOT: settings.maxTOT, targetMerit: settings.targetMerit, thinLayer: settings.thinLayer,
      candidates: settings.candidates, denseCheck: settings.denseCheck, enrichGrid: settings.enrichGrid,
    },
    wavelengths: grid, target, weights, R: res.R, layers: res.layers,
    result: { F: res.F, maxDev: md, reason: res.reason || 'Intermediate design (synthesis not finished)', stats: res.stats, dense: res.dense, elapsedMs: res.elapsedMs },
    starts: run.exploreResults,
  });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `MS-Astra-${materialH().key}-${materialL().key}-${res.layers.length}L-${stamp}.xlsx`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function showStarts() {
  const rows = (run.exploreRanked || []).map((r, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${i + 1}. ${r.name}</td><td>${fmt.sci(r.F)}</td><td>${r.Fdense != null ? fmt.sci(r.Fdense) : '—'}</td><td>${r.layers.length}</td><td>${r.opticalThickness.toFixed(0)}</td><td>${(r.elapsedMs / 1000).toFixed(1)}</td><td>${r.reason}</td></tr>`);
  $('starts-table').innerHTML = `<thead><tr><th>Starting design</th><th>F</th><th>dense F</th><th>layers</th><th>nd, nm</th><th>s</th><th>termination</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  $('starts-dialog').showModal();
}

function showRecipe() {
  const layers = run.engineLayers || [];
  const lc = lambdaCenter();
  let z = 0;
  const rows = layers.map((L, i) => { const r = `<tr><td>${i + 1}</td><td>${L.m}</td><td>${L.n.toFixed(2)}</td><td>${L.d.toFixed(2)}</td><td>${(L.n * L.d).toFixed(1)}</td><td>${(4 * L.n * L.d / lc).toFixed(3)}</td><td>${z.toFixed(1)}</td></tr>`; z += L.d; return r; });
  $('recipe').innerHTML = `<thead><tr><th>#</th><th>Material</th><th>n</th><th>d, nm</th><th>nd, nm</th><th>QWOT @ ${lc.toFixed(0)} nm</th><th>z, nm</th></tr></thead><tbody>${rows.join('')}</tbody>
  <tfoot><tr><th colspan="3">Total (layer 1 at the substrate)</th><th>${layers.reduce((s, L) => s + L.d, 0).toFixed(1)}</th><th>${totalOpticalThickness(layers).toFixed(1)}</th><th></th><th></th></tr></tfoot>`;
  $('recipe-dialog').showModal();
}

/* ------------------------------------------------------------------ */
/*  Wiring                                                             */
/* ------------------------------------------------------------------ */
function init() {
  applyPreset(DEFAULTS.preset);
  bindForm(); syncForm(); validate(); setInitialDesign();
  for (const b of $('speed').querySelectorAll('button')) b.addEventListener('click', () => {
    run.speed = b.dataset.speed;
    for (const o of $('speed').querySelectorAll('button')) { const on = o === b; o.classList.toggle('active', on); o.setAttribute('aria-checked', on); }
  });
  for (const b of $('yscale').querySelectorAll('button')) b.addEventListener('click', () => {
    spectrum.set({ yMode: b.dataset.y });
    for (const o of $('yscale').querySelectorAll('button')) o.classList.toggle('active', o === b);
  });
  $('btn-run').addEventListener('click', () => {
    if ((!run.gen && !run.exploring) || run.finished) { startRun(); return; }
    run.paused = !run.paused;
    $('btn-run').textContent = run.paused ? 'Resume' : 'Pause';
    if (run.paused) setStage(`${$('stage-text').textContent} · paused`, 'paused');
    else { setStage($('stage-text').textContent.replace(' · paused', ''), 'running'); run.holdUntil = 0; }
  });
  $('btn-step').addEventListener('click', () => {
    if ((!run.gen && !run.exploring) || run.finished) { if (!validate()) return; startRun(); run.paused = true; }
    if (run.gen) run.stepTo = true;
  });
  $('btn-reset').addEventListener('click', resetRun);
  $('btn-export').addEventListener('click', exportExcel);
  $('btn-recipe').addEventListener('click', showRecipe);
  $('recipe-close').addEventListener('click', () => $('recipe-dialog').close());
  $('btn-starts').addEventListener('click', showStarts);
  $('btn-log-all').addEventListener('click', () => { run.logExpanded = !run.logExpanded; updateLogView(); });
  $('starts-close').addEventListener('click', () => $('starts-dialog').close());
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.code === 'Space') { e.preventDefault(); $('btn-run').click(); }
    if (e.key === 'n' || e.key === 'N') $('btn-step').click();
  });
  requestAnimationFrame(frame);
}

init();
window.msAstra = { settings, run, view, spectrum, needle, structure, meritChart, VERSION };
