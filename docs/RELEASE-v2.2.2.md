# MS Astra 2.2.2

Plain‑language verdict in the Synthesis card: why the run stopped, which
stopping conditions hold, why this design — the same for single‑layer and
multi‑start runs.

- **Stopped — decisive cause.** After every synthesis the Synthesis card
  states the cause in plain words (Target merit reached · Layer limit
  reached · Optical‑thickness limit reached · Needle variations no longer
  reduce the merit · No further progress · Time budget exhausted · Cycle
  budget exhausted) with a one‑sentence detail, followed by the state of
  every stopping condition: target merit, layer limit, optical‑thickness
  limit, needle variations (from the final needle check: no further gain,
  blocked by the layer limit, or still possible) and thickness growth (no
  progress in three cycles, capped, impossible at the limit, not needed).
  Satisfied conditions are marked ●, the decisive one is labelled; the full
  wording of each is in the tooltip and in the event‑log table. The status
  bar and the card label show the same headline; the engine's full reason
  sentence stays in their tooltips and in the log.
- **Why this design.** Multi‑start: "chosen as the best of 10 explored
  starting designs by the score max(F, F_dense): «winner» … vs runner‑up «…»
  (margin); N of 10 reached the target merit", the replay's cycle/needle/
  growth counts, and a check that the replay reproduced the explored result
  (same F, layers and termination). Single layer: the start, and the same
  counts. A **Reported** line states whether the reported design is the
  design at termination or the best archived one (quoting the terminal
  design).
- **Engine.** `stop.summary` is composed from the recorded facts and covered
  by two new self‑checks (the decisive condition holds; headline and reason
  describe the same cause). A run whose layer limit left room only for
  boundary needles, none of which helped, is now recorded as a layer‑limit
  stop ("blocks needles inside the layers and the admissible boundary needles
  do not lower the merit") instead of "no needle lowers the merit" — the
  final needle check had flagged that wording as unverifiable.
- Starts dialog: score column, the winner starred, a caption stating the
  ranking rule; Excel Summary sheet gains the decisive cause, every stopping
  condition, the reported‑design and design‑selection rows and the self‑check
  result; the Starts sheet is ranked by score with a decisive‑cause column.
- Verification: 26 automated tests (new: summary consistency for every
  preset at two targets and for the multi‑start ranking; workbook rows);
  headless‑browser check that status, card label, verdict headline, facts
  and log agree with the engine for every preset and for multi‑start in
  Instant, Fast and Live paces, with the replay matching the explored winner.
