# Numerical verification and audit

Audit date: 14 October 2026. The model is normal incidence from air onto isotropic, homogeneous, lossless, nondispersive layers and a semi-infinite substrate. Lengths are in nm; energy reflectance is fractional (`0.95` means 95%). The objective is the unweighted mean squared reflectance error, without a factor of one half. A threshold of `1e-4` therefore corresponds to RMS error `0.01`, not a pointwise error bound.

## Reproduce the checks

From the repository root:

```sh
npm test
python3 tests/independent-audit.py
```

The scientific JavaScript suite currently contains 19 tests. The optional independent audit uses only Python's standard library and Node; it needs no NumPy, SciPy, downloaded reference data, or scratch files. When Node is not on `PATH`, pass `--node /absolute/path/to/node`. Its tracked producer, [audit-cases.mjs](../tests/audit-cases.mjs), generates all inputs, and [independent-audit.py](../tests/independent-audit.py) prints the measured errors and fails on regression.

The independent audit does not call the production formulas to generate its reference answers. It uses scalar Fresnel scattering recursion for reflectance and the book's complex admittance/adjoint recursions for the analytic thickness and needle derivatives. Difficult resonances are additionally evaluated with 85-digit `Decimal` arithmetic and independently evaluated sine/cosine series.

## Optical calculations and derivatives

The deterministic random audit uses LCG seed `0x694fa128`, multiplier `1664525`, increment `1013904223`, and unsigned 32-bit arithmetic. Its 60 stacks contain 1, 2, 3, 7, 16, 32, or 80 layers; indices range from 1.38 to 3.95; wavelengths range from 100 to 23,600 nm; total optical thickness is at most 95,000 nm. Selected cases contain a `1e-6 nm` layer. Needles are checked at both endpoints and at three interior positions.

Measured maximum absolute discrepancies after the audit fixes:

| Check | Comparisons | Maximum discrepancy |
|---|---:|---:|
| Reflectance versus independent Fresnel recursion | 540 | `7.38e-14` |
| Energy conservation, `R + T - 1` | 540 | `2.00e-15` |
| Spectral thickness Jacobian versus independent adjoint | 10,269 | `6.41e-14 nm^-1` |
| MSE thickness gradient versus independent adjoint | 1,141 | `2.06e-15 nm^-1` |
| Replacement-needle MSE derivative versus independent adjoint | 765 | `2.41e-16 nm^-1` |

Ordinary double-precision reference calculations themselves incur phase rounding. The audit reports absolute errors and scaled errors separately; relative error near a zero derivative is not a useful accuracy claim. A separate finite-difference check of the independent Fresnel model has maximum absolute Jacobian discrepancy `1.03e-8 nm^-1` with its fixed step rule. That looser figure includes differencing/truncation error; the independent analytic adjoint comparison is the stronger derivative check.

The JavaScript regressions also cover bare-substrate Fresnel reflectance, zero-thickness identity, quarter-wave antireflection, splitting/merging equal layers, all thickness derivatives versus central differences, and finite replacement needles at interior and endpoint positions. The supplied notes' worked example is reproduced: initial four-layer MSE `2.25678035056e-4`, expected interior needle location and derivative, finite-width merit decrease, and refined six-layer MSE approximately `1.75996773e-4`.

## High-Q phase accuracy

The audit found a real floating-point problem in direct evaluation of `sin(2*pi*n*d/lambda)` and `cos(2*pi*n*d/lambda)` near quarter-wave phases. Small multiplication and trigonometric residuals were amplified by a narrow resonance. The implementation now uses a compensated product and division for optical phase and reduces to the nearest exact quarter turn before evaluating sine/cosine.

The reproducible stress fixtures are `(HL)^p H_half (LH)^p` at 550 nm, with `nH=3.95`, `nL=1.38`, quarter-wave thicknesses computed as JavaScript doubles `550/(4*n)`, and central thickness `550/(2*nH)`. The reference converts the **exact binary input values** with `Decimal(float)`, rather than treating their short printed decimal representations as exact physical values.

| Fixture | 85-digit reference R | Absolute R error after correction | Relative center-thickness derivative error | Relative needle derivative error |
|---|---:|---:|---:|---:|
| 61 layers, `p=15` | `0.042700210129343054687...` | `1.17e-17` | `6.05e-15` | `6.43e-15` |
| 77 layers, `p=19` | `0.999624566768825394717...` | `1.03e-17` | `1.30e-13` | `1.34e-13` |

The needle check replaces central H material by L at position `0.271*d`, with target `R=0.2`. Before phase compensation, the absolute R errors for these fixtures were approximately `6.72e-4` and `3.18e-4`. A conventional finite-difference step cannot verify these very narrow resonances, so their derivatives are compared directly with 85-digit analytic derivatives.

This fixes the demonstrated phase error. It does not make arbitrary high-Q designs insensitive to input rounding or guarantee arbitrary-precision accuracy for every possible resonator.

## Optimization, constraints, and archived results

The damped LM quadratic subproblem enforces nonnegative thicknesses and the total optical-thickness cap internally. A separate test enumerates every active constraint face on 160 deterministic positive-definite problems of dimension 1–5, using pivoted dense elimination rather than the production Cholesky/active-set solver. Seed: `8793127`, with the same LCG constants above. The maximum relative difference from the exhaustive minimum is `5.14e-13`. Cases include zero layers, an active optical cap, and simultaneous active constraints.

End-to-end tests check every emitted frame for feasible thicknesses, layer count, and total optical thickness. They also verify real structural insertions, the nearest higher monochromatic thickness minimum, explicit growth stages, actual merit recomputation, and return of the best archived design. The default mirror and all four broader-band presets are exercised; budget exhaustion is distinguished from meeting the target.

The audit corrected two state-management issues:

- Cleanup previously allowed a merit increase up to `1e-13`. That could discard an exact zero-MSE design and leave a contradictory completion message. Cleanup now requires actual non-increase, and final normalization cannot silently replace the best evaluated archive entry with a worse recipe.
- Algebraic normalization now removes only exact zero thicknesses by default. Positive thin layers are handled by the explicit cleanup decision. When normalization changes a search geometry, its spectrum and merit are recomputed before the next snapshot or archive comparison.

There is also a regression for a needle near an existing interface: if the first finite width consumes a host remnant, the search continues reducing its width rather than discarding the insertion position. Interface shifts that add no new structural variable remain LM directions, not new-layer events.

## Independent spectral verification

Optimization and `targetReached` retain the user-selected spectral points. The final result additionally evaluates the union of those points and a separate uniform grid of `max(2001, 4*N-3)` points. Each piecewise target discontinuity is sampled at the boundary and immediately on both sides. The returned verification contains actual wavelengths, target and calculated R, unweighted MSE, maximum absolute reflectance error, and a separate threshold result. Extra boundary probes are included in that discrete MSE; it is not a continuous integral norm.

The UI supplies the complete piecewise-constant target. For an external API caller supplying only arbitrary nonconstant target samples, verification is `null` unless target bands are also supplied: the engine does not invent between-point target values. A constant sample array defines a constant target and is checked directly. Supplied bands inconsistent with the optimization samples are rejected.

The sparse-grid regression is a physical aliasing example: a single `nH=3.95` film with optical thickness 42,000 nm is half-wave at all five wavelengths 400, 500, 600, 700, and 800 nm. It matches bare-substrate reflectance at those points essentially exactly, while the dense-grid MSE exceeds `0.1` and maximum absolute error exceeds `0.6`. The selected-grid success remains true and the independent check correctly fails.

For the fixed default 450–650 nm, 95% reflector demonstration:

| Quantity | Verified result |
|---|---:|
| Layers | 23 |
| Total optical thickness | `3093.83469224 nm` |
| MSE on 121 optimization points | `3.23208278294e-5` |
| Independent verification points | 2,081 |
| Independent MSE | `3.03470053399e-5` |
| Independent maximum absolute reflectance error | `0.01598355326` |
| Requested MSE threshold | `1e-4`, met on both grids |

The finite verification grid is a stronger diagnostic, not a certified continuous-band bound. In particular, abrupt target jumps and extremely narrow resonances require care. The optimizer is a bounded local/exploratory search: finite LM budgets, phase grids, candidate limits, and growth limits do not prove stationarity or global optimality, and failure to find a negative needle on the scan is not such a proof.

## Export and interface

Workbook tests cover ZIP integrity, OOXML relationships, numerical precision, residuals, formulas and cached totals, Unicode/XML escaping, layer order, input validation, and browser downloads. The independent verification is exported separately from the original optimization spectrum. An independent ZIP/XML and openpyxl read checks workbook values.

Browser checks cover real worker execution, pause/resume, stop, target-band editing, presentation mode, layer inspection, narrow and wide layouts, and Excel download. The application has no external runtime dependencies. See [METHOD.md](METHOD.md) for equations, source references, and the declared search budgets.

### Version 1.2 axis and dashboard checks

The merit remains a mean squared residual and cannot be negative for finite valid input. The previous negative y-axis labels were `log10(MSE)`, not negative objective values. The chart now labels actual MSE and places the requested threshold on the same logarithmic mapping. Eight additional tests check equal-ratio spacing, domain inclusion, exact-zero separation, identical/empty series, tiny positive values, extreme finite values and rejection of invalid or negative inputs. Three additional reflectance-range tests verify physical bounds, minimum span and padding for the Fit R view. The full suite has 49 passing tests.

The revised browser dashboard was checked at 1100 × 768, 1366 × 768 and 1440 × 900: all four visualizations fit within the viewport. At 390 × 844 it uses a vertical layout. A full browser run of the default mirror reproduces the result above, and actual rendered merit tick values are nonnegative. Click inspection evaluates the current coating directly at the selected wavelength.
