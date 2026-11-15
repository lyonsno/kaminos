# Thermal fracture source — initial constitutive operation

This is unfinished work, not an executable fracture experiment. No Workbench
entry is registered. The first consumer remains a live hot-solid block that
cools, contracts and opens cracks, feeding an offline learned-material source.

The first isolated question is whether an isotropic change in the material's
stress-free dimensions produces tensile driving energy under restraint while
allowing free contraction. `material-law.mjs` ports the positive-energy and
stress split from the MIT CD-MPM source and adds isotropic thermal rest stretch.
Temperature is normalized from 1 (initial hot solid) to 0 (selected cold endpoint).
The expansion parameter is the fractional free contraction over that interval,
not a calibrated basalt coefficient. Inputs must have positive elastic determinant
and positive thermal rest stretch; a solver must enforce those physical domains.
`tests/thermal-jointing-native.mjs` checks restraint stress, free contraction,
tensile/shear degradation, retained compression and irreversible history.
This operation is not yet connected to heat evolution or a motion solver.

Source: [Ziran/CD-MPM](https://github.com/penn-graphics-research/ziran2019/tree/35742ac3ab1ae42cf2bbe8761fd7c8e630a638c4),
specifically `NeoHookeanBorden.cpp`, `PhaseField.h` and `FractureSimulation.h`.
The original license is retained adjacent to the port. Source state carries
the phase value and maximum positive-energy history on particles. Its phase
solve uses matrix-free conjugate gradients on the temporary grid. Irreversibility
is applied when transferring solved phase back to particles. The inspected
mechanical transfer accumulates one grid velocity; it does not establish
arbitrarily fine independent crack-face motion inside shared grid support.

On November14,2026, direct Apple M4 Max adapter/device acquisition succeeded, but the
smallest empty compute pipeline reported `XPC_ERROR_CONNECTION_INVALID` from
the Metal shader compiler. Numerical evaluation aborted with SIGABRT. The same
WGSL module and entry point compiled and created a pipeline with explicit Dawn
`backend=null`; that is compiler/pipeline validation only. The normal focused
runner reported failure, not a numerical pass. The managed Greenroom worker then
executed the same production shader numerically: job `8991cc0d4c53` failed the
specific restraint-stress assertion on the pre-fix identity at commit `b142d9f0b`;
its independent damage assertions passed. After adding thermal rest stretch,
job `290634abafeb` passed both native tests on Apple M4 Max. These are small
constitutive checks, not a simulation or performance benchmark. No cooling-field
result, crack result, adaptive refinement or geological fidelity is established.

Continue through the managed native execution route while the direct launcher
lacks Metal compiler access. Add the heat/MPM/phase-field evolution and
an opening-crack test before interpreting a 3D block. Delayed refinement is a
candidate for detached/contacting material; a developing crack may itself need
refinement before it separates. The same persistent material state must survive
both operations. Keep subsequent coastal erosion and water-load coupling as
separate additions to this thermal starting point.

Run: `SHADER_HERDER_STRICT_METAL=1 npm test -- --only tests/thermal-jointing-native.mjs`.

Source base: fetched `origin/main@e16a7ac55d52a492fca11ed37831b6f28829dcc0`;
merge-base matches, initial left/right divergence 0/0. No dependency stack.
