# Finger Juice on the Hill

Open the shared Workbench experiment `hand-hill-juice`. The frozen Hill appears
before the camera starts. **Start camera** uses the existing browser MobRecon
hand and finger-emission path. Camera navigation, jet speed, emission rate and
particle lifetime retain their existing controls.

The terrain is the canonical initial Hill recipe (seed 414, 48 × 60 samples,
source phase time zero) exported from LERMS revision
`07de3ab5b2f062a48e339b950426abc678518b12`. Its source parameters, checksums,
original bounds and uniform world transform are in
`assets/hill-of-hills/frozen-initial-414.json`. The scale is about 0.598633;
the vertical translation is about 0.283929. It fits inside the existing
192 × 80 × 256 fluid grid without changing its 0.05 cell width. Source RGB
bytes are stored normalized as sRGB and converted to linear color for the host.

Reproduce the asset from an explicit, committed LERMS worktree with Node's
TypeScript stripping support:

```sh
node tools/export-frozen-hill.mjs --lerms-root /path/to/lerms-worktree --output assets/hill-of-hills/frozen-initial-414.json
```

The renderer and contact kernels consume this one exported heightfield. The
visible mesh and the GPU sampling function use the same two triangles per
cell. Heights upload once; grid velocity contact and particle projection run
on the host WebGPU device. No CPU terrain evolution, terrain support query or
particle readback runs in the presentation/simulation loop. Native particle
snapshots remain explicit offline diagnostic operations after pausing. The
terrain's CPU construction code is absent from the browser route.

The rectangular tray still catches fluid beyond the finite Hill footprint.
The prescribed sphere is omitted when a Hill is supplied. Terrain contact is
one way: it does not erode, deform or write memory into the Hill. This frozen
composition does not establish dynamic terrain continuity, phase behavior,
Lerm locomotion, goin contact, or distinct finger chemistry.

`mls-juice` can exercise the same contact path with a reproducible synthetic
nozzle by passing `terrainUrl: "/assets/hill-of-hills/frozen-initial-414.json"`
and `gridSize: [192,80,256]` in `experiment_inputs`. The existing
`tools/mls-juice-witness.mjs` checks served source bytes, the effective route,
zero runtime map-for-read calls and paused native-particle contact against the
source triangles. `tools/mls-hand-witness.mjs` exercises the exact hand route
using a retained camera input; that replay does not assess live hand feel.
