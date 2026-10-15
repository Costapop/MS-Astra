# MS Astra

**[Open MS Astra in your browser →](https://costapop.github.io/MS-Astra/)**

MS Astra synthesizes a two‑material multilayer optical coating for a required
energy reflectance `R(λ)` on a chosen spectral range and shows the whole
process live: thickness refinement, needle insertion, deliberate thickness
growth (gradual evolution), thin‑layer cleanup and final optimization. It is
built for demonstrations — the charts are large, animated and arranged as a
single engineering dashboard: everything the user enters on the left, the
three charts of the synthesis (reflectance spectrum, needle derivative,
coating structure) stacked in the centre so that all of them stay in view
while a run is animated, and the state of the run (verdict, tiles, merit
history, event log) on the right; the inputs fold into a strip (*Hide* /
*Show inputs*) when the charts need the width — and it runs entirely in the
browser with no dependencies, accounts or backend.

## Method in one paragraph

A plane wave from air or BK7 at any angle of incidence from 0 to 89.9° onto
isotropic, homogeneous, lossless, non‑dispersive layers on a semi‑infinite
substrate; the target applies to `Rs`, `Rp`, to `Rs` and `Rp` jointly with a
separate target for each polarization, or to the unpolarized reflectance
`(Rs + Rp)/2` (s and p are handled with the Furman–Tikhonravov polarization
admittances, evanescent layers included). The synthesis starts from a
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
   card, or draw your own target on the chart, where it is shown as a
   translucent band at the required level (the computed spectra stay visible
   through it): drag a level up or down, drag a boundary (or a range end)
   left or right, double‑click a band to split it, double‑click a boundary
   to merge. The *Target* tab holds the same
   values numerically together with the spectral range, the number of points
   and the transition zone around target jumps (points inside it get zero
   weight). The **angle of incidence** (0–89.9°) and the **target
   characteristic** — `Rs`, `Rp`, `Rs & Rp` (a separate target for each
   polarization: the Rs target is the blue‑green band, the Rp target the
   magenta band with a dashed edge and the second table on the tab) or
   `(Rs + Rp)/2` (unpolarized light) — are set in the header of the same
   card and on its *Target* tab; the target bands are drawn and typed the
   same way at any angle. At an oblique angle the chart adds thin lines for
   `Rs` (solid blue‑green) and `Rp` (dashed magenta) under the optimized
   characteristic (blue) and the tooltip shows both; in the `Rs & Rp` mode
   both polarizations are full curves in those colours.
2. In the sidebar set the H and L materials, the substrate, the **incident
   medium** the light comes from (air or BK7 — e.g. a cemented cube, with the
   angle measured inside it), the starting
   design (a single layer, or **Multi‑start**: ten starting designs are
   synthesized in the background and watched on the charts, then the best is
   replayed) and the limits: maximum number of layers, maximum total optical
   thickness and the target merit `F = ⟨(R − R̃)²⟩`. Advanced: the number of
   needle candidates compared per step, the dense‑grid check and automatic
   grid enrichment.
3. Press **Start synthesis**. The pace control (Cinematic / Live / Fast /
   Instant) sets how long each stage is held on screen; **Step** advances to
   the next event, Space pauses and resumes.
4. Read the verdict in the Synthesis card — why the run stopped (target
   reached, layer limit, optical‑thickness limit, needle variations no longer
   reduce the merit, no further progress, budget) with the state of every
   stopping condition, why this design was chosen (for multi‑start: the
   ranking by `max(F, F_dense)` and the runner‑up; the replay is checked
   against the explored result) and which design is reported — the *Best
   design* line guarantees it is the lowest‑merit complete design within
   the limits the run evaluated and explains any lower value seen on the
   merit history (a thin layer before cleanup, or the coarser grid before
   enrichment) — then the
   tiles and the event log (folded to the last five events; every needle
   step lists the refined alternatives), check the final needle‑derivative
   verdict on its chart, hover the starts list in the **Multi‑start** card
   to compare the explored starting designs on the spectrum, the structure
   and the merit history (one history per start), open the **Layer table**
   (Coating structure card) or the **Ranking** of the starts, and **Export
   Excel** to download the target and
   synthesized spectra, the coating parameters, the dense‑grid verification,
   the termination summary and the multi‑start ranking.

Materials (constant indices): MgF₂ 1.38, SiO₂ 1.46, Al₂O₃ 1.63, HfO₂ 1.95,
Ta₂O₅ 2.10, TiO₂ 2.45, ZnS 2.35, a‑Si 3.95, K8 1.52, fused quartz 1.46,
Sitall 1.54. Substrate: BK7 1.52. Incident medium: air 1.00 or BK7 1.52.
Wavelengths and thicknesses in nm. Layer 1 is adjacent to the substrate
everywhere in the application and in the export. Presets *Cube splitter 45°*
(unpolarized 50 % inside BK7), *AR at 45°* (both polarizations) and
*Polarizer 45°* (Rs → 98 %, Rp → 0 inside BK7) show the oblique‑incidence
modes.

## Run locally

Requires Node.js 20 or newer; nothing to install.

```sh
npm run dev      # http://127.0.0.1:4173
npm test         # numerical verification and export checks
npm run build    # standalone static application in dist/
```

Serve the files over HTTP (the application uses JavaScript modules).

Release candidates: a branch named `preview/<name>` is verified and
published at `https://costapop.github.io/MS-Astra/preview/<name>/` next to
the released application (the list of previews is at
[/preview/](https://costapop.github.io/MS-Astra/preview/)); deleting the
branch removes it from the site.

## Repository

- `src/optics.js` — optical model (incident medium, angle, polarization characteristic), admittance recursion with polarization admittances, adjoint function, analytic Jacobian and needle derivative, needle insertion, thin‑layer cleanup.
- `src/refine.js` — constrained Levenberg–Marquardt refinement (generator, yields frames).
- `src/synthesis.js` — needle cycle with candidate comparison, gradual evolution, cleanup, dense‑grid check and enrichment, multi‑start exploration; emits events for the interface.
- `src/worker.js` — background multi‑start exploration.
- `src/charts.js` — canvas charts: interactive target editor, needle derivative, coating structure, merit history.
- `src/app.js` — settings, runner with demonstration pacing and animation, export.
- `src/xlsx.js` — dependency‑free Excel writer.
- `scripts/research/` — research prototypes that do not ship with the application: the strengthened final phase proposed for 2.4.0 and the audit of the stopping criteria (see [docs/PROPOSAL-final-phase.md](docs/PROPOSAL-final-phase.md)).
- `tests/` — verification against closed forms (Fresnel, Brewster, quarter‑wave stacks), an independent complex Abelès‑matrix code at normal and oblique incidence, finite differences, the specification's worked example and the book's designs.

Release notes: [docs/RELEASE-v2.3.2.md](docs/RELEASE-v2.3.2.md), [v2.3.1](docs/RELEASE-v2.3.1.md), [v2.3.0](docs/RELEASE-v2.3.0.md), [v2.2.2](docs/RELEASE-v2.2.2.md), [v2.2.1](docs/RELEASE-v2.2.1.md), [v2.2.0](docs/RELEASE-v2.2.0.md), [v2.1.3](docs/RELEASE-v2.1.3.md), [v2.1.1](docs/RELEASE-v2.1.1.md), [v2.1.0](docs/RELEASE-v2.1.0.md), [v2.0.0](docs/RELEASE-v2.0.0.md). The source
books and the private method specification are not distributed with this
repository.
