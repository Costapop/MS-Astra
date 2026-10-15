# MS Astra 2.3.2

No layer of a reported design is thinner than the thin‑layer threshold.

- **Problem.** The threshold was enforced by cleanup *before* the final
  refinement; the refinement itself was free (`d ≥ 0`) and could drive a
  layer below the threshold again (e.g. 0.71 nm with a 3 nm threshold), and
  the design was then reported as it was. The layer table also showed
  intermediate designs during a run without saying that their thin layers
  would be removed.
- **Engine.** Every refinement of the final phase is bounded: the
  Levenberg–Marquardt step is projected onto `d_j ≥ threshold` (a start below
  the bound is lifted to it). A layer pinned at the bound is tested for
  removal — neighbours absorb its optical thickness, bounded refinement —
  and removed when the design is better without it (logged as "pinned at the
  threshold removed"). A hard guard before the report repeats the cleanup if
  anything slipped through. The main loop is unchanged (free refinement,
  cleanup at the end of each cycle, as the method prescribes).
- **Interface.** The layer table carries a caption: for the reported design
  "every layer is at least N nm"; during a run "intermediate design — k layers
  thinner than N nm (marked in red) will be removed at the next cleanup; the
  reported design never contains a layer below the threshold".
- Verification: 42 automated tests (new: the bounded refinement; every
  preset at 3 and 5 nm plus ten random tasks at 2–6 nm report no layer below
  the threshold with all self‑checks passing); headless‑browser check at a
  3 nm threshold.
