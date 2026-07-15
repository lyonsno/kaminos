import {
  assertAuthoritativeRouteWorkerResult,
  defineWebGpuRoute,
  createRouteWorkerResult,
} from './route-boundary.js';
import { createWebGpuInferenceRuntime } from './inference-runtime.js';
import { WEBGPU_BUFFER_USAGE, WEBGPU_SHADER_STAGE, createLinearDispatch } from './runtime-primitives.js';
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

export const SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-vit-block-stack.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-vit-block-stack-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-vit-block-stack-tensors',
  'vit-block-stack-layer-range',
  'vit-block-stack-layernorm1',
  'vit-block-stack-window-partition',
  'vit-block-stack-global-attention',
  'vit-block-stack-qkv-projection',
  'vit-block-stack-rope-attention',
  'vit-block-stack-output-projection',
  'vit-block-stack-window-unpartition',
  'vit-block-stack-layernorm2',
  'vit-block-stack-gelu-mlp',
  'readback-vit-block-stack-hidden-states',
];
const INPUT_ROLES = ['source-image', 'vit-prefix-hidden-states', 'sam3-image-vit-block-stack-weights'];
const OUTPUT_ROLES = [
  { key: 'vitBlockStackHiddenStates', role: 'vit-block-stack-hidden-states', required: true },
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let token = gid.x + gid.y * dispatch_grid.x * 64u;
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_values) { return; }
  output_values[index] = residual[index] + update[index];
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
  rope_scale: f32,
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
  return cos(f32(position) * dims.rope_scale * freq);
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
  return sin(f32(position) * dims.rope_scale * freq);
}

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-vit-block-stack-hidden-states' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-vit-block-stack-hidden-states' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-vit-block-stack-hidden-states' })),
      notes: 'SAM3 image ViT block-stack phase program cooperates between layer norms, window partition/pad/crop, pairwise RoPE attention, residuals, GELU MLP, and readback boundaries.',
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
    ropePretrainGridSize: shape.ropePretrainGridSize ?? shape.windowSize,
    interpolateRope: shape.interpolateRope === true,
    startLayerIndex: shape.startLayerIndex ?? 0,
    endLayerIndex: shape.endLayerIndex ?? shape.firstGlobalLayerIndex ?? 0,
    finalLayerIndex: shape.finalLayerIndex ?? shape.endLayerIndex ?? null,
    fullBackbone: shape.fullBackbone === true,
    globalAttnIndexes: shape.globalAttnIndexes ?? shape.global_attn_indexes ?? [7, 15, 23, 31],
    firstGlobalLayerIndex: shape.firstGlobalLayerIndex ?? (shape.globalAttnIndexes ?? shape.global_attn_indexes ?? [7, 15, 23, 31])[0],
  };
  if (out.finalLayerIndex == null) out.finalLayerIndex = out.endLayerIndex;
  out.headDim = out.hiddenSize / out.numHeads;
  out.tokenCount = out.batch * out.height * out.width;
  out.totalValues = out.tokenCount * out.hiddenSize;
  out.globalWindowSize = out.height === out.width ? out.width : out.windowSize;
  out.maxWindowSize = Math.max(out.windowSize, out.globalWindowSize);
  out.maxPaddedHeight = Math.ceil(out.height / out.maxWindowSize) * out.maxWindowSize;
  out.maxPaddedWidth = Math.ceil(out.width / out.maxWindowSize) * out.maxWindowSize;
  out.maxWindowsPerColumn = out.maxPaddedHeight / out.maxWindowSize;
  out.maxWindowsPerRow = out.maxPaddedWidth / out.maxWindowSize;
  out.maxWindowCount = out.maxWindowsPerColumn * out.maxWindowsPerRow;
  out.maxWindowTokens = out.maxWindowSize * out.maxWindowSize;
  out.maxPaddedTotalValues = out.batch * out.maxWindowCount * out.maxWindowTokens * out.hiddenSize;
  out.layerCount = out.endLayerIndex - out.startLayerIndex + 1;
  for (const key of ['batch', 'height', 'width', 'hiddenSize', 'numHeads', 'windowSize', 'intermediateSize', 'endLayerIndex', 'firstGlobalLayerIndex']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (!Number.isInteger(out.startLayerIndex) || out.startLayerIndex < 0) throw new Error('shape.startLayerIndex must be a non-negative integer');
  if (out.startLayerIndex < 0 || out.endLayerIndex < out.startLayerIndex) throw new Error('shape layer range must be valid');
  if (!Number.isInteger(out.finalLayerIndex) || out.finalLayerIndex < out.endLayerIndex) throw new Error('shape.finalLayerIndex must be an integer >= shape.endLayerIndex');
  if (!Array.isArray(out.globalAttnIndexes) || out.globalAttnIndexes.length === 0 || !out.globalAttnIndexes.every(value => Number.isInteger(value) && value >= 0)) throw new Error('shape.globalAttnIndexes must be non-empty integer array');
  if (!Number.isInteger(out.headDim) || out.headDim % 4 !== 0) throw new Error('shape.hiddenSize / shape.numHeads must be divisible by 4 for SAM3 axial RoPE');
  if (out.layerNormEps !== 0.000001) throw new Error('shape.layerNormEps must be 0.000001 until the WebGPU block-stack shader accepts configurable epsilon');
  if (out.ropeTheta !== 10000) throw new Error('shape.ropeTheta must be 10000 until the WebGPU block-stack shader accepts configurable RoPE theta');
  if (!Number.isInteger(out.ropePretrainGridSize) || out.ropePretrainGridSize <= 0) throw new Error('shape.ropePretrainGridSize must be a positive integer');
  return out;
}

function blockShapeForLayer(baseShape, layer) {
  const isGlobal = layer.isGlobal === true || baseShape.globalAttnIndexes.includes(layer.layerIndex);
  const windowSize = isGlobal ? baseShape.globalWindowSize : baseShape.windowSize;
  if (isGlobal && baseShape.height !== baseShape.width) throw new Error('global attention currently requires square SAM3 image ViT grids');
  const paddedHeight = Math.ceil(baseShape.height / windowSize) * windowSize;
  const paddedWidth = Math.ceil(baseShape.width / windowSize) * windowSize;
  const windowsPerColumn = paddedHeight / windowSize;
  const windowsPerRow = paddedWidth / windowSize;
  const windowCount = windowsPerColumn * windowsPerRow;
  const windowTokens = windowSize * windowSize;
  return {
    ...baseShape,
    layerIndex: layer.layerIndex,
    isGlobal,
    windowSize,
    paddedHeight,
    paddedWidth,
    windowsPerColumn,
    windowsPerRow,
    windowCount,
    windowTokens,
    paddedTotalValues: baseShape.batch * windowCount * windowTokens * baseShape.hiddenSize,
    ropeScale: baseShape.interpolateRope ? baseShape.ropePretrainGridSize / windowSize : 1,
  };
}

export function createSam3ImageVitBlockStackDispatchPlan(input = {}) {
  const shape = normalizeShape(input.shape);
  const layerShape = blockShapeForLayer(shape, {
    layerIndex: input.layerIndex,
    isGlobal: input.isGlobal === true,
  });
  const maxWorkgroupsPerDimension = input.maxWorkgroupsPerDimension ?? 65_535;
  const entry = logicalInvocations => ({
    logicalInvocations,
    dispatch: createLinearDispatch(logicalInvocations, {
      workgroupSize: 64,
      maxWorkgroupsPerDimension,
    }),
  });
  const padded = () => entry(layerShape.paddedTotalValues);
  const total = () => entry(shape.totalValues);
  return {
    layerNorm1: entry(shape.tokenCount),
    windowPartition: padded(),
    qProjection: padded(),
    kProjection: padded(),
    vProjection: padded(),
    qRope: padded(),
    kRope: padded(),
    attention: padded(),
    outputProjection: padded(),
    windowUnpartition: total(),
    layerNorm2: entry(shape.tokenCount),
    mlpFc1: entry(shape.tokenCount * shape.intermediateSize),
    mlpFc2: total(),
    residualMlp: total(),
  };
}

function validateImageVitBlockStackInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const hiddenStates = ensureFloat32Array(input.hiddenStates, 'hiddenStates');
  const layers = input.weights?.layers;
  if (!Array.isArray(layers)) throw new Error('weights.layers must be an array');
  if (layers.length !== shape.layerCount) throw new Error(`weights.layers length ${layers.length} does not match layer range (${shape.layerCount})`);
  const weights = { layers: [] };
  const expectedLayerIndexes = [];
  for (let layerIndex = shape.startLayerIndex; layerIndex <= shape.endLayerIndex; layerIndex += 1) expectedLayerIndexes.push(layerIndex);
  const validateLayer = (layer, offset) => {
    const expectedLayerIndex = expectedLayerIndexes[offset];
    if (!Number.isInteger(layer?.layerIndex)) throw new Error(`weights.layers[${offset}].layerIndex must be an integer`);
    if (layer.layerIndex !== expectedLayerIndex) throw new Error(`weights.layers[${offset}].layerIndex must be ${expectedLayerIndex}`);
    const out = { layerIndex: layer.layerIndex, isGlobal: layer.isGlobal === true || shape.globalAttnIndexes.includes(layer.layerIndex) };
  for (const name of [
    'layerNorm1Weight', 'layerNorm1Bias', 'qProjWeight', 'qProjBias', 'kProjWeight', 'kProjBias', 'vProjWeight', 'vProjBias', 'oProjWeight', 'oProjBias',
    'layerNorm2Weight', 'layerNorm2Bias', 'mlpFc1Weight', 'mlpFc1Bias', 'mlpFc2Weight', 'mlpFc2Bias',
  ]) {
      out[name] = ensureFloat32Array(layer?.[name], `weights.layers[${offset}].${name}`);
  }
    return out;
  };
  weights.layers = layers.map(validateLayer);
  if (hiddenStates.length !== shape.totalValues) throw new Error(`hiddenStates length ${hiddenStates.length} does not match shape (${shape.totalValues})`);
  for (const [offset, layer] of weights.layers.entries()) {
  for (const name of ['layerNorm1Weight', 'layerNorm1Bias', 'qProjBias', 'kProjBias', 'vProjBias', 'oProjBias', 'layerNorm2Weight', 'layerNorm2Bias', 'mlpFc2Bias']) {
      if (layer[name].length !== shape.hiddenSize) throw new Error(`weights.layers[${offset}].${name} length mismatch`);
  }
  for (const name of ['qProjWeight', 'kProjWeight', 'vProjWeight', 'oProjWeight']) {
      if (layer[name].length !== shape.hiddenSize * shape.hiddenSize) throw new Error(`weights.layers[${offset}].${name} length mismatch`);
  }
    if (layer.mlpFc1Weight.length !== shape.intermediateSize * shape.hiddenSize) throw new Error(`weights.layers[${offset}].mlpFc1Weight length mismatch`);
    if (layer.mlpFc1Bias.length !== shape.intermediateSize) throw new Error(`weights.layers[${offset}].mlpFc1Bias length mismatch`);
    if (layer.mlpFc2Weight.length !== shape.hiddenSize * shape.intermediateSize) throw new Error(`weights.layers[${offset}].mlpFc2Weight length mismatch`);
  }
  return { shape, hiddenStates, weights };
}

function gelu(value) {
  return stableSam3Gelu(value);
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
      const position = (isX ? x : y) * shape.ropeScale;
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

export function createSam3ImageVitBlockStackPhaseProgramCpuOracle(input) {
  const { shape, hiddenStates, weights } = validateImageVitBlockStackInputs(input);
  let current = hiddenStates;
  const layerCheckpoints = [];
  const layerModes = [];
  let lastLayerNorm1 = null;
  let lastWindows = null;
  let lastRope = null;
  let lastAttentionResidual = null;
  let lastLayerNorm2 = null;
  for (const layerWeights of weights.layers) {
    const layerShape = blockShapeForLayer(shape, layerWeights);
    layerModes.push(layerShape.isGlobal ? 'global' : 'window');
    const layerNorm1 = layerNorm(current, layerWeights.layerNorm1Weight, layerWeights.layerNorm1Bias, layerShape.tokenCount, layerShape.hiddenSize, layerShape.layerNormEps);
    const windows = windowPartition(layerNorm1, layerShape);
    const q = linearAll(windows, layerShape.batch * layerShape.windowCount * layerShape.windowTokens, layerShape.hiddenSize, layerShape.hiddenSize, layerWeights.qProjWeight, layerWeights.qProjBias);
    const k = linearAll(windows, layerShape.batch * layerShape.windowCount * layerShape.windowTokens, layerShape.hiddenSize, layerShape.hiddenSize, layerWeights.kProjWeight, layerWeights.kProjBias);
    const v = linearAll(windows, layerShape.batch * layerShape.windowCount * layerShape.windowTokens, layerShape.hiddenSize, layerShape.hiddenSize, layerWeights.vProjWeight, layerWeights.vProjBias);
    const rope = computeAxialRope(layerShape);
    const qRope = applyRope(q, rope, layerShape);
    const kRope = applyRope(k, rope, layerShape);
    const attn = attention(qRope, kRope, v, layerShape);
    const projected = linearAll(attn, layerShape.batch * layerShape.windowCount * layerShape.windowTokens, layerShape.hiddenSize, layerShape.hiddenSize, layerWeights.oProjWeight, layerWeights.oProjBias);
    const attentionResidual = windowUnpartition(projected, current, layerShape);
    const layerNorm2 = layerNorm(attentionResidual, layerWeights.layerNorm2Weight, layerWeights.layerNorm2Bias, layerShape.tokenCount, layerShape.hiddenSize, layerShape.layerNormEps);
    const mlpHidden = linearAll(layerNorm2, layerShape.tokenCount, layerShape.hiddenSize, layerShape.intermediateSize, layerWeights.mlpFc1Weight, layerWeights.mlpFc1Bias, 'gelu');
    const mlpOut = linearAll(mlpHidden, layerShape.tokenCount, layerShape.intermediateSize, layerShape.hiddenSize, layerWeights.mlpFc2Weight, layerWeights.mlpFc2Bias);
    const next = new Float32Array(layerShape.totalValues);
    for (let index = 0; index < layerShape.totalValues; index += 1) next[index] = attentionResidual[index] + mlpOut[index];
    current = next;
    lastLayerNorm1 = layerNorm1;
    lastWindows = windows;
    lastRope = rope;
    lastAttentionResidual = attentionResidual;
    lastLayerNorm2 = layerNorm2;
    layerCheckpoints.push({ layerIndex: layerWeights.layerIndex, isGlobal: layerShape.isGlobal, hiddenStates: next });
  }
  return {
    shape,
    layerRange: { startLayerIndex: shape.startLayerIndex, endLayerIndex: shape.endLayerIndex, layerCount: shape.layerCount, firstGlobalLayerIndex: shape.firstGlobalLayerIndex, finalLayerIndex: shape.finalLayerIndex, fullBackbone: shape.fullBackbone },
    layerModes,
    layerCheckpoints,
    windowPartition: { originalHeight: shape.height, originalWidth: shape.width, windowSize: shape.windowSize, globalWindowSize: shape.globalWindowSize },
    layerNorm1: lastLayerNorm1,
    windows: lastWindows,
    ropeCos: lastRope?.cos,
    ropeSin: lastRope?.sin,
    attentionResidual: lastAttentionResidual,
    layerNorm2: lastLayerNorm2,
    vitBlockStackHiddenStates: current,
  };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image ViT block-stack outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    vitBlockStackHiddenStates: {
      artifactId: roleArtifact(request.outputs, 'vit-block-stack-hidden-states').artifactId,
      sha256: hashes.vitBlockStackHiddenStates,
      shape: [shape.batch, shape.height, shape.width, shape.hiddenSize],
    },
  };
}

export function createSam3ImageVitBlockStackPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: input.model?.id || SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('vit-prefix-hidden-states', input.hiddenStates),
      createRouteReceiptInputArtifact('sam3-image-vit-block-stack-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImageVitBlockStackPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: input.model?.id || SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-vit-block-stack', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImageVitBlockStackPhaseProgramRoute', upstreamBoundary: 'browser-sam3-vit-prefix-to-first-vit-block-hidden-states' },
  });
}

export function summarizeSam3FiniteValues(values) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
    throw new Error('finite checkpoint values must be an array or typed array');
  }
  let finiteCount = 0;
  let nanCount = 0;
  let positiveInfinityCount = 0;
  let negativeInfinityCount = 0;
  let firstNonFinite = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    let kind = null;
    if (Number.isNaN(value)) kind = 'nan';
    else if (value === Number.POSITIVE_INFINITY) kind = 'positive-infinity';
    else if (value === Number.NEGATIVE_INFINITY) kind = 'negative-infinity';
    else if (Number.isFinite(value)) {
      finiteCount += 1;
      continue;
    } else kind = 'non-finite';

    if (firstNonFinite === null) firstNonFinite = { index, kind };
    if (kind === 'nan') nanCount += 1;
    else if (kind === 'positive-infinity') positiveInfinityCount += 1;
    else if (kind === 'negative-infinity') negativeInfinityCount += 1;
  }
  return {
    elementCount: values.length,
    finiteCount,
    nonFiniteCount: values.length - finiteCount,
    nanCount,
    positiveInfinityCount,
    negativeInfinityCount,
    firstNonFinite,
  };
}

export function stableSam3Gelu(value) {
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

export function summarizeSam3LayerParityCheckpoint(layerIndex, isGlobal, expected, actual) {
  if (!(expected instanceof Float32Array) || !(actual instanceof Float32Array)) {
    throw new Error('layer parity expected and actual values must be Float32Array instances');
  }
  if (expected.length !== actual.length) {
    throw new Error(`layer parity length mismatch: expected ${expected.length}, received ${actual.length}`);
  }
  let maxAbsDiff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(expected[index] - actual[index]));
  }
  return { layerIndex, isGlobal, elementCount: actual.length, maxAbsDiff };
}

export function summarizeSam3FinitePhaseOutputs(outputs) {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new Error('finite phase outputs must be an object');
  }
  return Object.entries(outputs).map(([phase, bytes]) => ({
    phase,
    ...summarizeSam3FiniteValues(new Float32Array(bytes)),
  }));
}

export async function runSam3ImageVitBlockStackPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImageVitBlockStackPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const hiddenStatesArtifact = roleArtifact(input.request.inputs, 'vit-prefix-hidden-states');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-image-vit-block-stack-weights');
  const { shape, hiddenStates, weights } = validateImageVitBlockStackInputs(input.tensors || {});
  const expectedLayerCheckpoints = input.expectedLayerCheckpoints == null
    ? null
    : new Map(input.expectedLayerCheckpoints.map(checkpoint => [checkpoint.layerIndex, checkpoint.hiddenStates]));
  if (expectedLayerCheckpoints && expectedLayerCheckpoints.size !== weights.layers.length) {
    throw new Error(`expectedLayerCheckpoints must cover all ${weights.layers.length} executed ViT layers`);
  }

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-vit-block-stack-phase-program',
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
  const maxComputeWorkgroupsPerDimension = input.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535;

  let tensors = null;
  const blockDimsValues = layerShape => ({
    batch: layerShape.batch,
    height: layerShape.height,
    width: layerShape.width,
    channels: layerShape.hiddenSize,
    heads: layerShape.numHeads,
    head_dim: layerShape.headDim,
    window_size: layerShape.windowSize,
    intermediate_size: layerShape.intermediateSize,
    padded_height: layerShape.paddedHeight,
    padded_width: layerShape.paddedWidth,
    windows_per_row: layerShape.windowsPerRow,
    window_count: layerShape.windowCount,
    window_tokens: layerShape.windowTokens,
    total_values: layerShape.totalValues,
    padded_total_values: layerShape.paddedTotalValues,
    rope_scale: layerShape.ropeScale,
  });
  const uploadLayerWeights = (stage, layer) => {
    for (const name of [
      'layerNorm1Weight',
      'layerNorm1Bias',
      'qProjWeight',
      'qProjBias',
      'kProjWeight',
      'kProjBias',
      'vProjWeight',
      'vProjBias',
      'oProjWeight',
      'oProjBias',
      'layerNorm2Weight',
      'layerNorm2Bias',
      'mlpFc1Weight',
      'mlpFc1Bias',
      'mlpFc2Weight',
      'mlpFc2Bias',
    ]) {
      stage.uploadTensor(tensors[name], layer[name]);
    }
  };
  await runtime.runStage('load-image-vit-block-stack-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage });
    tensors = {
      hiddenA: tensor('sam3.image-vit-block-stack.hidden-a', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      hiddenB: tensor('sam3.image-vit-block-stack.hidden-b', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      layerNorm1: tensor('sam3.image-vit-block-stack.layernorm1.out', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      windows: tensor('sam3.image-vit-block-stack.windows', [shape.batch * shape.maxWindowCount, shape.maxWindowSize, shape.maxWindowSize, shape.hiddenSize]),
      q: tensor('sam3.image-vit-block-stack.q', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      k: tensor('sam3.image-vit-block-stack.k', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      v: tensor('sam3.image-vit-block-stack.v', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      qRope: tensor('sam3.image-vit-block-stack.q-rope', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      kRope: tensor('sam3.image-vit-block-stack.k-rope', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      attention: tensor('sam3.image-vit-block-stack.attention', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      projected: tensor('sam3.image-vit-block-stack.projected', [shape.batch * shape.maxWindowCount, shape.maxWindowTokens, shape.hiddenSize]),
      attentionResidual: tensor('sam3.image-vit-block-stack.attention-residual', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      layerNorm2: tensor('sam3.image-vit-block-stack.layernorm2.out', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      mlpHidden: tensor('sam3.image-vit-block-stack.mlp-hidden', [shape.batch, shape.height * shape.width, shape.intermediateSize]),
      mlpOut: tensor('sam3.image-vit-block-stack.mlp-out', [shape.batch, shape.height, shape.width, shape.hiddenSize]),
      layerNorm1Weight: tensor('sam3.image-vit-block-stack.layernorm1.weight', [shape.hiddenSize], readonlyUsage),
      layerNorm1Bias: tensor('sam3.image-vit-block-stack.layernorm1.bias', [shape.hiddenSize], readonlyUsage),
      qProjWeight: tensor('sam3.image-vit-block-stack.q.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      qProjBias: tensor('sam3.image-vit-block-stack.q.bias', [shape.hiddenSize], readonlyUsage),
      kProjWeight: tensor('sam3.image-vit-block-stack.k.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      kProjBias: tensor('sam3.image-vit-block-stack.k.bias', [shape.hiddenSize], readonlyUsage),
      vProjWeight: tensor('sam3.image-vit-block-stack.v.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      vProjBias: tensor('sam3.image-vit-block-stack.v.bias', [shape.hiddenSize], readonlyUsage),
      oProjWeight: tensor('sam3.image-vit-block-stack.o.weight', [shape.hiddenSize, shape.hiddenSize], readonlyUsage),
      oProjBias: tensor('sam3.image-vit-block-stack.o.bias', [shape.hiddenSize], readonlyUsage),
      layerNorm2Weight: tensor('sam3.image-vit-block-stack.layernorm2.weight', [shape.hiddenSize], readonlyUsage),
      layerNorm2Bias: tensor('sam3.image-vit-block-stack.layernorm2.bias', [shape.hiddenSize], readonlyUsage),
      mlpFc1Weight: tensor('sam3.image-vit-block-stack.mlp.fc1.weight', [shape.intermediateSize, shape.hiddenSize], readonlyUsage),
      mlpFc1Bias: tensor('sam3.image-vit-block-stack.mlp.fc1.bias', [shape.intermediateSize], readonlyUsage),
      mlpFc2Weight: tensor('sam3.image-vit-block-stack.mlp.fc2.weight', [shape.hiddenSize, shape.intermediateSize], readonlyUsage),
      mlpFc2Bias: tensor('sam3.image-vit-block-stack.mlp.fc2.bias', [shape.hiddenSize], readonlyUsage),
      blockDims: stage.createUniformBuffer({
        label: 'sam3.image-vit-block-stack.dims',
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
          { name: 'rope_scale', type: 'f32' },
        ],
        values: blockDimsValues(blockShapeForLayer(shape, weights.layers[0])),
      }),
      lnDims: stage.createUniformBuffer({ label: 'sam3.image-vit-block-stack.ln-dims', schema: [{ name: 'token_count', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: '_pad0', type: 'u32' }, { name: '_pad1', type: 'u32' }], values: { token_count: shape.tokenCount, channels: shape.hiddenSize, _pad0: 0, _pad1: 0 } }),
      windowLinearDims: stage.createUniformBuffer({ label: 'sam3.image-vit-block-stack.window-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: '_pad0', type: 'u32' }], values: { input_channels: shape.hiddenSize, output_channels: shape.hiddenSize, total_output: blockShapeForLayer(shape, weights.layers[0]).paddedTotalValues, _pad0: 0 } }),
      fc1Dims: stage.createUniformBuffer({ label: 'sam3.image-vit-block-stack.fc1-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: '_pad0', type: 'u32' }], values: { input_channels: shape.hiddenSize, output_channels: shape.intermediateSize, total_output: shape.tokenCount * shape.intermediateSize, _pad0: 0 } }),
      fc2Dims: stage.createUniformBuffer({ label: 'sam3.image-vit-block-stack.fc2-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: '_pad0', type: 'u32' }], values: { input_channels: shape.intermediateSize, output_channels: shape.hiddenSize, total_output: shape.totalValues, _pad0: 0 } }),
    };
    stage.uploadTensor(tensors.hiddenA, hiddenStates);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-vit-block-stack-upload' });
  }, { shape, referenceBoundary: 'MLX VitBlock: LN1 -> window partition/pad/crop -> pairwise RoPE attention -> residual -> LN2 -> GELU MLP -> residual' });

  const bindTensor = (resource, access = 'read-only-storage') => ({ name: resource.replace(/^tensor:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = resource => ({ name: resource.replace(/^uniform:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const createLayerProgram = ({ layerShape, inputTensorName, outputTensorName }) => {
    const dispatchPlan = createSam3ImageVitBlockStackDispatchPlan({
      shape,
      layerIndex: layerShape.layerIndex,
      isGlobal: layerShape.isGlobal,
      maxWorkgroupsPerDimension: maxComputeWorkgroupsPerDimension,
    });
    const phases = [
      { name: 'vit-block-stack-layernorm1', kernel: 'layerNorm1', dispatch: dispatchPlan.layerNorm1.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-window-partition', kernel: 'windowPartition', dispatch: dispatchPlan.windowPartition.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-qkv-projection', kernel: 'qProjection', dispatch: dispatchPlan.qProjection.dispatch, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-qkv-projection', kernel: 'kProjection', dispatch: dispatchPlan.kProjection.dispatch, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-qkv-projection', kernel: 'vProjection', dispatch: dispatchPlan.vProjection.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-rope-attention', kernel: 'qRope', dispatch: dispatchPlan.qRope.dispatch, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-rope-attention', kernel: 'kRope', dispatch: dispatchPlan.kRope.dispatch, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: layerShape.isGlobal ? 'vit-block-stack-global-attention' : 'vit-block-stack-rope-attention', kernel: 'attention', dispatch: dispatchPlan.attention.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-output-projection', kernel: 'outputProjection', dispatch: dispatchPlan.outputProjection.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-window-unpartition', kernel: 'windowUnpartition', dispatch: dispatchPlan.windowUnpartition.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-layernorm2', kernel: 'layerNorm2', dispatch: dispatchPlan.layerNorm2.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-gelu-mlp', kernel: 'mlpFc1', dispatch: dispatchPlan.mlpFc1.dispatch, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-gelu-mlp', kernel: 'mlpFc2', dispatch: dispatchPlan.mlpFc2.dispatch, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
      { name: 'vit-block-stack-gelu-mlp', kernel: 'residualMlp', dispatch: dispatchPlan.residualMlp.dispatch, yieldAfter: true, metadata: { layerIndex: layerShape.layerIndex, isGlobal: layerShape.isGlobal } },
    ];
    const phaseTensorNames = {
      layerNorm1: 'layerNorm1',
      windowPartition: 'windows',
      qProjection: 'q',
      kProjection: 'k',
      vProjection: 'v',
      qRope: 'qRope',
      kRope: 'kRope',
      attention: 'attention',
      outputProjection: 'projected',
      windowUnpartition: 'attentionResidual',
      layerNorm2: 'layerNorm2',
      mlpFc1: 'mlpHidden',
      mlpFc2: 'mlpOut',
      residualMlp: outputTensorName,
    };
    const instrumentedPhases = input.validateFinitePhaseLayerIndex === layerShape.layerIndex
      ? phases.flatMap(phase => [
          phase,
          {
            name: `validate-vit-block-stack-layer-${layerShape.layerIndex}-${phase.kernel}-finite`,
            readback: { name: phase.kernel, tensor: `tensor:${phaseTensorNames[phase.kernel]}` },
            metadata: { layerIndex: layerShape.layerIndex, kernel: phase.kernel, diagnostic: 'finite-phase-checkpoint' },
          },
        ])
      : phases;
    return runtime.defineProgram({
    name: `sam3.image-vit-block-stack-layer-${layerShape.layerIndex}-phase-program`,
    tensors,
    uniforms: { blockDims: tensors.blockDims, lnDims: tensors.lnDims, windowLinearDims: tensors.windowLinearDims, fc1Dims: tensors.fc1Dims, fc2Dims: tensors.fc2Dims },
    kernels: {
      layerNorm1: { code: LAYERNORM_WGSL, bindings: [bindTensor(`tensor:${inputTensorName}`), bindTensor('tensor:layerNorm1Weight'), bindTensor('tensor:layerNorm1Bias'), bindTensor('tensor:layerNorm1', 'storage'), bindUniform('uniform:lnDims')] },
      windowPartition: { code: WINDOW_PARTITION_WGSL, bindings: [bindTensor('tensor:layerNorm1'), bindTensor('tensor:windows', 'storage'), bindUniform('uniform:blockDims')] },
      qProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:windows'), bindTensor('tensor:qProjWeight'), bindTensor('tensor:qProjBias'), bindTensor('tensor:q', 'storage'), bindUniform('uniform:windowLinearDims')] },
      kProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:windows'), bindTensor('tensor:kProjWeight'), bindTensor('tensor:kProjBias'), bindTensor('tensor:k', 'storage'), bindUniform('uniform:windowLinearDims')] },
      vProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:windows'), bindTensor('tensor:vProjWeight'), bindTensor('tensor:vProjBias'), bindTensor('tensor:v', 'storage'), bindUniform('uniform:windowLinearDims')] },
      qRope: { code: ROPE_WGSL, bindings: [bindTensor('tensor:q'), bindTensor('tensor:qRope', 'storage'), bindUniform('uniform:blockDims')] },
      kRope: { code: ROPE_WGSL, bindings: [bindTensor('tensor:k'), bindTensor('tensor:kRope', 'storage'), bindUniform('uniform:blockDims')] },
      attention: { code: ATTENTION_WGSL, bindings: [bindTensor('tensor:qRope'), bindTensor('tensor:kRope'), bindTensor('tensor:v'), bindTensor('tensor:attention', 'storage'), bindUniform('uniform:blockDims')] },
      outputProjection: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:attention'), bindTensor('tensor:oProjWeight'), bindTensor('tensor:oProjBias'), bindTensor('tensor:projected', 'storage'), bindUniform('uniform:windowLinearDims')] },
      windowUnpartition: { code: WINDOW_UNPARTITION_WGSL, bindings: [bindTensor('tensor:projected'), bindTensor(`tensor:${inputTensorName}`), bindTensor('tensor:attentionResidual', 'storage'), bindUniform('uniform:blockDims')] },
      layerNorm2: { code: LAYERNORM_WGSL, bindings: [bindTensor('tensor:attentionResidual'), bindTensor('tensor:layerNorm2Weight'), bindTensor('tensor:layerNorm2Bias'), bindTensor('tensor:layerNorm2', 'storage'), bindUniform('uniform:lnDims')] },
      mlpFc1: { code: LINEAR_GELU_WGSL, bindings: [bindTensor('tensor:layerNorm2'), bindTensor('tensor:mlpFc1Weight'), bindTensor('tensor:mlpFc1Bias'), bindTensor('tensor:mlpHidden', 'storage'), bindUniform('uniform:fc1Dims')] },
      mlpFc2: { code: LINEAR_WGSL, bindings: [bindTensor('tensor:mlpHidden'), bindTensor('tensor:mlpFc2Weight'), bindTensor('tensor:mlpFc2Bias'), bindTensor('tensor:mlpOut', 'storage'), bindUniform('uniform:fc2Dims')] },
      residualMlp: { code: RESIDUAL_ADD_WGSL, bindings: [bindTensor('tensor:attentionResidual'), bindTensor('tensor:mlpOut'), bindTensor(`tensor:${outputTensorName}`, 'storage'), bindUniform('uniform:blockDims')] },
    },
    phases: instrumentedPhases,
    metadata: { routeId: SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID, layout: 'B,H,W,C', referenceBoundary: shape.fullBackbone ? 'SAM3 image ViT contiguous full backbone' : 'SAM3 image ViT contiguous block stack through first global attention' },
  });
  };

  await runtime.runStage('vit-block-stack-layer-range', async stage => {
    await stage.yieldToBrowser({ reason: 'sam3-image-vit-block-stack-layer-range-established', metadata: { startLayerIndex: shape.startLayerIndex, endLayerIndex: shape.endLayerIndex, firstGlobalLayerIndex: shape.firstGlobalLayerIndex, finalLayerIndex: shape.finalLayerIndex, fullBackbone: shape.fullBackbone } });
  }, { startLayerIndex: shape.startLayerIndex, endLayerIndex: shape.endLayerIndex, firstGlobalLayerIndex: shape.firstGlobalLayerIndex, finalLayerIndex: shape.finalLayerIndex, fullBackbone: shape.fullBackbone, global_attn_indexes: shape.globalAttnIndexes });

  let inputTensorName = 'hiddenA';
  let outputTensorName = 'hiddenB';
  const finiteCheckpoints = [];
  const finitePhaseCheckpoints = [];
  for (const layer of weights.layers) {
    const layerShape = blockShapeForLayer(shape, layer);
    await runtime.runStage('vit-block-stack-layer-range', async stage => {
      uploadLayerWeights(stage, layer);
      tensors.blockDims.update(blockDimsValues(layerShape));
      tensors.windowLinearDims.update({ input_channels: shape.hiddenSize, output_channels: shape.hiddenSize, total_output: layerShape.paddedTotalValues, _pad0: 0 });
      await stage.yieldToBrowser({ reason: 'sam3-image-vit-block-stack-layer-upload', metadata: { layerIndex: layer.layerIndex, isGlobal: layerShape.isGlobal, windowSize: layerShape.windowSize } });
    }, { layerIndex: layer.layerIndex, isGlobal: layerShape.isGlobal, windowSize: layerShape.windowSize, windowTokens: layerShape.windowTokens });
    const program = createLayerProgram({ layerShape, inputTensorName, outputTensorName });
    const programRun = await runtime.runProgram(program);
    if (input.validateFinitePhaseLayerIndex === layer.layerIndex) {
      const phaseEvidence = summarizeSam3FinitePhaseOutputs(programRun.outputs);
      finitePhaseCheckpoints.push({ layerIndex: layer.layerIndex, phases: phaseEvidence });
      const firstNonFinitePhase = phaseEvidence.find(checkpoint => checkpoint.nonFiniteCount > 0);
      if (firstNonFinitePhase) {
        runtime.dispose();
        throw new Error(`SAM3 ViT block layer ${layer.layerIndex} first non-finite phase: ${JSON.stringify(firstNonFinitePhase)}; phase checkpoints: ${JSON.stringify(phaseEvidence)}`);
      }
    }
    if (input.validateFiniteCheckpoints === true) {
      const checkpointBytes = await runtime.runStage(
        `validate-vit-block-stack-layer-${layer.layerIndex}-finite`,
        stage => stage.readTensor(tensors[outputTensorName]),
        { layerIndex: layer.layerIndex, isGlobal: layerShape.isGlobal, outputTensor: outputTensorName },
      );
      const checkpointValues = new Float32Array(checkpointBytes);
      const checkpoint = {
        layerIndex: layer.layerIndex,
        isGlobal: layerShape.isGlobal,
        ...summarizeSam3FiniteValues(checkpointValues),
        ...(expectedLayerCheckpoints ? summarizeSam3LayerParityCheckpoint(
          layer.layerIndex,
          layerShape.isGlobal,
          expectedLayerCheckpoints.get(layer.layerIndex),
          checkpointValues,
        ) : {}),
      };
      finiteCheckpoints.push(checkpoint);
      if (checkpoint.nonFiniteCount > 0) {
        runtime.dispose();
        throw new Error(`SAM3 ViT block layer ${layer.layerIndex} produced non-finite checkpoint: ${JSON.stringify(checkpoint)}`);
      }
    }
    [inputTensorName, outputTensorName] = [outputTensorName, inputTensorName];
  }

  const readback = await runtime.runStage('readback-vit-block-stack-hidden-states', async stage => ({
    vitBlockStackHiddenStates: await stage.readTensor(tensors[inputTensorName]),
  }), { outputTensor: inputTensorName, outputRole: 'vit-block-stack-hidden-states' });
  const outputs = outputArtifacts(input.request, {
    vitBlockStackHiddenStates: await sha256Hex(readback.vitBlockStackHiddenStates),
  }, shape);
  const receipt = createSam3ImageVitBlockStackPhaseProgramRouteReceipt({
    sourceImage,
    hiddenStates: hiddenStatesArtifact,
    weights: weightsArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { id: input.model?.id || route.model?.id, revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  });
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  authoritative.finiteCheckpoints = finiteCheckpoints;
  authoritative.finitePhaseCheckpoints = finitePhaseCheckpoints;
  if (input.includeReadback === true) {
    authoritative.debugReadback = {
      mode: 'explicit-debug-evidence',
      vitBlockStackHiddenStates: Array.from(new Float32Array(readback.vitBlockStackHiddenStates)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}
