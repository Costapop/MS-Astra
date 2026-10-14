/**
 * Constrained Levenberg–Marquardt refinement of layer thicknesses.
 *
 * Minimises F(d) = Σ_l ν_l (R_l(d) − R̃_l)² with the analytic Jacobian
 * ∂R_l/∂d_j from optics.evaluate (doc §8.2, eq. 8.8–8.11):
 *     (JᵀJ + μ·diag(JᵀJ)) Δd = −Jᵀe,    e_l = √ν_l (R_l − R̃_l)
 * subject to d_j ≥ 0 (active‑set projection) and, optionally,
 * Σ n_j d_j ≤ TOTmax (step backtracking). Damping follows Nielsen's
 * gain‑ratio update.
 *
 * `refine` is a generator: it yields a frame after every accepted step so the
 * interface can animate the evolution, and returns the final design.
 */
import { evaluate, totalOpticalThickness } from './optics.js';

function cholSolve(A, b, n) {
  // A: symmetric positive definite (Float64Array n*n), b: Float64Array n. In-place Cholesky.
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (s <= 0) return null;
        L[i * n + i] = Math.sqrt(s);
      } else L[i * n + j] = s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

export function* refine(layersIn, problem, options = {}) {
  const { wavelengths, target, weights, ns, na = 1 } = problem;
  const maxIter = options.maxIter ?? 300;
  const relTol = options.relTol ?? 1e-12;
  const stepTol = options.stepTol ?? 1e-7;
  const yieldEvery = options.yieldEvery ?? 1;

  let layers = layersIn.map((L) => ({ ...L }));
  // optical-thickness bound: never exceed the limit, and never get worse if the start is already above it
  const totMax = Math.max(options.totMax ?? Infinity, totalOpticalThickness(layers));
  const N = layers.length, Lc = wavelengths.length;
  const sq = Float64Array.from(weights, Math.sqrt);

  let cur = evaluate(layers, wavelengths, target, weights, ns, na);
  let mu = 1e-3, nu = 2;
  let stall = 0, iter = 0, accepted = 0;
  let reason = 'max iterations';

  const JtJ = new Float64Array(N * N), Jte = new Float64Array(N);
  const free = new Int32Array(N);

  for (iter = 0; iter < maxIter; iter++) {
    // Assemble normal equations on the free set.
    // Active set: thickness at zero and the gradient pushes it negative.
    let nf = 0;
    for (let j = 0; j < N; j++) if (!(layers[j].d <= 0 && cur.grad[j] > 0)) free[nf++] = j;
    if (nf === 0) { reason = 'all variables at bounds'; break; }
    JtJ.fill(0); Jte.fill(0);
    for (let l = 0; l < Lc; l++) {
      const e = sq[l] * (cur.R[l] - target[l]);
      const row = l * N;
      for (let a = 0; a < nf; a++) {
        const ja = free[a];
        const Ja = sq[l] * cur.J[row + ja];
        Jte[a] += Ja * e;
        for (let b = 0; b <= a; b++) JtJ[a * nf + b] += Ja * sq[l] * cur.J[row + free[b]];
      }
    }
    for (let a = 0; a < nf; a++) for (let b = a + 1; b < nf; b++) JtJ[a * nf + b] = JtJ[b * nf + a];
    // projected gradient norm (stationarity test)
    let gmax = 0;
    for (let a = 0; a < nf; a++) gmax = Math.max(gmax, Math.abs(2 * Jte[a]));
    if (gmax < 1e-16) { reason = 'stationary'; break; }

    let improved = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const A = new Float64Array(nf * nf);
      for (let a = 0; a < nf; a++) for (let b = 0; b < nf; b++) {
        A[a * nf + b] = JtJ[a * nf + b];
      }
      for (let a = 0; a < nf; a++) A[a * nf + a] += mu * Math.max(JtJ[a * nf + a], 1e-30);
      const rhs = new Float64Array(nf);
      for (let a = 0; a < nf; a++) rhs[a] = -Jte[a];
      const step = cholSolve(A, rhs, nf);
      if (!step) { mu *= nu; nu *= 2; continue; }
      // projected trial point
      const trial = layers.map((L) => ({ ...L }));
      let smax = 0;
      for (let a = 0; a < nf; a++) {
        const j = free[a];
        trial[j].d = Math.max(0, layers[j].d + step[a]);
        smax = Math.max(smax, Math.abs(trial[j].d - layers[j].d));
      }
      // total optical thickness bound: backtrack along the step if violated
      if (Number.isFinite(totMax) && totalOpticalThickness(trial) > totMax) {
        let t = 1;
        for (let bt = 0; bt < 30 && totalOpticalThickness(trial) > totMax; bt++) {
          t *= 0.5;
          for (let a = 0; a < nf; a++) { const j = free[a]; trial[j].d = Math.max(0, layers[j].d + t * step[a]); }
        }
        if (totalOpticalThickness(trial) > totMax) { mu *= nu; nu *= 2; continue; }
      }
      const next = evaluate(trial, wavelengths, target, weights, ns, na);
      // predicted reduction for the gain ratio (Nielsen)
      let pred = 0;
      for (let a = 0; a < nf; a++) {
        const j = free[a];
        const s = trial[j].d - layers[j].d;
        pred += s * (mu * Math.max(JtJ[a * nf + a], 1e-30) * s - Jte[a]);
      }
      const actual = cur.F - next.F;
      const rho = pred > 0 ? actual / pred : (actual > 0 ? 1 : -1);
      if (actual > 0) {
        const rel = actual / Math.max(cur.F, 1e-300);
        layers = trial; cur = next; accepted++;
        mu *= Math.max(1 / 3, 1 - Math.pow(2 * rho - 1, 3)); nu = 2;
        improved = true;
        if (accepted % yieldEvery === 0) yield { layers: layers.map((L) => ({ ...L })), R: cur.R, F: cur.F, iter, mu };
        if (rel < relTol || smax < stepTol) { stall++; } else stall = 0;
        break;
      }
      mu *= nu; nu *= 2;
      if (mu > 1e16) break;
    }
    if (!improved) { reason = 'no descent step'; break; }
    if (stall >= 3) { reason = 'converged'; break; }
  }
  return { layers, R: cur.R, F: cur.F, grad: cur.grad, iterations: iter, accepted, reason };
}

/** Convenience: run refine to completion without frames. */
export function refineToEnd(layers, problem, options) {
  const it = refine(layers, problem, { ...options, yieldEvery: 1e9 });
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
