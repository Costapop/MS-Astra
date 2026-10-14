# MS Astra 2.2.1

Verification of the termination reason, start‑mode indicator, release badge.

- **Self‑check of the termination reason.** After the final refinement the
  engine checks every statement of the reported reason against the recorded
  facts of the run (target met on both grids; design at termination at the
  optical‑thickness limit; three cycles without progress; layer limit
  blocking interior needles; needle‑stationary or no‑gain state of the
  reported design; growth capped by the limit; budget exhausted; archive note
  present exactly when the archived design is reported and better than the
  terminal one; limits respected; reported F equal to an independent
  re‑evaluation). The result is shown next to the reason ("✓ reason verified
  (N checks)") and as a table in the event log; a failed check is flagged
  in red. When the reported design ends below the optical‑thickness limit
  after the final cleanup, the reason now states its thickness.
- **Start‑mode indicator** in the Synthesis card: "Single layer — TiO₂
  150 nm" or "Multi‑start — exploring 3 of 10 …" / "10 designs explored →
  winner «…», now replayed". Multi‑start spectra are drawn with the same
  line weight as the synthesis curve, dashed.
- **Release number** in the top‑left corner; Pause/Step are disabled while
  the background exploration runs and re‑enabled for the replay.
- Browser verification: for every preset at two targets and for multi‑start
  in all four paces, the status bar, the Synthesis card, the result line and
  the event log show exactly the engine's reason, the self‑check passes, and
  the replayed winner's reason equals the exploration's.
