# MS Astra 1.2.0

The engineering dashboard gives the target/current reflectance spectrum the main working area. Its plotting area is approximately twice as large at 1366 × 768 as in version 1.1. Needle sensitivity and merit occupy a compact right column, with the coating structure, magnified insertion and live metrics below. All charts fit in a desktop viewport; narrow devices use a readable vertical layout.

The vector spectrum adds finer grid lines, adaptive wavelength ticks and click-to-inspect readings for wavelength, target/current reflectance and signed error in percentage points. Fit R magnifies the vertical scale around the target and current response, with Full R restoring 0–100%. Existing target editing and the presentation view remain available.

The Merit function y-axis now shows physical, nonnegative MSE values on a logarithmic scale instead of the negative logarithms previously used as labels. The requested MSE limit is drawn explicitly. Exact zero has a separate, explained marker; very small positive values are no longer flattened at 1e-14.

Validation: all 49 tests passed, including three reflectance-range cases and eight merit-scale cases covering logarithmic spacing, thresholds, exact zero, very small numbers and invalid input. Actual browser synthesis reached the same default mirror result: 23 layers, requested-grid MSE approximately 3.23208e-5 and independent-grid MSE approximately 3.03470e-5. Desktop, presentation and mobile layouts were checked in the browser.

Open the application: https://costapop.github.io/MS-Astra/
