# @kaminos/webgpu-inference-kit

A composable browser-native WebGPU inference runtime for model ports that need direct control over execution, scheduling, tensors, buffers, shared devices, and memory residency.

Use this package when you are porting a model to browser WebGPU and you do not want to rebuild the same runtime shell again: device acquisition, shader and pipeline caching, typed tensors, buffer upload and readback, phase programs, background queues, multi-route scheduling, shared resource residency, progress, cancellation, and device-loss recovery boundaries.

Strict route and run identity travels with the runtime so composed pipelines can distinguish live model output from stale, partial, cached, or fallback results.

## Install

```sh
npm install @kaminos/webgpu-inference-kit
```

## Start Here When Porting A Model

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

The first acquisition implementation assembles the complete source before exact-byte verification. On a cache miss, peak host memory may include that assembled source, the verified custody snapshot, and one independent cache-write buffer. It does not claim streaming verification directly into GPU allocations; ports with very large bundles should account for those three representations until the loader gains a chunk-authenticated bundle format.

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
    { resourceId: "decoder", manifest: decoderManifest },
    { resourceId: "head", manifest: headManifest },
  ],
});

const weights = await sharp.loadModelResourcePackageFromSources({
  package: modelPackage,
  sources: {
    encoder: new URL("./encoder.weights.bin", import.meta.url),
    decoder: new URL("./decoder.weights.bin", import.meta.url),
    head: new URL("./head.weights.bin", import.meta.url),
  },
  cache: modelBundleCache,
  signal: loadController.signal,
  onProgress(event) {
    console.info(event.resourceId, event.resourceEvent.loadedBytes);
  },
});

const encoderWeight = weights.tensors["encoder.weight"];
weights.report.sourceMemoryBound.largestResourceByteLength;
weights.release();
```

Every child manifest must name the same model and revision, resource ids and tensor names must be package-unique, and package identity binds each child's normalized allocation and tensor semantics. The complete source map is copied and every source class is validated before GPU work starts. Multi-resource packages reject mutable `ArrayBuffer` and typed-array sources at admission instead of cloning and retaining a second whole-model byte set; wrap direct bytes in immutable `Blob`s or use URL, `Request`, or `Response` sources. A single-resource package retains direct mutable-byte compatibility because no later asynchronous package boundary exists. Fetch-backed content and consumable response bodies are still read when their declared resource reaches the sequential loader; the package does not claim to snapshot remote content at admission.

Each resource retains its own SHA-256, CacheStorage entry, acquisition report, allocation identities, and cross-route single-flight reuse. Failure or cancellation releases every child lease already acquired and names the exact failed resource.

This bounds source acquisition to one declared package resource at a time; each resource can still carry the current cache-miss copies described above. It does not split one enormous allocation or claim an exact browser-process memory peak. Converters should partition large weight sets into useful independently allocated resources until a later chunk-authenticated format can safely stream within one allocation.

## What The Kit Gives A Port

- `createWebGpuInferenceRuntime(input)`: acquire or wrap a browser WebGPU device, preserve backend identity, expose runtime helpers, time named stages, and finish a runtime profile.
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
- `createWebGpuResourceFactory(input)`: collapse concurrent asynchronous creation or weight-upload requests for one absent resource into a single abortable flight, then issue independent route leases over the one resulting object.
- `defineWebGpuModelResourceManifest(input)`: freeze an exact model revision, bundle SHA-256, packed allocation ranges, and typed tensor views into a validated loading contract.
- `verifyWebGpuModelResourceBundle(manifest, bundle)`: hash the effective bytes with Web Crypto and reject length or identity mismatch before GPU work.
- `prepareWebGpuModelResourceBundle(manifest, bundle, options)`: establish a releasable, manifest-bound verified byte-custody handle using safe-copy or zero-copy `ArrayBuffer` transfer ownership.
- `acquireWebGpuModelResourceBundle(manifest, source, options)`: fetch or consume browser-native model bytes, stream uncapped progress, honor cancellation, verify exact manifest identity, recover from corrupt persistent cache entries, and return a verified custody handle plus effective-source report.
- `describeWebGpuModelResourceSource(source)`: validate a browser-native model source without fetching or consuming it and return its immutable source-class description.
- `createWebGpuModelResourceCacheStorage(input)`: adapt browser CacheStorage into an uncapped, caller-namespaced persistent model-bundle cache with cancellation and retriable lazy opening.
- `route.loadModelResourcesFromSource(input)`: acquire, verify, persist, and upload a browser-native source through shared session residency, release intermediate custody automatically, and return one model lease plus its acquisition report.
- `defineWebGpuModelResourcePackage(input)` and `route.loadModelResourcePackageFromSources(input)`: compose several same-model manifests into one sequentially acquired large-model package, preserve per-resource verification/cache/report identity, and return one composite lease with bounded source-resource granularity.
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
- `createForegroundBudgetGovernor(input)` for a long-lived adaptive control loop. The caller supplies scheduler bounds, attribution policy, hysteresis, and an `episodeEpochId`; each observation carries the same epoch plus a unique episode/firing identity. Exact replays cannot vote twice. `forgetEpisode()` and `clearDecisionHistory()` discard cached decisions while preserving replay protection, and `beginEpisodeEpoch(nextId)` is the explicit boundary that reclaims those identities and resets hysteresis while preserving the tuned scheduler.
- `createWebGpuSchedulerApplication(input)` for guarded application of governor decisions. It rejects foreign routes, skipped/stale/replayed revisions, undeclared controls, bounds mismatches, capped boundary retention, duplicate boundaries, and refresh attempts anywhere except an explicit `before-encode` boundary. Applying a revision while an invocation is active changes future invocations immediately but changes that active invocation only when it reaches its next boundary.
- `validateSharpBreathingRoomComparisonEvidence(comparison)` and `classifySharpBreathingRoomComparisonEvidence(comparison)` for the current SHARP default-vs-cooperative comparison contract.

This is the layer that should help SHARP, SF3D, Kimodo, image generators, and future long routes become breathable enough to coexist with rendering or other inference work in the same browser GPU process.

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
