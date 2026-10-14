import { evaluate, merit, opticalThickness, scanNeedles, insertNeedle, normalizeLayers } from './optics.js';

const clone = layers => layers.map(layer => ({ ...layer }));
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const EPS_MERIT = 1e-13;

function solveSPD(matrix, rhs) {
  const n = rhs.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let value = matrix[i][j];
      for (let k = 0; k < j; k++) value -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(value > 0) || !Number.isFinite(value)) return null;
        L[i][j] = Math.sqrt(value);
      } else L[i][j] = value / L[j][j];
    }
  }
  const y = new Array(n);
  for (let i = 0; i < n; i++) {
    let value = rhs[i];
    for (let j = 0; j < i; j++) value -= L[i][j] * y[j];
    y[i] = value / L[i][i];
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let value = y[i];
    for (let j = i + 1; j < n; j++) value -= L[j][i] * x[j];
    x[i] = value / L[i][i];
  }
  return x;
}

/**
 * Primal active-set solution of the damped LM quadratic subproblem.
 * Bounds d>=0 and sum(n*d)<=Dmax are part of the subproblem, not post-hoc
 * clipping of an unconstrained LM result. H is positive definite after damping.
 */
function constrainedStep(H, gradient, thickness, indices, maximum) {
  const n = thickness.length;
  const x = thickness.slice();
  const active = new Set(x.flatMap((value, i) => value <= 1e-11 ? [i] : []));
  let capActive = maximum - dot(indices, x) <= 1e-9;
  for (let iteration = 0; iteration < 8 * n + 40; iteration++) {
    const displacement = x.map((value, i) => value - thickness[i]);
    const grad = H.map((row, i) => dot(row, displacement) + gradient[i]);
    const free = Array.from({ length: n }, (_, i) => i).filter(i => !active.has(i));
    const p = new Array(n).fill(0);
    let multiplier = 0;
    if (free.length) {
      const reducedH = free.map(i => free.map(j => H[i][j]));
      const inverseGradient = solveSPD(reducedH, free.map(i => grad[i]));
      if (!inverseGradient) return null;
      if (capActive) {
        const normal = free.map(i => indices[i]);
        const inverseNormal = solveSPD(reducedH, normal);
        if (!inverseNormal) return null;
        multiplier = -dot(normal, inverseGradient) / dot(normal, inverseNormal);
        free.forEach((i, k) => { p[i] = -inverseGradient[k] - multiplier * inverseNormal[k]; });
      } else free.forEach((i, k) => { p[i] = -inverseGradient[k]; });
    }
    const norm = Math.sqrt(dot(p, p));
    if (norm <= 1e-8 * (1 + Math.sqrt(dot(x, x)))) {
      if (capActive && multiplier < -1e-12) { capActive = false; continue; }
      let remove = -1;
      let worst = -1e-12;
      for (const i of active) {
        const reducedGradient = grad[i] + multiplier * indices[i];
        if (reducedGradient < worst) { worst = reducedGradient; remove = i; }
      }
      if (remove >= 0) { active.delete(remove); continue; }
      return x;
    }
    let alpha = 1;
    let blocking = null;
    for (const i of free) {
      if (p[i] < -1e-12 && -x[i] / p[i] < alpha) {
        alpha = Math.max(0, -x[i] / p[i]);
        blocking = i;
      }
    }
    const opticalDirection = dot(indices, p);
    if (!capActive && opticalDirection > 1e-12) {
      const capAlpha = Math.max(0, (maximum - dot(indices, x)) / opticalDirection);
      if (capAlpha < alpha) { alpha = capAlpha; blocking = 'cap'; }
    }
    for (let i = 0; i < n; i++) x[i] = Math.max(0, x[i] + alpha * p[i]);
    if (blocking === 'cap') capActive = true;
    else if (blocking !== null) { x[blocking] = 0; active.add(blocking); }
  }
  return x;
}

function problemConfig(input) {
  const config = {
    ns: 1.52, maxLayers: 24, maxOpticalThickness: 6000, targetMerit: 1e-5,
    cleanupThickness: 0.5, maxCycles: 8, maxRefinementIterations: 70,
    maxNeedleCandidates: 8, maxNeedlesPerCycle: 32,
    ...input,
  };
  if (!config.wavelengths?.length || config.wavelengths.length !== config.target?.length)
    throw new Error('Provide equal nonempty wavelength and target arrays.');
  if (config.wavelengths.some((value, i) => !Number.isFinite(value) || value <= 0 || (i > 0 && value <= config.wavelengths[i - 1])))
    throw new Error('Wavelengths must be positive and strictly increasing.');
  if (config.target.some(value => !Number.isFinite(value) || value < 0 || value > 1))
    throw new Error('Target energy reflectance must be between 0 and 1.');
  if (![config.nL, config.nH, config.ns].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Refractive indices must be positive.');
  if (Math.abs(config.nL - config.nH) < 1e-12) throw new Error('Choose two different coating refractive indices.');
  if (!Number.isInteger(config.maxLayers) || config.maxLayers < 1) throw new Error('Maximum layer count must be a positive integer.');
  if (!(config.maxOpticalThickness > 0) || !Number.isFinite(config.maxOpticalThickness)) throw new Error('Maximum optical thickness must be positive.');
  if (!(config.targetMerit >= 0) || !Number.isFinite(config.targetMerit)) throw new Error('Target MSE must be nonnegative.');
  if (!(config.cleanupThickness >= 0) || !Number.isFinite(config.cleanupThickness)) throw new Error('Cleanup thickness must be nonnegative.');
  if (!Number.isInteger(config.maxCycles) || config.maxCycles < 1) throw new Error('Evolution cycle limit must be a positive integer.');
  return config;
}

function* refinementSteps(initial, config, maximumIterations = config.maxRefinementIterations) {
  let layers = clone(initial);
  let state = evaluate(layers, config.wavelengths, config.ns);
  let value = merit(state.R, config.target);
  let damping = 1e-3;
  let attempts = 0;
  let stationary = false;
  for (; attempts < maximumIterations && layers.length; attempts++) {
    const size = layers.length;
    const H = Array.from({ length: size }, () => new Array(size).fill(0));
    const gradient = new Array(size).fill(0);
    for (let q = 0; q < config.wavelengths.length; q++) {
      const residual = state.R[q] - config.target[q];
      for (let i = 0; i < size; i++) {
        gradient[i] += state.jacobian[q][i] * residual / config.wavelengths.length;
        for (let j = 0; j <= i; j++) H[i][j] += state.jacobian[q][i] * state.jacobian[q][j] / config.wavelengths.length;
      }
    }
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < i; j++) H[j][i] = H[i][j];
      H[i][i] += damping * Math.max(H[i][i], 1e-10) + 1e-16;
    }
    const thickness = layers.map(layer => layer.d);
    const next = constrainedStep(H, gradient, thickness, layers.map(layer => layer.n), config.maxOpticalThickness);
    if (!next) { damping = Math.min(1e12, damping * 10); continue; }
    const delta = next.map((value, i) => value - thickness[i]);
    if (Math.sqrt(dot(delta, delta)) < 1e-7) { stationary = true; break; }
    const trial = layers.map((layer, i) => ({ ...layer, d: next[i] }));
    if (opticalThickness(trial) > config.maxOpticalThickness + 1e-6) throw new Error('The constrained LM solver exceeded the optical-thickness bound.');
    const trialState = evaluate(trial, config.wavelengths, config.ns);
    const trialValue = merit(trialState.R, config.target);
    if (Number.isFinite(trialValue) && trialValue < value) {
      const improvement = value - trialValue;
      layers = trial;
      state = trialState;
      value = trialValue;
      damping = Math.max(1e-9, damping * 0.35);
      yield { layers: clone(layers), R: state.R.slice(), merit: value, iteration: attempts + 1, damping };
      if (improvement < 1e-10 * Math.max(value, 1e-8)) { stationary = true; attempts++; break; }
    } else {
      damping *= 8;
      if (damping > 1e12) { stationary = true; attempts++; break; }
    }
  }
  return { layers, R: state.R, merit: value, iterations: attempts, stationary };
}

/** Synchronous refinement utility, also used in deterministic tests. */
export function refine(layers, input, options = {}) {
  const config = problemConfig(input);
  const iterator = refinementSteps(layers, config, options.maxIterations ?? config.maxRefinementIterations);
  let item;
  do { item = iterator.next(); } while (!item.done);
  return item.value;
}

function designKey(layers) {
  return layers.map(layer => `${layer.material}:${Math.round(layer.d * 100)}`).join('|');
}

/** Find the next higher 1-D merit minimum in each layer, keeping others fixed. */
export function growthCandidates(layers, input, visited = new Set()) {
  const config = problemConfig(input);
  const minimumWavelength = Math.min(...config.wavelengths);
  const maximumWavelength = Math.max(...config.wavelengths);
  const remaining = Math.max(0, config.maxOpticalThickness - opticalThickness(layers));
  const candidates = [];
  for (let j = 0; j < layers.length; j++) {
    const layer = layers[j];
    const maximum = Math.min(remaining, config.maxGrowthOptical ?? 2 * maximumWavelength) / layer.n;
    const step = minimumWavelength / (32 * layer.n);
    if (maximum < step * 0.1) continue;
    const at = distance => {
      const trial = layers.map((item, i) => ({ ...item, d: item.d + (i === j ? distance : 0) }));
      const state = evaluate(trial, config.wavelengths, config.ns);
      const derivative = 2 * state.R.reduce((sum, R, q) => sum + (R - config.target[q]) * state.jacobian[q][j], 0) / state.R.length;
      return { derivative, merit: merit(state.R, config.target), R: state.R, layers: trial };
    };
    let previousDistance = Math.min(step * 0.05, maximum);
    let previous = at(previousDistance);
    const count = Math.ceil(maximum / step);
    for (let k = 1; k <= count; k++) {
      const distance = Math.min(k * step, maximum);
      const current = at(distance);
      if (previous.derivative < 0 && current.derivative >= 0) {
        let low = previousDistance;
        let high = distance;
        for (let iteration = 0; iteration < 30 && high - low > 1e-5; iteration++) {
          const mid = (low + high) / 2;
          if (at(mid).derivative < 0) low = mid;
          else high = mid;
        }
        const delta = (low + high) / 2;
        const result = at(delta);
        if (!visited.has(designKey(result.layers))) {
          candidates.push({ ...result, layerIndex: j, from: layer.d, to: layer.d + delta, deltaOptical: delta * layer.n });
          break; // The nearest unvisited higher local minimum for this layer.
        }
      }
      previous = current;
      previousDistance = distance;
    }
  }
  candidates.sort((a, b) => a.merit - b.merit);
  return candidates;
}

export function feasibleNeedle(layers, needle, input) {
  const config = problemConfig(input);
  const parentValue = merit(evaluate(layers, config.wavelengths, config.ns, { jacobian: false }).R, config.target);
  const structuralCandidates = needle.candidates.filter(candidate => {
    const host = layers[candidate.layerIndex];
    const atTop = candidate.position < 1e-8;
    const atBottom = host.d - candidate.position < 1e-8;
    // At an existing interface, replacing host by its neighbor merely shifts
    // that interface. LM already owns this direction; it is not a new layer.
    if (atTop && layers[candidate.layerIndex - 1]?.material === candidate.material) return false;
    if (atBottom && layers[candidate.layerIndex + 1]?.material === candidate.material) return false;
    return true;
  });
  for (const candidate of structuralCandidates.slice(0, config.maxNeedleCandidates)) {
    if (candidate.value >= -1e-11) continue;
    const host = layers[candidate.layerIndex];
    const boundary = candidate.position < 1e-8 || host.d - candidate.position < 1e-8;
    let width = Math.min(6, host.d * 0.2, Math.min(...config.wavelengths) / (32 * candidate.n));
    if (!boundary) width = Math.min(width, 2 * Math.min(candidate.position, host.d - candidate.position));
    if (candidate.n > host.n) width = Math.min(width, Math.max(0, config.maxOpticalThickness - opticalThickness(layers)) / (candidate.n - host.n));
    for (let attempt = 0; attempt < 18 && width >= 1e-6; attempt++, width /= 2) {
      const trial = normalizeLayers(insertNeedle(layers, candidate, width, `n-${config.needleId}`));
      // A maximal symmetric width may consume a host remnant and merge into
      // its neighbor. A smaller width can still create a valid new structure.
      if (trial.length <= layers.length) continue;
      if (trial.length > config.maxLayers || opticalThickness(trial) > config.maxOpticalThickness + 1e-7) break;
      const R = evaluate(trial, config.wavelengths, config.ns, { jacobian: false }).R;
      const value = merit(R, config.target);
      const significantDecrease = Math.max(EPS_MERIT, 1e-8 * parentValue);
      if (value < parentValue - significantDecrease && value <= parentValue + 1e-4 * width * candidate.value) {
        return { layers: trial, R, merit: value, candidate, width };
      }
    }
  }
  return null;
}

/**
 * Bounded gradual evolution: full refinement/needle cycles followed by a finite
 * one-layer increase to a higher local minimum. Growth is exploratory and may
 * worsen MSE; the best feasible design is archived separately and returned.
 */
export async function* synthesize(input) {
  const config = problemConfig(input);
  if (!['L', 'H'].includes(config.startMaterial)) throw new Error('The starting layer must be L or H.');
  if (!(config.startThickness > 0) || !Number.isFinite(config.startThickness)) throw new Error('Starting thickness must be positive.');
  const startN = config.startMaterial === 'L' ? config.nL : config.nH;
  if (startN * config.startThickness > config.maxOpticalThickness) throw new Error('The starting layer exceeds the maximum optical thickness.');
  let layers = [{ id: 'start', material: config.startMaterial, n: startN, d: config.startThickness }];
  let R = evaluate(layers, config.wavelengths, config.ns).R;
  let value = merit(R, config.target);
  let best = { layers: clone(layers), R: R.slice(), merit: value };
  let iteration = 0;
  let cycle = 0;
  let needleId = 0;
  let reason = 'Evolution cycle budget reached.';
  const visitedGrowth = new Set();
  const updateBest = () => {
    if (value < best.merit) best = { layers: clone(layers), R: R.slice(), merit: value };
  };
  const frame = (stage, message, extra = {}) => ({
    stage, message, layers: clone(layers), R: R.slice(), merit: value,
    bestMerit: best.merit, iteration, cycle, opticalThickness: opticalThickness(layers), ...extra,
  });
  yield frame('initial', 'A single starting layer on a semi-infinite BK7 substrate.');
  outer: for (cycle = 1; cycle <= config.maxCycles; cycle++) {
    let refinement = refinementSteps(layers, config);
    let item = refinement.next();
    const iterationStart = iteration;
    while (!item.done) {
      ({ layers, R } = item.value); value = item.value.merit;
      iteration = iterationStart + item.value.iteration;
      updateBest();
      yield frame('refinement', 'Levenberg–Marquardt refines thicknesses using the analytic spectral Jacobian.');
      item = refinement.next();
    }
    ({ layers, R } = item.value); value = item.value.merit;
    iteration = iterationStart + item.value.iterations;
    const normalized = normalizeLayers(layers);
    if (normalized.length) layers = normalized;
    updateBest();
    if (value <= config.targetMerit) { reason = 'Target MSE reached on the specified spectral grid.'; break; }
    for (let needleStep = 0; needleStep < config.maxNeedlesPerCycle; needleStep++) {
      const needle = scanNeedles(layers, config);
      yield frame('needle-scan', 'Analytic replacement-needle derivative; negative values indicate improving infinitesimal variations.', { needle });
      const insertion = feasibleNeedle(layers, needle, { ...config, needleId: ++needleId });
      if (!insertion) break;
      ({ layers, R } = insertion); value = insertion.merit;
      updateBest();
      yield frame('needle-insertion', 'A finite replacement needle passes the Armijo decrease test.', {
        needle: { ...needle, best: insertion.candidate, width: insertion.width, insertedWidth: insertion.width },
      });
      refinement = refinementSteps(layers, config);
      item = refinement.next();
      const needleIterationStart = iteration;
      while (!item.done) {
        ({ layers, R } = item.value); value = item.value.merit;
        iteration = needleIterationStart + item.value.iteration;
        updateBest();
        yield frame('refinement', 'The inserted layer and its neighbors relax together with constrained LM.');
        item = refinement.next();
      }
      ({ layers, R } = item.value); value = item.value.merit;
      iteration = needleIterationStart + item.value.iterations;
      const normalizedNeedle = normalizeLayers(layers);
      if (normalizedNeedle.length) layers = normalizedNeedle;
      updateBest();
      if (value <= config.targetMerit) { reason = 'Target MSE reached on the specified spectral grid.'; break outer; }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (cycle === config.maxCycles) break;
    const candidates = growthCandidates(layers, config, visitedGrowth);
    if (!candidates.length) {
      reason = opticalThickness(layers) >= config.maxOpticalThickness - 1e-5
        ? 'Optical-thickness limit reached; returning the best feasible design.'
        : 'No unvisited higher thickness minimum within the growth-search and optical-thickness limits.';
      break;
    }
    const growth = candidates[0];
    const fromMerit = value;
    ({ layers, R } = growth); value = growth.merit;
    visitedGrowth.add(designKey(layers));
    updateBest();
    yield frame('growth', 'Gradual evolution moves one layer to its next higher local thickness minimum; MSE may temporarily rise.', {
      growth: { layerIndex: growth.layerIndex, from: growth.from, to: growth.to, deltaOptical: growth.deltaOptical,
        fromMerit, toMerit: value, testedLayers: candidates.length },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  cycle = Math.min(cycle, config.maxCycles);
  layers = clone(best.layers); R = best.R.slice(); value = best.merit;
  const cleanupTrial = normalizeLayers(layers.filter(layer => layer.d >= config.cleanupThickness));
  let cleanupAccepted = false;
  let cleanupMessage = 'No layers are below the cleanup threshold.';
  if (cleanupTrial.length !== layers.length) {
    const cleaned = refine(cleanupTrial, config, { maxIterations: 100 });
    iteration += cleaned.iterations;
    if (cleaned.merit <= value + EPS_MERIT) {
      ({ layers, R } = cleaned); value = cleaned.merit;
      cleanupAccepted = true;
      updateBest();
      cleanupMessage = 'Sub-threshold layers were removed and the cleaned structure was reoptimized.';
    } else cleanupMessage = 'Removing thin layers worsened the merit; the best feasible design was retained.';
  }
  yield frame('cleanup', cleanupMessage, { cleanupAccepted, cleanupThickness: config.cleanupThickness });
  yield frame('final', 'Checking final constrained thickness optimization of the best retained design.');
  const finalRefinement = refinementSteps(layers, config, 120);
  let finalItem = finalRefinement.next();
  const finalIterationStart = iteration;
  while (!finalItem.done) {
    ({ layers, R } = finalItem.value); value = finalItem.value.merit;
    iteration = finalIterationStart + finalItem.value.iteration;
    updateBest();
    yield frame('final', 'Final constrained thickness optimization of the best retained design.');
    finalItem = finalRefinement.next();
  }
  ({ layers, R } = finalItem.value); value = finalItem.value.merit;
  iteration = finalIterationStart + finalItem.value.iterations;
  layers = normalizeLayers(layers);
  R = evaluate(layers, config.wavelengths, config.ns, { jacobian: false }).R;
  value = merit(R, config.target);
  updateBest();
  if (value <= config.targetMerit) reason = 'Target MSE reached on the specified spectral grid.';
  yield frame('done', reason, { done: true, reason, targetReached: value <= config.targetMerit,
    limits: { layers: config.maxLayers, opticalThickness: config.maxOpticalThickness },
    search: { maxCycles: config.maxCycles, maxGrowthOptical: config.maxGrowthOptical ?? 2 * Math.max(...config.wavelengths), maxNeedleCandidates: config.maxNeedleCandidates },
  });
}
