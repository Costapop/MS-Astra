# MS Astra 2.3.0

Oblique incidence and polarization: design for any angle of incidence from
0 to 89.9°, for `Rs`, `Rp`, both at once or unpolarized light, from air or
from BK7.

- **Angle of incidence.** Set in the Reflectance spectrum card — in its
  header next to the y‑scale (visible with the chart) and on the *Target*
  tab under *Incidence* — from 0 to 89.9°, measured in the incident medium.
  The target bands are drawn on the chart and typed on the tab exactly as
  before; nothing else changes in the workflow. At an oblique angle the
  chart draws the target characteristic as the main curve and adds thin
  lines for `Rs` (solid) and `Rp` (dashed); the tooltip lists the
  characteristic, `Rs` and `Rp`; the legend names the characteristic.
- **Target characteristic.** `Rs`, `Rp`, `Rs & Rp` (both polarizations are
  driven to the same target, `F = ½⟨(Rs − R̃)² + (Rp − R̃)²⟩`) or
  `(Rs + Rp)/2` — the reflectance of unpolarized light (Furman–Tikhonravov
  eq. 1.1.25). At 0° all four coincide.
- **Incident medium.** A new *Incident medium* list in the sidebar
  (Materials): air (1.00) or BK7 (1.52), e.g. a cemented cube with the angle
  measured inside the glass. Low‑index layers that become evanescent at a
  large angle inside glass (frustrated total internal reflection) are
  computed exactly; total internal reflection at the substrate is rejected
  as a task. The structure chart labels the incident medium.
- **Engine.** The Furman–Tikhonravov admittance recursion is generalized
  with the polarization admittances `q = n cos γ` (s) and `n / cos γ` (p),
  the phase `k n cos γ d` and `A₀ = q_s`, `r = (q_a − A)/(q_a + A)`; the
  adjoint function, the analytic Jacobian and the needle derivative follow
  the specification's general form `A' = i k (b − a A²)`,
  `g = Σ k Im{Ψ [Δb − Δa A²]}` (spec §6), so the p‑polarized needle
  derivative depends on the local admittance and is no longer
  `P(z)·(n_m² − n_h²)`. The unpolarized mean is formed before the residual;
  `Rs & Rp` uses `2L` residual rows in Levenberg–Marquardt. Normal‑incidence
  results are unchanged (same arithmetic path; all previous tests pass).
  Quarter‑wave starting designs for multi‑start are tuned to the angle.
- **Presets.** *Cube splitter 45°* (unpolarized 50 % at 45° inside BK7 —
  the mean meets the target while `Rs` and `Rp` split widely, a reminder of
  why cubes polarize) and *AR at 45°* (both polarizations).
- **Export.** The Summary sheet records the angle, the incident medium,
  `α = n_a sin θ` and the characteristic; the Spectrum and Verification
  sheets add `Rs` and `Rp` columns at oblique incidence.
- Verification: 35 automated tests (new: Fresnel and Brewster at oblique
  incidence; an independent complex Abelès‑matrix reference at 15–89.9° from
  air and 30–89° from BK7 with evanescent layers and `R + T = 1`; finite
  differences for the gradient, the Jacobian and the residual rows of every
  characteristic; the needle derivative at oblique incidence including an
  evanescent host; needle scans and refinement at 45° and 70°; oblique
  synthesis of both presets, evanescent‑layer and `Rs`‑only runs; export
  columns; validation); headless‑browser check of the header and Target‑tab
  controls, the chart, the tooltip, an 80° task from BK7, multi‑start at 45°
  and the download. Details: docs/METHOD.md §1, §2, §2a, §4;
  docs/VERIFICATION.md.
