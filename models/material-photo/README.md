# Depth And Materials From A Photograph

Compose the MoGe and SuperMat application APIs on one WebGPU host. The operation returns their original CPU outputs, reports each stage, and carries cancellation through the handoff. It has no renderer, cache, scene, or device ownership.

```js
import { createSuperMatApp } from '../supermat/supermat-app.js';
import { createMoGeApp } from '../moge/moge-app.js';
import { createMaterialPhotoOperation } from './material-photo-operation.js';

const materials = await createSuperMatApp({ load: false });
let geometry;
try {
  geometry = await createMoGeApp({
    device: materials.device,
    session: materials.session,
    foreground: materials.foreground,
    load: false,
  });
  const photograph = createMaterialPhotoOperation({ geometry, materials });
  const result = await photograph.infer({
    image, // ImageData: the same pixels go to both models.
    size: 768,
    signal: abortController.signal,
    onProgress: ({ stage, phase, detail }) => updateProgress(stage, phase, detail),
    onGeometry: depth => showDepthPreview(depth),
  });
  showMaterials(result.depth, result.maps);
} finally {
  // Keep both apps resident for repeated runs; destroy when the feature closes.
  try { await geometry?.destroy(); }
  finally { await materials.destroy(); }
}
```

For an existing renderer host, pass its `device`, `session`, and `foreground` to both factories. Neither app then destroys that host. Connect rendering to the foreground service using the [Kit foreground contract](../../webgpu-inference-kit/README.md); using the same device alone does not schedule frames.

`infer()` is single-flight. `stop()` or the supplied `AbortSignal` cancels the active inference at the underlying model's cooperative boundaries and prevents the next stage from starting. A shared weight download already underway can finish for later callers; cancelled operations stop reporting progress. Retry on the same operation after rejection. The model apps still own their individual `pause()`, `resume()`, loading, and disposal controls; this operation does not add a second scheduler or whole-operation pause policy.

The result is `{ depth, maps, phases: { geometryMs, materialsMs } }`. The durations exclude weight loading. Outputs remain caller-owned after later failure or app disposal. `onGeometry(depth, { cached, durationMs })` is awaited before material loading, so a caller can display or retain depth immediately. A callback failure rejects the operation.

When changing only material resolution, supply `depth: previous.depth` to skip MoGe. The caller must associate that depth with the exact input image and model configuration; there is no implicit cache or image matching. `geometryOptions` and `materialOptions` forward model-specific run options, while image, size, signal, and progress remain owned by the operation. Load configuration and weight locations belong to the model factories. See the [MoGe](../moge/README.md) and [SuperMat](../supermat/README.md) entries.

[Material Photograph](../../demos/material-photo/README.md) consumes this exact operation while keeping included outputs, browser caching, image selection, and rendering separate. Source imports are available from the checkout; this composed operation is not an npm package export.

## Kaminos Scene Authoring

The Generate tab's **Material Photograph** choice uses this operation on the page's shared GPU host. Select an image and a 512, 768, or 1024 material resolution, generate, then use the result's ordinary **Add** action. Generation leaves the scene unchanged until Add. The resulting GLB supports scene placement, undo/redo, and save/reopen without rerunning inference. If storage fails after inference, **Retry saving** retains the completed output.

`authoring-material-photo.mjs` owns page input, resident model apps, cancellation and generation provenance. `photograph-glb.js` exports MoGe's returned points and normals plus SuperMat albedo and packed roughness/metalness. Geometry preserves MoGe's scale, converts its camera frame to x-right/y-up/z-backward, and uses a centered asset pivot with the original offset retained in GLB metadata. Source alpha removes transparent triangles; depth discontinuities are left open. This is an open photograph surface, not a completed backside or an automatic segmentation pass.

The standalone demo's tuned glow, material contrast, and included-output cache remain demo-owned. Scene authoring exports the inferred material maps without those adjustments.

The ordinary scene exercise is `node material-photo-scene-witness.mjs --root <checkout> --origin <server-url> --out <evidence-directory> --chrome <independent-chrome> --playwright <module-path> --native`. Use `--source-report <native-lifecycle-report>` instead of `--native` to exercise authenticated retained arrays without inference; its report explicitly records that replay route. Both modes exercise Generate, Add, transform, undo/redo and saved reopening.
