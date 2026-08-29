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

Successful, cancelled, and failed invocations release their temporary resources. Disposing a `LoadedModel` releases its persistent model resources. Closing the inference session releases resources it owns and leaves borrowed application resources under caller ownership.

## Golden Path

```ts
const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
});

const model = await session.loadModelPort(myModelPort, {
  resources: modelResources,
});

const output = await model.run(input, {
  signal,
  onProgress,
});
```

`WebGpuInferenceSession` is the package's existing application-level shared-device owner. `loadModelPort()` is the first-class layer added to that object; the design does not introduce another neighboring runtime constructor.

`run()` is the concise promise-based path. Applications that manage queues, background work, or richer UI state use `start()`:

```ts
const job = model.start(input, { signal });
const unsubscribe = job.subscribeProgress(renderProgress);

try {
  const output = await job.result;
} finally {
  unsubscribe();
}
```

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
  outputs: tensorOutput({ dtype: "float32" }),
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
- declared public inputs and outputs;
- declared external model resources;
- `load(ctx)`, which creates device-bound reusable state;
- a loaded-model `run(input, context)` implementation;
- deterministic loaded-model disposal.

Port definitions are device-independent. Device-bound work begins in `load`.

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
- progress always carries phase and overall denominators;
- a port can use raw WGSL and explicit dispatch geometry;
- the same API can wrap at least one existing substantial port without hiding its scheduling or memory controls;
- the README starter imports only APIs actually exported by the package.
