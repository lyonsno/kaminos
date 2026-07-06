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

export const SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID = 'sam3.prompt-fpn.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-prompt-fpn-phase-program-v0';
const INPUT_ROLES = ['source-image', 'sam3-prompt-fpn-tensors', 'sam3-prompt-fpn-weights'];
const OUTPUT_ROLES = [{ key: 'promptFpnFeature', role: 'prompt-fpn-feature', required: true }];

const PROMPT_LAYER_NORM_WGSL = `
struct PromptFpnDims {
  batch: u32,
  spatial_tokens: u32,
  prompt_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_encoder: u32,
  total_prompt: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PromptFpnDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let token = gid.x;
  let total_tokens = dims.batch * dims.spatial_tokens;
  if (token >= total_tokens) { return; }
  let base = token * dims.channels;
  var mean = 0.0;
  for (var c = 0u; c < dims.channels; c = c + 1u) {
    mean = mean + input_values[base + c];
  }
  mean = mean / f32(dims.channels);
  var variance = 0.0;
  for (var c = 0u; c < dims.channels; c = c + 1u) {
    let delta = input_values[base + c] - mean;
    variance = variance + delta * delta;
  }
  variance = variance / f32(dims.channels);
  let inv_std = inverseSqrt(variance + 0.000001);
  for (var c = 0u; c < dims.channels; c = c + 1u) {
    output_values[base + c] = (input_values[base + c] - mean) * inv_std * norm_weight[c] + norm_bias[c];
  }
}
`;

const LINEAR_WGSL = `
struct PromptFpnDims {
  batch: u32,
  spatial_tokens: u32,
  prompt_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_encoder: u32,
  total_prompt: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: PromptFpnDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&output_values)) { return; }
  let channel = index % dims.channels;
  let token_base = index - channel;
  var sum = bias[channel];
  for (var c = 0u; c < dims.channels; c = c + 1u) {
    sum = sum + input_values[token_base + c] * weight[channel * dims.channels + c];
  }
  output_values[index] = sum;
}
`;

const PROMPT_ATTENTION_SOFTMAX_WGSL = `
struct PromptFpnDims {
  batch: u32,
  spatial_tokens: u32,
  prompt_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_encoder: u32,
  total_prompt: u32,
};

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read> prompt_mask: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<uniform> dims: PromptFpnDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_encoder) { return; }
  let channel = index % dims.channels;
  let spatial = (index / dims.channels) % dims.spatial_tokens;
  let batch = index / (dims.spatial_tokens * dims.channels);
  let head = channel / dims.head_dim;
  let head_offset = head * dims.head_dim;
  let dim_in_head = channel - head_offset;
  let q_base = (batch * dims.spatial_tokens + spatial) * dims.channels + head_offset;
  let scale = inverseSqrt(f32(dims.head_dim));

  var max_score = -340282346638528859811704183484516925440.0;
  for (var token = 0u; token < dims.prompt_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.prompt_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale;
    if (prompt_mask[batch * dims.prompt_tokens + token] <= 0.0) {
      score = score - 1000000000.0;
    }
    max_score = max(max_score, score);
  }

  var denom = 0.0;
  var value = 0.0;
  for (var token = 0u; token < dims.prompt_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.prompt_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale;
    if (prompt_mask[batch * dims.prompt_tokens + token] <= 0.0) {
      score = score - 1000000000.0;
    }
    let weight = exp(score - max_score);
    let v_index = (batch * dims.prompt_tokens + token) * dims.channels + head_offset + dim_in_head;
    denom = denom + weight;
    value = value + weight * v_values[v_index];
  }
  output_values[index] = value / denom;
}
`;

const PROMPT_OUTPUT_RESIDUAL_WGSL = `
struct PromptFpnDims {
  batch: u32,
  spatial_tokens: u32,
  prompt_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_encoder: u32,
  total_prompt: u32,
};

@group(0) @binding(0) var<storage, read> attention_values: array<f32>;
@group(0) @binding(1) var<storage, read> residual_values: array<f32>;
@group(0) @binding(2) var<storage, read> weight: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<uniform> dims: PromptFpnDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_encoder) { return; }
  let channel = index % dims.channels;
  let token_base = index - channel;
  var sum = bias[channel];
  for (var c = 0u; c < dims.channels; c = c + 1u) {
    sum = sum + attention_values[token_base + c] * weight[channel * dims.channels + c];
  }
  output_values[index] = residual_values[index] + sum;
}
`;

function requiredStages() {
  return ['load-prompt-fpn-tensors', 'prompt-layernorm', 'prompt-qkv-q', 'prompt-qkv-k', 'prompt-qkv-v', 'prompt-attention-softmax', 'prompt-output-residual', 'readback-prompt-fpn-feature'];
}

function createDefaultScheduler() {
  const stages = requiredStages();
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: stages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-prompt-fpn-feature' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: stages.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-prompt-fpn-feature' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-prompt-fpn-feature' })),
      notes: 'SAM3 prompt-FPN phase program cooperates between prompt cross-attention kernels and readback boundaries.',
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
  const batch = shape.batch;
  const spatialTokens = shape.spatialTokens;
  const promptTokens = shape.promptTokens;
  const channels = shape.channels;
  const heads = shape.heads || 8;
  const height = shape.height;
  const width = shape.width;
  if (!Number.isInteger(batch) || batch <= 0) throw new Error('shape.batch must be a positive integer');
  if (!Number.isInteger(spatialTokens) || spatialTokens <= 0) throw new Error('shape.spatialTokens must be a positive integer');
  if (!Number.isInteger(promptTokens) || promptTokens <= 0) throw new Error('shape.promptTokens must be a positive integer');
  if (!Number.isInteger(channels) || channels <= 0) throw new Error('shape.channels must be a positive integer');
  if (!Number.isInteger(heads) || heads <= 0 || channels % heads !== 0) throw new Error('shape.heads must divide channels');
  if (!Number.isInteger(height) || height <= 0) throw new Error('shape.height must be a positive integer');
  if (!Number.isInteger(width) || width <= 0) throw new Error('shape.width must be a positive integer');
  if (height * width !== spatialTokens) throw new Error('shape.height * shape.width must equal spatialTokens');
  return { batch, spatialTokens, promptTokens, channels, heads, headDim: channels / heads, height, width };
}

function validatePromptFpnInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const encoderHiddenStates = ensureFloat32Array(input.encoderHiddenStates, 'encoderHiddenStates');
  const promptFeatures = ensureFloat32Array(input.promptFeatures, 'promptFeatures');
  const promptMask = ensureFloat32Array(input.promptMask, 'promptMask');
  if (encoderHiddenStates.length !== shape.batch * shape.spatialTokens * shape.channels) throw new Error('encoderHiddenStates length mismatch');
  if (promptFeatures.length !== shape.batch * shape.promptTokens * shape.channels) throw new Error('promptFeatures length mismatch');
  if (promptMask.length !== shape.batch * shape.promptTokens) throw new Error('promptMask length mismatch');
  const weightNames = ['layerNormWeight', 'layerNormBias', 'qWeight', 'qBias', 'kWeight', 'kBias', 'vWeight', 'vBias', 'oWeight', 'oBias'];
  const weights = {};
  for (const name of weightNames) weights[name] = ensureFloat32Array(input.weights?.[name], `weights.${name}`);
  for (const name of ['layerNormWeight', 'layerNormBias', 'qBias', 'kBias', 'vBias', 'oBias']) {
    if (weights[name].length !== shape.channels) throw new Error(`weights.${name} length mismatch`);
  }
  for (const name of ['qWeight', 'kWeight', 'vWeight', 'oWeight']) {
    if (weights[name].length !== shape.channels * shape.channels) throw new Error(`weights.${name} length mismatch`);
  }
  return { shape, encoderHiddenStates, promptFeatures, promptMask, weights };
}

function linearToken(input, weight, bias, tokenBase, channels) {
  const out = new Float32Array(channels);
  for (let oc = 0; oc < channels; oc += 1) {
    let sum = bias[oc];
    const weightBase = oc * channels;
    for (let ic = 0; ic < channels; ic += 1) sum += input[tokenBase + ic] * weight[weightBase + ic];
    out[oc] = sum;
  }
  return out;
}

function projectAll(input, tokenCount, channels, weight, bias) {
  const out = new Float32Array(tokenCount * channels);
  for (let token = 0; token < tokenCount; token += 1) {
    out.set(linearToken(input, weight, bias, token * channels, channels), token * channels);
  }
  return out;
}

function layerNorm(input, weights, shape) {
  const out = new Float32Array(input.length);
  for (let token = 0; token < shape.batch * shape.spatialTokens; token += 1) {
    const base = token * shape.channels;
    let mean = 0;
    for (let c = 0; c < shape.channels; c += 1) mean += input[base + c];
    mean /= shape.channels;
    let variance = 0;
    for (let c = 0; c < shape.channels; c += 1) {
      const delta = input[base + c] - mean;
      variance += delta * delta;
    }
    variance /= shape.channels;
    const invStd = 1 / Math.sqrt(variance + 0.000001);
    for (let c = 0; c < shape.channels; c += 1) out[base + c] = (input[base + c] - mean) * invStd * weights.layerNormWeight[c] + weights.layerNormBias[c];
  }
  return out;
}

function promptAttention(q, k, v, mask, shape) {
  const out = new Float32Array(q.length);
  const scale = 1 / Math.sqrt(shape.headDim);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let n = 0; n < shape.spatialTokens; n += 1) {
      for (let h = 0; h < shape.heads; h += 1) {
        const headOffset = h * shape.headDim;
        const qBase = (b * shape.spatialTokens + n) * shape.channels + headOffset;
        let maxScore = -Infinity;
        const scores = new Float64Array(shape.promptTokens);
        for (let t = 0; t < shape.promptTokens; t += 1) {
          const kBase = (b * shape.promptTokens + t) * shape.channels + headOffset;
          let score = 0;
          for (let d = 0; d < shape.headDim; d += 1) score += q[qBase + d] * k[kBase + d];
          score *= scale;
          if (mask[b * shape.promptTokens + t] <= 0) score -= 1e9;
          scores[t] = score;
          if (score > maxScore) maxScore = score;
        }
        let denom = 0;
        for (let t = 0; t < shape.promptTokens; t += 1) denom += Math.exp(scores[t] - maxScore);
        for (let d = 0; d < shape.headDim; d += 1) {
          let value = 0;
          for (let t = 0; t < shape.promptTokens; t += 1) {
            const weight = Math.exp(scores[t] - maxScore) / denom;
            const vIndex = (b * shape.promptTokens + t) * shape.channels + headOffset + d;
            value += weight * v[vIndex];
          }
          out[(b * shape.spatialTokens + n) * shape.channels + headOffset + d] = value;
        }
      }
    }
  }
  return out;
}

export function createSam3PromptFpnPhaseProgramCpuOracle(input) {
  const { shape, encoderHiddenStates, promptFeatures, promptMask, weights } = validatePromptFpnInputs(input);
  const normed = layerNorm(encoderHiddenStates, weights, shape);
  const q = projectAll(normed, shape.batch * shape.spatialTokens, shape.channels, weights.qWeight, weights.qBias);
  const k = projectAll(promptFeatures, shape.batch * shape.promptTokens, shape.channels, weights.kWeight, weights.kBias);
  const v = projectAll(promptFeatures, shape.batch * shape.promptTokens, shape.channels, weights.vWeight, weights.vBias);
  const attention = promptAttention(q, k, v, promptMask, shape);
  const projected = projectAll(attention, shape.batch * shape.spatialTokens, shape.channels, weights.oWeight, weights.oBias);
  const updatedEncoderHiddenStates = new Float32Array(encoderHiddenStates.length);
  for (let index = 0; index < updatedEncoderHiddenStates.length; index += 1) updatedEncoderHiddenStates[index] = encoderHiddenStates[index] + projected[index];
  return { shape, updatedEncoderHiddenStates, promptFpnFeature: updatedEncoderHiddenStates };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM prompt-FPN outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const outputRequest = roleArtifact(request.outputs, 'prompt-fpn-feature');
  return {
    promptFpnFeature: { artifactId: outputRequest.artifactId, sha256: hashes.promptFpnFeature, shape },
  };
}

export function createSam3PromptFpnPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-prompt-fpn-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-prompt-fpn-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3PromptFpnPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: requiredStages(),
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-prompt-fpn', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3PromptFpnPhaseProgramRoute', upstreamBoundary: 'mlx-reference-detr-encoder-and-prompt' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3PromptFpnPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const projection = validatePromptFpnInputs(input.tensors || {});
  const { shape, encoderHiddenStates, promptFeatures, promptMask, weights } = projection;
  const route = input.route || createSam3PromptFpnPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-prompt-fpn-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-prompt-fpn-weights');
  const outputShape = [shape.batch, shape.height, shape.width, shape.channels];

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-prompt-fpn-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: requiredStages(),
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
  });

  let tensors = null;
  await runtime.runStage('load-prompt-fpn-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      encoderHiddenStates: stage.createTensor({ name: 'sam3.prompt-fpn.encoder-hidden-states', shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      promptFeatures: stage.createTensor({ name: 'sam3.prompt-fpn.prompt-features', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      promptMask: stage.createTensor({ name: 'sam3.prompt-fpn.prompt-mask', shape: [shape.batch, shape.promptTokens], dtype: 'f32', usage: readonlyUsage }),
      normed: stage.createTensor({ name: 'sam3.prompt-fpn.normed', shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
      q: stage.createTensor({ name: 'sam3.prompt-fpn.q', shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
      k: stage.createTensor({ name: 'sam3.prompt-fpn.k', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
      v: stage.createTensor({ name: 'sam3.prompt-fpn.v', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
      attention: stage.createTensor({ name: 'sam3.prompt-fpn.attention', shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
      output: stage.createTensor({ name: 'sam3.prompt-fpn.output', shape: outputShape, dtype: 'f32', usage }),
      dims: stage.createUniformBuffer({
        label: 'sam3.prompt-fpn.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'spatial_tokens', type: 'u32' },
          { name: 'prompt_tokens', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'heads', type: 'u32' },
          { name: 'head_dim', type: 'u32' },
          { name: 'total_encoder', type: 'u32' },
          { name: 'total_prompt', type: 'u32' },
        ],
        values: {
          batch: shape.batch,
          spatial_tokens: shape.spatialTokens,
          prompt_tokens: shape.promptTokens,
          channels: shape.channels,
          heads: shape.heads,
          head_dim: shape.headDim,
          total_encoder: shape.batch * shape.spatialTokens * shape.channels,
          total_prompt: shape.batch * shape.promptTokens * shape.channels,
        },
      }),
      weights: {
        layerNormWeight: stage.createTensor({ name: 'sam3.prompt-fpn.norm.weight', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        layerNormBias: stage.createTensor({ name: 'sam3.prompt-fpn.norm.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        qWeight: stage.createTensor({ name: 'sam3.prompt-fpn.q.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        qBias: stage.createTensor({ name: 'sam3.prompt-fpn.q.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        kWeight: stage.createTensor({ name: 'sam3.prompt-fpn.k.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        kBias: stage.createTensor({ name: 'sam3.prompt-fpn.k.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        vWeight: stage.createTensor({ name: 'sam3.prompt-fpn.v.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        vBias: stage.createTensor({ name: 'sam3.prompt-fpn.v.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        oWeight: stage.createTensor({ name: 'sam3.prompt-fpn.o.weight', shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
        oBias: stage.createTensor({ name: 'sam3.prompt-fpn.o.bias', shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
      },
    };
    stage.uploadTensor(tensors.encoderHiddenStates, encoderHiddenStates);
    stage.uploadTensor(tensors.promptFeatures, promptFeatures);
    stage.uploadTensor(tensors.promptMask, promptMask);
    for (const [name, tensor] of Object.entries(tensors.weights)) stage.uploadTensor(tensor, weights[name]);
    await stage.yieldToBrowser({ reason: 'after-sam3-prompt-fpn-upload' });
  }, { shape });

  const totalEncoder = shape.batch * shape.spatialTokens * shape.channels;
  const totalPrompt = shape.batch * shape.promptTokens * shape.channels;
  const program = runtime.defineProgram({
    name: 'sam3.prompt-fpn-phase-program',
    tensors: {
      encoderHiddenStates: tensors.encoderHiddenStates,
      promptFeatures: tensors.promptFeatures,
      promptMask: tensors.promptMask,
      normed: tensors.normed,
      q: tensors.q,
      k: tensors.k,
      v: tensors.v,
      attention: tensors.attention,
      output: tensors.output,
      ...tensors.weights,
    },
    uniforms: { dims: tensors.dims },
    kernels: {
      layerNorm: { code: PROMPT_LAYER_NORM_WGSL, bindings: [{ name: 'input', resource: 'tensor:encoderHiddenStates', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'normWeight', resource: 'tensor:layerNormWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'normBias', resource: 'tensor:layerNormBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:normed', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      qLinear: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:normed', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:qWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:qBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:q', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      kLinear: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:promptFeatures', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:kWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:kBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:k', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      vLinear: { code: LINEAR_WGSL, bindings: [{ name: 'input', resource: 'tensor:promptFeatures', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:vWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:vBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:v', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      attention: { code: PROMPT_ATTENTION_SOFTMAX_WGSL, bindings: [{ name: 'q', resource: 'tensor:q', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'k', resource: 'tensor:k', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'v', resource: 'tensor:v', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'promptMask', resource: 'tensor:promptMask', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:attention', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
      outputResidual: { code: PROMPT_OUTPUT_RESIDUAL_WGSL, bindings: [{ name: 'attention', resource: 'tensor:attention', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'residual', resource: 'tensor:encoderHiddenStates', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: 'tensor:oWeight', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: 'tensor:oBias', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: 'tensor:output', visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }] },
    },
    phases: [
      { name: 'prompt-layernorm', kernel: 'layerNorm', dispatch: [workgroups(shape.batch * shape.spatialTokens)], yieldAfter: true },
      { name: 'prompt-qkv-q', kernel: 'qLinear', dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: 'prompt-qkv-k', kernel: 'kLinear', dispatch: [workgroups(totalPrompt)], yieldAfter: true },
      { name: 'prompt-qkv-v', kernel: 'vLinear', dispatch: [workgroups(totalPrompt)], yieldAfter: true },
      { name: 'prompt-attention-softmax', kernel: 'attention', dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: 'prompt-output-residual', kernel: 'outputResidual', dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: 'readback-prompt-fpn-feature', readbacks: [{ name: 'promptFpnFeature', tensor: 'output' }] },
    ],
    metadata: { routeId: SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID },
  });

  const run = await runtime.runProgram(program);
  const promptFpnFeature = run.outputs.promptFpnFeature;
  const outputs = outputArtifacts(input.request, {
    promptFpnFeature: await sha256Hex(promptFpnFeature),
  }, outputShape);
  const receipt = createSam3PromptFpnPhaseProgramRouteReceipt({
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
      promptFpnFeature: Array.from(new Float32Array(promptFpnFeature)),
    };
  }
  return authoritative;
}
