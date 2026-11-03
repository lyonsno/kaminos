# Hill living terrain

For the geological formation and cached initial landscape, use [`hill-geology`](hill-geology.md). This older analytical ridge experiment remains a comparison.

Open `?workspace=workbench&experiment=hill-terrain`. The experiment adds a terrain object to the shared scene. Change its seed or choose a branching basin or low saddle, let the loose ground settle, then run uplift. Changes persist until regeneration. All simulation, preparation, interpolation, vertex positions, normals and material colors stay on the host WebGPU device. A missing WebGPU backend is an error.

The starting recipe is a small seeded graph of connected ridges. GPU initialization turns that graph into firm substrate and loose material fields. Preparation moves loose material down slopes without uplift. Live evolution uses the same fields and conservative four-neighbor transport, driven by slope above the chosen resting angle and limited by available material. Prescribed uplift changes the substrate; it is an authored drive, not a tectonic model. This is a height/material representation: one surface per horizontal sample, without caves, overhangs, detached bodies or granular inertia. Generated preparation does not write player or creature history.

## Cost and clock

Default size is 129 × 129 samples and 32,768 triangles. The current simulator owns 2,130,304 bytes of storage arrays, plus 393,216 bytes of indices. These counts exclude renderer resources, shadows, uniforms and driver overhead. Two local compute passes evolve each 0.05-second step. Two presentation passes interpolate state and derive geometry/material at the host frame cadence while playing. Paused, unchanged terrain does not re-run those passes. Initialization has two field writes and the separately requested preparation steps (60 by default).

The host frame callback consumes all elapsed fixed steps and retains fractional time. It does not discard elapsed time or cap catch-up steps. This is a correctness policy, not an earned real-time guarantee. The 60 Hz game target, roughly 2 ms terrain GPU target, 3 ms p95 whole-Hill ceiling and sub-0.5 ms CPU target remain measurement goals. The complete claim must include rendering, hand/water/support consumers and representative game work. Terrain-only observations cannot close it. Preparation has a separate load-time budget.

## Interaction surface

`window.kaminosHillTerrain.gpu()` exposes resources on the scene's existing GPU device. It supplies display state, current/previous state, display interpolation alpha, vertex positions, normals, grid dimensions, width/length, generation and submitted step identity. State is row-major `vec4<f32>`: substrate height, loose depth, vertical velocity and actor memory. Surface height is substrate plus loose depth. Grid X/Z span `[-width/2,width/2]` and `[-length/2,length/2]`. The diagnostic wrapper supplies the current local-to-world matrix. Resources belong to Hill and become invalid on experiment disposal; consumers must acquire current descriptors rather than cache a swapped buffer identity. The display state is the surface actually used to produce visible geometry. Fluid contact, force input and actor-history ingress have not yet been connected.

The ordinary scene row and transform tools own selection/placement. Exact CPU raycasting is disabled because CPU storage arrays do not contain the current surface. Framing uses the initial terrain envelope. Geometry export fails explicitly until an intentional frozen-snapshot route exists. The `recipe` operation exports initial conditions only; it does not serialize evolved GPU state.

## A small common simulator vocabulary

This is a proposed vocabulary to grow through actual composition, not a new universal runtime or an adopted Saline/Ash API:

| Concept | Hill's current meaning | Possible counterpart elsewhere |
| --- | --- | --- |
| Initial conditions | Seeded ridge graph and material distribution | Initial fluid fill, fuel or ash distribution |
| Material state | Substrate, loose depth, vertical velocity | Fluid velocity/pressure, temperature, suspended/deposited matter |
| Applied influences | Prescribed uplift | Boundary motion, injection, heating, wind |
| Clock | Preparation versus elapsed fixed simulation steps | Each solver's stable update cadence |
| Interaction surface | Same-device displayed height, motion and normals with placement | Contact boundary, flow field or deposition flux |
| Presentation | Geometry and material derived from current state | Surface/volume/particle rendering derived from solver state |
| Capabilities and cost | Explicit supported operations and unmeasured budget targets | Solver-specific support and measured allocations |

Kaminos already owns mounting, native scene editing, frame callbacks, controls and operation recording. Reuse that host. Shared concepts do not require equal grids, equal timesteps or identical state layouts. The next concrete composition should decide which interaction quantities need a formal shared contract.

## Verification

`npm test -- --only tests/hill-terrain.mjs,tests/hill-terrain-experiment.mjs,tests/hill-terrain-witness.mjs`

`tools/hill-terrain-witness.mjs` runs native browser GPU/CPU parity, conserves loose material, checks persistent uplift, uses the page's controls, captures generated starts and verifies disposal. It requires explicit `--url`, `--root`, `--out`, `--browser` and `--playwright` paths. Its explicit offline snapshots are excluded from playback, preparation and rendering. The report records served source hashes, requested/effective settings, errors and failure phase even if no main capture is produced. Raw float arrays are retained alongside screenshots. Run qualifying GPU work through the shop queue. Use an independent automation browser with isolated keychain/profile; the witness closes its browser in all cases.
