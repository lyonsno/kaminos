# SAM/SF3D Host Composition Handoff

This branch does not provide the agreed application integration path. The
pre-admitted-consumer wrapper was removed rather than exposed as a kit API.

## Verified Boundary

- Kaminos main at the base of this branch is `2bd1aa9fba286b6d15cc98f5270d74a83bf86eb4`.
- The kit's public `createWebGpuInferenceSession()` owns the shared device and
  session. `createSam3BrowserImageRuntime({ inferenceSession, yield, ... })`
  borrows that session; its `run(manifestUrl, invocationOptions)` and
  `close()` provide the matching SAM lifecycle. The runtime is implemented in
  `src/sam3-browser-image-runtime.js` and exported through `src/sam.js`.
- SF3D source main inspected at `740b6098b716f65840f955451a1366f0af53ed3a`.
  `src/lib/sf3d_producer.js` exposes
  `createSf3dProducer({ device, adapter, ... })`, `run(image, options)`, and
  `dispose()` with a completion promise. Its `package.json` has
  `"private": true` and no `exports` map; `src/main.js` imports the producer
  only as `./lib/sf3d_producer.js`. Its worker, shader, and asset resolution
  belongs to that Vite application. The kit repository therefore has no
  supported import that can create the actual SF3D producer.
- SF3D's `requestForegroundOpportunity()` is producer-owned foreground
  scheduling. SAM accepts the caller-provided kit cooperative `yield` callback.
  The paired host must connect its renderer to both actual mechanisms; matching
  run methods alone does not establish frame service.

## Single Missing Owner Action

Slow, as SF3D producer owner, should expose a host-consumable producer entry
point from its source that preserves its worker/shader/asset resolution and
borrowed-device lifetime contract. Once that import boundary exists, Cranial
can add the private executable composition here: create one kit session, create
SAM against that session and its renderer yield callback, create SF3D with the
same session device/adapter, run SAM then SF3D then SAM, and close/dispose only
the model-owned resources before closing the session. Wake's editor/kiln code
does not need to change for this kit-side slice.

Until then, the session/SAM pieces can be demonstrated independently, but a
Kaminos-only example cannot truthfully instantiate the real SF3D consumer or
prove the requested shared-device sequence and renderer cadence.
