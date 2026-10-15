// Research audit of the 2.3.1 stopping criteria (A restart, B all candidates, C TOT-surface descent, D layer removal). See docs/PROPOSAL-final-phase.md.
//   node scripts/research/optimality-audit.mjs [presets]
// Optimality audit of the stopping criteria (MS Astra 2.3.1).
import { synthesize } from '../../src/synthesis.js';
import { PRESETS, bandsFromPreset, uniformGrid, sampleTarget, sampleDualTarget, materialByKey } from '../../src/config.js';
import { meritOf, evaluate, opticsModel, totalOpticalThickness, cleanThinLayers, mergeEqualNeighbours } from '../../src/optics.js';
import { refineToEnd } from '../../src/refine.js';

const only = process.argv[2] ? process.argv[2].split(',') : null;
function cfgOf(key, { points = 41, thin = 1, targetMerit = 1e-9, candidates = 3 } = {}) {
  const p = PRESETS[key]; const bands = bandsFromPreset(p), bands2 = bandsFromPreset(p, 'bands2');
  const wl = uniformGrid(p.range[0], p.range[1], points); const dual = p.pol === 'both' && (p.angle ?? 0) > 0;
  const s = dual ? sampleDualTarget(bands, bands2, wl, 0) : sampleTarget(bands, wl, 0);
  const H = materialByKey(p.H), L = materialByKey(p.L);
  return { wavelengths: wl, target: s.target, weights: s.weights, bands, bands2: dual ? bands2 : null, transition: 0, ns: 1.52, na: p.ambient === 'BK7' ? 1.52 : 1, angle: p.angle ?? 0, pol: p.pol ?? 'avg', materials: { H: { n: H.n, m: H.key }, L: { n: L.n, m: L.key } }, start: { material: p.start.material, thickness: p.start.thickness }, maxLayers: p.maxLayers, maxOpticalThickness: p.maxTOT, targetMerit, thinLayer: thin, candidates, budgetMs: 90000 };
}
function run(cfg) { let done = null; for (const ev of synthesize(cfg)) if (ev.type === 'done') done = ev; return done; }
const modelOf = (cfg) => opticsModel({ ns: cfg.ns, na: cfg.na, angle: cfg.angle, pol: cfg.pol });
const F_of = (cfg, ls) => meritOf(ls, cfg.wavelengths, cfg.target, cfg.weights, modelOf(cfg));
const pct = (a, b) => `${(100 * (b / a - 1)).toFixed(2)} %`;

/** C. Tangential projected-gradient descent on the optical-thickness surface Σ n_j d_j = const with d_j ≥ 0. */
function tangentialDescent(cfg, layers, iters = 400) {
  const model = modelOf(cfg); const n = layers.map((L) => L.n);
  let ls = layers.map((L) => ({ ...L })); let F = F_of(cfg, ls); const F0 = F;
  let step = 0.05;
  for (let it = 0; it < iters; it++) {
    const ev = evaluate(ls, cfg.wavelengths, cfg.target, cfg.weights, model);
    const g = Array.from(ev.grad);
    // project onto Σ n_j δd_j = 0, then freeze bound-active components that would go negative, re-project
    const proj = (v, free) => { let vn = 0, nn = 0; for (let j = 0; j < v.length; j++) if (free[j]) { vn += v[j] * n[j]; nn += n[j] * n[j]; } return v.map((x, j) => (free[j] ? x - vn / nn * n[j] : 0)); };
    let free = ls.map(() => true); let d = proj(g, free);
    for (let k = 0; k < 3; k++) { let changed = false; for (let j = 0; j < d.length; j++) if (free[j] && ls[j].d <= 1e-12 && -d[j] < 0) { free[j] = false; changed = true; } if (!changed) break; d = proj(g, free); }
    const norm = Math.hypot(...d); if (norm < 1e-18) break;
    let accepted = false;
    for (let bt = 0; bt < 30; bt++) {
      const trial = ls.map((L, j) => ({ ...L, d: Math.max(0, L.d - step * d[j] / norm) }));
      // keep TOT exactly by rescaling the moved layers' excess (projection error from clipping is tiny)
      const Ft = F_of(cfg, trial);
      if (Ft < F && totalOpticalThickness(trial) <= cfg.maxOpticalThickness + 1e-6) { ls = trial; F = Ft; accepted = true; step *= 1.3; break; }
      step *= 0.5;
    }
    if (!accepted || step < 1e-9) break;
  }
  return { F0, F: F_of(cfg, ls), layers: ls };
}

/** D. Layer-limit probe: remove each layer (host material absorbs its optical thickness), refine, then let the synthesis continue from there. */
function layerRemovalProbe(cfg, layers, Fref) {
  const model = modelOf(cfg); let best = { F: Fref, j: -1 };
  for (let j = 0; j < layers.length; j++) {
    const list = layers.map((L) => ({ ...L })); const victim = list[j];
    if (j === 0 || j === list.length - 1) list.splice(j, 1);
    else { const lower = list[j - 1], upper = list[j + 1]; if (lower.m === upper.m) list.splice(j - 1, 3, { ...lower, d: lower.d + upper.d + victim.d * victim.n / lower.n }); else { list.splice(j, 1); list[j - 1] = { ...lower, d: lower.d + victim.d * victim.n / lower.n }; } }
    const merged = mergeEqualNeighbours(list);
    const r = refineToEnd(merged, { wavelengths: cfg.wavelengths, target: cfg.target, weights: cfg.weights, model }, { maxIter: 300, totMax: cfg.maxOpticalThickness });
    // continue the synthesis from this design (needle cycle + growth are re-entered by the engine)
    const done = run({ ...cfg, start: { layers: r.layers.map((L) => ({ m: L.m, n: L.n, d: L.d })) }, budgetMs: 20000 });
    if (done.F < best.F) best = { F: done.F, j, layers: done.layers.length };
  }
  return best;
}

const keys = only || Object.keys(PRESETS);
for (const key of keys) {
  const cfg = cfgOf(key);
  const t0 = Date.now(); const done = run(cfg); const t1 = Date.now();
  const st = done.stop;
  const line = [`${key}: F=${done.F.toExponential(3)} ${done.layers.length}L ${done.opticalThickness.toFixed(0)}nm stop=${st.kind}/${st.needleStop} [${((t1 - t0) / 1000).toFixed(0)}s]`];
  // A. restart from the reported design
  const again = run({ ...cfg, start: { layers: done.layers.map((L) => ({ m: L.m, n: L.n, d: L.d })) } });
  line.push(`  A restart: F=${again.F.toExponential(3)} (${pct(done.F, again.F)}) ${again.layers.length}L stop=${again.stop.kind}/${again.stop.needleStop}`);
  // B. all candidates compared
  const all = run(cfgOf(key, { candidates: 0 }));
  line.push(`  B K=all : F=${all.F.toExponential(3)} (${pct(done.F, all.F)}) ${all.layers.length}L stop=${all.stop.kind}/${all.stop.needleStop}`);
  // C. tangential descent on the TOT surface
  if (done.opticalThickness >= cfg.maxOpticalThickness - 1) {
    const td = tangentialDescent(cfg, done.layers);
    line.push(`  C TOT-surface descent: F ${td.F0.toExponential(3)} → ${td.F.toExponential(3)} (${pct(td.F0, td.F)})`);
  } else line.push('  C not at the TOT limit');
  // D. layer removal probe when at the layer limit (±1)
  if (done.layers.length >= cfg.maxLayers - 1) {
    const lr = layerRemovalProbe(cfg, done.layers, done.F);
    line.push(`  D remove-a-layer + continue: best F=${lr.F.toExponential(3)} (${pct(done.F, lr.F)})${lr.j >= 0 ? ` by removing layer ${lr.j + 1} → ${lr.layers}L` : ' — no removal helps'}`);
  } else line.push('  D not at the layer limit');
  console.log(line.join('\n'));
}
