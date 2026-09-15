# Getting Started

This guide runs one complete browser-native WebGPU model port. The example creates one inference session, registers one reusable route, compiles a small affine WGSL kernel once, queues two invocations, reports three progress phases for each job, returns complete numeric outputs, and tears down the route and owned device session.

The model is deliberately small so the runtime lifecycle remains visible. The same route shape scales to model-owned weights, kernels, preprocessing, cooperative boundaries, and output construction.

## Create The Browser App

Use a current browser with WebGPU enabled and a local module-aware development server. Vite is used here only to resolve the installed package import.

```sh
mkdir kaminos-webgpu-quickstart
cd kaminos-webgpu-quickstart
npm init -y
npm install @kaminos/webgpu-inference-kit
npm install --save-dev vite
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kaminos WebGPU Quickstart</title>
  </head>
  <body>
    <pre id="output">Running...</pre>
    <script type="module" src="/main.mjs"></script>
  </body>
</html>
```

Create `main.mjs` from this exact executable entrypoint:

<!-- exact-source: examples/minimal-model-port-runner.mjs -->
```js
import { runMinimalModelPort } from '@kaminos/webgpu-inference-kit/examples/minimal-model-port';

const output = document.querySelector('#output');

try {
  const report = await runMinimalModelPort({ gpu: navigator.gpu });
  output.textContent = JSON.stringify(report, null, 2);
} catch (error) {
  output.textContent = error.stack || String(error);
}
```

Start the app:

```sh
npx vite
```

Open the local URL printed by Vite. A successful report contains two queued invocations and their complete output arrays:

```json
{
  "status": "succeeded",
  "outputs": [
    [1, 3, 5, 7],
    [9, 11, 13, 15]
  ]
}
```

## Follow The Lifecycle

The complete adapter is published with the package at [`examples/minimal-model-port.mjs`](../examples/minimal-model-port.mjs). Its important boundaries are:

1. `createWebGpuInferenceSession()` acquires one browser WebGPU device and owns its coordinator and resource lifecycle.
2. `session.registerRoute()` creates the persistent model route and runtime.
3. `createMinimalModelAdapter()` creates the input and output tensors and compiles the affine pipeline once. Both queued jobs reuse that route-local state.
4. `route.enqueue()` gives every invocation an identity, progress history, explicit terminal state, and complete output.
5. The adapter destroys its model buffers, the route drains and unregisters, and `session.close()` destroys the owned device.

The queue runs the two jobs in order. A failure still resolves the affected job to an explicit failed completion record; the example converts that terminal record into an exception only after preserving it on `error.completion`.

## Replace The Minimal Model

Keep the session, route, queue, and terminal lifecycle while replacing the adapter's four model-owned pieces:

- Load and retain your actual weights and reusable tensors when the route is created.
- Replace the affine WGSL kernel with your model kernels and execution order.
- Accept your real invocation input and report progress at meaningful model boundaries.
- Return the complete result your application consumes.

Start with direct model execution. Add cooperative boundaries only where measurement shows that a long GPU, CPU, or worker phase prevents the rest of the browser application from making useful progress. The [advanced integration reference](./integration-reference.md) covers resource packages, residency, phase programs, cooperative execution, adaptive duties, foreground opportunities, and runtime telemetry.
