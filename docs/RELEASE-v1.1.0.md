# MS Astra 1.1.0

The synthesis is now visible as one desktop workspace: a dominant target/current reflectance plot, needle sensitivity, the living stack and merit history remain on screen together. Text and chart labels are substantially larger; the target curve is darker and thicker.

Needle insertion is deliberately paced (1.9 seconds in Live, 3.2 seconds in Cinematic), with the inserted layer highlighted and shown in a physically scaled magnified neighborhood. Pause freezes the solver, spectrum transition and layer animations. Design settings, target bands, layer recipe and event log use readable dialogs.

Numerical corrections preserve the actual best evaluated design during cleanup and normalization, including an exactly matched target. Compensated optical phase arithmetic improves narrow-resonance precision. Final designs are independently checked on a denser spectral grid, including both sides of target jumps. The final curve displays that grid; Excel adds a Verification sheet while preserving the requested-grid Spectrum sheet.

Verification covers independent Fresnel/adjoint calculations, analytic derivatives, bounded LM subproblems, high-precision resonant fixtures, synthesis constraints, workbook integrity and actual worker Pause/Resume. See VERIFICATION.md for reproducible details and the remaining limits of local optimization and finite spectral sampling.

Open the application: https://costapop.github.io/MS-Astra/
