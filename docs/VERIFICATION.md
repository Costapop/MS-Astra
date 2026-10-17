# MS Astra — verification evidence

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
| **Oblique incidence (v2.3)**: bare substrate at 30–85° from air and 20–45° from BK7 | Fresnel formulas for Rs, Rp (book §1.1.3); Brewster angle | error < 1e‑15; R_p < 1e‑28 at tan θ = n_s |
| 42 random H/L (2.30/1.38) stacks at 15–89.9° from air and 30–89° from BK7 (evanescent low‑index layers in 12 of them) | independent complex Abelès‑matrix code with polarization admittances (book eq. 1.2.9–1.2.14, Table 1.1) | Rs, Rp agree < 1e‑11; the lossless reference gives R + T = 1 < 1e‑10; total internal reflection at the substrate gives R ≡ 1 |
| ∂F/∂d_j, ∂R_l/∂d_j and the weighted residual rows at 30–72° for Rs, Rp, Rs & Rp and (Rs+Rp)/2, from air and BK7 | central finite differences; F = Σ e², ∇F = 2 Jᵀe; the Rs & Rp merit ½Σν[(Rs−R̃)²+(Rp−R̃)²] | relative error < 1e‑7 |
| needle derivative at 35–70° for every characteristic, including an evanescent MgF₂ host at 70° from BK7 | finite‑width merit change, η = 0.0005 nm | relative error < 3e‑3 |
| needle scan + refinement at 45° (air, unpolarized), 45° and 70° from BK7 | every negative minimum of g(z) lowers F for a 0.001 nm needle; refinement lowers F; reported F equals an independent evaluation | holds |
| Rs & Rp with separate targets (Rs → 95 %, Rp → 2 %, zero‑weight points only in the Rp target) at 45° inside BK7 | F = ½(F_s + F_p) from the spectra; 42 residual rows with Σe² = F; central finite differences of ∇F; finite‑width needle check; a shared array equals the same target for both; maxDev honours each target's weights | relative errors < 1e‑7 (∇F), < 3e‑3 (needle); identities exact |

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
* Explored results (v2.6.0): every `explore-result` carries the complete
  `done` event of its start and its final needle scan; the ranking fields
  equal those of the event, the reported F equals an independent evaluation
  on the start's own (possibly enriched) grid, the dense check, termination
  summary, self‑check and statistics are present, the design is complete and
  within the limits, and the ranking is unchanged by the payload — so any
  explored result can be shown on the dashboard and exported as it was
  explored.
* Constrained LM keeps `d ≥ 0` and honours the optical‑thickness bound.
* Oblique incidence (v2.3): the *Cube splitter 45°* preset (unpolarized 50 %
  inside BK7) and *AR at 45°* (both polarizations) reach their targets within
  the limits with a verified termination summary; the reported F equals an
  independent assessment, the dense check carries Rs and Rp; at 45° inside
  glass the two polarizations split by more than 30 p.p. while the mean
  meets the target; the 45° AR keeps Rs and Rp individually below 2 %.
  Evanescent low‑index layers (AR task from BK7 at 75°) and the Rs‑only
  characteristic (air, 70°) run to a verified termination with finite
  thicknesses. Quarter‑wave starting designs are corrected for the angle.
  Separate Rs/Rp targets: the *Polarizer 45°* preset (TiO₂/MgF₂, 500–600 nm,
  inside BK7) reaches Rs ≥ 94 % and Rp ≤ 4 % with a verified termination,
  the dense check and the reported grid carry both targets, and on a 3‑point
  grid the enrichment adds points with both targets resampled consistently.
  `sampleDualTarget`/`denseGridDual`: each target keeps its own transition
  zones and normalised weights; the dense grid holds the jumps of both.
* Termination (v2.1.2–v2.2.2): for every preset (now including the two
  oblique ones, run at their angle, medium and characteristic) at its own target and at an
  unreachable one, the reason sentence is backed by the recorded facts, the
  built‑in self‑check passes, the plain‑language summary names a decisive
  condition that holds and agrees with the reason, every condition's wording
  agrees with its flag, and the reported‑design sentence matches the archive
  flag; a budget‑limited exploration result is replayed exactly; the
  multi‑start winner replays to the identical reason.
* Thin‑layer threshold (v2.3.2): the bounded refinement keeps every layer at
  or above `minThickness` and lifts a start below it (unit test); for every
  preset at thresholds 3 and 5 nm and ten random two‑band tasks at 2–6 nm
  (angles 0–60°, 8–32 layers), the reported design has no layer below the
  threshold, the self‑checks pass and the best‑design guarantee holds.
  Headless Chromium: Band reflector, Polarizer 45° and Edge filter at
  threshold 3 nm and target 1e‑9 report designs with minimum thickness
  5.0 / 18.3 / 19.7 nm; the layer table states the guarantee, and during a
  run marks the layers that the next cleanup will remove.
* Reported design (v2.3.1): for every preset at thin‑layer thresholds of 1
  and 6 nm, plus 21‑point grids with transition zones and threshold 3–6 nm
  (grid enrichment active), every design the run showed is re‑evaluated on
  the final grid: no complete design within the limits is better than the
  reported one; the reported design has no layer below the threshold; the
  built‑in self‑checks pass; the needle fact never reports an admissible
  improvement as "still possible" unless the run stopped by the target or by
  its budget; whenever a lower value was shown during the run the *Best
  design* sentence explains it (thin layer or coarser grid); final‑phase
  gains are reported with their before/after merits. Before this change the
  cube preset at threshold 6 nm reported F = 1.4·10⁻⁶ while a complete
  design with F = 3.7·10⁻⁹ had been seen (the archive held a thin‑layer
  design whose cleanup raised the merit); it now reports 3.7·10⁻⁹.

## Excel export (`tests/xlsx.test.js`)

The ZIP container is parsed entry by entry, CRC‑32 of every part is verified,
and the sheet XML is checked for numeric and inline‑string cells. At oblique
incidence the Spectrum and Verification sheets carry Rs and Rp columns and
the Summary sheet records the angle, the incident medium, α and the target
characteristic; with separate Rs/Rp targets both sheets list the two targets,
the two spectra, ΔRs/ΔRp and the per‑polarization weights; at normal
incidence the classic layout is unchanged. The
workbook was also opened with Microsoft‑compatible readers (openpyxl) during
development.

## Interface

Checked in headless Chromium at 1440×900 (light and dark), 1280×720 and
820 px width: synthesis of the default mirror preset completes in Instant
mode with no console errors; the *Cube splitter 45°* preset (BK7 incidence,
unpolarized) and *AR at 45°* complete in Instant mode, the angle and the
characteristic typed in the card header are mirrored on the Target tab and
vice versa (an out‑of‑range angle is clamped to 89.9°), the legend and the
tooltip show Rs and Rp, the structure chart labels the incident medium, an
80° task from BK7 with evanescent MgF₂ layers runs to a verified stop, the
sidebar and the header controls lock during a run, multi‑start exploration
at 45° runs in the worker and replays the winner, and the Excel download
carries the polarization columns; in the *Rs & Rp* mode (Polarizer 45°) the
Rp target is edited on its own table and by dragging its dashed level on the
chart, a double‑click splits the target whose level is nearest, the tooltip
lists both targets and both spectra with their errors, switching to
(Rs+Rp)/2 or to 0° hides the second target and switching back restores it,
the run reaches both targets and multi‑start draws Rs/Rp ghost pairs; Live mode animates refinement, needle scan,
candidate comparison, insertion, growth and cleanup; the edge filter with a
20 nm transition zone reaches the target; multi‑start exploration runs in a
background worker whose stages are streamed and animated on the charts
(dashed spectrum, structure, needle derivative), then replays the winner over
the ghost spectra of the explored starts with hover highlighting; the
Presets and Target tabs of the spectrum card edit the task; the elapsed‑time
counter runs through exploration and replay; the final needle check annotates the chart with
the verdict and the refined ΔF of the best candidates; the event log folds to
the last five events; the Synthesis card verdict (headline, stopping
conditions, why this design, reported design) agrees with the engine for
every preset and for multi‑start in Instant, Fast and Live paces, the
multi‑start replay matching the explored winner; Excel download (with
Verification and Starts sheets) works; layer and starts tables open.
v2.6.0: after a multi‑start exploration a click on any finished start (in the
Multi‑start list or through *Show* in the Ranking dialog) puts its explored
result on the dashboard — the design on the spectrum, the structure and the
Layer table, its grid and dense check, its final needle scan, its merit
history, the tiles and the verdict agree with the explored record; a click
during the winner's replay stops the replay cleanly; hovering other starts
restores the chosen design; Export Excel writes the chosen design and names it
in the Summary and the Starts sheet; Reset clears the selection; stacked
layout unaffected; no console errors (headless Chromium, 1440 × 900 and 900 px).
v2.6.1: the merit history legend reads *Replay* again right after Reset (it
stayed *Shown* until the next exploration had finished), and the Multi‑start
card label is read whole beside the Ranking button at 1100, 1280, 1440 and
1920 px («★ replayed», «▸ rank 10 of 10», «★ shown»), the full sentence in
its tooltip; the 2.6.0 flow above re‑run unchanged.
