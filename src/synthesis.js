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
  evaluate, reflectance, merit, scanNeedles, insertNeedle, cleanThinLayers,
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
  const out = [];
  if (cfg.start && !cfg.start.layers) out.push({ name: `${cfg.start.material} ${cfg.start.thickness} nm (manual)`, start: { ...cfg.start } });
  for (const mat of [Lm, H]) for (const q of [1, 2, 4, 8]) {
    const d = q * lambdaCenter / (4 * mat.n);
    if (mat.n * d <= (cfg.maxOpticalThickness ?? Infinity)) out.push({ name: `${mat.m} ${q} QWOT (${d.toFixed(1)} nm)`, start: { material: mat.m, thickness: d } });
  }
  const pairTOT = lambdaCenter / 2;
  const maxPairs = Math.floor(Math.min(((cfg.maxLayers ?? 40) - 1) / 2, 0.6 * (cfg.maxOpticalThickness ?? Infinity) / pairTOT));
  const N = Math.max(1, Math.min(12, maxPairs));
  if (maxPairs >= 1) {
    const layers = [];
    for (let i = 0; i < N; i++) { layers.push({ m: H.m, n: H.n, d: lambdaCenter / (4 * H.n) }); layers.push({ m: Lm.m, n: Lm.n, d: lambdaCenter / (4 * Lm.n) }); }
    if (2 * N + 1 <= (cfg.maxLayers ?? 40)) layers.push({ m: H.m, n: H.n, d: lambdaCenter / (4 * H.n) });
    out.push({ name: `(HL)${sup(N)}${layers.length % 2 ? 'H' : ''} quarter‑wave stack @ ${lambdaCenter.toFixed(0)} nm`, start: { layers } });
  }
  return out;
}
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(n) { return String(n).split('').map((c) => SUPS[+c]).join(''); }

export function* synthesize(cfg) {
  const { ns, na = 1, materials } = cfg;
  const problem = { wavelengths: Float64Array.from(cfg.wavelengths), target: Float64Array.from(cfg.target), weights: Float64Array.from(cfg.weights), ns, na };
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
    const R = reflectance(ls, dense.wavelengths, ns, na);
    let md = 0; for (let i = 0; i < R.length; i++) if (dense.weights[i] > 0) md = Math.max(md, Math.abs(R[i] - dense.target[i]));
    return { F: merit(R, dense.target, dense.weights), maxDev: md, R };
  };

  const startMat = cfg.start.material ? (cfg.start.material === H.m ? H : Lm) : H;
  let layers = startLayers(cfg);
  const evalF = (ls) => merit(reflectance(ls, problem.wavelengths, ns, na), problem.target, problem.weights);
  const stats = { refinements: 0, needles: 0, rejected: 0, compared: 0, growths: 0, cleanups: 0, lmIterations: 0, cycles: 0, enrichments: 0, pointsAdded: 0 };
  let best = null;
  const keepBest = (ls, F) => {
    if (!best || (F < best.F && ls.length <= maxLayers && totalOpticalThickness(ls) <= maxTOT + 1e-9)) best = { layers: copy(ls), F, grid: problem.wavelengths };
  };
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

  let R0 = reflectance(layers, problem.wavelengths, ns, na);
  let F = merit(R0, problem.target, problem.weights);
  yield { type: 'start', layers: copy(layers), R: R0, F, name: cfg.start.name || null };
  let res = yield* doRefine(layers, 'Initial refinement');
  layers = dropZeroLayers(res.layers, startMat); F = res.F; keepBest(layers, F);

  let reason = null;
  let noProgress = 0;
  let dc = null;
  for (let cycle = 1; cycle <= maxCycles && !reason; cycle++) {
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
          yield { type: 'grid', wavelengths: Float64Array.from(problem.wavelengths), target: Float64Array.from(problem.target), weights: Float64Array.from(problem.weights), added, layers: copy(layers), R: reflectance(layers, problem.wavelengths, ns, na), F };
          const rg = yield* doRefine(layers, 'Refinement on the enriched grid');
          layers = dropZeroLayers(rg.layers, startMat); F = rg.F; best = null; keepBest(layers, F);
          dc = denseCheck(layers);
          yield { type: 'dense', F: dc.F, maxDev: dc.maxDev, Fgrid: F, points: dense.wavelengths.length };
        }
      }
    }
    if (reached(F, dc)) { reason = 'Target merit reached'; break; }
    if (Date.now() - t0 > budgetMs) { reason = 'Time budget exhausted'; break; }

    // ---------------- needle cycle ----------------
    for (let needleStep = 0; needleStep < 200; needleStep++) {
      if (F <= targetF && (!dc || dc.F <= targetF)) break;
      if (Date.now() - t0 > budgetMs) break;
      yield { type: 'stage', stage: 'needle' };
      const ev = evaluate(layers, problem.wavelengths, problem.target, problem.weights, ns, na, true);
      const scan = scanNeedles(layers, ev.adjoint, problem.wavelengths, other);
      yield { type: 'scan', z: scan.z, g: scan.g, layer: scan.layer, total: scan.total, candidates: scan.candidates.slice(0, 8), layers: copy(layers), F };
      if (!scan.candidates.length) { yield { type: 'note', text: 'No negative needle derivative: the design is needle‑stationary.' }; break; }
      // admissible candidates within the layer limit
      const pool = scan.candidates.filter((c) => layers.length + (c.kind === 'interior' ? 2 : 1) <= maxLayers);
      if (!pool.length) { yield { type: 'note', text: 'Layer limit reached: no further needles can be inserted.' }; break; }
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
        break;
      }
      stats.needles++;
      const t = bestTrial;
      yield { type: 'needle', candidate: t.cand, eta: t.eta, material: t.mat.m, layers: t.trial.map((L) => ({ ...L })), R: reflectance(t.trial, problem.wavelengths, ns, na), F: t.Ft, Fparent: F, attempts: t.attempts, alternatives: trials.filter((x) => x.ok).length };
      const r2 = yield* doRefine(t.trial, 'Refinement after needle');
      const cleaned = dropZeroLayers(r2.layers, startMat);
      const Fc = evalF(cleaned);
      if (Fc < F * (1 - eps) && cleaned.length <= maxLayers) { layers = cleaned; F = Fc; keepBest(layers, F); }
      else { stats.rejected++; yield { type: 'needle-rejected', candidate: t.cand, why: `refined merit ${Fc.toExponential(3)} is not below parent ${F.toExponential(3)}`, layers: copy(layers), R: reflectance(layers, problem.wavelengths, ns, na), F }; break; }
    }
    if (reason) break;

    // ---------------- thin-layer cleanup ----------------
    if (layers.some((L) => L.d < dMin) && layers.length > 1) {
      yield { type: 'stage', stage: 'cleanup' };
      const { layers: cl, removed } = cleanThinLayers(layers, dMin);
      if (removed) {
        stats.cleanups += removed;
        const Rc = reflectance(cl, problem.wavelengths, ns, na);
        yield { type: 'cleanup', removed, layers: copy(cl), R: Rc, F: merit(Rc, problem.target, problem.weights), before: copy(layers) };
        const r3 = yield* doRefine(cl, 'Refinement after cleanup');
        layers = dropZeroLayers(r3.layers, startMat); F = r3.F; keepBest(layers, F);
      }
    }
    dc = denseCheck(layers);
    if (reached(F, dc)) { reason = 'Target merit reached'; break; }
    if (Date.now() - t0 > budgetMs) { reason = 'Time budget exhausted'; break; }

    // ---------------- gradual evolution: thickness growth ----------------
    const tot = totalOpticalThickness(layers);
    if (tot >= maxTOT - 1e-9) { reason = 'Optical‑thickness limit reached'; break; }
    yield { type: 'stage', stage: 'growth' };
    const growth = growthSearch(layers, problem, { lamMin, lamMax, maxTOT });
    if (!growth) { reason = 'No admissible thickness growth within the optical‑thickness limit'; break; }
    stats.growths++;
    const grown = copy(layers); grown[growth.layer].d += growth.s;
    yield { type: 'growth', layer: growth.layer, from: layers[growth.layer].d, to: grown[growth.layer].d, curve: growth.curve, layers: grown, R: reflectance(grown, problem.wavelengths, ns, na), F: growth.F, Fparent: F };
    const r4 = yield* doRefine(grown, 'Refinement after growth');
    layers = dropZeroLayers(r4.layers, startMat); F = r4.F; keepBest(layers, F);

    if (F < cycleStartF * (1 - 1e-4)) noProgress = 0; else if (++noProgress >= 3) { reason = 'No further progress'; }
  }
  if (!reason) reason = 'Cycle budget exhausted';

  // ---------------- final: cleanup + final refinement, report best ----------------
  yield { type: 'stage', stage: 'final' };
  if (best && best.F < F * (1 - 1e-12)) { layers = copy(best.layers); F = best.F; }
  if (layers.some((L) => L.d < dMin) && layers.length > 1) {
    const { layers: cl, removed } = cleanThinLayers(layers, dMin);
    if (removed) {
      stats.cleanups += removed;
      const Rc = reflectance(cl, problem.wavelengths, ns, na);
      yield { type: 'cleanup', removed, layers: copy(cl), R: Rc, F: merit(Rc, problem.target, problem.weights), before: copy(layers), final: true };
      const r5 = yield* doRefine(cl, 'Final refinement');
      layers = dropZeroLayers(r5.layers, startMat); F = r5.F;
    }
  } else {
    const r5 = yield* doRefine(layers, 'Final refinement');
    layers = dropZeroLayers(r5.layers, startMat); F = r5.F;
  }
  const Rf = reflectance(layers, problem.wavelengths, ns, na);
  const Ff = merit(Rf, problem.target, problem.weights);
  const dcf = denseCheck(layers);
  if (reason === 'Target merit reached' && !reached(Ff, dcf)) reason = dcf && Ff <= targetF ? 'Target merit reached on the optimization grid but not on the dense check grid' : reason;
  const done = {
    type: 'done', layers: copy(layers), R: Rf, F: Ff, reason, stats, opticalThickness: totalOpticalThickness(layers),
    grid: { wavelengths: Float64Array.from(problem.wavelengths), target: Float64Array.from(problem.target), weights: Float64Array.from(problem.weights) },
    dense: dcf ? { wavelengths: dense.wavelengths, target: dense.target, weights: dense.weights, R: dcf.R, F: dcf.F, maxDev: dcf.maxDev } : null,
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
  const { wavelengths, target, weights, ns, na } = problem;
  const evalF = (ls) => merit(reflectance(ls, wavelengths, ns, na), target, weights);
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
    results.push({ index: i, name: s.name, start: s.start, F: done.F, Fdense: done.dense ? done.dense.F : null, score, layers: done.layers, opticalThickness: done.opticalThickness, reason: done.reason, elapsedMs: done.elapsedMs });
    yield { type: 'explore-result', ...results[results.length - 1] };
  }
  const ranked = results.slice().sort((a, b) => a.score - b.score);
  yield { type: 'explore-done', results: ranked, best: ranked[0] };
}
