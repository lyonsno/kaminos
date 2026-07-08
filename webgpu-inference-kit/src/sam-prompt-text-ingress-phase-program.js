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

export const SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.prompt-text-ingress.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-prompt-text-ingress-phase-program-v0';
const REQUIRED_STAGES = [
  'load-prompt-text-tensors',
  'prompt-token-position-embedding',
  'prompt-text-final-layernorm',
  'prompt-text-projection',
  'prompt-mask-copy',
  'readback-prompt-text-ingress',
];
const INPUT_ROLES = ['source-image', 'sam3-prompt-text-tensors', 'sam3-prompt-text-weights'];
const OUTPUT_ROLES = [
  { key: 'promptFeatures', role: 'prompt-features', required: true },
  { key: 'promptMask', role: 'prompt-mask', required: true },
];

const EMBEDDING_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  hidden_size: u32,
  channels: u32,
  intermediate_size: u32,
  heads: u32,
  head_dim: u32,
  total_hidden: u32,
};

@group(0) @binding(0) var<storage, read> input_ids: array<u32>;
@group(0) @binding(1) var<storage, read> attention_mask: array<f32>;
@group(0) @binding(2) var<storage, read> token_embedding: array<f32>;
@group(0) @binding(3) var<storage, read> position_embedding: array<f32>;
@group(0) @binding(4) var<storage, read_write> hidden_out: array<f32>;
@group(0) @binding(5) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index < dims.total_hidden) {
    let hidden = index % dims.hidden_size;
    let token = (index / dims.hidden_size) % dims.prompt_tokens;
    hidden_out[index] = token_embedding[index] + position_embedding[token * dims.hidden_size + hidden];
  }
}
`;

const MASK_COPY_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  hidden_size: u32,
  channels: u32,
  intermediate_size: u32,
  heads: u32,
  head_dim: u32,
  total_hidden: u32,
};

@group(0) @binding(0) var<storage, read> attention_mask: array<f32>;
@group(0) @binding(1) var<storage, read_write> prompt_mask: array<f32>;
@group(0) @binding(2) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let mask_total = dims.batch * dims.prompt_tokens;
  if (index >= mask_total) { return; }
  prompt_mask[index] = attention_mask[index];
}
`;

const LAYER_NORM_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  hidden_size: u32,
  channels: u32,
  intermediate_size: u32,
  heads: u32,
  head_dim: u32,
  total_hidden: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  let rows = dims.batch * dims.prompt_tokens;
  if (row >= rows) { return; }
  let base = row * dims.hidden_size;
  var mean = 0.0;
  for (var c = 0u; c < dims.hidden_size; c = c + 1u) {
    mean = mean + input_values[base + c];
  }
  mean = mean / f32(dims.hidden_size);
  var variance = 0.0;
  for (var c = 0u; c < dims.hidden_size; c = c + 1u) {
    let delta = input_values[base + c] - mean;
    variance = variance + delta * delta;
  }
  variance = variance / f32(dims.hidden_size);
  let inv_std = inverseSqrt(variance + 0.00001);
  for (var c = 0u; c < dims.hidden_size; c = c + 1u) {
    output_values[base + c] = (input_values[base + c] - mean) * inv_std * norm_weight[c] + norm_bias[c];
  }
}
`;

const LINEAR_WGSL = `
struct LinearDims {
  rows: u32,
  in_channels: u32,
  out_channels: u32,
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
  let out_channel = index % dims.out_channels;
  let row = index / dims.out_channels;
  var sum = bias[out_channel];
  let input_base = row * dims.in_channels;
  let weight_base = out_channel * dims.in_channels;
  for (var c = 0u; c < dims.in_channels; c = c + 1u) {
    sum = sum + input_values[input_base + c] * weight[weight_base + c];
  }
  output_values[index] = sum;
}
`;

const ATTENTION_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  hidden_size: u32,
  channels: u32,
  intermediate_size: u32,
  heads: u32,
  head_dim: u32,
  total_hidden: u32,
};

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read> prompt_mask: array<f32>;
@group(0) @binding(4) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(5) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_hidden) { return; }
  let channel = index % dims.hidden_size;
  let token = (index / dims.hidden_size) % dims.prompt_tokens;
  let batch = index / (dims.prompt_tokens * dims.hidden_size);
  let head = channel / dims.head_dim;
  let dim_in_head = channel - head * dims.head_dim;
  let q_base = (batch * dims.prompt_tokens + token) * dims.hidden_size + head * dims.head_dim;
  let scale = inverseSqrt(f32(dims.head_dim));

  var max_score = -340282346638528859811704183484516925440.0;
  for (var key_token = 0u; key_token < dims.prompt_tokens; key_token = key_token + 1u) {
    var score = -1000000000.0;
    if (key_token <= token && prompt_mask[batch * dims.prompt_tokens + key_token] > 0.0) {
      score = 0.0;
      let k_base = (batch * dims.prompt_tokens + key_token) * dims.hidden_size + head * dims.head_dim;
      for (var d = 0u; d < dims.head_dim; d = d + 1u) {
        score = score + q_values[q_base + d] * k_values[k_base + d];
      }
      score = score * scale;
    }
    max_score = max(max_score, score);
  }

  var denom = 0.0;
  var value = 0.0;
  for (var key_token = 0u; key_token < dims.prompt_tokens; key_token = key_token + 1u) {
    var score = -1000000000.0;
    if (key_token <= token && prompt_mask[batch * dims.prompt_tokens + key_token] > 0.0) {
      score = 0.0;
      let k_base = (batch * dims.prompt_tokens + key_token) * dims.hidden_size + head * dims.head_dim;
      for (var d = 0u; d < dims.head_dim; d = d + 1u) {
        score = score + q_values[q_base + d] * k_values[k_base + d];
      }
      score = score * scale;
    }
    let attention = exp(score - max_score);
    let v_index = (batch * dims.prompt_tokens + key_token) * dims.hidden_size + head * dims.head_dim + dim_in_head;
    denom = denom + attention;
    value = value + attention * v_values[v_index];
  }
  output_values[index] = value / denom;
}
`;

const ADD_WGSL = `
struct TextDims {
  batch: u32,
  prompt_tokens: u32,
  hidden_size: u32,
  channels: u32,
  intermediate_size: u32,
  heads: u32,
  head_dim: u32,
  total_hidden: u32,
};

@group(0) @binding(0) var<storage, read> a_values: array<f32>;
@group(0) @binding(1) var<storage, read> b_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: TextDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_hidden) { return; }
  output_values[index] = a_values[index] + b_values[index];
}
`;

const GELU_WGSL = `
struct GeluDims {
  total_values: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: GeluDims;

fn erfApprox(value: f32) -> f32 {
  let sign = select(-1.0, 1.0, value >= 0.0);
  let x = abs(value);
  let t = 1.0 / (1.0 + 0.3275911 * x);
  let polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1.0 - polynomial * exp(-(x * x)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_values) { return; }
  let x = input_values[index];
  output_values[index] = 0.5 * x * (1.0 + erfApprox(x * 0.7071067811865476));
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-prompt-text-ingress' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-prompt-text-ingress' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-prompt-text-ingress' })),
      notes: 'SAM3 prompt/text ingress phase program cooperates across CLIP text encoder kernels and the prompt-feature readback boundary.',
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

function ensureUint32Array(value, name) {
  if (!(value instanceof Uint32Array)) throw new Error(`${name} must be a Uint32Array`);
  return value;
}

function normalizeShape(shape = {}) {
  const out = {
    batch: shape.batch,
    promptTokens: shape.promptTokens,
    hiddenSize: shape.hiddenSize,
    channels: shape.channels,
    intermediateSize: shape.intermediateSize,
    heads: shape.heads,
    layerCount: shape.layerCount,
    vocabSize: shape.vocabSize,
    maxPositionEmbeddings: shape.maxPositionEmbeddings,
  };
  for (const key of ['batch', 'promptTokens', 'hiddenSize', 'channels', 'intermediateSize', 'heads', 'layerCount', 'vocabSize', 'maxPositionEmbeddings']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (out.hiddenSize % out.heads !== 0) throw new Error('shape.hiddenSize must be divisible by shape.heads');
  if (out.promptTokens > out.maxPositionEmbeddings) throw new Error('shape.promptTokens must not exceed shape.maxPositionEmbeddings');
  return { ...out, headDim: out.hiddenSize / out.heads };
}

function validateLayerWeights(layer, shape, index) {
  const specs = [
    ['layerNorm1Weight', shape.hiddenSize],
    ['layerNorm1Bias', shape.hiddenSize],
    ['qWeight', shape.hiddenSize * shape.hiddenSize],
    ['qBias', shape.hiddenSize],
    ['kWeight', shape.hiddenSize * shape.hiddenSize],
    ['kBias', shape.hiddenSize],
    ['vWeight', shape.hiddenSize * shape.hiddenSize],
    ['vBias', shape.hiddenSize],
    ['oWeight', shape.hiddenSize * shape.hiddenSize],
    ['oBias', shape.hiddenSize],
    ['layerNorm2Weight', shape.hiddenSize],
    ['layerNorm2Bias', shape.hiddenSize],
    ['fc1Weight', shape.intermediateSize * shape.hiddenSize],
    ['fc1Bias', shape.intermediateSize],
    ['fc2Weight', shape.hiddenSize * shape.intermediateSize],
    ['fc2Bias', shape.hiddenSize],
  ];
  const out = {};
  for (const [key, expected] of specs) {
    const value = ensureFloat32Array(layer?.[key], `weights.layers.${index}.${key}`);
    if (value.length !== expected) throw new Error(`weights.layers.${index}.${key} length ${value.length} does not match ${expected}`);
    out[key] = value;
  }
  return out;
}

function validateInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const inputIds = ensureUint32Array(input.inputIds, 'inputIds');
  const attentionMask = ensureFloat32Array(input.attentionMask, 'attentionMask');
  if (inputIds.length !== shape.batch * shape.promptTokens) throw new Error('inputIds length does not match shape');
  if (attentionMask.length !== shape.batch * shape.promptTokens) throw new Error('attentionMask length does not match shape');
  const weights = input.weights || {};
  const tokenEmbeddingWeight = ensureFloat32Array(weights.tokenEmbeddingWeight, 'weights.tokenEmbeddingWeight');
  const positionEmbeddingWeight = ensureFloat32Array(weights.positionEmbeddingWeight, 'weights.positionEmbeddingWeight');
  const finalLayerNormWeight = ensureFloat32Array(weights.finalLayerNormWeight, 'weights.finalLayerNormWeight');
  const finalLayerNormBias = ensureFloat32Array(weights.finalLayerNormBias, 'weights.finalLayerNormBias');
  const textProjectionWeight = ensureFloat32Array(weights.textProjectionWeight, 'weights.textProjectionWeight');
  const textProjectionBias = weights.textProjectionBias instanceof Float32Array ? weights.textProjectionBias : new Float32Array(shape.channels);
  if (tokenEmbeddingWeight.length !== shape.vocabSize * shape.hiddenSize) throw new Error('weights.tokenEmbeddingWeight length does not match shape');
  if (positionEmbeddingWeight.length !== shape.maxPositionEmbeddings * shape.hiddenSize) throw new Error('weights.positionEmbeddingWeight length does not match shape');
  if (finalLayerNormWeight.length !== shape.hiddenSize || finalLayerNormBias.length !== shape.hiddenSize) throw new Error('final layernorm weights do not match hidden size');
  if (textProjectionWeight.length !== shape.channels * shape.hiddenSize) throw new Error('weights.textProjectionWeight length does not match shape');
  if (textProjectionBias.length !== shape.channels) throw new Error('weights.textProjectionBias length does not match channels');
  if (!Array.isArray(weights.layers) || weights.layers.length !== shape.layerCount) throw new Error('weights.layers length must match shape.layerCount');
  return {
    shape,
    inputIds,
    attentionMask,
    weights: {
      tokenEmbeddingWeight,
      positionEmbeddingWeight,
      finalLayerNormWeight,
      finalLayerNormBias,
      textProjectionWeight,
      textProjectionBias,
      layers: weights.layers.map((layer, index) => validateLayerWeights(layer, shape, index)),
    },
  };
}

function gatherPromptTokenEmbeddings(inputIds, tokenEmbeddingWeight, shape) {
  const out = new Float32Array(shape.batch * shape.promptTokens * shape.hiddenSize);
  for (let row = 0; row < shape.batch * shape.promptTokens; row += 1) {
    const tokenId = inputIds[row];
    if (tokenId >= shape.vocabSize) throw new Error(`inputIds[${row}] ${tokenId} exceeds shape.vocabSize ${shape.vocabSize}`);
    const sourceBase = tokenId * shape.hiddenSize;
    const targetBase = row * shape.hiddenSize;
    for (let c = 0; c < shape.hiddenSize; c += 1) out[targetBase + c] = tokenEmbeddingWeight[sourceBase + c];
  }
  return out;
}

function layerNorm(values, weight, bias, rows, channels) {
  const out = new Float32Array(values.length);
  for (let row = 0; row < rows; row += 1) {
    const base = row * channels;
    let mean = 0;
    for (let c = 0; c < channels; c += 1) mean += values[base + c];
    mean /= channels;
    let variance = 0;
    for (let c = 0; c < channels; c += 1) {
      const delta = values[base + c] - mean;
      variance += delta * delta;
    }
    const invStd = 1 / Math.sqrt(variance / channels + 1e-5);
    for (let c = 0; c < channels; c += 1) out[base + c] = (values[base + c] - mean) * invStd * weight[c] + bias[c];
  }
  return out;
}

function linear(values, weight, bias, rows, inChannels, outChannels) {
  const out = new Float32Array(rows * outChannels);
  for (let row = 0; row < rows; row += 1) {
    for (let outChannel = 0; outChannel < outChannels; outChannel += 1) {
      let sum = bias[outChannel];
      for (let c = 0; c < inChannels; c += 1) {
        sum += values[row * inChannels + c] * weight[outChannel * inChannels + c];
      }
      out[row * outChannels + outChannel] = sum;
    }
  }
  return out;
}

function gelu(values) {
  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const x = values[index];
    out[index] = 0.5 * x * (1 + erfApprox(x * Math.SQRT1_2));
  }
  return out;
}

function erfApprox(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-(x * x)));
}

function causalAttention(q, k, v, promptMask, shape) {
  const out = new Float32Array(q.length);
  const scale = 1 / Math.sqrt(shape.headDim);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let token = 0; token < shape.promptTokens; token += 1) {
      for (let head = 0; head < shape.heads; head += 1) {
        for (let dim = 0; dim < shape.headDim; dim += 1) {
          let maxScore = -1e9;
          for (let keyToken = 0; keyToken < shape.promptTokens; keyToken += 1) {
            let score = -1e9;
            if (keyToken <= token && promptMask[batch * shape.promptTokens + keyToken] > 0) {
              score = 0;
              for (let d = 0; d < shape.headDim; d += 1) {
                const qIndex = ((batch * shape.promptTokens + token) * shape.hiddenSize) + head * shape.headDim + d;
                const kIndex = ((batch * shape.promptTokens + keyToken) * shape.hiddenSize) + head * shape.headDim + d;
                score += q[qIndex] * k[kIndex];
              }
              score *= scale;
            }
            maxScore = Math.max(maxScore, score);
          }
          let denom = 0;
          let value = 0;
          for (let keyToken = 0; keyToken < shape.promptTokens; keyToken += 1) {
            let score = -1e9;
            if (keyToken <= token && promptMask[batch * shape.promptTokens + keyToken] > 0) {
              score = 0;
              for (let d = 0; d < shape.headDim; d += 1) {
                const qIndex = ((batch * shape.promptTokens + token) * shape.hiddenSize) + head * shape.headDim + d;
                const kIndex = ((batch * shape.promptTokens + keyToken) * shape.hiddenSize) + head * shape.headDim + d;
                score += q[qIndex] * k[kIndex];
              }
              score *= scale;
            }
            const attention = Math.exp(score - maxScore);
            const vIndex = ((batch * shape.promptTokens + keyToken) * shape.hiddenSize) + head * shape.headDim + dim;
            denom += attention;
            value += attention * v[vIndex];
          }
          const outIndex = ((batch * shape.promptTokens + token) * shape.hiddenSize) + head * shape.headDim + dim;
          out[outIndex] = value / denom;
        }
      }
    }
  }
  return out;
}

export function createSam3PromptTextIngressPhaseProgramCpuOracle(input) {
  const { shape, inputIds, attentionMask, weights } = validateInputs(input);
  const rows = shape.batch * shape.promptTokens;
  const hidden = new Float32Array(rows * shape.hiddenSize);
  for (let row = 0; row < rows; row += 1) {
    const token = row % shape.promptTokens;
    const tokenId = inputIds[row];
    for (let c = 0; c < shape.hiddenSize; c += 1) {
      hidden[row * shape.hiddenSize + c] = weights.tokenEmbeddingWeight[tokenId * shape.hiddenSize + c] + weights.positionEmbeddingWeight[token * shape.hiddenSize + c];
    }
  }
  let current = hidden;
  for (const layer of weights.layers) {
    const ln1 = layerNorm(current, layer.layerNorm1Weight, layer.layerNorm1Bias, rows, shape.hiddenSize);
    const q = linear(ln1, layer.qWeight, layer.qBias, rows, shape.hiddenSize, shape.hiddenSize);
    const k = linear(ln1, layer.kWeight, layer.kBias, rows, shape.hiddenSize, shape.hiddenSize);
    const v = linear(ln1, layer.vWeight, layer.vBias, rows, shape.hiddenSize, shape.hiddenSize);
    const attn = causalAttention(q, k, v, attentionMask, shape);
    const o = linear(attn, layer.oWeight, layer.oBias, rows, shape.hiddenSize, shape.hiddenSize);
    const residual1 = new Float32Array(current.length);
    for (let index = 0; index < residual1.length; index += 1) residual1[index] = current[index] + o[index];
    const ln2 = layerNorm(residual1, layer.layerNorm2Weight, layer.layerNorm2Bias, rows, shape.hiddenSize);
    const fc1 = gelu(linear(ln2, layer.fc1Weight, layer.fc1Bias, rows, shape.hiddenSize, shape.intermediateSize));
    const fc2 = linear(fc1, layer.fc2Weight, layer.fc2Bias, rows, shape.intermediateSize, shape.hiddenSize);
    current = new Float32Array(residual1.length);
    for (let index = 0; index < current.length; index += 1) current[index] = residual1[index] + fc2[index];
  }
  const finalHidden = layerNorm(current, weights.finalLayerNormWeight, weights.finalLayerNormBias, rows, shape.hiddenSize);
  const promptFeatures = linear(finalHidden, weights.textProjectionWeight, weights.textProjectionBias, rows, shape.hiddenSize, shape.channels);
  return { shape, promptFeatures, promptMask: new Float32Array(attentionMask) };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM prompt/text ingress outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    promptFeatures: {
      artifactId: roleArtifact(request.outputs, 'prompt-features').artifactId,
      sha256: hashes.promptFeatures,
      shape: [shape.batch, shape.promptTokens, shape.channels],
    },
    promptMask: {
      artifactId: roleArtifact(request.outputs, 'prompt-mask').artifactId,
      sha256: hashes.promptMask,
      shape: [shape.batch, shape.promptTokens],
    },
  };
}

export function createSam3PromptTextIngressPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash || 'unknown', dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-prompt-text-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-prompt-text-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3PromptTextIngressPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-prompt-text-ingress', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3PromptTextIngressPhaseProgramRoute', upstreamBoundary: 'browser-prompt-input-ids-to-projected-text-features' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

function linearDims(stage, label, rows, inChannels, outChannels) {
  return stage.createUniformBuffer({
    label,
    schema: [
      { name: 'rows', type: 'u32' },
      { name: 'in_channels', type: 'u32' },
      { name: 'out_channels', type: 'u32' },
      { name: 'total_output', type: 'u32' },
    ],
    values: { rows, in_channels: inChannels, out_channels: outChannels, total_output: rows * outChannels },
  });
}

function tensorBinding(name, resource, access = 'read-only-storage') {
  return { name, resource, visibility: WEBGPU_SHADER_STAGE.compute, access };
}

function uniformBinding(name, resource) {
  return { name, resource, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' };
}

export async function runSam3PromptTextIngressPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3PromptTextIngressPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-prompt-text-tensors');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-prompt-text-weights');
  const { shape, inputIds, attentionMask, weights } = validateInputs(input.tensors || {});
  const rows = shape.batch * shape.promptTokens;
  const totalHidden = rows * shape.hiddenSize;
  const totalIntermediate = rows * shape.intermediateSize;
  const totalPromptFeatures = rows * shape.channels;
  const promptTokenEmbeddingRows = gatherPromptTokenEmbeddings(inputIds, weights.tokenEmbeddingWeight, shape);

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-prompt-text-ingress-phase-program',
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
  await runtime.runStage('load-prompt-text-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const createWeightTensor = (name, value, shapeValue) => {
      const tensor = stage.createTensor({ name, shape: shapeValue, dtype: 'f32', usage: readonlyUsage });
      stage.uploadTensor(tensor, value);
      return tensor;
    };
    tensors = {
      inputIds: stage.createTensor({ name: 'sam3.prompt-text.input-ids', shape: [shape.batch, shape.promptTokens], dtype: 'u32', usage: readonlyUsage }),
      attentionMask: stage.createTensor({ name: 'sam3.prompt-text.attention-mask', shape: [shape.batch, shape.promptTokens], dtype: 'f32', usage: readonlyUsage }),
      tokenEmbeddingWeight: createWeightTensor('sam3.prompt-text.token-embedding-rows', promptTokenEmbeddingRows, [shape.batch, shape.promptTokens, shape.hiddenSize]),
      positionEmbeddingWeight: createWeightTensor('sam3.prompt-text.position-embedding-weight', weights.positionEmbeddingWeight, [shape.maxPositionEmbeddings, shape.hiddenSize]),
      hiddenA: stage.createTensor({ name: 'sam3.prompt-text.hidden-a', shape: [shape.batch, shape.promptTokens, shape.hiddenSize], dtype: 'f32', usage }),
      hiddenB: stage.createTensor({ name: 'sam3.prompt-text.hidden-b', shape: [shape.batch, shape.promptTokens, shape.hiddenSize], dtype: 'f32', usage }),
      q: stage.createTensor({ name: 'sam3.prompt-text.q', shape: [shape.batch, shape.promptTokens, shape.hiddenSize], dtype: 'f32', usage }),
      k: stage.createTensor({ name: 'sam3.prompt-text.k', shape: [shape.batch, shape.promptTokens, shape.hiddenSize], dtype: 'f32', usage }),
      v: stage.createTensor({ name: 'sam3.prompt-text.v', shape: [shape.batch, shape.promptTokens, shape.hiddenSize], dtype: 'f32', usage }),
      attn: stage.createTensor({ name: 'sam3.prompt-text.attn', shape: [shape.batch, shape.promptTokens, shape.hiddenSize], dtype: 'f32', usage }),
      mlp: stage.createTensor({ name: 'sam3.prompt-text.mlp', shape: [shape.batch, shape.promptTokens, shape.intermediateSize], dtype: 'f32', usage }),
      mlpGelu: stage.createTensor({ name: 'sam3.prompt-text.mlp-gelu', shape: [shape.batch, shape.promptTokens, shape.intermediateSize], dtype: 'f32', usage }),
      promptFeatures: stage.createTensor({ name: 'sam3.prompt-text.prompt-features', shape: [shape.batch, shape.promptTokens, shape.channels], dtype: 'f32', usage }),
      promptMask: stage.createTensor({ name: 'sam3.prompt-text.prompt-mask', shape: [shape.batch, shape.promptTokens], dtype: 'f32', usage }),
      finalLayerNormWeight: createWeightTensor('sam3.prompt-text.final-layernorm-weight', weights.finalLayerNormWeight, [shape.hiddenSize]),
      finalLayerNormBias: createWeightTensor('sam3.prompt-text.final-layernorm-bias', weights.finalLayerNormBias, [shape.hiddenSize]),
      textProjectionWeight: createWeightTensor('sam3.prompt-text.text-projection-weight', weights.textProjectionWeight, [shape.channels, shape.hiddenSize]),
      textProjectionBias: createWeightTensor('sam3.prompt-text.text-projection-bias', weights.textProjectionBias, [shape.channels]),
      textDims: stage.createUniformBuffer({
        label: 'sam3.prompt-text.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'prompt_tokens', type: 'u32' },
          { name: 'hidden_size', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'intermediate_size', type: 'u32' },
          { name: 'heads', type: 'u32' },
          { name: 'head_dim', type: 'u32' },
          { name: 'total_hidden', type: 'u32' },
        ],
        values: { batch: shape.batch, prompt_tokens: shape.promptTokens, hidden_size: shape.hiddenSize, channels: shape.channels, intermediate_size: shape.intermediateSize, heads: shape.heads, head_dim: shape.headDim, total_hidden: totalHidden },
      }),
      hiddenHiddenDims: linearDims(stage, 'sam3.prompt-text.hidden-hidden-dims', rows, shape.hiddenSize, shape.hiddenSize),
      hiddenIntermediateDims: linearDims(stage, 'sam3.prompt-text.hidden-intermediate-dims', rows, shape.hiddenSize, shape.intermediateSize),
      intermediateHiddenDims: linearDims(stage, 'sam3.prompt-text.intermediate-hidden-dims', rows, shape.intermediateSize, shape.hiddenSize),
      hiddenChannelsDims: linearDims(stage, 'sam3.prompt-text.hidden-channels-dims', rows, shape.hiddenSize, shape.channels),
      geluDims: stage.createUniformBuffer({
        label: 'sam3.prompt-text.gelu-dims',
        schema: [
          { name: 'total_values', type: 'u32' },
          { name: '_pad0', type: 'u32' },
          { name: '_pad1', type: 'u32' },
          { name: '_pad2', type: 'u32' },
        ],
        values: { total_values: totalIntermediate, _pad0: 0, _pad1: 0, _pad2: 0 },
      }),
      layers: [],
    };
    stage.uploadTensor(tensors.inputIds, inputIds);
    stage.uploadTensor(tensors.attentionMask, attentionMask);
    for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
      const layer = weights.layers[layerIndex];
      tensors.layers.push({
        layerNorm1Weight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.layernorm1-weight`, layer.layerNorm1Weight, [shape.hiddenSize]),
        layerNorm1Bias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.layernorm1-bias`, layer.layerNorm1Bias, [shape.hiddenSize]),
        qWeight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.q-weight`, layer.qWeight, [shape.hiddenSize, shape.hiddenSize]),
        qBias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.q-bias`, layer.qBias, [shape.hiddenSize]),
        kWeight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.k-weight`, layer.kWeight, [shape.hiddenSize, shape.hiddenSize]),
        kBias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.k-bias`, layer.kBias, [shape.hiddenSize]),
        vWeight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.v-weight`, layer.vWeight, [shape.hiddenSize, shape.hiddenSize]),
        vBias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.v-bias`, layer.vBias, [shape.hiddenSize]),
        oWeight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.o-weight`, layer.oWeight, [shape.hiddenSize, shape.hiddenSize]),
        oBias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.o-bias`, layer.oBias, [shape.hiddenSize]),
        layerNorm2Weight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.layernorm2-weight`, layer.layerNorm2Weight, [shape.hiddenSize]),
        layerNorm2Bias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.layernorm2-bias`, layer.layerNorm2Bias, [shape.hiddenSize]),
        fc1Weight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.fc1-weight`, layer.fc1Weight, [shape.intermediateSize, shape.hiddenSize]),
        fc1Bias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.fc1-bias`, layer.fc1Bias, [shape.intermediateSize]),
        fc2Weight: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.fc2-weight`, layer.fc2Weight, [shape.hiddenSize, shape.intermediateSize]),
        fc2Bias: createWeightTensor(`sam3.prompt-text.layer${layerIndex}.fc2-bias`, layer.fc2Bias, [shape.hiddenSize]),
      });
    }
    await stage.yieldToBrowser({ reason: 'after-sam3-prompt-text-upload' });
  }, { shape });

  const kernels = {
    embedding: {
      code: EMBEDDING_WGSL,
      bindings: [
        tensorBinding('inputIds', 'tensor:inputIds'),
        tensorBinding('attentionMask', 'tensor:attentionMask'),
        tensorBinding('tokenEmbedding', 'tensor:tokenEmbeddingWeight'),
        tensorBinding('positionEmbedding', 'tensor:positionEmbeddingWeight'),
        tensorBinding('hiddenOut', 'tensor:hiddenA', 'storage'),
        uniformBinding('dims', 'uniform:textDims'),
      ],
    },
    maskCopy: {
      code: MASK_COPY_WGSL,
      bindings: [
        tensorBinding('attentionMask', 'tensor:attentionMask'),
        tensorBinding('promptMask', 'tensor:promptMask', 'storage'),
        uniformBinding('dims', 'uniform:textDims'),
      ],
    },
    finalLayerNorm: {
      code: LAYER_NORM_WGSL,
      bindings: [
        tensorBinding('inputValues', 'tensor:hiddenA'),
        tensorBinding('normWeight', 'tensor:finalLayerNormWeight'),
        tensorBinding('normBias', 'tensor:finalLayerNormBias'),
        tensorBinding('outputValues', 'tensor:hiddenB', 'storage'),
        uniformBinding('dims', 'uniform:textDims'),
      ],
    },
    projection: {
      code: LINEAR_WGSL,
      bindings: [
        tensorBinding('inputValues', 'tensor:hiddenB'),
        tensorBinding('weight', 'tensor:textProjectionWeight'),
        tensorBinding('bias', 'tensor:textProjectionBias'),
        tensorBinding('outputValues', 'tensor:promptFeatures', 'storage'),
        uniformBinding('dims', 'uniform:hiddenChannelsDims'),
      ],
    },
  };
  const phases = [
    { name: 'prompt-token-position-embedding', kernel: 'embedding', dispatch: [workgroups(Math.max(totalHidden, rows))], yieldAfter: true },
    { name: 'prompt-mask-copy', kernel: 'maskCopy', dispatch: [workgroups(rows)], yieldAfter: true },
  ];

  const registerLayerKernel = (name, code, bindings) => {
    kernels[name] = { code, bindings };
  };
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    const prefix = `layer${layerIndex}`;
    const resources = tensors.layers[layerIndex];
    registerLayerKernel(`${prefix}.ln1`, LAYER_NORM_WGSL, [
      tensorBinding('inputValues', 'tensor:hiddenA'),
      tensorBinding('normWeight', resources.layerNorm1Weight),
      tensorBinding('normBias', resources.layerNorm1Bias),
      tensorBinding('outputValues', 'tensor:hiddenB', 'storage'),
      uniformBinding('dims', 'uniform:textDims'),
    ]);
    for (const projection of ['q', 'k', 'v']) {
      registerLayerKernel(`${prefix}.${projection}`, LINEAR_WGSL, [
        tensorBinding('inputValues', 'tensor:hiddenB'),
        tensorBinding('weight', resources[`${projection}Weight`]),
        tensorBinding('bias', resources[`${projection}Bias`]),
        tensorBinding('outputValues', `tensor:${projection}`, 'storage'),
        uniformBinding('dims', 'uniform:hiddenHiddenDims'),
      ]);
    }
    registerLayerKernel(`${prefix}.attention`, ATTENTION_WGSL, [
      tensorBinding('qValues', 'tensor:q'),
      tensorBinding('kValues', 'tensor:k'),
      tensorBinding('vValues', 'tensor:v'),
      tensorBinding('promptMask', 'tensor:promptMask'),
      tensorBinding('outputValues', 'tensor:attn', 'storage'),
      uniformBinding('dims', 'uniform:textDims'),
    ]);
    registerLayerKernel(`${prefix}.out`, LINEAR_WGSL, [
      tensorBinding('inputValues', 'tensor:attn'),
      tensorBinding('weight', resources.oWeight),
      tensorBinding('bias', resources.oBias),
      tensorBinding('outputValues', 'tensor:hiddenB', 'storage'),
      uniformBinding('dims', 'uniform:hiddenHiddenDims'),
    ]);
    registerLayerKernel(`${prefix}.add1`, ADD_WGSL, [
      tensorBinding('aValues', 'tensor:hiddenA'),
      tensorBinding('bValues', 'tensor:hiddenB'),
      tensorBinding('outputValues', 'tensor:attn', 'storage'),
      uniformBinding('dims', 'uniform:textDims'),
    ]);
    registerLayerKernel(`${prefix}.ln2`, LAYER_NORM_WGSL, [
      tensorBinding('inputValues', 'tensor:attn'),
      tensorBinding('normWeight', resources.layerNorm2Weight),
      tensorBinding('normBias', resources.layerNorm2Bias),
      tensorBinding('outputValues', 'tensor:hiddenB', 'storage'),
      uniformBinding('dims', 'uniform:textDims'),
    ]);
    registerLayerKernel(`${prefix}.fc1`, LINEAR_WGSL, [
      tensorBinding('inputValues', 'tensor:hiddenB'),
      tensorBinding('weight', resources.fc1Weight),
      tensorBinding('bias', resources.fc1Bias),
      tensorBinding('outputValues', 'tensor:mlp', 'storage'),
      uniformBinding('dims', 'uniform:hiddenIntermediateDims'),
    ]);
    registerLayerKernel(`${prefix}.gelu`, GELU_WGSL, [
      tensorBinding('inputValues', 'tensor:mlp'),
      tensorBinding('outputValues', 'tensor:mlpGelu', 'storage'),
      uniformBinding('dims', 'uniform:geluDims'),
    ]);
    registerLayerKernel(`${prefix}.fc2`, LINEAR_WGSL, [
      tensorBinding('inputValues', 'tensor:mlpGelu'),
      tensorBinding('weight', resources.fc2Weight),
      tensorBinding('bias', resources.fc2Bias),
      tensorBinding('outputValues', 'tensor:hiddenB', 'storage'),
      uniformBinding('dims', 'uniform:intermediateHiddenDims'),
    ]);
    registerLayerKernel(`${prefix}.add2`, ADD_WGSL, [
      tensorBinding('aValues', 'tensor:attn'),
      tensorBinding('bValues', 'tensor:hiddenB'),
      tensorBinding('outputValues', 'tensor:hiddenA', 'storage'),
      uniformBinding('dims', 'uniform:textDims'),
    ]);
    phases.push(
      { name: `prompt-text-layernorm1-${layerIndex}`, kernel: `${prefix}.ln1`, dispatch: [workgroups(rows)], yieldAfter: true },
      { name: `prompt-text-qkv-q-${layerIndex}`, kernel: `${prefix}.q`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-qkv-k-${layerIndex}`, kernel: `${prefix}.k`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-qkv-v-${layerIndex}`, kernel: `${prefix}.v`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-causal-attention-${layerIndex}`, kernel: `${prefix}.attention`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-output-residual-${layerIndex}`, kernel: `${prefix}.out`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-output-add-${layerIndex}`, kernel: `${prefix}.add1`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-layernorm2-${layerIndex}`, kernel: `${prefix}.ln2`, dispatch: [workgroups(rows)], yieldAfter: true },
      { name: `prompt-text-mlp-fc1-${layerIndex}`, kernel: `${prefix}.fc1`, dispatch: [workgroups(totalIntermediate)], yieldAfter: true },
      { name: `prompt-text-mlp-gelu-${layerIndex}`, kernel: `${prefix}.gelu`, dispatch: [workgroups(totalIntermediate)], yieldAfter: true },
      { name: `prompt-text-mlp-fc2-${layerIndex}`, kernel: `${prefix}.fc2`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
      { name: `prompt-text-mlp-residual-${layerIndex}`, kernel: `${prefix}.add2`, dispatch: [workgroups(totalHidden)], yieldAfter: true },
    );
  }
  phases.push(
    { name: 'prompt-text-final-layernorm', kernel: 'finalLayerNorm', dispatch: [workgroups(rows)], yieldAfter: true },
    { name: 'prompt-text-projection', kernel: 'projection', dispatch: [workgroups(totalPromptFeatures)], yieldAfter: true },
    { name: 'readback-prompt-text-ingress', readbacks: [{ name: 'promptFeatures', tensor: 'promptFeatures' }, { name: 'promptMask', tensor: 'promptMask' }] },
  );

  const program = runtime.defineProgram({
    name: 'sam3.prompt-text-ingress-phase-program',
    tensors: {
      inputIds: tensors.inputIds,
      attentionMask: tensors.attentionMask,
      tokenEmbeddingWeight: tensors.tokenEmbeddingWeight,
      positionEmbeddingWeight: tensors.positionEmbeddingWeight,
      hiddenA: tensors.hiddenA,
      hiddenB: tensors.hiddenB,
      q: tensors.q,
      k: tensors.k,
      v: tensors.v,
      attn: tensors.attn,
      mlp: tensors.mlp,
      mlpGelu: tensors.mlpGelu,
      promptFeatures: tensors.promptFeatures,
      promptMask: tensors.promptMask,
      finalLayerNormWeight: tensors.finalLayerNormWeight,
      finalLayerNormBias: tensors.finalLayerNormBias,
      textProjectionWeight: tensors.textProjectionWeight,
      textProjectionBias: tensors.textProjectionBias,
    },
    uniforms: {
      textDims: tensors.textDims,
      hiddenHiddenDims: tensors.hiddenHiddenDims,
      hiddenIntermediateDims: tensors.hiddenIntermediateDims,
      intermediateHiddenDims: tensors.intermediateHiddenDims,
      hiddenChannelsDims: tensors.hiddenChannelsDims,
      geluDims: tensors.geluDims,
    },
    kernels,
    phases,
    metadata: { routeId: SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    promptFeatures: await sha256Hex(run.outputs.promptFeatures),
    promptMask: await sha256Hex(run.outputs.promptMask),
  }, shape);
  const receipt = createSam3PromptTextIngressPhaseProgramRouteReceipt({
    sourceImage,
    tensorPacket,
    weights: weightsArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash || weightsArtifact.sha256, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      promptFeatures: Array.from(new Float32Array(run.outputs.promptFeatures)),
      promptMask: Array.from(new Float32Array(run.outputs.promptMask)),
    };
  }
  return authoritative;
}
