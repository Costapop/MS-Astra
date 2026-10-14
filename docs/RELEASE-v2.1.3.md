# MS Astra 2.1.3

Truthful termination reasons (supersedes the unreleased 2.1.2).

The reason shown in the status used to be derived from the design at the
moment the search stopped, while the reported design is often the best
archived one from an earlier cycle (gradual evolution is non‑monotonic). This
produced statuses such as "Optical‑thickness limit reached" for a reported
design below the limit. The engine now records a structured stop cause
(target / optical‑thickness limit / stagnation with the exact cause of the
last needle cycle and whether growth was capped / budget / cycle budget) and
composes the reason from it; the archived design is used only when it is
better by more than 0.1 %, and then the reason says so and quotes both
designs. The layer‑limit wording follows the real insertion block (an
interior needle needs two free layers). A budget stop terminates the search
immediately, and a budget‑limited multi‑start result is replayed with the
same amount of work, so the replay reproduces the exploration result exactly
(verified on 24 wall‑clock‑limited runs).

Tests: reason consistency over all presets at two targets, exact replay with
work and wall‑clock budgets; 23 tests pass.
