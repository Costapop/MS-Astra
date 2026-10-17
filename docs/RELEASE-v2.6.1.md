# MS Astra 2.6.1

Choosing any explored multi‑start result (introduced in the 2.6.0
candidate) with two interface corrections found in its review; the
synthesis engine is unchanged.

- **Choose a result** (from 2.6.0, unreleased). After the exploration every
  finished start in the **Multi‑start** list is clickable, and the
  **Ranking** dialog has a *Show* button per start: the result the
  exploration reported for that start becomes the current design on the
  dashboard — the coating on the spectrum (on the start's own grid, enriched
  points included) and its dense‑grid check, the coating structure and the
  **Layer table**, the final needle‑derivative check with its verdict, the
  merit history of that start, the tiles and the Synthesis verdict (*Why this
  design*: «chosen by you», the rank by the score, the winner for reference).
  Nothing is recomputed. **Export Excel** writes the chosen design and names
  it in the Summary and in a new *Note* column of the Starts sheet; the
  winner's replay is marked there the same way. Clicking during the winner's
  replay stops the replay; ★ brings the winner's explored result back;
  *Start synthesis* and *Reset* clear the choice. Under the hood every
  `explore-result` carries the complete `done` event of its start and its
  final needle scan (`exploreResult` in `src/synthesis.js`).
- **Merit history legend.** After *Reset* the legend of the merit history
  said *Shown* until the next exploration had finished; it now reads
  *Replay* again as soon as the dashboard is reset.
- **Multi‑start card label.** The status in the card header shares the line
  with the *Ranking* button and was cut off («▸ rank 10 of 10 is sho…», and
  before 2.6.0 «10 explored · ★ the w…»). It is now short enough to be read
  whole in every layout — *★ replayed* (the winner's replay), *▸ rank 7 of
  10* (a chosen start, marked ▸ in the list), *★ shown* (the winner's
  explored result) — the label keeps a minimum width so that the button
  wraps under it rather than cutting it, and the full sentence (the number
  of explored starts, the winner, what to click) is in its tooltip.
- Verification: 44 automated tests (unchanged since 2.6.0); headless‑browser
  run of the whole flow — exploration, replay, choosing from the list and from
  the Ranking dialog, choosing during and after the replay, the layer table,
  the export, hover and ★, Reset, oblique incidence with separate Rs/Rp
  targets, enriched grids, budget‑limited starts, the stacked layout — with
  the legend and the label checked after Reset and at 1100–1920 px, no
  console errors.
