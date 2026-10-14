# MS Astra 2.0.0

A complete rewrite of both the numerical core and the interface.

**Numerical core.** The engine now implements the Furman–Tikhonravov admittance
formalism exactly as laid out in the method specification: exact per‑layer
admittance recursion, adjoint function Ψ with the analytic terminal condition,
analytic thickness Jacobian and analytic needle derivative
`g(z) = P(z)(n_m² − n_h²)`, constrained Levenberg–Marquardt refinement with
Nielsen damping, needle insertion with Armijo width control and
refine‑then‑accept, thorough‑search thickness growth (gradual evolution),
optical‑thickness‑preserving thin‑layer removal, and a final optimization.
The specification's worked example is reproduced to the printed digits
(thicknesses, F₄, F₆, all five needle minima, the finite‑width table and the
alternative branch), and the antireflection designs printed in Furman &
Tikhonravov (Fig. 2.2, Fig. 2.5) are reproduced as low‑reflectance designs.
See `docs/METHOD.md` and `docs/VERIFICATION.md`.

**Interface.** A new Apple‑style engineering dashboard in English: a large
reflectance chart where the piecewise‑constant target and the spectral range
are drawn by dragging (split/merge bands by double‑click, numeric editing in
the sidebar), a needle‑derivative chart with the chosen insertion animated, a
coating‑structure chart sharing the same position axis with animated growth,
insertion and cleanup, merit‑function history on a log scale, live stat tiles
and an event log. Four demonstration paces (Cinematic, Live, Fast, Instant),
Pause/Resume, single‑step mode, light and dark themes, and a layer table.

**Export.** Dependency‑free Excel workbook with Spectrum (target and
synthesized reflectance), Design (materials, indices, geometric and optical
thicknesses, positions) and Summary (all settings, termination reason and
statistics) sheets.

Open the application: https://costapop.github.io/MS-Astra/
