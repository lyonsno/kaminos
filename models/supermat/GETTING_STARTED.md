# SuperMat In Your Application

SuperMat turns an RGBA image into albedo, roughness, and metallic maps on your application's GPU. Build the standalone module into your application's static files and keep its worker alongside it. Load the hosted weights once, then reuse the model for subsequent images. When you're finished, drain outstanding work, release the model, and close its inference session. Your GPU device remains available to the rest of your application. No Kaminos server or Python service is needed at runtime.

## Build

From the Kaminos checkout:

```sh
npm ci
node scripts/build-supermat-module.mjs --out /path/to/your/application/models
```

Output: `supermat-inference.js` and `supermat-cpu-worker.js`.

## Load, Run, Release

`gpu` is your application's `{ device, adapter, backendIdentity }` context. `images` contains RGBA images shaped as `{ width, height, data }`, where `data` is an RGBA byte array. The example loads one model for all images and returns its results; each result contains `maps.albedo`, `maps.roughness`, `maps.metallic`, `maps.orm`, and floating-point `planes`.

```js
import {
  createSuperMatAdapter, createWebGpuInferenceSession,
  SUPERMAT_ROUTE_ID, SUPERMAT_HOSTED_WEIGHTS_URL,
} from './models/supermat-inference.js';

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
} from './models/supermat-inference.js';

const gpu = await requestBrowserWebGpuDevice(
  navigator.gpu, await superMatDeviceOptions(navigator.gpu),
);
```

`onProgress` receives weight-loading events; `onRunProgress` receives inference phases and completed cooperative duties. `weightsUrl` accepts a base URL containing the weight package's `package.json` and its resources. Serve the application over HTTPS or localhost.

For rendering alongside inference, use the kit's [shared-device getting-started example](../../webgpu-inference-kit/docs/getting-started.md) and the [Material Photograph composition](../../demos/material-photo/main.js).
