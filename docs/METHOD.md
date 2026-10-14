# Mathematical method and verification

MS Astra implements normal-incidence reflectance synthesis for a stack of two real, constant-index materials. This document describes the numerical model and the bounded search used by release 1.1. It distinguishes analytic identities from numerical search heuristics.

## 1. Assumptions, order, and objective

The ambient is air with refractive index $n_a=1$. The substrate is semi-infinite BK7 with $n_s=1.52$. Layers are planar, homogeneous, isotropic, lossless, and nondispersive. There is no substrate rear surface, roughness, scattering, or incoherent propagation in the model. All wavelengths and physical thicknesses are in nanometers.

The application and workbook list layers **from air to substrate**: layer 1 is outermost. Both cited books use the reverse numbering, from substrate to air. Reversing the layer array, rather than changing the physical order, reconciles these conventions.

The interface samples the selected wavelength interval uniformly, including both ends. Piecewise-constant bands are right-continuous at internal boundaries; the final band includes the upper endpoint. For $L$ strictly increasing wavelengths, the requested energy reflectances satisfy $0\le R_l^{\mathrm{tar}}\le1$. The least-squares residual and merit are

$$
e_l=\frac{R_l-R_l^{\mathrm{tar}}}{\sqrt L},\qquad
F=\sum_{l=1}^L e_l^2=\frac1L\sum_{l=1}^L(R_l-R_l^{\mathrm{tar}})^2.
$$

There is no factor of $1/2$ in the reported merit. RMS reflectance error is $\sqrt F$; RMS error in percentage points is $100\sqrt F$. **Target merit** is a success threshold $F\le F_{\mathrm{target}}$, not a ceiling on exploratory intermediate designs.

The total geometric thickness and total optical thickness are different:

$$
D_{\mathrm{geom}}=\sum_j d_j,\qquad D_{\mathrm{opt}}=\sum_j n_jd_j.
$$

The user limit applies to $D_{\mathrm{opt}}$. The coating and needle-position views use geometric depth from the air side. Because the indices are nondispersive, optical thickness does not require a reference wavelength.

## 2. Forward characteristic-matrix calculation

Set $k=2\pi/\lambda$ and $\phi_j=kn_jd_j$. With the $\exp(+i\omega t)$ convention, the characteristic matrix of a layer is

$$
M_j(d_j)=
\begin{pmatrix}
\cos\phi_j & i\sin\phi_j/n_j\\
in_j\sin\phi_j & \cos\phi_j
\end{pmatrix}.
$$

For the application's air-to-substrate numbering,

$$
M=M_1M_2\cdots M_N.
$$

This is the same physical product as $M_N\cdots M_1$ under the books' substrate-to-air numbering. Define

$$
U=M_{11}+n_sM_{12},\quad V=M_{21}+n_sM_{22},\quad D=n_aU+V.
$$

The amplitudes and energy coefficients are

$$
r=\frac{n_aU-V}{D},\qquad t=\frac{2n_a}{D},\qquad
R=|r|^2,\qquad T=\frac{n_s}{n_a}|t|^2.
$$

For these lossless media, $R+T=1$. At normal incidence the two polarization results coincide. An empty coating gives the Fresnel result $R=[(n_a-n_s)/(n_a+n_s)]^2$.

The implementation stores a matrix as four real numbers $[a,b,c,d]$ representing $\left(\begin{smallmatrix}a&ib\\ic&d\end{smallmatrix}\right)$. This representation is closed under multiplication for the stated model; it preserves the complex phases without allocating general complex objects. To avoid amplified phase-rounding error in narrow resonances, the implementation computes $n_jd_j/\lambda$ with compensated product/division arithmetic and reduces the phase by an exact quarter cycle before evaluating sine and cosine. This improves accuracy near integer multiples of $\pi/2$ while leaving the physical model and analytic derivative formulas unchanged.

**Verification:** Furman–Tikhonravov [1], §1.2.1, pp22–27, especially (1.2.9), (1.2.11), and (1.2.13)–(1.2.14). Tikhonravov [2], Appendix 1.1, printed pp102–107. The definition $n_jd_j$ is in [2], §1.1.1, printed p2.

## 3. Analytic thickness derivatives and LM refinement

For a layer with fixed refractive index,

$$
G_j=ik\begin{pmatrix}0&1\\n_j^2&0\end{pmatrix},\qquad
M_j(d)=\exp(dG_j),\qquad
\frac{\partial M_j}{\partial d_j}=G_jM_j.
$$

Thus, under the application's ordering,

$$
K_j=\frac{\partial M}{\partial d_j}
=M_1\cdots M_{j-1}(G_jM_j)M_{j+1}\cdots M_N.
$$

Prefix and suffix products give all thickness derivatives in two matrix passes per wavelength. For any matrix sensitivity $K$, including a thickness or needle sensitivity, define

$$
\dot U=K_{11}+n_sK_{12},\qquad
\dot V=K_{21}+n_sK_{22}.
$$

Then

$$
\dot r=\frac{n_a(1-r)\dot U-(1+r)\dot V}{D},\qquad
\dot R=2\operatorname{Re}(r^*\dot r).
$$

The code evaluates the algebraically equivalent derivative of the squared complex numerator divided by the squared complex denominator. Neither optimization nor needle scanning estimates derivatives by finite differences.

For $J_{lj}=\partial R_l/\partial d_j/\sqrt L$,

$$
\nabla F=2J^Te.
$$

Levenberg–Marquardt uses the damped positive-definite quadratic model

$$
H=J^TJ+\mu\,\operatorname{diag}\bigl(\max[(J^TJ)_{jj},10^{-10}]\bigr)+10^{-16}I.
$$

The update $p$ minimizes

$$
\frac12p^THp+(J^Te)^Tp
$$

subject to

$$
d_j+p_j\ge0,\qquad \sum_j n_j(d_j+p_j)\le D_{\mathrm{opt,max}}.
$$

A primal active-set solver includes nonnegative thickness and optical-thickness constraints in this subproblem. Cholesky solves the reduced positive-definite systems. An accepted nonlinear step must decrease the actual merit; damping decreases after success and increases after failure. Refinement stops on its iteration budget, a proposed step norm below $10^{-7}$nm, an accepted improvement below $10^{-10}\max(F,10^{-8})$, or excessive damping. Reaching these numerical tolerances is not a proof of an exact stationary point.

**Verification:** [1], §1.4.1, pp58–62, especially (1.4.6)–(1.4.9) and the intensity derivative on p62; [2], Appendix 1.2, printed pp107–109, (A1.10)–(A1.21); supplied specification [3], §8.2, p14, (8.7)–(8.10).

## 4. Analytic replacement-needle derivative

A needle replaces a small interval of its host material with the other allowed material. It preserves total **geometric** thickness during the initial insertion. It generally changes total optical thickness.

Let $x$ be a position measured from the air-side boundary of host layer $h$. Split the product as

$$
A(x)=M_1\cdots M_{h-1}M_h(x),\qquad
B(x)=M_h(d_h-x)M_{h+1}\cdots M_N,\qquad M=A(x)B(x).
$$

For a centered replacement of width $\eta$, the modified local product is

$$
M_{\mathrm{new}}(\eta)=A(x)e^{-\eta G_h/2}e^{\eta G_m}e^{-\eta G_h/2}B(x).
$$

Consequently,

$$
K_m(x)=\left.\frac{\partial M_{\mathrm{new}}}{\partial\eta}\right|_{0^+}
=A(x)(G_m-G_h)B(x),
$$

$$
G_m-G_h=ik(n_m^2-n_h^2)\begin{pmatrix}0&0\\1&0\end{pmatrix}.
$$

Using the same optical sensitivity operator from §3 gives

$$
g_m(x)=\left.\frac{\partial F_{\mathrm{new}}}{\partial\eta}\right|_{0^+}
=\frac2L\sum_l(R_l-R_l^{\mathrm{tar}})\dot R_l[K_m(x)].
$$

The plotted derivative has units of MSE per nm. A negative value identifies a first-order descent direction. A finite insertion still requires an actual merit check.

For an interior centered needle, the host remnants have thicknesses $x-\eta/2$ and $d_h-x-\eta/2$; hence $\eta\le2\min(x,d_h-x)$. At an endpoint the replacement is one-sided. The semi-infinite ambient and substrate are unchanged. A strict interior needle creates two additional layers; an endpoint needle can add one. Algebraic normalization removes only exactly zero-thickness layers and merges equal adjacent materials. Strictly positive thin layers belong to the separate cleanup trial. When normalization changes a geometry, its spectrum and merit are recomputed; the best evaluated recipe is retained if floating-point rounding makes the normalized result worse.

**Why replacement matters:** additive insertion without removing host material would have $K_{\mathrm{add}}=AG_mB$, and

$$
g_{\mathrm{add}}=g_{\mathrm{replace}}+\frac{\partial F}{\partial d_h}.
$$

The derivatives agree only at appropriate unconstrained stationarity. MS Astra consistently uses the replacement derivative and replacement geometry.

The book's equivalent admittance/adjoint criterion is $g_m(z)=P(z)(n_m^2-n_h^2)$, where $P(z)=\sum_l k_l\operatorname{Im}\Psi(z,\lambda_l)$. The matrix form above avoids separately integrating the adjoint while preserving that exact derivative.

**Verification:** [1], §2.2.2, pp119–124, particularly (2.2.18)–(2.2.19) on p121; [2], Appendix 1.2, printed pp109–112, especially (A1.22)–(A1.29); [3], §§7–9, pp12–16.

## 5. Search policy in release 1.1

1. **Start and refine.** Begin with the user-selected single L or H layer. Refine all thicknesses with constrained LM and update the best-feasible archive.
2. **Scan and insert.** Sample the analytic replacement derivative in each layer with geometric spacing no larger than $\lambda_{\min}/(32n_h)$ and at least eight intervals per layer. Retain endpoint directions in the scan and refine sampled interior minima by a bounded golden-section search. Before allocating the insertion-candidate budget, filter internal-interface replacements that merely shift an existing boundary into the adjacent material: these are thickness-refinement directions rather than new-layer insertions. The plotted scan still includes their derivatives. Rank the remaining candidates by most negative derivative; the insertion threshold is $g<-10^{-11}$nm$^{-1}$.
3. **Check finite width.** Try the first feasible descent candidate among the configured candidate budget. The initial width is at most 6nm, 20% of host thickness, and $\lambda_{\min}/(32n_m)$, further reduced to fit the geometry and optical limit. Halve it until an Armijo check passes:

   $$F_{\mathrm{trial}}\le F_{\mathrm{parent}}+10^{-4}\eta g_m.$$

   The actual improvement must additionally exceed $\max(10^{-13},10^{-8}F_{\mathrm{parent}})$. Backtracking allows at most 18 widths, with a minimum width of $10^{-6}$nm. An accepted insertion must increase the normalized layer count. Refine the accepted new structure, then rescan. This is a bounded raw-Armijo policy; it does **not** refine every candidate independently and is not exhaustive deep search.
4. **Grow.** When this bounded needle cycle ends, scan increasing thickness for each existing layer with the other layers fixed. Locate a negative-to-positive zero crossing of the analytic one-dimensional merit derivative and refine its bracket. This identifies a higher local thickness minimum. Among available candidates, take the one with the lowest resulting merit. Previously visited growth states are skipped.
5. **Repeat.** Resume refinement and needle insertion from the grown structure. The current merit can increase at a growth step. Preserve the best feasible design separately.
6. **Clean up and polish.** Return to the best archived design. Remove layers below the cleanup threshold as a trial, merge equal neighbors, and refine it. Keep cleanup only if its recomputed merit does not increase. Retain the actual best evaluated recipe even when normalization changes only the last floating-point bits. Perform final constrained refinement.

Default solver budgets are 70 LM iterations per refinement, eight ranked needle candidates, 32 accepted needles per outer cycle, and eight outer cycles. Cleanup allows 100 refinement iterations and final polishing 120. A growth search is limited to an added optical thickness of $2\lambda_{\max}$ per tested layer, also bounded by the remaining total optical thickness. The browser exposes outer-cycle and cleanup controls; presentation pace changes display timing, not the mathematical objective.

Very small layers can remain if deleting them worsens the solution. Cleanup must not increase the merit; it is not a guaranteed manufacturing minimum. Boundary movements excluded from structural insertion can still have nonzero derivatives when refinement has exhausted its numerical budget. The growth scan and finite candidate budgets can miss useful alternatives. The solver does not claim to have completed an exhaustive needle cycle if a numerical budget was reached.

**Gradual Evolution verification:** [2], §1.2.3, printed pp30–36, especially pp31–33 and Figs1.16–1.17, describes completing needle optimization, forcing a layer to its next higher local merit minimum, and repeating needle optimization. It also describes testing layers to minimize degradation. The method is explicitly non-monotonic. [3], §12.4, pp22–23, gives the same higher-minimum search prescription. [1], §2.2.3, pp124–126, supports the needle/refinement/deletion/refinement cycle.

## 6. Constraints, stopping, and interpretation

The browser worker may combine small consecutive LM updates into one displayed checkpoint. Spectrum interpolation animates transitions between computed states; it does not add solver iterations or independently calculated intermediate spectra. The needle panel retains the most recent scan and its own geometry until the next scan. The worker sends archive checkpoints for batched LM updates, so manual stopping retains the best received computed recipe, including steps that were not individually animated.

The design must respect the layer-count and total optical-thickness bounds. LM enforces thickness nonnegativity and the optical limit; finite insertion is checked against both structural limits. An infeasible starting layer is rejected.

The result reports whether the target MSE was attained on the specified discrete spectral grid, or whether an evolution budget or permitted growth search was exhausted. A limit can prevent additional insertions without preventing useful refinement or growth of the existing layers. An unachieved target is not reported as success.

After synthesis, a separate verification spectrum checks the final recipe on at least $\max(2001,4L-3)$ uniform points, together with the original optimization points and samples immediately below, at, and above every target jump. Duplicate wavelengths are removed. At a jump the target is right-continuous. The one-sided probe offset is $\max[(\lambda_{\max}-\lambda_{\min})10^{-9},8\epsilon_{\mathrm{machine}}|\lambda_{\mathrm{jump}}|]$, limited to a quarter of the smaller neighboring band width.

The verification report gives its actual point count, unweighted MSE over this augmented grid, maximum absolute reflectance error, and whether its MSE meets the same threshold. Its MSE is a different discrete average from the optimized one; the maximum error is reported separately and is not a user-specified acceptance limit. A requested-grid pass can therefore coexist with a verification-grid failure. This final check does not restart optimization or replace its objective.

The completed spectrum can display these denser samples. Excel preserves the user-requested optimization grid in **Spectrum**, writes the independent samples and signed/squared/absolute residuals in **Verification**, and includes both sets of diagnostics in **Run settings**. Between-sample curve segments are visual interpolation. Arbitrary nonconstant sample arrays without a piecewise target definition have no implied between-point target, so the programmatic verifier returns no dense check for that case.

Finite spectral sampling is not a proof of a continuous-band tolerance, particularly for discontinuous targets or resonances narrower than the sample spacing. Changing the spectral sample count changes the discrete objective. The verification follows [3], §10 p17, §12.1 p21, §12.3 p22, and the independent-grid examples in §13 pp25–27.

Neither a local thickness minimum nor nonnegative sampled needle derivatives establishes global optimality. Results depend on the starting material and thickness, spectral grid, search budgets, and allowable thickness. An arbitrary step target may be impossible under the stated constraints. Real manufacturing also requires wavelength-dependent optical constants, absorption, tolerances, and process constraints outside this demonstration's model.

## 7. Numerical checks and reproducible fixture

The test suite checks physical identities, analytic sensitivities against finite differences, constrained refinement, the growth prescription, synthesis limits, and workbook export. Finite differences are a verification tool only.

A reproducible fixture from [3], §13, pp23–28, uses $n_a=1$, $n_s=1.52$, $n_H=2.30$, $n_L=1.38$, 77 wavelengths $420+5l$nm for $l=0\ldots76$, and a constant target $R=0.20$.

In the **source's substrate-to-air ordering**, the refined four-layer HLHL design is

$$[95.3778,\ 65.2239,\ 145.7781,\ 105.6838]\ \mathrm{nm},$$

with $F\simeq2.25678035\times10^{-4}$. The strongest replacement derivative is an L needle inside the third H layer, 117.2178nm from that layer's substrate-side boundary, with $g\simeq-3.913998\times10^{-5}\,\mathrm{nm}^{-1}$. A centered 0.1nm replacement gives $F\simeq2.22017256\times10^{-4}$.

For application-order arrays, reverse the layer sequence. The same host is array index 1, and its local air-side coordinate is $145.7781-117.2178=28.5603$nm. The printed dimensions are rounded, so the last digits of the computed derivative differ slightly from the source's higher-precision result.

The books verify the formulas and method. These exact numerical fixture values come from the supplied specification, not from the books. The specification explicitly states that its own numerical examples did not include a Gradual Evolution experiment; the release's growth implementation is checked separately.

The independent calculation audit also compares the matrix implementation with a separately implemented scalar Fresnel recursion and the book’s admittance/adjoint derivatives, including randomized stacks and high-precision resonant-cavity cases. See [numerical verification](VERIFICATION.md) for the recorded checks and precision limits. Passing these checks validates the tested calculations; it does not establish global optimality or certify every possible continuous spectrum.

## References

1. **Sh. A. Furman and A. V. Tikhonravov.** *Basics of Optics of Multilayer Systems*. Editions Frontieres, Gif-sur-Yvette, 1992. The supplied 133-page excerpt has matching printed/PDF page numbering. Relevant sections: §1.2.1 pp22–27, §1.4.1 pp58–62, §2.2 pp114–129.
2. **Alexander Tikhonravov.** *Optical Coatings: Design, Characterization, Monitoring*. SPIE Press, 2024, volume PM372. ISBN 9781510672468. Relevant: §1.1.1 pp1–2, §1.2.2 pp20–29, §1.2.3 pp30–36, Appendix 1.2 pp107–112. In the supplied ebook, add 10 to these printed numbers to obtain PDF page numbers; for example, printed pp31–33 are PDF pp41–43.
3. **Needle Optimization: Метод синтеза многослойных оптических покрытий.** User-supplied technical specification, version 1.1, 8 October 2026, 39 pages. Relevant: §§2–5, §§7–10, §12.4, §13, and Appendix C.

Only equations, implementation explanations, and bibliographic references are included in this repository. The source books, private specification, extracted book text, and scanned pages are not distributed.
