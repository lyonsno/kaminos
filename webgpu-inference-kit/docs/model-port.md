# Model Port

**Status:** Design target. The current package exposes the runtime primitives beneath this contract; it does not yet export `defineWebGpuModelPort`.

A Model Port is the complete browser-native definition of how one model is loaded, executed, observed, cancelled, and disposed through `@kaminos/webgpu-inference-kit`.

The goal is the shortest honest path from model architecture, weights, and WGSL kernels to a reusable browser-native model that can scale from one dispatch to a SHARP-sized route without replacing its public lifecycle.

## Lifecycle

The contract has three ownership levels:

1. **`WebGpuInferenceSession`** owns the adapter, device, shared queue coordination, capability profile, resource cache, and cross-model scheduling.
2. **`LoadedModel`** owns one loaded model's weights, compiled pipelines, persistent tensors, scratch plans, and reusable state.
3. **`ModelRun`** owns one invocation's inputs, temporary buffers, progress, cancellation, scheduling state, and outputs.

```text
ModelPort --loadModelPort--> LoadedModel --run--> ModelRun
                             |                  |
                             |                  +-- invocation temporaries and output
                             +-- persistent weights, pipelines, and tensors

WebGpuInferenceSession owns the shared device and composes every loaded model and run.
```

Successful, cancelled, and failed invocations release their temporary resources. Closing a `LoadedModel` releases its persistent model resources. Closing the inference session releases resources it owns and leaves borrowed application resources under caller ownership.

## Device Requirements And Acquisition

Every Model Port declares device-independent requirements before `load` can perform device-bound work:

```ts
export const myModelPort = defineWebGpuModelPort({
  id: "acme.image-model",
  version: "1",
  deviceRequirements: {
    requiredFeatures: ["shader-f16"],
    requiredLimits: {
      maxStorageBufferBindingSize: 512 * 1024 * 1024,
    },
  },
  // inputs, outputs, resources, and load follow
});
```

When the kit acquires an owned device, every port known at construction participates in preflight:

```ts
const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
  modelPorts: [myModelPort, auxiliaryPort],
});
```

The session unions required features and resolves each required limit to the strictest value required by any port according to WebGPU limit semantics. It rejects unsupported or mutually unsatisfied requirements before `requestDevice()` and records the contributing port and requirement. It does not request features or limits that no declared port or caller option requires.

When `device` is supplied instead of `gpu`, construction validates the same resolved requirements against the borrowed device and its declared backend identity. The borrowed `GPUDevice` remains caller-owned and is never destroyed by the session.

After acquisition, the session capability profile is fixed. Every later `loadModelPort(port)` validates that port's `deviceRequirements` against the existing profile. It never replaces or silently reacquires the session device. An insufficient later port fails with `MODEL_PORT_CAPABILITY_UNSUPPORTED`; the existing session and loaded models remain usable.

## Golden Path

```ts
const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
  modelPorts: [myModelPort],
});

const model = await session.loadModelPort(myModelPort, {
  resources: modelResources,
});

try {
  const output = await model.run(input, {
    signal,
    onProgress,
  });
  consume(output);
} finally {
  await model.close();
  session.close();
}
```

`WebGpuInferenceSession` is the package's existing application-level shared-device owner. `loadModelPort()` is the first-class layer added to that object; the design does not introduce another neighboring runtime constructor.

`run()` is the concise promise-based path. It is exactly the convenience projection `model.start(input, options).result`. Applications that manage queues, background work, or richer UI state use `start()`, which returns a `ModelRun` synchronously:

```ts
const job = model.start(input, { signal });
const unsubscribe = job.subscribeProgress(renderProgress);

try {
  const output = await job.result;
} finally {
  unsubscribe();
}
```

The run may enter the queue immediately, but a new subscriber replays the current trustworthy snapshot before receiving future progress. This removes the race between `start()` and observer attachment.

## Current Runtime Composition

`loadModelPort(port, options)` composes the package's current lower-level APIs:

```text
loadModelPort
    |
    +-- registerRoute
    +-- load model resources
    +-- establish persistent resource ownership
    +-- compile and cache kernels and pipelines
    +-- return LoadedModel
```

`registerRoute()` remains available to advanced adapters and incremental migrations. `createWebGpuInferenceRuntime()` remains the route-scoped runtime primitive used beneath a registered route. Model Port supplies one public model lifecycle over those layers rather than duplicating them.

## Definition

```ts
export const myModelPort = defineWebGpuModelPort({
  id: "acme.image-model",
  version: "1",
  inputs: imageInput(),
  outputs: tensorOutput({ dtype: "float32", ownership: "caller" }),
  deviceRequirements: {
    requiredFeatures: [],
    requiredLimits: {},
  },
  resources: {
    weights: binaryResource("model.weights"),
  },

  async load(ctx) {
    const weights = await loadWeights(ctx);
    const kernels = compileKernels(ctx);

    return {
      async run(input, run) {
        return executeModel({ input, run, weights, kernels });
      },

      dispose() {
        weights.dispose();
      },
    };
  },
});
```

The definition requires:

- a stable `id` and version;
- device-independent `deviceRequirements`;
- declared public inputs and outputs;
- declared external model resources;
- `load(ctx)`, which creates device-bound reusable state;
- a loaded-model `run(input, context)` implementation;
- deterministic loaded-model closure through its internal disposer.

Port definitions are device-independent. Device-bound work begins in `load`.

`load(ctx)` runs under a construction cleanup stack. Resources acquired through model-scoped runtime helpers register automatically; raw buffers, Workers, and other directly created objects must be registered immediately with `ctx.own(resource, disposer)`. Successful loading transfers the stack to the `LoadedModel`. If loading throws before returning, the stack unwinds in reverse acquisition order and the caller receives `MODEL_LOAD_FAILED` with both the primary cause and any cleanup failures. Partial construction never leaves an untracked model allocation behind.

## Port Authority

Port code retains direct control over:

- tensor shapes, strides, layouts, views, and precision;
- WGSL source and entry points;
- pipeline and bind-group layouts;
- fusion and dispatch geometry;
- command encoding and buffer reuse;
- readback and output materialization;
- phase decomposition and lawful split points.

Raw WebGPU access flows through runtime contexts that register submitted work with scheduling and lifetime machinery. V0 keeps model execution imperative and does not require a graph compiler or prescribe a model IR.

## Resources, Tensors, And Kernels

The runtime context exposes the package's existing resource, tensor, kernel, phase-program, scratch-arena, and worker-phase primitives through one model-scoped ownership boundary.

Resource declarations identify external bytes. A loaded model decides how those bytes become persistent GPU resources. A run allocates invocation-local tensors and may borrow declared persistent state. Ownership and disposal remain explicit at every transition.

The runtime may cache immutable shader modules and pipelines across compatible sessions. It may share a resident model allocation only when the resource identity and sharing policy admit it.

## Phases And Duties

Long routes expose named phases with weighted, denominator-bearing work:

```ts
return run.phase(
  {
    id: "encoder",
    label: "Image encoder",
    index: 1,
    count: 4,
    totalUnits: blocks.length,
    weight: 0.55,
  },
  async phase => {
    for (let index = 0; index < blocks.length; index += 1) {
      await phase.gpu({
        id: `encoder.block.${index}`,
        completionPolicy: "bounded-prefix",
        encode: gpu => encodeBlock(gpu, index),
      });
      phase.advance(index + 1);
    }
  },
);
```

A phase may run GPU duties, CPU duties, worker phases, or direct synchronous work. Scheduling policy is attached only where the port exposes a lawful boundary.

The same public model lifecycle applies whether a route uses ordinary serial execution, cooperative strict-prefix completion, bounded-prefix submission, adaptive ranges, foreground opportunity interlocks, or shared-device route admission.

## Progress

Every progress update carries:

- overall completed and total work;
- overall fraction;
- current phase id and label;
- phase index and phase count;
- phase completed and total units;
- phase fraction;
- current boundary or duty identity when one exists.

An update never reports only a local patch, tile, block, or duty number without its denominator and effect on overall progress.

Progress reflects completed work. Submission alone does not advance completed GPU progress when the selected completion policy requires queue-prefix retirement.

## ModelRun Contract

`LoadedModel.start(input, options)` returns a public `ModelRun` synchronously. Its stable surface is:

```ts
interface ModelRun<Output> {
  readonly runId: string;
  readonly state: "queued" | "running" | "succeeded" | "cancelled" | "failed";
  readonly currentProgress: ModelProgress | null;
  readonly result: Promise<Output>;
  cancel(reason?: unknown): boolean;
  subscribeProgress(
    listener: (progress: ModelProgress) => void,
    options?: { replayCurrent?: boolean },
  ): () => void;
}
```

`replayCurrent` defaults to `true`. A late subscriber therefore receives the current trustworthy snapshot and then future events. Progress remains monotonic and denominator-bearing. `onProgress` on `run()` and `start()` is sugar for the same subscription contract.

`cancel()` records cancellation intent. Before execution, cancellation prevents command submission. During execution, it prevents later model-owned work at the next lawful boundary but does not claim to preempt GPU work already submitted.

`result` resolves only after output validation, every submitted GPU work prefix owned by the invocation, and invocation cleanup have settled. On success, the successful output transfers from `ModelRun` to the caller immediately before resolution; all other invocation resources are released. A cancelled or failed run cleans up any untransferred output before rejection.

Rejection uses `ModelRunError`, which carries `code`, `runId`, `modelPortId`, `lastProgress`, `cause`, and cleanup failures when present. Stable codes include:

- `MODEL_RUN_CANCELLED`, with `cancellationStage` equal to `before-execution` or `during-execution`;
- `MODEL_INPUT_INVALID`;
- `MODEL_RUN_FAILED` for kernel or command execution failure;
- `MODEL_OUTPUT_FAILED` for validation, readback, or materialization failure;
- `WEBGPU_DEVICE_LOST`.

A primary cancellation or execution failure remains primary if cleanup also fails. Cleanup failure after otherwise successful execution rejects with `MODEL_RUN_FAILED`; the runtime never resolves an output while its retained invocation work is still unsettled.

## Cancellation And Failure

Cancellation is cooperative at model-owned boundaries. Pending work may stop before submission; work already accepted by WebGPU settles according to the selected completion policy.

The public failure surface distinguishes:

- unsupported WebGPU or missing capabilities;
- resource acquisition or verification failure;
- invalid input;
- session construction failure;
- cancellation before execution;
- cancellation during execution;
- kernel, command, or device failure;
- output materialization failure;
- device loss.

Failure and cancellation release invocation-local resources and preserve the last trustworthy progress state. They do not claim preemption of GPU work already submitted.

Capability and load failures use `MODEL_PORT_CAPABILITY_UNSUPPORTED`, `MODEL_RESOURCE_FAILED`, and `MODEL_LOAD_FAILED`. Calling `start()` after model closure begins fails with `MODEL_CLOSED`; loading or registering work after session closure fails with `SESSION_CLOSED`.

## Closing Models And Sessions

`LoadedModel` moves through `open`, `closing`, `closed`, and `close-failed` states. `await model.close()` performs the transition:

1. the first call marks the model `closing` and rejects new `start()` calls with `MODEL_CLOSED`;
2. queued runs that have not submitted work reject with `MODEL_RUN_CANCELLED`;
3. active runs receive cooperative cancellation and retain authority over their already submitted GPU work until it settles;
4. invocation cleanup completes before persistent model resources are released in reverse ownership order;
5. the model route unregisters only after its queue, resource flights, and leases are drained.

Concurrent and repeated `close()` calls observe the same settlement and do not dispose a resource twice. If persistent cleanup fails, closure enters `close-failed`, rejects with `MODEL_CLOSE_FAILED`, retains the cleanup report, and does not pretend the model is cleanly closed. Later calls return that same rejection rather than retrying already attempted disposers; the strict session close continues to refuse any unresolved leases or resource flights.

The existing lower-level `session.close()` contract stays strict and synchronous: it refuses to close while model loads or route registrations are in flight, while any route has active or queued work, or while resource flights or leases remain. It does not silently cancel or preempt them. Applications first `await model.close()` for every loaded model, then call `session.close()`. Repeated clean session closure is idempotent.

An owned session may destroy its owned device only after those checks pass. A borrowed `GPUDevice` remains caller-owned, and application-owned resources are never disposed by model or session closure.

The output schema declares whether a successful result contains caller-owned GPU resources and how the caller releases them. Before successful `result` resolution, outputs remain invocation-owned. After successful output transfer, model or session closure leaves the transferred output untouched.

## Results And Observation

`run()` resolves to the declared model output. Normal consumers do not unwrap an evidence object.

Progress, timings, profiles, scheduler telemetry, route identity, and execution reports are optional observers. They may describe a run but do not replace its output contract.

## Composition

Several Model Ports may load into one `WebGpuInferenceSession`. The session coordinates route admission, shared resources, foreground opportunities, and device loss while each port preserves its own model semantics.

Applications may compose model outputs into pipelines without forcing every port into one graph representation. A later pipeline layer can schedule Model Runs and connect typed outputs while Model Port remains the unit of model ownership.

## Admission

The first implementation is admitted only when:

- the minimal example runs from a clean install and produces its declared output;
- repeated runs reuse `LoadedModel` weights and pipelines;
- success, cancellation, failure, and disposal are deterministic;
- owned-device preflight resolves all initial port requirements before acquisition, while borrowed and later-loaded ports validate without device replacement;
- partial loading unwinds its construction cleanup stack;
- `ModelRun.result` cannot settle before submitted GPU work and invocation cleanup;
- model closure drains runs and persistent ownership while strict session closure refuses active work;
- progress always carries phase and overall denominators;
- a port can use raw WGSL and explicit dispatch geometry;
- the same API can wrap at least one existing substantial port without hiding its scheduling or memory controls;
- the README starter imports only APIs actually exported by the package.
