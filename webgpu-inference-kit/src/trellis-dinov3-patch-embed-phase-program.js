import { assertAuthoritativeRouteWorkerResult, defineWebGpuRoute, createRouteWorkerResult } from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { createLinearDispatch, WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE } from './runtime-primitives.js';
import { createRouteKernelProfileMetadata, createKernelProfileMetadata } from './kernel-profile.js';
import { createRouteReceiptArtifacts, createRouteReceiptInputArtifact, createWebGpuRouteReceiptFromArtifacts } from './route-receipt-helper.js';
import { createWebGpuRouteBackpressureProfile, createWebGpuRouteSchedulerProfile } from './scheduler-backpressure.js';

export const TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID = 'trellis2.dinov3.patch-embed.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/dinov3-vitl16-pretrain-lvd1689m';
const DEFAULT_KERNEL_PROFILE = 'trellis2-dinov3-patch-embed-phase-program-v0';
const REQUIRED_STAGES = ['load-trellis-dinov3-patch-embed-tensors', 'patch-conv2d-stride', 'consume-trellis-dinov3-patch-embeddings-on-gpu', 'readback-trellis-dinov3-patch-embeddings'];
const INPUT_ROLES = ['source-image', 'trellis-dinov3-normalized-pixels', 'trellis-dinov3-patch-embed-weights'];
const OUTPUT_ROLES = [{ key: 'patchEmbeddings', role: 'trellis-dinov3-patch-embeddings', required: true }];

const PATCH_EMBED_WGSL = `
struct Dims { batch:u32, image_height:u32, image_width:u32, image_channels:u32, patch_size:u32, patch_height:u32, patch_width:u32, hidden_size:u32, total_values:u32, _pad0:u32, _pad1:u32, _pad2:u32, };
@group(0) @binding(0) var<storage, read> pixels: array<f32>;
@group(0) @binding(1) var<storage, read> projection: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
@group(0) @binding(4) var<uniform> dims: Dims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>, @builtin(num_workgroups) grid:vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u + gid.z * grid.x * grid.y * 64u;
  if (index >= dims.total_values) { return; }
  let out_channel = index % dims.hidden_size;
  let token = (index / dims.hidden_size) % (dims.patch_height * dims.patch_width);
  let batch = index / (dims.hidden_size * dims.patch_height * dims.patch_width);
  let patch_y = token / dims.patch_width;
  let patch_x = token % dims.patch_width;
  var sum = bias[out_channel];
  for (var ky = 0u; ky < dims.patch_size; ky = ky + 1u) { for (var kx = 0u; kx < dims.patch_size; kx = kx + 1u) {
    let pixel_base = ((batch * dims.image_height + patch_y * dims.patch_size + ky) * dims.image_width + patch_x * dims.patch_size + kx) * dims.image_channels;
    let weight_base = ((out_channel * dims.patch_size + ky) * dims.patch_size + kx) * dims.image_channels;
    for (var channel = 0u; channel < dims.image_channels; channel = channel + 1u) { sum = sum + pixels[pixel_base + channel] * projection[weight_base + channel]; }
  }}
  output[index] = sum;
}`;

// A first composition witness: consume each patch vector on the same device
// before the route performs its receipt-required host readback. This computes
// per-token energy as a diagnostic, not as a claimed TRELLIS model operation.
const PATCH_EMBED_CONSUMER_WGSL = `
struct Dims { hidden_size:u32, token_count:u32, total_tokens:u32, _pad0:u32, };
@group(0) @binding(0) var<storage, read> embeddings: array<f32>;
@group(0) @binding(1) var<storage, read_write> token_energy: array<f32>;
@group(0) @binding(2) var<uniform> dims: Dims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
  let token = gid.x;
  if (token >= dims.total_tokens) { return; }
  var energy = 0.0;
  for (var channel = 0u; channel < dims.hidden_size; channel = channel + 1u) {
    let value = embeddings[token * dims.hidden_size + channel];
    energy = energy + value * value;
  }
  token_energy[token] = energy;
}`;

function roleArtifact(artifacts, role) { const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role]; if (!artifact) throw new Error(`${role} artifact is required`); return artifact; }
function floats(value, name) { if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`); return value; }
function normalizeShape(input = {}) {
  const shape = { batch: input.batch, imageHeight: input.imageHeight ?? input.height, imageWidth: input.imageWidth ?? input.width, imageChannels: input.imageChannels ?? input.channels ?? 3, patchSize: input.patchSize, hiddenSize: input.hiddenSize, weightLayout: input.weightLayout ?? 'out,kH,kW,in' };
  shape.patchHeight = input.patchHeight ?? (Number.isInteger(shape.patchSize) ? Math.floor(shape.imageHeight / shape.patchSize) : undefined);
  shape.patchWidth = input.patchWidth ?? (Number.isInteger(shape.patchSize) ? Math.floor(shape.imageWidth / shape.patchSize) : undefined);
  for (const key of ['batch', 'imageHeight', 'imageWidth', 'imageChannels', 'patchSize', 'patchHeight', 'patchWidth', 'hiddenSize']) if (!Number.isInteger(shape[key]) || shape[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  if (shape.imageChannels !== 3) throw new Error('shape.imageChannels must be 3 for TRELLIS DINOv3 RGB pixels');
  if (shape.imageHeight % shape.patchSize !== 0 || shape.imageWidth % shape.patchSize !== 0) throw new Error('image dimensions must be divisible by shape.patchSize');
  if (shape.patchHeight !== shape.imageHeight / shape.patchSize || shape.patchWidth !== shape.imageWidth / shape.patchSize) throw new Error('patch dimensions must match image dimensions divided by patchSize');
  if (shape.weightLayout !== 'out,kH,kW,in') throw new Error('weightLayout must be out,kH,kW,in');
  return shape;
}
function validateInputs(input = {}) {
  const shape = normalizeShape(input.shape); const pixelValues = floats(input.pixelValues, 'pixelValues'); const projection = floats(input.weights?.projection, 'weights.projection'); const bias = floats(input.weights?.bias, 'weights.bias');
  const pixels = shape.batch * shape.imageHeight * shape.imageWidth * shape.imageChannels; const weights = shape.hiddenSize * shape.patchSize * shape.patchSize * shape.imageChannels;
  if (pixelValues.length !== pixels) throw new Error(`pixelValues length ${pixelValues.length} does not match shape (${pixels})`);
  if (projection.length !== weights) throw new Error(`weights.projection length ${projection.length} does not match [out,kH,kW,in] (${weights})`);
  if (bias.length !== shape.hiddenSize) throw new Error(`weights.bias length ${bias.length} does not match hiddenSize (${shape.hiddenSize})`);
  return { shape, pixelValues, projection, bias };
}

export function createTrellisDinoV3PatchEmbedPhaseProgramCpuOracle(input) {
  const { shape, pixelValues, projection, bias } = validateInputs(input); const patchEmbeddings = new Float32Array(shape.batch * shape.patchHeight * shape.patchWidth * shape.hiddenSize);
  for (let batch = 0; batch < shape.batch; batch += 1) for (let patchY = 0; patchY < shape.patchHeight; patchY += 1) for (let patchX = 0; patchX < shape.patchWidth; patchX += 1) for (let out = 0; out < shape.hiddenSize; out += 1) {
    let sum = bias[out]; for (let ky = 0; ky < shape.patchSize; ky += 1) for (let kx = 0; kx < shape.patchSize; kx += 1) for (let channel = 0; channel < shape.imageChannels; channel += 1) { const pixel = ((batch * shape.imageHeight + patchY * shape.patchSize + ky) * shape.imageWidth + patchX * shape.patchSize + kx) * shape.imageChannels + channel; const weight = ((out * shape.patchSize + ky) * shape.patchSize + kx) * shape.imageChannels + channel; sum += pixelValues[pixel] * projection[weight]; }
    patchEmbeddings[((batch * shape.patchHeight * shape.patchWidth + patchY * shape.patchWidth + patchX) * shape.hiddenSize) + out] = sum;
  }
  return { shape, patchEmbeddings };
}

function scheduler() { return createWebGpuRouteSchedulerProfile({ requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) }, effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] }, verificationState: 'scheduler-unverified', breathability: { spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.startsWith('readback') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })), checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage.startsWith('readback') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.startsWith('readback') })), notes: 'TRELLIS DINOv3 patch projection keeps source channel-last inputs and explicit MLX/WebGPU weight layout.' } }); }
function backpressure() { return createWebGpuRouteBackpressureProfile({ requestedBudget: 'visible-wait', effectiveBudget: 'visible-wait', memoryExclusivity: 'shared', warmCacheState: 'unknown' }); }

export function createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition(input = {}) {
  const metadata = createRouteKernelProfileMetadata(input, { defaultProfile: DEFAULT_KERNEL_PROFILE, requiredStages: REQUIRED_STAGES, timingSource: 'queue-submit-wait' });
  return defineWebGpuRoute({ routeId: TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID, backendKind: 'webgpu-local', model: { id: input.model?.id || MODEL_ID, revision: input.model?.revision || 'trellis2-dinov3-patch-embed', dtype: input.model?.dtype || 'fp32' }, kernel: metadata.kernel, inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })), outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })), requiredFeatures: input.requiredFeatures || [], requiredStages: metadata.requiredStages, timingSource: metadata.timingSource, scheduler: input.scheduler || scheduler(), backpressure: input.backpressure || backpressure(), worker: input.worker || { exportName: 'runTrellisDinoV3PatchEmbedPhaseProgramRoute', upstreamBoundary: 'browser-normalized-pixels-to-trellis-dinov3-patch-embeddings' } });
}
export function createTrellisDinoV3PatchEmbedDispatchPlan(input = {}) { const shape = normalizeShape(input.shape); const logicalInvocations = shape.batch * shape.patchHeight * shape.patchWidth * shape.hiddenSize; return { patchConv2dStride: { logicalInvocations, dispatch: createLinearDispatch(logicalInvocations, { workgroupSize: 64, maxWorkgroupsPerDimension: input.maxWorkgroupsPerDimension ?? 65_535 }) } }; }
async function sha256Hex(buffer) { if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash TRELLIS DINOv3 patch embeddings'); const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer); return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`; }
function outputArtifacts(request, hashes, shape) { return { patchEmbeddings: { artifactId: roleArtifact(request.outputs, 'trellis-dinov3-patch-embeddings').artifactId, sha256: hashes.patchEmbeddings, shape: [shape.batch, shape.patchHeight * shape.patchWidth, shape.hiddenSize] } }; }
export function createTrellisDinoV3PatchEmbedPhaseProgramRouteReceipt(input) { return createWebGpuRouteReceiptFromArtifacts({ requestedRouteId: TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID, effectiveRouteId: input.effectiveRouteId || TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID, status: input.status || 'real', fallbackReason: null, backend: input.backend, model: { id: input.model?.id || MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' }, kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }), inputs: [createRouteReceiptInputArtifact('source-image', input.sourceImage), createRouteReceiptInputArtifact('trellis-dinov3-normalized-pixels', input.pixelValues), createRouteReceiptInputArtifact('trellis-dinov3-patch-embed-weights', input.weights)], outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }), profile: input.profile }); }

export async function runTrellisDinoV3PatchEmbedPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createTrellisDinoV3PatchEmbedPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const pixelValuesArtifact = roleArtifact(input.request.inputs, 'trellis-dinov3-normalized-pixels');
  const weightsArtifact = roleArtifact(input.request.inputs, 'trellis-dinov3-patch-embed-weights');
  const { shape, pixelValues, projection, bias } = validateInputs(input.tensors || {});
  const tokenCount = shape.batch * shape.patchHeight * shape.patchWidth;
  const totalValues = tokenCount * shape.hiddenSize;
  const plan = createTrellisDinoV3PatchEmbedDispatchPlan({ shape, maxWorkgroupsPerDimension: input.device?.limits?.maxComputeWorkgroupsPerDimension });
  const consumerDispatch = createLinearDispatch(tokenCount, { workgroupSize: 64, maxWorkgroupsPerDimension: input.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535 });
  const runtime = await createWebGpuInferenceRuntime({ routeId: TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID, runtimeLabel: input.runtimeLabel || 'trellis-dinov3-patch-embed-phase-program', device: input.device, queue: input.queue, adapter: input.adapter, adapterName: input.adapterName, browser: input.browser, backendIdentity: input.backendIdentity, kernel: input.kernel || route.kernel, requiredStages: REQUIRED_STAGES, timingSource: 'queue-submit-wait', waitForSubmittedWorkDone: true, yieldMs: 0, now: input.now, yield: input.yield, residentTensorResolver: input.residentTensorResolver });
  let failed = false;
  let primaryError;
  try {
    let tensors;
    await runtime.runStage('load-trellis-dinov3-patch-embed-tensors', async stage => {
      const readonly = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
      const outputUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc;
      tensors = {
        pixels: stage.createTensor({ name: 'trellis.dinov3.normalized-pixels', shape: [shape.batch, shape.imageHeight, shape.imageWidth, shape.imageChannels], dtype: 'f32', usage: readonly }),
        projection: stage.createTensor({ name: 'trellis.dinov3.patch-embed.projection', shape: [shape.hiddenSize, shape.patchSize, shape.patchSize, shape.imageChannels], dtype: 'f32', usage: readonly, sourceData: projection }),
        bias: stage.createTensor({ name: 'trellis.dinov3.patch-embed.bias', shape: [shape.hiddenSize], dtype: 'f32', usage: readonly, sourceData: bias }),
        output: stage.createTensor({ name: 'trellis.dinov3.patch-embeddings', shape: [shape.batch, shape.patchHeight * shape.patchWidth, shape.hiddenSize], dtype: 'f32', usage: outputUsage }),
        tokenEnergy: stage.createTensor({ name: 'trellis.dinov3.patch-embedding-token-energy', shape: [tokenCount], dtype: 'f32', usage: WEBGPU_BUFFER_USAGE.storage | (input.includeReadback === true ? WEBGPU_BUFFER_USAGE.copySrc : 0) }),
        dims: stage.createUniformBuffer({ label: 'trellis.dinov3.patch-embed.dims', schema: ['batch', 'image_height', 'image_width', 'image_channels', 'patch_size', 'patch_height', 'patch_width', 'hidden_size', 'total_values', '_pad0', '_pad1', '_pad2'].map(name => ({ name, type: 'u32' })), values: { batch: shape.batch, image_height: shape.imageHeight, image_width: shape.imageWidth, image_channels: shape.imageChannels, patch_size: shape.patchSize, patch_height: shape.patchHeight, patch_width: shape.patchWidth, hidden_size: shape.hiddenSize, total_values: totalValues, _pad0: 0, _pad1: 0, _pad2: 0 } }),
        consumerDims: stage.createUniformBuffer({ label: 'trellis.dinov3.patch-embed.consumer-dims', schema: ['hidden_size', 'token_count', 'total_tokens', '_pad0'].map(name => ({ name, type: 'u32' })), values: { hidden_size: shape.hiddenSize, token_count: shape.patchHeight * shape.patchWidth, total_tokens: tokenCount, _pad0: 0 } }),
      };
      stage.uploadTensor(tensors.pixels, pixelValues);
      stage.uploadTensor(tensors.projection, projection);
      stage.uploadTensor(tensors.bias, bias);
      await stage.yieldToBrowser({ reason: 'after-trellis-dinov3-patch-embed-upload' });
    }, { shape, weightLayout: 'out,kH,kW,in' });
    const program = runtime.defineProgram({
      name: 'trellis.dinov3.patch-embed-phase-program',
      tensors: { pixels: tensors.pixels, projection: tensors.projection, bias: tensors.bias, output: tensors.output, tokenEnergy: tensors.tokenEnergy },
      uniforms: { dims: tensors.dims, consumerDims: tensors.consumerDims },
      kernels: {
        patchConv2dStride: { code: PATCH_EMBED_WGSL, bindings: [{ name: 'pixels', resource: 'tensor:pixels', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'projection', resource: 'tensor:projection', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:bias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:output', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
        consumePatchEmbeddings: { code: PATCH_EMBED_CONSUMER_WGSL, bindings: [{ name: 'embeddings', resource: 'tensor:output', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'token_energy', resource: 'tensor:tokenEnergy', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:consumerDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      },
      phases: [
        { name: 'patch-conv2d-stride', kernel: 'patchConv2dStride', dispatch: plan.patchConv2dStride.dispatch, yieldAfter: true },
        { name: 'consume-trellis-dinov3-patch-embeddings-on-gpu', kernel: 'consumePatchEmbeddings', dispatch: consumerDispatch, yieldAfter: true },
        { name: 'readback-trellis-dinov3-patch-embeddings', readbacks: [
          { name: 'patchEmbeddings', tensor: 'output' },
          ...(input.includeReadback === true ? [{ name: 'tokenEnergy', tensor: 'tokenEnergy' }] : []),
        ] },
      ],
      metadata: { routeId: TRELLIS_DINOV3_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID, weightLayout: 'out,kH,kW,in', residentConsumer: 'per-token-l2-energy-diagnostic' },
    });
    const run = await runtime.runProgram(program);
    const outputs = outputArtifacts(input.request, { patchEmbeddings: await sha256Hex(run.outputs.patchEmbeddings) }, shape);
    const receipt = createTrellisDinoV3PatchEmbedPhaseProgramRouteReceipt({ sourceImage, pixelValues: pixelValuesArtifact, weights: weightsArtifact, outputs, backend: runtime.backendIdentity, model: { id: input.model?.id || route.model?.id, revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' }, kernel: input.kernel || runtime.kernel, profile: runtime.profile });
    const result = assertAuthoritativeRouteWorkerResult(createRouteWorkerResult(route, { request: input.request, receipt }), route);
    if (input.includeReadback === true) result.debugReadback = { mode: 'explicit-debug-evidence', patchEmbeddings: new Float32Array(run.outputs.patchEmbeddings), tokenEnergy: new Float32Array(run.outputs.tokenEnergy) };
    return result;
  } catch (error) {
    failed = true;
    primaryError = error;
    throw error;
  } finally {
    try {
      const disposal = await runtime.dispose();
      if (!failed) {
        // Match the established route worker diagnostic while keeping runtime
        // cleanup local to this TRELLIS-owned implementation.
        void disposal;
      }
    } catch (cleanupError) {
      if (!failed) throw cleanupError;
      try { primaryError.cleanupErrors = [...(primaryError.cleanupErrors || []), cleanupError]; } catch {}
    }
  }
}
