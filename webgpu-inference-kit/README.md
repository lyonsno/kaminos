# @kaminos/webgpu-inference-kit

Runtime helpers for browser WebGPU inference ports, with route receipts and scheduler profiles.

Use this package when you are porting a model to browser WebGPU and you do not want to rebuild the same boring runtime shell again: device acquisition, adapter/feature identity, shader and pipeline caching, buffer upload/readback helpers, stage timing, cooperative yield hooks, scheduler/backpressure metadata, route envelopes, and receipt validation.

The evidence pieces are not the product center. They are the safety layer that keeps a composed pipeline from mistaking a stub, fallback, stale cache, fixture, partial run, or wrong route for live model output.

## Install

```sh
npm install @kaminos/webgpu-inference-kit
```

## Start Here When Porting A Model

```js
import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_SHADER_STAGE,
  createWebGpuInferenceRuntime,
} from "@kaminos/webgpu-inference-kit";

const runtime = await createWebGpuInferenceRuntime({
  routeId: "sam3.segment-anything.webgpu-local.v0",
  runtimeLabel: "sam3-browser-webgpu",
  gpu: navigator.gpu,
  adapterOptions: { powerPreference: "high-performance" },
  kernel: {
    profile: "sam3-mask-decoder-v0",
    commit: import.meta.env?.VITE_GIT_COMMIT ?? null,
  },
  requiredStages: ["encode-image", "decode-mask", "readback-mask"],
  yieldMs: 0,
  waitForSubmittedWorkDone: true,
});

const weights = runtime.createBuffer({
  label: "sam3.mask-decoder.weights",
  size: weightsBytes.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
runtime.writeBuffer(weights, weightsBytes);

const imageEmbedding = runtime.createTensor({
  name: "sam3.image-embedding",
  shape: [1, 256, 64, 64],
  dtype: "f16",
  usage: WEBGPU_BUFFER_USAGE.storage |
    WEBGPU_BUFFER_USAGE.copyDst |
    WEBGPU_BUFFER_USAGE.copySrc,
});
runtime.uploadTensor(imageEmbedding, imageEmbeddingBytes);

const outputMask = runtime.createTensor({
  name: "sam3.output-mask",
  shape: [1, 1, 64, 64],
  dtype: "f32",
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
});

const params = runtime.createUniformBuffer({
  label: "sam3.mask-decoder.params",
  schema: [
    { name: "width", type: "u32" },
    { name: "height", type: "u32" },
    { name: "threshold", type: "f32" },
  ],
  values: { width: 64, height: 64, threshold: 0.5 },
});

await runtime.runStage("encode-image", async stage => {
  const module = stage.getShaderModule("sam3.image-encoder", imageEncoderWgsl);
  const pipeline = stage.getComputePipeline("sam3.image-encoder", {
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });

  // Encode commands, submit work, then yield at a real boundary if this phase is long.
  await stage.yieldToBrowser({ reason: "between-image-encoder-tiles" });
});

const maskDecoder = runtime.defineComputeKernel({
  name: "sam3.mask-decoder",
  code: maskDecoderWgsl,
  entryPoint: "main",
  bindings: [
    { name: "imageEmbedding", resource: imageEmbedding, visibility: WEBGPU_SHADER_STAGE.compute, access: "read-only-storage" },
    { name: "params", resource: params, visibility: WEBGPU_SHADER_STAGE.compute, type: "uniform" },
    { name: "outputMask", resource: outputMask, visibility: WEBGPU_SHADER_STAGE.compute, access: "storage" },
  ],
});

await runtime.runKernel(maskDecoder, {
  stage: "decode-mask",
  dispatch: [8, 8, 1],
});

const maskBytes = await runtime.runStage("readback-mask", async stage => {
  return stage.readBuffer(maskReadbackBuffer, { size: maskByteLength });
});

const profile = runtime.finishProfile({
  evidence: { mode: "live", source: "sam3-browser-webgpu-route" },
});
```

That `profile` is the runtime receipt substrate a route can attach to its outputs. It records the effective adapter/device identity, kernel profile, stage timings, required stages, and yield metadata for the run that actually happened.

## What The Kit Gives A Port

- `createWebGpuInferenceRuntime(input)`: acquire or wrap a browser WebGPU device, preserve backend identity, expose runtime helpers, time named stages, and finish a runtime profile.
- `createWebGpuResourceCaches(device)`: cache shader modules and compute pipelines by label plus descriptor so repeated stage invocations do not rebuild obvious resources.
- `createCooperativeYield(input)`: standardize cooperative browser yields, optionally waiting for `queue.onSubmittedWorkDone()` before yielding to the event loop.
- `runtime.createBuffer(descriptor)`, `runtime.writeBuffer(buffer, data, ...)`, and `runtime.readBuffer(buffer, options)`: small buffer helpers for model weights, activations, and readback paths.
- `runtime.createTensor(input)`, `runtime.uploadTensor(tensor, data)`, and `runtime.readTensor(tensor)`: create GPU-backed tensors with dtype, shape, strides, byte-length validation, and upload/readback helpers.
- `packUniforms(schema, values)` and `runtime.createUniformBuffer(input)`: pack small scalar/vector parameter blocks into WGSL-compatible uniform buffers and update them without hand-rolling offsets.
- `runtime.defineComputeKernel(input)` and `runtime.runKernel(kernel, options)`: build bind group layouts, bind groups, pipeline layouts, compute pipelines, command encoders, compute passes, dispatches, submits, and stage profile entries from one kernel descriptor.
- `runtime.runStage(name, fn, metadata)`: wrap major model phases such as ViT encoder blocks, diffusion steps, triplane decode, mask decode, readback, or mesh/splat finalization.
- `runtime.finishProfile(options)`: emit a `kaminos.webgpu-runtime-profile.v0` profile that downstream routes and schedulers can consume.
- `defineTensorManifest(input)`: normalize model tensor metadata, dtype sizes, byte lengths, offsets, and shapes for browser-loaded weight bundles.
- `requestBrowserWebGpuDevice(gpu, options)`: request a device using adapter-reported limits without silently imposing smaller caps.

## Route Composition Layer

The runtime helpers are the lowest useful layer. Route helpers sit above them so model ports can compose inside Kaminos without every repo inventing its own envelope:

- `defineWebGpuRoute(input)`, `createWebGpuRouteRegistry(routes)`, `createRouteInvocationRequest(route, input)`, `createRouteWorkerResult(route, input)`, and validators define worker-executable browser-local inference routes.
- `createMogeDepthNormalRouteDefinition(input)` and `createMogeDepthNormalRouteReceipt(input)` define the MoGE source-image to depth/normal/pointmap route.
- `createSharpImageToSplatRouteDefinition(input)` and `createSharpImageToSplatRouteReceipt(input)` define the SHARP source-image to splat candidate/depth/metadata route.
- `createKimodoTextToMotionRouteDefinition(input)` and `createKimodoTextToMotionRouteReceipt(input)` define the Kimodo text-prompt to SOMA77 joints/motion-clip route.
- `createSf3dImageToMeshRouteDefinition(input)` and `createSf3dImageToMeshRouteReceipt(input)` define the Stable Fast 3D source-image to mesh/albedo/normal route.

These route definitions are not meant to trap future ports into MoGE/SHARP/Kimodo/SF3D. They are examples of the current shared grammar: route id, input roles, output roles, backend kind, model identity, kernel/stage identity, scheduler posture, and output artifacts.

## Scheduler And Breathability Layer

Long browser WebGPU routes need to say how they behave under contention. The package exposes:

- `createWebGpuRouteSchedulerProfile(input)` and `validateWebGpuRouteSchedulerProfile(profile)` for requested versus effective scheduling, phase chunk sizes, yield cadence, submitted-work waits, breathability spans, checkpoints, and unsupported fields.
- `createSchedulerVerificationReceipt(input)` and `classifySchedulerVerificationReceipt(receipt)` for observation-bound scheduler proof. A route is not verified just because a config asked it to yield; observed events and boundary assertions must agree.
- `createWebGpuRouteBackpressureProfile(input)` and `validateWebGpuRouteBackpressureProfile(profile)` for visible-wait/furnace pressure, warm/cache posture, memory-sharing posture, and frame-tail impact.
- `validateSharpBreathingRoomComparisonEvidence(comparison)` and `classifySharpBreathingRoomComparisonEvidence(comparison)` for the current SHARP default-vs-cooperative comparison contract.

This is the layer that should help SHARP, SF3D, Kimodo, image generators, and future long routes become breathable enough to coexist with rendering or other inference work in the same browser GPU process.

## Receipt And Evidence Layer

Receipts answer: did this output actually come from the route, backend, model, and kernel the consumer thinks it did?

- `createWebGpuLocalRouteReceipt(input)`, `createWebGpuRouteReceiptFromArtifacts(input)`, `createRouteReceiptArtifacts(input)`, `finishAndValidateRouteProfile(input)`, `validateRouteReceipt(receipt)`, and `assertAuthoritativeRouteReceipt(receipt)` construct and validate route receipts.
- `classifyWebGpuRouteReceiptEvidence(receipt)` and `classifyWebGpuRouteWorkerResultEvidence(result)` distinguish authoritative live WebGPU output from fallback, cached, partial, stale, invalid, and route-mismatched output.
- `createWebGpuRouteSchemaContract(input)` gives route repos a compact conformance object for tests.

This layer matters because composition without identity is how a browser pipeline lies to itself. It should protect runtime work, not replace it.

## Current Direction

1. Make this package the first import a new browser WebGPU model port reaches for.
2. Keep extracting runtime chores only when at least two real routes need them or one port exposes a clearly reusable primitive.
3. Keep route receipts and scheduler verification strict enough that downstream systems can compose outputs without false authority.
4. Use MoGE, SHARP, Kimodo, SF3D, and SAM-style segmentation/image-generation ports to discover the next runtime primitives: bind-group layout helpers, uniform packing, tensor views, buffer pools, command submission patterns, tiled attention, and cooperative phase splitting.
5. Avoid becoming a generic ONNX, LLM, or universal tensor runtime until a concrete browser WebGPU route exposes an advantage we can actually own.

## Non-Goals

- Generic ONNX import parity.
- Competing with mature browser LLM runtimes without a concrete route-level advantage.
- Kaminos graph, scene, library, or promotion ownership.
- Hidden caps below adapter/device capacity without measured justification.
- Treating fallback, stale output, fixture data, partial output, or missing backend identity as successful live inference.
