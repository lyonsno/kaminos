# Masonry source workshop

Open `?workspace=workbench&experiment=masonry-workshop`. Four editable stones
and a gold ray target are independently registered scene objects. Selection,
placement, camera and lights use the normal editor. Recipe controls change corner
rounding, rich-margin width, relief and seed on all sources; object transforms
remain intact. These are static authored shapes, not a wear/fracture simulation.

This first stage uses explicit geometry and **ordinary PBR baseline materials**.
NVIDIA appearance and the curved neural material (SBTF) are unimplemented and
identified as such. Views show the detailed source, enclosing carrier, or the
face/margin/corner partition. Region colors are an authored vertex assignment; each stone uses one material per view. Relief contracts the source radially inside its convex carrier, allowing deep dents without folding through a bevel center.

Move the gold target with the native gizmo and choose **Inspect ray to gold
target**. The query follows the current viewing position through that target
and intersects the actual local source and carrier triangles, returning hit/miss,
UV, reference position, triangle/region identity, local geometric normal and separately named world-space normals.
The inspected line stays fixed when the target moves. This is a small CPU geometry inspection, not an integrated lighting label or a
claim of learned coverage. The line shows the inspected ray near the source.

Each triangle retains face UVs and common pre-relief/rest-space positions.
Duplicate chart-boundary vertices remain welded in space. A shared learned edge
chart, curved capture adapter and rich fitting remain subsequent work.

Controls and agents use the same experiment interface:

```js
await window.kaminosWorkbenchExperiments.invoke('source', {relief: 0.045});
await window.kaminosWorkbenchExperiments.invoke('display', {mode: 'regions'});
const probe = await window.kaminosWorkbenchExperiments.invoke('inspect', {});
const state = await window.kaminosWorkbenchExperiments.read();
const data = await window.kaminosWorkbenchExperiments.invoke('sourceData');
```

`sourceData` returns complete source triangles and metadata for all stones.
Invalid recipes reject before the existing source changes. Use **Copy current
workshop link** to retain the source recipe, current native object transforms,
ray target and camera through `experiment_inputs`. General scene-document
reconstruction for this procedural source is not supplied in this first slice.
The experiment preserves shared lighting/postprocessing and releases its owned
objects/resources on close.

Focused checks:
`npm test -- --only tests/masonry-source.mjs,tests/masonry-workshop.mjs,tests/masonry-witness.mjs`.
Browser consumer: existing `scene-object-witness.mjs --scenario masonry-workshop`
with an independent browser and the exact expected server root. It exercises the
actual source/view controls, retained invalid-edit state, carrier/source ray,
registered geometry and source/region/carrier captures. Rendering inspection is
required in addition to its numerical checks.
