# Live granular earth

`?workspace=workbench&experiment=earth-gpu` opens the shared scene with resident
WebGPU rigid two-sphere grains and yielding Lagrangian material elements.
Select and move the translucent forming tool through the ordinary native editor.
Pause and local refinement are available beside the specimen; no left-panel
interaction is required.

The default contains32,768rigid grains. `experiment_inputs` accepts explicit
`count`, `clods`, `materialLevels`, `iterations`, `dt`, and `paused` values.
An initial material level subdivides every tetrahedron into eight; later
`refine({group})` or the tool's local refinement acts on the worked state.
The renderer intersects the actual sphere lobes analytically, writes their
fragment depth, and uses the actual material boundary. No pose readback,
density meshing or visibility-tree rebuild is required each frame.

This is an exploratory contact/material instrument. The matrix uses tetrahedral
volume constraints and yielding edge metrics, not a calibrated clay constitutive
law. Existing matrix boundary triangles are generated once per topology change;
node positions stay on the GPU. Crust formation, moisture transport, drying,
breakage and natural soil microstructure remain subsequent material work.
No FPS, machine population limit or institutional-scale claim follows from the
implementation alone.

## Agent operations

Through `window.kaminosWorkbenchExperiments.invoke`:

- `pause(boolean)` controls physical advancement.
- `tool({position,radius})` uses specimen metres, preserving native registration.
- `advance({steps})` performs the requested number of physical steps and waits for
  their completion. It never substitutes a CPU solve.
- `refine({group})`, `refine({all:true})`, or `refine()` splits the selected actual
  material elements. Default selection follows the tool. Midpoint transitions
  couple refined elements to remaining coarse edges.
- `snapshot()` returns the full worked grain, material, plasticity and transition
  state. It is an explicit readback, separate from the live rendering path.

The initial scene uses100display units per metre. The physical solver's clock
is explicit. Two steps are offered per viewport frame; pending GPU batches block
additional submissions, so simulated time and wall time can differ. `read()`
reports completed steps, simulated time, phase populations and errors. Physical
clock calibration and live throughput must be assessed on the effective route.

## Checks

`node --test tests/earth-gpu-material.mjs` exercises state-preserving refinement.
`SHADER_HERDER_STRICT_METAL=1 node --test tests/earth-gpu-native.mjs` executes the
production geometry/contact kernels on Apple hardware, including reciprocal
mixed contact. `node tools/earth-gpu-study.mjs OUTPUT` records source/adapter,
actual numerical states, timings and failure phase. Larger simulations and
performance measurements belong in Greenroom; a tiny numerical unit test is
not evidence of full-population throughput.
