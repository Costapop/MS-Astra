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
