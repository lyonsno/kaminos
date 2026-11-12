# Observe a directional material across angle and scale

Import `createParallaxPoses` and `captureParallaxMatrix` from
`@kaminos/webgpu-inference-kit/parallax-matrix` in a source checkout containing
this addition. This is an observation helper: the host retains its camera,
renderer, material, GPU device and inference lifecycle.

```js
const poses = createParallaxPoses({
  center: [0, 0, 0], normal: [0, 0, 1], tangent: [1, 0, 0],
  distances: [1, 2, 4], elevations: [20, 45, 70],
  azimuths: [0, 45, 90, 135, 180, 225, 270, 315],
});
await captureParallaxMatrix({poses, variants: ['source', 'learned'], adapter});
```

Elevation is measured above the chart tangent plane, azimuth from its tangent
around its normal. Distance changes screen magnification without changing the
material's physical UV mapping. Lists are caller-owned and are not truncated.
Use `transformParallaxFrame(frame, columnMajorMatrix4)` to move a local chart
into world space: it transforms the normal by inverse transpose and the tangent
by the linear transform, including nonuniform scaling. Singular/non-affine
transforms are refused.

The generated `up` vector keeps the chart orientation consistent around the
hemisphere. A host must support these orientations to use the complete grid.

The adapter supplies async `read()`, `setView(view)`, `setVariant(name)`,
`capture({pose, variant, state})` and `persist(report)` callbacks. `read()` returns
`{view, variant, effective, identity, lighting}`. The identity must describe the
actual model/source/backend used; lighting must include the fixed state relevant
to the comparison. Preserve additional host state there when it affects the
result. Camera vectors are checked to 1e-6 relative/absolute world units (allowing
the observed OrbitControls pole adjustment); supplied projection values must
match. Full actual views are retained for inspection.

`capture()` returns `{file, width, height, bytes, ...metadata}` after writing the
image; a content hash is useful. The host must capture the actual settled frame
and retain full images. The helper validates artifact metadata, effective variant,
camera, identity and lights before and after capture. It cannot infer whether a
host has honestly reported its backend or returned stale/blank pixels: inspect
frames and use consumer checks for those host-specific failure paths.

Reports are persisted before work, after each capture and on failure, preserving
completed captures, failure phase and last observed state. Camera and variant restoration are attempted independently on success or failure,
then checked through the host readback. Restoration errors fail the run without
replacing an earlier capture error.
The host owns any other state it mutates. No timer, GPU submission or new device
is created by this helper.

Kaminos's `tools/trellis-parallax-matrix.mjs MANIFEST.json` is the first consumer.
Its manifest supplies `url`, `repoRoot`, `output`, `executable`, `checkpoint`,
`checkpointSha256`, `elevations`, `azimuths` and optional `distanceFactors` (camera
distance in tile widths). It exercises the existing TRELLIS Workbench experiment,
validates its current WebGPU route and checkpoint, writes paired PNGs and an HTML
matrix with direct magnification/source/learned buttons. Use an independent
Chromium executable; its private profile uses mock Keychain/basic password
storage. This is saved-checkpoint inspection, not a performance measurement or
new training. No package release or adoption by another material owner is implied.

Run the helper's contracts with `npm run test:parallax-matrix` in this directory.

## Overview and opposed local neighborhoods

The TRELLIS capture now writes two direct-choice studies. Hemisphere overview
uses a continuous azimuth strip per elevation; strips never wrap into misleading
second rows. Local angular matrices use columns of azimuth offsets and rows of
elevation offsets around named anchors, with increasing elevation upward.

`createLocalParallaxPoses({...frame, distances, anchors, yawOffsets, pitchOffsets})`
returns these neighborhoods. Each anchor supplies `id`, optional `label`,
`azimuth` and `elevation`; the helper preserves its identity and offset metadata.
Choose two anchors with opposed azimuths when macro geometry is asymmetric
around the chart. For example, azimuth90/270 at elevation20 inspect opposite
sides while remaining in the same trained hemisphere. These are opposed sides,
not antipodal directions; a single-sided material's back remains unsupported.

The CLI accepts `local: {anchors, yawOffsets, pitchOffsets, distances}`. Its
local default uses two opposed anchors and one middle camera distance to keep
this inspection cheap; `local: false` or `overview: false` selects only the
wanted study. Configure anchors from the geometry rather than assuming generic
Side A/B necessarily expose its underside. An unsupported effective renderer
still fails capture instead of substituting source as learned evidence.

`renderParallaxGallery({title, captures, reportUrl})` creates the retained HTML
from capture rows, without re-running inference or owning a browser. Existing
captures without group metadata remain an overview. The host serves the HTML
and its relative artifact paths.
