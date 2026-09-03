# @kaminos/webgpu-inference-kit

A composable browser-native WebGPU inference runtime for model ports that need direct control over kernels, scheduling, tensors, buffers, shared devices, and memory residency.

Build complete model ports with direct WebGPU compute while the runtime handles the machinery that every serious port otherwise has to rebuild: device acquisition, shader and pipeline caching, typed tensors, model loading, cooperative execution, background queues, multi-route scheduling, shared resource residency, progress, cancellation, and device-loss recovery.

The result is a model runtime that can share a browser and GPU with a live renderer, move long inference through model-owned work boundaries, and keep enough control to optimize kernels and memory for the actual architecture.

## Install

```sh
npm install @kaminos/webgpu-inference-kit
```

## What It Makes Possible

- **Direct browser-native execution.** Build tensors, buffers, uniforms, kernels, bind groups, phase programs, and readbacks on the browser's WebGPU device without routing model compute through a graph runtime.
- **Cooperative long-running inference.** Declare real GPU and CPU work boundaries, adapt exact range sizes from completed queue time, service foreground work before the next inference encode, and choose strict or caller-bounded queue-prefix completion.
- **Continuous background workflows.** Queue many jobs, admit work across several model routes, report denominator-bearing progress, cancel pending work, and preserve terminal failure state.
- **Shared model resources.** Load authenticated whole-model bundles or bounded chunks, cache them in the browser, share one resident allocation across routes, and hold only the weights and scratch required by the current phase.
- **Application-owned composition.** Reuse one WebGPU device for inference and rendering while the model adapter remains in control of numerical behavior, buffer lifetimes, dispatch geometry, and lawful split points.

```text
source + model weights
          |
          v
model adapter -> tensors / kernels / phase programs
          |
          v
declared GPU + CPU work boundaries
          |
          v
cooperative execution <-> foreground renderer / application work
          |
          v
shared WebGPU device -> depth / splat / mesh / motion outputs
```

## Running In Real Model Ports

| Port | Browser-native route | Kit adoption |
| --- | --- | --- |
| [SHARP WebGPU](https://github.com/lyonsno/sharp-webgpu) | image to 1.18M Gaussian splats | cooperative orchestration, scheduling, shared-device foreground opportunities, route composition |
| [SF3D WebGPU](https://github.com/lyonsno/sf3d-webgpu) | image to textured GLB mesh | cooperative orchestration and model-owned bounded work |
| [MoGe WebGPU](https://github.com/lyonsno/moge-webgpu) | image to depth, normals, and point map | tensor, kernel, runtime, and route primitives |
| [Kimodo WebGPU](https://github.com/lyonsno/kimodo-webgpu) | prompt to skeletal motion | runtime and route primitives around browser diffusion, with text embedding declared as an external backend |

### One Exercised Shared-GPU Product Route

On an M4 Max in Chrome, SHARP generated `1,179,648` Gaussian splats over `185.3s` while a full Kaminos fire volume continued to simulate on every frame in the same browser and on the same GPU. Across `21,818` foreground frame intervals, p95 and p99 were `9.3ms` and `10.0ms`; `40` intervals exceeded `33.3ms`.

That route is the runtime's central product target: long local inference that remains useful inside an application that is still visibly alive.

## Start Here When Porting A Long Model

Describe the route's real pre-submission boundaries once, then let the cooperative execution facade own safe-boundary servicing, exact range coverage, queue-prefix completion, adaptation, browser yields, progress, cancellation, and terminal settlement:

```js
import {
  createWebGpuCooperativeExecution,
  defineWebGpuCooperativeBoundaryManifest,
} from "@kaminos/webgpu-inference-kit";

const boundaries = defineWebGpuCooperativeBoundaryManifest({
  manifestId: "sf3d.cooperative-boundaries.v0",
  routeId: "sf3d.image-to-mesh.webgpu-local.v0",
  phases: [
    {
      phaseId: "image-encoder",
      boundaries: [{
        boundaryId: "dino-window-tiles",
        kind: "gpu-command",
        commandDutyKind: "compute",
        unit: "window-tile",
        totalItems: encoderWindowCount,
        progressWeight: 7,
        chunking: {
          mode: "adaptive",
          initialItems: 8,
          minItems: 1,
          maxItems: 32,
          targetDurationMs: 8,
          adjustmentGain: 0.375,
        },
        yieldPolicy: "after-duty",
        resources: {
          retain: ["dino.weights"],
          produce: ["dino.features"],
          release: [],
        },
      }],
    },
    {
      phaseId: "mesh-materialization",
      boundaries: [{
        boundaryId: "glb-compose",
        kind: "cpu-work",
        hostPhase: "presentation",
        unit: "mesh-primitive",
        totalItems: meshPrimitives.length,
        progressWeight: 1,
        chunking: { mode: "fixed", chunkItems: 1 },
        yieldPolicy: "after-duty",
        resources: {
          retain: ["mesh.geometry", "mesh.materials"],
          produce: ["scene.glb"],
          release: ["mesh.geometry", "mesh.materials"],
        },
      }],
    },
  ],
});

const abortController = new AbortController();
const execution = createWebGpuCooperativeExecution({
  runtime,
  manifest: boundaries,
  invocationId: crypto.randomUUID(),
  schedulingMode: "cooperative",
  signal: abortController.signal,
  onProgress(progress) {
    renderProgress(progress.percent, {
      completedItems: progress.completedItems,
      totalItems: progress.totalItems,
      phaseId: progress.currentPhaseId,
      boundaryId: progress.currentBoundaryId,
    });
  },
});

const glb = await execution.run(async cooperative => {
  const encoderTiles = cooperative.startBoundary("dino-window-tiles");
  for (let range = encoderTiles.nextRange(); range; range = encoderTiles.nextRange()) {
    await encoderTiles.runGpuDuty(range, {
      encode({ range, commandDuty }) {
        const encoder = device.createCommandEncoder({
          label: commandDuty.dutyId,
        });
        encodeDinoWindows(encoder, {
          firstWindow: range.itemStart,
          windowCount: range.itemCount,
        });
        return encoder.finish();
      },
    });
  }

  const composition = cooperative.startBoundary("glb-compose");
  for (let range = composition.nextRange(); range; range = composition.nextRange()) {
    await composition.runCpuDuty(range, {
      work({ range }) {
        appendGlbPrimitives(meshPrimitives.slice(range.itemStart, range.itemEnd));
      },
    });
  }
  return finishGlb();
});

const cooperativeReport = execution.finish();
```

For each cooperative GPU duty, Kaminos services pending foreground work before encoding, submits the exact model-owned command buffer, captures that inference prefix's queue fence immediately, adapts the next exact range from completed queue time, and yields to the browser. CPU duties use the same range and progress grammar with host-phase timing. Histories remain uncapped, and `actualRangeCount` becomes authoritative only when the boundary completes.

Fixed GPU boundaries can keep a caller-selected number of queue prefixes in flight instead of blocking the host after every submission:

```js
const execution = createWebGpuCooperativeExecution({
  runtime,
  manifest: fixedRangeBoundaries,
  invocationId: crypto.randomUUID(),
  schedulingMode: "cooperative",
  completionPolicy: "bounded-prefix",
  maxInFlightGpuDuties: 2,
  onProgress: renderProgress,
});
```

`strict-prefix` remains the default. `bounded-prefix` requires a positive `maxInFlightGpuDuties`, serializes concurrent caller admissions in range order, yields after each issued duty, and applies backpressure when the selected depth is occupied. Progress advances only when the oldest queue-prefix fence retires; submission alone never marks model work complete. Success, cancellation, and failure all drain work already accepted by WebGPU, while the uncapped report preserves every issued duty, raw queue duration, retirement status, maximum observed depth, and any secondary drain failures.

Use bounded-prefix completion when a model exposes fixed, output-independent ranges such as texture channels, decoder tiles, or cell ranges. Adaptive boundaries remain strict-prefix because each completed queue duration changes the next dispatch geometry; Kaminos rejects that combination rather than planning from stale observations.

Validate terminal execution with the package-owned contract instead of
rebuilding queue and progress checks in each model port:

```js
import {
  validateWebGpuCooperativeExecutionReport,
} from "@kaminos/webgpu-inference-kit";

const validation = validateWebGpuCooperativeExecutionReport(cooperativeReport, {
  expectedRouteId: "sf3d.image-to-mesh.webgpu-local.v0",
  expectedManifestId: "sf3d.cooperative-boundaries.v0",
  expectedInvocationId: invocationId,
  expectedSchedulingMode: "cooperative",
  expectedCompletionPolicy: "bounded-prefix",
  expectedGpuDutyCount: postProcessorDutyCount,
  expectedMaxInFlightGpuDuties: 2,
  requireConfiguredDepthObserved: true,
});

if (!validation.ok) {
  throw new Error(`cooperative execution did not settle: ${validation.errors.join("; ")}`);
}
```

The validator checks effective route, manifest, invocation, scheduling, and
completion-policy identity; denominator-bearing terminal progress; exact
boundary range coverage; uncapped retention; submitted, observed, unfenced,
issued, retired, and in-flight counts; bounded depth; queue-completion
authority; and every bounded duty's prefix-fence timing. It imposes no duty
count of its own: a port supplies `expectedGpuDutyCount` when its fixed
boundary geometry makes that count authoritative.

Raw adapters can bound queue-prefix completion without serializing every duty:

```js
import {
  createWebGpuBoundedSubmissionQueue,
} from "@kaminos/webgpu-inference-kit";

const submissions = createWebGpuBoundedSubmissionQueue({
  queue: device.queue,
  maxInFlightDuties: 2,
  signal: abortController.signal,
  yieldToBrowser: () => new Promise(requestAnimationFrame),
});

for (const range of exactRanges) {
  const encoder = device.createCommandEncoder({ label: range.rangeId });
  encodeRange(encoder, range);

  await submissions.submitDuty({
    dutyId: range.rangeId,
    commandBuffers: [encoder.finish()],
    metadata: {
      itemStart: range.itemStart,
      itemEnd: range.itemEnd,
    },
  });
}

const submissionReport = await submissions.drain();
```

`maxInFlightDuties` is a required caller-selected positive depth; the runtime does not invent a cap. The controller owns `queue.submit()`, captures that submission's queue-prefix fence immediately, and then yields to the browser, so caller code cannot submit work and throw before fence authority exists. Admission applies backpressure at the selected depth, concurrent callers retain call order, and terminal drain waits for queued admissions and every submitted prefix. Cancellation stops new admission but still drains work already accepted by WebGPU. The uncapped report keeps raw queue-prefix duration separate from host backpressure wait, because neither measurement proves presentation cadence or preempts a command buffer that has already been submitted.

Every progress event carries `completedItems`, `totalItems`, phase progress, and overall progress. A boundary whose total is discovered at invocation time declares `totalItems: null`; `startBoundary(boundaryId, { totalItems })` supplies the exact total before its first range. Until every total is known, aggregate progress remains `null` instead of presenting a fabricated percentage.

Set `schedulingMode: "disabled"` to exercise the same declared work as a pass-through A/B. That mode keeps command-duty measurement, omits cooperative preparation, adaptation, and per-duty yields, and captures one terminal queue-prefix fence before reporting success.

The first SF3D manifest should expose these model-owned duty families:

| Phase | Boundary unit | Initial control target |
| --- | --- | --- |
| DINO image encoding | window or token tile | completed queue duty near one display-frame budget |
| two-stream/QKV attention | query tile | completed queue duty near one display-frame budget |
| triplane decoding | decoder output tile | completed queue duty near one display-frame budget |
| marching tetrahedra | tetrahedron/cell range | bounded GPU duty with exact cell coverage |
| UV and texture baking | atlas tile | bounded GPU duty followed by cooperative CPU materialization |
| GLB materialization | mesh primitive or byte range | fixed CPU range with browser yield |

The model adapter remains the authority for buffer lifetimes, bind groups, dispatch geometry, numerical equivalence, and lawful split points. The manifest makes those boundaries reusable by the scheduler, progress UI, cancellation path, and terminal report without embedding SF3D or SHARP internals in the runtime.

Resource lists describe one boundary transition: `retain` names resources that
must already be live while the boundary executes, `produce` names resources
created by the boundary, and `release` names live resources retired after it
executes. A resource may therefore appear in both `retain` and `release` when
the boundary consumes it for the last time. A produced resource cannot also be
retained or released by that same boundary.

## Prove An Adapter Before Browser Smoke

Run the same adapter orchestration against deterministic Kaminos runtime
surfaces before paying for a model download or browser firing:

```js
import {
  runWebGpuCooperativeAdapterConformance,
} from "@kaminos/webgpu-inference-kit";

const conformance = await runWebGpuCooperativeAdapterConformance({
  conformanceId: "sf3d:cooperative-adapter:v0",
  adapterIdentity: {
    adapterId: "sf3d.browser-webgpu.v0",
    routeId: boundaries.routeId,
    packageName: "@kaminos/sf3d-webgpu",
    packageVersion: "0.1.0",
    sourceRevision: import.meta.env.VITE_GIT_COMMIT,
  },
  manifest: boundaries,
  initialResources: ["dino.weights", "decoder.weights"],
  expectedFinalResources: [
    "dino.weights",
    "decoder.weights",
    "scene.glb",
  ],
  runAdapter: runSf3dCooperativeAdapter,
});
```

The runner invokes `runAdapter()` four times through the real cooperative
execution facade:

1. cooperative success;
2. scheduling-disabled success over the same declared work;
3. cancellation after the first observed duty;
4. an injected queue or host-runtime failure.

`runAdapter` is a trust-bearing production-path callback: route the same
production orchestration through all four calls. The `scenario` argument and
scenario-bearing invocation identity are explicit diagnostics; use them to
interpret expected cancellation or failure while the injected runtime supplies
the behavioral difference. A passing report certifies the orchestration the
caller supplied, so bind production-path identity through adapter tests and the
reported source revision rather than substituting harness-only work.

It rejects unless every declared range has exact, gap-free coverage; terminal
progress has a real denominator and reaches 100%; enabled and disabled runs
return the same caller-owned `outputFingerprint`; cancellation and failure
leave no pending planner range; and the manifest's declared resource
transitions end with exactly `expectedFinalResources`.

The rejected error retains the complete immutable report at
`error.cooperativeAdapterConformanceReport`. Successful and failed reports keep
every scenario, progress event, execution report, and check without a hidden
cap. `kitVersion` is runtime-owned; adapter package identity and output
fingerprints are explicitly caller-declared. Bind the fingerprint to a
deterministic numerical or artifact baseline rather than a label.

This catches orchestration defects before browser smoke. It does not compile
WGSL, execute model kernels, observe physical buffer destruction, prove
numerical parity by itself, or claim foreground cadence. Those remain real
adapter and product-route obligations.

## Localize Numerical Drift

Capture model-selected intermediate tensors and compare them with an external
reference without making the runtime understand the model's stage graph:

```js
import {
  compareWebGpuParityArrays,
  createWebGpuParityCaptureRegistry,
  decodeWebGpuParityCaptureChunks,
  encodeWebGpuParityCaptureChunks,
} from "@kaminos/webgpu-inference-kit";

const captures = createWebGpuParityCaptureRegistry({ runId: invocationId });
captures.capture("decoder.fusion", await readDecoderFusion(), {
  shape: [1, 256, 96, 96],
  layout: "NCHW",
});

const chunks = await encodeWebGpuParityCaptureChunks(
  captures.get("decoder.fusion"),
  { chunkByteLength: 18 * 1024 * 1024 },
);

// `chunks` can cross a browser automation or worker boundary. The receiver
// verifies run, stage, ordering, byte coverage, per-chunk digests, and the
// complete tensor digest before exposing the reconstructed values.
const captured = await decodeWebGpuParityCaptureChunks(chunks, {
  expectedCapture: {
    runId: invocationId,
    stageId: "decoder.fusion",
    typedArrayConstructor: "Float32Array",
    shape: [1, 256, 96, 96],
    layout: "NCHW",
  },
});

const comparison = compareWebGpuParityArrays(captured.values, referenceValues, {
  stageId: captured.stageId,
  sampling: { mode: "stride", stride: 4, offset: 0 },
});
```

Comparison is exhaustive unless the caller explicitly supplies a deterministic
stride. Native floating comparison accepts `Float32Array`, which is the scalar
domain produced by WebGPU `f32` tensors. Decode FP16 storage into exactly
represented `Float32Array` values before calling the comparator. Integer typed
arrays compare under an explicit `integer-exact` mode. Actual and reference
arrays must use the same constructor; `Float64Array` is rejected because this
API is not a general binary64 statistics package. Positive and negative zero
are numerically equal for exact-match accounting.

Results retain source and compared element counts, the effective sample plan,
effective comparison type and normalization, value summaries, exact mismatch
count, maximum and RMS error, relative L2 error, and cosine similarity. The
effective normalization is currently always `none`: representation conversion
belongs to the model adapter and must happen before comparison. Unequal lengths,
mixed constructors, selected non-finite values, empty selections, invalid
shapes, non-finite metrics, unsupported representations, and transport identity
or integrity failures reject instead of producing a persuasive partial result.

The model port owns stage names, hook placement, GPU readback timing, shape and
layout meaning, convention alignment, and the tolerance used for its parity
claim. For example, normalization changes, equivalent quaternion signs, border
exclusion, and final mesh or splat interpretation belong beside the model that
defines those semantics. The kit owns the comparison and transport mechanics;
it does not infer model equivalence from a generic threshold.

## Build Runtime Primitives

```js
import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_HOST_PHASE,
  createForegroundBudgetGovernor,
  createWebGpuCommandDutyObservationFromReport,
  createWebGpuCommandDutyDescriptor,
  createWebGpuCommandDutyObservation,
  createWebGpuInferenceRuntime,
  createWebGpuSchedulerApplication,
} from "@kaminos/webgpu-inference-kit";

const routeId = "sam3.segment-anything.webgpu-local.v0";
const runtime = await createWebGpuInferenceRuntime({
  routeId,
  runtimeLabel: "sam3-browser-webgpu",
  gpu: navigator.gpu,
  adapterOptions: { powerPreference: "high-performance" },
  kernel: {
    profile: "sam3-mask-decoder-v0",
    commit: import.meta.env?.VITE_GIT_COMMIT ?? null,
  },
  requiredStages: ["encode-image", "decode-mask", "readback-mask"],
  hostPhases: {
    runId: crypto.randomUUID(),
    clock: {
      clockId: crypto.randomUUID(),
      source: "performance.now",
      timeOriginEpochMs: performance.timeOrigin,
    },
  },
  commandDuties: {
    runId: crypto.randomUUID(),
    clock: {
      clockId: crypto.randomUUID(),
      source: "performance.now",
      timeOriginEpochMs: performance.timeOrigin,
    },
  },
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

const maskProgram = runtime.defineProgram({
  name: "sam3.mask-program",
  tensors: { imageEmbedding, outputMask },
  uniforms: { params },
  kernels: {
    decodeMask: {
      code: maskDecoderWgsl,
      bindings: [
        { name: "imageEmbedding", resource: "tensor:imageEmbedding", access: "read-only-storage" },
        { name: "params", resource: "uniform:params", type: "uniform" },
        { name: "outputMask", resource: "tensor:outputMask", access: "storage" },
      ],
    },
  },
  phases: [
    {
      name: "decode-mask",
      kernel: "decodeMask",
      dispatch: [8, 8, 1],
      yieldAfter: true,
      commandDuty: {
        chunkControl: {
          controlId: "maskDecoderTiles",
          unit: "mask-decoder-tile",
          current: 8,
          bounds: { min: 1, max: 8, stepFactor: 2 },
        },
      },
    },
    { name: "readback-mask", readbacks: [{ name: "maskBytes", tensor: "outputMask" }] },
  ],
});
const programResult = await runtime.runProgram(maskProgram);
const maskBytes = programResult.outputs.maskBytes;

const profile = runtime.finishProfile({
  evidence: { mode: "live", source: "sam3-browser-webgpu-route" },
});
const hostPhaseReport = runtime.finishHostPhases();
const commandDutyReport = runtime.finishCommandDuties();
```

That `profile` is the runtime receipt substrate a route can attach to its outputs. It records the effective adapter/device identity, kernel profile, stage timings, required stages, and yield metadata for the run that actually happened.

## Load And Share Model Weights

A shared inference session can verify one content-addressed weight bundle, upload its packed allocation ranges once, and give every registered route an independent lease over the same GPU buffers:

```js
import {
  WEBGPU_BUFFER_USAGE,
  createWebGpuInferenceSession,
  createWebGpuModelResourceCacheStorage,
  defineWebGpuModelResourceManifest,
} from "@kaminos/webgpu-inference-kit";

const manifest = defineWebGpuModelResourceManifest({
  modelId: "acme/vision-model",
  revision: "0123456789abcdef",
  bundle: {
    byteLength: weightBytes.byteLength,
    sha256: publishedWeightSha256,
  },
  allocations: [{
    allocationId: "decoder",
    byteOffset: 0,
    byteLength: weightBytes.byteLength,
    usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst,
    tensors: [
      {
        name: "decoder.weight",
        dtype: "f16",
        shape: [256, 256],
        byteOffset: 0,
        byteLength: 256 * 256 * 2,
      },
      {
        name: "decoder.bias",
        dtype: "f16",
        shape: [256],
        byteOffset: 256 * 256 * 2,
        byteLength: 256 * 2,
      },
    ],
  }],
});

const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
});
const sharp = await session.registerRoute({ routeId: "sharp.image-to-splat.webgpu-local.v0" });
const sf3d = await session.registerRoute({ routeId: "sf3d.image-to-mesh.webgpu-local.v0" });

const modelBundleCache = createWebGpuModelResourceCacheStorage({
  cacheId: "cache-storage:kaminos-model-bundles-v1",
  cacheName: "kaminos-model-bundles-v1",
  cacheStorage: caches,
  baseUrl: new URL("/__kaminos_model_cache__/", location.origin),
});

const loadController = new AbortController();
const sharpWeights = await sharp.loadModelResourcesFromSource({
  manifest,
  source: new URL("./vision-model.weights.bin", import.meta.url),
  cache: modelBundleCache,
  signal: loadController.signal,
  onProgress(event) {
    console.info("model bytes loaded", event.loadedBytes, event.totalBytes);
  },
});

const sf3dWeights = await sf3d.loadModelResourcesFromSource({
  manifest,
  source: new URL("./vision-model.weights.bin", import.meta.url),
  cache: modelBundleCache,
});

sharpWeights.tensors["decoder.weight"].buffer ===
  sf3dWeights.tensors["decoder.weight"].buffer; // true
sf3dWeights.acquisitionReport.cache.status; // "hit"

// Tensor views expose buffer, bufferOffset, byteLength, shape, strides, and dtype,
// so they can be bound directly by runtime kernels and phase programs.
const decoderWeight = sharpWeights.tensors["decoder.weight"];

sharpWeights.release();
sf3dWeights.release();
```

`route.loadModelResourcesFromSource()` is the direct browser porting path. It accepts URL, `Request`, `Response`, `Blob`, `ArrayBuffer`, and typed-array sources; acquires and verifies the complete bundle; uploads allocations through the session's shared single-flight residency; releases intermediate host custody on every terminal path; and returns one independently releasable model lease with `acquisitionReport`. It streams uncapped progress events, honors `AbortSignal` while fetch, stream, cache, or upload work is pending, and records requested versus effective source identity. Acquisition defaults to copy custody; pass `{ ownership: "transfer" }` explicitly when an uncached full `ArrayBuffer` may be detached.

`createWebGpuModelResourceCacheStorage()` adapts the browser CacheStorage API with an explicit caller-owned `cacheId`, cache name, and HTTP(S) key namespace. Keys are derived from the manifest digest and byte length. Invalid cached bytes are deleted and refetched; transient cache failures remain visible in `acquisitionReport` while a valid source load can still succeed. The lower-level `acquireWebGpuModelResourceBundle()` and `route.loadModelResources()` calls remain available when a port needs to hold verified host bytes or control the source and upload phases separately.

The complete-bundle acquisition path assembles the complete source before exact-byte verification. On a cache miss, peak host memory may include that assembled source, the verified custody snapshot, and one independent cache-write buffer. It does not claim streaming verification directly into GPU allocations; ports with very large bundles should use the chunk-plan path below or account for those three representations.

Resource sharing is semantic by default. Model id, revision, manifest metadata, allocation metadata, tensor layout and metadata, bundle bytes, range, and usage all participate in the authenticated allocation identity. Equal bytes under different model semantics therefore produce different resident buffers.

Cross-semantic physical deduplication is available only as an explicit manifest policy:

```js
const sharedPhysicalManifest = defineWebGpuModelResourceManifest({
  ...manifestInput,
  resourceSharing: { policy: "content-addressed-physical-dedupe" },
});
```

That policy selects the content-addressed `physicalResourceId` for residency while retaining a distinct `semanticResourceId` and `semanticLeaseId` on every returned allocation and tensor view. Callers can inspect both identities instead of treating byte equality as semantic authorization.

Raw bundle input uses an owned byte snapshot, then hashes those exact bytes with Web Crypto before any GPU allocation. `prepareWebGpuModelResourceBundle()` makes ownership explicit: `copy` preserves mutable caller input, while `transfer` accepts a full `ArrayBuffer`, detaches it, and verifies/uploads the transferred storage without the loader allocating its own second full-size byte array. Transfer is ownership-consuming even when digest verification later fails; use `copy` when the caller must retain retry bytes. Prepared handles are module-authenticated, bound to the complete normalized manifest, do not expose mutable bytes, and reject reuse after release. Bundle length or digest mismatch fails before upload. Concurrent loads single-flight each policy-selected allocation identity, while cancellation and partial failure release every model lease already acquired. Released GPU buffers remain visible in session residency as explicit eviction candidates until caller policy evicts them; they are not reported as an active model.

### Load Large Models As Verified Packages

When one whole-model bundle would amplify host memory too far, compose several independently authenticated manifests into one model resource package. The route loads package resources strictly in declaration order, releases each source's intermediate custody before acquiring the next, and returns one composite lease:

```js
import { defineWebGpuModelResourcePackage } from "@kaminos/webgpu-inference-kit";

const modelPackage = defineWebGpuModelResourcePackage({
  packageId: "acme/vision-model:browser-f16",
  modelId: "acme/vision-model",
  revision: "0123456789abcdef",
  resources: [
    { resourceId: "encoder", manifest: encoderManifest },
    { resourceId: "decoder", chunkPlan: decoderChunkPlan },
    { resourceId: "head", manifest: headManifest },
  ],
});

const modelPackageSources = {
  encoder: new URL("./encoder.weights.bin", import.meta.url),
  decoder: Object.fromEntries(decoderChunkPlan.chunkIds.map(chunkId => [
    chunkId,
    new URL(`./decoder/${chunkId}.bin`, import.meta.url),
  ])),
  head: new URL("./head.weights.bin", import.meta.url),
};

const weights = await sharp.loadModelResourcePackageFromSources({
  package: modelPackage,
  sources: modelPackageSources,
  cache: modelBundleCache,
  signal: loadController.signal,
  onProgress(event) {
    console.info(event.resourceId, event.resourceEvent.loadedBytes);
  },
});

const encoderWeight = weights.tensors["encoder.weight"];
weights.report.sourceMemoryBound.largestResourceByteLength;
weights.report.sourceMemoryBound.largestSourceByteLength;
weights.release();
```

Every child manifest must name the same model and revision, resource ids and tensor names must be package-unique, and package identity binds each child's normalized allocation and tensor semantics. A child with `manifest` uses whole-source acquisition; a child with `chunkPlan` uses that plan's manifest and nested chunk source map. Source-only `v0` package identities remain compatible, while chunk-backed children additionally bind loader kind and chunk-plan identity. The complete ordinary and nested source maps are copied and every source class is validated before GPU work starts. One-shot packages, reusable package loaders, and direct chunk plans snapshot supported `fetchOptions` before work; each package child and each chunk fetch receives an independent materialization. Ordinary nested records and normalized headers materialize without inherited prototype authority. Standard `Headers`, header records, and tuple-array `HeadersInit` values are accepted and normalized to a null-prototype header record; arbitrary nested arrays are rejected rather than receiving unstable custom semantics. Accessors, cycles, abort signals, streams, functions, shared memory, and unsupported host objects also fail admission instead of leaking caller or prior-fetch mutation into a later request. Multi-resource packages reject mutable `ArrayBuffer` and typed-array whole-resource sources at admission instead of cloning and retaining a second whole-model byte set; wrap direct bytes in immutable `Blob`s or use URL, `Request`, or `Response` sources. A later single mutable chunk is snapshotted at package admission, while multi-chunk plans retain their existing mutable-byte rejection. Fetch-backed content and consumable response bodies are still read when their declared child reaches the sequential loader; the package does not claim to snapshot remote content at admission.

Each child retains its own whole-source acquisition report or chunk-load report, CacheStorage identity, allocation identities, and cross-route single-flight reuse. Failure or cancellation releases every child lease already acquired, names the exact failed package resource, and preserves the child authority report.

This bounds source acquisition to the largest ordinary child source or declared chunk while loading package children sequentially. It does not claim an exact browser-process memory peak or eliminate the cache-miss copies inside the currently active source unit.

For phase-aware loading, admit the same complete package and source map once with `route.createModelResourcePackageLoader()`. Admission validates every source and snapshots lawful mutable direct inputs before any GPU work, while `acquireResource()` loads only the named child and returns an independently releasable lease. A later acquisition reuses matching ordinary allocations directly from session residency without refetching source bytes; explicit eviction falls back to the source captured at admission. Chunk-backed children retain their chunk verification provenance and resident reuse path. Use replayable URL, `Request`, or `Blob` sources when an evicted resource may need to load again; a consumed `Response` remains a one-shot source rather than pretending to be replayable.

### Hold Only The Model Resources A Phase Needs

Long-running ports can declare the model resources required by each execution phase, prefetch the next useful resources, and release departed leases only after the target working set is complete:

```js
import {
  createWebGpuPhaseResourceWorkingSet,
  defineWebGpuPhaseResourcePlan,
} from "@kaminos/webgpu-inference-kit";

const packageLoader = sharp.createModelResourcePackageLoader({
  loaderId: "sharp.browser-f16.phase-loader",
  package: modelPackage,
  sources: modelPackageSources,
  cache: modelBundleCache,
});

const phasePlan = defineWebGpuPhaseResourcePlan({
  planId: "sharp.image-to-splat.browser-f16",
  resources: modelPackage.resources.map(resource => ({
    resourceId: resource.resourceId,
    declaredBytes: resource.manifest.bundle.byteLength,
  })),
  phases: [
    {
      phaseId: "encode-image",
      requiredResourceIds: ["encoder"],
      prefetchResourceIds: ["decoder"],
    },
    {
      phaseId: "decode-splats",
      requiredResourceIds: ["decoder", "head"],
    },
  ],
});

const workingSet = createWebGpuPhaseResourceWorkingSet({
  controllerId: "sharp:run-42:working-set",
  plan: phasePlan,
  residencySnapshot: () => session.residency.snapshot(),
  acquireResource: packageLoader.acquireResource,
});

await workingSet.transitionToPhase("encode-image", { signal });
await runEncoder();
const decodeTransition = await workingSet.transitionToPhase("decode-splats", { signal });
decodeTransition.heldDeclaredBytes;
decodeTransition.residency.evictionCandidates;

workingSet.close();
packageLoader.close();
```

The controller acquires required resources first and declared prefetch resources second, preserves existing leases across adjacent phases, and does not release the old phase until the complete target set has loaded. Acquisition failure or cancellation rolls back new leases and leaves the previous phase intact. If any release cannot be confirmed, the controller enters a recoverable `release-failed` or `close-failed` state, clears the phase claim, retains only unresolved leases in its snapshot, and lets `close()` retry that exact remainder. Device-loss invalidation clears non-retryable custody separately as `invalidatedResourceIds` and produces `prepared-after-invalidation` or `closed-after-invalidation` instead of relabeling invalidation as release. Residency diagnostics are caller-supplied and fail visibly without changing lease lifecycle. Plans, reports, transitions, and resource counts are uncapped.

### Reuse GPU Scratch Across Cooperative Duties

Preallocate a model adapter's proven scratch-slot graph once, reuse the same physical buffers across sequential command duties, and bind every reuse to the exact queue prefix that makes overwriting safe:

```js
import {
  createWebGpuScratchArena,
} from "@kaminos/webgpu-inference-kit";

const decoderScratch = createWebGpuScratchArena({
  arenaId: "sf3d.triplane-decoder.scratch",
  slots: decoderSlotGraph.map(slot => ({
    slotId: slot.slotId,
    declaredBytes: slot.capacityBytes,
    metadata: { role: slot.role },
  })),
  allocateSlot(slot) {
    const buffer = device.createBuffer({
      label: `scratch:${slot.slotId}`,
      size: slot.declaredBytes,
      usage: GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    return {
      resource: buffer,
      allocatedBytes: buffer.size,
      dispose(resource) {
        resource.destroy();
      },
    };
  },
});

for (const range of decoderRanges) {
  const use = decoderScratch.beginUse({
    useId: `decoder-range:${range.itemStart}:${range.itemEnd}`,
    signal,
  });

  const encoder = device.createCommandEncoder();
  encodeDecoderRange(encoder, {
    range,
    hidden: use.resource("decoder.hidden"),
    output: use.resource("decoder.output"),
  });
  device.queue.submit([encoder.finish()]);

  await use.markSubmitted({
    completion: device.queue.onSubmittedWorkDone(),
    authority: {
      kind: "queue-prefix",
      submissionId: range.submissionId,
      clockId: routeClockId,
    },
  });
}

decoderScratch.close({ reason: "texture-bake-phase-complete" });
```

The arena allocates each declared slot exactly once. One use owns the graph at a time; a submitted use keeps ownership until its caller-provided completion authority settles. Completion failure invalidates and disposes the graph, while pre-submission cancellation can abandon the use or close its enclosing lease. Snapshots retain exact declared, allocated, and active bytes plus uncapped use history.

Hold the arena as one resource in `createWebGpuPhaseResourceWorkingSet()`: construct it in `acquireResource()`, return it to the model adapter through the lease, and call `arena.close()` inside `lease.release()` before returning the working set's `released` status. This gives scratch the same phase lifetime, cancellation cleanup, and terminal retirement path as model weights without introducing a second residency controller.

### Move CPU Materialization Off The Main Thread

Run a one-shot CPU phase in a module Worker without surrendering request identity, transfer ownership, cancellation, progress, output validation, or terminal failure evidence:

```js
import {
  WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA,
  WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
  runWebGpuWorkerPhase,
} from "@kaminos/webgpu-inference-kit";

const executionId = crypto.randomUUID();
const { output, report } = await runWebGpuWorkerPhase({
  executionId,
  operationId: "texture-materialize",
  moduleId: "sf3d.texture-materialize.v0",
  createWorker() {
    return {
      worker: new Worker(
        new URL("./texture-materialize-worker.js", import.meta.url),
        { type: "module", name: "sf3d-texture-materialize" },
      ),
      identity: {
        moduleId: "sf3d.texture-materialize.v0",
        workerType: "module",
        source: "texture-materialize-worker.js",
      },
    };
  },
  payload: {
    features: features.buffer,
    normals: normals.buffer,
    resolution,
  },
  transfer: [features.buffer, normals.buffer],
  signal,
  timeoutMs: routePolicy.workerTimeoutMs,
  onProgress(progress) {
    routeProgress.publish(progress);
  },
  validateOutput(value) {
    if (!(value?.albedo instanceof ArrayBuffer)) {
      throw new Error("materializer output is missing albedo bytes");
    }
    if (!(value?.normalMap instanceof ArrayBuffer)) {
      throw new Error("materializer output is missing normal-map bytes");
    }
    return value;
  },
});

consumeTextures(output);
recordWorkerPhase(report);
```

The worker module imports and speaks the same explicit protocol:

```js
import {
  WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA,
  WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
} from "@kaminos/webgpu-inference-kit";

self.onmessage = async event => {
  const request = event.data;
  const identity = {
    executionId: request.executionId,
    operationId: request.operationId,
    moduleId: request.moduleId,
  };

  try {
    self.postMessage({
      schema: WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA,
      ...identity,
      sequence: 0,
      progress: { stage: "materialize", completed: 0, total: 1 },
    });

    const output = materializeTextures(request.payload);
    self.postMessage({
      schema: WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
      ...identity,
      status: "completed",
      output,
    }, [output.albedo, output.normalMap]);
  } catch (error) {
    self.postMessage({
      schema: WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
      ...identity,
      status: "failed",
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
      },
    });
  }
};
```

`createWorker()` returns both the Worker and its effective module identity; a mismatch fails before input transfer. The runtime captures `addEventListener`, `removeEventListener`, `postMessage`, and `terminate` exactly once, installs all lifecycle listeners before dispatch, transfers the caller's exact list once, and terminates the one-shot Worker on every terminal path. Progress sinks and output validators are synchronous contract boundaries; returning a Promise fails the phase instead of introducing an untracked asynchronous side effect. Constructor, capability, listener, dispatch, crash, deserialization, stale identity, malformed progress/result, worker-reported failure, cancellation, timeout, output-validation, and cleanup failures retain phase-specific terminal reports. Cleanup failure never replaces the primary failure or discards a valid output.

There is no default timeout and no progress/history cap. A timeout exists only when the caller supplies `timeoutMs`; values above the browser timer ceiling fail before Worker creation instead of collapsing to an immediate timeout. Otherwise the caller's `AbortSignal` and the Worker's own terminal events own settlement. After successful `postMessage()`, the report marks the transfer list `transferred`; canceled or failed work does not claim those inputs returned. The package does not silently fall back to main-thread execution.

### Stream Allocations As Authenticated Chunks

When one allocation is itself too large to assemble before upload, pair its existing semantic manifest with a chunk plan. Every allocation is covered exactly by independently authenticated, allocation-relative chunks, and each verified chunk is written directly into its declared buffer range:

```js
import {
  createWebGpuModelResourceCacheStorage,
  defineWebGpuModelResourceChunkPlan,
} from "@kaminos/webgpu-inference-kit";

const chunkPlan = defineWebGpuModelResourceChunkPlan({
  planId: "acme/vision-model:browser-f16-chunks",
  manifest,
  allocations: manifest.allocations.map(allocation => ({
    allocationId: allocation.allocationId,
    chunks: converterChunks[allocation.allocationId].map(chunk => ({
      chunkId: chunk.id,
      byteOffset: chunk.allocationByteOffset,
      byteLength: chunk.byteLength,
      sha256: chunk.sha256,
    })),
  })),
});

const weights = await route.loadModelResourceChunksFromSources({
  plan: chunkPlan,
  sources: Object.fromEntries(chunkPlan.chunkIds.map(chunkId => [
    chunkId,
    new URL(`./weights/${chunkId}.bin`, import.meta.url),
  ])),
  cache: createWebGpuModelResourceCacheStorage({
    cacheId: "vision-model-weights",
    cacheName: "kaminos-model-weights-v1",
    cacheStorage: globalThis.caches,
    baseUrl: "https://app.example/.kaminos/model-cache/",
  }),
});

weights.tensors["encoder.blocks.0.attn.qkv.weight"];
weights.chunkReport.sourceMemoryBound.largestChunkByteLength;
weights.release();
```

Chunk ids are globally unique inside a plan. Chunks must be positive, contiguous, 4-byte-aligned, and cover each allocation exactly in declaration order; chunk boundaries cannot cross allocations. Plan identity binds the manifest's normalized allocation/tensor semantics, logical chunk ids, ordered coverage, byte lengths, and chunk SHA-256 digests. Chunk-backed physical identities permit explicit content-addressed allocation reuse, while the default semantic policy keeps model meaning in the resource identity.

The route validates the complete source map before work, fetches and verifies one chunk at a time through the same persistent cache contract, and publishes an allocation through the existing resource factory only after all of its chunks verify. Corrupt persistent chunks are deleted, refetched, reverified, and replaced before upload. Corruption or all-waiter cancellation destroys the unpublished buffer; failure reports retain the exact allocation, chunk, cache/source report, completed allocations, progress, and cleanup. Concurrent routes single-flight the allocation and every waiter receives the creator's exact chunk failure identity. Successful flight joiners and later resident reusers expose the same immutable per-allocation verification provenance that authorized the original publication, without refetching or duplicating the GPU allocation. Multi-chunk plans reject mutable direct byte sources instead of cloning a whole model at admission; use immutable `Blob`, URL, `Request`, or `Response` sources. A single mutable chunk is snapshotted synchronously before the first asynchronous boundary. Fetch-backed content and consumable bodies are read when their chunk reaches the sequential loader; remote bytes are not snapshotted at plan admission.

The chunk route's byte authority is complete allocation coverage by the declared per-chunk SHA-256 digests. It does not claim to recompute `manifest.bundle.sha256`, authenticate unused bundle gaps, expose browser-global memory, or eliminate the current cache-miss copies within one chunk. Peak loader-owned source custody is bounded by the largest declared chunk, not an exact browser-process peak. There is no hidden chunk count or byte cap.

## What The Kit Gives A Port

- `createWebGpuInferenceRuntime(input)`: acquire or wrap a browser WebGPU device, preserve backend identity, expose runtime helpers, time named stages, and finish a runtime profile.
- `defineWebGpuCooperativeBoundaryManifest(input)` and `createWebGpuCooperativeExecution(input)`: declare a long route's GPU and CPU duty families once, execute exact fixed or adaptive ranges through safe pre-encoding boundaries, choose strict or caller-bounded queue-prefix completion for fixed GPU ranges, expose retirement-backed phase and overall progress, preserve cancellation/failure reports, and run a scheduling-disabled A/B over the same work.
- `createWebGpuResourceCaches(device)`: cache shader modules and compute pipelines by label plus descriptor so repeated stage invocations do not rebuild obvious resources.
- `createCooperativeYield(input)`: standardize cooperative browser yields, optionally waiting for `queue.onSubmittedWorkDone()` before yielding to the event loop.
- `createForegroundBudgetGovernor(input)`: adapt cooperative yield time or named phase chunk sizes from attributed foreground frame pressure while failing closed when route, host, and GPU duty evidence is incomplete or ambiguous.
- `createWebGpuSchedulerApplication(input)`: bind adaptive decisions to one route and one declared control set, preserve submitted work as non-preemptible, and let active invocations consume newer exact revisions only at explicit pre-encoding boundaries.
- `createWebGpuForegroundOpportunityInterlock(input)`: let live foreground consumers place real GPU work ahead of the next inference encode at an explicit safe boundary, with uncapped demand, submission, cancellation, and failure receipts.
- `createWebGpuCommandDutyDescriptor(input)` and `createWebGpuCommandDutyObservation(input)`: describe non-preemptible submitted command work, preserve uncapped measured duty, and bind reusable chunk controls to effective route/run/clock identity.
- `createWebGpuCommandDutyRecorder(input)` and `createWebGpuCommandDutyObservationFromReport(report, input)`: capture runtime-owned submissions automatically, preserve honest host-submit timing authority, and join a complete external measurement set into governor-ready duty observations.
- `createWebGpuHostPhaseRecorder(input)`: record uncapped, route/run/clock-bound CPU preprocessing, command encoding, queue submission, readback, presentation, and custom host intervals while preserving failed phases and the last trustworthy interval.
- `runtime.createBuffer(descriptor)`, `runtime.writeBuffer(buffer, data, ...)`, and `runtime.readBuffer(buffer, options)`: small buffer helpers for model weights, activations, and readback paths.
- `runtime.createTensor(input)`, `runtime.uploadTensor(tensor, data)`, and `runtime.readTensor(tensor)`: create GPU-backed tensors with dtype, shape, strides, byte-length validation, and upload/readback helpers.
- `packUniforms(schema, values)` and `runtime.createUniformBuffer(input)`: pack small scalar/vector parameter blocks into WGSL-compatible uniform buffers and update them without hand-rolling offsets.
- `runtime.defineComputeKernel(input)` and `runtime.runKernel(kernel, options)`: build bind group layouts, bind groups, pipeline layouts, compute pipelines, command encoders, compute passes, dispatches, submits, and stage profile entries from one kernel descriptor.
- `runtime.defineProgram(input)` and `runtime.runProgram(program)`: declare a small phase program above single-kernel dispatch, resolving named tensors/uniforms/buffers into kernel bindings, executing kernel phases, running readback phases, preserving staged profile metadata, and applying yield boundaries at phase edges.
- `runtime.runInvocation(input, fn)`, `runtime.applySchedulerDecision(decision)`, and `runtime.schedulerSnapshot()`: run arbitrary adapter code against a boundary-refreshable scheduler handle, apply guarded revisions while work is active, and inspect uncapped per-duty uptake history without claiming submitted-work preemption.
- `runtime.createInferenceQueue(options)`: retain an uncapped FIFO of background jobs, run one route invocation at a time, record uncapped progress and terminal outcomes, cancel pending work, and preserve explicit between-job decision barriers for queued control changes.
- `createWebGpuInferenceCoordinator(input)`: admit eligible heads from multiple route queues through one uncapped global FIFO, preserving route-local barriers, pending cancellation, and honest non-preemption boundaries.
- `createWebGpuInferenceSession(input)`: own one browser WebGPU device, backend identity, and coordinator across explicitly registered route runtimes, with device-loss and idle-close lifecycle truth.
- `createWebGpuResourceResidency(input)`: account for caller-declared GPU allocations once across routes, issue explicit route leases, retain released allocations as eviction candidates, and invalidate the whole ledger on device loss without claiming access to browser-global VRAM.
- `defineWebGpuPhaseResourcePlan(input)` and `createWebGpuPhaseResourceWorkingSet(input)`: declare phase-required and prefetched model resources, acquire complete target working sets before releasing departed leases, expose exact held-byte and residency pressure, and preserve recoverable unresolved custody after cancellation or release failure.
- `createWebGpuScratchArena(input)`: allocate one named scratch-slot graph, reuse it only after caller-provided completion authority settles, compose it under a phase-resource lease, and preserve exact uncapped allocation, use, failure, and retirement accounting.
- `runWebGpuWorkerPhase(input)`: run one transferable CPU phase in a model-identified Worker with exact request/progress/result identity, caller-owned cancellation or optional timeout, output validation, one-shot cleanup, and uncapped report-bearing terminal history.
- `createWebGpuResourceFactory(input)`: collapse concurrent asynchronous creation or weight-upload requests for one absent resource into a single abortable flight, issue independent route leases over the one resulting object, and optionally settle report-bearing cancellation from the creator's exact terminal failure.
- `defineWebGpuModelResourceManifest(input)`: freeze an exact model revision, bundle SHA-256, packed allocation ranges, and typed tensor views into a validated loading contract.
- `verifyWebGpuModelResourceBundle(manifest, bundle)`: hash the effective bytes with Web Crypto and reject length or identity mismatch before GPU work.
- `prepareWebGpuModelResourceBundle(manifest, bundle, options)`: establish a releasable, manifest-bound verified byte-custody handle using safe-copy or zero-copy `ArrayBuffer` transfer ownership.
- `acquireWebGpuModelResourceBundle(manifest, source, options)`: fetch or consume browser-native model bytes, stream uncapped progress, honor cancellation, verify exact manifest identity, recover from corrupt persistent cache entries, and return a verified custody handle plus effective-source report.
- `describeWebGpuModelResourceSource(source)`: validate a browser-native model source without fetching or consuming it and return its immutable source-class description.
- `createWebGpuModelResourceCacheStorage(input)`: adapt browser CacheStorage into an uncapped, caller-namespaced persistent model-bundle cache with cancellation and retriable lazy opening.
- `route.loadModelResourcesFromSource(input)`: acquire, verify, persist, and upload a browser-native source through shared session residency, release intermediate custody automatically, and return one model lease plus its acquisition report.
- `defineWebGpuModelResourcePackage(input)` and `route.loadModelResourcePackageFromSources(input)`: compose ordinary source-backed and chunk-plan-backed same-model children into one sequential package, preserve each child's verification/cache/report identity, and return one composite lease bounded by the largest ordinary source or chunk.
- `route.createModelResourcePackageLoader(input)`: validate one complete heterogeneous package admission without GPU work, acquire named children independently for phase working sets, reuse still-resident ordinary allocations without refetching, and fall back to admitted authenticated sources after explicit eviction.
- `defineWebGpuModelResourceChunkPlan(input)` and `route.loadModelResourceChunksFromSources(input)`: bind a semantic model manifest to exact per-allocation chunk coverage, verify/cache one source chunk at a time, upload verified bytes directly into ranged GPU buffer offsets, and publish each allocation through shared single-flight residency only after complete chunk verification.
- `loadWebGpuModelResources(input)` and `route.loadModelResources(input)`: upload each content-derived allocation through shared single-flight residency and return one independently releasable model lease whose tensor views plug into kernels and phase programs.
- `runtime.runStage(name, fn, metadata)`: wrap major model phases such as ViT encoder blocks, diffusion steps, triplane decode, mask decode, readback, or mesh/splat finalization.
- `runtime.finishProfile(options)`: emit a `kaminos.webgpu-runtime-profile.v0` profile that downstream routes and schedulers can consume.
- `defineTensorManifest(input)`: normalize model tensor metadata, dtype sizes, byte lengths, offsets, and shapes for browser-loaded weight bundles.
- `requestBrowserWebGpuDevice(gpu, options)`: request a device using adapter-reported limits without silently imposing smaller caps.

## Host Phases And Foreground Coexistence

When `hostPhases` is configured, the runtime automatically records command encoding, queue submission, and mapped/staged readback around the operations it owns. A model adapter can record work outside those helpers with the same route, run, and clock identity:

```js
const inputTensor = await runtime.runHostPhase(
  WEBGPU_HOST_PHASE.cpuPreprocess,
  () => preprocessImage(sourceImage),
  { detail: { width: sourceImage.width, height: sourceImage.height } },
);

await runtime.runHostPhase(
  WEBGPU_HOST_PHASE.presentation,
  () => presentProgressiveResult(partialResult),
  { detail: { iteration } },
);
```

`runtime.finishHostPhases()` returns every completed interval with effective route, run, monotonic clock, epoch projection, outcome, and failure identity. `projectWebGpuHostPhaseEvents(report, expectations)` converts a complete snapshot into foreground-correlation events only when the caller's expected route, run, and clock all match. This lets a scheduler distinguish host work from submitted GPU duty without joining unrelated pages or stale runs on timestamps alone.

Submitted WebGPU command buffers cannot be preempted after `queue.submit()`. Ports expose the useful control boundary before submission with a command-duty descriptor:

```js
const descriptor = createWebGpuCommandDutyDescriptor({
  routeId,
  runId,
  clockId,
  dutyId: `${runId}:attention:12`,
  phase: "triplane-attention",
  kind: "compute",
  chunkControl: {
    controlId: "attentionTiles",
    unit: "attention-tile",
    current: scheduler.phaseChunkSize.attentionTiles,
    bounds: { min: 1, max: 16, stepFactor: 2 },
  },
});

const commandDutyObservation = createWebGpuCommandDutyObservation({
  routeId,
  runId,
  clockId,
  firingId,
  duties: [{
    descriptor,
    observedDurationMs: 24.8,
    foregroundOverlapDurationMs: 19.2,
  }],
});
```

Observations retain every duty and reject capped, stale, duplicate, identity-mismatched, or incoherent input. The foreground governor can consume `commandDutyObservation` directly and reduce its declared `controlId` without a model-specific phase map. Descriptors without a chunk control remain useful attribution and cause the governor to donate yield time instead of inventing a split point.

When `commandDuties` is configured on the inference runtime, `runKernel()` records every submitted compute command and staged tensor readbacks record copy commands automatically. `runtime.finishCommandDuties()` returns the uncapped report. Its timestamps describe the host call to `queue.submit()` only; they do not claim GPU completion or isolated execution duration. Join the report with complete measured duty rows before asking the governor to act:

```js
const commandDutyObservation = createWebGpuCommandDutyObservationFromReport(
  commandDutyReport,
  {
    firingId,
    expectedRouteId: routeId,
    expectedRunId: commandDutyReport.runId,
    expectedClockId: commandDutyReport.clock.clockId,
    measurements: measuredDuties,
  },
);
```

Projection fails on recording prefixes, failed submissions, stale identity, capped or partial reports, corrupt submission timing, and missing, duplicate, or foreign measurements. Recorder failures remain visible in the report but cannot turn an already successful queue submission into an inference failure.

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
- `createWebGpuCommandDutyDescriptor(input)` and `createWebGpuCommandDutyObservation(input)` for portable command-boundary attribution and adaptive chunk-control selection across model ports.
- `createWebGpuCommandDutyRecorder(input)` and `createWebGpuCommandDutyObservationFromReport(report, input)` for automatic runtime submission capture and strict measured-duty projection.
- `createWebGpuAdaptiveCommandDutyPlanner(input)` for exact within-kernel ranges that grow or shrink toward a caller-owned completed-duty duration. The caller supplies the total work, initial range, duration target, and minimum/maximum chunk bounds; optional `adjustmentGain` exponent-damps each measured correction to control oscillation while preserving full-gain behavior at the default `1`. Receipts keep the raw full-gain recommendation separate from the effective correction. The planner preserves complete coverage and does not pretend to know the final range count until execution finishes.
- `createForegroundBudgetGovernor(input)` for a long-lived adaptive control loop. The caller supplies scheduler bounds, attribution policy, hysteresis, and an `episodeEpochId`; each observation carries the same epoch plus a unique episode/firing identity. Exact replays cannot vote twice. `forgetEpisode()` and `clearDecisionHistory()` discard cached decisions while preserving replay protection, and `beginEpisodeEpoch(nextId)` is the explicit boundary that reclaims those identities and resets hysteresis while preserving the tuned scheduler.
- `createWebGpuSchedulerApplication(input)` for guarded application of governor decisions. It rejects foreign routes, skipped/stale/replayed revisions, undeclared controls, bounds mismatches, capped boundary retention, duplicate boundaries, and refresh attempts anywhere except an explicit `before-encode` boundary. Applying a revision while an invocation is active changes future invocations immediately but changes that active invocation only when it reaches its next boundary.
- `validateSharpBreathingRoomComparisonEvidence(comparison)` and `classifySharpBreathingRoomComparisonEvidence(comparison)` for the current SHARP default-vs-cooperative comparison contract.

This is the layer that should help SHARP, SF3D, Kimodo, image generators, and future long routes become breathable enough to coexist with rendering or other inference work in the same browser GPU process.

For a single large kernel, adapt exact ranges from completed queue time instead of choosing one fixed chunk size for every operation:

```js
const planner = createWebGpuAdaptiveCommandDutyPlanner({
  plannerId: `${routeRunId}:decoder-conv`,
  unit: "output-item",
  totalItems: outputElements,
  initialChunkItems: 524_288,
  targetDurationMs: 8,
  adjustmentGain: 0.375,
  bounds: {
    minChunkItems: 65_536,
    maxChunkItems: outputElements,
  },
  metadata: { routeId, phase: "decoder-conv" },
});

for (let range = planner.nextRange(); range; range = planner.nextRange()) {
  const encoder = device.createCommandEncoder();
  encodeDecoderRange(encoder, {
    outputStart: range.itemStart,
    outputCount: range.itemCount,
  });
  device.queue.submit([encoder.finish()]);

  const queueStartMs = performance.now();
  await device.queue.onSubmittedWorkDone();
  planner.observeRange({
    rangeId: range.rangeId,
    observedDurationMs: performance.now() - queueStartMs,
    timingAuthority: "queue-work-done",
  });
  await serviceForegroundAndYield();
}

const completedPlan = planner.snapshot();
completedPlan.actualRangeCount;
```

Only one range may be pending at a time. Stale range ids and non-queue timing fail without advancing coverage. Every range carries exact completed-items-over-total progress; `actualRangeCount` remains `null` until the final range completes. History is uncapped, and the planner never invents chunk bounds beyond those supplied by the model adapter or higher-level governor.

```js
const scheduler = {
  mode: "cooperative",
  yieldMs: 4,
  waitForSubmittedWorkDone: true,
  phaseChunkSize: { attentionTiles: 16 },
};
const bounds = {
  yieldMs: { min: 0, max: 16, step: 2 },
  phaseChunkSize: {
    attentionTiles: { min: 1, max: 16, stepFactor: 2 },
  },
};
const schedulerApplication = createWebGpuSchedulerApplication({
  routeId,
  revision: 0,
  scheduler,
  bounds,
});
const runtime = await createWebGpuInferenceRuntime({
  routeId,
  gpu: navigator.gpu,
  kernel,
  schedulerApplication,
});
const governor = createForegroundBudgetGovernor({
  routeId,
  episodeEpochId: crypto.randomUUID(),
  targetFrameGapMs: 50,
  failureWindowsBeforeAdjust: 2,
  successWindowsBeforeRelax: 3,
  scheduler,
  bounds,
  attributionPolicy: {
    minimumCoveredFraction: 0.8,
    maximumSharedFraction: 0.25,
  },
});

const result = await runtime.runInvocation(
  { invocationId: crypto.randomUUID() },
  async invocation => {
    const tileCount = invocation.getControl("attentionTiles");
    return runAttentionInTiles({ tileCount, yieldToBrowser: invocation.yieldToBrowser });
  },
);

const decision = governor.observe({
  episodeEpochId: governor.snapshot().episodeEpochId,
  episodeId: routeRunId,
  firingId: routeRunId,
  frameTail,
  hostEventCorrelation,
  sharpDutyCorrelation: gpuDutyCorrelation,
  executionIdentity: { routeId, runId, clockId },
  commandDutyObservation,
});
if (decision.schedulerChanged) runtime.applySchedulerDecision(decision);
```

`runProgram()` opens and closes one invocation automatically. Before every compute or staged-readback command is encoded, the runtime refreshes that invocation to the newest valid scheduler revision, resolves any matching `commandDuty.chunkControl`, and later stores the exact boundary receipt in the submitted duty descriptor. Boundary rows begin as `pending-encode-validation`, settle to `encoded`, or fail as `failed-before-encode` with an exact phase; ending an invocation with an unsettled boundary fails it explicitly. Pending and encoded boundaries say submission is `not-claimed`; only a pre-encoding failure says `not-submitted`. The uncapped application snapshot proves boundary uptake and encoding outcome, while the command-duty report separately proves which encoded duties reached `queue.submit()`. Together they name requested and effective revision, yield delay, phase controls, route, invocation, phase, duty, and failure without relabeling old work. Custom raw-queue adapters call `invocation.refreshAtBoundary({ boundaryId, dutyId, phase, position: "before-encode" })`, consume `invocation.getControl(controlId)` to choose the next bounded duty, and call `invocation.settleBoundary({ boundaryId, status: "encoded" })` only after encoding succeeds; failures settle with `status: "failed-before-encode"`, `phase`, and `error`. `runtime.runKernel()` and staged readback perform that lifecycle automatically. Nothing here pretends an already submitted command buffer can be split or preempted.

### Put Real Foreground Work Between Inference Duties

`yieldMs: 0` gives the browser event loop a turn, but it does not guarantee that a live renderer submits before inference occupies the queue again. Configure `foregroundOpportunities` when the foreground application can identify actual frame demand and encode against the same device:

```js
const runtime = await createWebGpuInferenceRuntime({
  routeId,
  device,
  adapterName,
  kernel,
  schedulerApplication,
  foregroundOpportunities: {
    runId: crypto.randomUUID(),
  },
});

function requestKilnFrame(frameId) {
  return runtime.requestForegroundOpportunity({
    requestId: `kiln-frame:${frameId}`,
    metadata: { frameId },
    run({ device, submit, signal }) {
      if (signal.aborted) return;
      const commandBuffer = encodeKilnFrame(device, frameId);
      submit([commandBuffer], {
        submissionId: `kiln-frame:${frameId}:submit`,
        metadata: { frameId },
      });
    },
  });
}

requestAnimationFrame(frameId => {
  const frame = requestKilnFrame(frameId);
  frame.completion.then(receipt => updateFrameDiagnostics(receipt));
});
```

At the next runtime-owned compute or staged-readback boundary, every request already pending is serviced before the scheduler refreshes and before inference constructs its next command duty. A scheduler decision produced by that foreground work can therefore govern the immediately following inference encode. Requests arriving while an opportunity is open are retained for the next boundary, preventing an endless producer from silently extending one interleave window forever. Service turns are serialized across concurrent invocations: a later inference boundary cannot encode through a foreground callback that is still active, and demand arriving during that callback is serviced by the queued boundary turn. The runtime takes the direct preparation path only when no request or service turn is pending, active, or queued.

The submission lease records each `queue.submit()` call and preserves callback, serialization, cancellation, and submission failures. `cancel(reason)` removes a pending request or aborts an active callback through its signal. Raw adapters using the synchronous `runtime.prepareCommandDuty()` path fail loudly while foreground pressure exists; await `runtime.prepareCommandDutyAtBoundary()` at the pre-encode boundary so the opportunity is serviced before inference resumes. Receipts prove callback execution and queue submission return only; they do not prove GPU completion, compositor presentation, or frame cadence. An already submitted inference duty remains non-preemptible, so responsive products still need adapter chunk bounds small enough to reach these opportunities within their frame budget.

## Background Inference Queue

Long routes such as SHARP and SF3D are often better product citizens as a continuous background queue than as a modal wait. A runtime-bound queue serializes full invocations while allowing the product to submit many jobs immediately:

```js
const inferenceQueue = runtime.createInferenceQueue();

const job = inferenceQueue.enqueue({
  jobId: crypto.randomUUID(),
  metadata: { sourceImageName: file.name },
  async execute(invocation) {
    return runSharpInference({
      sourceImage,
      spnFusionOutputItems: invocation.getControl("spnFusionOutputItems"),
      yieldToBrowser: invocation.yieldToBrowser,
      onProgress(progress) {
        invocation.reportProgress(progress);
      },
    });
  },
});

const completion = await job.completion;
if (completion.status === "succeeded") showAsset(completion.output);
```

`job.cancel(reason)` cancels only a pending job. Once its invocation has started, the handle returns `not-cancelled-active`; it never implies that submitted WebGPU work was preempted. `completion` always resolves to a terminal record (`succeeded`, `failed`, or `cancelled-before-start`) with route/job identity, scheduler revision, uncapped progress, and explicit output/failure presence.

Adaptive decisions enter the queue as control barriers:

```js
const applicationReceipt = await inferenceQueue.scheduleSchedulerDecision(decision);
```

A queued decision waits for the active invocation to finish and applies before the next pending job. The queue owns an immutable copy of the decision, records applied and failed control attempts, and continues processing after job or decision failure. `snapshot()` exposes every retained job and decision without a hidden cap; `forgetJob(jobId)` is the explicit reclamation boundary, and `drain()` resolves once no job, decision, or active invocation remains.

## Multi-Route Admission

SHARP, SF3D, Kimodo, and other long routes can share one admission coordinator while keeping separate route runtimes and queues:

```js
const coordinator = createWebGpuInferenceCoordinator();
const sharpRuntime = await createWebGpuInferenceRuntime({
  routeId: SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
  device,
  adapterName,
  admissionCoordinator: coordinator,
});
const sf3dRuntime = await createWebGpuInferenceRuntime({
  routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
  device,
  adapterName,
  admissionCoordinator: coordinator,
});

const sharpQueue = sharpRuntime.createInferenceQueue();
const sf3dQueue = sf3dRuntime.createInferenceQueue();
```

Each queue offers only its locally eligible head job after scheduler barriers have applied. The coordinator grants those heads in global FIFO order, so one route cannot reserve the browser GPU with its entire backlog. Pending jobs can cancel while awaiting admission; active invocations remain explicitly non-preemptible. Coordinator snapshots retain every admission until `forgetAdmission(sequence)`, and `drain()` resolves only when no admission is active, pending, or scheduled.

## Shared Inference Session

Use a session when several routes should share the same physical WebGPU device and admission coordinator:

```js
const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
  adapterName: "browser-primary-adapter",
});

const sharp = await session.registerRoute({
  routeId: SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
  runtimeOptions: { schedulerApplication: sharpScheduler },
});
const sf3d = await session.registerRoute({
  routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
});

const sharpWeightLease = sharp.acquireResource({
  resourceId: "dinov2.vitl14.weights.f16",
  declaredBytes: sharpWeightBuffer.size,
  kind: "model-weight",
  metadata: { precision: "f16" },
  resource: sharpWeightBuffer,
});
const sf3dWeightLease = sf3d.acquireResource({
  resourceId: "dinov2.vitl14.weights.f16",
  declaredBytes: sharpWeightBuffer.size,
  kind: "model-weight",
  metadata: { precision: "f16" },
});

const sharpJob = sharp.enqueue({
  jobId: crypto.randomUUID(),
  execute: invocation => runSharpInference(sharp.runtime, invocation),
});

await sharpJob.completion;
sharpWeightLease.release();
sf3dWeightLease.release();

const candidate = session.residency.snapshot().evictionCandidates.find(
  resource => resource.resourceId === "dinov2.vitl14.weights.f16",
);
if (candidate) {
  session.residency.evict(candidate.resourceId);
  sharpWeightBuffer.destroy();
}
```

The session retains route registrations until `unregisterRoute(routeId)`. Route handles share one residency runtime and acquire resources under their own route identity. The first acquisition supplies the live WebGPU object; later routes acquiring a matching descriptor receive that identical object from their lease. One global declared-byte allocation then serves every active route lease. Conflicting descriptors or different live objects for the same identity fail loud.

Releasing the last lease makes an allocation eligible for eviction. Borrowed resources remain caller-owned, so the caller explicitly evicts the record and disposes the WebGPU object. A resource acquired with `ownership: "managed"` and `dispose(resource)` instead transfers disposal to the residency runtime; explicit eviction or orderly session close invokes its disposer exactly once. Device loss clears references without claiming a redundant destroy of already-invalid GPU objects.

Residency snapshots expose exact caller-declared bytes, not browser-global VRAM usage. They retain every resource until explicit `forget(resourceId)`, preserve zero-byte route participation after release, and never impose a hidden memory cap. `unregisterRoute()` and `close()` reject active resource leases so ownership cannot disappear silently.

When several routes may request the same absent allocation concurrently, create it through the route-scoped factory instead of racing independent uploads:

```js
const lease = await sharp.residency.acquireOrCreate({
  resourceId: "dinov2.vitl14.weights.f16",
  declaredBytes: weightsBytes.byteLength,
  kind: "model-weight",
  metadata: { precision: "f16" },
  signal: abortController.signal,
  async create({ signal }) {
    const buffer = sharp.runtime.createBuffer({
      label: "dinov2.vitl14.weights.f16",
      size: weightsBytes.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (signal.aborted) throw signal.reason;
    sharp.runtime.writeBuffer(buffer, weightsBytes);
    return buffer;
  },
  dispose(buffer) { buffer.destroy(); },
});
```

Every concurrent matching requester joins one creator and receives the same `lease.resource`. Cancellation removes only that waiter while others remain; cancelling every waiter aborts the creator. Failed flights remain visible and a later request starts a new generation. Created resources are managed because a runtime-created GPU object without owned disposal is a leak. Flight history is uncapped until explicit `forgetFlight(flightId)`.

Managed route handles also gate enqueue and scheduler changes after device loss while still exposing each runtime for adapter kernels and buffers. If `device.lost` resolves, the session preserves the opaque browser reason/message, cancels pending jobs, rejects new managed work, invalidates all residency accounting, and leaves active work to complete or fail without claiming preemption. Recovery requires a new session and rebuilt device resources.

`close()` requires every route queue to be idle. It destroys a device requested by the session and leaves a borrowed device untouched. `session.deviceLost` remains the exact asynchronous loss record, including intentional `destroyed` loss after an owned session closes.

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
5. Expand model and graph coverage where browser-native control over scheduling, memory, kernels, or composition produces a measured advantage.
