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

The original GPU/reference conformance is exercised on small fixtures. Moving
basin quality and measured equal-simulated-time cost remain open. The opt-in
wall extension below adds a separate numerical/native evidence boundary.
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

An experimental pressure bandwidth control,
`finger_fluid_ipbf_pressure_radius_scale` (API `ipbfPressureRadiusScale`),
multiplies only IPBF's cubic support radius. Default1 preserves the integration
above. Particle volume continues to use the unmodified base kernel calibration;
host collision, optical footprint, and retained non-pressure kernels keep their
existing radii. Runtime `ipbfSettings` records the scale, resulting radius, and
particle volume. Nonpositive/nonfinite values and custom scales under PBF fail
explicitly. This separates a density-sampling experiment from changing the
amount of water; no moving-quality or timing result is established by the control.

The grid traverses cell bounds of full cubic support rather than assuming a
fixed27-cell stencil, and skips dormant particles. Density ratio is stored in
incumbent units for classification/cohesion; pressure uses the dimensionless
clamped constraint. Density/gradient and update stages remain globally ordered.

Integration limits: collision projection uses existing host boundaries. Default
IPBF uses collision-only pressure; the opt-in wall mode below adds cubic
tangent-plane density support. Viscosity, vorticity, cohesion,
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

The existing `finger-fluid-truth-witness.mjs` reads the expected pressure method
from the supplied URL, checks effective method/backend/route/boundary at
initialization and checkpoints, and explicitly passes that boundary to the
trajectory validator. Its launcher consumes the existing independent-browser
helper and requires KAMINOS_CHROME. Command-construction tests reject operator
Chrome and require mock-keychain flags. This caller wiring is checked locally;
the preview evidence above is the separate inspected live basin route.

## Opt-in cubic wall support

Select `finger_fluid_ipbf_boundary=tangent_plane` with IPBF. Default is
`collision_only`. Requesting wall support under PBF or an unknown mode fails
explicitly. The first host adaptation supports the existing analytic basin and
sphere; moving-heightfield admission is explicitly rejected. Runtime/snapshot
identity is `ipbf-cubic-tangent-plane-density-v1`, distinct from collision-only.

For a flat wall with distance d increasing toward fluid, the normalized cubic
solid contribution is B(d)=2*pi*integral_d^R r*(r-d)*W(r)dr. With q=d/R in[0,1],
B=.5-1.4q+(8/3)q^3-4.8q^5+3.2q^6 below.5; above.5 use
B=(1-q)^5*(1.6-(16/15)*(1-q)). Inside the wall B(-d)=1-B(d). Outside kernel
support it saturates at0or1 with zero derivatives. Its first and second
derivatives contribute to the density constraint's self gradient and Hessian;
the particle-neighbor terms remain unchanged. The CPU reference accepts fixed
`boundaryPlanes` with finite unit normals and offsets. Independent kernel
quadrature and finite differences check the integral, energy force and Hessian.

The live geometry uses the physical solid surface before collision-radius
expansion. Each pressure evaluation approximates the local terrain/sphere with
a frozen tangent plane. Curvature derivatives and true curved-solid kernel
integration are omitted. For overlapping floor/sphere contributions, the
bounded product union A+B-AB is an approximation; its derivatives include both
cross terms. This is a disclosed host extension rather than an assertion that
the paper prescribes these boundary conditions. Collision and inlet transforms
remain shared between the main and alternate damping candidates.

The existing explicit diagnostic readback can optionally retain every particle
record as f32 bit patterns: `requestDiagnostics({captureParticleState:true})`.
The bench diagnostic entrypoint forwards the same option. Count, step, packing
and effective pressure boundary accompany all16words/particle; invalid shape
or identity fails. Integer words preserve nonfinite bits for diagnosis rather
than JSON-coercing them to null. This adds no readback to ordinary serving and
no additional GPU copy to the existing explicit diagnostic operation.

Wall-only constraints can produce semidefinite pressure blocks. The solver
returns the minimum-norm f/trace(H) solution when H*f=trace(H)*f within32machine
epsilons (f64reference/f32native); this covers the consistent rank-one block
without adding pressure regularization. Exactly zero unforced coordinates are
held at zero while the remaining block is solved. Unsupported singular blocks
still fail the reference rather than introducing a tunable stabilizer. Tests
cover axis-aligned and oblique wall-only motion and H*delta=force.

An explicit full-particle request fails visibly if another diagnostic readback
is pending or the runtime is stopped. It cannot complete with an old sparse
capture. Ordinary diagnostic callers retain the existing cached-return behavior.

## Material response calibration station

`tools/ipbf-material-calibration.mjs` audits explicit caller-owned JSON inputs
offline and can dispatch the actual factory's isolated cohesion stage on native
Apple WebGPU. Supply `--repo-root`, its full `--revision`, `--config` and
`--out-dir`; native runs also require `--native`, `--base-url` serving that exact
checkout and the independent browser executable in `KAMINOS_CHROME`. The full
input, source digests, effective GPU packet and all fixture vectors are retained.
A failure writes `report.json` with its phase. `complete` means measurement
completed; mechanical targets may still fail.

The input names the IPBF pressure and recovered `ipbf_free_surface` cohesion
routes, base `kernelRadius`, `particleVolume`, `pressureRadius`, `beta`, positive
gravity magnitude, `dt`, pressure `passes` and cohesion gain. It also declares
`resolutionVolumeScales` and native cases with name, dt and strength. Ideal
compact-support cubic-lattice quadrature reports R/cbrt(V), bulk and incomplete
surface support. It is reference-volume spacing, not live neighbor spacing.

Recovered cohesion uses a gravity-relative acceleration gain. Its per-particle
neighbor-weight normalization can break reciprocal internal momentum in an
asymmetric closed cluster. The station reports that failure explicitly; a gain
does not yet identify physical surface tension. Paper damping's beta*R is a
world-distance threshold, not kinematic viscosity. Holding beta*R constant
preserves that threshold, without establishing whole-solver timestep invariance.
Neither the station nor manually selected basin values establish physical water
defaults. These measurements exclude pressure, contacts, classification and
basin trajectory; the remaining motion must be judged on an exercised consumer.
