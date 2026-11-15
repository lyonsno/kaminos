# Thermal fracture source — initial source audit and oracle baseline

This is unfinished work, not an executable fracture experiment. No Workbench
entry is registered. The first consumer remains a live hot-solid block that
cools, contracts and opens cracks, feeding an offline learned-material source.

The selected first question is whether an isotropic change in the material's
stress-free dimensions produces tensile driving energy under restraint while
allowing free contraction. `material-law.mjs` ports the positive-energy and
stress split from the MIT CD-MPM source. Its thermal operation intentionally
remains the pre-fix identity. `tests/thermal-jointing-native.mjs` contains the
planned numerical oracle; the thermal-restraint assertion should fail on this
baseline. It has not yet executed successfully enough to establish that
numerical failure. Do not interpret this branch as a thermal implementation.

Source: [Ziran/CD-MPM](https://github.com/penn-graphics-research/ziran2019/tree/35742ac3ab1ae42cf2bbe8761fd7c8e630a638c4),
specifically `NeoHookeanBorden.cpp`, `PhaseField.h` and `FractureSimulation.h`.
The original license is retained adjacent to the port. Source state carries
the phase value and maximum positive-energy history on particles. Its phase
solve uses matrix-free conjugate gradients on the temporary grid. Irreversibility
is applied when transferring solved phase back to particles. The inspected
mechanical transfer accumulates one grid velocity; it does not establish
arbitrarily fine independent crack-face motion inside shared grid support.

On November14,2026, Apple M4 Max adapter/device acquisition succeeded, but the
smallest empty compute pipeline reported `XPC_ERROR_CONNECTION_INVALID` from
the Metal shader compiler. Numerical evaluation aborted with SIGABRT. The same
WGSL module and entry point compiled and created a pipeline with explicit Dawn
`backend=null`; that is compiler/pipeline validation only. The normal focused
runner reports failure, not a numerical pass. No runtime cost, cooling result,
crack result, adaptive refinement or geological fidelity is established.

Continue by restoring actual Metal compilation, running the focused oracle
against this baseline, and implementing thermal rest stretch after its specific
numerical failure is observed. Then add the heat/MPM/phase-field evolution and
an opening-crack test before interpreting a 3D block. Delayed refinement is a
candidate for detached/contacting material; a developing crack may itself need
refinement before it separates. The same persistent material state must survive
both operations. Keep subsequent coastal erosion and water-load coupling as
separate additions to this thermal starting point.

Run: `SHADER_HERDER_STRICT_METAL=1 npm test -- --only tests/thermal-jointing-native.mjs`.

Source base: fetched `origin/main@e16a7ac55d52a492fca11ed37831b6f28829dcc0`;
merge-base matches, initial left/right divergence 0/0. No dependency stack.
