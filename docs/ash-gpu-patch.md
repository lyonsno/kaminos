# GPU falling ash and contact experiment

Open `/?workspace=workbench&experiment=ash-gpu-deposition`. The existing
`ash-deposition` CPU sparse-cell experiment remains available as a reference.

The GPU experiment uses the same retained kiln and static 64³ collision mask.
It starts empty. Move the teal source ring and use **Release ash** for a burst
or **Start emitting** for continuous fallout. Burst volume, ash per simulated
second and spread are adjustable through the shared number-drag controls.
The source introduces controlled material; it is not yet driven by combustion.
The older **Add ash** command remains a settled-disk fixture. Drag the amber sphere with the ordinary scene
Move tool. Each live update sweeps its contact from the previous position and
exchanges material between disjoint voxel pairs. The physical volume remains
stored when neighbors or closed patch boundaries prevent displacement.

Ash volume is in cubic world units. The introduced-volume readout includes
settled, airborne and pending material. Spread radius changes the settled
fixture footprint; Fall spread changes the airborne source.
Contact radius changes the dragged body. New-patch controls choose spatial
extent and cell width: **Create empty patch clears the current deposit**.
Save ash before replacing a patch you want to keep. Checkpoints retain the
whole density field, airborne parcels, pending volume and emitter settings. Loading requires the same
patch mapping and kiln identity. Ordinary scene Save does not retain this
experimental material state.

Default cell width 0.012 is one fifth of the original 0.06. Default loading
0.24 world volume is about 1.85 times the original 600 × 0.06³ deposit.
The kiln mask remains coarser than the ash; a finer ash grid does not establish
finer kiln collision fidelity.

## Representation and limits

This is a **bounded dense GPU patch experiment**, not the sparse world storage
implementation. It retains full 3D density, including separate support levels.
A changed flag controls indirect dispatch; sleeping density updates run only a small
prepare dispatch, retaining their visible instance list. The separate transport
currently scans one parcel slot per ground column even while the pile sleeps. Active updates scan
the allocated patch for six disjoint pair passes and surface compaction.
The visible boundary cells and draw count are GPU generated and consumed by
the shared Three WebGPU renderer. The live path does not read back density or
rebuild meshes in JavaScript. Loading, explicit diagnostics/checkpoints and
setup use CPU work and readbacks.

Gravity moves upper material into lower free capacity. Lateral differences
above half a cell relax. Contact penetration takes precedence over gravity,
allowing material to move upward and outward. This is an intentionally simple
voxel relaxation, not calibrated granular mechanics or rigid-body coupling.
The kinematic sphere can overlap blocked material; it does not receive forces.
The surface remains fine exposed cell boxes, not a finished ash material.

The explicit patch capacity is derived from requested world bounds and cell
width. Requests beyond effective WebGPU device capacity fail visibly. Settled-fixture deposits
that do not fit reject before changing density. Falling material has a different
capacity path: a full transport keeps unspawned volume pending, and a full local
column keeps its remaining parcel airborne. Nothing silently deletes
material to satisfy a capacity or time budget. Pair exchange uses float32;
conservation is tested within numeric tolerance. World-wide sparse allocation,
local active-brick scheduling, combustion uptake, and measured cost beside
inference remain open. A bounded patch does not settle those architecture choices.

`tools/ash-gpu-witness.mjs` preserves every captured frame, interventions,
source hashes, actual browser identity, full before/after/checkpoint states,
and a terminal report including failure phase. It checks GPU route, retained
volume, changed contact shape, live frame evolution, fresh-page restoration,
and rejection without mutation. Negative unmount/pageerror options must fail.
The filmstrip is a labelled sequence of actual captures; its sample cadence
must not be represented as real-time video.

## Falling source

`ash/fall-gpu.mjs` uses the shared renderer device and stores positions, velocities,
and remaining mass in GPU buffers. Each ground column supplies one transport
slot; a parcel represents up to eight cell volumes. This is an adjustable-detail
transport representation, not a calibrated ash grain size. The visible glyph is
an octahedron. Atomic landing transfers available mass into density, retaining
any remainder. Swept sampling checks the static support and pile; the movable
sphere also deflects airborne parcels. Horizontal patch edges are closed, and
fall height does not require allocating a tall fine voxel column.

Playback advances at the existing nominal 30 simulation ticks per second with
1/30 simulated second per tick. Under a slow presentation cadence, simulation
time slows; there is no hidden catch-up. Pause holds both source and settling.
Stop emitting holds new continuous input while already released material falls.
Contact still uses voxel penetration redistribution without stored pile momentum.
The source has no smoke-velocity advection or consumed-material yield connection.

`tools/ash-fall-witness.mjs` exercises the real burst control and continuous-source
control, retains every captured stage and complete raw checkpoint, compares
in-flight continuation across reopening, checks introduced versus retained mass,
and rejects blank/hidden or frozen transport evidence. Optional profiling uses
shared-device GPU timestamps for compute and separately records displayed-frame
completion intervals. These are distinct from an inference-coexistence benchmark.
