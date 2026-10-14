# MS Astra 1.3.0

Restored the first release's persistent input panel beside the engineering dashboard. Spectrum bounds, L/H materials, BK7 substrate, spectral point count, maximum layers, maximum total optical thickness, maximum MSE, starting material and starting geometric thickness are visible together. They use the existing calculation parameters and saved settings.

Numeric inputs can be confirmed with Enter. Field validation is shown in the panel, and inputs are locked during calculation and pause. The spectrum's draggable wavelength boundaries update the same inputs. Presentation mode can temporarily hide the panel; Input parameters returns to the full setup view.

Validation includes all 49 existing tests and browser checks of field changes, starting-layer recalculation, invalid input, pause locking, resumption and responsive layouts. A complete synthesis with changed wavelength limits, materials, point count, search limits and starting layer successfully used the new inputs.

Open the application: https://costapop.github.io/MS-Astra/
