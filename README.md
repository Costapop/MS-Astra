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
single layer, refines all thicknesses with a constrained Levenberg–Marquardt
method using the analytic Jacobian, computes the needle derivative `g(z)`
analytically from the adjoint function, inserts a needle of the opposite
material where `g(z)` is most negative, refines again, and — when no needle
helps — grows one layer to the nearest merit minimum to open a new basin
(gradual evolution). Thin layers are removed with their optical thickness
preserved, and a final refinement closes the run. The formulas follow Furman &
Tikhonravov, *Basics of Optics of Multilayer Systems* (§1.2, §1.4, §2.2), the
method specification supplied with the task, and Tikhonravov, *Optical
Coatings* (SPIE, 2024). Details: [docs/METHOD.md](docs/METHOD.md);
evidence: [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Using the dashboard

1. Pick a **target preset** or draw your own target on the reflectance chart:
   drag a level up or down, drag a boundary (or a range end) left or right,
   double‑click a band to split it, double‑click a boundary to merge. The same
   values are editable numerically in the sidebar.
2. Set the spectral range, the number of spectral points, the H and L
   materials, the substrate, the starting layer (material and geometric
   thickness) and the limits: maximum number of layers, maximum total optical
   thickness and the target merit `F = ⟨(R − R̃)²⟩`.
3. Press **Start synthesis**. The pace control (Cinematic / Live / Fast /
   Instant) sets how long each stage is held on screen; **Step** advances to
   the next event, Space pauses and resumes.
4. Read the result in the tiles and the event log, open the **Layer table**,
   and **Export Excel** to download the target and synthesized spectra and the
   coating parameters.

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
- `src/synthesis.js` — needle cycle, gradual evolution, cleanup, termination; emits events for the interface.
- `src/charts.js` — canvas charts: interactive target editor, needle derivative, coating structure, merit history.
- `src/app.js` — settings, runner with demonstration pacing and animation, export.
- `src/xlsx.js` — dependency‑free Excel writer.
- `tests/` — verification against closed forms, an independent matrix code, finite differences, the specification's worked example and the book's designs.

Release notes: [docs/RELEASE-v2.0.0.md](docs/RELEASE-v2.0.0.md). The source
books and the private method specification are not distributed with this
repository.
