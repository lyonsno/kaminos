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

export const SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.detr-encoder.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-detr-encoder-phase-program-v0';
const INPUT_ROLES = ['source-image', 'sam3-detr-encoder-tensors', 'sam3-detr-encoder-weights'];
const OUTPUT_ROLES = [{ key: 'encoderHiddenStates', role: 'encoder-hidden-states', required: true }];

const LAYERNORM_WGSL = `
struct LayerNormDims {
  total_tokens: u32,
  channels: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LayerNormDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let token = gid.x;
  if (token >= dims.total_tokens) { return; }
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

const ADD_WGSL = `
struct AddDims {
  total: u32,
};

@group(0) @binding(0) var<storage, read> a_values: array<f32>;
@group(0) @binding(1) var<storage, read> b_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: AddDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total) { return; }
  output_values[index] = a_values[index] + b_values[index];
}
`;

const LINEAR_WGSL = `
struct LinearDims {
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  let input_base = token * dims.input_channels;
  var sum = bias[output_channel];
  let weight_base = output_channel * dims.input_channels;
  for (var c = 0u; c < dims.input_channels; c = c + 1u) {
    sum = sum + input_values[input_base + c] * weight[weight_base + c];
  }
  output_values[index] = sum;
}
`;

const LINEAR_RELU_WGSL = `
struct LinearDims {
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  let input_base = token * dims.input_channels;
  var sum = bias[output_channel];
  let weight_base = output_channel * dims.input_channels;
  for (var c = 0u; c < dims.input_channels; c = c + 1u) {
    sum = sum + input_values[input_base + c] * weight[weight_base + c];
  }
  output_values[index] = max(sum, 0.0);
}
`;

const ATTENTION_WGSL = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: AttentionDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.channels;
  let query = (index / dims.channels) % dims.query_tokens;
  let batch = index / (dims.query_tokens * dims.channels);
  let head = channel / dims.head_dim;
  let head_offset = head * dims.head_dim;
  let dim_in_head = channel - head_offset;
  let q_base = (batch * dims.query_tokens + query) * dims.channels + head_offset;
  let scale = inverseSqrt(f32(dims.head_dim));

  var max_score = -340282346638528859811704183484516925440.0;
  for (var token = 0u; token < dims.key_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.key_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale;
    max_score = max(max_score, score);
  }

  var denom = 0.0;
  var value = 0.0;
  for (var token = 0u; token < dims.key_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.key_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale;
    let weight = exp(score - max_score);
    let v_index = (batch * dims.key_tokens + token) * dims.channels + head_offset + dim_in_head;
    denom = denom + weight;
    value = value + weight * v_values[v_index];
  }
  output_values[index] = value / denom;
}
`;

const MASKED_ATTENTION_WGSL = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read> key_mask: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<uniform> dims: AttentionDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.channels;
  let query = (index / dims.channels) % dims.query_tokens;
  let batch = index / (dims.query_tokens * dims.channels);
  let head = channel / dims.head_dim;
  let head_offset = head * dims.head_dim;
  let dim_in_head = channel - head_offset;
  let q_base = (batch * dims.query_tokens + query) * dims.channels + head_offset;
  let scale = inverseSqrt(f32(dims.head_dim));

  var max_score = -340282346638528859811704183484516925440.0;
  for (var token = 0u; token < dims.key_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.key_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale;
    if (key_mask[batch * dims.key_tokens + token] <= 0.0) {
      score = score - 1000000000.0;
    }
    max_score = max(max_score, score);
  }

  var denom = 0.0;
  var value = 0.0;
  for (var token = 0u; token < dims.key_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.key_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale;
    if (key_mask[batch * dims.key_tokens + token] <= 0.0) {
      score = score - 1000000000.0;
    }
    let weight = exp(score - max_score);
    let v_index = (batch * dims.key_tokens + token) * dims.channels + head_offset + dim_in_head;
    denom = denom + weight;
    value = value + weight * v_values[v_index];
  }
  output_values[index] = value / denom;
}
`;

const DETR_ENCODER_ROUTE_SOURCE_MARKERS = [
  'defineProgram',
  'runProgram',
  'detr-encoder-layernorm1',
  'detr-encoder-self-attention-softmax',
  'detr-encoder-cross-attention-softmax',
  'detr-encoder-mlp-fc1-relu',
];

function requiredStages(layerCount = 6) {
  const stages = ['load-detr-encoder-tensors'];
  for (let layer = 0; layer < layerCount; layer += 1) {
    stages.push(
      `detr-encoder-layernorm1-${layer}`,
      `detr-encoder-self-q-${layer}`,
      `detr-encoder-self-k-${layer}`,
      `detr-encoder-self-v-${layer}`,
      `detr-encoder-self-attention-softmax-${layer}`,
      `detr-encoder-self-output-residual-${layer}`,
      `detr-encoder-layernorm2-${layer}`,
      `detr-encoder-cross-q-${layer}`,
      `detr-encoder-cross-k-${layer}`,
      `detr-encoder-cross-v-${layer}`,
      `detr-encoder-cross-attention-softmax-${layer}`,
      `detr-encoder-cross-output-residual-${layer}`,
      `detr-encoder-layernorm3-${layer}`,
      `detr-encoder-mlp-fc1-relu-${layer}`,
      `detr-encoder-mlp-fc2-residual-${layer}`,
    );
  }
  stages.push('readback-encoder-hidden-states');
  return stages;
}

function createDefaultScheduler(layerCount = 6) {
  const stages = requiredStages(layerCount);
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: stages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-encoder-hidden-states' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: stages.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-encoder-hidden-states' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-encoder-hidden-states' })),
      notes: 'SAM3 DETR encoder phase program cooperates between six pre-norm self-attention, text cross-attention, MLP, and readback phases.',
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
  const layerCount = shape.layerCount || 6;
  const mlpHidden = shape.mlpHidden || 2048;
  const height = shape.height;
  const width = shape.width;
  if (!Number.isInteger(batch) || batch <= 0) throw new Error('shape.batch must be a positive integer');
  if (!Number.isInteger(spatialTokens) || spatialTokens <= 0) throw new Error('shape.spatialTokens must be a positive integer');
  if (!Number.isInteger(promptTokens) || promptTokens <= 0) throw new Error('shape.promptTokens must be a positive integer');
  if (!Number.isInteger(channels) || channels <= 0) throw new Error('shape.channels must be a positive integer');
  if (!Number.isInteger(heads) || heads <= 0 || channels % heads !== 0) throw new Error('shape.heads must divide channels');
  if (!Number.isInteger(layerCount) || layerCount <= 0) throw new Error('shape.layerCount must be a positive integer');
  if (!Number.isInteger(mlpHidden) || mlpHidden <= 0) throw new Error('shape.mlpHidden must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new Error('shape.height must be a positive integer');
  if (!Number.isInteger(width) || width <= 0) throw new Error('shape.width must be a positive integer');
  if (height * width !== spatialTokens) throw new Error('shape.height * shape.width must equal spatialTokens');
  return { batch, spatialTokens, promptTokens, channels, heads, layerCount, mlpHidden, headDim: channels / heads, height, width };
}

function validateLayerWeights(layer, index, shape) {
  if (!layer || typeof layer !== 'object') throw new Error(`layers.${index} is required`);
  const names = [
    'layerNorm1Weight', 'layerNorm1Bias',
    'selfQWeight', 'selfQBias', 'selfKWeight', 'selfKBias', 'selfVWeight', 'selfVBias', 'selfOWeight', 'selfOBias',
    'layerNorm2Weight', 'layerNorm2Bias',
    'crossQWeight', 'crossQBias', 'crossKWeight', 'crossKBias', 'crossVWeight', 'crossVBias', 'crossOWeight', 'crossOBias',
    'layerNorm3Weight', 'layerNorm3Bias',
    'fc1Weight', 'fc1Bias', 'fc2Weight', 'fc2Bias',
  ];
  const out = {};
  for (const name of names) out[name] = ensureFloat32Array(layer[name], `layers.${index}.${name}`);
  for (const name of ['layerNorm1Weight', 'layerNorm1Bias', 'selfQBias', 'selfKBias', 'selfVBias', 'selfOBias', 'layerNorm2Weight', 'layerNorm2Bias', 'crossQBias', 'crossKBias', 'crossVBias', 'crossOBias', 'layerNorm3Weight', 'layerNorm3Bias', 'fc2Bias']) {
    if (out[name].length !== shape.channels) throw new Error(`layers.${index}.${name} length mismatch`);
  }
  for (const name of ['selfQWeight', 'selfKWeight', 'selfVWeight', 'selfOWeight', 'crossQWeight', 'crossKWeight', 'crossVWeight', 'crossOWeight']) {
    if (out[name].length !== shape.channels * shape.channels) throw new Error(`layers.${index}.${name} length mismatch`);
  }
  if (out.fc1Weight.length !== shape.mlpHidden * shape.channels) throw new Error(`layers.${index}.fc1Weight length mismatch`);
  if (out.fc1Bias.length !== shape.mlpHidden) throw new Error(`layers.${index}.fc1Bias length mismatch`);
  if (out.fc2Weight.length !== shape.channels * shape.mlpHidden) throw new Error(`layers.${index}.fc2Weight length mismatch`);
  return out;
}

function validateDetrEncoderInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const encoderSrc = ensureFloat32Array(input.encoderSrc, 'encoderSrc');
  const encoderPos = ensureFloat32Array(input.encoderPos, 'encoderPos');
  const promptFeatures = ensureFloat32Array(input.promptFeatures, 'promptFeatures');
  const promptMask = ensureFloat32Array(input.promptMask, 'promptMask');
  if (encoderSrc.length !== shape.batch * shape.spatialTokens * shape.channels) throw new Error('encoderSrc length mismatch');
  if (encoderPos.length !== encoderSrc.length) throw new Error('encoderPos length mismatch');
  if (promptFeatures.length !== shape.batch * shape.promptTokens * shape.channels) throw new Error('promptFeatures length mismatch');
  if (promptMask.length !== shape.batch * shape.promptTokens) throw new Error('promptMask length mismatch');
  if (!Array.isArray(input.layers) || input.layers.length !== shape.layerCount) throw new Error('layers length must equal shape.layerCount');
  const layers = input.layers.map((layer, index) => validateLayerWeights(layer, index, shape));
  return { shape, encoderSrc, encoderPos, promptFeatures, promptMask, layers };
}

function layerNorm(input, weight, bias, tokenCount, channels) {
  const out = new Float32Array(input.length);
  for (let token = 0; token < tokenCount; token += 1) {
    const base = token * channels;
    let mean = 0;
    for (let c = 0; c < channels; c += 1) mean += input[base + c];
    mean /= channels;
    let variance = 0;
    for (let c = 0; c < channels; c += 1) {
      const delta = input[base + c] - mean;
      variance += delta * delta;
    }
    variance /= channels;
    const invStd = 1 / Math.sqrt(variance + 0.000001);
    for (let c = 0; c < channels; c += 1) out[base + c] = (input[base + c] - mean) * invStd * weight[c] + bias[c];
  }
  return out;
}

function addArrays(a, b) {
  const out = new Float32Array(a.length);
  for (let index = 0; index < out.length; index += 1) out[index] = a[index] + b[index];
  return out;
}

function linearAll(input, tokenCount, inputChannels, outputChannels, weight, bias, relu = false) {
  const out = new Float32Array(tokenCount * outputChannels);
  for (let token = 0; token < tokenCount; token += 1) {
    const inBase = token * inputChannels;
    const outBase = token * outputChannels;
    for (let oc = 0; oc < outputChannels; oc += 1) {
      let sum = bias[oc];
      const weightBase = oc * inputChannels;
      for (let ic = 0; ic < inputChannels; ic += 1) sum += input[inBase + ic] * weight[weightBase + ic];
      out[outBase + oc] = relu ? Math.max(sum, 0) : sum;
    }
  }
  return out;
}

function attention(q, k, v, keyMask, shape, queryTokens, keyTokens) {
  const out = new Float32Array(shape.batch * queryTokens * shape.channels);
  const scale = 1 / Math.sqrt(shape.headDim);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let n = 0; n < queryTokens; n += 1) {
      for (let h = 0; h < shape.heads; h += 1) {
        const headOffset = h * shape.headDim;
        const qBase = (b * queryTokens + n) * shape.channels + headOffset;
        let maxScore = -Infinity;
        const scores = new Float64Array(keyTokens);
        for (let t = 0; t < keyTokens; t += 1) {
          const kBase = (b * keyTokens + t) * shape.channels + headOffset;
          let score = 0;
          for (let d = 0; d < shape.headDim; d += 1) score += q[qBase + d] * k[kBase + d];
          score *= scale;
          if (keyMask && keyMask[b * keyTokens + t] <= 0) score -= 1e9;
          scores[t] = score;
          if (score > maxScore) maxScore = score;
        }
        let denom = 0;
        for (let t = 0; t < keyTokens; t += 1) denom += Math.exp(scores[t] - maxScore);
        for (let d = 0; d < shape.headDim; d += 1) {
          let value = 0;
          for (let t = 0; t < keyTokens; t += 1) {
            const weight = Math.exp(scores[t] - maxScore) / denom;
            const vIndex = (b * keyTokens + t) * shape.channels + headOffset + d;
            value += weight * v[vIndex];
          }
          out[(b * queryTokens + n) * shape.channels + headOffset + d] = value;
        }
      }
    }
  }
  return out;
}

export function createSam3DetrEncoderPhaseProgramCpuOracle(input) {
  const { shape, encoderSrc, encoderPos, promptFeatures, promptMask, layers } = validateDetrEncoderInputs(input);
  const spatialTokenCount = shape.batch * shape.spatialTokens;
  const promptTokenCount = shape.batch * shape.promptTokens;
  let hidden = new Float32Array(encoderSrc);
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    const layer = layers[layerIndex];
    const norm1 = layerNorm(hidden, layer.layerNorm1Weight, layer.layerNorm1Bias, spatialTokenCount, shape.channels);
    const selfInput = addArrays(norm1, encoderPos);
    const selfQ = linearAll(selfInput, spatialTokenCount, shape.channels, shape.channels, layer.selfQWeight, layer.selfQBias);
    const selfK = linearAll(selfInput, spatialTokenCount, shape.channels, shape.channels, layer.selfKWeight, layer.selfKBias);
    const selfV = linearAll(norm1, spatialTokenCount, shape.channels, shape.channels, layer.selfVWeight, layer.selfVBias);
    const selfAttn = attention(selfQ, selfK, selfV, null, shape, shape.spatialTokens, shape.spatialTokens);
    const selfProjected = linearAll(selfAttn, spatialTokenCount, shape.channels, shape.channels, layer.selfOWeight, layer.selfOBias);
    hidden = addArrays(hidden, selfProjected);

    const norm2 = layerNorm(hidden, layer.layerNorm2Weight, layer.layerNorm2Bias, spatialTokenCount, shape.channels);
    const crossQ = linearAll(norm2, spatialTokenCount, shape.channels, shape.channels, layer.crossQWeight, layer.crossQBias);
    const crossK = linearAll(promptFeatures, promptTokenCount, shape.channels, shape.channels, layer.crossKWeight, layer.crossKBias);
    const crossV = linearAll(promptFeatures, promptTokenCount, shape.channels, shape.channels, layer.crossVWeight, layer.crossVBias);
    const crossAttn = attention(crossQ, crossK, crossV, promptMask, shape, shape.spatialTokens, shape.promptTokens);
    const crossProjected = linearAll(crossAttn, spatialTokenCount, shape.channels, shape.channels, layer.crossOWeight, layer.crossOBias);
    hidden = addArrays(hidden, crossProjected);

    const norm3 = layerNorm(hidden, layer.layerNorm3Weight, layer.layerNorm3Bias, spatialTokenCount, shape.channels);
    const mlp1 = linearAll(norm3, spatialTokenCount, shape.channels, shape.mlpHidden, layer.fc1Weight, layer.fc1Bias, true);
    const mlp2 = linearAll(mlp1, spatialTokenCount, shape.mlpHidden, shape.channels, layer.fc2Weight, layer.fc2Bias);
    hidden = addArrays(hidden, mlp2);
  }
  return { shape, encoderHiddenStates: hidden };
}

export function createSam3DetrEncoderPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-detr-encoder-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-detr-encoder-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3DetrEncoderPhaseProgramRouteDefinition(input = {}) {
  const layerCount = input.shape?.layerCount || input.layerCount || 6;
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: requiredStages(layerCount),
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-detr-encoder', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(layerCount),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3DetrEncoderPhaseProgramRoute', upstreamBoundary: 'mlx-reference-vision-and-text-encoders' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM DETR encoder outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const outputRequest = roleArtifact(request.outputs, 'encoder-hidden-states');
  return {
    encoderHiddenStates: { artifactId: outputRequest.artifactId, sha256: hashes.encoderHiddenStates, shape },
  };
}

function layerTensorName(layer, name) {
  return `layer${layer}${name[0].toUpperCase()}${name.slice(1)}`;
}

export async function runSam3DetrEncoderPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const projection = validateDetrEncoderInputs(input.tensors || {});
  const { shape, encoderSrc, encoderPos, promptFeatures, promptMask, layers } = projection;
  const route = input.route || createSam3DetrEncoderPhaseProgramRouteDefinition({ kernel: input.kernel, shape });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-detr-encoder-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-detr-encoder-weights');
  const outputShape = [shape.batch, shape.spatialTokens, shape.channels];

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-detr-encoder-phase-program',
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: requiredStages(shape.layerCount),
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
  });

  const totalEncoder = shape.batch * shape.spatialTokens * shape.channels;
  const totalPrompt = shape.batch * shape.promptTokens * shape.channels;
  const spatialTokenCount = shape.batch * shape.spatialTokens;
  const promptTokenCount = shape.batch * shape.promptTokens;
  const totalMlpHidden = shape.batch * shape.spatialTokens * shape.mlpHidden;
  let tensors = null;

  await runtime.runStage('load-detr-encoder-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    tensors = {
      encoderSrc: stage.createTensor({ name: 'sam3.detr-encoder.src', shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
      encoderPos: stage.createTensor({ name: 'sam3.detr-encoder.pos', shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      promptFeatures: stage.createTensor({ name: 'sam3.detr-encoder.prompt-features', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage: readonlyUsage }),
      promptMask: stage.createTensor({ name: 'sam3.detr-encoder.prompt-mask', shape: [shape.batch, shape.promptTokens], dtype: 'f32', usage: readonlyUsage }),
      layerNormDims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.layernorm-dims',
        schema: [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }],
        values: { total_tokens: spatialTokenCount, channels: shape.channels },
      }),
      addDims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.add-dims',
        schema: [{ name: 'total', type: 'u32' }],
        values: { total: totalEncoder },
      }),
      spatialLinearDims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.spatial-linear-dims',
        schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: { input_channels: shape.channels, output_channels: shape.channels, total_output: totalEncoder },
      }),
      promptLinearDims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.prompt-linear-dims',
        schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: { input_channels: shape.channels, output_channels: shape.channels, total_output: totalPrompt },
      }),
      fc1Dims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.fc1-dims',
        schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: { input_channels: shape.channels, output_channels: shape.mlpHidden, total_output: totalMlpHidden },
      }),
      fc2Dims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.fc2-dims',
        schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: { input_channels: shape.mlpHidden, output_channels: shape.channels, total_output: totalEncoder },
      }),
      selfAttentionDims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.self-attention-dims',
        schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: { batch: shape.batch, query_tokens: shape.spatialTokens, key_tokens: shape.spatialTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, total_output: totalEncoder },
      }),
      crossAttentionDims: stage.createUniformBuffer({
        label: 'sam3.detr-encoder.cross-attention-dims',
        schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: { batch: shape.batch, query_tokens: shape.spatialTokens, key_tokens: shape.promptTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, total_output: totalEncoder },
      }),
      layers: [],
    };
    stage.uploadTensor(tensors.encoderSrc, encoderSrc);
    stage.uploadTensor(tensors.encoderPos, encoderPos);
    stage.uploadTensor(tensors.promptFeatures, promptFeatures);
    stage.uploadTensor(tensors.promptMask, promptMask);
    for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
      const layerTensors = {
        norm1: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.norm1`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfInput: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-input`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfQ: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-q`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfK: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-k`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfV: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-v`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfAttention: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-attention`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfProjected: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-projected`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        selfHidden: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-hidden`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        norm2: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.norm2`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        crossQ: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-q`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        crossK: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-k`, shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
        crossV: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-v`, shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
        crossAttention: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-attention`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        crossProjected: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-projected`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        crossHidden: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-hidden`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        norm3: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.norm3`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        mlp1: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.mlp1`, shape: [shape.batch, shape.spatialTokens, shape.mlpHidden], dtype: 'f32', usage }),
        mlp2: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.mlp2`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        output: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.output`, shape: [shape.batch, shape.spatialTokens, shape.channels], dtype: 'f32', usage }),
        weights: {
          layerNorm1Weight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.layernorm1.weight`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          layerNorm1Bias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.layernorm1.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfQWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-q.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfQBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-q.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfKWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-k.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfKBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-k.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfVWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-v.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfVBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-v.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfOWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-o.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          selfOBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.self-o.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          layerNorm2Weight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.layernorm2.weight`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          layerNorm2Bias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.layernorm2.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossQWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-q.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossQBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-q.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossKWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-k.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossKBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-k.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossVWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-v.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossVBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-v.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossOWeight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-o.weight`, shape: [shape.channels, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          crossOBias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.cross-o.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          layerNorm3Weight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.layernorm3.weight`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          layerNorm3Bias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.layernorm3.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
          fc1Weight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.fc1.weight`, shape: [shape.mlpHidden, shape.channels], dtype: 'f32', usage: readonlyUsage }),
          fc1Bias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.fc1.bias`, shape: [shape.mlpHidden], dtype: 'f32', usage: readonlyUsage }),
          fc2Weight: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.fc2.weight`, shape: [shape.channels, shape.mlpHidden], dtype: 'f32', usage: readonlyUsage }),
          fc2Bias: stage.createTensor({ name: `sam3.detr-encoder.layer-${layerIndex}.fc2.bias`, shape: [shape.channels], dtype: 'f32', usage: readonlyUsage }),
        },
      };
      for (const [name, tensor] of Object.entries(layerTensors.weights)) stage.uploadTensor(tensor, layers[layerIndex][name]);
      tensors.layers.push(layerTensors);
    }
    await stage.yieldToBrowser({ reason: 'after-sam3-detr-encoder-upload' });
  }, { shape });

  const programTensors = {
    encoderSrc: tensors.encoderSrc,
    encoderPos: tensors.encoderPos,
    promptFeatures: tensors.promptFeatures,
    promptMask: tensors.promptMask,
  };
  const kernels = {};
  const phases = [];
  let currentHidden = 'encoderSrc';
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    const layer = tensors.layers[layerIndex];
    const layerKeys = {};
    for (const [name, tensor] of Object.entries(layer)) {
      if (name === 'weights') continue;
      const key = layerTensorName(layerIndex, name);
      layerKeys[name] = key;
      programTensors[key] = tensor;
    }
    for (const [name, tensor] of Object.entries(layer.weights)) {
      const key = layerTensorName(layerIndex, name);
      layerKeys[name] = key;
      programTensors[key] = tensor;
    }
    const kernelBase = `layer${layerIndex}`;
    const addLinearKernel = (name, code, bindings) => {
      kernels[`${kernelBase}${name}`] = { code, bindings };
    };
    addLinearKernel('LayerNorm1', LAYERNORM_WGSL, [{ name: 'input', resource: `tensor:${currentHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.layerNorm1Weight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.layerNorm1Bias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.norm1}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:layerNormDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('AddPos', ADD_WGSL, [{ name: 'a', resource: `tensor:${layerKeys.norm1}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'b', resource: 'tensor:encoderPos', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfInput}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:addDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('SelfQ', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.selfInput}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.selfQWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.selfQBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfQ}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:spatialLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('SelfK', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.selfInput}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.selfKWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.selfKBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfK}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:spatialLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('SelfV', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.norm1}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.selfVWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.selfVBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfV}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:spatialLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('SelfAttention', ATTENTION_WGSL, [{ name: 'q', resource: `tensor:${layerKeys.selfQ}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'k', resource: `tensor:${layerKeys.selfK}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'v', resource: `tensor:${layerKeys.selfV}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfAttention}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:selfAttentionDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('SelfOutput', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.selfAttention}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.selfOWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.selfOBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfProjected}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:spatialLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('SelfResidual', ADD_WGSL, [{ name: 'a', resource: `tensor:${currentHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'b', resource: `tensor:${layerKeys.selfProjected}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.selfHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:addDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('LayerNorm2', LAYERNORM_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.selfHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.layerNorm2Weight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.layerNorm2Bias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.norm2}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:layerNormDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('CrossQ', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.norm2}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.crossQWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.crossQBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.crossQ}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:spatialLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('CrossK', LINEAR_WGSL, [{ name: 'input', resource: 'tensor:promptFeatures', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.crossKWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.crossKBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.crossK}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:promptLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('CrossV', LINEAR_WGSL, [{ name: 'input', resource: 'tensor:promptFeatures', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.crossVWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.crossVBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.crossV}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:promptLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('CrossAttention', MASKED_ATTENTION_WGSL, [{ name: 'q', resource: `tensor:${layerKeys.crossQ}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'k', resource: `tensor:${layerKeys.crossK}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'v', resource: `tensor:${layerKeys.crossV}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'mask', resource: 'tensor:promptMask', visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.crossAttention}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:crossAttentionDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('CrossOutput', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.crossAttention}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.crossOWeight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.crossOBias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.crossProjected}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:spatialLinearDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('CrossResidual', ADD_WGSL, [{ name: 'a', resource: `tensor:${layerKeys.selfHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'b', resource: `tensor:${layerKeys.crossProjected}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.crossHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:addDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('LayerNorm3', LAYERNORM_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.crossHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.layerNorm3Weight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.layerNorm3Bias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.norm3}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:layerNormDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('MlpFc1Relu', LINEAR_RELU_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.norm3}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.fc1Weight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.fc1Bias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.mlp1}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:fc1Dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('MlpFc2', LINEAR_WGSL, [{ name: 'input', resource: `tensor:${layerKeys.mlp1}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'weight', resource: `tensor:${layerKeys.fc2Weight}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'bias', resource: `tensor:${layerKeys.fc2Bias}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.mlp2}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:fc2Dims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    addLinearKernel('MlpResidual', ADD_WGSL, [{ name: 'a', resource: `tensor:${layerKeys.crossHidden}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'b', resource: `tensor:${layerKeys.mlp2}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'read-only-storage' }, { name: 'output', resource: `tensor:${layerKeys.output}`, visibility: WEBGPU_SHADER_STAGE.compute, access: 'storage' }, { name: 'dims', resource: 'uniform:addDims', visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' }]);
    phases.push(
      { name: `detr-encoder-layernorm1-${layerIndex}`, kernel: `${kernelBase}LayerNorm1`, dispatch: [workgroups(spatialTokenCount)], yieldAfter: true },
      { name: `detr-encoder-add-pos-${layerIndex}`, kernel: `${kernelBase}AddPos`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-self-q-${layerIndex}`, kernel: `${kernelBase}SelfQ`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-self-k-${layerIndex}`, kernel: `${kernelBase}SelfK`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-self-v-${layerIndex}`, kernel: `${kernelBase}SelfV`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-self-attention-softmax-${layerIndex}`, kernel: `${kernelBase}SelfAttention`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-self-output-linear-${layerIndex}`, kernel: `${kernelBase}SelfOutput`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-self-output-residual-${layerIndex}`, kernel: `${kernelBase}SelfResidual`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-layernorm2-${layerIndex}`, kernel: `${kernelBase}LayerNorm2`, dispatch: [workgroups(spatialTokenCount)], yieldAfter: true },
      { name: `detr-encoder-cross-q-${layerIndex}`, kernel: `${kernelBase}CrossQ`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-cross-k-${layerIndex}`, kernel: `${kernelBase}CrossK`, dispatch: [workgroups(totalPrompt)], yieldAfter: true },
      { name: `detr-encoder-cross-v-${layerIndex}`, kernel: `${kernelBase}CrossV`, dispatch: [workgroups(totalPrompt)], yieldAfter: true },
      { name: `detr-encoder-cross-attention-softmax-${layerIndex}`, kernel: `${kernelBase}CrossAttention`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-cross-output-linear-${layerIndex}`, kernel: `${kernelBase}CrossOutput`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-cross-output-residual-${layerIndex}`, kernel: `${kernelBase}CrossResidual`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-layernorm3-${layerIndex}`, kernel: `${kernelBase}LayerNorm3`, dispatch: [workgroups(spatialTokenCount)], yieldAfter: true },
      { name: `detr-encoder-mlp-fc1-relu-${layerIndex}`, kernel: `${kernelBase}MlpFc1Relu`, dispatch: [workgroups(totalMlpHidden)], yieldAfter: true },
      { name: `detr-encoder-mlp-fc2-linear-${layerIndex}`, kernel: `${kernelBase}MlpFc2`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
      { name: `detr-encoder-mlp-fc2-residual-${layerIndex}`, kernel: `${kernelBase}MlpResidual`, dispatch: [workgroups(totalEncoder)], yieldAfter: true },
    );
    currentHidden = layerKeys.output;
  }
  phases.push({ name: 'readback-encoder-hidden-states', readbacks: [{ name: 'encoderHiddenStates', tensor: currentHidden }] });

  const program = runtime.defineProgram({
    name: 'sam3.detr-encoder-phase-program',
    tensors: programTensors,
    uniforms: {
      layerNormDims: tensors.layerNormDims,
      addDims: tensors.addDims,
      spatialLinearDims: tensors.spatialLinearDims,
      promptLinearDims: tensors.promptLinearDims,
      fc1Dims: tensors.fc1Dims,
      fc2Dims: tensors.fc2Dims,
      selfAttentionDims: tensors.selfAttentionDims,
      crossAttentionDims: tensors.crossAttentionDims,
    },
    kernels,
    phases,
    metadata: { routeId: SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID },
  });

  const run = await runtime.runProgram(program);
  const encoderHiddenStates = run.outputs.encoderHiddenStates;
  const outputs = {
    ...outputArtifacts(input.request, { encoderHiddenStates: await sha256Hex(encoderHiddenStates) }, outputShape),
  };
  const receipt = createSam3DetrEncoderPhaseProgramRouteReceipt({
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
      encoderHiddenStates: Array.from(new Float32Array(encoderHiddenStates)),
    };
  }
  return authoritative;
}

export { DETR_ENCODER_ROUTE_SOURCE_MARKERS };
