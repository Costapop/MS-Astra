# MS Astra 2.1.1

Interface refinements requested after the 2.1.0 review.

- **Starting designs on the chart.** During multi‑start exploration the final
  spectrum of every finished starting design is drawn on the reflectance chart
  as a thin grey line, the current leader as a dashed blue line. Hovering a
  row of the starts list highlights that spectrum in orange, prints its merit
  and layer count, and shows its structure on the coating chart. The ghost
  spectra stay in the background while the winner is replayed, so the gap
  between the winner and the other starts is visible.
- **Event log folded to the last five events**; a *Show all (N)* control in
  the card header expands the full history and *Last 5 only* folds it again.
- **Multi‑start is a switch** in the Starting design group (off by default)
  with the time budget per start shown only when it is on.
- **Termination reason in the status.** The top status bar, the Synthesis
  card and the result line state why the run stopped, with the numbers that
  matter: target reached (F ≤ target), layer limit (N) with no admissible
  needle and no growth progress, optical‑thickness limit (nm), time budget,
  cycle budget, or no further progress.
- **Final needle check.** After the final refinement the needle derivative of
  the finished design is computed and shown in full colour, and the best
  candidates are actually inserted and refined. The chart carries the
  verdict: *needle‑stationary* (g(z) ≥ 0 everywhere), *negative minima exist
  but none lowers F after refinement* (each marker labelled with its ΔF), or
  *an insertion could still lower F by x % — blocked by the layer /
  optical‑thickness limit*. The same table is written to the event log.

Open the application: https://costapop.github.io/MS-Astra/
