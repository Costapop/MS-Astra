/**
 * MS Astra — optical core.
 *
 * Furman–Tikhonravov admittance formalism (Basics of Optics of Multilayer
 * Systems, §1.2, §1.4, §2.2) as specified in "Needle Optimization —
 * Метод синтеза многослойных оптических покрытий", v1.1, 2026.
 *
 * Model: normal incidence from air (n_a = 1), isotropic homogeneous lossless
 * non‑dispersive layers, semi‑infinite substrate. Lengths in nm.
 *
 * Layer order: j = 1 is adjacent to the substrate, j = N faces the ambient.
 * Every layer is { n: refractiveIndex, d: geometricThickness, m: materialKey }.
 *
 * Complex numbers are carried as (re, im) pairs in Float64Arrays to keep the
 * inner loops allocation‑free.
 */

const TAU = 2 * Math.PI;

/** Merit function:  F = Σ_l ν_l (R_l − R̃_l)²  with ν_l = 1/L  (mean square). */
export function meritWeights(count) {
  return new Float64Array(count).fill(1 / count);
}

/**
 * Forward problem for a single wavelength.
 * Returns admittances A_j at every interface (A_0 = n_s) and the layer
 * "denominators" c_j(d_j) = cos φ_j + i (A_{j−1}/n_j) sin φ_j  (doc eq. 5.1).
 *
 * state buffers (length N+1 / N) are reused by the caller.
 */
export function forwardAdmittance(layers, lambda, ns, out) {
  const N = layers.length;
  const k = TAU / lambda;
  const Are = out.Are, Aim = out.Aim, Cre = out.Cre, Cim = out.Cim;
  Are[0] = ns; Aim[0] = 0;
  for (let j = 0; j < N; j++) {
    const n = layers[j].n;
    const phi = k * n * layers[j].d;
    const s = Math.sin(phi), c = Math.cos(phi);
    const ar = Are[j], ai = Aim[j];
    // c_j = cos φ + i (A/n) sin φ
    const cr = c - ai * s / n;
    const ci = ar * s / n;
    // numerator = i n sin φ + A cos φ
    const nr = ar * c;
    const ni = n * s + ai * c;
    const den = cr * cr + ci * ci;
    Are[j + 1] = (nr * cr + ni * ci) / den;
    Aim[j + 1] = (ni * cr - nr * ci) / den;
    Cre[j] = cr; Cim[j] = ci;
  }
  return k;
}

export function makeState(N) {
  return {
    Are: new Float64Array(N + 1), Aim: new Float64Array(N + 1),
    Cre: new Float64Array(N), Cim: new Float64Array(N),
    Pre: new Float64Array(N + 1), Pim: new Float64Array(N + 1),
  };
}

/** Energy reflectance for all wavelengths (fractions, 0..1). */
export function reflectance(layers, wavelengths, ns, na = 1) {
  const N = layers.length;
  const st = makeState(N);
  const R = new Float64Array(wavelengths.length);
  for (let l = 0; l < wavelengths.length; l++) {
    forwardAdmittance(layers, wavelengths[l], ns, st);
    const ar = st.Are[N], ai = st.Aim[N];
    // r = (na − A)/(na + A)
    const nr = na - ar, ni = -ai, dr = na + ar, di = ai;
    R[l] = (nr * nr + ni * ni) / (dr * dr + di * di);
  }
  return R;
}

export function merit(R, target, weights) {
  let F = 0;
  for (let l = 0; l < R.length; l++) { const e = R[l] - target[l]; F += weights[l] * e * e; }
  return F;
}

export function totalOpticalThickness(layers) {
  let s = 0; for (const L of layers) s += L.n * L.d; return s;
}
export function totalThickness(layers) {
  let s = 0; for (const L of layers) s += L.d; return s;
}

/**
 * Full evaluation with analytic sensitivities.
 *
 * Returns:
 *   R[l]            reflectance on the grid
 *   F               merit value
 *   J[l*N + j]      ∂R_l/∂d_j   (analytic, adjoint form of doc eq. 6.13/8.x)
 *   grad[j]         ∂F/∂d_j
 *   adjoint         per‑wavelength arrays needed for the needle function:
 *                   A_j, c_j, Ψ_j at every interface (doc eq. 4.9, 5.3)
 *
 * Derivation (normal incidence, a = 1, b = n²):
 *   δA(z_j) = i k (n_j² − A_j²) δd_j,   Ψ·δA is constant above z_j,
 *   δF = −Σ_l Re{Ψ_l(D) δA_l(D)}  ⇒  ∂F/∂d_j = Σ_l k_l Im{Ψ_l(z_j)(n_j² − A_l(z_j)²)}
 * and per wavelength, with Φ_N = 1, Φ_{j−1} = Φ_j / c_j²:
 *   ∂R_l/∂d_j = (k/n_a) Im{ r* (1+r)² Φ_j (n_j² − A_j²) }.
 */
export function evaluate(layers, wavelengths, target, weights, ns, na = 1, wantAdjoint = false) {
  const N = layers.length, L = wavelengths.length;
  const st = makeState(N);
  const R = new Float64Array(L);
  const J = new Float64Array(L * N);
  const grad = new Float64Array(N);
  let F = 0;
  const adjoint = wantAdjoint ? {
    k: new Float64Array(L),
    Are: new Float64Array(L * (N + 1)), Aim: new Float64Array(L * (N + 1)),
    Cre: new Float64Array(L * N), Cim: new Float64Array(L * N),
    Pre: new Float64Array(L * (N + 1)), Pim: new Float64Array(L * (N + 1)),
  } : null;

  const Phr = new Float64Array(N + 1), Phi = new Float64Array(N + 1);
  for (let l = 0; l < L; l++) {
    const k = forwardAdmittance(layers, wavelengths[l], ns, st);
    const ar = st.Are[N], ai = st.Aim[N];
    const nr = na - ar, ni = -ai, dr = na + ar, di = ai;
    const dd = dr * dr + di * di;
    const rr = (nr * dr + ni * di) / dd, ri = (ni * dr - nr * di) / dd;   // r
    const Rl = rr * rr + ri * ri;
    R[l] = Rl;
    const e = Rl - target[l];
    F += weights[l] * e * e;
    // W = r* (1+r)²
    const pr = 1 + rr, pi = ri;
    const p2r = pr * pr - pi * pi, p2i = 2 * pr * pi;
    const Wr = rr * p2r + ri * p2i, Wi = rr * p2i - ri * p2r;
    // Φ_N = 1 ; Φ_{j-1} = Φ_j / c_j²
    Phr[N] = 1; Phi[N] = 0;
    for (let j = N - 1; j >= 0; j--) {
      const cr = st.Cre[j], ci = st.Cim[j];
      const c2r = cr * cr - ci * ci, c2i = 2 * cr * ci;
      const den = c2r * c2r + c2i * c2i;
      const fr = Phr[j + 1], fi = Phi[j + 1];
      Phr[j] = (fr * c2r + fi * c2i) / den;
      Phi[j] = (fi * c2r - fr * c2i) / den;
    }
    // J and gradient; Ψ_j = (2ν/na)(R − R̃) W Φ_j  (doc 4.9 with 5.3)
    const psiScale = 2 * weights[l] * e / na;
    for (let j = 0; j < N; j++) {
      const n = layers[j].n;
      const Ar = st.Are[j + 1], Ai = st.Aim[j + 1];
      // q = n² − A²
      const qr = n * n - (Ar * Ar - Ai * Ai), qi = -2 * Ar * Ai;
      // W Φ_j
      const wfr = Wr * Phr[j + 1] - Wi * Phi[j + 1];
      const wfi = Wr * Phi[j + 1] + Wi * Phr[j + 1];
      // Im{ WΦ q }
      const im = wfr * qi + wfi * qr;
      const dR = k / na * im;
      J[l * N + j] = dR;
      grad[j] += 2 * weights[l] * e * dR;
    }
    if (adjoint) {
      adjoint.k[l] = k;
      const o1 = l * (N + 1), o2 = l * N;
      for (let j = 0; j <= N; j++) {
        adjoint.Are[o1 + j] = st.Are[j]; adjoint.Aim[o1 + j] = st.Aim[j];
        const wfr = Wr * Phr[j] - Wi * Phi[j];
        const wfi = Wr * Phi[j] + Wi * Phr[j];
        adjoint.Pre[o1 + j] = psiScale * wfr; adjoint.Pim[o1 + j] = psiScale * wfi;
      }
      for (let j = 0; j < N; j++) { adjoint.Cre[o2 + j] = st.Cre[j]; adjoint.Cim[o2 + j] = st.Cim[j]; }
    }
  }
  return { R, F, J, grad, adjoint, N, L };
}

/**
 * P(z) = Σ_l k_l Im Ψ_l(z)  (doc eq. 4.12) evaluated at local coordinate x
 * inside layer j (0 ≤ x ≤ d_j), using Ψ(z_{j−1}+x) = Ψ_j [c_j(x)/c_j(d_j)]²
 * (doc eq. 5.4). Requires adjoint data from evaluate(..., true).
 */
export function needleP(layers, adjoint, j, x) {
  const N = layers.length, L = adjoint.k.length;
  const n = layers[j].n;
  let P = 0;
  for (let l = 0; l < L; l++) {
    const k = adjoint.k[l];
    const o1 = l * (N + 1), o2 = l * N;
    const phi = k * n * x;
    const s = Math.sin(phi), c = Math.cos(phi);
    const ar = adjoint.Are[o1 + j], ai = adjoint.Aim[o1 + j];      // A_{j-1}
    const cxr = c - ai * s / n, cxi = ar * s / n;                   // c_j(x)
    const cdr = adjoint.Cre[o2 + j], cdi = adjoint.Cim[o2 + j];     // c_j(d_j)
    // ratio = c(x)/c(d)
    const den = cdr * cdr + cdi * cdi;
    const rr = (cxr * cdr + cxi * cdi) / den, ri = (cxi * cdr - cxr * cdi) / den;
    const r2r = rr * rr - ri * ri, r2i = 2 * rr * ri;
    const pr = adjoint.Pre[o1 + j + 1], pi = adjoint.Pim[o1 + j + 1]; // Ψ_j (top of layer j)
    const im = pr * r2i + pi * r2r;
    P += k * im;
  }
  return P;
}

/**
 * Needle derivative for inserting material of index nm into layer j at
 * local coordinate x:  g = P(z)(n_m² − n_j²)   (doc eq. 4.14).
 */
export function needleDerivative(layers, adjoint, j, x, nm) {
  const n = layers[j].n;
  return needleP(layers, adjoint, j, x) * (nm * nm - n * n);
}

/**
 * Scan the whole coating: for every layer compute g(z) for the opposite
 * material on a grid fine enough for the shortest wavelength
 * (|k_max n Δz| ≤ π/16, doc eq. 9.1, and at least `minPoints` per layer).
 * Returns { z: [], g: [], layer: [], candidates: [...] } with z measured from
 * the substrate, plus the sorted list of negative local minima refined by
 * golden‑section search (doc §9.1).
 */
export function scanNeedles(layers, adjoint, wavelengths, otherIndex, options = {}) {
  const minPoints = options.minPoints ?? 41;
  const relTol = options.relTol ?? 1e-6;      // ignore |g| below this fraction of the scan maximum
  const absTol = options.absTol ?? 1e-14;     // and below this absolute value (nm⁻¹)
  const lambdaMin = Math.min(...wavelengths);
  const zs = [], gs = [], ls = [];
  const candidates = [];
  let z0 = 0, gAbsMax = 0;
  for (let j = 0; j < layers.length; j++) {
    const lay = layers[j];
    const nm = otherIndex(lay);
    const contrast = nm * nm - lay.n * lay.n;
    if (!(lay.d > 1e-9)) { const g = needleP(layers, adjoint, j, 0) * contrast; zs.push(z0); gs.push(g); ls.push(j); gAbsMax = Math.max(gAbsMax, Math.abs(g)); continue; }
    const dzMax = lambdaMin / (32 * lay.n);
    const count = Math.max(minPoints, Math.ceil(lay.d / dzMax) + 1);
    const local = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const x = lay.d * i / (count - 1);
      const g = needleP(layers, adjoint, j, x) * contrast;
      local[i] = g;
      gAbsMax = Math.max(gAbsMax, Math.abs(g));
      zs.push(z0 + x); gs.push(g); ls.push(j);
    }
    // interior local minima (strictly inside the layer)
    for (let i = 1; i < count - 1; i++) {
      if (local[i] < 0 && local[i] <= local[i - 1] && local[i] <= local[i + 1]) {
        // golden-section refinement on [x_{i-1}, x_{i+1}]
        let a = lay.d * (i - 1) / (count - 1), b = lay.d * (i + 1) / (count - 1);
        const f = (x) => needleP(layers, adjoint, j, x) * contrast;
        const gr = (Math.sqrt(5) - 1) / 2;
        let c = b - gr * (b - a), d = a + gr * (b - a);
        let fc = f(c), fd = f(d);
        for (let it = 0; it < 40 && (b - a) > 1e-7; it++) {
          if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
          else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
        }
        const x = (a + b) / 2, g = f(x);
        if (g < 0) candidates.push({ layer: j, x, z: z0 + x, g, nm, kind: 'interior' });
      }
    }
    z0 += lay.d;
  }
  // one-sided boundary candidates: a new layer at the substrate or at the
  // ambient side (doc §9.1). Inside the stack, boundary insertions are
  // equivalent to thickness shifts that refinement already explores.
  if (layers.length) {
    const first = layers[0], last = layers[layers.length - 1];
    const nmF = otherIndex(first);
    const gF = needleP(layers, adjoint, 0, 0) * (nmF * nmF - first.n * first.n);
    if (gF < 0) candidates.push({ layer: -1, x: 0, z: 0, g: gF, nm: nmF, kind: 'substrate' });
    const jl = layers.length - 1;
    const nmL = otherIndex(last);
    const gL = needleP(layers, adjoint, jl, last.d) * (nmL * nmL - last.n * last.n);
    if (gL < 0) candidates.push({ layer: layers.length, x: 0, z: z0, g: gL, nm: nmL, kind: 'ambient' });
  }
  const tol = Math.max(absTol, relTol * gAbsMax);
  const admissible = candidates.filter((c) => c.g < -tol);
  admissible.sort((p, q) => p.g - q.g);
  return { z: zs, g: gs, layer: ls, candidates: admissible, total: z0, gAbsMax };
}

/**
 * Insert a needle of width eta (nm) of material `mat` ({n, m}) according to
 * the candidate geometry (doc §9.2). Returns a new layer array; inserted
 * layer carries `inserted: true`.
 */
export function insertNeedle(layers, cand, eta, mat) {
  const out = [];
  if (cand.kind === 'substrate') {
    out.push({ n: mat.n, m: mat.m, d: eta, inserted: true });
    for (const L of layers) out.push({ ...L, inserted: false });
    return out;
  }
  if (cand.kind === 'ambient') {
    for (const L of layers) out.push({ ...L, inserted: false });
    out.push({ n: mat.n, m: mat.m, d: eta, inserted: true });
    return out;
  }
  for (let j = 0; j < layers.length; j++) {
    const L = layers[j];
    if (j !== cand.layer) { out.push({ ...L, inserted: false }); continue; }
    // symmetric split around x with total thickness preserved (eq. 9.2)
    const h = Math.min(eta / 2, cand.x, L.d - cand.x);
    const dLow = cand.x - h, dHigh = L.d - cand.x - h;
    out.push({ ...L, d: dLow, inserted: false });
    out.push({ n: mat.n, m: mat.m, d: 2 * h, inserted: true });
    out.push({ ...L, d: dHigh, inserted: false });
  }
  return out;
}

/**
 * Remove layers thinner than dMin and merge equal neighbours. A removed
 * inner layer is replaced by host material of the same optical thickness
 * (Tikhonravov, Optical Coatings, §1.2.4: the total optical thickness is kept).
 * Returns { layers, removed: count }.
 */
export function cleanThinLayers(layers, dMin) {
  let list = layers.map((L) => ({ ...L }));
  let removed = 0;
  for (;;) {
    // find thinnest layer below the threshold
    let idx = -1, best = dMin;
    for (let j = 0; j < list.length; j++) if (list[j].d < best) { best = list[j].d; idx = j; }
    if (idx < 0 || list.length <= 1) break;
    const thin = list[idx];
    removed++;
    if (idx === 0 || idx === list.length - 1) {
      list.splice(idx, 1);
    } else {
      const lower = list[idx - 1], upper = list[idx + 1];
      if (lower.m === upper.m) {
        const merged = { ...lower, d: lower.d + upper.d + thin.d * thin.n / lower.n };
        list.splice(idx - 1, 3, merged);
      } else {
        // neighbours of different materials: give the optical thickness to the lower one
        list.splice(idx, 1);
        list[idx - 1] = { ...lower, d: lower.d + thin.d * thin.n / lower.n };
      }
    }
    list = mergeEqualNeighbours(list);
  }
  return { layers: list, removed };
}

export function mergeEqualNeighbours(layers) {
  const out = [];
  for (const L of layers) {
    const prev = out[out.length - 1];
    if (prev && prev.m === L.m) prev.d += L.d; else out.push({ ...L });
  }
  return out;
}
