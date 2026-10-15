import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflectance, merit, meritWeights, evaluate, needleDerivative, scanNeedles, insertNeedle, cleanThinLayers, totalOpticalThickness } from '../src/optics.js';
import { refineToEnd } from '../src/refine.js';

const H = (d, n = 2.30) => ({ n, m: 'H', d });
const L = (d, n = 1.38) => ({ n, m: 'L', d });
const grid = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

/* Independent reference: 2×2 characteristic matrices (Furman–Tikhonravov §1.2, eq. 1.2.9–1.2.14). */
function referenceR(layers, lambda, ns, na = 1) {
  // M = M_N ... M_1, M_j = [[cos φ, i sin φ / n], [i n sin φ, cos φ]], field normalised (1, ns) at the substrate
  let m11 = 1, m12 = 0, m21 = 0, m22 = 1; // complex entries stored as [re, im] pairs
  let M = [[1, 0], [0, 0], [0, 0], [1, 0]];
  const mul = (A, B) => { // A·B for 2×2 complex matrices stored [a11,a12,a21,a22] of [re,im]
    const cm = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
    const ad = (x, y) => [x[0] + y[0], x[1] + y[1]];
    return [ad(cm(A[0], B[0]), cm(A[1], B[2])), ad(cm(A[0], B[1]), cm(A[1], B[3])), ad(cm(A[2], B[0]), cm(A[3], B[2])), ad(cm(A[2], B[1]), cm(A[3], B[3]))];
  };
  for (const Lr of layers) {
    const phi = 2 * Math.PI / lambda * Lr.n * Lr.d;
    const Mj = [[Math.cos(phi), 0], [0, Math.sin(phi) / Lr.n], [0, Lr.n * Math.sin(phi)], [Math.cos(phi), 0]];
    M = mul(Mj, M);
  }
  const U = [M[0][0] + ns * M[1][0], M[0][1] + ns * M[1][1]];
  const V = [M[2][0] + ns * M[3][0], M[2][1] + ns * M[3][1]];
  const num = [na * U[0] - V[0], na * U[1] - V[1]], den = [na * U[0] + V[0], na * U[1] + V[1]];
  return (num[0] ** 2 + num[1] ** 2) / (den[0] ** 2 + den[1] ** 2);
}

test('bare substrate and single quarter-wave layer match Fresnel closed forms', () => {
  assert.ok(Math.abs(reflectance([], [500], 1.52)[0] - ((1 - 1.52) / (1 + 1.52)) ** 2) < 1e-15);
  const Y = 1.38 * 1.38 / 1.52;
  assert.ok(Math.abs(reflectance([L(550 / 4 / 1.38)], [550], 1.52)[0] - ((1 - Y) / (1 + Y)) ** 2) < 1e-15);
});

test('quarter-wave stack (HL)^5 H matches the analytic peak reflectance', () => {
  const nH = 2.35, nL = 1.38, ns = 1.52, l0 = 550;
  const st = []; for (let i = 0; i < 11; i++) { const n = i % 2 === 0 ? nH : nL; st.push({ n, m: i % 2 ? 'L' : 'H', d: l0 / (4 * n) }); }
  const Y = Math.pow(nH / nL, 10) * nH * nH / ns;
  assert.ok(Math.abs(reflectance(st, [l0], ns)[0] - ((1 - Y) / (1 + Y)) ** 2) < 1e-14);
});

test('admittance recursion agrees with independent characteristic-matrix reference on random stacks', () => {
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 30; t++) {
    const N = 1 + Math.floor(rnd() * 25);
    const layers = Array.from({ length: N }, (_, i) => (i % 2 ? L(rnd() * 300) : H(rnd() * 300)));
    const wl = grid(380, 900, 23);
    const R = reflectance(layers, wl, 1.52);
    for (let i = 0; i < wl.length; i++) {
      const ref = referenceR(layers, wl[i], 1.52);
      assert.ok(Math.abs(R[i] - ref) < 1e-12, `N=${N} λ=${wl[i]}: ${R[i]} vs ${ref}`);
      assert.ok(R[i] >= 0 && R[i] <= 1 + 1e-12);
    }
  }
});

test('analytic thickness derivatives match central finite differences', () => {
  const layers = [H(74), L(103), H(131), L(88), H(40), L(210)];
  const wl = grid(420, 800, 39); const target = new Float64Array(39).fill(0.2); const w = meritWeights(39);
  const ev = evaluate(layers, wl, target, w, 1.52);
  for (let j = 0; j < layers.length; j++) {
    const h = 1e-4;
    const lp = layers.map((x, i) => ({ ...x, d: x.d + (i === j ? h : 0) })), lm = layers.map((x, i) => ({ ...x, d: x.d - (i === j ? h : 0) }));
    const fd = (merit(reflectance(lp, wl, 1.52), target, w) - merit(reflectance(lm, wl, 1.52), target, w)) / (2 * h);
    assert.ok(Math.abs(ev.grad[j] - fd) < 1e-8 * Math.max(1, Math.abs(fd)) + 1e-12, `layer ${j}: ${ev.grad[j]} vs ${fd}`);
    // Jacobian rows
    const Rp = reflectance(lp, wl, 1.52), Rm = reflectance(lm, wl, 1.52);
    for (let l = 0; l < wl.length; l += 7) {
      const fdR = (Rp[l] - Rm[l]) / (2 * h);
      assert.ok(Math.abs(ev.J[l * layers.length + j] - fdR) < 1e-7, `J[${l},${j}]`);
    }
  }
});

test('needle derivative matches the finite-width merit change as η → 0', () => {
  const layers = [H(95.3778), L(65.2239), H(145.7781), L(105.6838)];
  const wl = grid(420, 800, 77); const target = new Float64Array(77).fill(0.2); const w = meritWeights(77);
  const ev = evaluate(layers, wl, target, w, 1.52, 1, true);
  const F0 = ev.F;
  for (const [j, x] of [[2, 117.2178], [1, 31.9213], [0, 70.9073]]) {
    const nm = layers[j].m === 'H' ? 1.38 : 2.30;
    const g = needleDerivative(layers, ev.adjoint, j, x, nm);
    const cand = { layer: j, x, z: 0, kind: 'interior' };
    const eta = 1e-3;
    const Fi = merit(reflectance(insertNeedle(layers, cand, eta, { n: nm, m: nm > 2 ? 'H' : 'L' }), wl, 1.52), target, w);
    assert.ok(Math.abs((Fi - F0) / eta - g) < 2e-3 * Math.abs(g), `layer ${j}: ${(Fi - F0) / eta} vs ${g}`);
  }
});

test('reproduces the reference example of the method document (§13): refinement, needle, 6-layer result', () => {
  const wl = grid(420, 800, 77); const target = new Float64Array(77).fill(0.2); const w = meritWeights(77);
  const problem = { wavelengths: wl, target, weights: w, ns: 1.52, na: 1 };
  const r4 = refineToEnd([H(74), L(103), H(131), L(88)], problem, { maxIter: 2000, relTol: 1e-13 });
  const expected4 = [95.3778, 65.2239, 145.7781, 105.6838];
  r4.layers.forEach((Lr, i) => assert.ok(Math.abs(Lr.d - expected4[i]) < 5e-4, `d${i + 1}=${Lr.d}`));
  assert.ok(Math.abs(r4.F - 2.25678035e-4) < 1e-11, `F4=${r4.F}`);
  const ev = evaluate(r4.layers, wl, target, w, 1.52, 1, true);
  const scan = scanNeedles(r4.layers, ev.adjoint, wl, (Lr) => (Lr.m === 'H' ? 1.38 : 2.30));
  const best = scan.candidates[0];
  assert.equal(best.layer, 2);
  assert.ok(Math.abs(best.x - 117.2178) < 1e-3, `x*=${best.x}`);
  assert.ok(Math.abs(best.g - (-3.913998e-5)) < 1e-9, `g=${best.g}`);
  // the five negative minima of the document, in order of g
  const docTable = [[2, 117.2178, -3.913998], [1, 31.9213, -3.111482], [0, 70.9073, -2.887414], [3, 29.1519, -2.803771], [2, 21.0806, -2.049632]];
  docTable.forEach(([j, x, g5], i) => {
    const c = scan.candidates[i];
    assert.equal(c.layer, j); assert.ok(Math.abs(c.x - x) < 1e-3); assert.ok(Math.abs(c.g * 1e5 - g5) < 2e-5);
  });
  const ins = insertNeedle(r4.layers, best, 0.1, { n: 1.38, m: 'L' });
  const r6 = refineToEnd(ins, problem, { maxIter: 4000, relTol: 1e-13 });
  assert.equal(r6.layers.length, 6);
  assert.ok(Math.abs(r6.F - 1.75996773e-4) < 2e-11, `F6=${r6.F}`);
  const expected6 = [94.2993, 61.6430, 116.6421, 2.6146, 28.3315, 107.3616];
  r6.layers.forEach((Lr, i) => assert.ok(Math.abs(Lr.d - expected6[i]) < 2e-3, `d${i + 1}=${Lr.d}`));
  // alternative candidate (row 2 of the document table) reaches the deeper 6-layer minimum
  const r6b = refineToEnd(insertNeedle(r4.layers, scan.candidates[1], 0.1, { n: 2.30, m: 'H' }), problem, { maxIter: 4000, relTol: 1e-13 });
  assert.ok(Math.abs(r6b.F - 4.174423e-5) < 2e-11, `F6b=${r6b.F}`);
});

test('Furman–Tikhonravov antireflection examples (Fig. 2.2, Fig. 2.5) are reproduced as low-reflectance designs', () => {
  const d8 = [14.1, 26.4, 8.1, 6.7, 104.1, 9.7, 16.9, 95.3];
  const l8 = d8.map((d, i) => (i % 2 === 0 ? H(d) : L(d)));
  const wl = grid(420, 680, 27);
  const R = reflectance(l8, wl, 1.52);
  assert.ok(Math.max(...R) < 0.004, 'Fig. 2.5 design: R < 0.4 % over 420–680 nm');
  const q = [0.318, 0.34, 1.977, 0.106, 0.375, 1.099];
  const l6 = q.map((qq, i) => { const n = i % 2 === 0 ? 2.30 : 1.45; return { n, m: i % 2 ? 'L' : 'H', d: qq * 500 / (4 * n) }; });
  const R6 = reflectance(l6, grid(420, 860, 23), 1.52);
  assert.ok(Math.max(...R6) < 0.012, 'Fig. 2.2 design (1): R ≲ 1 % over the band');
});

test('insertNeedle preserves total thickness; cleanThinLayers keeps optical thickness and merges neighbours', () => {
  const layers = [H(100), L(80), H(60)];
  const ins = insertNeedle(layers, { layer: 1, x: 30, kind: 'interior' }, 4, { n: 2.30, m: 'H' });
  assert.equal(ins.length, 5);
  assert.ok(Math.abs(ins.reduce((s, x) => s + x.d, 0) - 240) < 1e-12);
  assert.equal(ins[2].inserted, true); assert.equal(ins[2].d, 4);
  const thin = [H(100), L(0.5), H(60), L(0.2)];
  const { layers: cl, removed } = cleanThinLayers(thin, 1);
  assert.equal(removed, 2); assert.equal(cl.length, 1); assert.equal(cl[0].m, 'H');
  assert.ok(Math.abs(cl[0].d - (160 + 0.5 * 1.38 / 2.30)) < 1e-12);
  assert.ok(Math.abs(totalOpticalThickness(cl) - totalOpticalThickness([H(100), L(0.5), H(60)])) < 1e-12);
});

/* ---------------- v2.3: oblique incidence, s/p polarizations, incident medium ---------------- */
import { spectra, assess, meritOf, opticsModel, polParams } from '../src/optics.js';

// complex helpers for the independent reference
const C = {
  mul: (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]],
  add: (x, y) => [x[0] + y[0], x[1] + y[1]],
  sub: (x, y) => [x[0] - y[0], x[1] - y[1]],
  div: (x, y) => { const d = y[0] * y[0] + y[1] * y[1]; return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]; },
  abs2: (x) => x[0] * x[0] + x[1] * x[1],
  cos: (z) => [Math.cos(z[0]) * Math.cosh(z[1]), -Math.sin(z[0]) * Math.sinh(z[1])],
  sin: (z) => [Math.sin(z[0]) * Math.cosh(z[1]), Math.cos(z[0]) * Math.sinh(z[1])],
  sqrtBranch: (x) => (x >= 0 ? [Math.sqrt(x), 0] : [0, -Math.sqrt(-x)]),   // Re ≥ 0, Im ≤ 0 (decaying transmitted wave)
};
/**
 * Independent reference: Abelès characteristic matrices at oblique incidence
 * (Furman–Tikhonravov §1.2.1, Table 1.1): φ_j = k n_j cos γ_j d_j,
 * q_j = n_j cos γ_j (s) or n_j / cos γ_j (p), r and t from eq. (1.2.13–1.2.14),
 * R = |r|², T = Re(q_s)/q_a |t|² (eq. 1.1.23). Complex arithmetic throughout.
 */
function referenceRT(layers, lambda, { ns, na, angle }, pol) {
  const th = angle * Math.PI / 180, alpha = na * Math.sin(th);
  const q = (n) => { const b = C.sqrtBranch(n * n - alpha * alpha); return pol === 's' ? b : C.div([n * n, 0], b); };
  const beta = (n) => C.sqrtBranch(n * n - alpha * alpha);
  let M = [[1, 0], [0, 0], [0, 0], [1, 0]];
  const mul = (A, B) => [C.add(C.mul(A[0], B[0]), C.mul(A[1], B[2])), C.add(C.mul(A[0], B[1]), C.mul(A[1], B[3])), C.add(C.mul(A[2], B[0]), C.mul(A[3], B[2])), C.add(C.mul(A[2], B[1]), C.mul(A[3], B[3]))];
  const k = 2 * Math.PI / lambda;
  for (const Lr of layers) {
    const b = beta(Lr.n), qj = q(Lr.n);
    const phi = [k * b[0] * Lr.d, k * b[1] * Lr.d];
    const c = C.cos(phi), s = C.sin(phi);
    const Mj = [c, C.div(C.mul([0, 1], s), qj), C.mul([0, 1], C.mul(qj, s)), c];
    M = mul(Mj, M);
  }
  const qs = q(ns), qa = pol === 's' ? [na * Math.cos(th), 0] : [na / Math.cos(th), 0];
  const U = C.add(M[0], C.mul(qs, M[1])), V = C.add(M[2], C.mul(qs, M[3]));
  const den = C.add(C.mul(qa, U), V);
  const r = C.div(C.sub(C.mul(qa, U), V), den), t = C.div([2 * qa[0], 0], den);
  return { R: C.abs2(r), T: qs[0] / qa[0] * C.abs2(t) };
}

test('oblique incidence: bare substrate reproduces the Fresnel formulas and the Brewster angle', () => {
  const ns = 1.52;
  for (const [na, th] of [[1, 30], [1, 60], [1, 85], [1.52, 20], [1.52, 45]]) {
    const g = th * Math.PI / 180, cs = Math.sqrt(1 - (na * Math.sin(g) / ns) ** 2);
    const rs = (na * Math.cos(g) - ns * cs) / (na * Math.cos(g) + ns * cs);
    const rp = (na * cs - ns * Math.cos(g)) / (na * cs + ns * Math.cos(g));
    const sp = spectra([], [550], opticsModel({ ns, na, angle: th, pol: 'avg' }));
    assert.ok(Math.abs(sp.Rs[0] - rs * rs) < 1e-15 && Math.abs(sp.Rp[0] - rp * rp) < 1e-15, `θ=${th} from ${na}`);
    assert.ok(Math.abs(sp.R[0] - 0.5 * (rs * rs + rp * rp)) < 1e-15);
  }
  const brewster = Math.atan(ns) * 180 / Math.PI;
  const sp = spectra([], [550], opticsModel({ ns, na: 1, angle: brewster, pol: 'p' }));
  assert.ok(sp.Rp[0] < 1e-28 && sp.Rs[0] > 0.1, `Brewster: Rp=${sp.Rp[0]}`);
  // at normal incidence s and p coincide with the book formula and with the legacy call
  const m0 = spectra([L(99.6), H(56)], [500, 600], opticsModel({ ns, na: 1, angle: 0, pol: 'both' }));
  const legacy = reflectance([L(99.6), H(56)], [500, 600], ns);
  for (let i = 0; i < 2; i++) assert.ok(m0.Rs[i] === m0.Rp[i] && m0.R[i] === legacy[i]);
});

test('oblique incidence: admittance recursion with polarization admittances agrees with the Abelès reference (air and BK7 incidence, evanescent layers) and conserves energy', () => {
  let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const cases = [{ na: 1, angle: 15 }, { na: 1, angle: 45 }, { na: 1, angle: 75 }, { na: 1, angle: 89.9 }, { na: 1.52, angle: 30 }, { na: 1.52, angle: 70 }, { na: 1.52, angle: 89 }];
  let evanescent = 0;
  for (const cs of cases) for (let t = 0; t < 6; t++) {
    const N = 1 + Math.floor(rnd() * 14);
    const layers = Array.from({ length: N }, (_, i) => (i % 2 ? L(5 + rnd() * 250) : H(5 + rnd() * 250)));
    const wl = grid(400, 900, 11);
    const model = opticsModel({ ns: 1.52, na: cs.na, angle: cs.angle, pol: 'avg' });
    if (model.alpha > 1.38) evanescent++;
    const sp = spectra(layers, wl, model);
    for (let i = 0; i < wl.length; i++) {
      const s = referenceRT(layers, wl[i], { ns: 1.52, ...cs }, 's'), p = referenceRT(layers, wl[i], { ns: 1.52, ...cs }, 'p');
      assert.ok(Math.abs(sp.Rs[i] - s.R) < 1e-11, `s: N=${N} ${JSON.stringify(cs)} λ=${wl[i]}: ${sp.Rs[i]} vs ${s.R}`);
      assert.ok(Math.abs(sp.Rp[i] - p.R) < 1e-11, `p: N=${N} ${JSON.stringify(cs)} λ=${wl[i]}: ${sp.Rp[i]} vs ${p.R}`);
      assert.ok(Math.abs(s.R + s.T - 1) < 1e-10 && Math.abs(p.R + p.T - 1) < 1e-10, 'lossless: R + T = 1');
      assert.ok(sp.Rs[i] >= 0 && sp.Rs[i] <= 1 + 1e-12 && sp.Rp[i] >= 0 && sp.Rp[i] <= 1 + 1e-12);
    }
  }
  assert.ok(evanescent >= 12, 'cases with evanescent low-index layers were exercised');
  // total internal reflection at the substrate: R ≡ 1 for any lossless stack
  const tir = opticsModel({ ns: 1.0, na: 1.52, angle: 60, pol: 'both' });
  assert.ok(tir.substrateTIR);
  const sp = spectra([H(80), L(120), H(30)], [500, 700], tir);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(sp.Rs[i] - 1) < 1e-12 && Math.abs(sp.Rp[i] - 1) < 1e-12);
});

test('oblique incidence: gradient, Jacobian and residual rows match finite differences for Rs, Rp, the unpolarized mean and both polarizations', () => {
  const layers = [H(74), L(103), H(131), L(88), H(40), L(210)];
  const wl = grid(420, 800, 25); const target = new Float64Array(25).fill(0.3); const w = meritWeights(25);
  for (const spec of [{ na: 1, angle: 45, pol: 's' }, { na: 1, angle: 45, pol: 'p' }, { na: 1, angle: 60, pol: 'avg' }, { na: 1, angle: 30, pol: 'both' }, { na: 1.52, angle: 70, pol: 'avg' }, { na: 1.52, angle: 72, pol: 'both' }]) {
    const model = opticsModel({ ns: 1.52, ...spec });
    const ev = evaluate(layers, wl, target, w, model);
    // F from the evaluation equals the independent assessment and Σ resid²
    const a = assess(layers, wl, target, w, model);
    assert.ok(Math.abs(ev.F - a.F) < 1e-15 && Math.abs(meritOf(layers, wl, target, w, model) - a.F) < 1e-15, `${JSON.stringify(spec)}: F`);
    let sum = 0; for (let i = 0; i < ev.rows; i++) sum += ev.resid[i] * ev.resid[i];
    assert.ok(Math.abs(sum - ev.F) < 1e-15, 'F = Σ resid²');
    assert.equal(ev.rows, spec.pol === 'both' ? 2 * wl.length : wl.length);
    if (spec.pol === 'both') {
      let Fb = 0; for (let l = 0; l < wl.length; l++) Fb += 0.5 * w[l] * ((a.Rs[l] - target[l]) ** 2 + (a.Rp[l] - target[l]) ** 2);
      assert.ok(Math.abs(Fb - ev.F) < 1e-15, 'both: F = ½ Σ ν [(Rs − R̃)² + (Rp − R̃)²]');
    }
    for (let j = 0; j < layers.length; j++) {
      const h = 1e-4;
      const lp = layers.map((x, i) => ({ ...x, d: x.d + (i === j ? h : 0) })), lm = layers.map((x, i) => ({ ...x, d: x.d - (i === j ? h : 0) }));
      const fd = (meritOf(lp, wl, target, w, model) - meritOf(lm, wl, target, w, model)) / (2 * h);
      assert.ok(Math.abs(ev.grad[j] - fd) < 1e-7 * Math.max(1, Math.abs(fd)) + 1e-11, `${JSON.stringify(spec)} layer ${j}: ${ev.grad[j]} vs ${fd}`);
      // gradient from the weighted rows: 2 Jwᵀ resid
      let g2 = 0; for (let i = 0; i < ev.rows; i++) g2 += 2 * ev.Jw[i * layers.length + j] * ev.resid[i];
      assert.ok(Math.abs(g2 - ev.grad[j]) < 1e-12 * Math.max(1, Math.abs(ev.grad[j])), 'grad = 2 Jwᵀ e');
      // Jacobian of the displayed characteristic (mean for both)
      const Rp_ = spectra(lp, wl, model).R, Rm_ = spectra(lm, wl, model).R;
      for (let l = 0; l < wl.length; l += 6) {
        const fdR = (Rp_[l] - Rm_[l]) / (2 * h);
        assert.ok(Math.abs(ev.J[l * layers.length + j] - fdR) < 1e-6, `J[${l},${j}] ${ev.J[l * layers.length + j]} vs ${fdR}`);
      }
    }
  }
});

test('oblique incidence: needle derivative for s, p, mean and both matches the finite-width merit change (including an evanescent host)', () => {
  const wl = grid(420, 800, 31); const target = new Float64Array(31).fill(0.2); const w = meritWeights(31);
  const layers = [H(95.3778), L(65.2239), H(145.7781), L(105.6838)];
  for (const spec of [{ na: 1, angle: 45, pol: 's' }, { na: 1, angle: 45, pol: 'p' }, { na: 1, angle: 55, pol: 'avg' }, { na: 1, angle: 35, pol: 'both' }, { na: 1.52, angle: 70, pol: 'avg' }, { na: 1.52, angle: 70, pol: 'p' }]) {
    const model = opticsModel({ ns: 1.52, ...spec });
    const ev = evaluate(layers, wl, target, w, model, true);
    const F0 = ev.F;
    let checked = 0;
    for (const [j, x] of [[2, 117.2], [1, 31.9], [0, 70.9], [3, 29.2]]) {
      const nm = layers[j].m === 'H' ? 1.38 : 2.30;
      const g = needleDerivative(layers, ev.adjoint, j, x, nm);
      const eta = 5e-4;
      const Fi = meritOf(insertNeedle(layers, { layer: j, x, z: 0, kind: 'interior' }, eta, { n: nm, m: nm > 2 ? 'H' : 'L' }), wl, target, w, model);
      const fd = (Fi - F0) / eta;
      if (Math.abs(g) < 1e-9) continue;
      assert.ok(Math.abs(fd - g) < 3e-3 * Math.abs(g), `${JSON.stringify(spec)} layer ${j}: ${fd} vs ${g}`);
      checked++;
    }
    assert.ok(checked >= 3, 'enough non-trivial points');
    // the p-polarization derivative depends on A(z): it is not P(z)·(n_m² − n_h²) at oblique incidence
    if (spec.pol === 'p' && spec.na === 1.52) {
      const ps = polParams(1.38, model, 'p'), ph = polParams(2.30, model, 'p');
      assert.ok(ps.kind === 1 && ph.kind === 0, 'MgF₂ is evanescent, the host is propagating');
      assert.ok(ps.a !== ph.a, 'Δa ≠ 0 for p');
    }
  }
});

test('oblique incidence: scanNeedles and the refinement work on the generalized derivatives (45°, unpolarized, from BK7 at 70°)', () => {
  const wl = grid(450, 650, 21); const target = new Float64Array(21).fill(0.5); const w = meritWeights(21);
  for (const spec of [{ na: 1, angle: 45, pol: 'avg' }, { na: 1.52, angle: 45, pol: 'both' }, { na: 1.52, angle: 70, pol: 'avg' }]) {
    const model = opticsModel({ ns: 1.52, ...spec });
    const problem = { wavelengths: wl, target, weights: w, model };
    const start = [{ n: 2.10, m: 'H', d: 120 }, { n: 1.46, m: 'L', d: 90 }, { n: 2.10, m: 'H', d: 60 }];
    const r = refineToEnd(start, problem, { maxIter: 500 });
    assert.ok(r.F < meritOf(start, wl, target, w, model), 'refinement lowers F');
    assert.ok(Math.abs(r.F - meritOf(r.layers, wl, target, w, model)) < 1e-15);
    const ev = evaluate(r.layers, wl, target, w, model, true);
    assert.ok(Math.abs(ev.F - r.F) < 1e-15);
    const scan = scanNeedles(r.layers, ev.adjoint, wl, (Lr) => (Lr.m === 'H' ? 1.46 : 2.10));
    assert.ok(scan.z.length >= 80 && scan.g.length === scan.z.length);
    for (const c of scan.candidates) {
      assert.ok(c.g < 0);
      if (c.kind !== 'interior') continue;
      const mat = c.nm > 2 ? { n: 2.10, m: 'H' } : { n: 1.46, m: 'L' };
      const Fi = meritOf(insertNeedle(r.layers, c, 1e-3, mat), wl, target, w, model);
      assert.ok(Fi < r.F, `a negative needle derivative lowers F for a thin needle (${JSON.stringify(spec)})`);
    }
  }
});

test('Rs & Rp with separate targets: merit, residual rows, gradient and needle derivative use each polarization\'s own target and weights', () => {
  const layers = [H(74), L(103), H(131), L(88), H(40), L(210)];
  const wl = grid(450, 650, 21);
  const tS = new Float64Array(21).fill(0.95), tP = new Float64Array(21).fill(0.02);
  const wS = meritWeights(21), wP = new Float64Array(21);
  for (let l = 0; l < 21; l++) wP[l] = (l % 3 === 0 ? 0 : 1); let sum = 0; for (const x of wP) sum += x; for (let l = 0; l < 21; l++) wP[l] /= sum;   // zero-weight points only in the Rp target
  const target = { s: tS, p: tP }, weights = { s: wS, p: wP };
  const model = opticsModel({ ns: 1.52, na: 1.52, angle: 45, pol: 'both' });
  const ev = evaluate(layers, wl, target, weights, model, true);
  const sp = spectra(layers, wl, model);
  let Fb = 0; for (let l = 0; l < 21; l++) Fb += 0.5 * (wS[l] * (sp.Rs[l] - tS[l]) ** 2 + wP[l] * (sp.Rp[l] - tP[l]) ** 2);
  assert.ok(Math.abs(ev.F - Fb) < 1e-15 && Math.abs(assess(layers, wl, target, weights, model).F - Fb) < 1e-15 && Math.abs(meritOf(layers, wl, target, weights, model) - Fb) < 1e-15);
  let s2 = 0; for (let i = 0; i < ev.rows; i++) s2 += ev.resid[i] ** 2;
  assert.ok(ev.rows === 42 && Math.abs(s2 - ev.F) < 1e-15);
  for (let j = 0; j < layers.length; j++) {
    const h = 1e-4;
    const lp = layers.map((x, i) => ({ ...x, d: x.d + (i === j ? h : 0) })), lm = layers.map((x, i) => ({ ...x, d: x.d - (i === j ? h : 0) }));
    const fd = (meritOf(lp, wl, target, weights, model) - meritOf(lm, wl, target, weights, model)) / (2 * h);
    assert.ok(Math.abs(ev.grad[j] - fd) < 1e-7 * Math.max(1, Math.abs(fd)) + 1e-11, `layer ${j}: ${ev.grad[j]} vs ${fd}`);
  }
  const F0 = ev.F; let checked = 0;
  for (const [j, x] of [[2, 60], [1, 50], [3, 44], [5, 120]]) {
    const nm = layers[j].m === 'H' ? 1.38 : 2.30;
    const g = needleDerivative(layers, ev.adjoint, j, x, nm);
    const eta = 5e-4;
    const fd = (meritOf(insertNeedle(layers, { layer: j, x, z: 0, kind: 'interior' }, eta, { n: nm, m: nm > 2 ? 'H' : 'L' }), wl, target, weights, model) - F0) / eta;
    if (Math.abs(g) < 1e-9) continue;
    assert.ok(Math.abs(fd - g) < 3e-3 * Math.abs(g), `needle layer ${j}: ${fd} vs ${g}`); checked++;
  }
  assert.ok(checked >= 3);
  // a shared array is the same target for both polarizations; the maximum deviation respects the per-polarization weights
  const shared = assess(layers, wl, tS, wS, model), dualA = assess(layers, wl, { s: tS, p: tS }, { s: wS, p: wS }, model);
  assert.ok(Math.abs(shared.F - dualA.F) < 1e-15 && Math.abs(shared.maxDev - dualA.maxDev) < 1e-15);
  const a = assess(layers, wl, target, weights, model);
  let md = 0; for (let l = 0; l < 21; l++) { md = Math.max(md, Math.abs(sp.Rs[l] - tS[l])); if (wP[l] > 0) md = Math.max(md, Math.abs(sp.Rp[l] - tP[l])); }
  assert.ok(Math.abs(a.maxDev - md) < 1e-15);
});
