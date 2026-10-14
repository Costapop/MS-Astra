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
