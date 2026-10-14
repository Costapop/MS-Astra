/**
 * Gradual‑evolution synthesis driver.
 *
 * One complete cycle (Furman & Tikhonravov §2.2.3; Tikhonravov, Optical
 * Coatings §1.2.2–1.2.4; doc §10, §12.4, Appendix A.3):
 *   1. refinement of all thicknesses (Levenberg–Marquardt, analytic Jacobian);
 *   2. needle cycle: compute the needle derivative g(z) analytically, insert a
 *      needle of the opposite material at its most negative admissible
 *      minimum with a width that actually decreases F, refine, accept if the
 *      refined design is better than the parent; repeat until no needle helps;
 *   3. thin‑layer cleanup followed by re‑refinement;
 *   4. gradual evolution: deliberately grow one layer to the nearest local
 *      minimum of F along its thickness (thorough search over all layers),
 *      then return to step 1.
 * Termination: target merit reached, layer limit, optical‑thickness limit, or
 * no progress. The best feasible design is always retained.
 *
 * Implemented as a generator so the interface can animate every stage and
 * pause between events; no computation happens between `next()` calls.
 */
import {
  evaluate, reflectance, merit, scanNeedles, insertNeedle, cleanThinLayers,
  mergeEqualNeighbours, totalOpticalThickness,
} from './optics.js';
import { refine } from './refine.js';

function copy(layers) { return layers.map((L) => ({ ...L, inserted: false })); }

function dropZeroLayers(layers, keepOneOf) {
  let out = mergeEqualNeighbours(layers.filter((L) => L.d > 1e-9));
  if (out.length === 0) out = [{ ...keepOneOf, d: 0 }];
  return out;
}

export function* synthesize(cfg) {
  const { wavelengths, target, weights, ns, na = 1, materials } = cfg;
  const problem = { wavelengths, target, weights, ns, na };
  const H = materials.H, Lm = materials.L;
  const other = (lay) => (lay.m === H.m ? Lm.n : H.n);
  const matByIndex = (n) => (n === H.n ? H : Lm);
  const maxLayers = cfg.maxLayers ?? 40;
  const maxTOT = cfg.maxOpticalThickness ?? 8000;
  const targetF = cfg.targetMerit ?? 1e-5;
  const dMin = cfg.thinLayer ?? 1;
  const kCand = cfg.candidates ?? 3;
  const eps = cfg.acceptRel ?? 1e-6;
  const maxCycles = cfg.maxCycles ?? 80;
  const lamMin = Math.min(...wavelengths), lamMax = Math.max(...wavelengths);
  const lamC = (lamMin + lamMax) / 2;
  const eta0 = cfg.needleWidth ?? Math.max(1, 10 * lamC / 550);  // book: ≈10 nm in the visible

  const startMat = cfg.start.material === H.m ? H : Lm;
  let layers = [{ n: startMat.n, m: startMat.m, d: Math.max(0, cfg.start.thickness) }];
  const evalF = (ls) => merit(reflectance(ls, wavelengths, ns, na), target, weights);
  const stats = { refinements: 0, needles: 0, rejected: 0, growths: 0, cleanups: 0, lmIterations: 0, cycles: 0 };
  let best = null;
  const keepBest = (ls, F) => {
    if (!best || (F < best.F && ls.length <= maxLayers && totalOpticalThickness(ls) <= maxTOT + 1e-9)) best = { layers: copy(ls), F };
  };

  function* doRefine(ls, label) {
    yield { type: 'stage', stage: 'refine', label };
    const it = refine(ls, problem, { maxIter: cfg.maxLmIterations ?? 300, relTol: cfg.lmRelTol ?? 1e-11, totMax: maxTOT });
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

  let R0 = reflectance(layers, wavelengths, ns, na);
  let F = merit(R0, target, weights);
  yield { type: 'start', layers: copy(layers), R: R0, F };
  let res = yield* doRefine(layers, 'Initial refinement');
  layers = dropZeroLayers(res.layers, startMat); F = res.F; keepBest(layers, F);

  let reason = null;
  let noProgress = 0;
  for (let cycle = 1; cycle <= maxCycles && !reason; cycle++) {
    stats.cycles = cycle;
    const cycleStartF = F;
    yield { type: 'cycle', cycle, layers: copy(layers), F };
    if (F <= targetF) { reason = 'Target merit reached'; break; }

    // ---------------- needle cycle ----------------
    for (let needleStep = 0; needleStep < 200; needleStep++) {
      if (F <= targetF) { reason = 'Target merit reached'; break; }
      yield { type: 'stage', stage: 'needle' };
      const ev = evaluate(layers, wavelengths, target, weights, ns, na, true);
      const scan = scanNeedles(layers, ev.adjoint, wavelengths, other);
      yield { type: 'scan', z: scan.z, g: scan.g, layer: scan.layer, total: scan.total, candidates: scan.candidates.slice(0, 8), layers: copy(layers), F };
      if (!scan.candidates.length) { yield { type: 'note', text: 'No negative needle derivative: the design is needle‑stationary.' }; break; }
      let accepted = false;
      let tried = 0;
      for (const cand of scan.candidates) {
        if (tried >= kCand) break;
        const added = cand.kind === 'interior' ? 2 : 1;
        if (layers.length + added > maxLayers) { continue; }
        tried++;
        const mat = matByIndex(cand.nm);
        // width search: start from eta0 (bounded by layer geometry), halve until F decreases (Armijo, c = 1e-4)
        const etaMax = cand.kind === 'interior' ? 2 * Math.min(cand.x, layers[cand.layer].d - cand.x) : eta0;
        let eta = Math.min(eta0, etaMax * 0.5), trial = null, Ft = Infinity, attempts = 0;
        while (eta >= 1e-3) {
          attempts++;
          trial = insertNeedle(layers, cand, eta, mat);
          Ft = evalF(trial);
          if (Ft <= F + 1e-4 * eta * cand.g && totalOpticalThickness(trial) <= maxTOT + 1e-9) break;
          eta *= 0.5; trial = null;
        }
        if (!trial) { stats.rejected++; yield { type: 'needle-rejected', candidate: cand, why: 'no admissible width' }; continue; }
        stats.needles++;
        yield { type: 'needle', candidate: cand, eta, material: mat.m, layers: copy(trial).map((L, i) => ({ ...L, inserted: trial[i].inserted })), R: reflectance(trial, wavelengths, ns, na), F: Ft, Fparent: F, attempts };
        const r2 = yield* doRefine(trial, 'Refinement after needle');
        const cleaned = dropZeroLayers(r2.layers, startMat);
        const Fc = evalF(cleaned);
        if (Fc < F * (1 - eps) && cleaned.length <= maxLayers) {
          layers = cleaned; F = Fc; keepBest(layers, F); accepted = true; break;
        }
        stats.rejected++;
        yield { type: 'needle-rejected', candidate: cand, why: `refined merit ${Fc.toExponential(3)} is not below parent ${F.toExponential(3)}`, layers: copy(layers), R: reflectance(layers, wavelengths, ns, na), F };
      }
      if (!accepted) {
        if (tried === 0 && layers.length + 1 > maxLayers) yield { type: 'note', text: 'Layer limit reached: no further needles can be inserted.' };
        break;
      }
    }
    if (reason) break;

    // ---------------- thin-layer cleanup ----------------
    if (layers.some((L) => L.d < dMin) && layers.length > 1) {
      yield { type: 'stage', stage: 'cleanup' };
      const { layers: cl, removed } = cleanThinLayers(layers, dMin);
      if (removed) {
        stats.cleanups += removed;
        const Rc = reflectance(cl, wavelengths, ns, na);
        yield { type: 'cleanup', removed, layers: copy(cl), R: Rc, F: merit(Rc, target, weights), before: copy(layers) };
        const r3 = yield* doRefine(cl, 'Refinement after cleanup');
        layers = dropZeroLayers(r3.layers, startMat); F = r3.F; keepBest(layers, F);
      }
    }
    if (F <= targetF) { reason = 'Target merit reached'; break; }

    // ---------------- gradual evolution: thickness growth ----------------
    const tot = totalOpticalThickness(layers);
    if (tot >= maxTOT - 1e-9) { reason = 'Optical‑thickness limit reached'; break; }
    yield { type: 'stage', stage: 'growth' };
    const growth = growthSearch(layers, problem, { lamMin, lamMax, maxTOT });
    if (!growth) { reason = 'No admissible thickness growth within the optical‑thickness limit'; break; }
    stats.growths++;
    const grown = copy(layers); grown[growth.layer].d += growth.s;
    yield { type: 'growth', layer: growth.layer, from: layers[growth.layer].d, to: grown[growth.layer].d, curve: growth.curve, layers: grown, R: reflectance(grown, wavelengths, ns, na), F: growth.F, Fparent: F };
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
      const Rc = reflectance(cl, wavelengths, ns, na);
      yield { type: 'cleanup', removed, layers: copy(cl), R: Rc, F: merit(Rc, target, weights), before: copy(layers), final: true };
      const r5 = yield* doRefine(cl, 'Final refinement');
      layers = dropZeroLayers(r5.layers, startMat); F = r5.F;
    }
  } else {
    const r5 = yield* doRefine(layers, 'Final refinement');
    layers = dropZeroLayers(r5.layers, startMat); F = r5.F;
  }
  const Rf = reflectance(layers, wavelengths, ns, na);
  const done = { type: 'done', layers: copy(layers), R: Rf, F: merit(Rf, target, weights), reason, stats, opticalThickness: totalOpticalThickness(layers) };
  yield done;
  return done;
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
    // nearest local minimum with s > 0 (after the merit has risen from the parent minimum)
    let found = -1;
    for (let i = 1; i < count - 1; i++) {
      if (curve[i] <= curve[i - 1] && curve[i] <= curve[i + 1]) {
        // require that the merit went up before coming down (otherwise it is the parent minimum itself)
        let rose = false;
        for (let q = 1; q <= i; q++) if (curve[q] > curve[0] * (1 + 1e-9) + 1e-18) { rose = true; break; }
        if (rose) { found = i; break; }
      }
    }
    if (found < 0) continue;
    // golden-section refinement
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
  // Fallback: no interior minimum — grow the layer giving the smallest merit at a half-wave step
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
