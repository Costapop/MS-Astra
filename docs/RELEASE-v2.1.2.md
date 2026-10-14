# MS Astra 2.1.2

Correctness of the termination reason.

The reason shown in the status was derived from the design at the moment the
search stopped, while the reported design is often the best archived one from
an earlier cycle (gradual evolution is non‑monotonic). This produced statuses
such as "Optical‑thickness limit reached" for a reported design below the
limit. The engine now records a structured stop cause (target, optical‑
thickness limit, stagnation with the exact cause of the last needle cycle and
whether growth was capped, budget, cycle budget) and composes the reason from
it; whenever the archived design replaces the terminal one, the reason says so
and quotes both designs. The layer‑limit wording is now tied to the actual
block of needle insertion (an interior needle needs two free layers), and a
budget‑limited multi‑start result is replayed with the same amount of work, so
the replay reproduces the exploration result exactly.

Tests: a consistency check over all presets at two targets (reason text ↔
recorded facts ↔ reported design) and an exact‑replay check; 23 tests pass.
