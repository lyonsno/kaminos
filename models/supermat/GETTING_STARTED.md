# SuperMat In Your Application

SuperMat turns an RGBA image into albedo, roughness, and metallic maps on your application's GPU. Install the package, load the hosted weights once, and reuse the model for subsequent images. Release its resources when you're finished; your GPU device stays available to the rest of your application. No Kaminos checkout or Python service is needed.

## Install

```sh
npm install @kaminos/supermat
```

```js
import { createSuperMatAdapter, createWebGpuInferenceSession } from '@kaminos/supermat';
```

SuperMat uses a CPU worker for image preparation. Vite includes it automatically. With esbuild, copy the package's exported worker beside your built application module using the build recipe below.

For esbuild applications, install the build tool:

```sh
npm install --save-dev esbuild
```

`build.mjs`, in your application root:

```mjs
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/main.js'], outdir: 'dist',
  bundle: true, format: 'esm', platform: 'browser',
});
await copyFile(
  new URL(import.meta.resolve('@kaminos/supermat/worker')),
  new URL('./dist/supermat-cpu-worker.js', import.meta.url),
);
```

Run `node build.mjs` from the application root. `src/main.js` contains your application code, using the imports and lifecycle example below. Serve both output files from `dist`.

## Cooperative Application

The application entry point owns the session, foreground coordination, cancellation and model retirement. Supply your renderer's device to share it, or omit `device` to let the application create one.

```js
import { createSuperMatApp } from '@kaminos/supermat';

const materials = await createSuperMatApp({ device, onProgress });
try {
  const result = await materials.infer({ image, size: 512, onRunProgress });
  display(result.maps.albedo, result.maps.roughness, result.maps.metallic);
} finally {
  await materials.destroy();
}
```

`image` is `{ width, height, data }` with RGBA bytes. The package also exports `decodeImageRgba(file, materials.device)` for a browser image file. `infer` returns the adapter's complete output, including ORM, float planes, identity and timing fields. Adapter precision/kernel/worker options go in `adapterOptions`; per-inference scheduling policy goes in `scheduling`. The application retains the adapter's default precision. The cooperative demo selects its existing F16 product profile explicitly.

Use `load: false` to obtain the device and `materials.foreground` before loading, then call `materials.load()` when you want. A renderer submits frames with `materials.foreground.request(...)` before, during and after inference, using the kit's foreground request contract. During a cooperative inference, `pause()`, `resume()` and `stop()` control model duties while foreground rendering continues. `infer({ signal, ... })` also accepts an AbortSignal. Loading itself has no pause/resume contract; stopping an inference waiting for a shared load cancels that request while the load continues. `destroy()` cancels loading and waits for retirement.

For an existing coordinated host, pass `{ session, foreground }` from the same device and queue. Destruction preserves borrowed device/session/foreground resources. A standalone app owns its created device; its destruction releases it. `snapshot()` reports ownership and phase. `materials.adapter` retains direct access to the original producer when the host needs the lower-level interface.

The packaged [outside application source](examples/external-app/app.js) uses file input, material-map canvases, pause/resume/stop and a continuously rendered activity strip. Bundle that example as `dist/app.js`, copy its `index.html` into `dist`, and copy the exported worker beside the bundle as in the build recipe above. The existing [cooperative demo](https://github.com/lyonsno/kaminos/blob/main/models/supermat/supermat-demo.html) uses the same application entry point with its numerical and scheduling options.

## Adapter-Level Load, Run, Release

`gpu` is your application's `{ device, adapter, backendIdentity }` context. `images` contains RGBA images shaped as `{ width, height, data }`, where `data` is an RGBA byte array. The example loads one model for all images and returns its results; each result contains `maps.albedo`, `maps.roughness`, `maps.metallic`, `maps.orm`, and floating-point `planes`.

```js
import {
  createSuperMatAdapter, createWebGpuInferenceSession,
  SUPERMAT_ROUTE_ID, SUPERMAT_HOSTED_WEIGHTS_URL,
} from '@kaminos/supermat';

export async function inferMaterials(gpu, images, {
  weightsUrl = SUPERMAT_HOSTED_WEIGHTS_URL,
  onProgress, onRunProgress,
} = {}) {
  const session = await createWebGpuInferenceSession({
    sessionId: crypto.randomUUID(),
    device: gpu.device, adapter: gpu.adapter,
    backendIdentity: gpu.backendIdentity,
  });
  let route, model, failure;
  const outputs = [];
  try {
    route = await session.registerRoute({ routeId: SUPERMAT_ROUTE_ID });
    model = await createSuperMatAdapter({ route, weightsUrl, onProgress });
    for await (const image of images) {
      const job = route.enqueue({
        jobId: crypto.randomUUID(),
        execute: invocation => model.run({
          image, size: 512, onRunProgress,
          schedule: { runtime: route.runtime, invocation },
        }),
      });
      const completion = await job.completion;
      if (completion.status !== 'succeeded') {
        throw new Error(completion.failure?.message ?? completion.status);
      }
      outputs.push(completion.output);
      await route.drain();
      route.forgetJob(job.jobId);
    }
  } catch (error) {
    failure = error;
  } finally {
    const errors = [];
    for (const cleanup of [
      () => route?.drain(),
      () => gpu.device.queue.onSubmittedWorkDone(),
      () => model?.release(),
      () => session.close(),
    ]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) {
      throw new AggregateError(failure ? [failure, ...errors] : errors,
        'SuperMat cleanup failed', { cause: failure });
    }
  }
  if (failure) throw failure;
  return outputs;
}
```

For an application creating a new WebGPU device, the same module exports the device helpers:

```js
import {
  requestBrowserWebGpuDevice, superMatDeviceOptions,
} from '@kaminos/supermat';

const gpu = await requestBrowserWebGpuDevice(
  navigator.gpu, await superMatDeviceOptions(navigator.gpu),
);
```

`onProgress` receives weight-loading events; `onRunProgress` receives inference phases and completed cooperative duties. `weightsUrl` accepts a base URL containing the weight package's `package.json` and its resources. Serve the application over HTTPS or localhost.

For rendering alongside inference, use the kit's [shared-device getting-started example](https://github.com/lyonsno/kaminos/blob/main/webgpu-inference-kit/docs/getting-started.md) and the [Material Photograph composition](https://github.com/lyonsno/kaminos/blob/main/demos/material-photo/main.js).

## Build From Source

From the Kaminos checkout:

```sh
npm ci
node scripts/build-supermat-module.mjs --out /path/to/your/application/models
```

Output: `supermat-inference.js` and `supermat-cpu-worker.js`. For a direct-module application, replace the package import with `./models/supermat-inference.js` and keep the worker alongside it. Include the model's `LICENSE` and the Kit's `THIRD_PARTY_NOTICES.txt` when distributing those files.
