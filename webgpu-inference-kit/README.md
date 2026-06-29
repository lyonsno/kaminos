# @kaminos/webgpu-inference-kit

Native WebGPU inference route substrate for Kaminos.

This package starts with contracts, not kernels. Its first job is to make
browser-local model routes prove what they actually ran before Kaminos treats
their outputs as asset evidence.

Current surface:

- `createWebGpuLocalRouteReceipt(input)`: creates a
  `kaminos.webgpu-route-receipt.v0` receipt for a `webgpu-local` route.
- `createWebGpuRouteSchemaContract(input)`: exposes the kit-owned route
  definition/request/result/receipt schema strings as a compact contract object
  so route repos can run conformance checks instead of manually mirroring hidden
  constants.
- `createWebGpuRouteReceiptFromArtifacts(input)` plus
  `createRouteReceiptArtifacts`, `createRouteReceiptInputArtifact`,
  `finishAndValidateRouteProfile`, and validation helpers: shared route receipt
  substrate used by MoGE, SHARP, Kimodo, and SF3D factories to preserve artifact
  identity, backend identity, and staged profile requirements without duplicating
  false-closure-prone boilerplate.
- `validateRouteReceipt(receipt)`: validates requested/effective route identity,
  backend/model/kernel identity, input/output artifact ids, timings, and
  fallback status.
- `assertAuthoritativeRouteReceipt(receipt)`: rejects fallback, cached,
  partial, missing, or non-real outputs before they can masquerade as
  authoritative Kaminos evidence.
- `defineTensorManifest(input)` and `validateTensorManifest(manifest)`: normalize
  and validate model tensor metadata, including dtype sizes and byte lengths.
- `createWebGpuDeviceRequest(adapter, options)`: derives requested WebGPU
  features and max adapter limits for model inference without silently capping
  below the adapter's own reported capacity.
- `requestBrowserWebGpuDevice(gpu, options)`: requests a browser WebGPU adapter
  and device, then returns the effective device request and backend identity
  that route receipts should preserve.
- `createWebGpuBackendIdentity(input)` and
  `validateWebGpuBackendIdentity(identity)`: preserve effective browser,
  adapter, feature, limit, and timestamp-query identity for route receipts.
- `createStagedSubmitProfile(input)`, `addStagedSubmitStage(profile, stage)`,
  `finishStagedSubmitProfile(profile)`, and
  `validateStagedSubmitProfile(profile)`: record staged-submit timing evidence
  and reject timestamp-query timing unless it is validated against staged waits.
- `createKernelProfileMetadata(input)` and
  `createRouteKernelProfileMetadata(input)`: normalize shared kit version,
  kernel profile, commit, required stage, and timing-source metadata for route
  definitions and receipts while keeping route-specific semantics local.
- `createMogeDepthNormalRouteReceipt(input)`: first concrete `webgpu-local`
  route receipt factory for `moge.depth-normal.webgpu-local.v0`.
- `defineWebGpuRoute(input)`, `createWebGpuRouteRegistry(routes)`,
  `createRouteInvocationRequest(route, input)`, `createRouteWorkerResult(route,
  input)`, and their validators: define worker-executable routes, create
  invocation envelopes, and validate route results before Wake/Pipeline consume
  them as Kaminos evidence.
- `createMogeDepthNormalRouteDefinition(input)`: first concrete route
  definition for MoGE source-image to depth/normal/pointmap truth-layer output.
- `createSharpImageToSplatRouteReceipt(input)`: concrete receipt factory for
  `sharp.image-to-splat.webgpu-local.v0`, preserving source image, browser
  WebGPU backend identity, PLY splat candidate, depth map, SHARP metadata, and
  optional splat autocrop evidence.
- `createSharpImageToSplatRouteDefinition(input)`: route definition aligned to
  the native SHARP-WebGPU browser adapter surface used by Kaminos Pipeline:
  source image in, splat candidate/depth/metadata out, with optional
  `kaminos.splat-autocrop-evidence.v0` side evidence.
- `createKimodoTextToMotionRouteReceipt(input)` and
  `createKimodoTextToMotionRouteDefinition(input)`: browser WebGPU
  text-to-motion route contract for Kimodo SOMA-RP-v1.1, preserving prompt
  identity, SOMA77 joint output, motion sidecar output, optional filmstrip, and
  staged text-embedding/DDIM/FK/output-capture timing.
- `createSf3dImageToMeshRouteReceipt(input)` and
  `createSf3dImageToMeshRouteDefinition(input)`: browser WebGPU image-to-mesh
  route contract for Stable Fast 3D, preserving source image, GLB mesh, albedo
  texture, normal map, optional OBJ, and DINOv2/two-stream/triplane/marching-tet
  stage identity.

Near-term extraction order:

1. Route receipt and tensor manifest contracts. Done in the scaffold slice.
2. WebGPU device/feature/profiling identity helpers. First pure contract helpers
   are in place; browser adapters should wire into these next.
3. MoGE depth/normal route receipt. First factory is in place and the MoGE
   runtime emits this receipt from live inference.
4. Browser route boundary. Route registry, invocation request, worker result,
   browser device request, and MoGE route definition contracts are in place.
5. SHARP image-to-splat route contract. First factory and route definition are
   in place for the browser-native SHARP-WebGPU path; runtime emission remains
   owned by SHARP/Pipeline adapter surfaces.
6. Kimodo and SF3D route contracts. First factories and route definitions are
   in place for browser-native text-to-motion and image-to-mesh routes; runtime
   emission remains owned by those route repos and Kaminos motion/pipeline
   consumers.
7. MoGE schema mirror drift reduction. The kit exposes a schema contract object;
   MoGE has a dev conformance test against that contract while the runtime still
   avoids a brittle temporary worktree dependency.
8. Shared route receipt helper. Artifact normalization, backend identity
   validation, staged profile validation, and receipt construction now live in
   one helper consumed by all four concrete route factories.
9. Shared kernel/profile metadata helper. Kit version, kernel profile, commit,
   required stage, and timing-source normalization now live in one helper
   consumed by all four concrete route factories.
10. Pipeline, bind-group, uniform, and buffer caches from MoGE/SHARP.
11. Shared kernels only when at least two real routes need them or a measured
   kernel slice proves the extraction useful.

Non-goals:

- Generic ONNX import parity.
- General LLM runtime competition.
- Kaminos graph, scene, library, or promotion ownership.
- Any route that hides fallback, stale output, fixture data, partial output, or
  effective backend identity.
