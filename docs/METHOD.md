# MS Astra 2.3 — mathematical method

This document records the exact formulas implemented in `src/optics.js`,
`src/refine.js` and `src/synthesis.js`. The formalism follows
Sh. A. Furman and A. V. Tikhonravov, *Basics of Optics of Multilayer Systems*
(§1.2, §1.4, §2.2) as laid out in the specification *Needle Optimization — метод
синтеза многослойных оптических покрытий*, v1.1 (2026); equation numbers in
parentheses refer to that specification. The gradual‑evolution cycle follows
A. Tikhonravov, *Optical Coatings: Design, Characterization, Monitoring*
(SPIE Press, 2024), §1.2.2–1.2.4 and Appendix 1.2.

## 1. Model and conventions

* A plane wave is incident from a transparent medium `n_a` (air, 1.00, or
  BK7, 1.52) at the angle `θ` (0 ≤ θ ≤ 89.9°, measured in that medium) onto
  a semi‑infinite substrate `n_s` (BK7, 1.52) coated with isotropic,
  homogeneous, lossless, non‑dispersive layers with constant real refractive
  indices; all lengths in nanometres.
* Layer `j = 1` is adjacent to the substrate and layer `j = N` faces the
  incident medium (2.1). The same order is used in the layer table and in
  the Excel export.
* Wave number `k = 2π/λ`. Oblique incidence is described by the tangential
  parameter `α = n_a sin θ`, the same in every medium (Snell's law, book eq.
  1.1.10–1.1.11), the normal component `β_j = √(n_j² − α²) = n_j cos γ_j`
  (book eq. 1.2.3; imaginary in an evanescent layer, `α > n_j`), the phase
  thickness `φ_j = k β_j d_j` (book 1.2.7; spec 2.6) and the **polarization
  admittances** (book Table 1.1; spec 2.6)

  ```
  s:  q_j = β_j = n_j cos γ_j          p:  q_j = n_j² / β_j = n_j / cos γ_j
  ```

  for the layers, the substrate `q_s` and the incident medium `q_a`. At
  normal incidence `α = 0`, `β_j = n_j`, `q_j = n_j` for both polarizations and
  everything below reduces to the book's normal‑incidence formulas.
* Branch of the square root: `Re β ≥ 0, Im β ≤ 0` (spec 2.4) — a decaying
  transmitted wave. For a finite layer the sign is immaterial (the layer
  matrix is even in `β_j`); the substrate branch decides the direction of
  decay when `α > n_s` (total internal reflection at the substrate, `R ≡ 1`,
  which the interface rejects as a task).

## 2. Forward problem — admittance recursion

With `A(0, λ) = q_s`, the admittance at the top of layer `j` is
(5.1–5.2, generalized in 6.10–6.11 by `n_j → q_j`, `k n_j x → k β_j x`)

```
c_j(x)  = cos(k β_j x) + i (A_{j−1}/q_j) sin(k β_j x)
A_j     = ( i q_j sin φ_j + A_{j−1} cos φ_j ) / c_j(d_j)
```

and the amplitude and energy reflectance are (4.2, 2.10–2.11; book 1.2.19)

```
r = (q_a − A_N) / (q_a + A_N),      R = |r|².
```

An evanescent layer has `φ_j = i t`, `q_j = i Q_j` with real `t = k|β_j|d_j`
and `Q_j`; then `cos φ = cosh t`, `sin φ = i sinh t`, and the same real
formulas hold with the sign of the `q_j sin φ_j` term reversed — the code
stays in real (re, im) arithmetic. Both polarizations are evaluated with
their own `q` tables; at normal incidence only one is computed.

The recursion is exact for homogeneous layers; no spatial integration is
needed. `tests/optics.test.js` compares it with an independent 2×2
characteristic‑matrix implementation (book eq. 1.2.9–1.2.14 with complex
`q_j`, `φ_j`) on random stacks at normal incidence and at 15–89.9° from air
and 30–89° from BK7, including evanescent MgF₂/SiO₂ layers (agreement
1e‑11, and `R + T = 1` for the lossless reference), with the Fresnel
formulas for a bare substrate at oblique incidence (book 1.1.3), the
Brewster angle (`R_p = 0` at `tan θ = n_s/n_a`) and closed‑form cases at
normal incidence (bare substrate, quarter‑wave layer, (HL)⁵H stack).

### 2a. Target characteristic (v2.3)

The target bands apply to one of (book 1.1.24–1.1.25; spec 3.4):

| characteristic | merit | use |
|---|---|---|
| `Rs` | `Σ ν_l (Rs_l − R̃_l)²` | s‑polarized light |
| `Rp` | `Σ ν_l (Rp_l − R̃_l)²` | p‑polarized light |
| `Rs & Rp` | `½ Σ ν_l [(Rs_l − R̃_l)² + (Rp_l − R̃_l)²]` | both polarizations to the same target (polarization‑insensitive design) |
| `(Rs + Rp)/2` | `Σ ν_l (R̄_l − R̃_l)²`, `R̄ = (Rs + Rp)/2` | unpolarized light |

For `Rs & Rp` the least‑squares problem has `2L` residual rows (one per
wavelength and polarization, each with weight `ν_l/2`); for the unpolarized
mean the residual is formed from the physical quantity `R̄` first and
differentiated afterwards (`δR̄ = ½(δRs + δRp)`), as the specification
requires. The chart draws the characteristic as the main curve and the
polarizations as thin lines; the dense‑grid check, the needle derivative and
the export use the same definition.

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

Inside every medium the admittance obeys `A' = i k (b_j − a_j A²)` with the
generator coefficients (spec 6.1–6.3)

```
s:  a_j = 1,            b_j = n_j² − α²
p:  a_j = 1 − α²/n_j²,  b_j = n_j²
```

(both `a = 1`, `b = n²` at normal incidence). Terminal condition of the
conjugate function per polarization (4.9, generalized in 6.5) and backward
recursion (5.3):

```
Ψ_N = (2 ν_l w_P / q_a) e_l r* (1 + r)²,       Ψ_{j−1} = Ψ_j / c_j(d_j)²
```

where `e_l` is the residual of the characteristic (`R_P − R̃` for a single
polarization and for `Rs & Rp`, `R̄ − R̃` for the unpolarized mean) and
`w_P = 1` for a single polarization, `½` when both enter. Inside a layer
(5.4, 6.12): `Ψ(z_{j−1}+x) = Ψ_j [c_j(x)/c_j(d_j)]²`. The product `Ψ·δA` is
constant above a perturbation (4.11, 6.14), which yields:

* **Thickness derivatives** (6.13):
  `∂F/∂d_j = Σ_P Σ_l k_l Im{ Ψ_{P,l}(z_j) (b_j − a_j A_{P,l}(z_j)²) }`.
* **Per‑wavelength Jacobian** used by Levenberg–Marquardt, obtained from the
  same recursion with `Φ_N = 1`, `Φ_{j−1} = Φ_j / c_j²`:
  `∂R_P,l/∂d_j = (k_l/q_a) Im{ r* (1+r)² Φ_j (b_j − a_j A_j²) }`; the Jacobian
  of the characteristic combines the polarizations with the weights `w_P`.
* **Needle derivative** (4.12–4.14, generalized in 6.6): the derivative of
  `F` with respect to the width of an infinitely thin layer of material `m`
  inserted at `z` inside host material `h` is

  ```
  g_m(z) = Σ_P Σ_l k_l Im{ Ψ_{P,l}(z) [Δb − Δa A_{P,l}(z)²] },   Δa = a_m − a_h,  Δb = b_m − b_h.
  ```

  For s‑polarization `Δa = 0` and `Δb = n_m² − n_h²`, so the book's form
  `g = P(z)(n_m² − n_h²)` with `P(z) = Σ_l k_l Im Ψ_l(z)` is recovered; for
  p‑polarization `Δa = α²(n_m² − n_h²)/(n_m² n_h²)` and the derivative
  depends on the local admittance `A(z)` (spec 6.8–6.9) — the sign of `P(z)`
  alone no longer decides.

All derivatives are analytic. `tests/optics.test.js` checks the gradient,
the Jacobian and the weighted residual rows against central finite
differences at normal incidence (relative error < 1e‑8) and at 30–72° from
air and BK7 for `Rs`, `Rp`, `Rs & Rp` and the unpolarized mean (< 1e‑7), and
the needle derivative against the finite‑width merit change (η = 0.001 nm at
normal incidence, 0.0005 nm at oblique incidence, including an evanescent
host layer).

## 5. Thickness refinement — constrained Levenberg–Marquardt

Residuals `e_l = √ν_l (R_l − R̃_l)` and Jacobian `J_lj = √ν_l ∂R_l/∂d_j`
(for `Rs & Rp`: `2L` rows with `√(ν_l/2)`) give the normal equations (8.10)

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
   candidates (a new layer at the substrate and at the incident‑medium side,
   §9.1).
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
(at oblique incidence a quarter wave is `λ_c / (4 n_j cos γ_j)`, so the
stack is tuned to the angle)
in a background worker with a time budget per start; the designs are ranked
by `max(F, F_dense)` and the winner's evolution is replayed on the dashboard
(the synthesis is deterministic, so the replay reproduces the result).

## 9. Termination and result

The run records a structured stop cause and composes the reported reason
from facts, never from the state of the reported design alone:

* **target** — `F ≤ F_target` on the optimization grid and on the dense grid,
  re‑verified on the final design after cleanup and final refinement;
* **tot** — the design at termination has `Σ n_j d_j ≥ TOT_max` (growth is
  impossible);
* **stagnation** — three cycles without a 10⁻⁴ relative improvement; the
  text names why the last needle cycle ended (layer limit blocks insertion,
  needle‑stationary design, or no candidate lowers F after refinement) and
  whether growth was capped by the optical‑thickness limit;
* **budget** — time budget (multi‑start exploration) or an explicit work
  budget used to replay a budget‑limited run deterministically;
* **cycles** — cycle budget exhausted.

When the layer limit leaves room for a boundary needle but not for an
interior one, the recorded cause is the layer limit ("blocks needles inside
the layers and the admissible boundary needles do not lower the merit"),
never a plain "no needle lowers the merit": the search was restricted, and
the final needle check reports whether a blocked insertion would still help.

The reported design is the design at termination unless the archive holds a
feasible design that is better by more than 0.1 % in `F` (gradual evolution
is non‑monotonic, so the best design is often from an earlier cycle). In
that case the reason says so explicitly and quotes both designs
("reported design is the best archived one (cycle k, F = …); the design at
termination had F = …, N layers, … nm"), so a limit named in the reason always
refers to the design that hit it. The method does not guarantee a global
minimum; the result is the outcome of a bounded local search from the chosen
starting design.

### 9a. Plain‑language summary (v2.2.2)

Besides the reason sentence, the engine composes `stop.summary` from the
same recorded facts: a **headline** naming the decisive cause (Target merit
reached · Layer limit reached · Optical‑thickness limit reached · Needle
variations no longer reduce the merit · No further progress · Time budget
exhausted · Cycle budget exhausted), a **detail** sentence, the state of
every stopping condition — target merit, layer limit, optical‑thickness
limit, needle variations (from the final needle check), thickness growth —
each marked as holding or not, with the decisive one flagged, and a
**reported‑design** sentence (design at termination, or the best archived
design with the terminal one quoted). Two more self‑checks guard it: the
decisive condition must actually hold, and the headline must describe the
same cause as the reason sentence. The interface shows the summary in the
Synthesis card in the same form for a single‑layer start and for the
replayed multi‑start winner; for the latter it adds why the design was
chosen (lowest score `max(F, F_dense)` among the explored starts, the
runner‑up and the margin, how many starts reached the target) and whether
the replay reproduced the explored result. The export writes the same rows
to the Summary sheet and ranks the Starts sheet by score.

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
