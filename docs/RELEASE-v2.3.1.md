# MS Astra 2.3.1

The reported design is provably the best complete design of the run, and the
verdict says why a lower merit may have been seen during the synthesis.

- **Problem.** With a thin‑layer threshold above the default, the archive of
  the best design could hold a design *with* a thin layer; the final cleanup
  removed that layer, the merit jumped, and a better complete design seen
  earlier in the run was lost (cube preset, threshold 6 nm: reported
  F = 1.4·10⁻⁶ while F = 3.7·10⁻⁹ had been reached). The final needle check
  then reported "an insertion could still lower F by 99 %". Values on the
  merit history could also be lower than the result after a grid
  enrichment, with no explanation.
- **Engine.** Only *complete* designs (no layer below the threshold) within
  the limits are archived — every one the run shows, re‑measured whenever
  the grid is enriched. The final phase completes the design at
  termination, adopts the best archived design when it is lower, and then
  runs the regular needle cycle on the reported design — candidates judged
  by their completed designs — with cleanup and refinement, until nothing
  changes (unless the run stopped by the target or by its budget). The
  cleanup is repeated while a refinement leaves a thin layer. Result: the
  reported design is the lowest‑merit complete design within the limits the
  run has evaluated, and it is needle‑stationary within the limits. If the
  final phase brings the design to the target, the cause becomes "Target
  merit reached in the final phase".
- **Verdict.** New *Best design* line in the Synthesis card (and in the
  Excel Summary and the event log): "Reported F = … is the lowest merit of
  any complete design within the limits evaluated in the run on the final
  grid", with the explanation when a lower value was shown — a design with
  a layer thinner than the threshold (removed by the cleanup) or values on
  the coarser grid before enrichment. The reason quotes the design at
  termination with its thin layers and the merit after their removal, and
  the needles added in the final phase with the merit before and after. The
  Needle‑variations fact distinguishes "blocked by the layer limit",
  "blocked by the optical‑thickness limit" and "lowers F only with a layer
  thinner than the threshold". Three new self‑checks: no layer below the
  threshold; reported F ≤ the archive minimum and ≤ the completed terminal
  design; no admissible needle lowers the reported merit. The merit history
  marks grid enrichments; final‑phase needles and cleanups are tagged in
  the log.
- Verification: 40 automated tests; the new one re‑evaluates every design
  shown in 22 runs (all presets, thresholds 1/3/6 nm, 21‑ and 61‑point grids
  with enrichment) on the final grid.
