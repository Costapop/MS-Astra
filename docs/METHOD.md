# MS Astra 2.1 — mathematical method

This document records the exact formulas implemented in `src/optics.js`,
`src/refine.js` and `src/synthesis.js`. The formalism follows
Sh. A. Furman and A. V. Tikhonravov, *Basics of Optics of Multilayer Systems*
(§1.2, §1.4, §2.2) as laid out in the specification *Needle Optimization — метод
синтеза многослойных оптических покрытий*, v1.1 (2026); equation numbers in
parentheses refer to that specification. The gradual‑evolution cycle follows
A. Tikhonravov, *Optical Coatings: Design, Characterization, Monitoring*
(SPIE Press, 2024), §1.2.2–1.2.4 and Appendix 1.2.

## 1. Model and conventions

* Normal incidence from air, `n_a = 1`; semi‑infinite substrate `n_s`
  (BK7, 1.52); isotropic, homogeneous, lossless, non‑dispersive layers with
  constant real refractive indices; all lengths in nanometres.
* Layer `j = 1` is adjacent to the substrate and layer `j = N` faces the air
  (2.1). The same order is used in the layer table and in the Excel export.
* Wave number `k = 2π/λ`, phase thickness `φ_j = k n_j d_j` (2.6).

## 2. Forward problem — admittance recursion

With `A(0, λ) = n_s`, the admittance at the top of layer `j` is (5.1–5.2)

```
c_j(x)  = cos(k n_j x) + i (A_{j−1}/n_j) sin(k n_j x)
A_j     = ( i n_j sin φ_j + A_{j−1} cos φ_j ) / c_j(d_j)
```

and the amplitude and energy reflectance are (4.2, 2.11)

```
r = (n_a − A_N) / (n_a + A_N),      R = |r|².
```

The recursion is exact for homogeneous layers; no spatial integration is
needed. `tests/optics.test.js` compares it with an independent 2×2
characteristic‑matrix implementation on random stacks (agreement 1e‑12) and
with closed‑form cases (bare substrate, quarter‑wave layer, (HL)⁵H stack).

## 3. Merit function

```
F(d) = Σ_l ν_l (R_l − R̃_l)²,     ν_l = 1/L            (3.2)
```

`R̃` is the piecewise‑constant target sampled on a uniform grid of `L`
wavelengths. The interface shows `F` (mean square) and the equivalent RMS
deviation `100·√F` in percent.

**Transition zones (v2.1).** An ideal jump of the target cannot be matched by
any finite coating, and the points next to it would otherwise dominate `F`
(Furman–Tikhonravov §2.1 recommend small or zero weights there). With a
transition zone of width `w` every grid point with `|λ − λ_jump| < w/2` gets
`ν_l = 0`; the remaining weights are renormalised to sum to one. Zero‑weight
points are still displayed and exported.

## 4. Adjoint function and analytic derivatives

Terminal condition of the conjugate function (4.9) and backward recursion (5.3):

```
Ψ_N = (2ν_l / n_a) (R_l − R̃_l) r* (1 + r)²,       Ψ_{j−1} = Ψ_j / c_j(d_j)²
```

Inside a layer (5.4): `Ψ(z_{j−1}+x) = Ψ_j [c_j(x)/c_j(d_j)]²`. The product
`Ψ·δA` is constant above a perturbation (4.11), which yields:

* **Thickness derivatives** (6.13 with `a = 1`, `b = n²`):
  `∂F/∂d_j = Σ_l k_l Im{ Ψ_l(z_j) (n_j² − A_l(z_j)²) }`.
* **Per‑wavelength Jacobian** used by Levenberg–Marquardt, obtained from the
  same recursion with `Φ_N = 1`, `Φ_{j−1} = Φ_j / c_j²`:
  `∂R_l/∂d_j = (k_l/n_a) Im{ r* (1+r)² Φ_j (n_j² − A_j²) }`.
* **Needle derivative** (4.12–4.14): with `P(z) = Σ_l k_l Im Ψ_l(z)`, the
  derivative of `F` with respect to the width of an infinitely thin layer of
  material `m` inserted at `z` inside host material `h` is
  `g_m(z) = P(z) (n_m² − n_h²)`.

All derivatives are analytic. `tests/optics.test.js` checks the gradient and
the Jacobian against central finite differences (relative error < 1e‑8) and
the needle derivative against the finite‑width merit change (η = 0.001 nm).

## 5. Thickness refinement — constrained Levenberg–Marquardt

Residuals `e_l = √ν_l (R_l − R̃_l)` and Jacobian `J_lj = √ν_l ∂R_l/∂d_j` give
the normal equations (8.10)

```
(JᵀJ + μ·diag(JᵀJ)) Δd = −Jᵀe
```

solved by Cholesky factorisation on the free variables. Constraints:
`d_j ≥ 0` (active‑set: a variable at zero whose gradient points outward is
frozen for the step, the trial point is projected), and
`Σ n_j d_j ≤ TOT_max` (backtracking along the step). The damping `μ` follows
Nielsen's gain‑ratio update. A step is accepted only if `F` decreases.
Termination: relative decrease below 1e‑11 on three consecutive steps, a
vanishing projected gradient, or no admissible descent step.

## 6. Needle search and insertion

1. After refinement, `g(z)` is evaluated on a grid with
   `k_max n Δz ≤ π/16` (9.1) and at least 41 points per layer, for the
   opposite material in every layer, plus the two one‑sided boundary
   candidates (a new layer at the substrate and at the air side, §9.1).
2. Negative local minima are refined by golden‑section search and sorted by
   `g`; values below `10⁻⁶·max|g|` are treated as numerical zero.
3. For the `K_cand` most negative candidates (default 3; 0 = all admissible
   minima) the needle is inserted symmetrically around `z` (9.2) with initial
   width `η₀` (default 10 nm, as recommended in the book for the visible
   range), halved until the raw merit satisfies the Armijo condition
   `F(η) ≤ F + 10⁻⁴ η g` (9.7–9.8, RAW_ARMIJO policy) and the
   optical‑thickness limit.
4. **Candidate comparison (v2.1).** Every admissible candidate is refined
   independently and the design with the lowest refined merit replaces the
   parent, provided it is lower than the parent (REFINE_THEN_ACCEPT, 9.9;
   doc §13.4; Trubetskov 2020, deep search). The most negative `g` is not
   the best predictor of the refined result: on the reference example the
   first candidate by `g` gains 22 % while the second gains 81.5 %. Layers
   that shrink to zero are removed and equal neighbours merged (10.1).

The needle cycle repeats until no admissible negative candidate remains or no
candidate survives refinement.

## 7. Gradual evolution — deliberate thickness growth

When the needle cycle is stationary and the target merit is not reached, one
layer is thickened to the *nearest* local minimum of `Φ_j(s) = F(d + s e_j)`
for `s > 0` (12.4; Tikhonravov 2024, Fig. 1.17). All layers are scanned
("thorough search") and the layer whose minimum has the lowest merit is
chosen, subject to the optical‑thickness limit. The merit normally rises at
this step; the following refinement and needle cycle recover and improve it.

## 8. Thin‑layer cleanup and final optimization

Layers thinner than the threshold (default 1 nm) are removed: an inner thin
layer is replaced by host material of the same optical thickness and the
neighbours are merged (Tikhonravov 2024, §1.2.4, Fig. 1.19); an outer thin
layer is dropped. The design is then re‑refined. Cleanup runs inside every
cycle and once more before the final refinement.

## 8a. Independent dense‑grid check and grid enrichment (v2.1)

A low merit on a sparse grid can be an aliasing artefact: between the
optimization points the spectrum may oscillate freely (the number of
extrema grows with the number of layers; the book asks for 3–4 points per
oscillation). At the top of every cycle and at the end the design is
evaluated on an independent uniform grid of 2001 points plus both sides of
every target jump; one optimization‑grid step around each jump (or the wider
user transition zone) is excluded, because a discrete grid cannot resolve an
ideal edge better than its spacing. If `F_dense > 1.25·F`, or the target is
met on the grid but not on the dense grid, the optimization grid is enriched
with the dense points of largest error (up to 8 per cycle, each at least a
quarter of the grid spacing from existing points, up to `max(4L, 400)`
points; doc A.3 ENRICH_GRID), the design is re‑refined and the archive is
reset to the new merit definition. The target‑merit criterion requires both
`F ≤ F_target` and `F_dense ≤ F_target`.

## 8b. Multi‑start exploration (v2.1)

The total optical thickness of the starting design largely determines the
reachable merit (Tikhonravov 2024, Table 1.2; doc §13.5 obtains F = 1·10⁻⁷
from a 150 nm L start and 6·10⁻¹³ from a 200 nm H start on the same
problem). In multi‑start mode the manual single layer, single L and H layers
of 1, 2, 4 and 8 quarter‑waves at the band centre, and a quarter‑wave stack
(HL)ᴺH at the band centre within the limits are synthesized to completion
in a background worker with a time budget per start; the designs are ranked
by `max(F, F_dense)` and the winner's evolution is replayed on the dashboard
(the synthesis is deterministic, so the replay reproduces the result).

## 9. Termination and result

The run stops when `F ≤ F_target`, when no further needle can be inserted
within the layer limit and growth brings no progress for three cycles, when
the optical‑thickness limit is reached, or when the cycle budget is exhausted.
The best feasible design seen during the run (lowest `F` within both limits)
is retained, cleaned, refined once more and reported with the termination
reason. The method does not guarantee a global minimum; the result is the
outcome of a bounded local search from the chosen starting layer.

## 10. Reference example

`tests/optics.test.js` reproduces the worked example of the specification
(§13): `n_H = 2.30`, `n_L = 1.38`, `n_s = 1.52`, 77 wavelengths from 420 to
800 nm, target `R = 0.20`, start H/L/H/L = 74/103/131/88 nm.

| Quantity | Specification | MS Astra 2 |
|---|---|---|
| refined 4 layers, nm | 95.3778 / 65.2239 / 145.7781 / 105.6838 | identical to 1e‑4 |
| F₄ | 2.25678035e‑4 | 2.25678035e‑4 |
| best needle (L in layer 3) | x* = 117.2178, g = −3.913998e‑5 | 117.2178, −3.913999e‑5 |
| five negative minima | table §13.4 | all five reproduced |
| finite‑width check, η = 0.001…1 nm | −3.911465e‑8 … −1.393374e‑5 | identical |
| 6‑layer refined design | 94.2993/61.6430/116.6421/2.6146/28.3315/107.3616 | within 2e‑4 nm |
| F₆ | 1.75996773e‑4 | 1.75996773e‑4 |
| alternative candidate (row 2) | F = 4.174423e‑5 | 4.174423e‑5 |
| K ≥ 2 with comparison (eq. 13.7) | 95.7914/102.3440/31.4759/13.7106/113.4594/114.4973, F = 4.174423e‑5 | identical to 2e‑3 nm, F identical |
