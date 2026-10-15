/**
 * MS Astra — optical core.
 *
 * Furman–Tikhonravov admittance formalism (Basics of Optics of Multilayer
 * Systems, §1.1–1.2, §1.4, §2.2) as specified in "Needle Optimization —
 * Метод синтеза многослойных оптических покрытий", v1.1, 2026 (§2, §5, §6).
 *
 * Model: plane wave incident from a transparent medium n_a at the angle θ
 * (0 ≤ θ < 90°), isotropic homogeneous lossless non‑dispersive layers,
 * semi‑infinite substrate n_s. Lengths in nm.
 *
 * Oblique incidence (book §1.2.1, Table 1.1; spec §6):
 *   α      = n_a sin θ                     tangential wave‑vector parameter, the same in every medium
 *   β_j    = √(n_j² − α²) = n_j cos γ_j     normal component (imaginary in an evanescent layer)
 *   φ_j    = k β_j d_j                      phase thickness, k = 2π/λ
 *   q_j    = β_j        (s‑polarization)    polarization admittance of medium j
 *   q_j    = n_j² / β_j (p‑polarization)
 *   A_0    = q_s,   r = (q_a − A_N)/(q_a + A_N),   R = |r|²
 * The admittance recursion keeps its form with n_j → q_j; derivatives use
 * the generator coefficients a_j, b_j of the admittance equation
 * A' = i k (b_j − a_j A²):  a = 1, b = n² − α² (s);  a = 1 − α²/n², b = n² (p).
 * At normal incidence both polarizations coincide with the book's n_j, n².
 *
 * Target characteristics: Rs, Rp, both (Rs and Rp each to the target) or the
 * unpolarized reflectance (Rs + Rp)/2 (book eq. 1.1.25; spec eq. 3.4).
 *
 * Layer order: j = 1 is adjacent to the substrate, j = N faces the ambient.
 * Every layer is { n: refractiveIndex, d: geometricThickness, m: materialKey }.
 *
 * Complex numbers are carried as (re, im) pairs in Float64Arrays to keep the
 * inner loops allocation‑free. A layer is either propagating (β real) or
 * evanescent (β imaginary): with cos φ, sin φ replaced by cosh t, sinh t and
 * q by its imaginary part the recursion stays in real arithmetic.
 */

const TAU = 2 * Math.PI;

/** Merit function:  F = Σ_l ν_l (R_l − R̃_l)²  with ν_l = 1/L  (mean square). */
export function meritWeights(count) {
  return new Float64Array(count).fill(1 / count);
}

/* ------------------------------------------------------------------ */
/*  Optical model: ambient, substrate, angle, polarization             */
/* ------------------------------------------------------------------ */
export const POLARIZATIONS = [
  { key: 's', label: 'Rs', title: 's‑polarization (E perpendicular to the plane of incidence)' },
  { key: 'p', label: 'Rp', title: 'p‑polarization (E in the plane of incidence)' },
  { key: 'both', label: 'Rs & Rp', title: 'both polarizations are driven to the target: F = ½⟨(Rs − R̃)² + (Rp − R̃)²⟩' },
  { key: 'avg', label: '(Rs + Rp)/2', title: 'unpolarized light: the mean reflectance (Rs + Rp)/2 is driven to the target' },
];
export function polarizationLabel(key) { return (POLARIZATIONS.find((p) => p.key === key) || POLARIZATIONS[3]).label; }

/**
 * Build the optical model. `pol` is 's', 'p', 'both' or 'avg' (unpolarized).
 * At normal incidence the two polarizations coincide and only one is computed.
 */
export function opticsModel({ ns, na = 1, angle = 0, pol = 'avg' } = {}) {
  if (!(ns > 0)) throw new Error('substrate index must be positive');
  const theta = Math.max(0, Math.min(89.999, Number(angle) || 0)) * Math.PI / 180;
  const alpha = na * Math.sin(theta), cosA = Math.cos(theta);
  const qa = { s: na * cosA, p: na / cosA };
  // substrate branch: Re β ≥ 0, Im β ≤ 0 (decaying transmitted wave, spec eq. 2.4)
  const es = ns * ns - alpha * alpha;
  const betaS = es >= 0 ? [Math.sqrt(es), 0] : [0, -Math.sqrt(-es)];
  const qs = { s: betaS, p: betaS[1] === 0 ? [ns * ns / betaS[0], 0] : [0, -ns * ns / betaS[1]] };   // n²/(i y) = −i n²/y
  const oblique = alpha !== 0;
  const polKey = ['s', 'p', 'both', 'avg'].includes(pol) ? pol : 'avg';
  const pols = !oblique ? [{ key: 's', w: 1 }]
    : polKey === 's' ? [{ key: 's', w: 1 }] : polKey === 'p' ? [{ key: 'p', w: 1 }] : [{ key: 's', w: 0.5 }, { key: 'p', w: 0.5 }];
  return { ns, na, angle: theta * 180 / Math.PI, pol: polKey, alpha, qa, qs, pols, oblique, separate: oblique && polKey === 'both', substrateTIR: es < 0 };
}

/** Accept a model, a substrate index (normal incidence from `na`) or a {ns, na, angle, pol} description. */
export function asModel(m, na) {
  if (m && typeof m === 'object' && m.pols) return m;
  if (typeof m === 'number') return opticsModel({ ns: m, na: na ?? 1 });
  if (m && typeof m === 'object') return opticsModel(m);
  throw new Error('optical model required');
}

/**
 * Polarization parameters of a material with index n (spec eq. 2.6, 6.3):
 * kind 0 propagating / 1 evanescent, β, q (its real part for kind 0, its
 * imaginary part for kind 1) and the generator coefficients a, b.
 */
export function polParams(n, model, polKey) {
  const al2 = model.alpha * model.alpha;
  let e2 = n * n - al2;
  if (Math.abs(e2) < 1e-14) e2 = 1e-14;          // exactly critical: treat as barely propagating
  const kind = e2 > 0 ? 0 : 1;
  const beta = al2 === 0 ? n : Math.sqrt(Math.abs(e2));   // |β|; β = beta (kind 0) or i·beta (kind 1); exactly n at normal incidence
  let q, a, b;
  if (polKey === 's') { q = beta; a = 1; b = e2; }                       // q = β; n²/β for kind 1: q = i·beta → Q = beta
  else { q = kind ? -n * n / beta : n * n / beta; a = 1 - al2 / (n * n); b = n * n; }   // q = n²/β; kind 1: n²/(i·beta) = −i n²/beta
  return { kind, beta, q, a, b };
}

/** Per‑layer parameter table for one polarization. */
function layerTable(layers, model, polKey) {
  const N = layers.length;
  const t = { kind: new Int8Array(N), beta: new Float64Array(N), q: new Float64Array(N), a: new Float64Array(N), b: new Float64Array(N), qa: model.qa[polKey], qs: model.qs[polKey], key: polKey };
  for (let j = 0; j < N; j++) { const p = polParams(layers[j].n, model, polKey); t.kind[j] = p.kind; t.beta[j] = p.beta; t.q[j] = p.q; t.a[j] = p.a; t.b[j] = p.b; }
  return t;
}

/**
 * One layer step at distance x from its lower boundary (spec eq. 6.10–6.11).
 * Writes c(x) = cos φ + i (A/q) sin φ and A(x) = (i q sin φ + A cos φ)/c(x)
 * into out[0..3] = cr, ci, Ar, Ai. For an evanescent layer φ = i t and
 * q = i Q, whence cos φ = cosh t, sin φ = i sinh t and the same real formulas
 * hold with the sign of the q·sin φ term reversed.
 */
function layerStep(k, x, tab, j, ar, ai, out) {
  const t = k * tab.beta[j] * x, Q = tab.q[j];
  let C, S, sign;
  if (tab.kind[j] === 0) { C = Math.cos(t); S = Math.sin(t); sign = 1; }
  else { C = Math.cosh(t); S = Math.sinh(t); sign = -1; }
  const cr = C - ai * S / Q;
  const ci = ar * S / Q;
  const nr = ar * C;
  const ni = sign * Q * S + ai * C;
  const den = cr * cr + ci * ci;
  out[0] = cr; out[1] = ci;
  out[2] = (nr * cr + ni * ci) / den;
  out[3] = (ni * cr - nr * ci) / den;
}

/**
 * Forward problem for a single wavelength and polarization table `tab`.
 * Returns admittances A_j at every interface (A_0 = q_s) and the layer
 * "denominators" c_j(d_j) (spec eq. 5.1, 6.10). Buffers are reused.
 */
export function forwardAdmittance(layers, lambda, tab, out) {
  const N = layers.length;
  const k = TAU / lambda;
  const Are = out.Are, Aim = out.Aim, Cre = out.Cre, Cim = out.Cim, tmp = out.tmp;
  Are[0] = tab.qs[0]; Aim[0] = tab.qs[1];
  for (let j = 0; j < N; j++) {
    layerStep(k, layers[j].d, tab, j, Are[j], Aim[j], tmp);
    Cre[j] = tmp[0]; Cim[j] = tmp[1]; Are[j + 1] = tmp[2]; Aim[j + 1] = tmp[3];
  }
  return k;
}

export function makeState(N) {
  return {
    Are: new Float64Array(N + 1), Aim: new Float64Array(N + 1),
    Cre: new Float64Array(N), Cim: new Float64Array(N),
    Pre: new Float64Array(N + 1), Pim: new Float64Array(N + 1),
    tmp: new Float64Array(4),
  };
}

/** Energy reflectance of one polarization table for all wavelengths. */
function reflectancePol(layers, wavelengths, tab, st) {
  const N = layers.length;
  const R = new Float64Array(wavelengths.length);
  const qa = tab.qa;
  for (let l = 0; l < wavelengths.length; l++) {
    forwardAdmittance(layers, wavelengths[l], tab, st);
    const ar = st.Are[N], ai = st.Aim[N];
    // r = (q_a − A)/(q_a + A)
    const nr = qa - ar, ni = -ai, dr = qa + ar, di = ai;
    R[l] = (nr * nr + ni * ni) / (dr * dr + di * di);
  }
  return R;
}

/**
 * Spectra of the design: { R, Rs, Rp } (fractions 0..1). R is the target
 * characteristic of the model (Rs, Rp or the mean (Rs+Rp)/2; for 'both' the
 * mean is returned for display). At normal incidence Rs = Rp = R.
 * `model` may be a model object, a substrate index (normal incidence from
 * `na`) or a {ns, na, angle, pol} description.
 */
export function spectra(layers, wavelengths, model, na) {
  const M = asModel(model, na);
  const st = makeState(layers.length);
  if (!M.oblique) { const R = reflectancePol(layers, wavelengths, layerTable(layers, M, 's'), st); return { R, Rs: R, Rp: R }; }
  const Rs = reflectancePol(layers, wavelengths, layerTable(layers, M, 's'), st);
  const Rp = reflectancePol(layers, wavelengths, layerTable(layers, M, 'p'), st);
  if (M.pol === 's') return { R: Rs, Rs, Rp };
  if (M.pol === 'p') return { R: Rp, Rs, Rp };
  const R = new Float64Array(wavelengths.length);
  for (let l = 0; l < R.length; l++) R[l] = 0.5 * (Rs[l] + Rp[l]);
  return { R, Rs, Rp };
}

/** Target characteristic for all wavelengths (fractions, 0..1). */
export function reflectance(layers, wavelengths, model, na = 1) {
  const M = asModel(model, na);
  const st = makeState(layers.length);
  if (M.pols.length === 1) return reflectancePol(layers, wavelengths, layerTable(layers, M, M.pols[0].key), st);
  const Rs = reflectancePol(layers, wavelengths, layerTable(layers, M, 's'), st);
  const Rp = reflectancePol(layers, wavelengths, layerTable(layers, M, 'p'), st);
  for (let l = 0; l < Rs.length; l++) Rs[l] = 0.5 * (Rs[l] + Rp[l]);
  return Rs;
}

export function merit(R, target, weights) {
  let F = 0;
  for (let l = 0; l < R.length; l++) { const e = R[l] - target[l]; F += weights[l] * e * e; }
  return F;
}

/**
 * Merit of a design for the model's characteristic: Σ ν (R − R̃)² for a single
 * polarization or the unpolarized mean, ½ Σ ν [(Rs − R̃)² + (Rp − R̃)²] for
 * 'both'. Also returns the largest weighted deviation and the spectra.
 */
export function assess(layers, wavelengths, target, weights, model, na) {
  const M = asModel(model, na);
  const sp = spectra(layers, wavelengths, M);
  let F = 0, maxDev = 0;
  if (M.separate) {
    for (let l = 0; l < wavelengths.length; l++) {
      const es = sp.Rs[l] - target[l], ep = sp.Rp[l] - target[l];
      F += 0.5 * weights[l] * (es * es + ep * ep);
      if (weights[l] > 0) maxDev = Math.max(maxDev, Math.abs(es), Math.abs(ep));
    }
  } else {
    for (let l = 0; l < wavelengths.length; l++) {
      const e = sp.R[l] - target[l];
      F += weights[l] * e * e;
      if (weights[l] > 0) maxDev = Math.max(maxDev, Math.abs(e));
    }
  }
  return { R: sp.R, Rs: sp.Rs, Rp: sp.Rp, F, maxDev };
}

export function meritOf(layers, wavelengths, target, weights, model, na) {
  const M = asModel(model, na);
  if (!M.separate) return merit(reflectance(layers, wavelengths, M), target, weights);
  return assess(layers, wavelengths, target, weights, M).F;
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
 * evaluate(layers, wavelengths, target, weights, model, wantAdjoint)
 * (the legacy form evaluate(layers, wl, target, weights, ns, na, wantAdjoint)
 * is accepted as well).
 *
 * Returns:
 *   R[l]            target characteristic on the grid (Rs, Rp or their mean)
 *   Rs, Rp          the polarizations that enter the characteristic (null otherwise;
 *                   at normal incidence only Rs is filled and equals R)
 *   F               merit value
 *   J[l*N + j]      ∂R_l/∂d_j of the characteristic (mean for 'both')
 *   grad[j]         ∂F/∂d_j
 *   resid[i], Jw    weighted residuals and Jacobian rows for least squares:
 *                   F = Σ resid², grad = 2 Jwᵀ resid; `rows` = L, or 2L for 'both'
 *   adjoint         per‑polarization arrays for the needle derivative:
 *                   A_j, c_j, Ψ_j at every interface (spec eq. 4.9, 5.3, 6.5)
 *
 * Derivation (spec §4–§6): the admittance obeys A' = i k (b_j − a_j A²), so
 *   δA(z_j) = i k (b_j − a_j A_j²) δd_j,   Ψ·δA is constant above z_j,
 *   δF = −Σ_l Re{Ψ_l(D) δA_l(D)}  ⇒  ∂F/∂d_j = Σ_l k_l Im{Ψ_l(z_j)(b_j − a_j A_l(z_j)²)}   (6.13)
 * and per wavelength and polarization, with Φ_N = 1, Φ_{j−1} = Φ_j / c_j²:
 *   ∂R_l/∂d_j = (k/q_a) Im{ r* (1+r)² Φ_j (b_j − a_j A_j²) }.
 * For the unpolarized mean δR̄ = ½(δRs + δRp); for 'both' each polarization
 * carries its own residual with weight ½.
 */
export function evaluate(layers, wavelengths, target, weights, model, naOrAdjoint, wantAdjointLegacy) {
  let wantAdjoint = false;
  if (typeof naOrAdjoint === 'boolean') wantAdjoint = naOrAdjoint;
  else wantAdjoint = !!wantAdjointLegacy;
  const M = asModel(model, typeof naOrAdjoint === 'number' ? naOrAdjoint : 1);
  const N = layers.length, L = wavelengths.length;
  const pols = M.pols.map((p) => ({ key: p.key, w: p.w, tab: layerTable(layers, M, p.key) }));
  const separate = M.separate;
  const rows = separate ? 2 * L : L;
  const st = makeState(N);
  const R = new Float64Array(L);
  const hasS = pols.some((p) => p.key === 's'), hasP = pols.some((p) => p.key === 'p');
  const Rs = hasS ? new Float64Array(L) : null, Rp = hasP ? new Float64Array(L) : null;   // null when that polarization is not part of the characteristic
  const J = new Float64Array(L * N);
  const Jw = new Float64Array(rows * N);
  const resid = new Float64Array(rows);
  const grad = new Float64Array(N);
  let F = 0;
  const adjoint = wantAdjoint ? {
    model: M, k: new Float64Array(L), N, L,
    pols: pols.map((p) => ({
      key: p.key, w: p.w, tab: p.tab,
      Are: new Float64Array(L * (N + 1)), Aim: new Float64Array(L * (N + 1)),
      Cre: new Float64Array(L * N), Cim: new Float64Array(L * N),
      Pre: new Float64Array(L * (N + 1)), Pim: new Float64Array(L * (N + 1)),
    })),
  } : null;

  const Phr = new Float64Array(N + 1), Phi = new Float64Array(N + 1);
  const dRall = new Float64Array(pols.length * N);   // ∂R_P/∂d_j of every polarization at the current wavelength
  const Wr = new Float64Array(pols.length), Wi = new Float64Array(pols.length);
  const RP = new Float64Array(pols.length);
  for (let l = 0; l < L; l++) {
    const k = TAU / wavelengths[l];
    // the characteristic needs every polarization before the errors are known: forward passes first
    for (let pi = 0; pi < pols.length; pi++) {
      const P = pols[pi], tab = P.tab, qa = tab.qa;
      forwardAdmittance(layers, wavelengths[l], tab, st);
      const ar = st.Are[N], ai = st.Aim[N];
      const nr = qa - ar, ni = -ai, dr = qa + ar, di = ai;
      const dd = dr * dr + di * di;
      const rr = (nr * dr + ni * di) / dd, ri = (ni * dr - nr * di) / dd;   // r
      const Rl = rr * rr + ri * ri;
      RP[pi] = Rl;
      // W = r* (1+r)²
      const pr = 1 + rr, pim = ri;
      const p2r = pr * pr - pim * pim, p2i = 2 * pr * pim;
      const wr = rr * p2r + ri * p2i, wi = rr * p2i - ri * p2r;
      Wr[pi] = wr; Wi[pi] = wi;
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
      const off = pi * N;
      for (let j = 0; j < N; j++) {
        const Ar = st.Are[j + 1], Ai = st.Aim[j + 1];
        // q = b − a A²
        const a = tab.a[j], b = tab.b[j];
        const qr = b - a * (Ar * Ar - Ai * Ai), qi = -2 * a * Ar * Ai;
        // W Φ_j
        const wfr = wr * Phr[j + 1] - wi * Phi[j + 1];
        const wfi = wr * Phi[j + 1] + wi * Phr[j + 1];
        // Im{ WΦ q }
        dRall[off + j] = k / qa * (wfr * qi + wfi * qr);
      }
      if (adjoint) {
        const A = adjoint.pols[pi];
        const o1 = l * (N + 1), o2 = l * N;
        for (let j = 0; j <= N; j++) {
          A.Are[o1 + j] = st.Are[j]; A.Aim[o1 + j] = st.Aim[j];
          // Φ_j stored for now; scaled to Ψ_j once the error is known
          A.Pre[o1 + j] = wr * Phr[j] - wi * Phi[j]; A.Pim[o1 + j] = wr * Phi[j] + wi * Phr[j];
        }
        for (let j = 0; j < N; j++) { A.Cre[o2 + j] = st.Cre[j]; A.Cim[o2 + j] = st.Cim[j]; }
      }
    }
    // characteristic, errors, merit
    const nu = weights[l];
    let Rchar;
    if (pols.length === 1) Rchar = RP[0];
    else Rchar = 0.5 * (RP[0] + RP[1]);
    R[l] = Rchar;
    for (let pi = 0; pi < pols.length; pi++) { if (pols[pi].key === 's') Rs[l] = RP[pi]; else Rp[l] = RP[pi]; }
    const eChar = Rchar - target[l];
    const sq = Math.sqrt(nu);
    if (!separate) {
      F += nu * eChar * eChar;
      resid[l] = sq * eChar;
      for (let j = 0; j < N; j++) {
        let s = 0; for (let pi = 0; pi < pols.length; pi++) s += pols[pi].w * dRall[pi * N + j];
        J[l * N + j] = s; Jw[l * N + j] = sq * s;
        grad[j] += 2 * nu * eChar * s;
      }
    } else {
      const sq2 = Math.sqrt(nu * 0.5);
      for (let pi = 0; pi < pols.length; pi++) {
        const e = RP[pi] - target[l];
        F += 0.5 * nu * e * e;
        resid[pi * L + l] = sq2 * e;
        for (let j = 0; j < N; j++) {
          const d = dRall[pi * N + j];
          Jw[(pi * L + l) * N + j] = sq2 * d;
          J[l * N + j] += 0.5 * d;
          grad[j] += nu * e * d;
        }
      }
    }
    if (adjoint) {
      adjoint.k[l] = k;
      const o1 = l * (N + 1);
      for (let pi = 0; pi < pols.length; pi++) {
        const A = adjoint.pols[pi];
        const e = separate ? RP[pi] - target[l] : eChar;
        // Ψ_j = (2 ν w e / q_a) W Φ_j   (spec eq. 6.5)
        const psiScale = 2 * nu * pols[pi].w * e / pols[pi].tab.qa;
        for (let j = 0; j <= N; j++) { A.Pre[o1 + j] *= psiScale; A.Pim[o1 + j] *= psiScale; }
      }
    }
  }
  return { R, Rs, Rp, F, J, Jw, resid, rows, grad, adjoint, N, L };
}

/**
 * Needle derivative for inserting material of index nm into layer j at the
 * local coordinate x (0 ≤ x ≤ d_j):
 *   g_m(z) = Σ_pol Σ_l k_l Im{ Ψ_l(z) [Δb − Δa A_l(z)²] },   Δa = a_m − a_j, Δb = b_m − b_j   (spec eq. 6.6)
 * with Ψ(z_{j−1}+x) = Ψ_j [c_j(x)/c_j(d_j)]² (eq. 5.4, 6.12). At normal
 * incidence Δa = 0 and the book's form g = P(z)(n_m² − n_j²) is recovered.
 * Requires adjoint data from evaluate(..., true).
 */
export function needleDerivative(layers, adjoint, j, x, nm) {
  const N = adjoint.N, L = adjoint.L, M = adjoint.model;
  const tmp = needleTmp;
  let g = 0;
  for (const P of adjoint.pols) {
    const tab = P.tab;
    const pm = polParams(nm, M, P.key);
    const da = pm.a - tab.a[j], db = pm.b - tab.b[j];
    if (da === 0 && db === 0) continue;
    for (let l = 0; l < L; l++) {
      const k = adjoint.k[l];
      const o1 = l * (N + 1), o2 = l * N;
      layerStep(k, x, tab, j, P.Are[o1 + j], P.Aim[o1 + j], tmp);      // c_j(x), A(x)
      const cxr = tmp[0], cxi = tmp[1];
      const cdr = P.Cre[o2 + j], cdi = P.Cim[o2 + j];                    // c_j(d_j)
      const den = cdr * cdr + cdi * cdi;
      const rr = (cxr * cdr + cxi * cdi) / den, ri = (cxi * cdr - cxr * cdi) / den;   // ratio = c(x)/c(d)
      const r2r = rr * rr - ri * ri, r2i = 2 * rr * ri;
      const pr = P.Pre[o1 + j + 1], pim = P.Pim[o1 + j + 1];              // Ψ_j (top of layer j)
      const psr = pr * r2r - pim * r2i, psi = pr * r2i + pim * r2r;        // Ψ(z)
      if (da === 0) { g += k * db * psi; continue; }
      const Ar = tmp[2], Ai = tmp[3];
      const tr = db - da * (Ar * Ar - Ai * Ai), ti = -2 * da * Ar * Ai;   // Δb − Δa A²
      g += k * (psr * ti + psi * tr);
    }
  }
  return g;
}
const needleTmp = new Float64Array(4);

/**
 * Scan the whole coating: for every layer compute g(z) for the opposite
 * material on a grid fine enough for the shortest wavelength
 * (|k_max n Δz| ≤ π/16, spec eq. 9.1, and at least `minPoints` per layer).
 * Returns { z: [], g: [], layer: [], candidates: [...] } with z measured from
 * the substrate, plus the sorted list of negative local minima refined by
 * golden‑section search (spec §9.1).
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
    if (!(lay.d > 1e-9)) { const g = needleDerivative(layers, adjoint, j, 0, nm); zs.push(z0); gs.push(g); ls.push(j); gAbsMax = Math.max(gAbsMax, Math.abs(g)); continue; }
    const dzMax = lambdaMin / (32 * lay.n);
    const count = Math.max(minPoints, Math.ceil(lay.d / dzMax) + 1);
    const local = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const x = lay.d * i / (count - 1);
      const g = needleDerivative(layers, adjoint, j, x, nm);
      local[i] = g;
      gAbsMax = Math.max(gAbsMax, Math.abs(g));
      zs.push(z0 + x); gs.push(g); ls.push(j);
    }
    // interior local minima (strictly inside the layer)
    for (let i = 1; i < count - 1; i++) {
      if (local[i] < 0 && local[i] <= local[i - 1] && local[i] <= local[i + 1]) {
        // golden-section refinement on [x_{i-1}, x_{i+1}]
        let a = lay.d * (i - 1) / (count - 1), b = lay.d * (i + 1) / (count - 1);
        const f = (x) => needleDerivative(layers, adjoint, j, x, nm);
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
  // ambient side (spec §9.1). Inside the stack, boundary insertions are
  // equivalent to thickness shifts that refinement already explores.
  if (layers.length) {
    const first = layers[0], last = layers[layers.length - 1];
    const nmF = otherIndex(first);
    const gF = needleDerivative(layers, adjoint, 0, 0, nmF);
    if (gF < 0) candidates.push({ layer: -1, x: 0, z: 0, g: gF, nm: nmF, kind: 'substrate' });
    const jl = layers.length - 1;
    const nmL = otherIndex(last);
    const gL = needleDerivative(layers, adjoint, jl, last.d, nmL);
    if (gL < 0) candidates.push({ layer: layers.length, x: 0, z: z0, g: gL, nm: nmL, kind: 'ambient' });
  }
  const tol = Math.max(absTol, relTol * gAbsMax);
  const admissible = candidates.filter((c) => c.g < -tol);
  admissible.sort((p, q) => p.g - q.g);
  return { z: zs, g: gs, layer: ls, candidates: admissible, total: z0, gAbsMax };
}

/**
 * Insert a needle of width eta (nm) of material `mat` ({n, m}) according to
 * the candidate geometry (spec §9.2). Returns a new layer array; inserted
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
