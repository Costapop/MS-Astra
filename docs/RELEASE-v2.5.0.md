# MS Astra 2.5.0

Multi‑start gets its own card and a merit history per start; the stacked
layout keeps the spectrum and the Synthesis card together. Builds on the
2.4.0 redesign (see RELEASE‑v2.4.0.md); the engine is unchanged.

- **Multi‑start card.** In the multi‑start mode a fourth card appears under
  Synthesis — the ten starting designs with their status (pending, running,
  finished with F and layer count, ★ the winner) and the *Ranking* button.
  It is shown as soon as the mode is switched on, so the list of starts is
  visible before the run. Hovering a start highlights it on the spectrum
  (as before), on the coating structure and now on the merit history.
- **Synthesis card** is the same in both modes: during the exploration its
  tiles follow the start being explored (F, RMS error, layers, optical
  thickness), the label says which start is running; after the exploration
  it shows the replay of the winner and the verdict as for a single‑layer
  start. (Before, the tiles were replaced by the starts list.)
- **Merit history per start.** The merit‑function chart draws one history
  per starting design: finished starts grey, the leader green, the start
  being explored in the accent colour, the hovered start orange with its
  name and final F; the replay of the winner is the blue line with its
  event markers and coincides with the winner's history. The chart's legend
  appears in the multi‑start mode.
- **Stacked layout** (windows narrower than 1024 px): the cards follow the
  reading order spectrum → Synthesis → Multi‑start → needle derivative →
  coating structure → merit history → event log → inputs, so the spectrum
  and the state of the run are on screen together during a run.
- In the stacked layout the needle‑derivative and coating‑structure cards
  take half the window height each (less the top bar and the gap, at most
  300 px), so the two charts fit on one screen together.
- **Needle‑derivative chart.** The verdict banner and the candidate label
  moved into a text strip above the plot inside the same card (the card
  keeps its height), so no text covers the curve. After the run the tested
  insertions are marked by rings only (green: a refined gain, red: none);
  their ΔF is in the tooltip and in the log table, not written on the plot.
- **Synthesis card in the multi‑start mode** names only the starting design
  whose numbers the tiles show (the status of the exploration — which start
  is running, the winner — is in the Multi‑start card, not repeated), the
  stage label counts cycles as in a single run, and a long label can no
  longer climb into the card header (it is cut with an ellipsis, the full
  text in its tooltip).
- In the stacked layout the four tiles of the Synthesis card form one
  compact row, so the spectrum and the Synthesis card share one screen
  during a run (74 px to spare at 900 × 620).
- The four tiles of the Synthesis card stay whole during a run in the
  three‑column layout in both starting modes: the note under a number is one
  line (full text in the tooltip), on short windows (under 760 px) the tiles
  are compact, and in the multi‑start mode the Synthesis row is never shorter
  than the tiles (checked at 1024 × 660, 1147 × 620, 1280 × 720, 1366 × 768
  and 1440 × 900).
- **Coating structure:** the layer count and the total thickness moved into
  the strip above the bars, never over a bar or its thickness label.
- **Spectrum header** is tighter (title and tabs, then legend and tools,
  with a 3 px row gap), which gives the plot the height.
- On short windows the right column scrolls in the multi‑start mode rather
  than squeezing four cards below a readable size.
- Verification: 42 automated tests unchanged; headless‑browser runs of the
  multi‑start flow (exploration, hover, replay, finish, switch back to a
  single start) at 1440 × 900, 1147 × 620 and the stacked layout at 900 px,
  light and dark, with no console errors.
