# U2Net background removal

Turn an opaque RGB or RGBA image into a cutout on your application's WebGPU device. `createU2NetApp` handles model loading, queued execution, pause/resume, cancellation and cleanup through the inference kit's shared application runner. Its output retains the existing rembg-compatible RGBA bytes, dimensions and provenance.

Build a local installable package from a Kaminos checkout:

```sh
node scripts/pack-u2net-module.mjs --out /absolute/path/to/artifacts
# In your application's directory:
npm install /absolute/path/to/artifacts/kaminos-u2net-0.1.0.tgz
```

This source package contains browser code and the kit runtime. Weights are downloaded separately from the pinned BasinShapers U2Net package. A package built here is not a registry release.

```js
import { createU2NetApp } from '@kaminos/u2net';

const app = await createU2NetApp();
// Host your renderer on app.device. Attach foreground frame requests once:
const frame = app.foreground.request({
  requestId: 'my-frame',
  run: opportunity => opportunity.submit([renderer.encodeFrame(app.device)]),
});
await frame.completion;

// pixels is a complete Uint8Array/Uint8ClampedArray of RGB8 or opaque RGBA8.
const cutout = await app.removeForeground({ pixels, width, height, channels: 4 });
// cutout: { rgba, width, height, provenance }
// rgba follows rembg's Image.composite output; preserve it for downstream preparation.
await app.destroy();
```

A host that already owns the kit session and renderer service supplies both:

```js
const app = await createU2NetApp({ session, foreground, load: false });
await app.load();
const pending = app.removeForeground({ pixels, width, height, channels: 3, signal });
await app.pause();  // parks between complete GPU segments / CPU preparation phases
await app.resume();
app.stop();        // pending rejects with AbortError; another run can follow
await pending;
await app.destroy(); // waits for work and releases this model; borrowed host survives
```

Use these controls from your application's events while a run is active. `pause()` returns `null` during loading or while queued. An application accepts one cutout at a time; independent applications share session admission. Cancelling a queued call does not take the current renderer's foreground ownership. Loading is shared per instance and retryable after failure; destroying the application cancels its load. `load: false` defers loading until `load()` or the first call. `snapshot()` reports loading/run/control state and resource ownership.

The default `weightsUrl` pins `BasinShapers/u2net-webgpu` revision `f4f82a54b6e8d7ffd4321005dbff1cb03198c78b`, `f32/`. The loader verifies the graph schema, complete byte count and SHA-256. Set `weightsUrl` to serve that package from your own origin. `loadPackage` can supply an alternative loader returning the same `{graph, weights}` contract. `onProgress` reports loading and loaded package identity. Device/session/foreground identity must agree when borrowed; default WebGPU device limits suffice for this fixed network.

`removeForeground` preserves the producer's `segmentSize` option (default 32 dispatches). It offers the renderer a boundary before each segment, with one segment in flight, and services CPU preparation in foreground windows. `onPhase` receives each CPU phase and may return a promise. `cooperative: false` uses the direct producer path; pause and between-segment cancellation require cooperative execution. No fixed display cadence is promised.

The numerical route remains rembg 2.0.76 U2Net: source max-1024 Lanczos resize, 320×320 inference, min/max normalization, Lanczos mask resize, and naive cutout compositing. Already-transparent images belong in the downstream alpha-preparation path. EXIF orientation is not applied; supply orientation-1 decoded pixels. Model weights are Apache-2.0 and rembg is MIT; their licenses and source details accompany the [pinned weight package](https://huggingface.co/BasinShapers/u2net-webgpu/tree/f4f82a54b6e8d7ffd4321005dbff1cb03198c78b).

The lower-level `loadU2NetPackage`, `createU2NetRunner` and `removeForegroundU2Net` exports remain available. `app.model` exposes its loaded runner for advanced use; use it only when the application is idle, and let the application own disposal. Creating your own low-level runner leaves its admission, cancellation and disposal with you.
