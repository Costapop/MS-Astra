# MS Astra

**[Open MS Astra in your browser →](https://costapop.github.io/MS-Astra/)**

No ChatGPT or GitHub account is required. The application runs directly in your browser, including synthesis and Excel export.

A visual laboratory for **Gradual Evolution synthesis of multilayer optical coatings**. Draw a piecewise-constant reflectance target and watch a single layer evolve through thickness refinement, analytic needle insertion, deliberate thickness growth, cleanup, and final optimization.

The English interface is designed for live demonstrations. A persistent Input parameters panel sits beside the dominant reflectance spectrum, needle sensitivity, living stack and merit history. Larger type, a bold target, deliberate insertion timing and a physically scaled magnified insertion view keep the process readable. Target-band editing, layer recipes and detailed logs open in separate dialogs. Calculations run in your browser; no account, backend, external service, or runtime dependency is required.

## Run locally

Requires **Node.js 20 or newer**. There are no packages to install.

```sh
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

```sh
npm test
npm run build
```

The build creates a standalone static application in `dist/`. Serve that directory with any static HTTP server. For a local build preview:

```sh
node scripts/serve.mjs dist
```

Use HTTP rather than opening `index.html` directly; the application uses JavaScript modules.

## Demonstrate a synthesis

The initial demonstration is a 95% reflector over **450–650 nm**, starting from 100 nm of Ta2O5 on BK7. With the supplied limits it reaches the `10⁻⁴` MSE threshold. Broader or sharper targets can need more layers, optical thickness or evolution cycles.

1. Use the visible **Input parameters** panel to choose the low- and high-index materials, substrate, starting material, and starting geometric thickness.
2. Set the wavelength interval and spectral sample count. Choose **Mirror**, **Edge filter**, **Anti-reflection**, or **Band reflector** as a starting target.
3. Drag a target level vertically to change reflectance. Drag a boundary horizontally to move it in wavelength, including the two interval-end handles. **Edit target** provides numerical band editing.
4. Set the maximum layer count, maximum **total optical thickness** `Σ nᵢdᵢ`, and **Maximum merit**. The merit is the mean squared difference between computed and target fractional reflectance.
5. Select **Start evolution**; the same button pauses and resumes the run. Use **Pace** to change demonstration speed and **Present** for a larger presentation view. The stop control keeps the best observed design; reset returns to the starting layer.
6. Inspect **Needle sensitivity**, select a layer in **The living stack**, and open **Layer recipe**. Choose **Export Excel** to download the result.

Negative needle sensitivity identifies a promising replacement of host material. A growth step can temporarily raise the merit: this is an intentional part of Gradual Evolution. The solver retains the best feasible design found.

The `.xlsx` workbook includes the target and computed spectrum, residuals, layer materials and refractive indices, geometric and optical thicknesses, run settings, and recorded evolution checkpoints. Layer 1 faces air in both the application and export.

The needle chart retains the **last scanned structure** while refinement changes the current stack. Intermediate LM frames are batched for presentation; the numerical solver still evaluates every accepted step.

## Version 1.3 visible input parameters

All original inputs are visible together in the left panel: wavelength bounds, L/H materials, substrate, spectral point count, maximum layers, maximum total optical thickness, maximum MSE, starting material and geometric thickness. Changing a field, or pressing Enter in a numeric input, updates the starting design. Inputs retain their saved values and are locked while synthesis is running or paused. Cleanup and cycle limits remain under Advanced controls.

Present temporarily gives the panel's space to the charts. Select Input parameters to return to the complete setup view. On narrow screens the parameter panel appears above the charts. See [version 1.3 release notes](docs/RELEASE-v1.3.0.md).

## Version 1.2 engineering dashboard

The spectrum has a substantially larger plotting area, with a fine vector grid and wavelength ticks adapted to the available width. Needle sensitivity and convergence are grouped at the right; the physical stack, insertion detail and live numerical summary sit below. All remain visible together on a desktop. Click the spectrum away from a target handle to inspect wavelength, target/current reflectance and signed error in percentage points. **Fit R** expands small reflectance differences vertically; **Full R** restores the full physical 0–100% range.

**Merit function** now labels the actual nonnegative MSE on its logarithmic axis, such as `0.01` or `1e−4`, rather than displaying negative values of `log10(MSE)`. A dashed green guide marks the requested limit. Exact zero gets its own explicitly explained marker below the positive logarithmic range. Negative values on **Needle sensitivity** are valid derivatives and identify improving insertion directions.

See [version 1.2 release notes](docs/RELEASE-v1.2.0.md).

## Version 1.1 verification and presentation

- **Live** holds a needle insertion for 1.9 seconds; **Cinematic** holds it for 3.2 seconds. The local detail enlarges the insertion neighborhood while preserving relative thicknesses. Pause freezes the numerical stage and visual motion; Fast removes presentation holds.
- At completion, an independent denser wavelength grid includes the requested points and both sides of every target jump. The final displayed spectrum uses this grid. The main merit remains the objective on the requested optimization points; the status reports the separate dense check.
- Excel preserves the original **Spectrum** sheet and adds **Verification**, including the denser spectrum, residuals and boundary probes. This is a finite sampling check, not a proof of a continuous-band tolerance.
- The numerical audit checks Fresnel reflectance, energy conservation, analytic sensitivities, constrained LM, growth, cleanup and the retained best design. Compensated phase evaluation improves narrow-resonance accuracy. See [verification evidence](docs/VERIFICATION.md) and [release notes](docs/RELEASE-v1.1.0.md).

## Physical model

- Normal incidence from air, `n = 1`, onto a coating on semi-infinite BK7, `n = 1.52`.
- Two homogeneous, isotropic materials with constant real refractive indices; no absorption or dispersion.
- Wavelengths and thicknesses in nanometers; reflectance is an energy coefficient between 0 and 1.
- Analytic characteristic-matrix thickness and needle derivatives, with constrained Levenberg–Marquardt refinement.

Catalog names represent the specified ideal constant-index model, including materials that absorb or disperse in real use. Results are numerical designs under these assumptions, not manufacturing qualification. A requested target may be unattainable; termination and merit describe what the bounded local search achieved.

Read [the mathematical method and verification references](docs/METHOD.md) for equations, the actual search policy, limits, and source page numbers.

## Repository

- `src/optics.js` — forward optical model and analytic sensitivities.
- `src/optimizer.js` — constrained refinement and Gradual Evolution.
- `src/export.js` — genuine Office Open XML workbook export.
- `tests/` — numerical and export checks.
- `docs/METHOD.md` — mathematical conventions and references.

Source books and private reference documents are not distributed with this release.
