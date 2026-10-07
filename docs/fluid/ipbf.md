# IPBF implementation: numerical contract and current boundary

Source: Diaz et al., *Implicit Position-Based Fluids*, SIGGRAPH Asia 2025,
https://www.cemyuksel.com/research/papers/ipbf.pdf. Inspected author PDF SHA-256:
`1ebe17eccc978d2b6a795fb4f3ea2d09d1b44b9b6b27c3e3308ca3736b5ba159`.

`finger-fluid-ipbf-reference.mjs` is a deterministic CPU reference for the
pressure update and paper damping. It uses the normalized 3D cubic spline with
support radius R, physical particle masses, and a caller-specified rest density.
It is an offline reference, not a live solver implementation or performance claim.

The canonical energy is equation 7:

    E = alpha/(2 dt²) sum_i m_i |x_i-y_i|² + 1/2 sum_i C_i²
    C_i = max(rho_i/rho0 - 1, 0)
    rho_i = sum_j m_j W(x_i-x_j)

At each iteration, all density constraints and their derivatives are computed
from the same positions. For particle i, every active neighboring constraint
contributes to force and its local 3x3 Hessian, including constraint i. Derivatives
of a neighboring density with respect to x_i use m_i; derivatives of its own
density use the neighbors' masses. Self-kernel value contributes to density,
but its derivative with respect to the jointly moved self position is zero.

Equation 15's outer-product term is retained. Its second derivative contribution
is replaced by a diagonal whose entries are the Euclidean norms of that term's
columns (section 3.5). The inertia diagonal alpha*m_i/dt² is retained. Each
local system is solved and all particle positions simultaneously receive half
of the update, as in section 3.3 and algorithm 1. No PBF correction cap, lambda
clamp, tensile correction or 0.22 relaxation is applied.

An entirely inactive pressure block with zero force returns zero update; it does
not invert a zero Hessian. Active blocks are solved with Cholesky. A non-positive
pivot fails explicitly instead of silently adding a tunable stabilizer.

For damping, compute an alternative position in the last iteration from the
*start* of that iteration, using the same inertial positions and alpha*=0.001.
Equations 16–18 then remove only excess kinetic energy while retaining velocity
direction. beta defaults to 60; damping settings are exposed in the return.

## Source inconsistency and interpretation

The printed equations 10 and 11 include an extra 1/2 before sums of derivatives
of E_j, despite equation 7's energy and equation 15's stated derivative. The
reference differentiates equation 7 directly and checks that force independently
by finite differences. A uniform factor cancels from a zero-compliance Newton
update, but changes the meaning of nonzero compliance. This interpretation is
explicit; it is not an author-confirmed erratum or proof of bit identity with
the authors' CUDA implementation.

## Falsifiable checks

`node --test tests/finger-fluid-ipbf-reference.test.mjs` checks normalized kernel
integral; gradient and Hessian finite differences; total energy gradient with
unequal masses; clamped sparse pressure; the approximate-Hessian construction
and positive quadratic forms; simultaneous permutation-invariant updates;
translation covariance and zero net internal force; damping energy/direction;
last-iteration alternative state; and malformed numerical inputs.

GPU/reference conformance, boundary support, actual emission/basin behavior,
effective runtime settings and measured equal-simulated-time cost remain open.
Integration must account for the current solver's kernel/volume units and
non-pressure scheduling explicitly. The parent's packed-density branch is not
included in this reference branch; an adoption comparison must consume that
accepted baseline or name the missing optimization.

## Native implementation and provisional basin integration

The shared WGSL math and dense conformance driver agree with the CPU reference
on four small Apple Metal3 fixtures at zero and nonzero compliance, including
a sparse particle and permutation. A deliberately doubled GPU update is
rejected. Production grid/boundary/cadence claims require the exercised route.

Select with `finger_fluid_pressure_solver=ipbf`; `pbf` remains default. Queries
expose compliance, alternate compliance, damping (0/1), and beta. Runtime
metadata exposes method, kernel, particle volume, damping and boundary model.
The state buffer is96 bytes/particle; incumbent stages retain their10 storage-binding layout. IPBF stages use a
separate smaller layout, including their extra state, within the same device
limit. Adaptive refinement is unsupported by this first integration.

Cubic support radius scales with the fixed-volume particle radius. Volume is
calibrated from the incumbent poly6 volume integral: V=(64*pi/315)*h^3/24.3,
times represented-volume scale. For h=0.185 this approximates0.055 spacing cubed.
This explicit calibration connects physical volume and the density target when
changing kernels; it is not the published implementation's particle units.

The grid traverses cell bounds of full cubic support rather than assuming a
fixed27-cell stencil, and skips dormant particles. Density ratio is stored in
incumbent units for classification/cohesion; pressure uses the dimensionless
clamped constraint. Density/gradient and update stages remain globally ordered.

Integration limits: collision projection uses existing host boundaries; IPBF
has no analytical boundary-density term yet. Viscosity, vorticity, cohesion,
inlet control and contact retain the post-projection schedule, differing from
the paper's constant non-pressure-force predictor. Paper damping replaces
uniform0.991 velocity damping. Inlet attenuation and collision projection
remain host operations. No equal-quality claim follows from conformance.

Optional-Pyro-clock repair is ported from4733c149. Its focused test reproduced
the null-debugState exception before repair and passes afterward. The broader
liquid-fire suite stops earlier at an existing flame-quench source regex.

The alternate damping candidate now receives exactly the same inlet attenuation,
collision and reservoir confinement as the main candidate through a shared host
position operation. Runtime and truth-snapshot boundary identity both declare
collision-only IPBF pressure, and PBF-only optimizations report bypass under
IPBF. A dedicated velocity stage applies paper damping before the retained
viscosity stage, allowing the IPBF state binding to stay out of the incumbent
full binding layout.

The bench consumer copies the effective solver identity into its root state.
The existing trajectory validator defaults to the incumbent boundary contract;
IPBF callers explicitly select `boundaryPressureContract` matching collision-only
pressure. Unknown contracts and mixed-contract checkpoints fail. Numerical and
scene-behavior thresholds remain unchanged. An accepted trajectory receipt
records its selected boundary and establishes those existing checks only,
not equality with PBF or production-quality water.
