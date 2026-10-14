# Release 1.0 verification

## Numerical tests

The automated suite includes independent Fresnel recursion, conservation `R+T=1`, the bare substrate, quarter-wave antireflection, splitting/merging invariance, central finite-difference checks of analytic thickness derivatives, and finite replacement checks of the analytic needle derivative at interior and boundary positions.

The worked example in the supplied needle-method notes is reproduced with initial merit `2.25678035056e-4`. Additional tests cover constrained LM recovery, active optical-thickness limits, the next higher local thickness minimum, finite-needle backtracking, best-design retention, thin-layer cleanup, and representative target shapes.

The default 450–650 nm, 95% reflector demonstration produces 23 layers with total optical thickness approximately `3093.835 nm`, and final MSE approximately `3.232083e-5`, below the `1e-4` stopping threshold. These figures are for the fixed release configuration; changes to target or constraints can give a different local solution.

Broadband 400–800 nm targets are also exercised. Tests explicitly distinguish a successful threshold from cycle-budget exhaustion. Passing the tests is numerical verification of this implementation under its model assumptions; it is not a guarantee of a global optimum or performance between spectral sample points.

## Export and interface

Workbook tests verify ZIP integrity, OOXML relationships, numerical precision, exact residuals, formulas and cached totals, Unicode/XML escaping, layer order, input validation, and browser download handling. An independent ZIP/XML and openpyxl read validates the generated workbook.

Browser checks cover real worker execution, pause/resume, stop, target-band editing, presentation mode, layer inspection, narrow and wide layouts, and a real Excel download. The application has no external runtime dependencies.

Run the full suite with `npm test`. See [METHOD.md](METHOD.md) for equations and the source references.
