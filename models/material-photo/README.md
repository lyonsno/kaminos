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
