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
import { sampleTarget, denseGrid } from './config.js';

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
  const problem = { wavelengths: Float64Array.from(cfg.wavelengths), target: Float64Array.from(cfg.target), weights: Float64Array.from(cfg.weights), ns, na, model };
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
  const transition = cfg.transition ?? 0;
  const denseOn = !!(cfg.dense?.enabled ?? bands);
  const enrichOn = denseOn && (cfg.enrich?.enabled ?? true);
  const enrichCap = cfg.enrich?.maxPoints ?? Math.max(4 * problem.wavelengths.length, 400);
  const enrichPerCycle = cfg.enrich?.perCycle ?? 8;
  // The dense grid excludes one optimization-grid step around every target jump (a discrete
  // grid cannot resolve an ideal edge better than its spacing); a wider user transition zone wins.
  const gridStep = (lamMax - lamMin) / Math.max(1, problem.wavelengths.length - 1);
  const denseTransition = Math.max(transition, 2 * gridStep);
  const dense = denseOn ? denseGrid(bands, lamMin, lamMax, denseTransition, cfg.dense?.points) : null;
  const denseCheck = (ls) => {
    if (!dense) return null;
    const a = assess(ls, dense.wavelengths, dense.target, dense.weights, model);
    return { F: a.F, maxDev: a.maxDev, R: a.R, Rs: a.Rs, Rp: a.Rp };
  };

  const startMat = cfg.start.material ? (cfg.start.material === H.m ? H : Lm) : H;
  let layers = startLayers(cfg);
  const evalF = (ls) => meritOf(ls, problem.wavelengths, problem.target, problem.weights, model);
  const evalR = (ls) => reflectance(ls, problem.wavelengths, model);
  const stats = { refinements: 0, needles: 0, rejected: 0, compared: 0, growths: 0, cleanups: 0, lmIterations: 0, cycles: 0, enrichments: 0, pointsAdded: 0 };
  let best = null;
  const keepBest = (ls, F) => {
    if (!best || (F < best.F && ls.length <= maxLayers && totalOpticalThickness(ls) <= maxTOT + 1e-9)) best = { layers: copy(ls), F, grid: problem.wavelengths, cycle: stats.cycles };
  };
  const overBudget = () => Date.now() - t0 > budgetMs || stats.refinements >= maxRefinements;
  const budgetText = () => cfg.budgetReason || `Time budget exhausted (${(budgetMs / 1000).toFixed(0)} s)`;
  const reached = (F, dc) => F <= targetF && (!dc || dc.F <= targetF);

  function* doRefine(ls, label) {
    yield { type: 'stage', stage: 'refine', label };
    const it = refine(ls, problem, lmOpts);
    for (;;) {
      const r = it.next();
      if (r.done) {
        stats.refinements++; stats.lmIterations += r.value.iterations;
        const res = r.value;
        yield { type: 'refined', layers: copy(res.layers), R: res.R, F: res.F, iterations: res.iterations, reason: res.reason };
        return res;
      }
      yield { type: 'refine', layers: r.value.layers, R: r.value.R, F: r.value.F, iter: r.value.iter };
    }
  }
  const silentRefine = (ls) => { const r = refineToEnd(ls, problem, lmOpts); stats.refinements++; stats.lmIterations += r.iterations; return r; };

  let R0 = evalR(layers);
  let F = evalF(layers);
  yield { type: 'start', layers: copy(layers), R: R0, F, name: cfg.start.name || null };
  let res = yield* doRefine(layers, 'Initial refinement');
  layers = dropZeroLayers(res.layers, startMat); F = res.F; keepBest(layers, F);

  let stop = null;            // structured termination cause
  let needleStop = null;      // why the last needle cycle ended: target | budget | stationary | layer-limit | no-gain | steps
  let growthCapped = false;   // the last growth step was limited by the optical-thickness bound
  let layerLimitPartial = false;   // layer limit excluded interior needles while the admissible boundary needles gave no gain
  let noProgress = 0;
  let dc = null;
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
        const added = enrichGrid(problem, dense, dc.R, bands, transition, Math.min(enrichPerCycle, enrichCap - problem.wavelengths.length));
        if (added.length) {
          stats.enrichments++; stats.pointsAdded += added.length;
          F = evalF(layers);
          yield { type: 'grid', wavelengths: Float64Array.from(problem.wavelengths), target: Float64Array.from(problem.target), weights: Float64Array.from(problem.weights), added, layers: copy(layers), R: evalR(layers), F };
          const rg = yield* doRefine(layers, 'Refinement on the enriched grid');
          layers = dropZeroLayers(rg.layers, startMat); F = rg.F; best = null; keepBest(layers, F);
          dc = denseCheck(layers);
          yield { type: 'dense', F: dc.F, maxDev: dc.maxDev, Fgrid: F, points: dense.wavelengths.length };
        }
      }
    }
    if (reached(F, dc)) { stop = { kind: 'target' }; break; }
    if (overBudget()) { stop = { kind: 'budget' }; break; }

    // ---------------- needle cycle ----------------
    needleStop = 'steps';
    for (let needleStep = 0; needleStep < 200; needleStep++) {
      if (F <= targetF && (!dc || dc.F <= targetF)) { needleStop = 'target'; break; }
      if (overBudget()) { needleStop = 'budget'; stop = { kind: 'budget' }; break; }   // stop immediately: no further design change after a budget stop
      yield { type: 'stage', stage: 'needle' };
      const ev = evaluate(layers, problem.wavelengths, problem.target, problem.weights, model, true);
      const scan = scanNeedles(layers, ev.adjoint, problem.wavelengths, other);
      yield { type: 'scan', z: scan.z, g: scan.g, layer: scan.layer, total: scan.total, candidates: scan.candidates.slice(0, 8), layers: copy(layers), F };
      if (!scan.candidates.length) { needleStop = 'stationary'; yield { type: 'note', text: 'No negative needle derivative: the design is needle‑stationary.' }; break; }
      // admissible candidates within the layer limit
      const pool = scan.candidates.filter((c) => layers.length + (c.kind === 'interior' ? 2 : 1) <= maxLayers);
      const blocked = scan.candidates.length - pool.length;   // candidates excluded by the layer limit
      if (!pool.length) { needleStop = 'layer-limit'; layerLimitPartial = false; yield { type: 'note', text: `Layer limit (${maxLayers}) reached: no further needle can be inserted into the ${layers.length}-layer design.` }; break; }
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
        const cleaned = dropZeroLayers(r.layers, startMat);
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
        if (blocked) { needleStop = 'layer-limit'; layerLimitPartial = true; yield { type: 'note', text: `Layer limit (${maxLayers}): ${blocked} needle candidate${blocked > 1 ? 's' : ''} inside the layers would exceed it; the ${pool.length} admissible boundary needle${pool.length > 1 ? 's do' : ' does'} not lower the merit.` }; }
        else needleStop = 'no-gain';
        break;
      }
      stats.needles++;
      const t = bestTrial;
      yield { type: 'needle', candidate: t.cand, eta: t.eta, material: t.mat.m, layers: t.trial.map((L) => ({ ...L })), R: evalR(t.trial), F: t.Ft, Fparent: F, attempts: t.attempts, alternatives: trials.filter((x) => x.ok).length };
      const r2 = yield* doRefine(t.trial, 'Refinement after needle');
      const cleaned = dropZeroLayers(r2.layers, startMat);
      const Fc = evalF(cleaned);
      if (Fc < F * (1 - eps) && cleaned.length <= maxLayers) { layers = cleaned; F = Fc; keepBest(layers, F); }
      else { stats.rejected++; needleStop = blocked ? 'layer-limit' : 'no-gain'; layerLimitPartial = blocked > 0; yield { type: 'needle-rejected', candidate: t.cand, why: `refined merit ${Fc.toExponential(3)} is not below parent ${F.toExponential(3)}`, layers: copy(layers), R: evalR(layers), F }; break; }
    }
    if (stop) break;

    // ---------------- thin-layer cleanup ----------------
    if (layers.some((L) => L.d < dMin) && layers.length > 1) {
      yield { type: 'stage', stage: 'cleanup' };
      const { layers: cl, removed } = cleanThinLayers(layers, dMin);
      if (removed) {
        stats.cleanups += removed;
        yield { type: 'cleanup', removed, layers: copy(cl), R: evalR(cl), F: evalF(cl), before: copy(layers) };
        const r3 = yield* doRefine(cl, 'Refinement after cleanup');
        layers = dropZeroLayers(r3.layers, startMat); F = r3.F; keepBest(layers, F);
      }
    }
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
    yield { type: 'growth', layer: growth.layer, from: layers[growth.layer].d, to: grown[growth.layer].d, curve: growth.curve, layers: grown, R: evalR(grown), F: growth.F, Fparent: F };
    const r4 = yield* doRefine(grown, 'Refinement after growth');
    layers = dropZeroLayers(r4.layers, startMat); F = r4.F; keepBest(layers, F);

    if (F < cycleStartF * (1 - 1e-4)) noProgress = 0;
    else if (++noProgress >= 3) stop = { kind: 'stagnation' };
  }
  if (!stop) stop = { kind: 'cycles' };
  stop.needleStop = needleStop; stop.growthCapped = growthCapped; stop.layerLimitPartial = needleStop === 'layer-limit' && layerLimitPartial; stop.refinements = stats.refinements;   // work done up to the stop (replay budget)
  const terminal = { F, layers: layers.length, opticalThickness: totalOpticalThickness(layers), cycle: stats.cycles };

  // ---------------- final: cleanup + final refinement, report best ----------------
  yield { type: 'stage', stage: 'final' };
  let fromArchive = null, finalCleanupRemoved = 0;
  // use the archived design only when it is meaningfully better than the design at termination
  if (best && best.F < F * (1 - 1e-3)) { fromArchive = { cycle: best.cycle, F: best.F }; layers = copy(best.layers); F = best.F; }
  if (layers.some((L) => L.d < dMin) && layers.length > 1) {
    const { layers: cl, removed } = cleanThinLayers(layers, dMin);
    if (removed) {
      stats.cleanups += removed; finalCleanupRemoved = removed;
      yield { type: 'cleanup', removed, layers: copy(cl), R: evalR(cl), F: evalF(cl), before: copy(layers), final: true };
      const r5 = yield* doRefine(cl, 'Final refinement');
      layers = dropZeroLayers(r5.layers, startMat); F = r5.F;
    }
  } else {
    const r5 = yield* doRefine(layers, 'Final refinement');
    layers = dropZeroLayers(r5.layers, startMat); F = r5.F;
  }
  const Rf = evalR(layers);
  const Ff = evalF(layers);
  const dcf = denseCheck(layers);
  const finalTOT = totalOpticalThickness(layers);
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
      reason = reached(Ff, dcf) ? `Target merit reached (F = ${Ff.toExponential(2)} ≤ ${targetF.toExponential(0)})`
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
  if (fromArchive) reason += ` · reported design is the best archived one (cycle ${fromArchive.cycle}, F = ${Ff.toExponential(2)}); the design at termination had F = ${terminal.F.toExponential(2)}, ${terminal.layers} layers, ${terminal.opticalThickness.toFixed(0)} nm`;
  stop.text = reason; stop.fromArchive = fromArchive; stop.terminal = terminal;

  // ---------------- final needle scan: evidence that insertions no longer help ----------------
  {
    const evF = evaluate(layers, problem.wavelengths, problem.target, problem.weights, model, true);
    const scanF = scanNeedles(layers, evF.adjoint, problem.wavelengths, other);
    const top = scanF.candidates.slice(0, Math.max(1, kCand > 0 ? kCand : 3)).slice(0, 5);
    const trials = [];
    for (const cand of top) {
      const mat = matByIndex(cand.nm);
      const etaMax = cand.kind === 'interior' ? 2 * Math.min(cand.x, layers[cand.layer].d - cand.x) : eta0;
      let eta = Math.min(eta0, etaMax * 0.5), trial = null, Ft = Infinity;
      while (eta >= 1e-3) { trial = insertNeedle(layers, cand, eta, mat); Ft = evalF(trial); if (Ft <= Ff + 1e-4 * eta * cand.g) break; eta *= 0.5; trial = null; }
      let Fref = null, nl = null;
      if (trial) { const r = refineToEnd(trial, problem, lmOpts); const cl = dropZeroLayers(r.layers, startMat); Fref = evalF(cl); nl = cl.length; }
      trials.push({ layer: cand.layer, kind: cand.kind, z: cand.z, g: cand.g, material: mat.m, eta: trial ? eta : null, Finsert: trial ? Ft : null, Frefined: Fref, layers: nl, delta: Fref != null ? Fref / Ff - 1 : null, withinLayerLimit: layers.length + (cand.kind === 'interior' ? 2 : 1) <= maxLayers });
    }
    const improving = trials.filter((t) => t.delta != null && t.delta < -eps);
    let verdict;
    if (!scanF.candidates.length) verdict = { kind: 'stationary', text: 'Needle‑stationary design: g(z) ≥ 0 everywhere — no insertion lowers the merit to first order.' };
    else if (!improving.length) verdict = { kind: 'no-gain', text: `${scanF.candidates.length} negative minim${scanF.candidates.length > 1 ? 'a' : 'um'} of g(z), but none of the ${trials.length} best lowers F after refinement (ΔF ≥ 0).` };
    else {
      const b = improving.sort((p, q) => p.delta - q.delta)[0];
      const blockedByLayers = layers.length + (b.kind === 'interior' ? 2 : 1) > maxLayers;
      const why = stop.kind === 'target' ? ' — not needed: the target is reached'
        : blockedByLayers ? ` — blocked by the layer limit (${maxLayers})`
        : stop.kind === 'tot' || finalTOT >= maxTOT - 1e-6 ? ` — the search stopped at the optical‑thickness limit (${maxTOT} nm)`
        : stop.kind === 'budget' ? ' — the run stopped by its budget'
        : stop.kind === 'stagnation' && fromArchive ? ' — found for the archived design; the search had already stalled on a later design'
        : ' — the search stalled before exploiting it';
      verdict = { kind: 'possible', text: `An insertion could still lower F by ${(100 * -b.delta).toFixed(1)} % (${b.material} at z = ${b.z.toFixed(1)} nm)${why}.`, blockedByLayers, gain: -b.delta, material: b.material, z: b.z };
    }
    yield { type: 'final-scan', z: scanF.z, g: scanF.g, layer: scanF.layer, total: scanF.total, candidates: scanF.candidates.slice(0, 8), trials, verdict, layers: copy(layers), F: Ff };

    // ---------------- plain-language summary: decisive cause, state of every stopping condition, reported design ----------------
    // The same structure is shown in the interface (single- and multi-start alike) and written to the export.
    {
      const sci = (x) => x.toExponential(2);
      const needleStalled = stop.needleStop === 'stationary' || stop.needleStop === 'no-gain';
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
        layers: `${terminal.layers} of ${maxLayers} layers at termination: ${stop.layerLimitPartial ? 'a needle inside a layer would exceed the limit and the boundary needles that fit do not lower the merit' : 'no further needle with a negative derivative fits within the limit'}; ${growthDetail}`,
        needle: `${stop.needleStop === 'stationary' ? 'g(z) ≥ 0 everywhere (needle‑stationary design)' : 'no needle lowers the merit after refinement'}; ${growthDetail}`,
        growth: growthDetail,
      }[decisive];
      const needleNow = verdict.kind === 'stationary' ? 'no further gain: g(z) ≥ 0 everywhere — no insertion lowers F to first order'
        : verdict.kind === 'no-gain' ? `no further gain: ${scanF.candidates.length} negative minim${scanF.candidates.length > 1 ? 'a' : 'um'} of g(z); the ${trials.length} best tested after refinement, none lowers F (ΔF ≥ 0)`
        : verdict.blockedByLayers ? `blocked by the layer limit: an insertion (${verdict.material} at z = ${verdict.z.toFixed(1)} nm) would lower F by ${(100 * verdict.gain).toFixed(1)} % but exceed ${maxLayers} layers`
        : `still possible: ${verdict.text.replace(/^An insertion/, 'an insertion').replace(/\.$/, '')}`;
      const interiorBlocked = layers.length + 2 > maxLayers;   // an interior needle adds two layers
      const facts = [
        { key: 'target', label: 'Target merit', hit: reached(Ff, dcf),
          text: reached(Ff, dcf) ? `reached: F = ${sci(Ff)} ≤ ${targetF.toExponential(0)}${dcf ? ` (dense grid ${sci(dcf.F)})` : ''}`
            : dcf && Ff <= targetF ? `F = ${sci(Ff)} ≤ ${targetF.toExponential(0)} on the optimization grid, but ${sci(dcf.F)} on the dense check grid`
            : `not reached: F = ${sci(Ff)} > ${targetF.toExponential(0)}` },
        { key: 'layers', label: 'Layer limit', hit: stop.needleStop === 'layer-limit' || interiorBlocked,
          text: stop.needleStop === 'layer-limit'
            ? `reached: ${terminal.layers} of ${maxLayers} layers at termination — ${stop.layerLimitPartial ? 'a needle inside a layer would exceed the limit; the boundary needles that fit do not lower the merit' : 'no further needle with a negative derivative fits within the limit'}${layers.length !== terminal.layers ? ` (reported design: ${layers.length} layers after the final cleanup)` : ''}`
            : interiorBlocked ? `reached: ${layers.length} of ${maxLayers} layers — a needle inside a layer would add two layers and exceed the limit`
            : `not reached: ${layers.length} of ${maxLayers} layers` },
        { key: 'tot', label: 'Optical‑thickness limit', hit: stop.kind === 'tot',
          text: stop.kind === 'tot'
            ? `reached: ${terminal.opticalThickness.toFixed(0)} of ${maxTOT} nm at termination${finalTOT < maxTOT - 1 ? ` (reported design: ${finalTOT.toFixed(0)} nm after the final cleanup and refinement)` : ''}`
            : `not reached: ${finalTOT.toFixed(0)} of ${maxTOT} nm` },
        { key: 'needle', label: 'Needle variations', hit: verdict.kind !== 'possible' || !!verdict.blockedByLayers || needleStalled,
          text: `${needleNow}${(needleStalled || stop.layerLimitPartial) && (fromArchive || finalCleanupRemoved) ? `; at termination ${stop.needleStop === 'stationary' ? 'the design was needle‑stationary' : stop.layerLimitPartial ? 'the admissible boundary needles did not lower the merit' : 'no needle lowered the merit after refinement'}` : ''}` },
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
        layers: stop.needleStop === 'layer-limit' ? `reached: ${terminal.layers} of ${maxLayers}${stop.layerLimitPartial ? ' — boundary needles give no gain' : ''}` : interiorBlocked ? `reached: ${layers.length} of ${maxLayers} — no room for an interior needle` : `not reached: ${layers.length} of ${maxLayers}`,
        tot: stop.kind === 'tot' ? `reached: ${terminal.opticalThickness.toFixed(0)} of ${maxTOT} nm${finalTOT < maxTOT - 1 ? ` (reported ${finalTOT.toFixed(0)} nm)` : ''}` : `not reached: ${finalTOT.toFixed(0)} of ${maxTOT} nm`,
        needle: verdict.kind === 'stationary' ? 'no further gain: g(z) ≥ 0 everywhere' : verdict.kind === 'no-gain' ? `no further gain: ΔF ≥ 0 for the ${trials.length} best candidate${trials.length > 1 ? 's' : ''}` : verdict.blockedByLayers ? `blocked by the layer limit (−${(100 * verdict.gain).toFixed(1)} % possible)` : `still possible: −${(100 * verdict.gain).toFixed(1)} %`,
        growth: stop.kind === 'stagnation' ? `no further gain: no progress in three cycles${stop.growthCapped ? ', last step capped' : ''}` : stop.kind === 'tot' ? 'impossible: at the thickness limit' : stop.kind === 'target' ? 'not needed: target reached' : `${stats.growths} step${stats.growths === 1 ? '' : 's'}, not stalled`,
        budget: `exhausted: ${budgetText().replace(/^Time budget exhausted ?/, '').replace(/^\((.*)\)$/, '$1') || budgetText()}`,
        cycles: `exhausted: ${maxCycles} cycles`,
      };
      for (const f of facts) { f.decisive = f.key === decisive; f.short = short[f.key]; }
      const reported = fromArchive
        ? `the best archived design (cycle ${fromArchive.cycle}, F = ${sci(Ff)}); the design at termination (cycle ${terminal.cycle}: F = ${sci(terminal.F)}, ${terminal.layers} layers, ${terminal.opticalThickness.toFixed(0)} nm) was worse`
        : `the design at termination (cycle ${terminal.cycle}) after the final ${finalCleanupRemoved ? `cleanup (${finalCleanupRemoved} thin layer${finalCleanupRemoved > 1 ? 's' : ''} removed) and ` : ''}refinement`;
      stop.summary = { decisive, headline, detail, facts, reported };
    }

    // ---------------- self-check: the reported reason must be backed by the facts of the run ----------------
    const checks = [];
    const chk = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
    const improvingNow = trials.filter((t) => t.delta != null && t.delta < -eps).length;
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
        if (stop.needleStop === 'layer-limit') chk('layer limit blocks interior needles', terminal.layers >= maxLayers - 1, `${terminal.layers} of ${maxLayers} layers at termination`);
        if (stop.layerLimitPartial && !fromArchive && !finalCleanupRemoved) chk('no admissible needle improves the reported design', trials.filter((t) => t.withinLayerLimit && t.delta != null && t.delta < -eps).length === 0, `${trials.filter((t) => t.withinLayerLimit).length} admissible of ${trials.length} tested`);
        if (stop.needleStop === 'stationary' && !fromArchive && !finalCleanupRemoved) chk('reported design is needle‑stationary', scanF.candidates.length === 0, `${scanF.candidates.length} negative minima`);
        if (stop.needleStop === 'no-gain' && !fromArchive && !finalCleanupRemoved) chk('no tested needle improves the reported design', improvingNow === 0, `${improvingNow} improving of ${trials.length} tested`);
        if (stop.growthCapped) chk('last growth step was capped by the optical‑thickness limit', stop.growthCapped, '');
        break;
      case 'budget':
        chk('budget actually exhausted', Date.now() - t0 >= budgetMs || stats.refinements >= maxRefinements, Number.isFinite(maxRefinements) ? `${stats.refinements} refinements` : `${((Date.now() - t0) / 1000).toFixed(1)} s`);
        break;
      default:
        chk('cycle budget exhausted', stats.cycles >= maxCycles, `${stats.cycles} cycles`);
    }
    chk('archive note present exactly when the reported design is the archived one', /best archived/.test(reason) === !!fromArchive, fromArchive ? `archived from cycle ${fromArchive.cycle}` : 'terminal design reported');
    if (fromArchive) chk('archived design is better than the terminal one', Ff < terminal.F, `${Ff.toExponential(3)} < ${terminal.F.toExponential(3)}`);
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
    grid: { wavelengths: Float64Array.from(problem.wavelengths), target: Float64Array.from(problem.target), weights: Float64Array.from(problem.weights) },
    dense: dcf ? { wavelengths: dense.wavelengths, target: dense.target, weights: dense.weights, R: dcf.R, Rs: dcf.Rs, Rp: dcf.Rp, F: dcf.F, maxDev: dcf.maxDev } : null,
    start: cfg.start, elapsedMs: Date.now() - t0,
  };
  yield done;
  return done;
}

/**
 * Add the worst‑resolved dense‑grid points to the optimization grid
 * (doc A.3, ENRICH_GRID). A candidate must lie at least a quarter of the local
 * grid spacing away from existing points. Returns the added wavelengths.
 */
export function enrichGrid(problem, dense, Rdense, bands, transition, count) {
  const wl = Array.from(problem.wavelengths);
  const errs = [];
  for (let i = 0; i < dense.wavelengths.length; i++) {
    if (dense.weights[i] <= 0) continue;
    errs.push({ w: dense.wavelengths[i], e: Math.abs(Rdense[i] - dense.target[i]) });
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
  const s = sampleTarget(bands, merged, transition);
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
    let done = null;
    for (const ev of synthesize({ ...cfg, start: { ...s.start, name: s.name } })) if (ev.type === 'done') done = ev;
    const score = done.dense ? Math.max(done.F, done.dense.F) : done.F;
    results.push({ index: i, name: s.name, start: s.start, F: done.F, Fdense: done.dense ? done.dense.F : null, score, layers: done.layers, opticalThickness: done.opticalThickness, reason: done.reason, baseReason: done.stop.base, stopKind: done.stop.kind, summary: done.stop.summary, refinements: done.stop.refinements, elapsedMs: done.elapsedMs });
    yield { type: 'explore-result', ...results[results.length - 1] };
  }
  const ranked = results.slice().sort((a, b) => a.score - b.score);
  yield { type: 'explore-done', results: ranked, best: ranked[0] };
}
