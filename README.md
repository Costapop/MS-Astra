# MS Astra

**[Open MS Astra in your browser →](https://costapop.github.io/MS-Astra/)**

MS Astra synthesizes a two‑material multilayer optical coating for a required
energy reflectance `R(λ)` on a chosen spectral range and shows the whole
process live: thickness refinement, needle insertion, deliberate thickness
growth (gradual evolution), thin‑layer cleanup and final optimization. It is
built for demonstrations — the charts are large, animated and arranged as a
single engineering dashboard — and it runs entirely in the browser with no
dependencies, accounts or backend.

## Method in one paragraph

Normal incidence from air onto isotropic, homogeneous, lossless,
non‑dispersive layers on a semi‑infinite substrate. The synthesis starts from a
single layer (or from a set of starting designs explored in the background),
refines all thicknesses with a constrained Levenberg–Marquardt method using
the analytic Jacobian, computes the needle derivative `g(z)` analytically
from the adjoint function, inserts needles of the opposite material at the
most negative minima of `g(z)`, refines every alternative and keeps the best,
and — when no needle helps — grows one layer to the nearest merit minimum to
open a new basin (gradual evolution). Thin layers are removed with their
optical thickness preserved, the design is checked on an independent dense
wavelength grid (the optimization grid is enriched where it under‑resolves
the spectrum), and a final refinement closes the run. The formulas follow Furman &
Tikhonravov, *Basics of Optics of Multilayer Systems* (§1.2, §1.4, §2.2), the
method specification supplied with the task, and Tikhonravov, *Optical
Coatings* (SPIE, 2024). Details: [docs/METHOD.md](docs/METHOD.md);
evidence: [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Using the dashboard

1. Pick a **target preset** on the *Presets* tab of the Reflectance spectrum
   card, or draw your own target on the chart: drag a level up or down, drag
   a boundary (or a range end) left or right, double‑click a band to split
   it, double‑click a boundary to merge. The *Target* tab holds the same
   values numerically together with the spectral range, the number of points
   and the transition zone around target jumps (points inside it get zero
   weight).
2. In the sidebar set the H and L materials, the substrate, the starting
   design (a single layer, or **Multi‑start**: ten starting designs are
   synthesized in the background and watched on the charts, then the best is
   replayed) and the limits: maximum number of layers, maximum total optical
   thickness and the target merit `F = ⟨(R − R̃)²⟩`. Advanced: the number of
   needle candidates compared per step, the dense‑grid check and automatic
   grid enrichment.
3. Press **Start synthesis**. The pace control (Cinematic / Live / Fast /
   Instant) sets how long each stage is held on screen; **Step** advances to
   the next event, Space pauses and resumes.
4. Read the result in the tiles and the event log (folded to the last five
   events; every needle step lists the refined alternatives), check the final
   needle‑derivative verdict on its chart, hover the starts list to compare
   the explored starting designs on the spectrum, open the **Layer table** or
   the **Starts** ranking, and **Export Excel** to download the target and
   synthesized spectra, the coating parameters, the dense‑grid verification
   and the multi‑start ranking.

Materials (constant indices): MgF₂ 1.38, SiO₂ 1.46, Al₂O₃ 1.63, HfO₂ 1.95,
Ta₂O₅ 2.10, TiO₂ 2.45, ZnS 2.35, a‑Si 3.95, K8 1.52, fused quartz 1.46,
Sitall 1.54. Substrate: BK7 1.52. Wavelengths and thicknesses in nm. Layer 1
is adjacent to the substrate everywhere in the application and in the export.

## Run locally

Requires Node.js 20 or newer; nothing to install.

```sh
npm run dev      # http://127.0.0.1:4173
npm test         # numerical verification and export checks
npm run build    # standalone static application in dist/
```

Serve the files over HTTP (the application uses JavaScript modules).

## Repository

- `src/optics.js` — admittance recursion, adjoint function, analytic Jacobian and needle derivative, needle insertion, thin‑layer cleanup.
- `src/refine.js` — constrained Levenberg–Marquardt refinement (generator, yields frames).
- `src/synthesis.js` — needle cycle with candidate comparison, gradual evolution, cleanup, dense‑grid check and enrichment, multi‑start exploration; emits events for the interface.
- `src/worker.js` — background multi‑start exploration.
- `src/charts.js` — canvas charts: interactive target editor, needle derivative, coating structure, merit history.
- `src/app.js` — settings, runner with demonstration pacing and animation, export.
- `src/xlsx.js` — dependency‑free Excel writer.
- `tests/` — verification against closed forms, an independent matrix code, finite differences, the specification's worked example and the book's designs.

Release notes: [docs/RELEASE-v2.2.0.md](docs/RELEASE-v2.2.0.md), [v2.1.3](docs/RELEASE-v2.1.3.md), [v2.1.1](docs/RELEASE-v2.1.1.md), [v2.1.0](docs/RELEASE-v2.1.0.md), [v2.0.0](docs/RELEASE-v2.0.0.md). The source
books and the private method specification are not distributed with this
repository.
