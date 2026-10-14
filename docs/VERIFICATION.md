# MS Astra 2.1 — verification evidence

Run `npm test` (Node 20+). All checks are automated in `tests/`.

## Numerical engine (`tests/optics.test.js`)

| Check | Reference | Result |
|---|---|---|
| Bare substrate, single quarter‑wave MgF₂ layer | Fresnel closed forms | error < 1e‑15 |
| (HL)⁵H quarter‑wave stack at λ₀ | analytic peak reflectance | error < 1e‑14 |
| 30 random stacks, 1–25 layers, 23 wavelengths | independent 2×2 characteristic‑matrix code (Furman–Tikhonravov eq. 1.2.9–1.2.14) | agreement < 1e‑12, 0 ≤ R ≤ 1 |
| ∂F/∂d_j and ∂R_l/∂d_j (adjoint, analytic) | central finite differences, h = 1e‑4 nm | relative error < 1e‑8 |
| needle derivative g(z) at three interior points | finite‑width merit change, η = 0.001 nm | relative error < 2e‑3 (second‑order term) |
| Furman–Tikhonravov Fig. 2.5 — 8‑layer AR, 14.1/26.4/8.1/6.7/104.1/9.7/16.9/95.3 nm | book: AR coating for the visible | R < 0.36 % over 420–680 nm |
| Furman–Tikhonravov Fig. 2.2 — 6‑layer AR, 6S .318H .34L 1.977H .106L .375H 1.099L (λ₀ = 500 nm) | book: AR for 400–900 nm | R < 1.2 % over 420–860 nm |
| Specification §13 reference example (4 → 6 layers) | printed thicknesses, F₄, F₆, five needle minima, finite‑width table, alternative branch | reproduced (see METHOD.md §10) |
| insertNeedle, cleanThinLayers | geometry rules (9.2), optical‑thickness‑preserving removal | exact |

## Synthesis driver (`tests/synthesis.test.js`)

* Anti‑reflection 400–700 nm, TiO₂/MgF₂ on BK7, start 100 nm TiO₂: reaches
  F ≤ 1e‑6 within 12 layers and 1500 nm optical thickness; every accepted
  needle width lowers F before refinement; no layer below the cleanup
  threshold; materials alternate; reported F equals an independent
  re‑evaluation.
* Mirror 95 % 450–650 nm, Ta₂O₅/SiO₂, limits 16 layers / 2600 nm: limits
  respected, growth steps occur, final design is the best archived.
* `growthSearch` returns a true local minimum in the thickness of the chosen
  layer beyond a merit rise.
* Candidate comparison (v2.1): from the refined four‑layer parent of the
  specification, the three refined alternatives give F = 1.759968e‑4,
  4.174423e‑5 and 4.174423e‑5 as printed in §13.4; the second candidate by g
  wins and the resulting six‑layer design equals eq. (13.7) of the
  specification to 2e‑3 nm with F = 4.174423e‑5.
* Transition zones: points within half the zone width of a jump get zero
  weight (595, 600, 605 nm for a 20 nm zone on an 81‑point 400–800 nm grid);
  weights stay normalised; the dense grid carries the same exclusion.
* Dense‑grid check: on a 5‑point grid over 400–800 nm the synthesis "reaches"
  F ≤ 1e‑4 with a design whose dense‑grid merit exceeds 1e‑4 (aliasing);
  with the check enabled the grid is enriched automatically and the final
  design satisfies the target on the dense grid as well.
* Multi‑start: ten starting designs are generated for the mirror problem, the
  ranking is monotone, the winner respects the limits and is never worse than
  the manual start.
* Constrained LM keeps `d ≥ 0` and honours the optical‑thickness bound.

## Excel export (`tests/xlsx.test.js`)

The ZIP container is parsed entry by entry, CRC‑32 of every part is verified,
and the sheet XML is checked for numeric and inline‑string cells. The
workbook was also opened with Microsoft‑compatible readers (openpyxl) during
development.

## Interface

Checked in headless Chromium at 1440×900 (light and dark), 1280×720 and
820 px width: synthesis of the default mirror preset completes in Instant
mode with no console errors; Live mode animates refinement, needle scan,
candidate comparison, insertion, growth and cleanup; the edge filter with a
20 nm transition zone reaches the target; multi‑start exploration runs in a
background worker and replays the winner, with ghost spectra of the explored
starts and hover highlighting; the final needle check annotates the chart with
the verdict and the refined ΔF of the best candidates; the event log folds to
the last five events; Excel download (with Verification and Starts sheets)
works; layer and starts tables open.
