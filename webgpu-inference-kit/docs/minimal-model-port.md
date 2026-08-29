# Minimal Model Port

**Status:** Acceptance contract for the first runnable Model Port example.

The canonical example must take a developer from an empty browser project to a real WebGPU model output while teaching the same lifecycle used by larger ports.

It is a product example, not a scheduler demonstration. Cooperative execution appears only where the tiny model has a real work boundary.

## What It Builds

The example is a tiny weighted image model:

- input: one `ImageBitmap`;
- model: two small WGSL compute stages with a bundled deterministic weight file;
- output: a transformed image rendered to a canvas;
- lifecycle: one runtime, one loaded model session, and repeatable invocations;
- UI behavior: visible progress and cancellation.

The output should be visually legible and numerically deterministic enough for automated contract coverage. The model may be deliberately small, but its weights, tensor flow, dispatches, and output must be real.

## Clean-Project Path

The complete guide must start from:

```sh
npm create vite@latest kaminos-model-port -- --template vanilla-ts
cd kaminos-model-port
npm install
npm install @kaminos/webgpu-inference-kit
```

No checkout of Kaminos or another model repository is required.

## Required Example Shape

The example contains:

- one HTML file with an image picker, run button, cancel control, progress element, input preview, and output canvas;
- one application entry module;
- one Model Port module;
- one small local weight asset;
- two WGSL kernels;
- no generated framework layer.

The complete Model Port should remain readable in one sitting. The guide marks the exact places where a porter substitutes model resources, tensor declarations, kernels, phases, and output materialization.

## Required Runtime Behavior

The example must:

1. create or borrow a browser WebGPU runtime;
2. load the Model Port once;
3. fetch and upload the local weights once;
4. compile and retain both pipelines in the model session;
5. accept an `ImageBitmap`;
6. create invocation-local tensors;
7. execute two real compute stages;
8. report overall and phase progress with denominators;
9. support cancellation between the two stages;
10. render the declared output;
11. release invocation-local buffers after every terminal state;
12. reuse session-owned weights and pipelines on the second run;
13. dispose the loaded model and runtime cleanly.

## Public Example

```ts
import {
  createWebGpuRuntime,
} from "@kaminos/webgpu-inference-kit";
import { tinyImagePort } from "./tiny-image-port";

const runtime = await createWebGpuRuntime();
const model = await runtime.load(tinyImagePort, {
  resources: {
    weights: new URL("./tiny-image.weights", import.meta.url),
  },
});

const abortController = new AbortController();

const output = await model.run(inputBitmap, {
  signal: abortController.signal,
  onProgress(progress) {
    progressElement.value = progress.overallFraction;
    progressLabel.textContent =
      `${progress.phaseLabel} ${progress.phaseCompleted}/${progress.phaseTotal}`;
  },
});

renderToCanvas(output, outputCanvas);
```

This snippet becomes README material only after those exports and semantics exist in the installed package.

## Acceptance

Automated coverage must establish:

- clean installation resolves every public import;
- the example runs against a deterministic WebGPU test surface;
- output shape and selected numerical values match the fixture;
- a second invocation reuses persistent resources;
- cancellation before stage two prevents stage-two submission;
- a planted stage-two failure still releases invocation-local resources;
- progress is monotonic and every event carries overall and phase denominators;
- unsupported WebGPU and missing required features fail with actionable errors;
- production build includes the weight asset and both WGSL kernels.

A browser smoke then establishes:

- the selected image appears;
- progress changes while the model runs;
- cancellation remains interactive;
- the output canvas is nonblank and visibly transformed;
- a second run completes without reconstructing the model session.

## Growth Path

The guide ends by mapping each tiny example element to the larger runtime:

- one local weight file to authenticated model packages and chunk plans;
- two tensors to explicit working sets and shared residency;
- two kernels to model-specific fusion and dispatch control;
- two phases to long cooperative boundary manifests;
- one run to background queues and multi-route admission;
- one canvas output to application-specific depth, splat, mesh, motion, segmentation, or generated-image products.

The reader should be able to grow the example into a substantial port without replacing its runtime, session, invocation, progress, cancellation, or disposal model.
