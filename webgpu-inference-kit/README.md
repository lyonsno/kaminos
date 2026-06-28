# @kaminos/webgpu-inference-kit

Native WebGPU inference route substrate for Kaminos.

This package starts with contracts, not kernels. Its first job is to make
browser-local model routes prove what they actually ran before Kaminos treats
their outputs as asset evidence.

Current surface:

- `createWebGpuLocalRouteReceipt(input)`: creates a
  `kaminos.webgpu-route-receipt.v0` receipt for a `webgpu-local` route.
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
- `createWebGpuBackendIdentity(input)` and
  `validateWebGpuBackendIdentity(identity)`: preserve effective browser,
  adapter, feature, limit, and timestamp-query identity for route receipts.
- `createStagedSubmitProfile(input)`, `addStagedSubmitStage(profile, stage)`,
  `finishStagedSubmitProfile(profile)`, and
  `validateStagedSubmitProfile(profile)`: record staged-submit timing evidence
  and reject timestamp-query timing unless it is validated against staged waits.
- `createMogeDepthNormalRouteReceipt(input)`: first concrete `webgpu-local`
  route receipt factory for `moge.depth-normal.webgpu-local.v0`.

Near-term extraction order:

1. Route receipt and tensor manifest contracts. Done in the scaffold slice.
2. WebGPU device/feature/profiling identity helpers. First pure contract helpers
   are in place; browser adapters should wire into these next.
3. MoGE depth/normal route receipt. First factory is in place; the MoGE runtime
   should emit this receipt from live inference next.
4. Pipeline, bind-group, uniform, and buffer caches from MoGE/SHARP.
5. Shared kernels only when at least two real routes need them or a measured
   kernel slice proves the extraction useful.

Non-goals:

- Generic ONNX import parity.
- General LLM runtime competition.
- Kaminos graph, scene, library, or promotion ownership.
- Any route that hides fallback, stale output, fixture data, partial output, or
  effective backend identity.
