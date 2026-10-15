#!/usr/bin/env node
/**
 * Research prototype — strengthened final phase for MS Astra (proposal for 2.4.0).
 * See docs/PROPOSAL-final-phase.md for the algorithm, the measurements and the plan.
 *
 * Runs the released engine (2.3.1) on a preset, then applies the strengthened final
 * phase on top of the reported design and prints the gain in F / RMS and the extra time.
 *
 *   node scripts/research/final-phase-prototype.mjs [presets] [points] [variant]
 *     presets  comma-separated preset keys (default: all)
 *     points   spectral points (default 41; the interface uses 61)
 *     variant  screened | light | full | all (default screened)
 *
 * Moves (each applied only when it lowers the merit; iterated to a fixed point):
 *   1. needle cycle with ALL admissible candidates, each judged by its completed design
 *   2. at the optical-thickness limit: projected-gradient descent on the surface Σ n_j d_j = const
 *   3. at the layer limit: remove one layer (neighbours absorb its optical thickness), refine, then
 *      - screened: rank the N removals by the refined merit, needle cycle (all candidates) on the best 4
 *      - light:    needle cycle (all candidates) after every removal
 *      - full:     continue the whole synthesis after every removal
 *   4. restart the regular synthesis from the current design (growth cycle re-entered)
 * The script is self-contained and never modifies the application.
 */
import { synthesize } from '../../src/synthesis.js';
import { PRESETS, bandsFromPreset, uniformGrid, sampleTarget, sampleDualTarget, materialByKey } from '../../src/config.js';
import { meritOf, evaluate, opticsModel, totalOpticalThickness, scanNeedles, insertNeedle, cleanThinLayers, mergeEqualNeighbours } from '../../src/optics.js';
import { refineToEnd } from '../../src/refine.js';

const keys = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : Object.keys(PRESETS);
const points = Number(process.argv[3] || 41);
const variant = process.argv[4] || 'screened';
const TARGET = 1e-9;        // an unreachable target so that the limits, not the target, stop the run

function cfgOf(key, extra = {}) {
  const p = PRESETS[key]; const bands = bandsFromPreset(p), bands2 = bandsFromPreset(p, 'bands2');
  const wl = uniformGrid(p.range[0], p.range[1], points); const dual = p.pol === 'both' && (p.angle ?? 0) > 0;
  const s = dual ? sampleDualTarget(bands, bands2, wl, 0) : sampleTarget(bands, wl, 0);
  const H = materialByKey(p.H), L = materialByKey(p.L);
  return { wavelengths: wl, target: s.target, weights: s.weights, bands, bands2: dual ? bands2 : null, transition: 0, ns: 1.52, na: p.ambient === 'BK7' ? 1.52 : 1, angle: p.angle ?? 0, pol: p.pol ?? 'avg', materials: { H: { n: H.n, m: H.key }, L: { n: L.n, m: L.key } }, start: { material: p.start.material, thickness: p.start.thickness }, maxLayers: p.maxLayers, maxOpticalThickness: p.maxTOT, targetMerit: TARGET, thinLayer: 1, candidates: 3, budgetMs: 120000, ...extra };
}
const run = (cfg) => { let done = null; for (const ev of synthesize(cfg)) if (ev.type === 'done') done = ev; return done; };
const modelOf = (cfg) => opticsModel({ ns: cfg.ns, na: cfg.na, angle: cfg.angle, pol: cfg.pol });
const F_of = (cfg, ls) => meritOf(ls, cfg.wavelengths, cfg.target, cfg.weights, modelOf(cfg));
const problemOf = (cfg) => ({ wavelengths: cfg.wavelengths, target: cfg.target, weights: cfg.weights, model: modelOf(cfg) });
const lmOpts = (cfg) => ({ maxIter: 300, relTol: 1e-11, totMax: cfg.maxOpticalThickness });
const strip = (ls) => ls.map((L) => ({ m: L.m, n: L.n, d: L.d }));
const dropZero = (ls) => mergeEqualNeighbours(ls.filter((L) => L.d > 1e-9));
const refined = (cfg, ls) => dropZero(refineToEnd(ls, problemOf(cfg), lmOpts(cfg)).layers);
/** Complete a design the way the engine reports it: layers below the threshold removed, refined again. */
const complete = (cfg, ls) => (ls.every((L) => L.d >= cfg.thinLayer - 1e-12) || ls.length <= 1 ? ls : refined(cfg, cleanThinLayers(ls, cfg.thinLayer).layers));
const admissible = (cfg, ls) => ls.length <= cfg.maxLayers && totalOpticalThickness(ls) <= cfg.maxOpticalThickness + 1e-9 && ls.every((L) => L.d >= cfg.thinLayer - 1e-12);
const pct = (a, b) => `${(100 * (b / a - 1)).toFixed(1)} %`;
const rms = (F) => `${(100 * Math.sqrt(F)).toFixed(3)} %`;

/** Move 1 — needle cycle with every admissible candidate, judged by the completed refined design. */
function needleAll(cfg, layers) {
  const H = cfg.materials.H, L = cfg.materials.L; const other = (x) => (x.m === H.m ? L.n : H.n); const matBy = (n) => (n === H.n ? H : L);
  let ls = layers, F = F_of(cfg, ls), steps = 0;
  for (let it = 0; it < 100; it++) {
    const ev = evaluate(ls, cfg.wavelengths, cfg.target, cfg.weights, modelOf(cfg), true);
    const scan = scanNeedles(ls, ev.adjoint, cfg.wavelengths, other);
    const pool = scan.candidates.filter((c) => ls.length + (c.kind === 'interior' ? 2 : 1) <= cfg.maxLayers);
    let best = null;
    for (const cand of pool) {
      const mat = matBy(cand.nm);
      const etaMax = cand.kind === 'interior' ? 2 * Math.min(cand.x, ls[cand.layer].d - cand.x) : 10;
      let eta = Math.min(10, etaMax * 0.5), trial = null;
      while (eta >= 1e-3) { trial = insertNeedle(ls, cand, eta, mat); if (F_of(cfg, trial) <= F + 1e-4 * eta * cand.g && totalOpticalThickness(trial) <= cfg.maxOpticalThickness + 1e-9) break; eta *= 0.5; trial = null; }
      if (!trial) continue;
      const r = complete(cfg, refined(cfg, trial));
      const Fr = F_of(cfg, r);
      if (Fr < F * (1 - 1e-6) && admissible(cfg, r) && (!best || Fr < best.F)) best = { F: Fr, layers: r };
    }
    if (!best) break;
    ls = best.layers; F = best.F; steps++;
  }
  return { layers: ls, F, steps };
}

/** Move 2 — projected-gradient descent on the optical-thickness surface Σ n_j d_j = const, d_j ≥ 0. */
function totSurfaceDescent(cfg, layers) {
  const model = modelOf(cfg); const n = layers.map((L) => L.n);
  let ls = layers.map((L) => ({ ...L })); let F = F_of(cfg, ls); let step = 0.05;
  const proj = (v, free) => { let vn = 0, nn = 0; for (let j = 0; j < v.length; j++) if (free[j]) { vn += v[j] * n[j]; nn += n[j] * n[j]; } return v.map((x, j) => (free[j] ? x - vn / nn * n[j] : 0)); };
  for (let it = 0; it < 300; it++) {
    const g = Array.from(evaluate(ls, cfg.wavelengths, cfg.target, cfg.weights, model).grad);
    const free = ls.map(() => true); let d = proj(g, free);
    for (let k = 0; k < 3; k++) { let changed = false; for (let j = 0; j < d.length; j++) if (free[j] && ls[j].d <= 1e-12 && -d[j] < 0) { free[j] = false; changed = true; } if (!changed) break; d = proj(g, free); }
    const norm = Math.hypot(...d); if (norm < 1e-18) break;
    let accepted = false;
    for (let bt = 0; bt < 30; bt++) { const t = ls.map((L, j) => ({ ...L, d: Math.max(0, L.d - step * d[j] / norm) })); const Ft = F_of(cfg, t); if (Ft < F && totalOpticalThickness(t) <= cfg.maxOpticalThickness + 1e-6) { ls = t; F = Ft; accepted = true; step *= 1.3; break; } step *= 0.5; }
    if (!accepted || step < 1e-9) break;
  }
  const out = complete(cfg, dropZero(ls));
  return { layers: out, F: F_of(cfg, out) };
}

/** Remove layer j; the neighbours absorb its optical thickness (same rule as cleanThinLayers). */
function withoutLayer(layers, j) {
  const list = layers.map((L) => ({ ...L })); const v = list[j];
  if (j === 0 || j === list.length - 1) list.splice(j, 1);
  else { const lo = list[j - 1], up = list[j + 1]; if (lo.m === up.m) list.splice(j - 1, 3, { ...lo, d: lo.d + up.d + v.d * v.n / lo.n }); else { list.splice(j, 1); list[j - 1] = { ...lo, d: lo.d + v.d * v.n / lo.n }; } }
  return mergeEqualNeighbours(list);
}
/** Move 3 — layer removal in three costs. */
function removeLayerMove(cfg, layers, Fref, mode) {
  let best = { F: Fref, layers };
  const explore = (ls) => (mode === 'full' ? (() => { const d = run({ ...cfg, start: { layers: strip(ls) }, candidates: 0, budgetMs: 30000 }); return { F: d.F, layers: strip(d.layers) }; })() : needleAll(cfg, ls));
  if (mode === 'screened') {
    const cands = layers.map((_, j) => { const r = complete(cfg, refined(cfg, withoutLayer(layers, j))); return { j, layers: r, F: F_of(cfg, r) }; }).sort((p, q) => p.F - q.F);
    for (const c of cands.slice(0, 4)) { const n = explore(c.layers); if (n.F < best.F * (1 - 1e-6) && admissible(cfg, n.layers)) best = { F: n.F, layers: n.layers }; }
  } else {
    for (let j = 0; j < layers.length; j++) { const n = explore(complete(cfg, refined(cfg, withoutLayer(layers, j)))); if (n.F < best.F * (1 - 1e-6) && admissible(cfg, n.layers)) best = { F: n.F, layers: n.layers }; }
  }
  return best;
}

/** The strengthened final phase: the four moves iterated to a fixed point (bounded by rounds and time). */
function strengthen(cfg, layers, mode, limitMs) {
  const t0 = Date.now(); let ls = layers, F = F_of(cfg, ls); const log = [];
  const take = (label, cand) => { if (cand.F < F * (1 - 1e-6) && admissible(cfg, cand.layers)) { log.push(`${label}: ${pct(F, cand.F)}`); ls = cand.layers; F = cand.F; } };
  for (let round = 0; round < 8 && Date.now() - t0 < limitMs; round++) {
    const F0 = F;
    take('needles(all)', needleAll(cfg, ls));
    if (totalOpticalThickness(ls) >= cfg.maxOpticalThickness - 1) take('TOT-surface', totSurfaceDescent(cfg, ls));
    if (ls.length >= cfg.maxLayers - 1) take(`remove-layer(${mode})`, removeLayerMove(cfg, ls, F, mode));
    const d = run({ ...cfg, start: { layers: strip(ls) } }); take('restart', { F: d.F, layers: strip(d.layers) });
    if (!(F < F0 * (1 - 1e-3))) break;
  }
  return { layers: ls, F, ms: Date.now() - t0, log };
}

const variants = variant === 'all' ? ['screened', 'light', 'full'] : [variant];
for (const key of keys) {
  const cfg = cfgOf(key);
  const t0 = Date.now(); const base = run(cfg); const tBase = Date.now() - t0;
  console.log(`${key.padEnd(9)} 2.3.1: F=${base.F.toExponential(2)} RMS ${rms(base.F)} ${base.layers.length}L ${base.opticalThickness.toFixed(0)} nm in ${(tBase / 1000).toFixed(1)} s [${base.stop.kind}/${base.stop.needleStop}]`);
  for (const v of variants) {
    const r = strengthen(cfg, strip(base.layers), v, v === 'full' ? 600000 : 240000);
    console.log(`  ${v.padEnd(8)}: F=${r.F.toExponential(2)} RMS ${rms(r.F)} ${r.layers.length}L  gain ${pct(base.F, r.F)}  +${(r.ms / 1000).toFixed(1)} s  (${r.log.join('; ') || 'no change'})`);
  }
}
