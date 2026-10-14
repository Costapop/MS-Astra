MS Astra's first release turns optical coating synthesis into a visual demonstration.

- English interface with an Apple-inspired visual design and presentation mode.
- Editable piecewise-constant reflectance target, wavelength limits and material catalog.
- Normal-incidence lossless characteristic matrices, analytic thickness derivatives and analytic replacement-needle sensitivity.
- Constrained Levenberg–Marquardt refinement, needle insertion, genuine one-layer Gradual Evolution, thin-layer cleanup and final refinement.
- Animated spectra, needle search, layer stack and merit history. Pause, resume, stop and demonstration pace controls.
- Genuine Excel export with spectra, layer recipe, target bands, run settings and recorded evolution checkpoints.
- Dependency-free static application; computation runs in a browser worker.

Download `ms-astra-v1.0.0.zip`, extract it, and serve the folder with a static HTTP server (for example `python3 -m http.server 8000`). Open `http://localhost:8000`. JavaScript modules and the worker require HTTP rather than opening the HTML file directly.

The tests check physical invariants, analytic derivatives against independent numerical differences, the supplied numerical reference example, optimization constraints, growth behavior, and workbook validity. Source equations and book references are documented in `docs/METHOD.md`.

The solver performs a bounded local search on a finite spectral grid. A target is not guaranteed to be attainable. Material indices are idealized constants; absorption, dispersion, oblique incidence and manufacturing tolerances are outside this release.
