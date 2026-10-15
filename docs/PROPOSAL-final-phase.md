# Proposal — strengthened final phase (candidate for MS Astra 2.4.0)

Status: **measured, not implemented** (October 2026). Kept here to resume
later. Prototype: `scripts/research/final-phase-prototype.mjs`; audit of the
2.3.1 stopping criteria: `scripts/research/optimality-audit.mjs`. Neither
script touches the application.

## 1. Why

MS Astra 2.3.1 guarantees that the reported design is the best *complete*
design within the limits the run has evaluated, and that it is
needle‑stationary with respect to the K most negative minima of g(z)
(K = 3 by default). It does **not** guarantee local optimality with respect
to the constraints themselves. An audit on every preset (41 points, target
1·10⁻⁹ so that the limits, not the target, stop the run) found four gaps:

| Probe | What was tried on the 2.3.1 result | Gain in F |
|---|---|---|
| A — restart the synthesis from the reported design | the 3‑cycle stagnation patience stops growth early | edge −11 %; others 0 (bandpass +5 %: another local minimum) |
| B — all needle candidates instead of K = 3 | `candidates = 0` | edge −75 %, cube −38 %, bandpass −7 % |
| C — stationarity on the optical‑thickness surface | projected‑gradient descent on Σ n_j d_j = const | edge −1.7 % (LM backtracking is not a constrained stationarity test) |
| D — at the layer limit: remove one layer and continue | for each layer: remove → refine → continue | mirror −87 %, polarizer −42 %, bandpass −31 %, AR 45° −29 % |

The method is a local search (needle variations + gradual evolution) and
cannot guarantee a global optimum; the point of this proposal is to make the
reported design stationary with respect to **every move the method knows,
within the limits**, and to say so in the verdict.

## 2. Algorithm — the strengthened final phase

Runs after the 2.3.1 final phase (completed terminal design → best archived
design), unless the run stopped by the target or by its budget. All moves
accept a candidate only if its *completed* design (layers below the
thin‑layer threshold removed, refined again) is admissible — within the
layer and optical‑thickness limits, no thin layer — and lowers F by more
than the relative tolerance ε = 10⁻⁶.

```
repeat (at most R rounds, within the time cap):
  F0 ← F
  1. needle cycle with ALL admissible negative minima of g(z) (not K = 3),
     every candidate refined and completed; accept the best while it lowers F
  2. if Σ n_j d_j ≥ TOT_max − 1 nm:
       projected‑gradient descent on the surface Σ n_j d_j = const with d_j ≥ 0
       (gradient from evaluate(); components of layers at d_j = 0 that would go
       negative are frozen and the direction re‑projected; Armijo line search);
       complete; accept if lower
  3. if N ≥ N_max − 1 (an interior needle no longer fits):
       for every layer j: remove it — the neighbours absorb its optical thickness
       (the cleanThinLayers rule) — and refine
       screened: rank the N removals by the refined merit; run move 1 on the best 4
       light:    run move 1 after every removal
       full:     continue the whole synthesis after every removal (K = all)
       accept the best result if lower
  4. restart the regular synthesis from the current design (the growth cycle is
     re‑entered; main loop with K = 3, final phase as in 2.3.1); accept if lower
until F ≥ F0·(1 − 10⁻³)
archive every complete design seen; report the archive minimum (as in 2.3.1)
```

Move 3 is where almost all of the gain is; moves 1, 2 contribute a few
percent; move 4 matters where the 3‑cycle patience stopped early
(polarizer: a further −6 … −20 % over several restarts).

## 3. Measurements (prototype on top of the 2.3.1 result)

41 points, target 1·10⁻⁹, thin‑layer threshold 1 nm, K = 3 in the main loop.
"screened" is the variant proposed as the default; "full" as an option.

| Preset | 2.3.1: F · RMS · time | screened: gain (RMS) · extra time | full: gain (RMS) · extra time |
|---|---|---|---|
| Mirror 95 % | 3.4e‑9 · 0.006 % · 4 s | **−87 %** (0.006 → 0.002 %) · +3 s | −87 % · +35 s |
| Anti‑reflection | 1.9e‑7 · 0.044 % · 1 s | 0 · +3 s | 0 · +7 s |
| Beam splitter 50 % | target reached · 0.5 s | 0 · +0 s | 0 · +0 s |
| Cube splitter 45° | 2.1e‑9 · 0.005 % · 1 s | 0 · +0.3 s | 0 · +0.5 s |
| AR at 45° | 2.0e‑5 · 0.45 % · 6 s | **−30 %** (0.45 → 0.38 %) · +43 s | −35 % · +42 s |
| Edge filter | 1.2e‑3 · 3.50 % · 10 s | **−14 %** (3.50 → 3.24 %) · +4 s | −14 % · +3 s |
| Band reflector | 1.0e‑3 · 3.19 % · 20 s | **−19 %** (3.19 → 2.88 %) · +87 s | −41 % (2.44 %) · +524 s |
| Polarizer 45° | 2.3e‑8 · 0.015 % · 7 s | **−39 %** (0.015 → 0.012 %) · +90 s | −59 % (0.010 %) · +440 s |

61 points (the interface default), screened: Mirror −87 % (+4 s), AR 45°
−19 % (+10 s), Edge −0.1 % (+10 s — no gain is possible too), Cube 0.

Reading: when the target is reached — the usual demonstration — the gain and
the cost are both zero (the phase does not run after a target stop). When
the limits bind, the screened variant typically gives −15 … −40 % in F
(RMS −8 … −20 %), occasionally several times (the mirror), for 0.5–4× the
main run. The full variant adds another −20 … −25 % on 40‑layer tasks but
costs minutes; option only.

## 4. Implementation plan

* `src/synthesis.js`, final phase (after `adoptArchive()` and the existing
  exploitation loop): add the four moves as inner generators so that the
  interface animates them (`needle`, `cleanup`, `refined` events with
  `final: true`; a new `remove` event for move 3 — layer index, F before and
  after; a `stage: 'final-search'` label). Reuse `needleCycle('final')` with
  `kCand = 0` for move 1; move 2 as a small projected‑gradient routine
  (gradient from `evaluate`); move 3 with `cleanThinLayers`‑style merging;
  move 4 by re‑entering the main loop (extract the loop body into a
  generator, or call `synthesize` recursively with `start.layers`, streaming
  its events).
* Time cap: `max(2 × main‑run time, 60 s)` by default; `cfg.finalPhase`
  = `'standard' | 'thorough' | 'off'` (Advanced → "Final phase"); when the
  cap stops the phase, the verdict says so and the self‑check for
  needle‑stationarity is marked "capped" rather than failed.
* Multi‑start: run the phase only for the winner's replay (the exploration
  compares starts without it), or for every start when `thorough`.
* Verdict: a line "Locally optimal with respect to: thickness refinement
  (constrained), a needle at any of N negative minima, removal of any single
  layer, growth of any layer" with the moves actually completed; keep the
  explicit "a global optimum is not guaranteed — multi‑start explores 10
  starts". New self‑checks: no needle among *all* candidates lowers the
  completed merit; no single‑layer removal followed by a needle cycle lowers
  it; the projected gradient on the TOT surface is below tolerance when at
  the limit; a restart changes nothing.
* Tests: extend the "best complete design" test with the four probes of
  `optimality-audit.mjs` (expected gains ≤ 1 % after the phase on every
  preset at 41 points), and a timing guard.
* Replay determinism (multi‑start): the phase must be deterministic — no
  wall‑clock decisions inside the moves; the time cap is applied between
  moves and recorded (`stop.finalCapped`) so a budget‑limited replay can be
  reproduced with `maxRefinements` as today.

## 5. Open questions

* Should move 3 also try removing *two* layers (one H and one L) to free
  room for an interior needle at the limit? Cost N²/2 refinements — only for
  the thorough variant.
* Integral (trapezoidal) weights ν_l ∝ Δλ_l on enriched grids, so that F
  keeps its meaning across enrichment (spec §3); independent of this
  proposal but related to how the result is presented.
