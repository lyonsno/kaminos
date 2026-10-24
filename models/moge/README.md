# MoGe Application

Recover depth and surface normals while sharing a WebGPU device with your renderer.
This checkout entry uses the same application lifecycle as SuperMat and Klein.

```js
import { createMoGeApp } from './moge-app.js';

const app = await createMoGeApp({ session, foreground, load: false });
await app.load((received, total) => updateDownload(received, total));
const geometry = await app.infer({ image: imageData, signal });
// geometry contains depth, normals, points, colors, width, height and routeResult.
await app.destroy(); // borrowed session, foreground and device remain alive
```

Omit the host arguments for an owned device/session/foreground. Pass `device`
to borrow just the device, or `session` and `foreground` together to join an
existing coordinated host. Submit renderer work through `app.foreground`.
`load()` is single-flight; later calls reuse loaded weights. `infer()` permits
one call per app, and queues behind another model using the same session.
`pause()`, `resume()`, `stop()` and `snapshot()` describe/control the current
inference. Stop is observed at producer boundaries, not mid-dispatch. Stopping
a caller waiting for loading leaves the shared load alive; `destroy()` waits
for loading and queue retirement before disposing model resources.

Set `modelOptions.weightsUrl` to override the default hosted MoGe checkpoint.
Model outputs remain caller-owned CPU arrays after app destruction. Numerical
options pass through unchanged. Per-run `scheduler` controls MoGe chunking;
the app supplies its own schedule, invocation and control. Internal diagnostic
profilers need direct execution (`cooperative: false`) because they own their
submissions. Normal inference defaults to split encoder/decoder chunks with
bounded-prefix pacing.

The [Material Photograph demo](../../demos/material-photo/main.js) composes this
entry with SuperMat and a four-view renderer on one session. The
[Kit application guide](../../webgpu-inference-kit/docs/model-applications.md)
describes foreground requests and ownership.

`moge-inference.js` is a generated build, not a second numerical implementation.
Rebuild the revision in [provenance.json](provenance.json), copy its
`dist-lib/moge-inference.js`, and update the revision and SHA-256 together.
See [third-party notices](THIRD_PARTY_NOTICES.txt); model weights have separate terms.
