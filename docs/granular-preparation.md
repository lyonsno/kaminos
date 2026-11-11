# Preparing an explicit granular material

Open `?workspace=workbench&experiment=granular-preparation`. This separate
Workbench scene preserves the existing worked-earth workshop. It prepares
actual irregular convex grains by pouring, settling, shaking, platen compression
and unloading. The construction follows the preparation approach described in
[Particula (2019)](https://ngi.stanford.edu/sites/ngi/files/media/file/geo2018-0481.1.pdf).
This is an independent implementation using the installed Cannon ES solver,
not a port of Particula's Unity/PhysX code or a calibrated soil model.

The physical specimen uses metres. Its default scene display is magnified ten
fold so that millimetre grains remain accessible through ordinary camera
controls. Native selection/transforms move the displayed chamber; they do not
change the physical recipe. **Inspect integral** toggles actual triangle transport in the same camera
view under the normal scene lights. Preparation controls, source registration
and selection remain in place. The integral follows completed worker states,
including subsequent pours; toggle it again to return to raster shading. The chamber is a first functional
tray/window/platen, not the finished material-authoring apparatus.

Mixture controls are visible in the viewport. Radius, size spread, proportions,
friction, angularity and seed describe the next specimen; **New mixture**
constructs it explicitly. **Grains per pour** sets how many additional grains
Pour adds to the current packing and then physically settles. Type a quantity and press Pour; Enter is
optional. Typed quantity and seed drafts remain visible until accepted or
cancelled with Escape. Costly counts have no drag control. Existing grain
identities, shapes and physical state are retained when reserving another batch.
A transient-storage estimate rejects requests exceeding exposed available heap;
it never lowers grain count. This estimate is not a benchmark of solver capacity.
Dense contact work can still be expensive; the worker keeps host frames separate.

**Pour → press → unload** performs the preparation sequence. The expanded
preparation controls expose individual operations, including shaking. **Pause**
retains the last completed worker chunk. **Continue** completes the current
operation. After pausing the automatic sequence, finish the paused operation
with Continue before invoking later operations individually. It does not silently restart an interrupted whole sequence.
Save/Load preserve the exact grain hulls, poses, velocities, mixture, physical
clock, lid/container state, preparation phase and history. A reload reconstructs
contact caches rather than promising bit-exact warm-solver continuation.

The correlated radial variation is applied to a subdivided icosahedron and then
convex-hulled. The same hull is used for collision, preview and source tracing.
Material colors and roughness are provisional mineral categories, not measured
optical properties. This first source is a bounded granular packing: cohesive
matrix, aggregate binding, weathering, periodic tiling and its connection to the
coarse worked-earth support are not implemented by this preparation slice.
The optional tray in the visual integral is explicit container geometry; a
frozen material source excludes it by default.

Agent operations share the human path:

```js
await window.kaminosWorkbenchExperiments.invoke('prepare');
const snapshot = await window.kaminosWorkbenchExperiments.invoke('snapshot');
const source = await window.kaminosWorkbenchExperiments.invoke('freeze');
```

The fit source dispatcher accepts `source.config` with
`kind: 'granular-preparation'` and its retained snapshot. Missing snapshot is an
error, never a fallback to the older decorative ground source. Exporting that
source does not establish that its open grain packing is an appropriate tiled
NeuMIP teacher; inspect the source and select backing/coverage semantics before
investing in a fit.
