# Cooling stone: experimental thermal phase-field MPM

Open the Workbench experiment with
?workspace=workbench&experiment=thermal-jointing. A hot, already solid block
cools from its exposed upper boundary. Persistent material points carry position,
velocity, deformation, temperature, intact fraction and maximum tensile-energy
history. GPU kernels perform initialization, neighbor search, transfer,
mechanics, heat evolution and phase solving. The shared scene renders the same
GPU state as deforming cells. JavaScript supplies orchestration and controls.

The purpose is to inspect cooling-driven contraction and fracture, eventually
supplying detailed offline material sources. No polygon columns or transverse
joints are prescribed. Displayed cells are a diagnostic material representation,
not a reconstructed smooth stone surface.

## Numerical construction and limits

The elastic law uses a Borden neo-Hookean split, retaining compressive resistance
as tensile/shear stiffness degrades. Temperature changes the stress-free stretch.
Temperature 1 is the initial hot solid and 0 the selected cold endpoint; the
contraction parameter is total fractional contraction, without basalt calibration.
Stress transferred to the grid is Kirchhoff stress, weighted by reference volume.

Quadratic APIC transfer uses two motion fields selected by particle damage
gradients. Fields combine where the separability criterion fails and otherwise
exchange unilateral contact/friction impulses. The prepared damaged-band fixture
tests this behavior; it is disabled in the cooling experiment. This does not
establish arbitrary junctions or subcell opening at every fracture orientation.

A matrix-free, lumped-mass preconditioned conjugate-gradient solve updates the
phase field. Its configurable iteration count is an approximation; irreversible
particle history and intact fraction survive transfer. Heat uses explicit
mass-weighted grid conduction and upper exposed-face cooling. Temperature is
transferred as a FLIP increment with an explicit [ambient, initial] extrema
limiter. The thermalLimiterApplications counter exposes its use. The limiter
removes spurious heating observed in unlimited transfer, but does not conserve
thermal energy exactly. Spatial/temporal convergence and heat calibration remain
unestablished.

Fixed-point integer atomics accumulate transfer and stiffness terms. Fault
counters reject nonfinite/out-of-range individual contributions, invalid
deformation and escaped grid support. A failed step may partially update
particles and must not be interpreted as completed state; reset restarts the
initial material. Per-contribution guards do not establish an aggregate overflow
bound for every user-selected extreme. Completed and submitted step counts are
separate. Material time advances by explicit dt, not the wall clock.

Live and exact offline advancement use the same solver. A single batch runs at
a time; presentation frames do not create a catch-up backlog. Inputs retain the
starting recipe. Snapshot export retains evolved particle state and effective
configuration; snapshot restoration, adaptive refinement, debris ownership
transfer and coupling to Grist/waves are subsequent work.

## Sources and checks

The material law and phase formulation follow
[CD-MPM](https://github.com/penn-graphics-research/ziran2019/tree/35742ac3ab1ae42cf2bbe8761fd7c8e630a638c4),
particularly NeoHookeanBorden.cpp and PhaseField.h. The damage-gradient
partition/contact follows
[TwoFieldMPM](https://github.com/penn-graphics-research/TwoFieldMPM/tree/79e4a15c3a3bcc2e30a0de2590c70c03a7e5c67c).
Both MIT licenses are retained adjacent to the port.

Run npm test -- --only tests/thermal-jointing-native.mjs,tests/thermal-mpm-native.mjs.
Native tests execute production WGSL on Apple hardware. Explicit Dawn null is
compiler/pipeline validation only. On this machine, direct launch can lack Metal
compiler XPC access; the managed host worker executes the native route.

Tests distinguish hot equilibrium, cooling gradients, persistent mass,
irreversible constitutive history and prepared-band independent motion. None of
these alone establishes emergent columnar fracture, geological fidelity or a
performance result. The first longer cooling probe showed widespread damage
without split motion nodes; inspect the actual scene before interpreting it.
