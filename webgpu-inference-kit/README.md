# @kaminos/webgpu-inference-kit

Build and run substantial browser-native machine-learning models with direct WebGPU control.

`@kaminos/webgpu-inference-kit` is a JavaScript runtime and model-porting SDK for applications that execute model weights and custom WGSL kernels directly in the browser. It supplies reusable device, tensor, kernel, model-loading, memory, progress, cancellation, queueing, and cooperative-execution machinery while the port retains control of its numerical architecture.

The same runtime can host several model routes on one WebGPU device and coordinate long inference with rendering, UI, and other application work.

## Install

```sh
npm install @kaminos/webgpu-inference-kit
```

The package is ESM and requires a browser with WebGPU. Model ports may request their own required features and limits or borrow an application-owned `GPUDevice`.

## Start A Browser-Native Route

The current package exposes its runtime layers directly:

```js
import {
  createWebGpuInferenceSession,
} from "@kaminos/webgpu-inference-kit";

const session = await createWebGpuInferenceSession({
  sessionId: crypto.randomUUID(),
  gpu: navigator.gpu,
});

const model = await session.registerRoute({
  routeId: "acme.image-model.webgpu-local.v0",
});

const job = model.enqueue({
  jobId: crypto.randomUUID(),
  execute: invocation => runImageModel(model.runtime, image, invocation),
});

const completion = await job.completion;
if (completion.status !== "succeeded") {
  throw new Error(`model run ended with ${completion.status}`);
}

renderOutput(completion.output);
```

The session owns the shared device context, route admission, resource residency, and device-loss boundary. The model adapter owns its weights, tensors, kernels, dispatch geometry, buffer lifetimes, lawful work boundaries, and output.

## The Model Port

A **Model Port** is the complete browser-native definition of how one model is loaded, executed, observed, cancelled, and disposed through the kit.

```text
Model Port definition
        |
        v
LoadedModel ------------ persistent weights, pipelines, tensors
        |
        v
ModelRun --------------- inputs, phases, progress, cancellation, output
        |
        v
WebGpuInferenceSession -- device, resources, scheduling, memory, telemetry
```

Current ports compose these layers from the package's runtime primitives. The next public layer adds `loadModelPort()` to the existing shared inference session and turns that repeated composition into one first-class `defineWebGpuModelPort` contract without taking kernel, layout, dispatch, or optimization authority away from the porter.

The [Model Port design contract](docs/model-port.md) defines that API target. The [minimal Model Port contract](docs/minimal-model-port.md) defines the first complete runnable example that must prove it.

## Running In Real Model Ports

| Port | Browser-native route | Kit adoption |
| --- | --- | --- |
| [SHARP WebGPU](https://github.com/lyonsno/sharp-webgpu) | image to 1.18M Gaussian splats | cooperative orchestration, scheduling, shared-device foreground opportunities, route composition |
| [SF3D WebGPU](https://github.com/lyonsno/sf3d-webgpu) | image to textured GLB mesh | cooperative orchestration and model-owned bounded work |
| [MoGe WebGPU](https://github.com/lyonsno/moge-webgpu) | image to depth, normals, and point map | tensor, kernel, runtime, and route primitives |
| [Kimodo WebGPU](https://github.com/lyonsno/kimodo-webgpu) | prompt to skeletal motion | runtime and route primitives around browser diffusion, with text embedding declared as an external backend |

### SHARP With A Live Renderer

On an M4 Max in Chrome, SHARP generated `1,179,648` Gaussian splats over `185.3s` while a full Kaminos fire volume continued to simulate on every frame in the same browser and on the same GPU. Across `21,818` foreground frame intervals, p95 and p99 were `9.3ms` and `10.0ms`; `40` intervals exceeded `33.3ms`.

That is the runtime's central product result: a real long-running model completed inside a visibly live WebGPU application instead of monopolizing the browser until inference ended.

## What The Runtime Owns

- WebGPU adapter and device acquisition, capability identity, and device-loss handling
- shader-module and compute-pipeline caching
- typed GPU tensors, uniforms, kernels, phase programs, scratch arenas, and worker phases
- authenticated whole-model and chunked resource loading, browser caching, residency, and sharing
- background inference queues, cross-route admission, progress, cancellation, and terminal settlement
- cooperative GPU and CPU work boundaries, adaptive duty sizing, bounded-prefix submission, and foreground opportunities
- optional profiling, route identity, conformance, and execution reports

## What The Porter Controls

- model architecture, weights, tensor semantics, and numerical tolerances
- WGSL, fusion, precision, layouts, bind groups, dispatch geometry, and readback
- persistent and invocation-local buffer ownership
- phase decomposition and lawful points where work may be split or yielded
- application-specific inputs, outputs, presentation, and product workflow

## Choose This Kit When

- direct model-level WebGPU control is valuable;
- model-specific kernels, layouts, fusion, or memory planning matter;
- inference must coexist with a renderer or interactive application;
- several routes should share one device and resident resources;
- a long model needs useful progress, cancellation, background queueing, or cooperative execution.

## Documentation

- [Model Port design contract](docs/model-port.md): the first-class model definition, session, and invocation lifecycle being built over the current primitives
- [Minimal Model Port contract](docs/minimal-model-port.md): the runnable example and first-use acceptance boundary
- [Advanced integration reference](docs/integration-reference.md): current low-level runtime, resource, cooperative-execution, scheduling, composition, and receipt APIs

## Status

The package is pre-1.0 and its lower-level runtime APIs are already consumed by the ports above. The first-class Model Port layer is an explicit design target; the README will switch its starter example to that API only after the package exports it and the complete minimal port runs from a clean install.
