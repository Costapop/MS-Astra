# MS Astra 2.4.0

Dashboard redesign: every chart of the synthesis stays in view while a run
is animated, and the spectrum chart gets a clearer target and polarization
language. The engine is unchanged.

- **Three columns.** Inputs on the left (materials, starting design, limits,
  advanced), the three charts of the synthesis stacked in the centre —
  reflectance spectrum, needle derivative, coating structure — and the state
  of the run on the right: the Synthesis card (verdict, tiles, progress), the
  merit‑function history and the event log. The centre column and the right
  rail share one row template, so the cards line up row by row. Below
  1400 px the side columns narrow; below 1180 px the page stacks (charts,
  then the run state, then the inputs).
- **Target bands.** The target is drawn as a translucent band 7 px tall
  centred on the required level — thicker than any curve (2.25 px), with a
  faint edge — and the computed spectra remain visible through it; the
  optimization points sit inside the band as before. The band keeps its full
  height at 0 % and 100 %.
- **Rs and Rp.** The two polarizations are told apart by hue and by dash:
  the s‑polarization is solid blue‑green, the p‑polarization dashed magenta;
  the optimized characteristic stays blue with its area fill. In the
  `Rs & Rp` mode the two curves have equal weight in those colours (no fill)
  and the target bands take the same tints, the Rp band with a dashed edge;
  level handles, hover markers and the legend swatches follow the same
  scheme. Dark theme gets its own, lighter variants of both hues.
- **Multi‑start.** Previews and ghosts no longer borrow the Rp dash: the
  start being explored is the lighter blue curve without fill, finished
  starts are thin grey lines, the leader green, the hovered start orange —
  the Rp curve of a ghost is still dashed. In the `Rs & Rp` mode Rs and Rp
  of the start being explored were previously both dashed blue and
  indistinguishable; they now carry their own colours.
- **Layer table** moved from the event log to the Coating structure card,
  next to the structure it describes.
- Event‑log tables wrap in the narrower column (numeric cells never wrap).
- Verification: 42 automated tests unchanged; headless‑browser screenshots of
  every mode (normal and oblique incidence, `(Rs + Rp)/2`, `Rs & Rp` with
  equal and with different targets, multi‑start exploration and replay, layer
  table, light and dark themes) at 1440 × 900, 1280 × 800 and the stacked
  layout at 1100 px, with no console errors.
