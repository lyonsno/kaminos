import {
  assertAuthoritativeRouteWorkerResult,
  defineWebGpuRoute,
  createRouteWorkerResult,
} from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE } from './runtime-primitives.js';
import {
  createKernelProfileMetadata,
  createRouteKernelProfileMetadata,
} from './kernel-profile.js';
import {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
} from './route-receipt-helper.js';
import {
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
} from './scheduler-backpressure.js';

export const SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID = 'sam3.mask-tail.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-mask-tail-phase-program-v0';
const REQUIRED_STAGES = [
  'load-mask-tail-tensors',
  'mask-embedder-layer-0',
  'mask-embedder-layer-1',
  'mask-embedder-layer-2',
  'instance-projection-1x1',
  'decode-mask',
  'threshold-mask',
  'readback-mask',
];
const INPUT_ROLES = ['source-image', 'sam3-mask-tail-tensors', 'sam3-mask-tail-weights'];
const OUTPUT_ROLES = [
  { key: 'maskLogits', role: 'mask-logits', required: true },
  { key: 'binaryMask', role: 'mask-binary', required: true },
];

const LINEAR_RELU_WGSL = `
struct MaskTailDims {
  batch: u32,
  mask_tokens: u32,
  channels: u32,
  height: u32,
  width: u32,
  mask_tail_total: u32,
  mask_total: u32,
  spatial: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: MaskTailDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.mask_tail_total) {
    return;
  }
  let out_channel = index % dims.channels;
  let token_index = (index / dims.channels) % dims.mask_tokens;
  let batch_index = index / (dims.channels * dims.mask_tokens);
  let input_base = (batch_index * dims.mask_tokens + token_index) * dims.channels;
  var sum = bias[out_channel];
  for (var in_channel = 0u; in_channel < dims.channels; in_channel = in_channel + 1u) {
    sum = sum + input_values[input_base + in_channel] * weight[out_channel * dims.channels + in_channel];
  }
  output_values[index] = max(sum, 0.0);
}
`;

const LINEAR_WGSL = LINEAR_RELU_WGSL.replace('output_values[index] = max(sum, 0.0);', 'output_values[index] = sum;');

const INSTANCE_PROJECTION_WGSL = `
struct MaskTailDims {
  batch: u32,
  mask_tokens: u32,
  channels: u32,
  height: u32,
  width: u32,
  mask_tail_total: u32,
  mask_total: u32,
  spatial: u32,
};

@group(0) @binding(0) var<storage, read> pixel_embed: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> upscaled_embedding: array<f32>;
@group(0) @binding(4) var<uniform> dims: MaskTailDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.channels * dims.spatial;
  if (index >= total) {
    return;
  }
  let spatial_index = index % dims.spatial;
  let out_channel = (index / dims.spatial) % dims.channels;
  let batch_index = index / (dims.channels * dims.spatial);
  let pixel_base = (batch_index * dims.spatial + spatial_index) * dims.channels;
  var sum = bias[out_channel];
  for (var in_channel = 0u; in_channel < dims.channels; in_channel = in_channel + 1u) {
    sum = sum + pixel_embed[pixel_base + in_channel] * weight[out_channel * dims.channels + in_channel];
  }
  upscaled_embedding[index] = sum;
}
`;

const MASK_PROJECTION_WGSL = `
struct MaskTailDims {
  batch: u32,
  mask_tokens: u32,
  channels: u32,
  height: u32,
  width: u32,
  mask_tail_total: u32,
  mask_total: u32,
  spatial: u32,
};

@group(0) @binding(0) var<storage, read> mask_embeddings: array<f32>;
@group(0) @binding(1) var<storage, read> upscaled_embedding: array<f32>;
@group(0) @binding(2) var<storage, read_write> mask_logits: array<f32>;
@group(0) @binding(3) var<uniform> dims: MaskTailDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.mask_total) {
    return;
  }
  let spatial_index = index % dims.spatial;
  let token_index = (index / dims.spatial) % dims.mask_tokens;
  let batch_index = index / (dims.spatial * dims.mask_tokens);
  var sum = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let mask_embedding_index = ((batch_index * dims.mask_tokens + token_index) * dims.channels) + channel;
    let upscaled_index = ((batch_index * dims.channels + channel) * dims.spatial) + spatial_index;
    sum = sum + mask_embeddings[mask_embedding_index] * upscaled_embedding[upscaled_index];
  }
  mask_logits[index] = sum;
}
`;

const THRESHOLD_WGSL = `
struct ThresholdDims {
  total: u32,
};

@group(0) @binding(0) var<storage, read> mask_logits: array<f32>;
@group(0) @binding(1) var<storage, read_write> binary_mask: array<u32>;
@group(0) @binding(2) var<uniform> dims: ThresholdDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) {
    return;
  }
  binary_mask[index] = select(0u, 1u, mask_logits[index] > 0.0);
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-mask' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-mask' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-mask' })),
      notes: 'SAM3 mask-tail phase program cooperates between learned mask-tail kernels and readback boundaries.',
    },
  });
}

function createDefaultBackpressure() {
  return createWebGpuRouteBackpressureProfile({
    requestedBudget: 'visible-wait',
    effectiveBudget: 'visible-wait',
    memoryExclusivity: 'shared',
    warmCacheState: 'unknown',
  });
}

function roleArtifact(artifacts, role) {
  const artifact = Array.isArray(artifacts)
    ? artifacts.find(entry => entry?.role === role)
    : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

function ensureFloat32Array(value, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  return value;
}

function normalizeShape(shape = {}) {
  const out = {
    batch: shape.batch,
    maskTokens: shape.maskTokens,
    channels: shape.channels,
    height: shape.height,
    width: shape.width,
  };
  for (const [key, value] of Object.entries(out)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  return out;
}

function maskTailElementCount(shape) {
  return shape.batch * shape.maskTokens * shape.channels;
}

function maskElementCount(shape) {
  return shape.batch * shape.maskTokens * shape.height * shape.width;
}

function validateMaskTailInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const lastHs = ensureFloat32Array(input.lastHs, 'lastHs');
  const pixelEmbed = ensureFloat32Array(input.pixelEmbed, 'pixelEmbed');
  const expectedLastHs = maskTailElementCount(shape);
  const expectedPixel = shape.batch * shape.height * shape.width * shape.channels;
  if (lastHs.length !== expectedLastHs) throw new Error(`lastHs length ${lastHs.length} does not match shape (${expectedLastHs})`);
  if (pixelEmbed.length !== expectedPixel) throw new Error(`pixelEmbed length ${pixelEmbed.length} does not match shape (${expectedPixel})`);
  const maskEmbedder = input.weights?.maskEmbedder;
  if (!Array.isArray(maskEmbedder) || maskEmbedder.length !== 3) throw new Error('weights.maskEmbedder must contain three layers');
  const layers = maskEmbedder.map((layer, index) => {
    const weight = ensureFloat32Array(layer?.weight, `weights.maskEmbedder[${index}].weight`);
    const bias = ensureFloat32Array(layer?.bias, `weights.maskEmbedder[${index}].bias`);
    if (weight.length !== shape.channels * shape.channels) throw new Error(`mask embedder layer ${index} weight length mismatch`);
    if (bias.length !== shape.channels) throw new Error(`mask embedder layer ${index} bias length mismatch`);
    return { weight, bias };
  });
  const instanceWeight = ensureFloat32Array(input.weights?.instanceProjection?.weight, 'weights.instanceProjection.weight');
  const instanceBias = ensureFloat32Array(input.weights?.instanceProjection?.bias, 'weights.instanceProjection.bias');
  if (instanceWeight.length !== shape.channels * shape.channels) throw new Error('instance projection weight length mismatch');
  if (instanceBias.length !== shape.channels) throw new Error('instance projection bias length mismatch');
  return {
    shape,
    lastHs,
    pixelEmbed,
    weights: {
      maskEmbedder: layers,
      instanceProjection: { weight: instanceWeight, bias: instanceBias },
    },
  };
}

function linearLayer(input, weight, bias, shape, relu) {
  const out = new Float32Array(input.length);
  const { batch, maskTokens, channels } = shape;
  for (let b = 0; b < batch; b += 1) {
    for (let t = 0; t < maskTokens; t += 1) {
      const base = (b * maskTokens + t) * channels;
      for (let oc = 0; oc < channels; oc += 1) {
        let sum = bias[oc];
        for (let ic = 0; ic < channels; ic += 1) sum += input[base + ic] * weight[oc * channels + ic];
        out[base + oc] = relu ? Math.max(0, sum) : sum;
      }
    }
  }
  return out;
}

export function createSam3MaskTailPhaseProgramCpuOracle(input) {
  const { shape, lastHs, pixelEmbed, weights } = validateMaskTailInputs(input);
  const layer0 = linearLayer(lastHs, weights.maskEmbedder[0].weight, weights.maskEmbedder[0].bias, shape, true);
  const layer1 = linearLayer(layer0, weights.maskEmbedder[1].weight, weights.maskEmbedder[1].bias, shape, true);
  const maskEmbeddings = linearLayer(layer1, weights.maskEmbedder[2].weight, weights.maskEmbedder[2].bias, shape, false);
  const spatial = shape.height * shape.width;
  const upscaledEmbedding = new Float32Array(shape.batch * shape.channels * spatial);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let oc = 0; oc < shape.channels; oc += 1) {
      for (let s = 0; s < spatial; s += 1) {
        let sum = weights.instanceProjection.bias[oc];
        const pixelBase = (b * spatial + s) * shape.channels;
        for (let ic = 0; ic < shape.channels; ic += 1) {
          sum += pixelEmbed[pixelBase + ic] * weights.instanceProjection.weight[oc * shape.channels + ic];
        }
        upscaledEmbedding[(b * shape.channels + oc) * spatial + s] = sum;
      }
    }
  }
  const maskLogits = new Float32Array(maskElementCount(shape));
  const binaryMask = new Uint32Array(maskLogits.length);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let t = 0; t < shape.maskTokens; t += 1) {
      for (let s = 0; s < spatial; s += 1) {
        let sum = 0;
        for (let c = 0; c < shape.channels; c += 1) {
          sum += maskEmbeddings[(b * shape.maskTokens + t) * shape.channels + c] * upscaledEmbedding[(b * shape.channels + c) * spatial + s];
        }
        const index = (b * shape.maskTokens + t) * spatial + s;
        maskLogits[index] = sum;
        binaryMask[index] = sum > 0 ? 1 : 0;
      }
    }
  }
  return { shape, maskEmbeddings, upscaledEmbedding, maskLogits, binaryMask };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM mask-tail outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const logitsRequest = roleArtifact(request.outputs, 'mask-logits');
  const binaryRequest = roleArtifact(request.outputs, 'mask-binary');
  return {
    maskLogits: { artifactId: logitsRequest.artifactId, sha256: hashes.maskLogits, shape },
    binaryMask: { artifactId: binaryRequest.artifactId, sha256: hashes.binaryMask, shape },
  };
}

export function createSam3MaskTailPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-mask-tail-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-mask-tail-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3MaskTailPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-mask-tail', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3MaskTailPhaseProgramRoute', upstreamBoundary: 'mlx-reference-mask-tail-tensors' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3MaskTailPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3MaskTailPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-mask-tail-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-mask-tail-weights');
  const projection = validateMaskTailInputs(input.tensors || {});
  const { shape, lastHs, pixelEmbed, weights } = projection;
  const spatial = shape.height * shape.width;
  const maskTailTotal = maskTailElementCount(shape);
  const maskTotal = maskElementCount(shape);
  const maskShape = [shape.batch, shape.maskTokens, shape.height, shape.width];

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-mask-tail-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
  });

  let tensors = null;
  await runtime.runStage('load-mask-tail-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      lastHs: stage.createTensor({ name: 'sam3.last-hs', shape: [shape.batch, shape.maskTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      pixelEmbed: stage.createTensor({ name: 'sam3.pixel-embed', shape: [shape.batch, shape.height, shape.width, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      layer0: stage.createTensor({ name: 'sam3.mask-embedder.layer0', shape: [shape.batch, shape.maskTokens, shape.channels], dtype: 'f32', usage }),
      layer1: stage.createTensor({ name: 'sam3.mask-embedder.layer1', shape: [shape.batch, shape.maskTokens, shape.channels], dtype: 'f32', usage }),
      maskEmbeddings: stage.createTensor({ name: 'sam3.mask-embeddings', shape: [shape.batch, shape.maskTokens, shape.channels], dtype: 'f32', usage }),
      upscaledEmbedding: stage.createTensor({ name: 'sam3.upscaled-embedding', shape: [shape.batch, shape.channels, shape.height, shape.width], dtype: 'f32', usage }),
      maskLogits: stage.createTensor({ name: 'sam3.mask-tail-logits', shape: maskShape, dtype: 'f32', usage }),
      binaryMask: stage.createTensor({ name: 'sam3.mask-tail-binary', shape: maskShape, dtype: 'u32', usage }),
      dims: stage.createUniformBuffer({
        label: 'sam3.mask-tail.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'mask_tokens', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'height', type: 'u32' },
          { name: 'width', type: 'u32' },
          { name: 'mask_tail_total', type: 'u32' },
          { name: 'mask_total', type: 'u32' },
          { name: 'spatial', type: 'u32' },
        ],
        values: { batch: shape.batch, mask_tokens: shape.maskTokens, channels: shape.channels, height: shape.height, width: shape.width, mask_tail_total: maskTailTotal, mask_total: maskTotal, spatial },
      }),
      thresholdDims: stage.createUniformBuffer({
        label: 'sam3.mask-tail.threshold-dims',
        schema: [{ name: 'total', type: 'u32' }],
        values: { total: maskTotal },
      }),
      weights: {
        maskEmbedder: weights.maskEmbedder.map((layer, index) => ({
          weight: stage.createTensor({ name: `sam3.mask-embedder.${index}.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          bias: stage.createTensor({ name: `sam3.mask-embedder.${index}.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        })),
        instanceProjection: {
          weight: stage.createTensor({ name: 'sam3.instance-projection.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          bias: stage.createTensor({ name: 'sam3.instance-projection.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        },
      },
    };
    stage.uploadTensor(tensors.lastHs, lastHs);
    stage.uploadTensor(tensors.pixelEmbed, pixelEmbed);
    for (let index = 0; index < 3; index += 1) {
      stage.uploadTensor(tensors.weights.maskEmbedder[index].weight, weights.maskEmbedder[index].weight);
      stage.uploadTensor(tensors.weights.maskEmbedder[index].bias, weights.maskEmbedder[index].bias);
    }
    stage.uploadTensor(tensors.weights.instanceProjection.weight, weights.instanceProjection.weight);
    stage.uploadTensor(tensors.weights.instanceProjection.bias, weights.instanceProjection.bias);
    await stage.yieldToBrowser({ reason: 'after-sam3-mask-tail-upload' });
  }, { shape });

  const program = runtime.defineProgram({
    name: 'sam3.mask-tail-phase-program',
    tensors: {
      lastHs: tensors.lastHs,
      pixelEmbed: tensors.pixelEmbed,
      layer0: tensors.layer0,
      layer1: tensors.layer1,
      maskEmbeddings: tensors.maskEmbeddings,
      upscaledEmbedding: tensors.upscaledEmbedding,
      maskLogits: tensors.maskLogits,
      binaryMask: tensors.binaryMask,
      w0: tensors.weights.maskEmbedder[0].weight,
      b0: tensors.weights.maskEmbedder[0].bias,
      w1: tensors.weights.maskEmbedder[1].weight,
      b1: tensors.weights.maskEmbedder[1].bias,
      w2: tensors.weights.maskEmbedder[2].weight,
      b2: tensors.weights.maskEmbedder[2].bias,
      instanceWeight: tensors.weights.instanceProjection.weight,
      instanceBias: tensors.weights.instanceProjection.bias,
    },
    uniforms: { dims: tensors.dims, thresholdDims: tensors.thresholdDims },
    kernels: {
      maskEmbedderLayer0: { code: LINEAR_RELU_WGSL, bindings: [{ name: 'input', resource: 'tensor:lastHs', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:w0', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:b0', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:layer0', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      maskEmbedderLayer1: { code: LINEAR_RELU_WGSL, bindings: [{ name: 'input', resource: 'tensor:layer0', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:w1', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:b1', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:layer1', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      maskEmbedderLayer2: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:layer1', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:w2', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:b2', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:maskEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      instanceProjection: { code: INSTANCE_PROJECTION_WGSL, bindings: [{ name: 'pixelEmbed', resource: 'tensor:pixelEmbed', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:instanceWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:instanceBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'upscaledEmbedding', resource: 'tensor:upscaledEmbedding', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      decodeMask: { code: MASK_PROJECTION_WGSL, bindings: [{ name: 'maskEmbeddings', resource: 'tensor:maskEmbeddings', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'upscaledEmbedding', resource: 'tensor:upscaledEmbedding', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'maskLogits', resource: 'tensor:maskLogits', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      thresholdMask: { code: THRESHOLD_WGSL, bindings: [{ name: 'maskLogits', resource: 'tensor:maskLogits', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'binaryMask', resource: 'tensor:binaryMask', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:thresholdDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
    },
    phases: [
      { name: 'mask-embedder-layer-0', kernel: 'maskEmbedderLayer0', dispatch: [workgroups(maskTailTotal)], yieldAfter: true },
      { name: 'mask-embedder-layer-1', kernel: 'maskEmbedderLayer1', dispatch: [workgroups(maskTailTotal)], yieldAfter: true },
      { name: 'mask-embedder-layer-2', kernel: 'maskEmbedderLayer2', dispatch: [workgroups(maskTailTotal)], yieldAfter: true },
      { name: 'instance-projection-1x1', kernel: 'instanceProjection', dispatch: [workgroups(shape.batch * shape.channels * spatial)], yieldAfter: true },
      { name: 'decode-mask', kernel: 'decodeMask', dispatch: [workgroups(maskTotal)], yieldAfter: true },
      { name: 'threshold-mask', kernel: 'thresholdMask', dispatch: [workgroups(maskTotal)], yieldAfter: true },
      { name: 'readback-mask', readbacks: [{ name: 'maskLogits', tensor: 'maskLogits' }, { name: 'binaryMask', tensor: 'binaryMask' }] },
    ],
    metadata: { routeId: SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const maskLogits = run.outputs.maskLogits;
  const binaryMask = run.outputs.binaryMask;
  const outputs = outputArtifacts(input.request, {
    maskLogits: await sha256Hex(maskLogits),
    binaryMask: await sha256Hex(binaryMask),
  }, maskShape);
  const receipt = createSam3MaskTailPhaseProgramRouteReceipt({
    sourceImage,
    tensorPacket,
    weightsPacket,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || weightsPacket.sha256, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      maskLogits: Array.from(new Float32Array(maskLogits)),
      binaryMask: Array.from(new Uint32Array(binaryMask)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
