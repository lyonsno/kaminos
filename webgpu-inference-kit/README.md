# @kaminos/webgpu-inference-kit

Run substantial WebGPU models as responsive components of browser applications.

Kaminos WebGPU Inference Kit gives model ports a shared session and device lifecycle, persistent model routes, queued invocations, cooperative scheduling, progress and terminal state, resource residency, and runtime telemetry. Ports retain ownership of their weights, kernels, tensor semantics, execution order, and output construction.

```sh
npm install @kaminos/webgpu-inference-kit@sharp-gpu-timestamp-assay
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
| [Stable Fast 3D](https://github.com/lyonsno/sf3d-webgpu) | Multi-stage image-to-geometry inference | Vision, reconstruction, decoding, and baking resources | Backbone, postprocessor, decoder, texture baking | Textured GLB mesh | Cooperative orchestration and model-owned bounded work |
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

## Proven On A Long-Running Product Route

In one measured product firing on an M4 Max in Chrome, SHARP generated `1,179,648` Gaussian splats over `185.3s` while a full Kaminos fire volume continued to simulate on every frame in the same browser and on the same GPU. Across `21,818` foreground frame intervals, p95 and p99 were `9.3ms` and `10.0ms`; `40` intervals exceeded `33.3ms`.

That firing demonstrates the runtime's central product target directly: long local inference sharing one browser and GPU with a continuously rendering application, while producing the complete model output and preserving measured foreground cadence.

## Continue Porting

- Read the [advanced integration reference](./docs/integration-reference.md) for the complete current API manual and scheduling contracts.
- Inspect the public exports in [`src/index.js`](./src/index.js).
- Start with one session, one registered route, one complete invocation, and direct model execution. Add cooperative boundaries where measurements show the application needs them.
