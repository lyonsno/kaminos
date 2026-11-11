# Independent fire simulation objects

Use **Add → Flame** in the ordinary Workbench. In a scene with an
existing flame, this starts from its current tuning. In a fresh scene, choose
an immersed-source basin. Each new object owns an independent native GPU
simulation with its Fine grid and optional outer World grid, on the scene's
shared GPU device and camera.

Select the grid to move the pair as one unit. **Select emitter** or native
component editing selects its source. **Move emitter with grid** is the same
saved property in both contexts. When checked, moving or uniformly scaling
the grid carries the source. When unchecked, the source keeps its world pose.
The emitter can also be placed independently. The grids remain world aligned;
unsupported rotation and nonuniform scale are refused.

Select the grid for Material, Flow and Quality, or its emitter for source
properties. Numeric fields use the ordinary drag/type controls and grouped Undo.
The selected unit uses the existing flame, basin and grid editors. Those edits
apply to that unit. The scene Play/Pause control operates all present units.
Each unit has its own solver cost; this feature adds no automatic budget sharing.
Saving and reopening reconstructs authored settings and placement. Evolved gas
is retained through ordinary movement and retained removal/Undo, but is not a
saved simulation checkpoint.

The initial presentation uses independent native volume canvases. Unified
transport through intersecting volumes, shared scene illumination from every
unit, and all-layer recording are subsequent composition work. Their equivalence
to the existing single-field lighting/recording path is not established here.

Renderer consumers can enumerate `window.kaminosSceneAuthoring.fireUnits()`
and use `fireUnitRuntime(id)` to read each producer's existing GPU descriptors.
The list includes retained entries for Undo; `present` and `active` distinguish
them from mounted, advancing fields. Authored placement uses the ordinary scene
transform/history API; raw runtime access is not a replacement for that owner.
`addFireUnitFromBasin(presetId, options)` and `addFireUnit(options)` use the same
creation path as the native menu. The existing `Flame` entry remains the
single-field source workflow for older scenes.
