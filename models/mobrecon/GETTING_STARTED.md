# Hand meshes in your application

`createHandMeshApp` runs WiLoR hand detection followed by MobRecon reconstruction on WebGPU. It loads the prepared model packages once and returns hand presence, 778 mesh vertices, 21 crop-space landmarks, triangle topology and model identity. The standalone [hand demo](../../demos/hand-mesh/) uses this same application entry point.

Use the existing [one-command model setup](../../demos/hand-mesh/README.md#model-setup) to prepare the files locally. Model terms, including MANO-derived topology terms, apply separately from the JavaScript code. The application accepts prepared package URLs or the verified file sources used by the demo; it does not acquire a camera or upload your input.

The setup command writes four files to `~/.local/share/kaminos/hand-demo/models/` by default. To use the URL example below, place them under your app's static files with this layout (rename the two metadata files to `package.json`):

```text
models/
  mobrecon/
    package.json    ← mobrecon.package.json
    mobrecon.bin
  detector/
    package.json    ← detector.package.json
    hand-detector.bin
```

Keep each metadata file with its unchanged bundle. If you chose `KAMINOS_HAND_HOME`, use that directory's `models/` instead. The demo's verified local-file path can also be passed directly as `{ mobreconPackageSource: { metadata, bundle }, detectorPackageSource: { metadata, bundle } }`, where each `bundle` is a Blob.

From a Kaminos checkout, import the module into your served application or bundle it with your existing bundler:

```js
import { createHandMeshApp } from './models/mobrecon/hand-mesh-app.js';

const hand = await createHandMeshApp({
  mobreconPackageUrl: '/models/mobrecon/', // contains package.json and its bundle
  detectorPackageUrl: '/models/detector/',
});
const result = await hand.infer({ source: video, handedness: 'right' });
if (result.hasHand) {
  showHand(result.verticesMeters, hand.faces, result.cropUV);
} else {
  hideHand();
}
await hand.destroy();
```

`source` accepts browser image sources supported by WebGPU's external-image upload, such as a video element, canvas, ImageBitmap or VideoFrame. Pass `width` and `height` when they are not available as `videoWidth`/`videoHeight` or `width`/`height` on the source. The caller owns the input and its lifetime, including closing a VideoFrame it creates.

The default acquisition is detector mode, threshold0.80, padding1.4, and `onMiss: 'skip'`. Override these through `acquisition`. A miss returns `hasHand: false` without mesh vertices and skips reconstruction. Hand choice is explicit; the detector's class is reported but does not silently select it. Native model vertices, model-scaled `verticesMeters`, crop UVs and source-pixel `cropBox` retain the low-level route's conventions. Model-scaled coordinates do not supply camera calibration or world placement.

## Live input and shared applications

For continuous input, ask for the next result after the previous result settles. `getFrame` runs **after** model admission, so a camera loop can obtain fresh input after waiting:

```js
const result = await hand.infer({
  getFrame: () => ({
    source: video, width: video.videoWidth, height: video.videoHeight,
    frameId: video.currentTime,
  }),
  handedness: 'right',
  acquisition: { threshold: 0.85 },
});
// result.input preserves width, height and the caller's frameId.
```

Choose `source` or `getFrame` for a call. The latter may return a promise and receives `{ signal }` during cooperative execution. Cancellation is checked again before model work. The caller should keep its own presentation generation so a completed result cannot revive a stopped or replaced camera. The demo does this with its existing camera generation. The API does not queue a stream of old frames or discard arbitrary caller batches; overlapping calls on one instance reject.

Pass `{ device }` to use your renderer's device, or `{ session, foreground }` to borrow a coordinated kit host. Destruction preserves borrowed resources. Multiple hand instances use distinct resource routes within the same session. Use `load: false` to obtain the application before loading, then `load(onProgress)` to load it. A failed load retires its partial resources and can be retried.

**A shared session admits whole model operations in sequence.** A hand frame waits behind a generator already using that session. Fresh capture avoids old input after the wait; it does not remove the wait. `snapshot().admission` reports `whole-operation-fifo`. Responsive tracking during a long unrelated model operation needs a separate interleaving policy; this API does not promise it. The standalone demo owns its inference session and is not queued behind a separate application generator.

`pause`, `resume` and `stop` act at the boundaries before hand detection and reconstruction. Foreground requests can be serviced at those same boundaries and while paused. Each network's current compute pass is indivisible. `cooperative: false` keeps outer admission and cleanup but disables those cooperative control boundaries. Loading is separate; stopping inference waiting for loading does not cancel the shared load. `destroy()` stops new work, cancels pending work, waits for loading and active inference, then releases owned resources.

The app exposes `device`, `session`, `foreground`, `route`, `identity`, `faces` and `snapshot()`. `route` remains the low-level producer for a host that already owns admission and settlement. Calling the application again from inside an admitted job on the same session would nest admission; use the low-level route in that case. The [shared application guide](../../webgpu-inference-kit/docs/model-applications.md) describes the renderer's foreground submission contract.
