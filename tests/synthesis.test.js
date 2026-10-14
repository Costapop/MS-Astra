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
  assert.ok(done); assert.equal(done.reason, 'Target merit reached');
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
