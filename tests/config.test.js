import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_MATERIALS, SUBSTRATES, PRESETS, bandsFromPreset, targetOnGrid, uniformGrid, validateConfig, materialByKey } from '../src/config.js';

test('material catalogue matches the specification', () => {
  const expected = { MgF2: 1.38, SiO2: 1.46, Al2O3: 1.63, HfO2: 1.95, Ta2O5: 2.10, TiO2: 2.45, ZnS: 2.35, 'a-Si': 3.95, K8: 1.52, Quartz: 1.46, Sitall: 1.54 };
  assert.equal(LAYER_MATERIALS.length, 11);
  for (const [k, n] of Object.entries(expected)) assert.equal(materialByKey(k).n, n, k);
  assert.deepEqual(SUBSTRATES.map((s) => [s.key, s.n]), [['BK7', 1.52]]);
});

test('piecewise-constant target is sampled on the grid and presets produce contiguous bands', () => {
  for (const p of Object.values(PRESETS)) {
    const bands = bandsFromPreset(p);
    assert.equal(bands[0].from, p.range[0]); assert.equal(bands[bands.length - 1].to, p.range[1]);
    for (let i = 1; i < bands.length; i++) assert.equal(bands[i].from, bands[i - 1].to);
  }
  const g = uniformGrid(400, 800, 5);
  const t = targetOnGrid([{ from: 400, to: 600, R: 0.02 }, { from: 600, to: 800, R: 0.95 }], g);
  assert.deepEqual(Array.from(t), [0.02, 0.02, 0.95, 0.95, 0.95]);
});

test('configuration validation catches inconsistent input', () => {
  const ok = { lambdaMin: 400, lambdaMax: 700, points: 61, H: { n: 2.45 }, L: { n: 1.38 }, maxLayers: 12, maxTOT: 1500, targetMerit: 1e-6, startThickness: 100, startMaterial: { n: 2.45 }, thinLayer: 1, bands: [{ R: 0 }] };
  assert.equal(validateConfig(ok).ok, true);
  assert.equal(validateConfig({ ...ok, lambdaMax: 300 }).ok, false);
  assert.equal(validateConfig({ ...ok, H: { n: 1.38 } }).ok, false);
  assert.equal(validateConfig({ ...ok, startThickness: 1000 }).ok, false);
  assert.equal(validateConfig({ ...ok, bands: [{ R: 1.2 }] }).ok, false);
});

/* ---------------- v2.3: oblique incidence ---------------- */
import { AMBIENTS, ambientByKey } from '../src/config.js';

test('incident media, oblique presets and the angle validation', () => {
  assert.deepEqual(AMBIENTS.map((a) => [a.key, a.n]), [['Air', 1], ['BK7', 1.52]]);
  assert.equal(ambientByKey('nope').key, 'Air');
  assert.equal(PRESETS.cube.angle, 45); assert.equal(PRESETS.cube.ambient, 'BK7'); assert.equal(PRESETS.cube.pol, 'avg');
  assert.equal(PRESETS.ar45.pol, 'both'); assert.equal(PRESETS.mirror.angle, undefined);
  const ok = { lambdaMin: 400, lambdaMax: 700, points: 61, H: { n: 2.45 }, L: { n: 1.38 }, maxLayers: 12, maxTOT: 1500, targetMerit: 1e-6, startThickness: 100, startMaterial: { n: 2.45 }, thinLayer: 1, bands: [{ R: 0 }], substrate: { n: 1.52 }, ambient: { n: 1 } };
  assert.equal(validateConfig({ ...ok, angle: 89.9, pol: 'p' }).ok, true);
  assert.equal(validateConfig({ ...ok, angle: 90 }).ok, false);
  assert.equal(validateConfig({ ...ok, angle: -1 }).ok, false);
  assert.equal(validateConfig({ ...ok, pol: 'x' }).ok, false);
  // evanescent layers are allowed (MgF2 from BK7 beyond 65.2°) …
  assert.equal(validateConfig({ ...ok, angle: 80, ambient: { n: 1.52 } }).ok, true);
  // … but total internal reflection at the substrate is not
  const tir = validateConfig({ ...ok, angle: 60, ambient: { n: 1.52 }, substrate: { n: 1.0 } });
  assert.equal(tir.ok, false); assert.match(tir.errors.join(' '), /Total internal reflection at the substrate/);
});

import { sampleDualTarget, denseGridDual, sampleTarget } from '../src/config.js';
test('separate Rs and Rp targets: dual sampling, dense grid with the jumps of both targets, polarizer preset, validation', () => {
  const bS = [{ from: 500, to: 560, R: 0.98 }, { from: 560, to: 600, R: 0.5 }], bP = [{ from: 500, to: 530, R: 0 }, { from: 530, to: 600, R: 0.1 }];
  const g = uniformGrid(500, 600, 11);
  const d = sampleDualTarget(bS, bP, g, 10);
  assert.deepEqual(Array.from(d.target.s), Array.from(sampleTarget(bS, g, 10).target));
  assert.deepEqual(Array.from(d.target.p), Array.from(sampleTarget(bP, g, 10).target));
  const sumS = d.weights.s.reduce((a, b) => a + b, 0), sumP = d.weights.p.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumS - 1) < 1e-12 && Math.abs(sumP - 1) < 1e-12);
  assert.ok(d.weights.s[6] === 0 && d.weights.p[6] > 0 && d.weights.p[3] === 0 && d.weights.s[3] > 0, 'each target has its own transition zone');
  const dd = denseGridDual(bS, bP, 500, 600, 0, 101);
  assert.ok(dd.wavelengths.length === 105 && dd.target.s.length === 105 && dd.target.p.length === 105);
  assert.ok(Array.from(dd.wavelengths).some((w) => Math.abs(w - 530) < 1e-3) && Array.from(dd.wavelengths).some((w) => Math.abs(w - 560) < 1e-3));
  const p = PRESETS.polarizer;
  assert.equal(p.pol, 'both'); assert.equal(p.angle, 45); assert.equal(p.ambient, 'BK7');
  assert.deepEqual(bandsFromPreset(p, 'bands2'), [{ from: 500, to: 600, R: 0 }]);
  assert.deepEqual(bandsFromPreset(p), [{ from: 500, to: 600, R: 0.98 }]);
  assert.deepEqual(bandsFromPreset(PRESETS.mirror, 'bands2'), bandsFromPreset(PRESETS.mirror), 'without bands2 the Rs bands are used');
  const ok = { lambdaMin: 500, lambdaMax: 600, points: 61, H: { n: 2.45 }, L: { n: 1.38 }, maxLayers: 12, maxTOT: 1500, targetMerit: 1e-6, startThickness: 100, startMaterial: { n: 2.45 }, thinLayer: 1, bands: [{ R: 0.98 }], bands2: [{ R: 0 }], substrate: { n: 1.52 }, ambient: { n: 1.52 }, angle: 45, pol: 'both' };
  assert.equal(validateConfig(ok).ok, true);
  assert.equal(validateConfig({ ...ok, bands2: [{ R: 1.5 }] }).ok, false);
  assert.equal(validateConfig({ ...ok, bands2: [{ R: 1.5 }], angle: 0 }).ok, true, 'at normal incidence the Rp bands are not used');
});
