/**
 * Gradual‑evolution synthesis driver.
 *
 * One complete cycle (Furman & Tikhonravov §2.2.3; Tikhonravov, Optical
 * Coatings §1.2.2–1.2.4; doc §10, §12.4, Appendix A.3):
 *   0. independent dense‑grid check of the current design; if the optimization
 *      grid under‑resolves the spectrum, enrich it where the error is largest
 *      (ENRICH_GRID) and re‑refine;
 *   1. refinement of all thicknesses (Levenberg–Marquardt, analytic Jacobian);
 *   2. needle cycle: compute the needle derivative g(z) analytically; for the
 *      K most negative admissible minima insert a needle of the opposite
 *      material with a width that actually decreases F, refine every
 *      alternative independently and keep the best refined design
 *      (REFINE_THEN_ACCEPT with candidate comparison, doc §9.3, §13.4;
 *      Trubetskov 2020 "deep search"); repeat until no needle helps;
 *   3. thin‑layer cleanup followed by re‑refinement;
 *   4. gradual evolution: deliberately grow one layer to the nearest local
 *      minimum of F along its thickness (thorough search over all layers),
 *      then return to step 0.
 * Termination: target merit reached on both grids, layer limit,
 * optical‑thickness limit, time budget, or no progress. The best feasible
 * design is always retained.
 *
 * `synthesize` is a generator so the interface can animate every stage and
 * pause between events; no computation happens between `next()` calls.
 * `explore` runs a set of starting designs to completion (multi‑start) and
 * reports each result; the interface replays the winner with `synthesize`.
 */
import {
  evaluate, reflectance, meritOf, assess, opticsModel, scanNeedles, insertNeedle, cleanThinLayers,
  mergeEqualNeighbours, totalOpticalThickness,
} from './optics.js';
import { refine, refineToEnd } from './refine.js';
import { sampleTarget, sampleDualTarget, denseGrid, denseGridDual } from './config.js';
import { polTarget } from './optics.js';

function copy(layers) { return layers.map((L) => ({ ...L, inserted: false })); }

function dropZeroLayers(layers, keepOneOf) {
  let out = mergeEqualNeighbours(layers.filter((L) => L.d > 1e-9));
  if (out.length === 0) out = [{ ...keepOneOf, d: 0 }];
  return out;
}

/** Build the initial layer list from cfg.start ({material, thickness} or {layers}). */
export function startLayers(cfg) {
  const H = cfg.materials.H, Lm = cfg.materials.L;
  if (cfg.start.layers) return cfg.start.layers.map((L) => ({ n: L.n ?? (L.m === H.m ? H.n : Lm.n), m: L.m, d: Math.max(0, L.d) }));
  const mat = cfg.start.material === H.m ? H : Lm;
  return [{ n: mat.n, m: mat.m, d: Math.max(0, cfg.start.thickness) }];
}

/**
 * Automatic set of starting designs for multi‑start exploration
 * (Tikhonravov 2024, Table 1.2; doc §12.4, §13.5): the manual start, single
 * L and H layers of 1, 2, 4 and 8 quarter‑waves at the band centre, and a
 * quarter‑wave stack (HL)ᴺH at the band centre within the limits.
 */
export function startDesigns(cfg, lambdaCenter) {
  const H = cfg.materials.H, Lm = cfg.materials.L;
  // a quarter wave at the angle of incidence: φ_j = k n_j cos γ_j d_j = π/2, cos γ_j = √(1 − α²/n_j²) (book §1.2.1)
  const alpha = (cfg.na ?? 1) * Math.sin((cfg.angle ?? 0) * Math.PI / 180);
  const cosG = (n) => (alpha < n ? Math.sqrt(1 - alpha * alpha / (n * n)) : 1);
  const qw = (mat) => lambdaCenter / (4 * mat.n * cosG(mat.n));
  const out = [];
  if (cfg.start && !cfg.start.layers) out.push({ name: `${cfg.start.material} ${cfg.start.thickness} nm (manual)`, start: { ...cfg.start } });
  for (const mat of [Lm, H]) for (const q of [1, 2, 4, 8]) {
    const d = q * qw(mat);
    if (mat.n * d <= (cfg.maxOpticalThickness ?? Infinity)) out.push({ name: `${mat.m} ${q} QWOT (${d.toFixed(1)} nm)`, start: { material: mat.m, thickness: d } });
  }
  const pairTOT = H.n * qw(H) + Lm.n * qw(Lm);   // optical thickness of one HL pair (λ/2 at normal incidence)
  const maxPairs = Math.floor(Math.min(((cfg.maxLayers ?? 40) - 1) / 2, 0.6 * (cfg.maxOpticalThickness ?? Infinity) / pairTOT));
  const N = Math.max(1, Math.min(12, maxPairs));
  if (maxPairs >= 1) {
    const layers = [];
    for (let i = 0; i < N; i++) { layers.push({ m: H.m, n: H.n, d: qw(H) }); layers.push({ m: Lm.m, n: Lm.n, d: qw(Lm) }); }
    if (2 * N + 1 <= (cfg.maxLayers ?? 40)) layers.push({ m: H.m, n: H.n, d: qw(H) });
    out.push({ name: `(HL)${sup(N)}${layers.length % 2 ? 'H' : ''} quarter‑wave stack @ ${lambdaCenter.toFixed(0)} nm`, start: { layers } });
  }
  return out;
}
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(n) { return String(n).split('').map((c) => SUPS[+c]).join(''); }

export function* synthesize(cfg) {
  const { ns, na = 1, materials } = cfg;
  // optical model: substrate, incident medium, angle of incidence and the target characteristic (Rs, Rp, both, unpolarized mean)
  const model = opticsModel({ ns, na, angle: cfg.angle ?? 0, pol: cfg.pol ?? 'avg' });
  const problem = { wavelengths: Float64Array.from(cfg.wavelengths), target: cloneTarget(cfg.target), weights: cloneTarget(cfg.weights), ns, na, model };
  const H = materials.H, Lm = materials.L;
  const other = (lay) => (lay.m === H.m ? Lm.n : H.n);
  const matByIndex = (n) => (n === H.n ? H : Lm);
  const maxLayers = cfg.maxLayers ?? 40;
  const maxTOT = cfg.maxOpticalThickness ?? 8000;
  const targetF = cfg.targetMerit ?? 1e-5;
  const dMin = cfg.thinLayer ?? 1;
  const kCand = cfg.candidates ?? 3;            // 0 = all admissible minima
  const compare = cfg.compare ?? true;          // refine every candidate and keep the best
  const eps = cfg.acceptRel ?? 1e-6;
  const maxCycles = cfg.maxCycles ?? 80;
  const budgetMs = cfg.budgetMs ?? Infinity;
  const maxRefinements = cfg.maxRefinements ?? Infinity;   // deterministic replay of a budget-limited run
  const t0 = Date.now();
  const lamMin = Math.min(...problem.wavelengths), lamMax = Math.max(...problem.wavelengths);
  const lamC = (lamMin + lamMax) / 2;
  const eta0 = cfg.needleWidth ?? Math.max(1, 10 * lamC / 550);  // book: ≈10 nm in the visible
  const lmOpts = { maxIter: cfg.maxLmIterations ?? 300, relTol: cfg.lmRelTol ?? 1e-11, totMax: maxTOT };

  // independent dense check and grid enrichment
  const bands = cfg.bands || null;
  const bands2 = model.separate ? (cfg.bands2 || bands) : null;   // «Rs & Rp»: the Rp target has its own bands
  const transition = cfg.transition ?? 0;
  const denseOn = !!(cfg.dense?.enabled ?? bands);
  const enrichOn = denseOn && (cfg.enrich?.enabled ?? true);
  const enrichCap = cfg.enrich?.maxPoints ?? Math.max(4 * problem.wavelengths.length, 400);
  const enrichPerCycle = cfg.enrich?.perCycle ?? 8;
  // The dense grid excludes one optimization-grid step around every target jump (a discrete
  // grid cannot resolve an ideal edge better than its spacing); a wider user transition zone wins.
  const gridStep = (lamMax - lamMin) / Math.max(1, problem.wavelengths.length - 1);
  const denseTransition = Math.max(transition, 2 * gridStep);
  const dense = denseOn ? (bands2 ? denseGridDual(bands, bands2, lamMin, lamMax, denseTransition, cfg.dense?.points) : denseGrid(bands, lamMin, lamMax, denseTransition, cfg.dense?.points)) : null;
  const denseCheck = (ls) => {
    if (!dense) return null;
    const a = assess(ls, dense.wavelengths, dense.target, dense.weights, model);
    return { F: a.F, maxDev: a.maxDev, R: a.R, Rs: a.Rs, Rp: a.Rp };
  };

  const startMat = cfg.start.material ? (cfg.start.material === H.m ? H : Lm) : H;
  let layers = startLayers(cfg);
  const evalF = (ls) => meritOf(ls, problem.wavelengths, problem.target, problem.weights, model);
  const evalR = (ls) => reflectance(ls, problem.wavelengths, model);
  const stats = { refinements: 0, needles: 0, rejected: 0, compared: 0, growths: 0, cleanups: 0, lmIterations: 0, cycles: 0, enrichments: 0, pointsAdded: 0, finalNeedles: 0, finalRounds: 0 };
  // A design is "complete" when no layer is thinner than the cleanup threshold: only such designs are
  // reported, so only such designs are archived (a thinner layer would be removed and the merit would change).
  const isComplete = (ls) => ls.every((L) => L.d >= dMin - 1e-12);
  const withinLimits = (ls) => ls.length <= maxLayers && totalOpticalThickness(ls) <= maxTOT + 1e-9;
  // Archive: every complete design within the limits that the run has shown, with its merit on the current
  // grid. When the grid is enriched all entries are re-measured, so the best entry is the best on the final grid.
  const archive = [];
  let best = null;                  // the archive entry with the lowest merit
  let lowestShown = null;           // the lowest merit of any design shown during the run (thin layers included), current grid
  let lowestOldGrid = null;         // the same for the grid(s) before enrichment
  let gridVersion = 0;
  const noteShown = (ls, F) => { if (!lowestShown || F < lowestShown.F) lowestShown = { F, cycle: stats.cycles, complete: isComplete(ls), layers: ls.length, grid: gridVersion }; };
  const keepBest = (ls, F) => {
    noteShown(ls, F);
    if (!isComplete(ls) || !withinLimits(ls)) return;
    const entry = { layers: copy(ls), F, cycle: stats.cycles };
    archive.push(entry);
    if (archive.length > 3000) { archive.sort((a, b) => a.F - b.F); archive.length = 1500; best = archive[0]; }
    if (!best || F < best.F) best = entry;
  };
  const remeasureArchive = () => { best = null; for (const a of archive) { a.F = evalF(a.layers); if (!best || a.F < best.F) best = a; } };
  const overBudget = () => Date.now() - t0 > budgetMs || stats.refinements >= maxRefinements;
  const budgetText = () => cfg.budgetReason || `Time budget exhausted (${(budgetMs / 1000).toFixed(0)} s)`;
  const reached = (F, dc) => F <= targetF && (!dc || dc.F <= targetF);

  // the final phase refines with the thin-layer threshold as a lower bound on every thickness, so that a
  // reported design can never be driven below it; a layer pinned at the bound is then tested for removal
  const lmFinal = { ...lmOpts, minThickness: dMin };
  function* doRefine(ls, label, opts = lmOpts) {
    yield { type: 'stage', stage: 'refine', label };
    const it = refine(ls, problem, opts);
    for (;;) {
      const r = it.next();
      if (r.done) {
        stats.refinements++; stats.lmIterations += r.value.iterations;
        const res = r.value;
        noteShown(res.layers, res.F);
        yield { type: 'refined', layers: copy(res.layers), R: res.R, F: res.F, iterations: res.iterations, reason: res.reason };
        return res;
      }
      yield { type: 'refine', layers: r.value.layers, R: r.value.R, F: r.value.F, iter: r.value.iter };
    }
  }
  const silentRefine = (ls, opts = lmOpts) => { const r = refineToEnd(ls, problem, opts); stats.refinements++; stats.lmIterations += r.iterations; return r; };
  /** Layers pinned at the thin-layer bound by a bounded refinement: removed (neighbours absorb their optical thickness) when the design is better without them. */
  const pinned = (ls) => ls.filter((L) => L.d <= dMin + 1e-9).length;
  const prunePinnedSilent = (ls) => {
    let F0 = evalF(ls), removed = 0;
    for (let round = 0; round < 8 && pinned(ls) && ls.length > 1; round++) {
      const c = cleanThinLayers(ls, dMin + 1e-6);
      if (!c.removed) break;
      const r = silentRefine(c.layers, lmFinal); const cand = dropZeroLayers(r.layers, startMat);
      if (!(r.F < F0 * (1 - eps)) || !withinLimits(cand)) break;
      ls = cand; F0 = r.F; removed += c.removed;
    }
    return { layers: ls, F: F0, removed };
  };
  /** Complete a refined design the way the run would report it: remove layers below the threshold, refine with the threshold as a bound, prune pinned layers. */
  const completeDesign = (ls) => {
    let removed = 0;
    if (!isComplete(ls) && ls.length > 1) { const c = cleanThinLayers(ls, dMin); removed = c.removed; ls = dropZeroLayers(silentRefine(c.layers, lmFinal).layers, startMat); }
    const pr = prunePinnedSilent(ls);
    return { layers: pr.layers, removed: removed + pr.removed };
  };
  /** The same for the current design, with events for the interface. */
  function* prunePinned() {
    for (let round = 0; round < 8 && pinned(layers) && layers.length > 1; round++) {
      const c = cleanThinLayers(layers, dMin + 1e-6);
      if (!c.removed) break;
      const r = silentRefine(c.layers, lmFinal); const cand = dropZeroLayers(r.layers, startMat);
      if (!(r.F < F * (1 - eps)) || !withinLimits(cand)) break;
      stats.cleanups += c.removed;
      yield { type: 'cleanup', removed: c.removed, layers: copy(c.layers), R: evalR(c.layers), F: evalF(c.layers), before: copy(layers), final: true, pinned: true };
      yield { type: 'refined', layers: copy(cand), R: r.R, F: r.F, iterations: r.iterations, reason: r.reason };
      layers = cand; F = r.F; keepBest(layers, F);
    }
  }
  /**
   * Thin‑layer cleanup followed by refinement, repeated while the refinement leaves a layer below the
   * threshold (at most four rounds); returns the number of removed layers (0 when nothing to clean).
   */
  function* cleanupAndRefine(label, final) {
    let total = 0;
    for (let round = 0; round < 4 && layers.some((L) => L.d < dMin) && layers.length > 1; round++) {
      yield { type: 'stage', stage: 'cleanup' };
      const { layers: cl, removed } = cleanThinLayers(layers, dMin);
      if (!removed) break;
      stats.cleanups += removed; total += removed;
      keepBest(cl, evalF(cl));
      yield { type: 'cleanup', removed, layers: copy(cl), R: evalR(cl), F: evalF(cl), before: copy(layers), final: !!final };
      const r3 = yield* doRefine(cl, label, final ? lmFinal : lmOpts);
      layers = dropZeroLayers(r3.layers, startMat); F = r3.F; keepBest(layers, F);
    }
    if (final) yield* prunePinned();
    return total;
  }

  let R0 = evalR(layers);
  let F = evalF(layers);
  keepBest(layers, F);
  yield { type: 'start', layers: copy(layers), R: R0, F, name: cfg.start.name || null };
  let res = yield* doRefine(layers, 'Initial refinement');
  layers = dropZeroLayers(res.layers, startMat); F = res.F; keepBest(layers, F);

  let stop = null;            // structured termination cause
  let needleStop = null;      // why the last needle cycle ended: target | budget | stationary | layer-limit | no-gain | steps
  let growthCapped = false;   // the last growth step was limited by the optical-thickness bound
  let layerLimitPartial = false;   // layer limit excluded interior needles while the admissible boundary needles gave no gain
  let noProgress = 0;
  let dc = null;

  /**
   * One needle cycle on the current design (doc §9, §13.4): scan g(z), refine the K best admissible
   * candidates independently, accept the best refined design while it lowers F; repeated until no
   * needle helps. Mutates `layers`, `F`, `layerLimitPartial`; returns the cause the cycle ended with.
   * In the main phase a budget stop is recorded in `stop`; in the final phase it is only returned.
   */
  function* needleCycle(phase) {
    let cause = 'steps';
    for (let needleStep = 0; needleStep < 200; needleStep++) {
      if (F <= targetF && (!dc || dc.F <= targetF)) { cause = 'target'; break; }
      if (overBudget()) { cause = 'budget'; if (phase === 'main') stop = { kind: 'budget' }; break; }   // stop immediately: no further design change after a budget stop
      yield { type: 'stage', stage: 'needle' };
      const ev = evaluate(layers, problem.wavelengths, problem.target, problem.weights, model, true);
      const scan = scanNeedles(layers, ev.adjoint, problem.wavelengths, other);
      yield { type: 'scan', z: scan.z, g: scan.g, layer: scan.layer, total: scan.total, candidates: scan.candidates.slice(0, 8), layers: copy(layers), F };
      if (!scan.candidates.length) { cause = 'stationary'; yield { type: 'note', text: 'No negative needle derivative: the design is needle‑stationary.' }; break; }
      // admissible candidates within the layer limit
      const pool = scan.candidates.filter((c) => layers.length + (c.kind === 'interior' ? 2 : 1) <= maxLayers);
      const blocked = scan.candidates.length - pool.length;   // candidates excluded by the layer limit
      if (!pool.length) { cause = 'layer-limit'; layerLimitPartial = false; yield { type: 'note', text: `Layer limit (${maxLayers}) reached: no further needle can be inserted into the ${layers.length}-layer design.` }; break; }
      const selected = kCand > 0 ? pool.slice(0, kCand) : pool;
      const trials = [];
      for (const cand of selected) {
        const mat = matByIndex(cand.nm);
        const etaMax = cand.kind === 'interior' ? 2 * Math.min(cand.x, layers[cand.layer].d - cand.x) : eta0;
        let eta = Math.min(eta0, etaMax * 0.5), trial = null, Ft = Infinity, attempts = 0;
        while (eta >= 1e-3) {
          attempts++;
          trial = insertNeedle(layers, cand, eta, mat);
          Ft = evalF(trial);
          if (Ft <= F + 1e-4 * eta * cand.g && totalOpticalThickness(trial) <= maxTOT + 1e-9) break;
          eta *= 0.5; trial = null;
        }
        if (!trial) { trials.push({ cand, mat, ok: false, why: 'no admissible width' }); continue; }
        if (!compare && trials.length === 0) { trials.push({ cand, mat, ok: true, eta, trial, Ft, attempts }); break; }
        const r = silentRefine(trial);
        let cleaned = dropZeroLayers(r.layers, startMat);
        // final phase: a candidate is judged by its completed design (thin layers removed, refined again)
        if (phase === 'final') cleaned = completeDesign(cleaned).layers;
        trials.push({ cand, mat, ok: true, eta, trial, Ft, attempts, Fref: evalF(cleaned), layersRef: cleaned });
        if (!compare) break;
      }
      stats.compared += trials.filter((t) => t.ok).length;
      if (compare) {
        yield { type: 'compare', parentF: F, trials: trials.map((t) => ({ layer: t.cand.layer, kind: t.cand.kind, z: t.cand.z, g: t.cand.g, material: t.mat.m, ok: t.ok, eta: t.eta, Finsert: t.Ft, Frefined: t.Fref, layers: t.layersRef ? t.layersRef.length : null, why: t.why })) };
      }
      let bestTrial = null;
      for (const t of trials) {
        if (!t.ok) { stats.rejected++; continue; }
        const Fc = t.Fref ?? -Infinity;
        if (compare) { if (Fc < F * (1 - eps) && t.layersRef.length <= maxLayers && (!bestTrial || Fc < bestTrial.Fref)) bestTrial = t; }
        else bestTrial = t;
      }
      if (!bestTrial) {
        for (const t of trials) if (t.ok) yield { type: 'needle-rejected', candidate: t.cand, why: `refined merit ${t.Fref.toExponential(3)} is not below parent ${F.toExponential(3)}` };
        stats.rejected += trials.filter((t) => t.ok).length;
        // the admissible needles give no gain; when the layer limit excluded candidates, the limit is the recorded cause
        if (blocked) { cause = 'layer-limit'; layerLimitPartial = true; yield { type: 'note', text: `Layer limit (${maxLayers}): ${blocked} needle candidate${blocked > 1 ? 's' : ''} inside the layers would exceed it; the ${pool.length} admissible boundary needle${pool.length > 1 ? 's do' : ' does'} not lower the merit.` }; }
        else cause = 'no-gain';
        break;
      }
      stats.needles++;
      const t = bestTrial;
      keepBest(t.trial, t.Ft);
      yield { type: 'needle', candidate: t.cand, eta: t.eta, material: t.mat.m, layers: t.trial.map((L) => ({ ...L })), R: evalR(t.trial), F: t.Ft, Fparent: F, attempts: t.attempts, alternatives: trials.filter((x) => x.ok).length, final: phase === 'final' };
      const r2 = yield* doRefine(t.trial, 'Refinement after needle');
      let cleaned = dropZeroLayers(r2.layers, startMat);
      if (phase === 'final' && !isComplete(cleaned) && cleaned.length > 1) {
        // the final phase accepts only complete designs: thin layers are removed and the design refined (bounded) before the comparison
        const c = cleanThinLayers(cleaned, dMin); stats.cleanups += c.removed;
        keepBest(c.layers, evalF(c.layers));
        yield { type: 'cleanup', removed: c.removed, layers: copy(c.layers), R: evalR(c.layers), F: evalF(c.layers), before: copy(cleaned), final: true };
        const r3 = yield* doRefine(c.layers, 'Refinement after cleanup', lmFinal);
        cleaned = prunePinnedSilent(dropZeroLayers(r3.layers, startMat)).layers;
      }
      const Fc = evalF(cleaned);
      if (Fc < F * (1 - eps) && cleaned.length <= maxLayers) { layers = cleaned; F = Fc; keepBest(layers, F); if (phase === 'final') stats.finalNeedles++; }
      else { stats.rejected++; cause = blocked ? 'layer-limit' : 'no-gain'; layerLimitPartial = blocked > 0; yield { type: 'needle-rejected', candidate: t.cand, why: `refined merit ${Fc.toExponential(3)} is not below parent ${F.toExponential(3)}`, layers: copy(layers), R: evalR(layers), F }; break; }
    }
    return cause;
  }

  for (let cycle = 1; cycle <= maxCycles && !stop; cycle++) {
    stats.cycles = cycle;
    const cycleStartF = F;
    yield { type: 'cycle', cycle, layers: copy(layers), F };

    // ---------------- dense check / grid enrichment ----------------
    dc = denseCheck(layers);
    if (dc) {
      yield { type: 'dense', F: dc.F, maxDev: dc.maxDev, Fgrid: F, points: dense.wavelengths.length };
      const underResolved = dc.F > 1.25 * F + 1e-14 || (F <= targetF && dc.F > targetF);
      if (underResolved && enrichOn && problem.wavelengths.length < enrichCap) {
        const added = enrichGrid(problem, dense, dc, bands, transition, Math.min(enrichPerCycle, enrichCap - problem.wavelengths.length), bands2);
        if (added.length) {
          stats.enrichments++; stats.pointsAdded += added.length;
          // the merit changes its definition: every stored value is re-measured on the new grid
          gridVersion++;
          if (lowestShown && (!lowestOldGrid || lowestShown.F < lowestOldGrid.F)) lowestOldGrid = lowestShown;
          lowestShown = null;
          remeasureArchive();
          F = evalF(layers);
          yield { type: 'grid', wavelengths: Float64Array.from(problem.wavelengths), target: cloneTarget(problem.target), weights: cloneTarget(problem.weights), added, layers: copy(layers), R: evalR(layers), F };
          const rg = yield* doRefine(layers, 'Refinement on the enriched grid');
          layers = dropZeroLayers(rg.layers, startMat); F = rg.F; keepBest(layers, F);
          dc = denseCheck(layers);
          yield { type: 'dense', F: dc.F, maxDev: dc.maxDev, Fgrid: F, points: dense.wavelengths.length };
        }
      }
    }
    if (reached(F, dc)) { stop = { kind: 'target' }; break; }
    if (overBudget()) { stop = { kind: 'budget' }; break; }

    // ---------------- needle cycle ----------------
    needleStop = yield* needleCycle('main');
    if (stop) break;

    // ---------------- thin-layer cleanup ----------------
    yield* cleanupAndRefine('Refinement after cleanup', false);
    dc = denseCheck(layers);
    if (reached(F, dc)) { stop = { kind: 'target' }; break; }
    if (overBudget()) { stop = { kind: 'budget' }; break; }

    // ---------------- gradual evolution: thickness growth ----------------
    const tot = totalOpticalThickness(layers);
    if (tot >= maxTOT - 1e-6) { stop = { kind: 'tot' }; break; }
    yield { type: 'stage', stage: 'growth' };
    const growth = growthSearch(layers, problem, { lamMin, lamMax, maxTOT });
    if (!growth) { stop = { kind: 'tot' }; break; }
    growthCapped = growth.s * layers[growth.layer].n >= (maxTOT - tot) - 1e-6;
    stats.growths++;
    const grown = copy(layers); grown[growth.layer].d += growth.s;
    keepBest(grown, growth.F);
    yield { type: 'growth', layer: growth.layer, from: layers[growth.layer].d, to: grown[growth.layer].d, curve: growth.curve, layers: grown, R: evalR(grown), F: growth.F, Fparent: F };
    const r4 = yield* doRefine(grown, 'Refinement after growth');
    layers = dropZeroLayers(r4.layers, startMat); F = r4.F; keepBest(layers, F);

    if (F < cycleStartF * (1 - 1e-4)) noProgress = 0;
    else if (++noProgress >= 3) stop = { kind: 'stagnation' };
  }
  if (!stop) stop = { kind: 'cycles' };
  stop.needleStop = needleStop; stop.growthCapped = growthCapped; stop.layerLimitPartial = needleStop === 'layer-limit' && layerLimitPartial; stop.refinements = stats.refinements;   // work done up to the stop (replay budget)
  const terminal = { F, layers: layers.length, opticalThickness: totalOpticalThickness(layers), cycle: stats.cycles, complete: isComplete(layers) };

  // ---------------- final phase ----------------
  // 1. the design at termination is completed (thin layers removed) and refined;
  // 2. the best complete design of the run replaces it when its merit is lower;
  // 3. unless the run stopped by the target or by its budget, needle variations on the reported design are
  //    exploited while they lower the merit within the limits (cleanup + refinement after each cycle), so that
  //    the reported design is needle‑stationary, blocked by a limit, or at the target — and the best complete
  //    design the run has seen.
  yield { type: 'stage', stage: 'final' };
  let fromArchive = null, finalCleanupRemoved = 0;
  finalCleanupRemoved = yield* cleanupAndRefine('Final refinement', true);
  if (!finalCleanupRemoved) { const r5 = yield* doRefine(layers, 'Final refinement', lmFinal); layers = dropZeroLayers(r5.layers, startMat); F = r5.F; keepBest(layers, F); yield* prunePinned(); }
  const completedTerminal = { F, layers: layers.length };
  /**
   * Adopt the best archived design when its merit is lower than the current one. Archive entries may
   * predate a refinement, so the adopted design is refined once more; the refined (and, if a layer fell
   * below the threshold, completed) design replaces it only when it is complete and lower.
   */
  function* adoptArchive() {
    if (!(best && best.F < F)) return false;
    fromArchive = { cycle: best.cycle, F: best.F };
    layers = copy(best.layers); F = best.F;
    // archive entries may predate a refinement: refine once more with the threshold as a bound (stays complete)
    const r = yield* doRefine(layers, 'Final refinement', lmFinal);
    const rl = dropZeroLayers(r.layers, startMat);
    if (r.F < F && withinLimits(rl)) { layers = rl; F = r.F; keepBest(layers, F); }
    yield* prunePinned();
    fromArchive.F = F;
    return true;
  }
  yield* adoptArchive();
  const exploit = stop.kind !== 'target' && stop.kind !== 'budget';
  let exploitStop = null, exploitBudget = false, exploitCapped = false;
  const Fexploit0 = F;
  if (exploit) {
    const maxRounds = 6;
    let round = 0;
    for (; round < maxRounds; round++) {
      if (overBudget()) { exploitBudget = true; break; }
      stats.finalRounds++;
      const Fbefore = F;
      dc = denseCheck(layers);
      exploitStop = yield* needleCycle('final');
      if (exploitStop === 'budget') { exploitBudget = true; break; }
      yield* cleanupAndRefine('Refinement after cleanup', true);
      if (exploitStop === 'target') break;
      if (!(F < Fbefore * (1 - eps))) break;   // nothing changed in this round: the design is stationary within the limits
    }
    if (round >= maxRounds || exploitStop === 'steps') exploitCapped = true;
    // a cleanup after an accepted needle may have raised the merit above an archived design: report the best complete one
    keepBest(layers, F);
    yield* adoptArchive();
    if (exploitStop && exploitStop !== 'steps' && exploitStop !== 'budget') { stop.needleStop = exploitStop; stop.layerLimitPartial = exploitStop === 'layer-limit' && layerLimitPartial; }
  }
  // hard guard: whatever happened above, the reported design has no layer below the threshold
  if (!isComplete(layers) && layers.length > 1) { yield* cleanupAndRefine('Final refinement', true); keepBest(layers, F); yield* adoptArchive(); }
  const finalGain = stats.finalNeedles > 0 && F < Fexploit0 ? { needles: stats.finalNeedles, from: Fexploit0, to: F } : null;
  const Rf = evalR(layers);
  const Ff = evalF(layers);
  const dcf = denseCheck(layers);
  const finalTOT = totalOpticalThickness(layers);
  // the final phase may have brought the design to the target: then the target is the cause that holds
  if (exploit && reached(Ff, dcf)) { stop.promoted = stop.kind; stop.kind = 'target'; }
  // ---- compose the termination reason from the recorded facts ----
  const growthNote = stop.growthCapped ? `; thickness growth was capped by the optical‑thickness limit (${maxTOT} nm)` : '';
  const needleText = {
    'layer-limit': stop.layerLimitPartial ? `the layer limit (${maxLayers}) blocks needles inside the layers and the admissible boundary needles do not lower the merit` : `the layer limit (${maxLayers}) blocks further needles`,
    stationary: 'the design is needle‑stationary (g(z) ≥ 0 everywhere)',
    'no-gain': 'no needle lowers the merit after refinement',
    steps: 'the needle cycle reached its step limit',
    target: 'the target was reached',
    budget: 'the budget ran out',
  }[stop.needleStop] || 'no needle was accepted';
  let reason;
  switch (stop.kind) {
    case 'target':
      reason = reached(Ff, dcf) ? `Target merit reached (F = ${Ff.toExponential(2)} ≤ ${targetF.toExponential(0)})${stop.promoted ? ' in the final phase' : ''}`
        : dcf && Ff <= targetF ? 'Target merit reached on the optimization grid but not on the dense check grid' : `Target merit was reached before the final cleanup; after it F = ${Ff.toExponential(2)}`;
      break;
    case 'budget': reason = budgetText(); break;
    case 'tot':
      reason = `Optical‑thickness limit reached (${maxTOT} nm)`;
      if (!fromArchive && finalTOT < maxTOT - 1) reason += `; after the final cleanup and refinement the reported design has ${finalTOT.toFixed(0)} nm`;
      break;
    case 'stagnation': reason = `No further progress in three cycles: ${needleText}${growthNote}`; break;
    default: reason = `Cycle budget exhausted (${maxCycles} cycles)`;
  }
  stop.base = reason;
  const terminalNote = `the design at termination had F = ${terminal.F.toExponential(2)}, ${terminal.layers} layers, ${terminal.opticalThickness.toFixed(0)} nm${terminal.complete ? '' : ` with layers thinner than ${dMin} nm; after their removal and refinement F = ${completedTerminal.F.toExponential(2)}`}`;
  if (fromArchive) reason += ` · reported design is the best complete design of the run (cycle ${fromArchive.cycle}, F = ${fromArchive.F.toExponential(2)}); ${terminalNote}`;
  if (finalGain) reason += ` · final phase: ${finalGain.needles} needle${finalGain.needles > 1 ? 's' : ''} lowered F from ${finalGain.from.toExponential(2)} to ${finalGain.to.toExponential(2)}`;
  stop.text = reason; stop.fromArchive = fromArchive; stop.terminal = terminal; stop.completedTerminal = completedTerminal; stop.finalGain = finalGain; stop.exploitStop = exploitStop; stop.exploitBudget = exploitBudget; stop.exploitCapped = exploitCapped;
  stop.lowestShown = lowestShown; stop.lowestOldGrid = lowestOldGrid;

  // ---------------- final needle scan: evidence that insertions no longer help ----------------
  {
    const evF = evaluate(layers, problem.wavelengths, problem.target, problem.weights, model, true);
    const scanF = scanNeedles(layers, evF.adjoint, problem.wavelengths, other);
    const top = scanF.candidates.slice(0, Math.max(1, kCand > 0 ? kCand : 3)).slice(0, 5);
    const trials = [];
    for (const cand of top) {
      const mat = matByIndex(cand.nm);
      const etaMax = cand.kind === 'interior' ? 2 * Math.min(cand.x, layers[cand.layer].d - cand.x) : eta0;
      let eta = Math.min(eta0, etaMax * 0.5), trial = null, Ft = Infinity, overTOT = false;
      while (eta >= 1e-3) { trial = insertNeedle(layers, cand, eta, mat); Ft = evalF(trial); overTOT = totalOpticalThickness(trial) > maxTOT + 1e-9; if (Ft <= Ff + 1e-4 * eta * cand.g && !overTOT) break; eta *= 0.5; trial = null; }
      let Fref = null, nl = null, Fcomplete = null, thin = false;
      if (trial) {
        const r = refineToEnd(trial, problem, lmOpts); const cl = dropZeroLayers(r.layers, startMat); Fref = evalF(cl); nl = cl.length;
        // a refined design with a layer below the threshold is completed the way the run would complete it
        const cd = completeDesign(cl);
        if (cd.removed) { thin = true; Fcomplete = evalF(cd.layers); nl = cd.layers.length; } else Fcomplete = Fref;
      }
      const withinLayerLimit = layers.length + (cand.kind === 'interior' ? 2 : 1) <= maxLayers;
      trials.push({ layer: cand.layer, kind: cand.kind, z: cand.z, g: cand.g, material: mat.m, eta: trial ? eta : null, Finsert: trial ? Ft : null, Frefined: Fref, Fcomplete, thin, layers: nl, delta: Fcomplete != null ? Fcomplete / Ff - 1 : null, deltaRefined: Fref != null ? Fref / Ff - 1 : null, withinLayerLimit, overTOT: !trial && overTOT, admissible: withinLayerLimit && !(!trial && overTOT) });
    }
    const improving = trials.filter((t) => t.delta != null && t.delta < -eps);
    const thinOnly = trials.filter((t) => t.delta != null && !(t.delta < -eps) && t.thin && t.deltaRefined < -eps);
    let verdict;
    if (!scanF.candidates.length) verdict = { kind: 'stationary', text: 'Needle‑stationary design: g(z) ≥ 0 everywhere — no insertion lowers the merit to first order.' };
    else if (!improving.length) {
      const tn = thinOnly.length ? ` ${thinOnly.length} of them lower${thinOnly.length > 1 ? '' : 's'} F only with a layer thinner than ${dMin} nm; after its removal the merit is not lower.` : '';
      verdict = { kind: 'no-gain', text: `${scanF.candidates.length} negative minim${scanF.candidates.length > 1 ? 'a' : 'um'} of g(z), but none of the ${trials.length} best lowers F after refinement${thinOnly.length ? '' : ' (ΔF ≥ 0)'}.${tn}`, thinOnly: thinOnly.length };
    } else {
      const b = improving.sort((p, q) => p.delta - q.delta)[0];
      const blockedByLayers = !b.withinLayerLimit;
      const blockedByTOT = b.overTOT;
      const why = stop.kind === 'target' ? ' — not needed: the target is reached'
        : blockedByLayers ? ` — blocked by the layer limit (${maxLayers})`
        : blockedByTOT ? ` — blocked by the optical‑thickness limit (${maxTOT} nm)`
        : stop.kind === 'budget' || exploitBudget ? ' — the run stopped by its budget'
        : exploitCapped ? ' — the final phase was capped before exploiting it'
        : ' — not exploited';
      verdict = { kind: 'possible', text: `An insertion could still lower F by ${(100 * -b.delta).toFixed(1)} % (${b.material} at z = ${b.z.toFixed(1)} nm)${why}.`, blockedByLayers, blockedByTOT, gain: -b.delta, material: b.material, z: b.z };
    }
    yield { type: 'final-scan', z: scanF.z, g: scanF.g, layer: scanF.layer, total: scanF.total, candidates: scanF.candidates.slice(0, 8), trials, verdict, layers: copy(layers), F: Ff };

    // ---------------- plain-language summary: decisive cause, state of every stopping condition, reported design ----------------
    // The same structure is shown in the interface (single- and multi-start alike) and written to the export.
    {
      const sci = (x) => x.toExponential(2);
      const needleStalled = stop.needleStop === 'stationary' || stop.needleStop === 'no-gain';
      const limN = exploit ? layers.length : terminal.layers, limWhere = exploit ? '' : ' at termination';   // the design the layer-limit facts refer to
      const growthDetail = `thickness growth gave no progress in three consecutive cycles${stop.growthCapped ? ' (the last step capped by the optical‑thickness limit)' : ''}`;
      const decisive = stop.kind === 'target' ? 'target' : stop.kind === 'tot' ? 'tot' : stop.kind === 'budget' ? 'budget' : stop.kind === 'cycles' ? 'cycles'
        : stop.needleStop === 'layer-limit' ? 'layers' : needleStalled ? 'needle' : 'growth';
      const headline = {
        target: reached(Ff, dcf) ? 'Target merit reached' : dcf && Ff <= targetF ? 'Target merit reached on the optimization grid only' : 'Target merit reached before the final cleanup',
        tot: 'Optical‑thickness limit reached',
        budget: /^Time budget/.test(budgetText()) ? 'Time budget exhausted' : 'Work budget exhausted',
        cycles: 'Cycle budget exhausted',
        layers: 'Layer limit reached',
        needle: 'Needle variations no longer reduce the merit',
        growth: stop.needleStop === 'steps' ? 'Needle cycle step limit reached' : 'No further progress',
      }[decisive];
      const detail = {
        target: reached(Ff, dcf) ? `F = ${sci(Ff)} ≤ ${targetF.toExponential(0)}${dcf ? ` on the optimization grid and on the dense check grid (${sci(dcf.F)})` : ''}`
          : dcf && Ff <= targetF ? `F = ${sci(Ff)} ≤ ${targetF.toExponential(0)} on the optimization grid, but ${sci(dcf.F)} on the dense check grid`
          : `the target was reached before the final cleanup; after it F = ${sci(Ff)}`,
        tot: `${terminal.opticalThickness.toFixed(0)} of ${maxTOT} nm at termination${!fromArchive && finalTOT < maxTOT - 1 ? `; after the final cleanup and refinement the reported design has ${finalTOT.toFixed(0)} nm` : ''}`,
        budget: `${budgetText().replace(/^Time budget exhausted ?/, '').replace(/^\((.*)\)$/, '$1') || budgetText()}; ${stats.refinements} refinements, ${stats.cycles} cycles done`,
        cycles: `${maxCycles} cycles`,
        layers: `${limN} of ${maxLayers} layers${limWhere}: ${stop.layerLimitPartial ? 'a needle inside a layer would exceed the limit and the boundary needles that fit do not lower the merit' : 'no further needle with a negative derivative fits within the limit'}; ${growthDetail}`,
        needle: `${stop.needleStop === 'stationary' ? 'g(z) ≥ 0 everywhere (needle‑stationary design)' : 'no needle lowers the merit after refinement'}; ${growthDetail}`,
        growth: growthDetail,
      }[decisive];
      const needleNow = verdict.kind === 'stationary' ? 'no further gain: g(z) ≥ 0 everywhere — no insertion lowers F to first order'
        : verdict.kind === 'no-gain' ? `no further gain: ${scanF.candidates.length} negative minim${scanF.candidates.length > 1 ? 'a' : 'um'} of g(z); the ${trials.length} best tested after refinement, none lowers F${verdict.thinOnly ? ` (${verdict.thinOnly} only with a layer thinner than ${dMin} nm, which the cleanup removes)` : ' (ΔF ≥ 0)'}`
        : verdict.blockedByLayers ? `blocked by the layer limit: an insertion (${verdict.material} at z = ${verdict.z.toFixed(1)} nm) would lower F by ${(100 * verdict.gain).toFixed(1)} % but exceed ${maxLayers} layers`
        : verdict.blockedByTOT ? `blocked by the optical‑thickness limit: an insertion (${verdict.material} at z = ${verdict.z.toFixed(1)} nm) would lower F by ${(100 * verdict.gain).toFixed(1)} % but exceed ${maxTOT} nm`
        : `still possible: ${verdict.text.replace(/^An insertion/, 'an insertion').replace(/\.$/, '')}`;
      const interiorBlocked = layers.length + 2 > maxLayers;   // an interior needle adds two layers
      const facts = [
        { key: 'target', label: 'Target merit', hit: reached(Ff, dcf),
          text: reached(Ff, dcf) ? `reached: F = ${sci(Ff)} ≤ ${targetF.toExponential(0)}${dcf ? ` (dense grid ${sci(dcf.F)})` : ''}`
            : dcf && Ff <= targetF ? `F = ${sci(Ff)} ≤ ${targetF.toExponential(0)} on the optimization grid, but ${sci(dcf.F)} on the dense check grid`
            : `not reached: F = ${sci(Ff)} > ${targetF.toExponential(0)}` },
        { key: 'layers', label: 'Layer limit', hit: stop.needleStop === 'layer-limit' || interiorBlocked,
          text: stop.needleStop === 'layer-limit'
            ? `reached: ${limN} of ${maxLayers} layers${limWhere} — ${stop.layerLimitPartial ? 'a needle inside a layer would exceed the limit; the boundary needles that fit do not lower the merit' : 'no further needle with a negative derivative fits within the limit'}${limN !== layers.length ? ` (reported design: ${layers.length} layers)` : ''}`
            : interiorBlocked ? `reached: ${layers.length} of ${maxLayers} layers — a needle inside a layer would add two layers and exceed the limit`
            : `not reached: ${layers.length} of ${maxLayers} layers` },
        { key: 'tot', label: 'Optical‑thickness limit', hit: stop.kind === 'tot',
          text: stop.kind === 'tot'
            ? `reached: ${terminal.opticalThickness.toFixed(0)} of ${maxTOT} nm at termination${finalTOT < maxTOT - 1 ? ` (reported design: ${finalTOT.toFixed(0)} nm${fromArchive ? '' : ' after the final cleanup and refinement'})` : ''}`
            : `not reached: ${finalTOT.toFixed(0)} of ${maxTOT} nm` },
        { key: 'needle', label: 'Needle variations', hit: verdict.kind !== 'possible' || !!verdict.blockedByLayers || !!verdict.blockedByTOT,
          text: `${needleNow}${finalGain ? `; the final phase added ${finalGain.needles} needle${finalGain.needles > 1 ? 's' : ''} (F ${sci(finalGain.from)} → ${sci(finalGain.to)}) before the design became stationary` : ''}` },
        { key: 'growth', label: 'Thickness growth', hit: stop.kind === 'stagnation' || stop.kind === 'tot' || stop.growthCapped,
          text: stop.kind === 'stagnation' ? `no further gain: no progress in three consecutive cycles (${stats.growths} growth step${stats.growths === 1 ? '' : 's'} in the run)${stop.growthCapped ? '; the last step was capped by the optical‑thickness limit' : ''}`
            : stop.kind === 'tot' ? `impossible: the optical thickness is at the limit (${stats.growths} growth step${stats.growths === 1 ? '' : 's'} in the run)`
            : stop.kind === 'target' ? `not needed: the target is reached (${stats.growths} growth step${stats.growths === 1 ? '' : 's'} in the run)`
            : `${stats.growths} growth step${stats.growths === 1 ? '' : 's'} in the run; the search stopped before growth stalled` },
      ];
      if (stop.kind === 'budget') facts.push({ key: 'budget', label: 'Budget', hit: true, text: `exhausted: ${budgetText().replace(/^Time budget exhausted ?/, '').replace(/^\((.*)\)$/, '$1') || budgetText()} — ${stats.refinements} refinements, ${stats.cycles} cycles` });
      if (stop.kind === 'cycles') facts.push({ key: 'cycles', label: 'Cycle budget', hit: true, text: `exhausted: ${maxCycles} cycles` });
      // one-line status of every condition (the full text is kept in `text`)
      const short = {
        target: reached(Ff, dcf) ? `reached: F = ${sci(Ff)} ≤ ${targetF.toExponential(0)}` : dcf && Ff <= targetF ? 'reached on the optimization grid only' : `not reached: F = ${sci(Ff)} > ${targetF.toExponential(0)}`,
        layers: stop.needleStop === 'layer-limit' ? `reached: ${limN} of ${maxLayers}${stop.layerLimitPartial ? ' — boundary needles give no gain' : ''}` : interiorBlocked ? `reached: ${layers.length} of ${maxLayers} — no room for an interior needle` : `not reached: ${layers.length} of ${maxLayers}`,
        tot: stop.kind === 'tot' ? `reached: ${terminal.opticalThickness.toFixed(0)} of ${maxTOT} nm${finalTOT < maxTOT - 1 ? ` (reported ${finalTOT.toFixed(0)} nm)` : ''}` : `not reached: ${finalTOT.toFixed(0)} of ${maxTOT} nm`,
        needle: verdict.kind === 'stationary' ? 'no further gain: g(z) ≥ 0 everywhere' : verdict.kind === 'no-gain' ? `no further gain: ΔF ≥ 0 for the ${trials.length} best candidate${trials.length > 1 ? 's' : ''}${verdict.thinOnly ? ' after cleanup' : ''}` : verdict.blockedByLayers ? `blocked by the layer limit (−${(100 * verdict.gain).toFixed(1)} % possible)` : verdict.blockedByTOT ? `blocked by the thickness limit (−${(100 * verdict.gain).toFixed(1)} % possible)` : `still possible: −${verdict.gain < 5e-4 ? '<0.1' : (100 * verdict.gain).toFixed(1)} %`,
        growth: stop.kind === 'stagnation' ? `no further gain: no progress in three cycles${stop.growthCapped ? ', last step capped' : ''}` : stop.kind === 'tot' ? 'impossible: at the thickness limit' : stop.kind === 'target' ? 'not needed: target reached' : `${stats.growths} step${stats.growths === 1 ? '' : 's'}, not stalled`,
        budget: `exhausted: ${budgetText().replace(/^Time budget exhausted ?/, '').replace(/^\((.*)\)$/, '$1') || budgetText()}`,
        cycles: `exhausted: ${maxCycles} cycles`,
      };
      for (const f of facts) { f.decisive = f.key === decisive; f.short = short[f.key]; }
      // the reported design: which one it is, and why a lower merit may have been seen during the run
      const which = fromArchive
        ? `the best complete design of the run (cycle ${fromArchive.cycle}${finalGain ? ', improved in the final phase' : ''}); ${terminalNote}`
        : `the design at termination (cycle ${terminal.cycle}) after the final ${finalCleanupRemoved ? `cleanup (${finalCleanupRemoved} thin layer${finalCleanupRemoved > 1 ? 's' : ''} removed) and ` : ''}refinement${finalGain ? ` and ${finalGain.needles} further needle${finalGain.needles > 1 ? 's' : ''} in the final phase (F ${sci(finalGain.from)} → ${sci(finalGain.to)})` : ''}`;
      const lowerNotes = [];
      if (lowestShown && lowestShown.F < Ff * (1 - 1e-9) && !lowestShown.complete) lowerNotes.push(`the lowest merit shown during the run, F = ${sci(lowestShown.F)} (cycle ${lowestShown.cycle}), belonged to a design with a layer thinner than ${dMin} nm — such layers are removed, and the completed design is not better than the reported one`);
      if (lowestOldGrid && lowestOldGrid.F < Ff * (1 - 1e-9)) lowerNotes.push(`values down to F = ${sci(lowestOldGrid.F)} before the grid enrichment were measured on the coarser grid of ${problem.wavelengths.length - stats.pointsAdded} points; on the final grid of ${problem.wavelengths.length} points the reported design is the best`);
      const guarantee = `Reported F = ${sci(Ff)} is the lowest merit of any complete design within the limits evaluated in the run on the final grid${lowerNotes.length ? ` (${lowerNotes.join('; ')})` : ''}.`;
      stop.summary = { decisive, headline, detail, facts, reported: which, guarantee };
    }

    // ---------------- self-check: the reported reason must be backed by the facts of the run ----------------
    const checks = [];
    const chk = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
    const improvingAdmissible = trials.filter((t) => t.admissible && t.delta != null && t.delta < -eps).length;
    switch (stop.kind) {
      case 'target':
        if (/^Target merit reached \(/.test(stop.base)) chk('target reached on the optimization grid', Ff <= targetF, `F = ${Ff.toExponential(3)} vs ${targetF.toExponential(1)}`);
        if (/^Target merit reached \(/.test(stop.base)) chk('target reached on the dense grid', !dcf || dcf.F <= targetF, dcf ? `F_dense = ${dcf.F.toExponential(3)}` : 'dense check off');
        if (/not on the dense/.test(stop.base)) chk('grid passes, dense grid fails', Ff <= targetF && dcf && dcf.F > targetF, '');
        break;
      case 'tot':
        chk('design at termination is at the optical‑thickness limit', terminal.opticalThickness >= maxTOT - 1e-6, `${terminal.opticalThickness.toFixed(1)} nm vs ${maxTOT} nm`);
        if (!fromArchive) chk('reported design is at the optical‑thickness limit, or the reason states its thickness', finalTOT >= maxTOT - 1 || /reported design has/.test(reason), `${finalTOT.toFixed(1)} nm`);
        break;
      case 'stagnation':
        chk('three cycles without progress recorded', noProgress >= 3, `${noProgress} cycles`);
        if (stop.needleStop === 'layer-limit') chk('layer limit blocks interior needles in the reported design', layers.length >= maxLayers - 1, `${layers.length} of ${maxLayers} layers`);
        if (stop.needleStop === 'stationary') chk('reported design is needle‑stationary', scanF.candidates.length === 0, `${scanF.candidates.length} negative minima`);
        if (stop.growthCapped) chk('last growth step was capped by the optical‑thickness limit', stop.growthCapped, '');
        break;
      case 'budget':
        chk('budget actually exhausted', Date.now() - t0 >= budgetMs || stats.refinements >= maxRefinements, Number.isFinite(maxRefinements) ? `${stats.refinements} refinements` : `${((Date.now() - t0) / 1000).toFixed(1)} s`);
        break;
      default:
        chk('cycle budget exhausted', stats.cycles >= maxCycles, `${stats.cycles} cycles`);
    }
    // the reported design is the best complete design of the run, and no admissible needle improves it
    chk('reported design has no layer below the thin‑layer threshold', isComplete(layers) || layers.length === 1, `min d = ${Math.min(...layers.map((L) => L.d)).toFixed(3)} nm vs ${dMin} nm`);
    chk('reported F is the lowest merit of a complete design within the limits seen in the run (final grid)', !best || Ff <= best.F + 1e-15, best ? `${Ff.toExponential(3)} vs archive ${best.F.toExponential(3)} (cycle ${best.cycle})` : 'no archive');
    chk('reported F is not above the completed design at termination', Ff <= completedTerminal.F + 1e-15, `${Ff.toExponential(3)} vs ${completedTerminal.F.toExponential(3)}`);
    if (stop.kind !== 'target' && stop.kind !== 'budget' && !exploitBudget && !exploitCapped) chk('no admissible needle (within the limits, complete after cleanup) lowers the reported merit', improvingAdmissible === 0, `${improvingAdmissible} improving of ${trials.length} tested`);
    chk('archive note present exactly when the reported design is the archived one', /best complete design of the run/.test(reason) === !!fromArchive, fromArchive ? `archived from cycle ${fromArchive.cycle}` : 'terminal design reported');
    {
      const d = stop.summary.facts.find((f) => f.decisive);
      chk('summary headline names a stopping condition that actually holds', d && (d.hit || (d.key === 'target' && /only|before the final cleanup/.test(stop.summary.headline))), `${stop.summary.headline}: ${d ? d.text : 'no decisive fact'}`);
      chk('summary and reason describe the same cause', ({ target: /^Target merit/, tot: /^Optical‑thickness limit/, budget: /budget/i, cycles: /^Cycle budget/, layers: /layer limit/, needle: /needle‑stationary|no needle lowers/, growth: /^No further progress|step limit/ })[stop.summary.decisive].test(stop.base), `${stop.summary.decisive} ↔ «${stop.base}»`);
    }
    chk('reported design respects the limits', layers.length <= maxLayers && finalTOT <= maxTOT + 1e-6, `${layers.length} layers, ${finalTOT.toFixed(1)} nm`);
    chk('reported F equals an independent re‑evaluation', Math.abs(assess(layers, problem.wavelengths, problem.target, problem.weights, model).F - Ff) <= 1e-15, '');
    stop.checks = checks; stop.verified = checks.every((c) => c.ok);
  }
  const done = {
    type: 'done', layers: copy(layers), R: Rf, F: Ff, reason, stop, stats, opticalThickness: finalTOT,
    grid: { wavelengths: Float64Array.from(problem.wavelengths), target: cloneTarget(problem.target), weights: cloneTarget(problem.weights) },
    dense: dcf ? { wavelengths: dense.wavelengths, target: dense.target, weights: dense.weights, R: dcf.R, Rs: dcf.Rs, Rp: dcf.Rp, F: dcf.F, maxDev: dcf.maxDev } : null,
    start: cfg.start, elapsedMs: Date.now() - t0,
  };
  yield done;
  return done;
}

function cloneTarget(t) { return t && !t.length ? { s: Float64Array.from(t.s), p: Float64Array.from(t.p) } : Float64Array.from(t); }

/**
 * Add the worst‑resolved dense‑grid points to the optimization grid
 * (doc A.3, ENRICH_GRID). A candidate must lie at least a quarter of the local
 * grid spacing away from existing points. Returns the added wavelengths.
 * `dc` is the dense check ({R} or {Rs, Rp} for separate Rs/Rp targets); with
 * `bands2` the Rp target has its own bands and the error is the larger of the two.
 */
export function enrichGrid(problem, dense, dc, bands, transition, count, bands2 = null) {
  const wl = Array.from(problem.wavelengths);
  const errs = [];
  const Rdense = dc.length ? dc : dc.R;
  const dual = !!bands2 && dc.Rs && dc.Rp;
  const ts = polTarget(dense.target, 's'), tp = polTarget(dense.target, 'p'), ws = polTarget(dense.weights, 's'), wp = polTarget(dense.weights, 'p');
  for (let i = 0; i < dense.wavelengths.length; i++) {
    if (dual) {
      const es = ws[i] > 0 ? Math.abs(dc.Rs[i] - ts[i]) : 0, ep = wp[i] > 0 ? Math.abs(dc.Rp[i] - tp[i]) : 0;
      if (ws[i] <= 0 && wp[i] <= 0) continue;
      errs.push({ w: dense.wavelengths[i], e: Math.max(es, ep) });
      continue;
    }
    if (ws[i] <= 0) continue;
    errs.push({ w: dense.wavelengths[i], e: Math.abs(Rdense[i] - ts[i]) });
  }
  errs.sort((a, b) => b.e - a.e);
  const added = [];
  const spacing = (wl[wl.length - 1] - wl[0]) / Math.max(1, wl.length - 1);
  for (const c of errs) {
    if (added.length >= count) break;
    const all = wl.concat(added);
    let near = Infinity; for (const w of all) near = Math.min(near, Math.abs(w - c.w));
    if (near < spacing * 0.25) continue;
    added.push(c.w);
  }
  if (!added.length) return added;
  const merged = wl.concat(added).sort((a, b) => a - b);
  const s = bands2 ? sampleDualTarget(bands, bands2, merged, transition) : sampleTarget(bands, merged, transition);
  problem.wavelengths = Float64Array.from(merged); problem.target = s.target; problem.weights = s.weights;
  return added;
}

/**
 * Thorough thickness‑growth search (Tikhonravov, Optical Coatings §1.2.3,
 * Fig. 1.17; doc eq. 12.4): for every layer scan Φ_j(s) = F(d + s e_j) and
 * locate the nearest local minimum at s > 0; pick the layer whose minimum has
 * the smallest F that still respects the optical‑thickness limit.
 */
export function growthSearch(layers, problem, { lamMin, lamMax, maxTOT }) {
  const { wavelengths, target, weights } = problem;
  const model = problem.model || { ns: problem.ns, na: problem.na ?? 1 };
  const evalF = (ls) => meritOf(ls, wavelengths, target, weights, model);
  const tot = totalOpticalThickness(layers);
  let bestPick = null;
  for (let j = 0; j < layers.length; j++) {
    const n = layers[j].n;
    const sMax = Math.min(0.75 * lamMax / n, (maxTOT - tot) / n);
    if (sMax <= 1e-6) continue;
    const step = lamMin / (48 * n);
    const count = Math.max(8, Math.ceil(sMax / step) + 1);
    const curve = new Float64Array(count), ss = new Float64Array(count);
    const trial = layers.map((L) => ({ ...L }));
    for (let i = 0; i < count; i++) {
      const s = sMax * i / (count - 1);
      trial[j].d = layers[j].d + s;
      ss[i] = s; curve[i] = evalF(trial);
    }
    let found = -1;
    for (let i = 1; i < count - 1; i++) {
      if (curve[i] <= curve[i - 1] && curve[i] <= curve[i + 1]) {
        let rose = false;
        for (let q = 1; q <= i; q++) if (curve[q] > curve[0] * (1 + 1e-9) + 1e-18) { rose = true; break; }
        if (rose) { found = i; break; }
      }
    }
    if (found < 0) continue;
    let a = ss[found - 1], b = ss[found + 1];
    const f = (s) => { trial[j].d = layers[j].d + s; return evalF(trial); };
    const gr = (Math.sqrt(5) - 1) / 2;
    let c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
    for (let it = 0; it < 50 && b - a > 1e-5; it++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
    }
    const s = (a + b) / 2, Fs = f(s);
    if (!bestPick || Fs < bestPick.F) bestPick = { layer: j, s, F: Fs, curve: { s: Array.from(ss), F: Array.from(curve) } };
  }
  if (bestPick) return bestPick;
  let fb = null;
  for (let j = 0; j < layers.length; j++) {
    const n = layers[j].n;
    const s = Math.min(lamMax / (2 * n), (maxTOT - tot) / n);
    if (s <= 1e-6) continue;
    const trial = layers.map((L) => ({ ...L })); trial[j].d += s;
    const Fs = evalF(trial);
    if (!fb || Fs < fb.F) fb = { layer: j, s, F: Fs, curve: null };
  }
  return fb;
}

/**
 * The result record of one explored starting design: the ranking fields, the
 * complete `done` event of its synthesis (the reported design on its own
 * grid, the dense check, the termination summary and self‑check, the
 * statistics — everything the interface shows and the export writes for a
 * finished run) and the final needle scan, so that any explored result can
 * be shown on the dashboard and exported like the run's own result.
 */
export function exploreResult(index, s, done, finalScan = null) {
  const score = done.dense ? Math.max(done.F, done.dense.F) : done.F;
  return { index, name: s.name, start: s.start, F: done.F, Fdense: done.dense ? done.dense.F : null, score, layers: done.layers, opticalThickness: done.opticalThickness, reason: done.reason, baseReason: done.stop.base, stopKind: done.stop.kind, summary: done.stop.summary, refinements: done.stop.refinements, elapsedMs: done.elapsedMs, done, finalScan };
}

/**
 * Multi‑start exploration: run every starting design to completion and
 * yield its result; the final event carries the ranking. `cfg.starts` is a
 * list of { name, start }; defaults to startDesigns(cfg).
 */
export function* explore(cfg) {
  const lamMin = Math.min(...cfg.wavelengths), lamMax = Math.max(...cfg.wavelengths);
  const starts = cfg.starts || startDesigns(cfg, (lamMin + lamMax) / 2);
  const results = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    yield { type: 'explore-start', index: i, total: starts.length, name: s.name };
    let done = null, finalScan = null;
    for (const ev of synthesize({ ...cfg, start: { ...s.start, name: s.name } })) { if (ev.type === 'done') done = ev; else if (ev.type === 'final-scan') finalScan = ev; }
    results.push(exploreResult(i, s, done, finalScan));
    yield { type: 'explore-result', ...results[results.length - 1] };
  }
  const ranked = results.slice().sort((a, b) => a.score - b.score);
  yield { type: 'explore-done', results: ranked, best: ranked[0] };
}
