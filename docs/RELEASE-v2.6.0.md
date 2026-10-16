# MS Astra 2.6.0

Any explored multi‑start result can be chosen, shown on the dashboard as the
current design and exported — not only the winner. The synthesis engine is
unchanged.

- **Choose a result.** After the exploration (all starts finished) every
  finished start in the **Multi‑start** list is clickable; the **Ranking**
  dialog has a *Show* button per start. A click puts the result the
  exploration reported for that start on the dashboard as the current
  design: the coating on the reflectance spectrum (on the start's own
  optimization grid, enriched points included) and its dense‑grid check, the
  coating structure and the **Layer table**, the final needle‑derivative
  check with its verdict, the merit history of that start (blue line with
  event markers; the legend says *Shown*), the tiles (F, RMS error, layers,
  optical thickness, the start's computation time) and the Synthesis
  verdict — the stopping condition with its facts and self‑check, and *Why
  this design*: «chosen by you», the rank by the score, the winner for
  reference. Nothing is recomputed: the design shown is exactly the one
  recorded in the ranking.
- **Export Excel** writes the chosen design: the Spectrum, Design, Summary
  and Verification sheets describe it, the Summary names it («Multi‑start;
  chosen from the explored starts: …») with the *Design selection* line, and
  the Starts sheet has a new *Note* column marking the winner and the start
  whose design the workbook contains (shown as explored, or the winner
  through its replay).
- The chosen start is marked in the list (▸, current‑design colour) and in
  the Ranking dialog; the card label says which rank is shown; hovering
  other starts still previews them on the charts and the chosen design comes
  back when the pointer leaves. Clicking ★ shows the winner's explored
  result; clicking during the winner's replay stops the replay (noted in the
  log) and shows the chosen result at once. *Start synthesis* and *Reset*
  clear the choice as usual.
- Under the hood every `explore-result` now carries the complete `done`
  event of its start and its final needle scan (`exploreResult` in
  `src/synthesis.js`, used by the worker and the in‑page fallback alike).
- Verification: 44 automated tests (two new: the explored results are
  complete and self‑consistent; the export names and marks a chosen start);
  headless‑browser run of the whole flow — exploration, replay, choosing the
  worst start, the layer table, the export, the Ranking dialog, choosing
  during the replay, reset, the stacked layout — with no console errors.
