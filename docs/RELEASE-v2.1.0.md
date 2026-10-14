# MS Astra 2.1.0

Four improvements aimed at lower merit values and at making the merit itself
trustworthy.

**Candidate comparison (deep search).** At every needle step the most
negative admissible minima of the needle derivative (default 3, or all) are
inserted and refined independently; the best refined design replaces the
parent. The event log lists each alternative with its refined merit and
gain. On the reference example of the method specification (§13.4) this
selects the six‑layer minimum of eq. (13.7) with F = 4.174423·10⁻⁵ instead of
1.760·10⁻⁴ (81.5 % against 22 % gain).

**Multi‑start exploration.** A new starting‑design mode synthesizes ten
starting designs in a background worker — the manual single layer, L and H
layers of 1, 2, 4 and 8 quarter‑waves at the band centre, and a quarter‑wave
stack — with a time budget per start, ranks them and replays the winner on
the dashboard. The ranking is available in the Starts table and in the
Excel export.

**Transition zones.** An optional zone around every target jump gives the
spectral points inside it zero weight, so that an unmatchable ideal edge no
longer dominates the merit; the zone is shown hatched on the spectrum and the
excluded points are drawn hollow. The edge‑filter preset with a 20 nm zone
now reaches F ≤ 10⁻⁴.

**Dense‑grid check and grid enrichment.** Every cycle evaluates the design on
an independent grid of 2001 points; if the optimization grid under‑resolves
the spectrum (aliasing), points of largest error are added to it and the
design is re‑refined. The target is considered reached only when both grids
satisfy it. The reflectance curve on the dashboard is now drawn on a dense
display grid from the animated structure, and the Verification sheet of the
Excel export carries the dense‑grid comparison.

Tests: 21 automated checks, including the §13.4 comparison result, the
transition‑zone weights, an aliasing example repaired by enrichment, and the
multi‑start ranking. Open the application: https://costapop.github.io/MS-Astra/
