/**
 * Normal-incidence, lossless characteristic-matrix optics.
 * Layers are ordered from air to the semi-infinite substrate. All lengths: nm.
 * A matrix is stored as [a,b,c,d] representing [[a, i b], [i c, d]].
 * The representation is closed under multiplication for real refractive indices.
 */
const TAU = 2 * Math.PI;
const IDENTITY = [1, 0, 0, 1];

export function multiply(A, B) {
  return [
    A[0] * B[0] - A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[3] * B[3] - A[2] * B[1],
  ];
}

export function layerMatrix(n, d, wavelength) {
  const phase = TAU * n * d / wavelength;
  const sine = Math.sin(phase);
  return [Math.cos(phase), sine / n, n * sine, Math.cos(phase)];
}

function generator(n, wavelength) {
  const k = TAU / wavelength;
  return [0, k, k * n * n, 0];
}

function response(M, ns) {
  const nr = M[0] - ns * M[3];
  const ni = ns * M[1] - M[2];
  const dr = M[0] + ns * M[3];
  const di = ns * M[1] + M[2];
  const denominator = dr * dr + di * di;
  return { R: (nr * nr + ni * ni) / denominator, T: 4 * ns / denominator,
    nr, ni, dr, di, denominator };
}

function responseDerivative(K, state, ns) {
  const dnr = K[0] - ns * K[3];
  const dni = ns * K[1] - K[2];
  const ddr = K[0] + ns * K[3];
  const ddi = ns * K[1] + K[2];
  return 2 * (state.nr * dnr + state.ni * dni
    - state.R * (state.dr * ddr + state.di * ddi)) / state.denominator;
}

function matrixState(layers, wavelength, ns) {
  const matrices = layers.map(layer => layerMatrix(layer.n, layer.d, wavelength));
  const prefix = [IDENTITY];
  for (let j = 0; j < layers.length; j++) prefix.push(multiply(prefix[j], matrices[j]));
  const suffix = new Array(layers.length + 1);
  suffix[layers.length] = IDENTITY;
  for (let j = layers.length - 1; j >= 0; j--) suffix[j] = multiply(matrices[j], suffix[j + 1]);
  return { matrices, prefix, suffix, ...response(prefix[layers.length], ns), wavelength };
}

/** Energy reflectance/transmittance and analytic dR[point]/dd[layer]. */
export function evaluate(layers, wavelengths, ns = 1.52, options = {}) {
  const R = [];
  const T = [];
  const jacobian = [];
  for (const wavelength of wavelengths) {
    const state = matrixState(layers, wavelength, ns);
    R.push(state.R);
    T.push(state.T);
    if (options.jacobian !== false) {
      jacobian.push(layers.map((layer, j) => {
        const derivative = multiply(generator(layer.n, wavelength), state.matrices[j]);
        return responseDerivative(multiply(multiply(state.prefix[j], derivative), state.suffix[j + 1]), state, ns);
      }));
    }
  }
  return { R, T, jacobian };
}

export function opticalThickness(layers) {
  return layers.reduce((sum, layer) => sum + layer.n * layer.d, 0);
}

export function geometricThickness(layers) {
  return layers.reduce((sum, layer) => sum + layer.d, 0);
}

/** Unweighted mean squared error in fractional energy reflectance, not percent. */
export function merit(R, target) {
  if (R.length !== target.length || !R.length) throw new Error('Spectrum and target must have the same nonzero length.');
  return R.reduce((sum, value, i) => sum + (value - target[i]) ** 2, 0) / R.length;
}

function needleScore(layers, states, target, ns, layerIndex, position, needleN) {
  const host = layers[layerIndex];
  let score = 0;
  for (let q = 0; q < states.length; q++) {
    const state = states[q];
    const left = multiply(state.prefix[layerIndex], layerMatrix(host.n, position, state.wavelength));
    const right = multiply(layerMatrix(host.n, host.d - position, state.wavelength), state.suffix[layerIndex + 1]);
    // Replacement geometry: G_needle - G_host, not additive insertion G_needle.
    const difference = [0, 0, TAU / state.wavelength * (needleN ** 2 - host.n ** 2), 0];
    const derivative = responseDerivative(multiply(multiply(left, difference), right), state, ns);
    score += 2 * (state.R - target[q]) * derivative;
  }
  return score / states.length;
}

/** Analytic first derivative d(MSE)/d(needle width), holding physical total fixed. */
export function needleDerivative(layers, wavelengths, target, ns, layerIndex, position, needleN) {
  if (!layers[layerIndex] || position < 0 || position > layers[layerIndex].d) throw new Error('Needle position is outside its host layer.');
  const states = wavelengths.map(wavelength => matrixState(layers, wavelength, ns));
  return needleScore(layers, states, target, ns, layerIndex, position, needleN);
}

/**
 * Scan the alternate material in every layer on a phase-limited grid, then refine
 * every sampled local minimum. Returned coordinates are measured from air.
 * Boundary samples retain their host, so both one-sided interface variations
 * remain represented. Negative derivatives indicate a local improving direction.
 */
export function scanNeedles(layers, config) {
  const { wavelengths, target, ns = 1.52, nL, nH } = config;
  const minimumWavelength = Math.min(...wavelengths);
  const states = wavelengths.map(wavelength => matrixState(layers, wavelength, ns));
  const samples = [];
  const candidates = [];
  let offset = 0;
  for (let j = 0; j < layers.length; j++) {
    const host = layers[j];
    const material = host.material === 'L' ? 'H' : 'L';
    const n = material === 'L' ? nL : nH;
    const count = Math.max(8, Math.ceil(host.d * 32 * host.n / minimumWavelength));
    const local = [];
    const score = position => needleScore(layers, states, target, ns, j, position, n);
    const sample = position => ({ x: offset + position, position, value: score(position), material, n, layerIndex: j });
    for (let k = 0; k <= count; k++) {
      const value = sample(host.d * k / count);
      local.push(value);
      samples.push(value);
    }
    candidates.push(local[0], local[local.length - 1]);
    for (let k = 1; k < local.length - 1; k++) {
      if (local[k].value <= local[k - 1].value && local[k].value < local[k + 1].value) {
        let a = local[k - 1].position;
        let b = local[k + 1].position;
        const ratio = (Math.sqrt(5) - 1) / 2;
        let c = b - ratio * (b - a);
        let d = a + ratio * (b - a);
        let fc = score(c);
        let fd = score(d);
        for (let step = 0; step < 24 && b - a > 1e-5; step++) {
          if (fc < fd) { b = d; d = c; fd = fc; c = b - ratio * (b - a); fc = score(c); }
          else { a = c; c = d; fc = fd; d = a + ratio * (b - a); fd = score(d); }
        }
        candidates.push(sample((a + b) / 2));
      }
    }
    offset += host.d;
  }
  candidates.sort((a, b) => a.value - b.value);
  return { samples, candidates, best: candidates[0] || null, geometry: 'replacement', units: 'MSE/nm' };
}

/** Replace a symmetric host interval (one-sided at a layer boundary). */
export function insertNeedle(layers, candidate, width, id = 'needle') {
  const host = layers[candidate.layerIndex];
  if (!(width > 0 && width <= host.d)) throw new Error('Needle width must fit inside the host layer.');
  const start = Math.max(0, Math.min(host.d - width, candidate.position - width / 2));
  const replacement = [];
  if (start > 1e-12) replacement.push({ ...host, d: start });
  replacement.push({ id, material: candidate.material, n: candidate.n, d: width });
  if (host.d - start - width > 1e-12) replacement.push({ ...host, id: `${host.id}-split-${id}`, d: host.d - start - width });
  return [...layers.slice(0, candidate.layerIndex), ...replacement, ...layers.slice(candidate.layerIndex + 1)].map(layer => ({ ...layer }));
}

/** Exact algebraic normalization: remove zero layers and merge equal neighbors. */
export function normalizeLayers(layers, zeroTolerance = 1e-10) {
  const result = [];
  for (const layer of layers) {
    if (layer.d <= zeroTolerance) continue;
    const last = result[result.length - 1];
    if (last && last.material === layer.material && last.n === layer.n) last.d += layer.d;
    else result.push({ ...layer });
  }
  return result;
}
