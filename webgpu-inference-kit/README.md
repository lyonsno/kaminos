# @kaminos/webgpu-inference-kit

Run substantial WebGPU models as responsive components of browser applications.

Kaminos WebGPU Inference Kit gives model ports a shared session and device lifecycle, persistent model routes, queued invocations, cooperative scheduling, progress and terminal state, resource residency, and runtime telemetry. Ports retain ownership of their weights, kernels, tensor semantics, execution order, and output construction.

```sh
npm install @kaminos/webgpu-inference-kit
```

For a visual first run, [brighten a photo while a renderer stays active](./docs/getting-started.md#try-the-photo-walkthrough). The worked example walks through sharing a GPU device, queuing an operation, and displaying its result.

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

The kit connects a growing family of browser model ports: recover a scene's geometry, generate a textured object, turn an image into Gaussian splats, or animate a character from a text prompt. Each port brings its own model implementation and adopts shared runtime facilities where they serve its workload.

| Model Port | What You Can Build | Integration |
| --- | --- | --- |
| [MoGe](https://github.com/lyonsno/moge-webgpu) | Depth maps, surface normals, and interactive point clouds from a single image | Shared device helpers, cooperative encoder and decoder work, bounded in-flight submissions, reusable GPU buffers, and a library build for embedding in a host application. |
| [Stable Fast 3D](https://github.com/lyonsno/sf3d-webgpu) | Textured, UV-unwrapped GLB meshes from a single image | Cooperative reconstruction and baking, bounded in-flight submissions, reusable scratch memory, worker offload, and a callable producer that can use the application's GPU device. |
| [SHARP](https://github.com/lyonsno/sharp-webgpu) | Gaussian splat scenes from a single image | Adaptive cooperative scheduling, shared-device foreground rendering, staged output construction, and shared tensor-comparison helpers for port development. |
| [Kimodo](https://github.com/lyonsno/kimodo-webgpu) | Animated skeletal motion from a text prompt | Browser diffusion and motion decoding, bounded GPU submissions, reusable model resources, and a host-callable producer with rendering opportunities between transformer passes. Text embeddings come from an external server. |

These ports provide different starting points for application integration. MoGe exposes an existing feed-forward pipeline as an embeddable library. SF3D combines GPU computation with worker-based geometry and texture processing. Kimodo exposes repeated diffusion passes where a host can interleave rendering. SHARP demonstrates the complete result: substantial inference running alongside a continuously rendering application.

**In development: SAM image-and-prompt segmentation.** The in-tree port combines shared model-package loading, persistent model resources, cached image features, and queued semantic requests. Its browser serving path produces masks and reuses image features across prompts; concurrent foreground rendering is the next integration target.

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

## Inference Alongside Rendering

In one measured run on an M4 Max in Chrome, **SHARP generated 1,179,648 Gaussian splats in 185.3 seconds** while a full Kaminos fire volume continued to simulate on every frame in the same browser and on the same GPU. Across 21,818 foreground frame intervals, p95 and p99 were 9.3ms and 10.0ms; 40 intervals exceeded 33.3ms.

**Stable Fast 3D generated a complete textured GLB in 41.9 seconds** while servicing 3,644 test host frames through the kit's shared-device foreground interlock. Page frame intervals had a p99 of 9.7ms and a maximum of 92.4ms. The GLB was byte-identical to the monolithic route's output.

SF3D also runs alongside Kaminos' live flame in an experimental host integration. That integration currently uses separate devices on the same GPU; coordinated shared-device rendering is the next step toward recovering throughput under the full rendering workload.

Together, these examples show how model ports can expose useful scheduling boundaries, preserve their outputs, and make room for the application around them.

## Continue Porting

- Follow [Getting Started](./docs/getting-started.md) to run a complete minimal WebGPU model port with one reusable route and two queued invocations.
- Read the [advanced integration reference](./docs/integration-reference.md) for the complete current API manual and scheduling contracts.
- Inspect the public exports in [`src/index.js`](./src/index.js).
- Start with one session, one registered route, one complete invocation, and direct model execution. Add cooperative boundaries where measurements show the application needs them.
