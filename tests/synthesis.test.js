import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, growthSearch } from '../src/synthesis.js';
import { meritWeights, reflectance, merit, totalOpticalThickness } from '../src/optics.js';
import { refineToEnd } from '../src/refine.js';

const grid = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
function runAll(cfg) {
  const events = []; let done = null;
  for (const ev of synthesize(cfg)) { events.push(ev); if (ev.type === 'done') done = ev; }
  return { events, done };
}

test('anti-reflection synthesis reaches the target merit within the limits', () => {
  const wl = grid(400, 700, 61);
  const cfg = { wavelengths: wl, target: new Float64Array(61).fill(0), weights: meritWeights(61), ns: 1.52, materials: { H: { n: 2.45, m: 'TiO2' }, L: { n: 1.38, m: 'MgF2' } }, start: { material: 'TiO2', thickness: 100 }, maxLayers: 12, maxOpticalThickness: 1500, targetMerit: 1e-6, thinLayer: 1 };
  const { events, done } = runAll(cfg);
  assert.ok(done); assert.match(done.reason, /^Target merit reached/);
  assert.ok(done.F <= 1e-6); assert.ok(done.layers.length <= 12); assert.ok(done.opticalThickness <= 1500 + 1e-9);
  assert.ok(done.layers.every((L) => L.d >= 1 - 1e-9), 'no layer thinner than the cleanup threshold');
  for (let i = 1; i < done.layers.length; i++) assert.notEqual(done.layers[i].m, done.layers[i - 1].m, 'adjacent layers alternate');
  // reported R and F are consistent with an independent evaluation
  const R = reflectance(done.layers, wl, 1.52);
  assert.ok(Math.abs(merit(R, cfg.target, cfg.weights) - done.F) < 1e-15);
  assert.ok(events.some((e) => e.type === 'scan') && events.some((e) => e.type === 'needle'));
  for (const e of events.filter((x) => x.type === 'needle')) assert.ok(e.F < e.Fparent, 'every accepted needle width lowers F before refinement');
});

test('mirror synthesis respects layer and optical-thickness limits and uses gradual evolution', () => {
  const wl = grid(450, 650, 41);
  const cfg = { wavelengths: wl, target: new Float64Array(41).fill(0.95), weights: meritWeights(41), ns: 1.52, materials: { H: { n: 2.10, m: 'Ta2O5' }, L: { n: 1.46, m: 'SiO2' } }, start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 16, maxOpticalThickness: 2600, targetMerit: 1e-9, thinLayer: 1 };
  const { events, done } = runAll(cfg);
  assert.ok(done.layers.length <= 16);
  assert.ok(totalOpticalThickness(done.layers) <= 2600 + 1e-6);
  assert.ok(events.some((e) => e.type === 'growth'), 'thickness growth steps occurred');
  assert.ok(done.stats.needles > 0);
  assert.ok(done.F < 0.02, `final F=${done.F}`);
  // merit after each refinement never exceeds the start and the final design is the best archived
  const refined = events.filter((e) => e.type === 'refined').map((e) => e.F);
  assert.ok(done.F <= Math.min(...refined) + 1e-15);
});

test('growthSearch finds the nearest merit minimum beyond the current thickness', () => {
  const wl = grid(450, 650, 41); const target = new Float64Array(41).fill(0.95); const w = meritWeights(41);
  const problem = { wavelengths: wl, target, weights: w, ns: 1.52, na: 1 };
  const start = refineToEnd([{ n: 2.10, m: 'H', d: 100 }], problem, {});
  const g = growthSearch(start.layers, problem, { lamMin: 450, lamMax: 650, maxTOT: 5000 });
  assert.ok(g && g.s > 0);
  const F = (s) => merit(reflectance(start.layers.map((L, i) => ({ ...L, d: L.d + (i === g.layer ? s : 0) })), wl, 1.52), target, w);
  assert.ok(F(g.s) <= F(g.s + 0.5) && F(g.s) <= F(g.s - 0.5), 'local minimum in s');
  assert.ok(F(g.s / 2) > F(0), 'merit rises before the next minimum');
});

test('refinement keeps thicknesses non-negative and honours the optical-thickness bound', () => {
  const wl = grid(400, 700, 31); const target = new Float64Array(31).fill(0); const w = meritWeights(31);
  const problem = { wavelengths: wl, target, weights: w, ns: 1.52, na: 1 };
  const layers = [{ n: 2.45, m: 'H', d: 5 }, { n: 1.38, m: 'L', d: 120 }, { n: 2.45, m: 'H', d: 300 }, { n: 1.38, m: 'L', d: 90 }];
  const r = refineToEnd(layers, problem, { totMax: 1100 });
  assert.ok(r.layers.every((L) => L.d >= 0));
  assert.ok(totalOpticalThickness(r.layers) <= 1100 + 1e-9);
  assert.ok(r.F < merit(reflectance(layers, wl, 1.52), target, w));
});

/* ---------------- v2.1: candidate comparison, transition zones, dense check, multi-start ---------------- */
import { explore, startDesigns } from '../src/synthesis.js';
import { sampleTarget, denseGrid, uniformGrid } from '../src/config.js';

test('candidate comparison after refinement reproduces the K ≥ 2 six-layer minimum of the method document (§13.4, eq. 13.7)', () => {
  const H = { n: 2.30, m: 'H' }, L = { n: 1.38, m: 'L' };
  const wl = grid(420, 800, 77);
  const cfg = { wavelengths: wl, target: new Float64Array(77).fill(0.2), weights: meritWeights(77), ns: 1.52, materials: { H, L },
    start: { layers: [{ m: 'H', d: 74 }, { m: 'L', d: 103 }, { m: 'H', d: 131 }, { m: 'L', d: 88 }] },
    maxLayers: 40, maxOpticalThickness: 1e9, targetMerit: 1e-12, thinLayer: 1e-6, candidates: 3, compare: true, lmRelTol: 1e-13, maxLmIterations: 4000 };
  let refined = 0, compareEv = null, needleEv = null, result = null;
  for (const ev of synthesize(cfg)) {
    if (ev.type === 'compare' && !compareEv) compareEv = ev;
    if (ev.type === 'needle' && !needleEv) needleEv = ev;
    if (ev.type === 'refined') { refined++; if (refined === 2) { result = ev; break; } }
  }
  assert.equal(compareEv.trials.length, 3);
  const Fs = compareEv.trials.map((t) => t.Frefined);
  assert.ok(Math.abs(Fs[0] - 1.759968e-4) < 1e-9 && Math.abs(Fs[1] - 4.174423e-5) < 1e-9 && Math.abs(Fs[2] - 4.174423e-5) < 1e-9, `refined alternatives ${Fs}`);
  assert.equal(needleEv.candidate.layer, 1, 'the second candidate by g wins after refinement');
  const expected = [95.7914, 102.3440, 31.4759, 13.7106, 113.4594, 114.4973];
  assert.equal(result.layers.length, 6);
  result.layers.forEach((Lr, i) => assert.ok(Math.abs(Lr.d - expected[i]) < 2e-3, `d${i + 1}=${Lr.d}`));
  assert.ok(Math.abs(result.F - 4.174423e-5) < 2e-11, `F=${result.F}`);
});

test('transition zones give zero weight near target jumps and keep the weights normalised', () => {
  const bands = [{ from: 400, to: 600, R: 0.02 }, { from: 600, to: 800, R: 0.95 }];
  const g = uniformGrid(400, 800, 81);
  const s = sampleTarget(bands, g, 20);
  const zero = Array.from(g).filter((w, i) => s.weights[i] === 0);
  assert.deepEqual(zero.map((w) => Math.round(w)), [595, 600, 605]);
  assert.ok(Math.abs(s.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(s.excluded, 3);
  const d = denseGrid(bands, 400, 800, 20);
  assert.ok(d.wavelengths.length >= 2003 && d.weights.some((w) => w === 0) && d.weights.some((w) => w > 0));
});

test('dense-grid check detects an under-resolved sparse grid and enrichment repairs it', () => {
  const bands = [{ from: 400, to: 800, R: 0.5 }];
  const wl = uniformGrid(400, 800, 5);
  const s = sampleTarget(bands, wl, 0);
  const base = { wavelengths: wl, target: s.target, weights: s.weights, bands, transition: 0, ns: 1.52, materials: { H: { n: 2.45, m: 'TiO2' }, L: { n: 1.38, m: 'MgF2' } }, start: { material: 'TiO2', thickness: 300 }, maxLayers: 10, maxOpticalThickness: 3000, targetMerit: 1e-4, thinLayer: 1, budgetMs: 20000 };
  const { done: without } = runAll({ ...base, dense: { enabled: false } });
  const { done: withCheck } = runAll({ ...base, dense: { enabled: true } });
  assert.ok(without.F <= 1e-4, 'sparse grid alone is "satisfied"');
  const dense = denseGrid(bands, 400, 800, 0);
  const Rd = reflectance(without.layers, dense.wavelengths, 1.52);
  assert.ok(merit(Rd, dense.target, dense.weights) > 1e-4, 'but the dense grid reveals the aliasing');
  assert.ok(withCheck.stats.pointsAdded > 0 && withCheck.grid.wavelengths.length > 5, 'grid enriched');
  assert.match(withCheck.reason, /^Target merit reached/);
  assert.ok(withCheck.dense.F <= 1e-4, `dense F=${withCheck.dense.F}`);
});

test('multi-start exploration ranks the starting designs and is never worse than the manual start', () => {
  const wl = grid(450, 650, 41);
  const cfg = { wavelengths: wl, target: new Float64Array(41).fill(0.95), weights: meritWeights(41), ns: 1.52, materials: { H: { n: 2.10, m: 'Ta2O5' }, L: { n: 1.46, m: 'SiO2' } }, start: { material: 'Ta2O5', thickness: 100 }, maxLayers: 16, maxOpticalThickness: 2600, targetMerit: 1e-9, thinLayer: 1, budgetMs: 5000 };
  const starts = startDesigns(cfg, 550);
  assert.equal(starts.length, 10);
  assert.ok(starts[0].name.includes('manual') && starts[9].start.layers.length === 11);
  let final = null; const results = [];
  for (const ev of explore(cfg)) { if (ev.type === 'explore-result') results.push(ev); if (ev.type === 'explore-done') final = ev; }
  assert.equal(results.length, 10);
  assert.ok(final.best.score <= results[0].score + 1e-15);
  assert.ok(final.results.every((r, i) => i === 0 || r.score >= final.results[i - 1].score));
  assert.ok(final.best.layers.length <= 16 && final.best.opticalThickness <= 2600 + 1e-6);
});
