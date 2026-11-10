# Grass surface teacher

Open the Workbench experiment `grass-surface-teacher` to inspect a frozen explicit ribbon patch with surface path tracing. The source is intentionally coarse and fixed. It exists to make blade tips, middles, roots, shadows and backing easy to compare under camera movement before fitting a learned material. It is not a botanical grass model or a periodic production material.

Use the ordinary scene camera. The source mesh is a registered scene object. Select it in the native inspector and manipulate its transform. Existing native scene lights illuminate it; Add → Light creates an ordinary editable spot light. Source controls change blade count, height, width, bend and seed. Quality controls change path depth, constant environment radiance, image scale, reconstruction and tracing pause. The geometry, materials and transport function are shared by progressive images and explicit raw ray queries.

The tracer borrows the app renderer/device. A presentation mesh displays its linear output through the existing scene pipeline, leaving native selection and transform handles visible. The source mesh remains selectable; its raster color/depth writes are suppressed while the teacher image supplies its appearance. Closing the experiment releases the owned objects, subscriptions and GPU allocations. Reopen after device replacement. The render host's `host.scene.rendering()` returns the current borrowed renderer, scene and camera and throws when its WebGPU context is unavailable.

## Transport and reconstruction

`surface-teacher-source.mjs` constructs deterministic tapered ribbon triangles over a backing. `scene-light-visibility.mjs` builds the existing stackless BVH. The packed triangle address retains the material index. `surface-teacher-wgsl.mjs` supplies two-sided triangle intersections, a diffuse/GGX mixture, direct-light visibility, cosine environment next-event sampling, BSDF sampling, power-heuristic MIS and Russian roulette after the third vertex. The path depth is caller-selected. This first version supports ordinary directional lights, inverse-square point/spot lights and a constant environment. It does not sample emissive geometry, HDR maps, area lights or participating media.

The interactive reconstruction uses world-position/normal/material validation to reproject history, then three variance-guided à-trous spatial passes. This is a compact implementation informed by SVGF, not a reproduction of its complete published estimator. At rest the raw accumulation is an arithmetic sample mean. During motion, accepted history has responsive weighting. Turning Reconstruction off displays the raw accumulated estimate. Raw capture never uses the spatially filtered image.

Finite patch edges are visible and affect shadows and grazing views. This is intentional for the first source-inspection toy. Periodic neighborhoods, grazing boundary policy, wood strand optics and training integration remain subsequent work. Material and camera controls do not establish that the source is already a valid tileable training teacher.

## Agent operations and retained inputs

The ordinary `window.kaminosWorkbenchExperiments` API exposes asynchronous `read()` and serialized `invoke()`:

```js
await window.kaminosWorkbenchExperiments.invoke('source', {height: 0.9, bend: 0.6});
await window.kaminosWorkbenchExperiments.invoke('configure', {bounces: 3, reconstruction: true});
const image = await window.kaminosWorkbenchExperiments.invoke('capture', {
  width: 256, height: 192, samples: 64,
});
const answers = await window.kaminosWorkbenchExperiments.invoke('query', {
  rays: [{origin: [0, 1, 0], direction: [0, -1, 0]}], sample: 0,
});
```

Capture returns explicit width/height/sample count, the source/configuration/view and linear RGBA floats. Alpha stores the accumulated sample count. The caller chooses persistent paths and retains the float array and manifest; a page return alone is not durable evidence. Source, camera, material, lighting or transport changes interrupt an in-progress capture. Reopen with `experiment_inputs` containing `source`, `view`, `scale`, `bounces`, `environment` and `reconstruction` from the actual read. General scene-document persistence for this procedural source is not supplied by this experiment.

Run expensive captures and performance measurements through GPU Greenroom. Ordinary small numerical shader checks and visual inspection retain their existing admission. Relevant tests:

```sh
npm test -- --only tests/surface-teacher-source.mjs,tests/surface-teacher-native.mjs,tests/workbench-scene-host.test.mjs
```

The native tests execute production WGSL on the observed adapter and check real occlusion, lit/missed rays, raw accumulation and history invalidation. They do not certify interactive frame rate or perceptual quality; the Workbench is the consumer for those questions.

The Workbench supplies the actual camera view-projection matrix and world position, including any view offsets or viewport framing. Capture retains that matrix with its source/configuration and resamples the current camera rectangle at the requested image extent; choose proportional dimensions to preserve the displayed aspect ratio. The reusable renderer also accepts a plain perspective `view` when no host camera frame is supplied. With Reconstruction disabled, camera changes discard prior image history, so moving raw inspection does not reuse reprojected samples.
