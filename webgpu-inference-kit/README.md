# @kaminos/webgpu-inference-kit

Composable browser WebGPU inference route contracts, runtime profiles, and scheduler envelopes.

This package is the shared substrate we are extracting from several browser-native model ports: MoGE depth/normal, SHARP image-to-splat, Kimodo text-to-motion, and Stable Fast 3D image-to-mesh. The bet is that these ports become more valuable when they can run as routes in the same browser GPU process, report the device and scheduling conditions they actually received, and hand outputs to each other without every repo inventing its own adapter grammar.

Receipts and evidence checks matter here, but they are not the point of the package. They are the guardrail that lets higher-level systems compose WebGPU routes without treating a fixture, fallback, stale cache, or half-profiled run as if it were live model output.

Install:

```sh
npm install @kaminos/webgpu-inference-kit
```

Import:

```js
import {
  createWebGpuRouteRegistry,
  createRouteInvocationRequest,
  createMogeDepthNormalRouteDefinition,
  requestBrowserWebGpuDevice,
  createWebGpuRouteSchedulerProfile,
} from "@kaminos/webgpu-inference-kit";
```

## What This Is

`@kaminos/webgpu-inference-kit` is a small, route-facing contract library for browser-local WebGPU inference. It gives model ports a common way to describe:

- What route is being invoked, such as MoGE depth/normal or SHARP image-to-splat.
- Which browser WebGPU adapter, device features, limits, and timestamp capabilities were actually available.
- Which kernel/profile variant ran, and which stages are required for a useful runtime profile.
- How a route was scheduled: throughput mode, cooperative/yield posture, breathability spans, yield checkpoints, phase chunk sizes, submitted-work waits, and unsupported scheduler fields.
- Which artifacts went in and out, so downstream consumers can join routes without losing identity.

The immediate goal is practical composition inside Kaminos: MoGE can become a local geometry/depth route, SHARP can emit splat candidates, Kimodo can emit motion clips, SF3D can emit meshes, and pipeline/commoner code can consume those outputs through one route grammar. The longer-term opportunity is a browser-native inference runtime kit that makes future image generators, 3D generators, and possibly language-model routes easier to seat without rebuilding the same WebGPU plumbing from scratch.

## Why Not Just Evidence?

Evidence is the accountability layer. The product center is route composition and runtime control.

WebGPU model ports have awkward failure modes: the browser may give a different adapter than expected, timestamp queries may be absent or misleading, a route may silently fall back to fixtures or stubs, and long GPU phases can monopolize the device unless the route reports how it yields. The kit keeps those facts attached to the route envelope so schedulers and downstream consumers can make sane choices.

So the intended stack is:

1. **Route boundary:** define callable browser-local inference routes with stable input/output roles.
2. **Runtime profile:** preserve adapter/device/kernel/stage identity for the run that actually happened.
3. **Scheduler/backpressure profile:** expose whether the route is throughput-oriented, cooperative, furnace-class, warm, cached, frame-tail-sensitive, and where it can honestly yield.
4. **Receipt and classification:** reject stale, fallback, partial, mismatched, or invalid route output before another system treats it as authoritative.

The fourth layer protects the first three. It should not swallow the whole story.

## Current Surface

- `defineWebGpuRoute(input)`, `createWebGpuRouteRegistry(routes)`, `createRouteInvocationRequest(route, input)`, `createRouteWorkerResult(route, input)`, and validators: define worker-executable browser routes, create invocation envelopes, and validate route results before downstream consumers compose them.
- `createMogeDepthNormalRouteDefinition(input)` and `createMogeDepthNormalRouteReceipt(input)`: MoGE source-image to depth/normal/pointmap route contract.
- `createSharpImageToSplatRouteDefinition(input)` and `createSharpImageToSplatRouteReceipt(input)`: SHARP source-image to splat candidate/depth/metadata route contract, including optional splat autocrop side output.
- `createKimodoTextToMotionRouteDefinition(input)` and `createKimodoTextToMotionRouteReceipt(input)`: Kimodo text-prompt to SOMA77 joints/motion-clip route contract, with optional filmstrip output and diffusion/FK/output timing stages.
- `createSf3dImageToMeshRouteDefinition(input)` and `createSf3dImageToMeshRouteReceipt(input)`: Stable Fast 3D source-image to GLB/albedo/normal/OBJ route contract with DINOv2, two-stream, triplane, and marching-tet stage identity.
- `createWebGpuDeviceRequest(adapter, options)` and `requestBrowserWebGpuDevice(gpu, options)`: request browser WebGPU devices using adapter-reported limits without imposing hidden caps, and return the effective request/backend identity for the route.
- `createWebGpuBackendIdentity(input)` and `validateWebGpuBackendIdentity(identity)`: preserve browser, adapter, feature, limit, and timestamp-query identity.
- `createStagedSubmitProfile(input)`, `addStagedSubmitStage(profile, stage)`, `finishStagedSubmitProfile(profile)`, and `validateStagedSubmitProfile(profile)`: describe staged queue-submit timing in a way that can be compared across routes.
- `createKernelProfileMetadata(input)` and `createRouteKernelProfileMetadata(input)`: normalize kit version, kernel profile, commit, required stages, and timing-source metadata for route definitions and receipts.
- `createWebGpuRuntimeProfileInput(input)`, `createWebGpuRuntimeProfile(input)`, and `validateWebGpuRuntimeProfile(profile)`: combine effective backend identity, kernel metadata, staged profile, and route mode into one producer-side runtime profile object.
- `createWebGpuRouteSchedulerProfile(input)` and `validateWebGpuRouteSchedulerProfile(profile)`: preserve requested versus effective scheduling, including throughput/cooperative mode, route-specific phase chunk sizes, submitted-work waits, yield cadence, breathability spans, yieldable checkpoints, non-preemptible GPU-submit spans, and unsupported fields.
- `createWebGpuRouteBackpressureProfile(input)` and `validateWebGpuRouteBackpressureProfile(profile)`: record visible-wait/furnace pressure, warm/cache posture, memory-sharing posture, and frame-tail impact.
- `defineTensorManifest(input)` and `validateTensorManifest(manifest)`: normalize tensor metadata including dtype sizes and byte lengths.
- `createWebGpuLocalRouteReceipt(input)`, `createWebGpuRouteReceiptFromArtifacts(input)`, `createRouteReceiptArtifacts(input)`, `finishAndValidateRouteProfile(input)`, `validateRouteReceipt(receipt)`, and `assertAuthoritativeRouteReceipt(receipt)`: shared receipt construction and validation helpers.
- `classifyWebGpuRouteReceiptEvidence(receipt)` and `classifyWebGpuRouteWorkerResultEvidence(result)`: consumer-side classification helpers for authoritative, fallback, partial, cached, stale, route-mismatch, and invalid route outputs.
- `createWebGpuRouteSchemaContract(input)`: compact schema/version contract for route repos that need conformance tests against this package.

## Near-Term Direction

1. Keep the route boundary stable enough for MoGE, SHARP, Kimodo, SF3D, and Pipeline/commoners to consume one package.
2. Move browser device acquisition, feature profiling, staged timing, scheduler/backpressure reporting, and route receipts out of individual model repos as shared utilities.
3. Extract bind-group, pipeline, uniform, buffer-cache, and kernel helpers only when at least two real routes need the same machinery or a measured slice proves the extraction useful.
4. Preserve enough runtime posture for long routes to become breathable: a route should be able to state where it can yield, what that costs, and whether the browser actually honored the requested scheduling shape.
5. Avoid becoming a generic ONNX, LLM, or universal tensor runtime until a concrete WebGPU route exposes an advantage we can actually own.

## Non-Goals

- Generic ONNX import parity.
- Competing with mature general-purpose browser LLM runtimes without a concrete route-level advantage.
- Kaminos graph, scene, library, or promotion ownership.
- Hidden caps below adapter/device capacity without measured justification.
- Treating fallback, stale output, fixture data, partial output, or missing backend identity as successful live inference.
