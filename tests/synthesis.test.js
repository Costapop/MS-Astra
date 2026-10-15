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

/* ---------------- v2.1.2: termination reasons are consistent with the reported design ---------------- */
import { PRESETS, bandsFromPreset, materialByKey } from '../src/config.js';

function presetConfig(key, targetMerit) {
  const p = PRESETS[key]; const bands = bandsFromPreset(p);
  const wl = uniformGrid(p.range[0], p.range[1], 41); const s = sampleTarget(bands, wl, 0);
  const H = materialByKey(p.H), L = materialByKey(p.L);
  // the preset's incidence (angle, polarization characteristic, incident medium) is part of the task
  return { wavelengths: wl, target: s.target, weights: s.weights, bands, transition: 0, ns: 1.52, na: p.ambient === 'BK7' ? 1.52 : 1, angle: p.angle ?? 0, pol: p.pol ?? 'avg', materials: { H: { n: H.n, m: H.key }, L: { n: L.n, m: L.key } },
    start: { material: p.start.material, thickness: p.start.thickness }, maxLayers: Math.min(p.maxLayers, 24), maxOpticalThickness: Math.min(p.maxTOT, 3500), targetMerit, thinLayer: 1, budgetMs: 20000 };
}

test('every termination reason is backed by the recorded facts of the run', () => {
  const seen = new Set();
  for (const key of Object.keys(PRESETS)) for (const tm of [PRESETS[key].merit, 1e-9]) {
    const cfg = presetConfig(key, tm);
    const { done } = runAll(cfg);
    const st = done.stop; seen.add(st.kind);
    assert.ok(['target', 'tot', 'stagnation', 'budget', 'cycles'].includes(st.kind), st.kind);
    assert.ok(done.reason.length > 10);
    if (st.kind === 'target') {
      assert.ok(done.F <= tm && (!done.dense || done.dense.F <= tm), `${key}: target claimed but F=${done.F}`);
      assert.match(done.reason, /^Target merit reached/);
    }
    if (st.kind === 'tot') {
      assert.ok(st.terminal.opticalThickness >= cfg.maxOpticalThickness - 1e-6, `${key}: TOT limit claimed, terminal ${st.terminal.opticalThickness}`);
      if (!st.fromArchive) assert.ok(done.opticalThickness >= cfg.maxOpticalThickness - 1, `${key}: final TOT ${done.opticalThickness} vs limit`);
      assert.match(done.reason, /Optical‑thickness limit reached/);
    }
    if (st.kind === 'stagnation') {
      assert.match(done.reason, /^No further progress/);
      if (st.needleStop === 'layer-limit') { assert.ok(st.terminal.layers >= cfg.maxLayers - 1); assert.match(done.reason, /layer limit/); }
      if (st.needleStop === 'stationary') assert.match(done.reason, /needle‑stationary/);
      if (st.needleStop === 'no-gain') assert.match(done.reason, /no needle lowers/);
      if (st.growthCapped) assert.match(done.reason, /capped by the optical‑thickness limit/);
    }
    // the archive note appears exactly when the reported design is not the terminal one
    assert.equal(/best archived/.test(done.reason), !!st.fromArchive, `${key}: archive note mismatch`);
    if (st.fromArchive) assert.ok(done.F < st.terminal.F, 'archived design is better than the terminal one');
    // reported numbers describe the reported design
    assert.ok(done.layers.length <= cfg.maxLayers && done.opticalThickness <= cfg.maxOpticalThickness + 1e-6);
  }
  assert.ok(seen.size >= 2, `termination kinds exercised: ${[...seen]}`);
});

test('a budget-limited exploration result is replayed deterministically', () => {
  // work budget (deterministic) and a wall-clock budget (as used by the interface): both must replay exactly
  for (const budget of [{ maxRefinements: 23 }, { budgetMs: 200 }]) {
    const cfg = { ...presetConfig('mirror', 1e-9), ...budget };
    let final = null;
    for (const ev of explore({ ...cfg, starts: [{ name: 'manual', start: cfg.start }] })) if (ev.type === 'explore-done') final = ev;
    const r = final.best;
    assert.equal(r.stopKind, 'budget', `expected a budget stop, got ${r.reason}`);
    const replay = { ...cfg, budgetMs: Infinity, maxRefinements: r.refinements, budgetReason: r.baseReason, start: cfg.start };
    const { done } = runAll(replay);
    assert.equal(done.layers.length, r.layers.length);
    assert.ok(Math.abs(done.F - r.F) <= 1e-15 * Math.max(1, Math.abs(r.F)) + 1e-18, `replay F=${done.F} vs ${r.F}`);
    assert.equal(done.reason, r.reason);
  }
});

test('the built-in self-check of the termination reason passes for every preset and start mode', () => {
  for (const key of Object.keys(PRESETS)) for (const tm of [PRESETS[key].merit, 1e-9]) {
    const cfg = presetConfig(key, tm);
    const { done } = runAll(cfg);
    assert.ok(done.stop.checks.length >= 2);
    const failed = done.stop.checks.filter((c) => !c.ok);
    assert.equal(failed.length, 0, `${key} (${tm}): ${failed.map((c) => `${c.name} [${c.detail}]`).join('; ')} — reason: ${done.reason}`);
    assert.equal(done.stop.verified, true);
  }
  // multi-start winner, replayed: identical reason and verified
  const cfg = { ...presetConfig('mirror', 1e-9), budgetMs: 4000 };
  let final = null; for (const ev of explore(cfg)) if (ev.type === 'explore-done') final = ev;
  const b = final.best;
  const replay = { ...cfg, start: b.start, budgetMs: Infinity, ...(b.stopKind === 'budget' ? { maxRefinements: b.refinements, budgetReason: b.baseReason } : {}) };
  const { done } = runAll(replay);
  assert.equal(done.reason, b.reason);
  assert.equal(done.stop.verified, true, done.stop.checks.filter((c) => !c.ok).map((c) => c.name).join('; '));
});

/* ---------------- v2.2.2: plain-language termination summary ---------------- */
test('the termination summary names the decisive stopping condition and agrees with the structured cause', () => {
  const expectDecisive = (st) => st.kind === 'target' ? 'target' : st.kind === 'tot' ? 'tot' : st.kind === 'budget' ? 'budget' : st.kind === 'cycles' ? 'cycles'
    : st.needleStop === 'layer-limit' ? 'layers' : (st.needleStop === 'stationary' || st.needleStop === 'no-gain') ? 'needle' : 'growth';
  const seen = new Set();
  for (const key of Object.keys(PRESETS)) for (const tm of [PRESETS[key].merit, 1e-9]) {
    const cfg = presetConfig(key, tm);
    const { done } = runAll(cfg);
    const s = done.stop.summary;
    assert.ok(s && s.headline && s.detail && s.reported, `${key}: summary missing`);
    assert.equal(s.decisive, expectDecisive(done.stop), `${key} (${tm}): decisive ${s.decisive} vs stop ${done.stop.kind}/${done.stop.needleStop}`);
    seen.add(s.decisive);
    for (const k of ['target', 'layers', 'tot', 'needle', 'growth']) assert.ok(s.facts.some((f) => f.key === k), `${key}: fact ${k} missing`);
    const d = s.facts.filter((f) => f.decisive);
    assert.equal(d.length, 1);
    if (d[0].key !== 'target' || /^Target merit reached$/.test(s.headline)) assert.ok(d[0].hit, `${key}: decisive fact «${d[0].label}» not satisfied: ${d[0].text}`);
    // every fact's wording agrees with its flag
    for (const f of s.facts) {
      if (f.key === 'target') assert.equal(f.hit, done.F <= tm && (!done.dense || done.dense.F <= tm));
      if (f.key === 'tot') assert.equal(f.hit, done.stop.kind === 'tot');
      if (f.key === 'layers' && f.hit) assert.ok(/reached/.test(f.text) && !/not reached/.test(f.text));
      if (!f.hit) assert.ok(/not reached|still possible|growth step|not needed/.test(f.text), `${key}: ${f.label}: ${f.text}`);
    }
    // the headline is one of the plain-language causes
    assert.match(s.headline, /^(Target merit reached|Optical‑thickness limit reached|Layer limit reached|Needle variations no longer reduce the merit|No further progress|Needle cycle step limit reached|Time budget exhausted|Work budget exhausted|Cycle budget exhausted)/);
    // the reported-design sentence matches the archive flag
    assert.equal(/best archived/.test(s.reported), !!done.stop.fromArchive);
    // the layer limit excluding interior needles is reported as the cause, never as "no needle lowers the merit"
    if (done.stop.layerLimitPartial) { assert.equal(done.stop.needleStop, 'layer-limit'); assert.ok(done.stop.terminal.layers >= cfg.maxLayers - 1); if (done.stop.kind === 'stagnation') assert.match(done.reason, /blocks needles inside the layers/); }
  }
  assert.ok(seen.size >= 2, `decisive causes exercised: ${[...seen]}`);
  // multi-start results carry the same summary; the ranking is by score
  const cfg = { ...presetConfig('mirror', 1e-9), budgetMs: 3000 };
  let final = null; for (const ev of explore(cfg)) if (ev.type === 'explore-done') final = ev;
  for (const r of final.results) assert.ok(r.summary && r.summary.headline && r.summary.facts.length >= 5, `${r.name}: summary missing`);
  for (let i = 1; i < final.results.length; i++) assert.ok(final.results[i - 1].score <= final.results[i].score);
});

/* ---------------- v2.3: oblique incidence ---------------- */
import { assess, opticsModel } from '../src/optics.js';
import { sampleDualTarget } from '../src/config.js';

function obliqueConfig(key, extra = {}) {
  const p = PRESETS[key]; const bands = bandsFromPreset(p);
  const wl = uniformGrid(p.range[0], p.range[1], 41); const s = sampleTarget(bands, wl, 0);
  const H = materialByKey(p.H), L = materialByKey(p.L);
  return { wavelengths: wl, target: s.target, weights: s.weights, bands, transition: 0, ns: 1.52, na: p.ambient === 'BK7' ? 1.52 : 1, angle: p.angle ?? 0, pol: p.pol ?? 'avg', materials: { H: { n: H.n, m: H.key }, L: { n: L.n, m: L.key } },
    start: { material: p.start.material, thickness: p.start.thickness }, maxLayers: p.maxLayers, maxOpticalThickness: p.maxTOT, targetMerit: p.merit, thinLayer: 1, budgetMs: 60000, ...extra };
}

test('oblique synthesis: the 45° cube splitter (unpolarized, inside BK7) and the 45° AR coating (both polarizations) reach their targets; reported numbers are consistent', () => {
  for (const key of ['cube', 'ar45']) {
    const cfg = obliqueConfig(key);
    const { events, done } = runAll(cfg);
    assert.match(done.reason, /^Target merit reached/, `${key}: ${done.reason}`);
    assert.ok(done.layers.length <= cfg.maxLayers && done.opticalThickness <= cfg.maxOpticalThickness + 1e-6);
    assert.ok(done.stop.verified, done.stop.checks.filter((c) => !c.ok).map((c) => c.name).join('; '));
    const model = opticsModel({ ns: cfg.ns, na: cfg.na, angle: cfg.angle, pol: cfg.pol });
    const a = assess(done.layers, cfg.wavelengths, cfg.target, cfg.weights, model);
    assert.ok(Math.abs(a.F - done.F) < 1e-15, 'reported F equals an independent assessment');
    assert.ok(done.dense && done.dense.Rs && done.dense.Rp && done.dense.F <= cfg.targetMerit);
    for (const e of events.filter((x) => x.type === 'needle')) assert.ok(e.F < e.Fparent);
    if (key === 'cube') {
      // unpolarized target reached while the polarizations split strongly at 45° inside glass
      let ds = 0; for (let l = 0; l < cfg.wavelengths.length; l++) ds = Math.max(ds, Math.abs(a.Rs[l] - a.Rp[l]));
      assert.ok(ds > 0.3, `Rs − Rp split ${ds}`);
    } else {
      // both polarizations are individually low
      assert.ok(Math.max(...a.Rs) < 0.02 && Math.max(...a.Rp) < 0.02);
    }
  }
});

test('oblique synthesis: evanescent low-index layers (from BK7 at 75°) and the Rs-only characteristic run to a verified termination', () => {
  for (const extra of [{ na: 1.52, angle: 75, pol: 'avg', maxLayers: 12, maxOpticalThickness: 1500, budgetMs: 20000 }, { na: 1, angle: 70, pol: 's', budgetMs: 20000 }]) {
    const cfg = { ...obliqueConfig('ar'), ...extra };
    const { done } = runAll(cfg);
    assert.ok(done.stop.verified, `${JSON.stringify(extra)}: ${done.stop.checks.filter((c) => !c.ok).map((c) => `${c.name} [${c.detail}]`).join('; ')}`);
    const model = opticsModel({ ns: cfg.ns, na: cfg.na, angle: cfg.angle, pol: cfg.pol });
    assert.ok(Math.abs(assess(done.layers, cfg.wavelengths, cfg.target, cfg.weights, model).F - done.F) < 1e-15);
    assert.ok(done.layers.every((L) => L.d >= 1 - 1e-9 && Number.isFinite(L.d)));
  }
  // quarter-wave starting designs are corrected for the angle of incidence
  const cfg45 = obliqueConfig('cube');
  const s45 = startDesigns(cfg45, 550), s0 = startDesigns({ ...cfg45, angle: 0 }, 550);
  const q45 = s45.find((s) => /SiO2 1 QWOT/.test(s.name)), q0 = s0.find((s) => /SiO2 1 QWOT/.test(s.name));
  const cosG = Math.sqrt(1 - (1.52 * Math.sin(Math.PI / 4) / 1.46) ** 2);
  assert.ok(Math.abs(q45.start.thickness - q0.start.thickness / cosG) < 1e-9);
});

test('separate Rs and Rp targets: the 45° polarizer preset (Rs → 98 %, Rp → 0 inside BK7) reaches its target; dense check and enrichment work on both targets', () => {
  const p = PRESETS.polarizer;
  const bS = bandsFromPreset(p), bP = bandsFromPreset(p, 'bands2');
  const wl = uniformGrid(p.range[0], p.range[1], 41); const s = sampleDualTarget(bS, bP, wl, 0);
  const H = materialByKey(p.H), L = materialByKey(p.L);
  const cfg = { wavelengths: wl, target: s.target, weights: s.weights, bands: bS, bands2: bP, transition: 0, ns: 1.52, na: 1.52, angle: 45, pol: 'both', materials: { H: { n: H.n, m: H.key }, L: { n: L.n, m: L.key } },
    start: { material: p.start.material, thickness: p.start.thickness }, maxLayers: p.maxLayers, maxOpticalThickness: p.maxTOT, targetMerit: p.merit, thinLayer: 1, budgetMs: 90000 };
  const { done } = runAll(cfg);
  assert.match(done.reason, /^Target merit reached/, done.reason);
  assert.ok(done.stop.verified, done.stop.checks.filter((c) => !c.ok).map((c) => c.name).join('; '));
  const model = opticsModel({ ns: 1.52, na: 1.52, angle: 45, pol: 'both' });
  const a = assess(done.layers, wl, s.target, s.weights, model);
  assert.ok(Math.abs(a.F - done.F) < 1e-15);
  assert.ok(Math.min(...a.Rs) > 0.94 && Math.max(...a.Rp) < 0.04, `Rs ≥ ${Math.min(...a.Rs)}, Rp ≤ ${Math.max(...a.Rp)}`);
  assert.ok(done.dense && done.dense.target.s && done.dense.target.p && done.dense.F <= p.merit);
  // the reported grid carries both targets
  assert.ok(done.grid.target.s.length === done.grid.wavelengths.length && done.grid.target.p.length === done.grid.wavelengths.length);
  // enrichment on a very sparse grid with two targets adds points and keeps both targets consistent
  const wl5 = uniformGrid(p.range[0], p.range[1], 3); const s5 = sampleDualTarget(bS, bP, wl5, 0);
  const { done: d5 } = runAll({ ...cfg, wavelengths: wl5, target: s5.target, weights: s5.weights, budgetMs: 60000 });
  assert.ok(d5.grid.wavelengths.length > 3 && d5.stats.pointsAdded > 0, 'grid enriched');
  const s6 = sampleDualTarget(bS, bP, d5.grid.wavelengths, 0);
  assert.deepEqual(Array.from(d5.grid.target.s), Array.from(s6.target.s)); assert.deepEqual(Array.from(d5.grid.target.p), Array.from(s6.target.p));
});
