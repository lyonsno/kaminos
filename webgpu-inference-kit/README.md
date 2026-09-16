# @kaminos/webgpu-inference-kit

Run substantial WebGPU models as responsive components of browser applications.

Kaminos WebGPU Inference Kit gives model ports a shared session and device lifecycle, persistent model routes, queued invocations, cooperative scheduling, progress and terminal state, resource residency, and runtime telemetry. Ports retain ownership of their weights, kernels, tensor semantics, execution order, and output construction.

```sh
npm install @kaminos/webgpu-inference-kit
```

## Quick Look

A Kaminos application creates a session, registers a model route, and queues model-owned work through that route:

```js
import { createWebGpuInferenceSession } from "@kaminos/webgpu-inference-kit";

const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
  adapterName: "browser-primary-adapter",
});

const route = await session.registerRoute({
  routeId: "example.image-to-output.webgpu-local.v0",
});

const job = route.enqueue({
  jobId: crypto.randomUUID(),
  execute: invocation => runModel({ runtime: route.runtime, invocation }),
});

const completion = await job.completion;
if (completion.status === "succeeded") {
  useModelOutput(completion.output);
}
```

`runModel` is the port's model adapter. Reusable weights, pipelines, and buffers can remain resident through the registered route; the queued job captures invocation-specific input and resolves to an explicit terminal completion record.

## How It Fits Together

```text
Browser application
    |
    v
WebGpuInferenceSession
    |
    +-- Registered model route
    |       +-- reusable weights, pipelines, and buffers
    |       +-- queued invocation
    |       +-- model-specific output
    |
    +-- Registered model route
            +-- reusable weights, pipelines, and buffers
            +-- queued invocation
            +-- model-specific output
```

The session coordinates a shared WebGPU device, route lifecycle, global admission, and resource residency. A port typically places reusable model resources in route-scoped state and temporary run resources in invocation-scoped state.

A successful model port:

- Registers a route with the session
- Loads and retains its reusable model resources
- Accepts a well-defined invocation input
- Executes model-owned GPU, CPU, and worker work
- Reports meaningful progress and handles cancellation where its boundaries permit
- Retires temporary resources
- Returns a complete result the application can consume

## Model Port Anatomy

Kaminos separates common runtime machinery from model implementation and product workflow:

| Inference kit | Model port | Application |
| --- | --- | --- |
| Session and device coordination | Weights and pipelines | Product workflow |
| Route and invocation lifecycle | Tensor shapes and semantics | Route selection |
| Queued execution and admission | Preprocessing and postprocessing | Invocation inputs |
| Cooperative scheduling | Kernel dispatch and execution order | Progress presentation |
| Progress and terminal-state plumbing | Cooperative boundary placement | Foreground priorities |
| Timing and runtime telemetry | Output construction | Result presentation |

"Model port" names this integration role and architecture pattern. A port remains ordinary JavaScript, TypeScript, WGSL, and WebGPU code organized around the session, route, invocation, and output lifecycle.

## One Runtime, Different Models

Kaminos is already used across substantially different browser-native inference workloads:

| Port | Execution shape | Reusable route state | Useful work boundaries | Output | Current kit adoption |
| --- | --- | --- | --- | --- | --- |
| [MoGe](https://github.com/lyonsno/moge-webgpu) | Feed-forward image inference | Weights, pipelines, reusable tensors | Encoder, decoder, output phases | Depth, normals, and point map | Tensor, kernel, runtime, and route primitives |
| [Kimodo](https://github.com/lyonsno/kimodo-webgpu) | Iterative motion generation | Model weights and diffusion resources | Diffusion steps and major phases | Skeletal motion | Runtime and route primitives around browser diffusion, with external text embedding |
| [Stable Fast 3D](https://github.com/lyonsno/sf3d-webgpu) | Multi-stage image-to-geometry inference | Vision, reconstruction, decoding, and baking resources | Backbone blocks, two-stream attention tiles, postprocessor channel ranges, texture-bake texel batches, CPU phases on workers | Textured GLB mesh | Cooperative orchestration on every long boundary, bounded-prefix completion, scratch arena, resource caches, parity primitives, and shared-device foreground cadence |
| [SHARP](https://github.com/lyonsno/sharp-webgpu) | Long image-to-splat inference | Image encoder, depth, Gaussian decoder, and output resources | Encoder blocks, depth phases, decoder ranges, output batches | Gaussian splat scene | Cooperative orchestration, scheduling, shared-device foreground opportunities, and route composition |

Ports can adopt a common application-facing shape:

```text
shared session
    -> persistent model route
        -> queued invocation
            -> model-owned work
                -> cooperative boundaries where useful
                    -> complete model output
```

A new port identifies where reusable model state lives, what belongs to one invocation, how work enters the runtime, which execution boundaries are worth exposing, and what complete output the route returns.

## Cooperative Inference

Long WebGPU workloads can occupy the device or main thread long enough to make a functional model unpleasant to use inside an interactive product. A Kaminos port can expose work at model-meaningful boundaries such as transformer blocks, diffusion steps, decoder ranges, output batches, CPU phases, or worker jobs.

The runtime schedules those model duties so the browser can regain useful foreground opportunities between them. The port remains responsible for preserving model ordering and output semantics.

Ports can begin with direct execution and introduce cooperative boundaries where measurement shows that a phase is hostile to foreground responsiveness. The [advanced integration reference](./docs/integration-reference.md) covers scheduling policy, adaptive duty sizing, completion behavior, foreground opportunity donation, resources, multi-route admission, and runtime telemetry.

## Proven On Long-Running Product Routes

In one measured product firing on an M4 Max in Chrome, SHARP generated `1,179,648` Gaussian splats over `185.3s` while a full Kaminos fire volume continued to simulate on every frame in the same browser and on the same GPU. Across `21,818` foreground frame intervals, p95 and p99 were `9.3ms` and `10.0ms`; `40` intervals exceeded `33.3ms`.

That firing demonstrates the runtime's central product target directly: long local inference sharing one browser and GPU with a continuously rendering application, while producing the complete model output and preserving measured foreground cadence.

In a second measured product firing on the same M4 Max in Chrome, under a GPU Greenroom lease with no other tenant, [Stable Fast 3D](https://github.com/lyonsno/sf3d-webgpu) generated a complete textured GLB (`9,988` vertices, `1024²` albedo and normal maps) over `41.9s` while a same-page WebGPU contender on a second `GPUDevice` of the same GPU completed `83,813` compute submissions — about `4.4×` the submission rate the contender achieves beside the single-submit route (`1,999/s` vs `452/s`). Across `4,992` foreground frame intervals, p95 and p99 were `9.1ms` and `9.3ms`; `5` intervals exceeded `33.3ms`, the largest (`132.7ms`) in the one GPU stage still submitted monolithically (the CLIP material estimate). Every long GPU boundary ran as cooperative duties (fixed backbone blocks, two-stream attention tiles, bounded-prefix postprocessor channel ranges, texture-bake texel batches over a scratch arena), the five heavy CPU phases ran on model-owned workers, each cooperative report passed `validateWebGpuCooperativeExecutionReport` against its exact route, manifest and invocation identity with the measured duty counts (`24 / 2,922 / 702 / 61`), and the GLB was byte-identical to the route's uncontended single-submit output. In the same session the route also serviced `3,644` host frames submitted on its own device through `createWebGpuForegroundOpportunityInterlock` — `3,161` at cooperative duty boundaries — with the page's largest frame gap at `92.4ms`. The witness (`npm run smoke:product-route -- --contend` / `--contend-same-device` in the SF3D repo) records the effective route, the contender's completed submissions, per-stage frame-gap attribution, the kit validation records, and the output hash.

A first composition of the same SF3D route into the live Kaminos flame (Kaminos branch `cc/slow-sf3d-live-flame-0916`, on a second device because that app route does not lend its `GPUDevice`) kept the page animating throughout, but the flame's per-frame GPU work and SF3D's per-duty fences serialize on one GPU with neither side aware of the other: the two-stream stage advanced about ten times slower than standalone. That measurement is the case for the same-device interlock shape above, once the host lends its device.

## Continue Porting

- Follow [Getting Started](./docs/getting-started.md) to run a complete minimal WebGPU model port with one reusable route and two queued invocations.
- Read the [advanced integration reference](./docs/integration-reference.md) for the complete current API manual and scheduling contracts.
- Inspect the public exports in [`src/index.js`](./src/index.js).
- Start with one session, one registered route, one complete invocation, and direct model execution. Add cooperative boundaries where measurements show the application needs them.
