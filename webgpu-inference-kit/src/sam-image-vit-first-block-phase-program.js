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

export const SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-vit-first-block.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-vit-first-block-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-vit-first-block-tensors',
  'vit-block-layernorm1',
  'vit-block-window-partition',
  'vit-block-qkv-projection',
  'vit-block-rope-attention',
  'vit-block-output-projection',
  'vit-block-window-unpartition',
  'vit-block-layernorm2',
  'vit-block-gelu-mlp',
  'readback-vit-first-block-hidden-states',
];
const INPUT_ROLES = ['source-image', 'vit-prefix-hidden-states', 'sam3-image-vit-first-block-weights'];
const OUTPUT_ROLES = [
  { key: 'vitFirstBlockHiddenStates', role: 'vit-first-block-hidden-states', required: true },
];

const LAYERNORM_WGSL = `
struct LnDims {
  token_count: u32,
  channels: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> norm_weight: array<f32>;
@group(0) @binding(2) var<storage, read> norm_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LnDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let token = gid.x;
  if (token >= dims.token_count) { return; }
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

const WINDOW_PARTITION_WGSL = `
struct BlockDims {
  batch: u32,
  height: u32,
  width: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  window_size: u32,
  intermediate_size: u32,
  padded_height: u32,
  padded_width: u32,
  windows_per_row: u32,
  window_count: u32,
  window_tokens: u32,
  total_values: u32,
  padded_total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> windows: array<f32>;
@group(0) @binding(2) var<uniform> dims: BlockDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.padded_total_values) { return; }
  let c = index % dims.channels;
  let token = index / dims.channels;
  let local_token = token % dims.window_tokens;
  let window_index = token / dims.window_tokens;
  let local_y = local_token / dims.window_size;
  let local_x = local_token % dims.window_size;
  let batch = window_index / dims.window_count;
  let window_in_batch = window_index % dims.window_count;
  let window_y = window_in_batch / dims.windows_per_row;
  let window_x = window_in_batch % dims.windows_per_row;
  let source_y = window_y * dims.window_size + local_y;
  let source_x = window_x * dims.window_size + local_x;
  if (source_y < dims.height && source_x < dims.width) {
    let source_index = (((batch * dims.height + source_y) * dims.width + source_x) * dims.channels) + c;
    windows[index] = input_values[source_index];
  } else {
    windows[index] = 0.0;
  }
}
`;

const WINDOW_UNPARTITION_WGSL = `
struct BlockDims {
  batch: u32,
  height: u32,
  width: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  window_size: u32,
  intermediate_size: u32,
  padded_height: u32,
  padded_width: u32,
  windows_per_row: u32,
  window_count: u32,
  window_tokens: u32,
  total_values: u32,
  padded_total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> windows: array<f32>;
@group(0) @binding(1) var<storage, read> residual: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: BlockDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_values) { return; }
  let c = index % dims.channels;
  let token = index / dims.channels;
  let x = token % dims.width;
  let y = (token / dims.width) % dims.height;
  let batch = token / (dims.height * dims.width);
  let window_y = y / dims.window_size;
  let window_x = x / dims.window_size;
  let local_y = y % dims.window_size;
  let local_x = x % dims.window_size;
  let window_index = batch * dims.window_count + window_y * dims.windows_per_row + window_x;
  let window_token = local_y * dims.window_size + local_x;
  let window_flat = (window_index * dims.window_tokens + window_token) * dims.channels + c;
  output_values[index] = residual[index] + windows[window_flat];
}
`;

const LINEAR_WGSL = `
struct LinearDims {
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
  _pad0: u32,
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
  let weight_base = output_channel * dims.input_channels;
  var sum = bias[output_channel];
  for (var c = 0u; c < dims.input_channels; c = c + 1u) {
    sum = sum + input_values[input_base + c] * weight[weight_base + c];
  }
  output_values[index] = sum;
}
`;

const LINEAR_GELU_WGSL = `
struct LinearDims {
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;

fn mlx_expm1f(x: f32) -> f32 {
  var j = fma(1.442695, x, 12582912.0);
  j = j - 12582912.0;
  let exponent = i32(j);
  let reduced = fma(j, -6.93145752e-1, x);
  var squared = reduced * reduced;
  if (x == 0.0) { squared = x; }
  var polynomial = 1.97350979e-4;
  polynomial = fma(polynomial, reduced, 1.39309070e-3);
  polynomial = fma(polynomial, reduced, 8.33343994e-3);
  polynomial = fma(polynomial, reduced, 4.16668020e-2);
  polynomial = fma(polynomial, reduced, 1.66666716e-1);
  polynomial = fma(polynomial, reduced, 4.99999970e-1);
  let base = select(reduced, reduced + 0.5, j == 1.0);
  let approximation = fma(polynomial, squared, base);
  let half = 0.5;
  let scaled = ldexp(half, exponent);
  let high = scaled - half;
  let low = (scaled - high) - half;
  var result = fma(approximation, scaled, low) + high;
  result = result + result;
  if (j == 0.0) { result = approximation; }
  if (j == 1.0) { result = approximation + approximation; }
  if (abs(x - 1.0) > 88.0) {
    let power = exp2(x);
    result = fma(power, power, -1.0);
  }
  return result;
}

fn mlx_erf(x: f32) -> f32 {
  let magnitude = abs(x);
  let squared = x * x;
  var result: f32;
  if (magnitude > 0.927734375) {
    result = fma(-1.72853470e-5, magnitude, 3.83197126e-4);
    let companion = fma(-3.88396438e-3, magnitude, 2.42546219e-2);
    result = fma(result, squared, companion);
    result = fma(result, magnitude, -1.06777877e-1);
    result = fma(result, magnitude, -6.34846687e-1);
    result = fma(result, magnitude, -1.28717512e-1);
    result = fma(result, magnitude, -magnitude);
    result = -mlx_expm1f(result);
    result = select(-abs(result), abs(result), x >= 0.0);
  } else {
    result = -5.96761703e-4;
    result = fma(result, squared, 4.99119423e-3);
    result = fma(result, squared, -2.67681349e-2);
    result = fma(result, squared, 1.12819925e-1);
    result = fma(result, squared, -3.76125336e-1);
    result = fma(result, squared, 1.28379166e-1);
    result = fma(result, x, x);
  }
  return result;
}

fn gelu_exact_approx(x: f32) -> f32 {
  if (x < -10.0) { return 0.0; }
  if (x > 10.0) { return x; }
  return 0.5 * x * (1.0 + mlx_erf(x * 0.7071067811865476));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let output_channel = index % dims.output_channels;
  let token = index / dims.output_channels;
  let input_base = token * dims.input_channels;
  let weight_base = output_channel * dims.input_channels;
  var sum = bias[output_channel];
  for (var c = 0u; c < dims.input_channels; c = c + 1u) {
    sum = sum + input_values[input_base + c] * weight[weight_base + c];
  }
  output_values[index] = gelu_exact_approx(sum);
}
`;

const RESIDUAL_ADD_WGSL = `
struct BlockDims {
  batch: u32, height: u32, width: u32, channels: u32,
  heads: u32, head_dim: u32, window_size: u32, intermediate_size: u32,
  padded_height: u32, padded_width: u32, windows_per_row: u32, window_count: u32,
  window_tokens: u32, total_values: u32, padded_total_values: u32, _pad0: u32,
};
@group(0) @binding(0) var<storage, read> residual: array<f32>;
@group(0) @binding(1) var<storage, read> update: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: BlockDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= dims.total_values) { return; }
  output_values[gid.x] = residual[gid.x] + update[gid.x];
}
`;

const ROPE_WGSL = `
struct BlockDims {
  batch: u32,
  height: u32,
  width: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  window_size: u32,
  intermediate_size: u32,
  padded_height: u32,
  padded_width: u32,
  windows_per_row: u32,
  window_count: u32,
  window_tokens: u32,
  total_values: u32,
  padded_total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: BlockDims;

fn rope_cos(token: u32, d: u32) -> f32 {
  let pair = d / 2u;
  let half_pairs = dims.head_dim / 4u;
  let is_x = pair < half_pairs;
  let freq_index = select(pair - half_pairs, pair, is_x);
  let x = token % dims.window_size;
  let y = token / dims.window_size;
  let position = select(y, x, is_x);
  let freq = 1.0 / pow(10000.0, f32(freq_index * 4u) / f32(dims.head_dim));
  return cos(f32(position) * freq);
}

fn rope_sin(token: u32, d: u32) -> f32 {
  let pair = d / 2u;
  let half_pairs = dims.head_dim / 4u;
  let is_x = pair < half_pairs;
  let freq_index = select(pair - half_pairs, pair, is_x);
  let x = token % dims.window_size;
  let y = token / dims.window_size;
  let position = select(y, x, is_x);
  let freq = 1.0 / pow(10000.0, f32(freq_index * 4u) / f32(dims.head_dim));
  return sin(f32(position) * freq);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.padded_total_values) { return; }
  let c = index % dims.channels;
  let token = (index / dims.channels) % dims.window_tokens;
  let d = c % dims.head_dim;
  let pair_mate = select(d - 1u, d + 1u, (d % 2u) == 0u);
  let mate_index = index - d + pair_mate;
  let rotated = select(input_values[mate_index], -input_values[mate_index], (d % 2u) == 0u);
  output_values[index] = input_values[index] * rope_cos(token, d) + rotated * rope_sin(token, d);
}
`;

const ATTENTION_WGSL = `
struct BlockDims {
  batch: u32,
  height: u32,
  width: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  window_size: u32,
  intermediate_size: u32,
  padded_height: u32,
  padded_width: u32,
  windows_per_row: u32,
  window_count: u32,
  window_tokens: u32,
  total_values: u32,
  padded_total_values: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> q: array<f32>;
@group(0) @binding(1) var<storage, read> k: array<f32>;
@group(0) @binding(2) var<storage, read> v: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: BlockDims;

fn qkv_index(window_index: u32, token: u32, head: u32, dim: u32) -> u32 {
  return (window_index * dims.window_tokens + token) * dims.channels + head * dims.head_dim + dim;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.padded_total_values) { return; }
  let c = index % dims.channels;
  let dim = c % dims.head_dim;
  let head = c / dims.head_dim;
  let token = (index / dims.channels) % dims.window_tokens;
  let window_index = index / (dims.window_tokens * dims.channels);
  let scale = inverseSqrt(f32(dims.head_dim));
  var max_score = -3.402823e38;
  for (var key_token = 0u; key_token < dims.window_tokens; key_token = key_token + 1u) {
    var score = 0.0;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q[qkv_index(window_index, token, head, d)] * k[qkv_index(window_index, key_token, head, d)];
    }
    score = score * scale;
    max_score = max(max_score, score);
  }
  var denom = 0.0;
  var numerator = 0.0;
  for (var key_token = 0u; key_token < dims.window_tokens; key_token = key_token + 1u) {
    var score = 0.0;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q[qkv_index(window_index, token, head, d)] * k[qkv_index(window_index, key_token, head, d)];
    }
    let weight = exp(score * scale - max_score);
    denom = denom + weight;
    numerator = numerator + weight * v[qkv_index(window_index, key_token, head, dim)];
  }
  output_values[index] = numerator / denom;
}
`;

function createDefaultScheduler() {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-vit-first-block-hidden-states' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-vit-first-block-hidden-states' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-vit-first-block-hidden-states' })),
      notes: 'SAM3 image ViT first-block phase program cooperates between layer norms, window partition/pad/crop, pairwise RoPE attention, residuals, GELU MLP, and readback boundaries.',
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
    height: shape.height ?? shape.patchHeight,
    width: shape.width ?? shape.patchWidth,
    hiddenSize: shape.hiddenSize ?? shape.channels,
    numHeads: shape.numHeads ?? shape.heads,
    windowSize: shape.windowSize,
    intermediateSize: shape.intermediateSize ?? shape.mlpHidden,
    layerNormEps: shape.layerNormEps ?? 0.000001,
    ropeTheta: shape.ropeTheta ?? 10000,
  };
  out.headDim = out.hiddenSize / out.numHeads;
  out.paddedHeight = Math.ceil(out.height / out.windowSize) * out.windowSize;
  out.paddedWidth = Math.ceil(out.width / out.windowSize) * out.windowSize;
  out.windowsPerColumn = out.paddedHeight / out.windowSize;
  out.windowsPerRow = out.paddedWidth / out.windowSize;
  out.windowCount = out.windowsPerColumn * out.windowsPerRow;
  out.windowTokens = out.windowSize * out.windowSize;
  out.tokenCount = out.batch * out.height * out.width;
  out.totalValues = out.tokenCount * out.hiddenSize;
  out.paddedTotalValues = out.batch * out.windowCount * out.windowTokens * out.hiddenSize;
  for (const key of ['batch', 'height', 'width', 'hiddenSize', 'numHeads', 'windowSize', 'intermediateSize']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (!Number.isInteger(out.headDim) || out.headDim % 4 !== 0) throw new Error('shape.hiddenSize / shape.numHeads must be divisible by 4 for SAM3 axial RoPE');
  return out;
}

function validateImageVitFirstBlockInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const hiddenStates = ensureFloat32Array(input.hiddenStates, 'hiddenStates');
  const weights = {};
  for (const name of [
    'layerNorm1Weight', 'layerNorm1Bias', 'qProjWeight', 'qProjBias', 'kProjWeight', 'kProjBias', 'vProjWeight', 'vProjBias', 'oProjWeight', 'oProjBias',
    'layerNorm2Weight', 'layerNorm2Bias', 'mlpFc1Weight', 'mlpFc1Bias', 'mlpFc2Weight', 'mlpFc2Bias',
  ]) {
    weights[name] = ensureFloat32Array(input.weights?.[name], `weights.${name}`);
  }
  if (hiddenStates.length !== shape.totalValues) throw new Error(`hiddenStates length ${hiddenStates.length} does not match shape (${shape.totalValues})`);
  for (const name of ['layerNorm1Weight', 'layerNorm1Bias', 'qProjBias', 'kProjBias', 'vProjBias', 'oProjBias', 'layerNorm2Weight', 'layerNorm2Bias', 'mlpFc2Bias']) {
    if (weights[name].length !== shape.hiddenSize) throw new Error(`weights.${name} length mismatch`);
  }
  for (const name of ['qProjWeight', 'kProjWeight', 'vProjWeight', 'oProjWeight']) {
    if (weights[name].length !== shape.hiddenSize * shape.hiddenSize) throw new Error(`weights.${name} length mismatch`);
  }
  if (weights.mlpFc1Weight.length !== shape.intermediateSize * shape.hiddenSize) throw new Error('weights.mlpFc1Weight length mismatch');
  if (weights.mlpFc1Bias.length !== shape.intermediateSize) throw new Error('weights.mlpFc1Bias length mismatch');
  if (weights.mlpFc2Weight.length !== shape.hiddenSize * shape.intermediateSize) throw new Error('weights.mlpFc2Weight length mismatch');
  return { shape, hiddenStates, weights };
}

function gelu(value) {
  return stableMlxMetalGelu(value);
}

function stableMlxMetalGelu(value) {
  if (value < -10) return 0;
  if (value > 10) return value;
  return 0.5 * value * (1 + mlxMetalErf(value * 0.7071067811865476));
}

function mlxMetalErf(value) {
  const magnitude = Math.abs(value);
  const squared = value * value;
  let result;
  if (magnitude > 0.927734375) {
    result = -1.72853470e-5 * magnitude + 3.83197126e-4;
    const companion = -3.88396438e-3 * magnitude + 2.42546219e-2;
    result = result * squared + companion;
    result = result * magnitude - 1.06777877e-1;
    result = result * magnitude - 6.34846687e-1;
    result = result * magnitude - 1.28717512e-1;
    result = result * magnitude - magnitude;
    result = -Math.expm1(result);
    return value < 0 ? -Math.abs(result) : Math.abs(result);
  }
  result = -5.96761703e-4;
  result = result * squared + 4.99119423e-3;
  result = result * squared - 2.67681349e-2;
  result = result * squared + 1.12819925e-1;
  result = result * squared - 3.76125336e-1;
  result = result * squared + 1.28379166e-1;
  return result * value + value;
}

function layerNorm(input, weight, bias, tokenCount, channels, eps) {
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
    const invStd = 1 / Math.sqrt(variance + eps);
    for (let c = 0; c < channels; c += 1) out[base + c] = (input[base + c] - mean) * invStd * weight[c] + bias[c];
  }
  return out;
}

function linearAll(input, tokenCount, inputChannels, outputChannels, weight, bias, activation = 'none') {
  const out = new Float32Array(tokenCount * outputChannels);
  for (let token = 0; token < tokenCount; token += 1) {
    const inputBase = token * inputChannels;
    const outputBase = token * outputChannels;
    for (let oc = 0; oc < outputChannels; oc += 1) {
      let sum = bias[oc];
      const weightBase = oc * inputChannels;
      for (let ic = 0; ic < inputChannels; ic += 1) sum += input[inputBase + ic] * weight[weightBase + ic];
      out[outputBase + oc] = activation === 'gelu' ? gelu(sum) : sum;
    }
  }
  return out;
}

function windowPartition(input, shape) {
  const windows = new Float32Array(shape.paddedTotalValues);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let y = 0; y < shape.paddedHeight; y += 1) {
      for (let x = 0; x < shape.paddedWidth; x += 1) {
        const windowY = Math.floor(y / shape.windowSize);
        const windowX = Math.floor(x / shape.windowSize);
        const localY = y % shape.windowSize;
        const localX = x % shape.windowSize;
        const windowIndex = batch * shape.windowCount + windowY * shape.windowsPerRow + windowX;
        const windowToken = localY * shape.windowSize + localX;
        for (let c = 0; c < shape.hiddenSize; c += 1) {
          const outIndex = (windowIndex * shape.windowTokens + windowToken) * shape.hiddenSize + c;
          windows[outIndex] = y < shape.height && x < shape.width
            ? input[((batch * shape.height + y) * shape.width + x) * shape.hiddenSize + c]
            : 0;
        }
      }
    }
  }
  return windows;
}

function windowUnpartition(windows, residual, shape) {
  const out = new Float32Array(shape.totalValues);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let y = 0; y < shape.height; y += 1) {
      for (let x = 0; x < shape.width; x += 1) {
        const windowY = Math.floor(y / shape.windowSize);
        const windowX = Math.floor(x / shape.windowSize);
        const localY = y % shape.windowSize;
        const localX = x % shape.windowSize;
        const windowIndex = batch * shape.windowCount + windowY * shape.windowsPerRow + windowX;
        const windowToken = localY * shape.windowSize + localX;
        for (let c = 0; c < shape.hiddenSize; c += 1) {
          const outIndex = ((batch * shape.height + y) * shape.width + x) * shape.hiddenSize + c;
          out[outIndex] = residual[outIndex] + windows[(windowIndex * shape.windowTokens + windowToken) * shape.hiddenSize + c];
        }
      }
    }
  }
  return out;
}

function computeAxialRope(shape) {
  const cos = new Float32Array(shape.windowTokens * shape.headDim);
  const sin = new Float32Array(shape.windowTokens * shape.headDim);
  for (let token = 0; token < shape.windowTokens; token += 1) {
    const x = token % shape.windowSize;
    const y = Math.floor(token / shape.windowSize);
    for (let d = 0; d < shape.headDim; d += 1) {
      const pair = Math.floor(d / 2);
      const halfPairs = shape.headDim / 4;
      const isX = pair < halfPairs;
      const freqIndex = isX ? pair : pair - halfPairs;
      const position = isX ? x : y;
      const freq = 1 / (shape.ropeTheta ** ((freqIndex * 4) / shape.headDim));
      cos[token * shape.headDim + d] = Math.cos(position * freq);
      sin[token * shape.headDim + d] = Math.sin(position * freq);
    }
  }
  return { cos, sin };
}

function applyRope(input, rope, shape) {
  const out = new Float32Array(input.length);
  const tokenCount = shape.batch * shape.windowCount * shape.windowTokens;
  for (let token = 0; token < tokenCount; token += 1) {
    const localToken = token % shape.windowTokens;
    for (let c = 0; c < shape.hiddenSize; c += 1) {
      const d = c % shape.headDim;
      const mate = d % 2 === 0 ? c + 1 : c - 1;
      const rotated = d % 2 === 0 ? -input[token * shape.hiddenSize + mate] : input[token * shape.hiddenSize + mate];
      out[token * shape.hiddenSize + c] = input[token * shape.hiddenSize + c] * rope.cos[localToken * shape.headDim + d] + rotated * rope.sin[localToken * shape.headDim + d];
    }
  }
  return out;
}

function attention(q, k, v, shape) {
  const out = new Float32Array(q.length);
  const scale = 1 / Math.sqrt(shape.headDim);
  const windowBatchCount = shape.batch * shape.windowCount;
  const at = (tensor, windowIndex, token, head, dim) => tensor[(windowIndex * shape.windowTokens + token) * shape.hiddenSize + head * shape.headDim + dim];
  for (let windowIndex = 0; windowIndex < windowBatchCount; windowIndex += 1) {
    for (let head = 0; head < shape.numHeads; head += 1) {
      for (let token = 0; token < shape.windowTokens; token += 1) {
        const scores = new Float32Array(shape.windowTokens);
        let maxScore = -Infinity;
        for (let keyToken = 0; keyToken < shape.windowTokens; keyToken += 1) {
          let score = 0;
          for (let d = 0; d < shape.headDim; d += 1) score += at(q, windowIndex, token, head, d) * at(k, windowIndex, keyToken, head, d);
          score *= scale;
          scores[keyToken] = score;
          if (score > maxScore) maxScore = score;
        }
        let denom = 0;
        for (let keyToken = 0; keyToken < shape.windowTokens; keyToken += 1) {
          scores[keyToken] = Math.exp(scores[keyToken] - maxScore);
          denom += scores[keyToken];
        }
        for (let d = 0; d < shape.headDim; d += 1) {
          let sum = 0;
          for (let keyToken = 0; keyToken < shape.windowTokens; keyToken += 1) sum += (scores[keyToken] / denom) * at(v, windowIndex, keyToken, head, d);
          out[(windowIndex * shape.windowTokens + token) * shape.hiddenSize + head * shape.headDim + d] = sum;
        }
      }
    }
  }
  return out;
}

export function createSam3ImageVitFirstBlockPhaseProgramCpuOracle(input) {
  const { shape, hiddenStates, weights } = validateImageVitFirstBlockInputs(input);
  const layerNorm1 = layerNorm(hiddenStates, weights.layerNorm1Weight, weights.layerNorm1Bias, shape.tokenCount, shape.hiddenSize, shape.layerNormEps);
  const windows = windowPartition(layerNorm1, shape);
  const q = linearAll(windows, shape.batch * shape.windowCount * shape.windowTokens, shape.hiddenSize, shape.hiddenSize, weights.qProjWeight, weights.qProjBias);
  const k = linearAll(windows, shape.batch * shape.windowCount * shape.windowTokens, shape.hiddenSize, shape.hiddenSize, weights.kProjWeight, weights.kProjBias);
  const v = linearAll(windows, shape.batch * shape.windowCount * shape.windowTokens, shape.hiddenSize, shape.hiddenSize, weights.vProjWeight, weights.vProjBias);
  const rope = computeAxialRope(shape);
  const qRope = applyRope(q, rope, shape);
  const kRope = applyRope(k, rope, shape);
  const attn = attention(qRope, kRope, v, shape);
  const projected = linearAll(attn, shape.batch * shape.windowCount * shape.windowTokens, shape.hiddenSize, shape.hiddenSize, weights.oProjWeight, weights.oProjBias);
  const attentionResidual = windowUnpartition(projected, hiddenStates, shape);
  const layerNorm2 = layerNorm(attentionResidual, weights.layerNorm2Weight, weights.layerNorm2Bias, shape.tokenCount, shape.hiddenSize, shape.layerNormEps);
  const mlpHidden = linearAll(layerNorm2, shape.tokenCount, shape.hiddenSize, shape.intermediateSize, weights.mlpFc1Weight, weights.mlpFc1Bias, 'gelu');
  const mlpOut = linearAll(mlpHidden, shape.tokenCount, shape.intermediateSize, shape.hiddenSize, weights.mlpFc2Weight, weights.mlpFc2Bias);
  const vitFirstBlockHiddenStates = new Float32Array(shape.totalValues);
  for (let index = 0; index < shape.totalValues; index += 1) vitFirstBlockHiddenStates[index] = attentionResidual[index] + mlpOut[index];
  return {
    shape,
    windowPartition: { originalHeight: shape.height, originalWidth: shape.width, paddedHeight: shape.paddedHeight, paddedWidth: shape.paddedWidth, windowSize: shape.windowSize, windowCount: shape.windowCount },
    layerNorm1,
    windows,
    ropeCos: rope.cos,
    ropeSin: rope.sin,
    attentionResidual,
    layerNorm2,
    vitFirstBlockHiddenStates,
  };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image ViT first-block outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    vitFirstBlockHiddenStates: {
      artifactId: roleArtifact(request.outputs, 'vit-first-block-hidden-states').artifactId,
      sha256: hashes.vitFirstBlockHiddenStates,
      shape: [shape.batch, shape.height, shape.width, shape.hiddenSize],
    },
  };
}

export function createSam3ImageVitFirstBlockPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('vit-prefix-hidden-states', input.hiddenStates),
      createRouteReceiptInputArtifact('sam3-image-vit-first-block-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImageVitFirstBlockPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-vit-first-block', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImageVitFirstBlockPhaseProgramRoute', upstreamBoundary: 'browser-sam3-vit-prefix-to-first-vit-block-hidden-states' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

export async function runSam3ImageVitFirstBlockPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImageVitFirstBlockPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const hiddenStatesArtifact = roleArtifact(input.request.inputs, 'vit-prefix-hidden-states');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-image-vit-first-block-weights');
  const { shape, hiddenStates, weights } = validateImageVitFirstBlockInputs(input.tensors || {});
  const windowTokenCount = shape.batch * shape.windowCount * shape.windowTokens;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-vit-first-block-phase-program',
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
  await runtime.runStage('load-image-vit-first-block-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage });
    tensors = {
      hiddenStates: tensor('sam3.image-vit-first-block.hidden-states', [shape.batch, shape.height, shape.width, shape.hiddenSize], readonlyUsage),
      layerNorm1: tensor('sam3.image-vit-first-block.layernorm1.out', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      windows: tensor('sam3.image-vit-first-block.windows', [shape.batch * shape.windowCount, shape.windowSize, shape.windowSize, shape.hiddenSize]),
      q: tensor('sam3.image-vit-first-block.q', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      k: tensor('sam3.image-vit-first-block.k', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      v: tensor('sam3.image-vit-first-block.v', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      qRope: tensor('sam3.image-vit-first-block.q-rope', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      kRope: tensor('sam3.image-vit-first-block.k-rope', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      attention: tensor('sam3.image-vit-first-block.attention', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      projected: tensor('sam3.image-vit-first-block.projected', [shape.batch * shape.windowCount, shape.windowTokens, shape.hiddenSize]),
      attentionResidual: tensor('sam3.image-vit-first-block.attention-residual', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      layerNorm2: tensor('sam3.image-vit-first-block.layernorm2.out', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      mlpHidden: tensor('sam3.image-vit-first-block.mlp-hidden', [shape.batch, shape.height * shape.width, shape.intermediateSize]),
      mlpOut: tensor('sam3.image-vit-first-block.mlp-out', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      vitFirstBlockHiddenStates: tensor('sam3.image-vit-first-block.output', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      layerNorm1Weight: tensor('sam3.image-vit-first-block.layernorm1.weight', [shape.hiddenSize], readonlyUsage),
      layerNorm1Bias: tensor('sam3.image-vit-first-block.layernorm1.bias', [shape.hiddenSize], readonlyUsage),
      qProjWeight: tensor('sam3.image-vit-first-block.q.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      qProjBias: tensor('sam3.image-vit-first-block.q.bias', [shape.hiddenSize], readonlyUsage),
      kProjWeight: tensor('sam3.image-vit-first-block.k.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      kProjBias: tensor('sam3.image-vit-first-block.k.bias', [shape.hiddenSize], readonlyUsage),
      vProjWeight: tensor('sam3.image-vit-first-block.v.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      vProjBias: tensor('sam3.image-vit-first-block.v.bias', [shape.hiddenSize], readonlyUsage),
      oProjWeight: tensor('sam3.image-vit-first-block.o.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      oProjBias: tensor('sam3.image-vit-first-block.o.bias', [shape.hiddenSize], readonlyUsage),
      layerNorm2Weight: tensor('sam3.image-vit-first-block.layernorm2.weight', [shape.hiddenSize], readonlyUsage),
      layerNorm2Bias: tensor('sam3.image-vit-first-block.layernorm2.bias', [shape.hiddenSize], readonlyUsage),
      mlpFc1Weight: tensor('sam3.image-vit-first-block.mlp.fc1.weight', [shape.intermediateSize, shape.hiddenSize], readonlyUsage),
      mlpFc1Bias: tensor('sam3.image-vit-first-block.mlp.fc1.bias', [shape.intermediateSize], readonlyUsage),
      mlpFc2Weight: tensor('sam3.image-vit-first-block.mlp.fc2.weight', [shape.hiddenSize, shape.intermediateSize], readonlyUsage),
      mlpFc2Bias: tensor('sam3.image-vit-first-block.mlp.fc2.bias', [shape.hiddenSize], readonlyUsage),
      blockDims: stage.createUniformBuffer({
        label: 'sam3.image-vit-first-block.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'height', type: 'u32' },
          { name: 'width', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'heads', type: 'u32' },
          { name: 'head_dim', type: 'u32' },
          { name: 'window_size', type: 'u32' },
          { name: 'intermediate_size', type: 'u32' },
          { name: 'padded_height', type: 'u32' },
          { name: 'padded_width', type: 'u32' },
          { name: 'windows_per_row', type: 'u32' },
          { name: 'window_count', type: 'u32' },
          { name: 'window_tokens', type: 'u32' },
          { name: 'total_values', type: 'u32' },
          { name: 'padded_total_values', type: 'u32' },
          { name: '_pad0', type: 'u32' },
        ],
        values: { batch: shape.batch, height: shape.height, width: shape.width, channels: shape.hiddenSize, heads: shape.numHeads, head_dim: shape.headDim, window_size: shape.windowSize, intermediate_size: shape.intermediateSize, padded_height: shape.paddedHeight, padded_width: shape.paddedWidth, windows_per_row: shape.windowsPerRow, window_count: shape.windowCount, window_tokens: shape.windowTokens, total_values: shape.totalValues, padded_total_values: shape.paddedTotalValues, _pad0: 0 },
      }),
      lnDims: stage.createUniformBuffer({ label: 'sam3.image-vit-first-block.ln-dims', schema: [{ name: 'token_count', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: '_pad0', type: 'u32' }, { name: '_pad1', type: 'u32' }], values: { token_count: shape.tokenCount, channels: shape.hiddenSize, _pad0: 0, _pad1: 0 } }),
      windowLinearDims: stage.createUniformBuffer({ label: 'sam3.image-vit-first-block.window-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: '_pad0', type: 'u32' }], values: { input_channels: shape.hiddenSize, output_channels: shape.hiddenSize, total_output: shape.paddedTotalValues, _pad0: 0 } }),
      fc1Dims: stage.createUniformBuffer({ label: 'sam3.image-vit-first-block.fc1-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: '_pad0', type: 'u32' }], values: { input_channels: shape.hiddenSize, output_channels: shape.intermediateSize, total_output: shape.tokenCount * shape.intermediateSize, _pad0: 0 } }),
      fc2Dims: stage.createUniformBuffer({ label: 'sam3.image-vit-first-block.fc2-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: '_pad0', type: 'u32' }], values: { input_channels: shape.intermediateSize, output_channels: shape.hiddenSize, total_output: shape.totalValues, _pad0: 0 } }),
    };
    stage.uploadTensor(tensors.hiddenStates, hiddenStates);
    for (const [name, values] of Object.entries(weights)) stage.uploadTensor(tensors[name], values);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-vit-first-block-upload' });
  }, { shape, referenceBoundary: 'MLX VitBlock: LN1 -> window partition/pad/crop -> pairwise RoPE attention -> residual -> LN2 -> GELU MLP -> residual' });

  const bindTensor = (resource, access = 'read-only-storage') => ({ name: resource.replace(/^tensor:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = resource => ({ name: resource.replace(/^uniform:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const program = runtime.defineProgram({
    name: 'sam3.image-vit-first-block-phase-program',
    tensors,
    uniforms: { blockDims: tensors.blockDims, lnDims: tensors.lnDims, windowLinearDims: tensors.windowLinearDims, fc1Dims: tensors.fc1Dims, fc2Dims: tensors.fc2Dims },
    kernels: {
      layerNorm1: { code: LAYERNORM_WGSL, bindings: [bindTensor('tensor:hiddenStates'), bindTensor('tensor:layerNorm1Weight'), bindTensor('tensor:layerNorm1Bias'), bindTensor('tensor:layerNorm1', 'storage'), bindUniform('uniform:lnDims')] },
      windowPartition: { code: WINDOW_PARTITION_WGSL, bindings: [bindTensor('tensor:layerNorm1'), bindTensor('tensor:windows', 'storage'), bindUniform('uniform:blockDims')] },
      qProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:windows'), bindTensor('tensor:qProjWeight'), bindTensor('tensor:qProjBias'), bindTensor('tensor:q', 'storage'), bindUniform('uniform:windowLinearDims')] },
      kProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:windows'), bindTensor('tensor:kProjWeight'), bindTensor('tensor:kProjBias'), bindTensor('tensor:k', 'storage'), bindUniform('uniform:windowLinearDims')] },
      vProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:windows'), bindTensor('tensor:vProjWeight'), bindTensor('tensor:vProjBias'), bindTensor('tensor:v', 'storage'), bindUniform('uniform:windowLinearDims')] },
      qRope: { code: ROPE_WGSL, bindings: [bindTensor('tensor:q'), bindTensor('tensor:qRope', 'storage'), bindUniform('uniform:blockDims')] },
      kRope: { code: ROPE_WGSL, bindings: [bindTensor('tensor:k'), bindTensor('tensor:kRope', 'storage'), bindUniform('uniform:blockDims')] },
      attention: { code: ATTENTION_WGSL, bindings: [bindTensor('tensor:qRope'), bindTensor('tensor:kRope'), bindTensor('tensor:v'), bindTensor('tensor:attention', 'storage'), bindUniform('uniform:blockDims')] },
      outputProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:attention'), bindTensor('tensor:oProjWeight'), bindTensor('tensor:oProjBias'), bindTensor('tensor:projected', 'storage'), bindUniform('uniform:windowLinearDims')] },
      windowUnpartition: { code: WINDOW_UNPARTITION_WGSL, bindings: [bindTensor('tensor:projected'), bindTensor('tensor:hiddenStates'), bindTensor('tensor:attentionResidual', 'storage'), bindUniform('uniform:blockDims')] },
      layerNorm2: { code: LAYERNORM_WGSL, bindings: [bindTensor('tensor:attentionResidual'), bindTensor('tensor:layerNorm2Weight'), bindTensor('tensor:layerNorm2Bias'), bindTensor('tensor:layerNorm2', 'storage'), bindUniform('uniform:lnDims')] },
      mlpFc1: { code: LINEAR_GELU_WGSL, bindings: [bindTensor('tensor:layerNorm2'), bindTensor('tensor:mlpFc1Weight'), bindTensor('tensor:mlpFc1Bias'), bindTensor('tensor:mlpHidden', 'storage'), bindUniform('uniform:fc1Dims')] },
      mlpFc2: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:mlpHidden'), bindTensor('tensor:mlpFc2Weight'), bindTensor('tensor:mlpFc2Bias'), bindTensor('tensor:mlpOut', 'storage'), bindUniform('uniform:fc2Dims')] },
      residualMlp: { code: RESIDUAL_ADD_WGSL, bindings: [bindTensor('tensor:attentionResidual'), bindTensor('tensor:mlpOut'), bindTensor('tensor:vitFirstBlockHiddenStates', 'storage'), bindUniform('uniform:blockDims')] },
    },
    phases: [
      { name: 'vit-block-layernorm1', kernel: 'layerNorm1', dispatch: [workgroups(shape.tokenCount)], yieldAfter: true },
      { name: 'vit-block-window-partition', kernel: 'windowPartition', dispatch: [workgroups(shape.paddedTotalValues)], yieldAfter: true },
      { name: 'vit-block-qkv-projection', kernel: 'qProjection', dispatch: [workgroups(shape.paddedTotalValues)] },
      { name: 'vit-block-qkv-projection', kernel: 'kProjection', dispatch: [workgroups(shape.paddedTotalValues)] },
      { name: 'vit-block-qkv-projection', kernel: 'vProjection', dispatch: [workgroups(shape.paddedTotalValues)], yieldAfter: true },
      { name: 'vit-block-rope-attention', kernel: 'qRope', dispatch: [workgroups(shape.paddedTotalValues)] },
      { name: 'vit-block-rope-attention', kernel: 'kRope', dispatch: [workgroups(shape.paddedTotalValues)] },
      { name: 'vit-block-rope-attention', kernel: 'attention', dispatch: [workgroups(shape.paddedTotalValues)], yieldAfter: true },
      { name: 'vit-block-output-projection', kernel: 'outputProjection', dispatch: [workgroups(shape.paddedTotalValues)], yieldAfter: true },
      { name: 'vit-block-window-unpartition', kernel: 'windowUnpartition', dispatch: [workgroups(shape.totalValues)], yieldAfter: true },
      { name: 'vit-block-layernorm2', kernel: 'layerNorm2', dispatch: [workgroups(shape.tokenCount)], yieldAfter: true },
      { name: 'vit-block-gelu-mlp', kernel: 'mlpFc1', dispatch: [workgroups(shape.tokenCount * shape.intermediateSize)] },
      { name: 'vit-block-gelu-mlp', kernel: 'mlpFc2', dispatch: [workgroups(shape.totalValues)] },
      { name: 'vit-block-gelu-mlp', kernel: 'residualMlp', dispatch: [workgroups(shape.totalValues)], yieldAfter: true },
      { name: 'readback-vit-first-block-hidden-states', readbacks: [{ name: 'vitFirstBlockHiddenStates', tensor: 'vitFirstBlockHiddenStates' }] },
    ],
    metadata: { routeId: SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID, layout: 'B,H,W,C', referenceBoundary: 'window partition/pad/crop plus pairwise RoPE SAM3 VitBlock layer 0' },
  });
  const run = await runtime.runProgram(program);
  const outputs = outputArtifacts(input.request, {
    vitFirstBlockHiddenStates: await sha256Hex(run.outputs.vitFirstBlockHiddenStates),
  }, shape);
  const receipt = createSam3ImageVitFirstBlockPhaseProgramRouteReceipt({
    sourceImage,
    hiddenStates: hiddenStatesArtifact,
    weights: weightsArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      vitFirstBlockHiddenStates: Array.from(new Float32Array(run.outputs.vitFirstBlockHiddenStates)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
