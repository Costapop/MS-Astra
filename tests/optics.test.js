import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, merit, opticalThickness, geometricThickness, needleDerivative, scanNeedles, insertNeedle, normalizeLayers } from '../src/optics.js';
import { refine, growthCandidates, synthesize, feasibleNeedle, solveThicknessSubproblem, verifySpectrum } from '../src/optimizer.js';
import { PRESETS, targetAt, grid } from '../src/config.js';

const close = (actual, expected, tolerance = 1e-9, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (tolerance ${tolerance})`);
const makeLayer = (material, n, d, id = material) => ({ id, material, n, d });
const wavelengths = Array.from({ length: 41 }, (_, i) => 420 + i * 9.5);
const problem = overrides => ({ nL: 1.38, nH: 2.3, ns: 1.52, wavelengths,
  target: wavelengths.map(() => 0.2), maxLayers: 20, maxOpticalThickness: 5000,
  targetMerit: 1e-6, startMaterial: 'H', startThickness: 60, maxCycles: 3, ...overrides });

// Independent Fresnel scattering recursion, not a characteristic-matrix identity.
function scatteringR(layers, wavelength, ns) {
  let ar = 0;
  let ai = 0;
  for (let j = layers.length; j >= 0; j--) {
    const left = j === 0 ? 1 : layers[j - 1].n;
    const right = j === layers.length ? ns : layers[j].n;
    const interfaceR = (left - right) / (left + right);
    const phase = j === layers.length ? 0 : -4 * Math.PI * right * layers[j].d / wavelength;
    const br = ar * Math.cos(phase) - ai * Math.sin(phase);
    const bi = ar * Math.sin(phase) + ai * Math.cos(phase);
    const nr = interfaceR + br;
    const dr = 1 + interfaceR * br;
    const di = interfaceR * bi;
    const denom = dr * dr + di * di;
    ar = (nr * dr + bi * di) / denom;
    ai = (bi * dr - nr * di) / denom;
  }
  return ar * ar + ai * ai;
}

test('bare substrate, zero layer and energy conservation', () => {
  const expected = ((1 - 1.52) / (1 + 1.52)) ** 2;
  const bare = evaluate([], wavelengths, 1.52);
  const zero = evaluate([makeLayer('H', 2.3, 0)], wavelengths, 1.52);
  wavelengths.forEach((_, i) => {
    close(bare.R[i], expected, 1e-15);
    close(zero.R[i], expected, 1e-15);
    close(bare.R[i] + bare.T[i], 1, 1e-15);
  });
  const layers = Array.from({ length: 18 }, (_, j) => makeLayer(j % 2 ? 'L' : 'H', j % 2 ? 1.38 : 2.3, 21 + (j * 71 % 160), String(j)));
  const state = evaluate(layers, wavelengths, 1.52);
  wavelengths.forEach((lambda, i) => {
    close(state.R[i] + state.T[i], 1, 2e-12);
    assert.ok(state.R[i] >= 0 && state.R[i] <= 1 + 1e-13);
    close(state.R[i], scatteringR(layers, lambda, 1.52), 2e-12, 'independent recursion');
  });
});

test('quarter-wave antireflection and exact layer splitting/merging', () => {
  const n = Math.sqrt(1.52);
  close(evaluate([makeLayer('L', n, 550 / (4 * n))], [550], 1.52).R[0], 0, 1e-28);
  const one = [makeLayer('H', 2.3, 173)];
  const split = [makeLayer('H', 2.3, 35, 'a'), makeLayer('H', 2.3, 138, 'b')];
  const A = evaluate(one, wavelengths, 1.52);
  const B = evaluate(split, wavelengths, 1.52);
  A.R.forEach((R, i) => close(R, B.R[i], 2e-15));
  assert.deepEqual(normalizeLayers(split), [makeLayer('H', 2.3, 173, 'a')]);
});

test('all analytic thickness derivatives agree with central differences', () => {
  const layers = [makeLayer('H', 2.3, 91), makeLayer('L', 1.38, 64), makeLayer('H', 2.3, 142), makeLayer('L', 1.38, 103)];
  const analytic = evaluate(layers, wavelengths, 1.52);
  const h = 1e-4;
  for (let j = 0; j < layers.length; j++) {
    const plus = layers.map((layer, i) => ({ ...layer, d: layer.d + (j === i ? h : 0) }));
    const minus = layers.map((layer, i) => ({ ...layer, d: layer.d - (j === i ? h : 0) }));
    const Rp = evaluate(plus, wavelengths, 1.52).R;
    const Rm = evaluate(minus, wavelengths, 1.52).R;
    wavelengths.forEach((_, q) => close(analytic.jacobian[q][j], (Rp[q] - Rm[q]) / (2 * h), 7e-11, `q=${q},j=${j}`));
  }
});

test('analytic replacement needle derivative matches finite insertion at interior and both endpoints', () => {
  const layers = [makeLayer('L', 1.38, 105), makeLayer('H', 2.3, 146), makeLayer('L', 1.38, 65)];
  const config = problem();
  const parent = merit(evaluate(layers, wavelengths, 1.52).R, config.target);
  for (const position of [0, 27.1, 90, 146]) {
    const candidate = { layerIndex: 1, position, material: 'L', n: 1.38 };
    const h = 1e-4;
    const at = width => merit(evaluate(insertNeedle(layers, candidate, width), wavelengths, 1.52).R, config.target);
    const numerical = (-3 * parent + 4 * at(h) - at(2 * h)) / (2 * h);
    const analytic = needleDerivative(layers, wavelengths, config.target, 1.52, 1, position, 1.38);
    close(analytic, numerical, 8e-10, `position ${position}`);
    close(geometricThickness(insertNeedle(layers, candidate, 1)), geometricThickness(layers), 1e-12);
  }
  close(needleDerivative(layers, wavelengths, config.target, 1.52, 1, 34, 2.3), 0, 0);
});

test('supplied algorithm reference reproduces merit, best needle and finite replacement', () => {
  const wave = Array.from({ length: 77 }, (_, i) => 420 + 5 * i);
  const target = wave.map(() => 0.2);
  const layers = [makeLayer('L', 1.38, 105.6838), makeLayer('H', 2.3, 145.7781), makeLayer('L', 1.38, 65.2239), makeLayer('H', 2.3, 95.3778)];
  close(merit(evaluate(layers, wave, 1.52).R, target), 2.25678035e-4, 2e-12);
  const scan = scanNeedles(layers, problem({ wavelengths: wave, target }));
  assert.equal(scan.best.layerIndex, 1);
  assert.equal(scan.best.material, 'L');
  close(scan.best.position, 145.7781 - 117.2178, 2e-4);
  // Printed thicknesses are rounded to 4 decimals in the supplied worked example.
  close(scan.best.value, -3.913998e-5, 6e-10);
  const inserted = insertNeedle(layers, scan.best, 0.1);
  close(merit(evaluate(inserted, wave, 1.52).R, target), 2.22017256e-4, 6e-11);
  const result = refine(inserted, problem({ wavelengths: wave, target }), { maxIterations: 120 });
  close(result.merit, 1.75996773e-4, 3e-10);
});

test('constrained LM recovers a known single-layer target and honors active optical bound', () => {
  const targetLayer = [makeLayer('H', 2.3, 63)];
  const target = evaluate(targetLayer, wavelengths, 1.52).R;
  const result = refine([makeLayer('H', 2.3, 35)], problem({ target }));
  assert.ok(result.merit < 1e-16, `merit ${result.merit}`);
  close(result.layers[0].d, 63, 1e-5);
  const bounded = refine([makeLayer('H', 2.3, 20)], problem({ wavelengths: [550], target: [0.95], maxOpticalThickness: 100 }));
  assert.ok(opticalThickness(bounded.layers) <= 100 + 1e-7);
  close(opticalThickness(bounded.layers), 100, 1e-6);
  const lower = refine([makeLayer('H', 2.3, 0.4)], problem({ target: wavelengths.map(() => 0) }));
  assert.ok(lower.layers.every(layer => layer.d >= 0));
  assert.ok(lower.layers[0].d < 1e-4);
});

test('gradual evolution seeks the next higher local thickness minimum', () => {
  const n = 2.3;
  const d = 550 / (4 * n);
  const layers = [makeLayer('H', n, d)];
  const candidates = growthCandidates(layers, problem({ wavelengths: [550], target: [0.95] }));
  assert.equal(candidates.length, 1);
  close(candidates[0].to, 3 * 550 / (4 * n), 2e-5);
  assert.ok(candidates[0].to > d);
  const smallCap = growthCandidates(layers, problem({ wavelengths: [550], target: [0.95], maxOpticalThickness: 200 }));
  assert.equal(smallCap.length, 0);
});

test('full synthesis has real insertion/growth, feasible frames, and returns best archived design', async () => {
  const config = problem({ target: wavelengths.map(() => 0.85), maxLayers: 12, maxOpticalThickness: 2500, maxCycles: 3, targetMerit: 1e-8 });
  const frames = [];
  for await (const snapshot of synthesize(config)) {
    frames.push(snapshot);
    assert.ok(snapshot.layers.length <= config.maxLayers);
    assert.ok(snapshot.layers.every(layer => Number.isFinite(layer.d) && layer.d >= 0));
    assert.ok(opticalThickness(snapshot.layers) <= config.maxOpticalThickness + 1e-6);
    close(snapshot.merit, merit(evaluate(snapshot.layers, wavelengths, 1.52).R, config.target), 1e-12);
  }
  assert.equal(frames[0].layers.length, 1);
  assert.ok(frames.some(frame => frame.stage === 'needle-insertion'));
  assert.ok(frames.some(frame => frame.stage === 'growth'));
  assert.ok(frames.some(frame => frame.stage === 'cleanup'));
  assert.ok(frames.at(-1).done);
  assert.ok(frames.at(-1).merit < frames[0].merit * 0.2);
  assert.ok(frames.at(-1).merit <= Math.min(...frames.map(frame => frame.merit)) + 1e-12);
});

test('invalid problem and over-thick starting layer are rejected', async () => {
  await assert.rejects(async () => { for await (const _ of synthesize(problem({ startThickness: 500, maxOpticalThickness: 10 }))) {} }, /starting layer exceeds/i);
  assert.throws(() => refine([], problem({ target: [1.2] })), /equal nonempty/i);
  assert.throws(() => refine([], problem({ nH: 1.38 })), /different/i);
});

test('thin-layer cleanup keeps an optically necessary thin layer and accepts harmless removal', async () => {
  const target = evaluate([makeLayer('H', 2.3, 1)], wavelengths, 1.52).R;
  let final;
  let cleanup;
  for await (const frame of synthesize(problem({ startThickness: 1, target, cleanupThickness: 10 }))) {
    if (frame.stage === 'cleanup') cleanup = frame;
    final = frame;
  }
  assert.equal(cleanup.cleanupAccepted, false);
  assert.equal(final.layers.length, 1);
  close(final.layers[0].d, 1, 1e-9);
  assert.ok(final.merit < 1e-20);
  const bare = evaluate([], wavelengths, 1.52).R;
  for await (const frame of synthesize(problem({ startThickness: 1e-6, target: bare, cleanupThickness: 0.5 }))) {
    if (frame.stage === 'cleanup') cleanup = frame;
    final = frame;
  }
  assert.equal(cleanup.cleanupAccepted, true);
  assert.equal(final.layers.length, 0);
  close(final.merit, 0, 0);
});

test('needle backtracking preserves a small host remnant near an existing interface', () => {
  const layers = [makeLayer('L', 1.38, 50, 'a'), makeLayer('H', 2.3, 100, 'b'), makeLayer('L', 1.38, 50, 'c')];
  const candidate = { layerIndex: 1, position: 0.1, material: 'L', n: 1.38 };
  const target = evaluate(insertNeedle(layers, candidate, 0.05), wavelengths, 1.52).R;
  candidate.value = needleDerivative(layers, wavelengths, target, 1.52, 1, candidate.position, candidate.n);
  // Width .2 consumes the top host remnant, so merging gives no new degree of
  // freedom. The search must halve that width rather than discard the location.
  const result = feasibleNeedle(layers, { candidates: [candidate] }, problem({ target }));
  assert.ok(result);
  assert.equal(result.layers.length, 5);
  assert.ok(result.width < 0.2);
  const originalMerit = merit(evaluate(layers, wavelengths, 1.52).R, target);
  assert.ok(result.merit < originalMerit);
  assert.ok(result.layers[1].d > 0, 'Host remnant must survive.');
});

test('all four UI presets improve substantially with default synthesis limits', async () => {
  const wave = grid(400, 800, 121);
  const ceilings = { mirror: 0.035, ar: 0.0001, edge: 0.006, split: 0.015 };
  for (const [name, bands] of Object.entries(PRESETS)) {
    const config = problem({ nL: 1.46, nH: 2.1, wavelengths: wave,
      target: wave.map(w => targetAt(w, 400, 800, bands)), startThickness: 100,
      maxLayers: 24, maxOpticalThickness: 6000, maxCycles: 8, targetMerit: 1e-4 });
    let initial;
    let final;
    let best = Infinity;
    let prior;
    for await (const frame of synthesize(config)) {
      if (!initial) initial = frame;
      assert.ok(frame.layers.length <= config.maxLayers, name);
      assert.ok(opticalThickness(frame.layers) <= config.maxOpticalThickness + 1e-6, name);
      // A reported insertion must introduce a structural degree of freedom.
      if (frame.stage === 'needle-insertion') assert.ok(frame.layers.length > prior.layers.length, name);
      best = Math.min(best, frame.merit);
      prior = frame;
      final = frame;
    }
    assert.ok(final.merit < ceilings[name], `${name}: ${final.merit}`);
    assert.ok(final.merit < initial.merit * 0.1, name);
    assert.ok(final.merit <= best + 1e-12, `${name}: best archive`);
    assert.equal(final.targetReached, final.merit <= config.targetMerit);
  }
});

test('default 450–650 nm mirror demonstration reaches its requested target MSE', async () => {
  const wave = grid(450, 650, 121);
  const config = problem({ nL: 1.46, nH: 2.1, wavelengths: wave,
    target: wave.map(() => 0.95), startThickness: 100, maxLayers: 24,
    maxOpticalThickness: 6000, maxCycles: 8, targetMerit: 1e-4 });
  let final;
  const stages = new Set();
  for await (const frame of synthesize(config)) {
    assert.ok(frame.layers.length <= config.maxLayers);
    assert.ok(frame.layers.every(layer => layer.d >= 0));
    assert.ok(opticalThickness(frame.layers) <= config.maxOpticalThickness + 1e-6);
    stages.add(frame.stage);
    final = frame;
  }
  assert.ok(final.done && final.targetReached);
  assert.ok(final.merit <= config.targetMerit);
  assert.ok(final.verification?.meetsTarget);
  for (const stage of ['refinement', 'needle-scan', 'needle-insertion', 'growth', 'cleanup', 'final']) {
    assert.ok(stages.has(stage), `Missing demonstration stage: ${stage}`);
  }
});

test('cleanup never sacrifices an exact archived match or reports a contradictory target status', async () => {
  const target = evaluate([makeLayer('H', 2.3, 0.01)], wavelengths, 1.52).R;
  let final;
  for await (const frame of synthesize(problem({ startThickness: 0.01, target,
    targetMerit: 0, maxCycles: 1, cleanupThickness: 0.5 }))) final = frame;
  close(final.merit, 0, 0);
  assert.equal(final.layers.length, 1);
  assert.equal(final.targetReached, true);
  assert.match(final.reason, /Target MSE reached/);
});

// Independent, pivoted dense elimination used only by the exhaustive QP oracle.
function denseSolve(matrix, rhs) {
  if (!rhs.length) return [];
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < rhs.length; k++) {
    let pivot = k;
    for (let i = k + 1; i < rhs.length; i++) if (Math.abs(rows[i][k]) > Math.abs(rows[pivot][k])) pivot = i;
    if (Math.abs(rows[pivot][k]) < 1e-18) return null;
    [rows[k], rows[pivot]] = [rows[pivot], rows[k]];
    const divisor = rows[k][k];
    for (let j = k; j <= rhs.length; j++) rows[k][j] /= divisor;
    for (let i = 0; i < rhs.length; i++) if (i !== k) {
      const factor = rows[i][k];
      for (let j = k; j <= rhs.length; j++) rows[i][j] -= factor * rows[k][j];
    }
  }
  return rows.map(row => row.at(-1));
}

test('bounded LM subproblem agrees with exhaustive active-set enumeration on 160 deterministic problems', t => {
  let seed = 8793127;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  let worstRelativeObjectiveError = 0;
  for (let sample = 0; sample < 160; sample++) {
    const size = 1 + sample % 5;
    const A = Array.from({ length: size }, () => Array.from({ length: size }, () => 2 * random() - 1));
    const H = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) =>
      A.reduce((sum, row) => sum + row[i] * row[j], 0) + (i === j ? 0.03 : 0)));
    const d = Array.from({ length: size }, () => random() < 0.3 ? 0 : 100 * random());
    const n = Array.from({ length: size }, () => 1.38 + random() * (3.95 - 1.38));
    const limit = Math.max(1, dot(d, n) * (sample % 2 ? 1 : 1.3));
    const unconstrained = Array.from({ length: size }, () => 300 * random() - 100);
    const gradient = H.map(row => dot(row, d.map((v, i) => v - unconstrained[i])));
    const rhs = H.map((row, i) => dot(row, d) - gradient[i]);
    const objective = x => {
      const delta = x.map((v, i) => v - d[i]);
      return dot(gradient, delta) + 0.5 * dot(delta, H.map(row => dot(row, delta)));
    };
    let oracle = Infinity;
    // Enumerate every face, with and without an active optical-thickness cap.
    for (let mask = 0; mask < 2 ** size; mask++) for (const cap of [false, true]) {
      const free = Array.from({ length: size }, (_, i) => i).filter(i => mask & (1 << i));
      if (cap && !free.length) continue;
      const matrix = free.map(i => free.map(j => H[i][j]));
      const b = free.map(i => rhs[i]);
      if (cap) {
        matrix.forEach((row, i) => row.push(n[free[i]]));
        matrix.push([...free.map(i => n[i]), 0]);
        b.push(limit);
      }
      const solution = denseSolve(matrix, b);
      if (!solution) continue;
      const x = new Array(size).fill(0);
      free.forEach((i, k) => { x[i] = solution[k]; });
      if (x.some(v => v < -1e-8) || dot(n, x) > limit + 1e-8) continue;
      oracle = Math.min(oracle, objective(x));
    }
    const actual = solveThicknessSubproblem(H, gradient, d, n, limit);
    assert.ok(actual, `sample ${sample}: solve failed`);
    assert.ok(actual.every(v => v >= -1e-10), `sample ${sample}: negative thickness`);
    assert.ok(dot(n, actual) <= limit + 1e-7, `sample ${sample}: optical cap`);
    const relativeError = Math.abs(objective(actual) - oracle) / Math.max(1, Math.abs(oracle));
    worstRelativeObjectiveError = Math.max(worstRelativeObjectiveError, relativeError);
    assert.ok(relativeError < 1e-9, `sample ${sample}: relative objective error ${relativeError}`);
  }
  t.diagnostic(`Maximum relative quadratic-objective error: ${worstRelativeObjectiveError}`);
});

test('high-Q cavity reflectance agrees with 85-digit reference for exact binary input values', () => {
  // Independently evaluated with Python Decimal at 85-digit precision, including
  // sin/cos Taylor series and exact Decimal.from_float(n,d,lambda) conversion.
  // These detuned values are NOT the ideal-real-arithmetic quarter-wave result.
  const references = [
    [15, 0.04270021012934305, -76318562917.30447013, -9152971420.43463738],
    [19, 0.9996245667688254, -238280129170.12495484, 145270601628.71681173],
  ];
  for (const [pairs, reference, referenceJ, referenceNeedle] of references) {
    const layers = [];
    for (let i = 0; i < pairs; i++) layers.push(makeLayer('H', 3.95, 550 / (4 * 3.95)), makeLayer('L', 1.38, 550 / (4 * 1.38)));
    layers.push(makeLayer('H', 3.95, 550 / (2 * 3.95)));
    for (let i = 0; i < pairs; i++) layers.push(makeLayer('L', 1.38, 550 / (4 * 1.38)), makeLayer('H', 3.95, 550 / (4 * 3.95)));
    const state = evaluate(layers, [550], 1.52);
    close(state.R[0], reference, 2e-13, `${layers.length}-layer resonator`);
    close(state.R[0] + state.T[0], 1, 1e-12);
    assert.ok(state.jacobian[0].every(Number.isFinite));
    const center = 2 * pairs;
    close(state.jacobian[0][center], referenceJ, Math.abs(referenceJ) * 1e-11);
    close(needleDerivative(layers, [550], [0.2], 1.52, center, layers[center].d * 0.271, 1.38),
      referenceNeedle, Math.abs(referenceNeedle) * 1e-11);
  }
});

test('independent verification detects a real sparse-grid aliasing failure', async () => {
  // 84,000/lambda is integer at 400,500,600,700,800 nm: this thick film is
  // half-wave at every chosen point but strongly reflecting between them.
  const wave = grid(400, 800, 5);
  const bareReflection = ((1 - 1.52) / (1 + 1.52)) ** 2;
  let final;
  for await (const frame of synthesize(problem({ nH: 3.95, wavelengths: wave,
    target: wave.map(() => bareReflection), startThickness: 42000 / 3.95,
    maxOpticalThickness: 50000, maxCycles: 1, targetMerit: 1e-10 }))) final = frame;
  assert.equal(final.targetReached, true);
  assert.ok(final.merit < 1e-20);
  assert.ok(final.verification.points >= 2001);
  assert.equal(final.verification.meetsTarget, false);
  assert.ok(final.verification.merit > 0.1);
  assert.ok(final.verification.maxAbsError > 0.6);
});

test('dense verification includes original samples and both one-sided limits of every target jump', () => {
  const wave = grid(400, 800, 17);
  const bands = [{ end: 0.375, R: 0.1 }, { end: 0.75, R: 0.95 }, { end: 1, R: 0.2 }];
  const config = problem({ wavelengths: wave, bands,
    target: wave.map(w => targetAt(w, 400, 800, bands)) });
  const result = verifySpectrum([makeLayer('H', 2.3, 100)], config);
  assert.equal(result.boundaryProbes.length, 2);
  assert.ok(wave.every(w => result.wavelengths.includes(w)));
  assert.ok(result.wavelengths.every((w, i) => i === 0 || w > result.wavelengths[i - 1]));
  for (const [i, probe] of result.boundaryProbes.entries()) {
    assert.ok(probe.left < probe.wavelength && probe.wavelength < probe.right);
    for (const w of Object.values(probe)) assert.ok(result.wavelengths.includes(w));
    close(result.target[result.wavelengths.indexOf(probe.left)], bands[i].R, 0);
    close(result.target[result.wavelengths.indexOf(probe.wavelength)], bands[i + 1].R, 0);
    close(result.target[result.wavelengths.indexOf(probe.right)], bands[i + 1].R, 0);
  }
  close(result.merit, merit(result.R, result.target), 0);
  close(result.maxAbsError, Math.max(...result.R.map((R, i) => Math.abs(R - result.target[i]))), 0);
  const arbitrarySamples = problem({ target: wavelengths.map((_, i) => i / wavelengths.length) });
  assert.equal(verifySpectrum([], arbitrarySamples), null);
  assert.throws(() => verifySpectrum([], { ...config, target: wave.map(() => 0) }), /do not match/);
});

test('algebraic normalization does not silently remove positive thin layers', () => {
  const layers = [makeLayer('H', 3.95, 1e-12), makeLayer('L', 1.38, 50)];
  assert.deepEqual(normalizeLayers(layers), layers);
  const zeros = [makeLayer('L', 1.38, 10, 'a'), makeLayer('H', 3.95, 0), makeLayer('L', 1.38, 20, 'b')];
  assert.deepEqual(normalizeLayers(zeros), [makeLayer('L', 1.38, 30, 'a')]);
});
