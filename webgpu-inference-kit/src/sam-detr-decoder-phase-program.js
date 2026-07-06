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

export const SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.detr-decoder.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-detr-decoder-phase-program-v0';
const INPUT_ROLES = ['source-image', 'sam3-detr-decoder-tensors', 'sam3-detr-decoder-weights'];
const OUTPUT_ROLES = [
  { key: 'lastHs', role: 'last-hs', required: true },
  { key: 'decoderHiddenStates', role: 'decoder-hidden-states', required: false },
  { key: 'referenceBoxes', role: 'reference-boxes', required: true },
  { key: 'presenceLogits', role: 'presence-logits', required: true },
];

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

const ATTENTION_MASKED_WGSL = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_output: u32,
  mask_mode: u32,
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
    if (dims.mask_mode == 1u && key_mask[batch * dims.key_tokens + token] <= 0.0) {
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
    if (dims.mask_mode == 1u && key_mask[batch * dims.key_tokens + token] <= 0.0) {
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

const ATTENTION_BIAS_WGSL = `
struct AttentionDims {
  batch: u32,
  query_tokens: u32,
  key_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  total_output: u32,
  mask_mode: u32,
};

@group(0) @binding(0) var<storage, read> q_values: array<f32>;
@group(0) @binding(1) var<storage, read> k_values: array<f32>;
@group(0) @binding(2) var<storage, read> v_values: array<f32>;
@group(0) @binding(3) var<storage, read> bias_values: array<f32>;
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
  let bias_base = ((batch * dims.heads + head) * dims.query_tokens + query) * dims.key_tokens;
  let scale = inverseSqrt(f32(dims.head_dim));
  var max_score = -340282346638528859811704183484516925440.0;
  for (var token = 0u; token < dims.key_tokens; token = token + 1u) {
    var score = 0.0;
    let k_base = (batch * dims.key_tokens + token) * dims.channels + head_offset;
    for (var d = 0u; d < dims.head_dim; d = d + 1u) {
      score = score + q_values[q_base + d] * k_values[k_base + d];
    }
    score = score * scale + bias_values[bias_base + token];
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
    score = score * scale + bias_values[bias_base + token];
    let weight = exp(score - max_score);
    let v_index = (batch * dims.key_tokens + token) * dims.channels + head_offset + dim_in_head;
    denom = denom + weight;
    value = value + weight * v_values[v_index];
  }
  output_values[index] = value / denom;
}
`;

const SINE_BOX_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> reference_boxes: array<f32>;
@group(0) @binding(1) var<storage, read_write> sine_output: array<f32>;
@group(0) @binding(2) var<uniform> dims: DecoderDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.query_tokens * dims.channels * 2u;
  if (index >= total) { return; }
  let feature = index % (dims.channels * 2u);
  let query = (index / (dims.channels * 2u)) % dims.query_tokens;
  let batch = index / (dims.query_tokens * dims.channels * 2u);
  let coord_group = feature / dims.sine_features;
  let dim = feature % dims.sine_features;
  let box_base = (batch * dims.query_tokens + query) * 4u;
  var coord = reference_boxes[box_base + 1u];
  if (coord_group == 1u) {
    coord = reference_boxes[box_base];
  } else if (coord_group == 2u) {
    coord = reference_boxes[box_base + 2u];
  } else if (coord_group == 3u) {
    coord = reference_boxes[box_base + 3u];
  }
  let pair = f32(dim / 2u);
  let dim_t = pow(10000.0, (2.0 * pair) / f32(dims.sine_features));
  let value = coord * 6.283185307179586 / dim_t;
  if ((dim % 2u) == 0u) {
    sine_output[index] = sin(value);
  } else {
    sine_output[index] = cos(value);
  }
}
`;

const PAD_QUERY_POS_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> query_pos: array<f32>;
@group(0) @binding(1) var<storage, read_write> padded_pos: array<f32>;
@group(0) @binding(2) var<uniform> dims: DecoderDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * (dims.query_tokens + 1u) * dims.channels;
  if (index >= total) { return; }
  let channel = index % dims.channels;
  let token = (index / dims.channels) % (dims.query_tokens + 1u);
  let batch = index / ((dims.query_tokens + 1u) * dims.channels);
  if (token == 0u) {
    padded_pos[index] = 0.0;
  } else {
    padded_pos[index] = query_pos[(batch * dims.query_tokens + token - 1u) * dims.channels + channel];
  }
}
`;

const SLICE_QUERIES_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> hidden_states: array<f32>;
@group(0) @binding(1) var<storage, read_write> query_states: array<f32>;
@group(0) @binding(2) var<uniform> dims: DecoderDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.query_tokens * dims.channels;
  if (index >= total) { return; }
  let channel = index % dims.channels;
  let query = (index / dims.channels) % dims.query_tokens;
  let batch = index / (dims.query_tokens * dims.channels);
  query_states[index] = hidden_states[(batch * (dims.query_tokens + 1u) + query + 1u) * dims.channels + channel];
}
`;

const SLICE_PRESENCE_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> hidden_states: array<f32>;
@group(0) @binding(1) var<storage, read_write> presence_states: array<f32>;
@group(0) @binding(2) var<uniform> dims: DecoderDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.channels;
  if (index >= total) { return; }
  let channel = index % dims.channels;
  let batch = index / dims.channels;
  presence_states[index] = hidden_states[batch * (dims.query_tokens + 1u) * dims.channels + channel];
}
`;

const BOX_APPLY_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> previous_boxes: array<f32>;
@group(0) @binding(1) var<storage, read> box_delta: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_boxes: array<f32>;
@group(0) @binding(3) var<uniform> dims: DecoderDims;

fn sigmoid(x: f32) -> f32 {
  return 1.0 / (1.0 + exp(-x));
}

fn inverse_sigmoid(x: f32) -> f32 {
  let clamped = clamp(x, 0.00001, 0.99999);
  return log(clamped / (1.0 - clamped));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.query_tokens * 4u;
  if (index >= total) { return; }
  output_boxes[index] = sigmoid(inverse_sigmoid(previous_boxes[index]) + box_delta[index]);
}
`;

const PRESENCE_HEAD_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> presence_states: array<f32>;
@group(0) @binding(1) var<storage, read> layer1_weight: array<f32>;
@group(0) @binding(2) var<storage, read> layer1_bias: array<f32>;
@group(0) @binding(3) var<storage, read> layer2_weight: array<f32>;
@group(0) @binding(4) var<storage, read> layer2_bias: array<f32>;
@group(0) @binding(5) var<storage, read> layer3_weight: array<f32>;
@group(0) @binding(6) var<storage, read> layer3_bias: array<f32>;
@group(0) @binding(7) var<storage, read_write> output_logits: array<f32>;
@group(0) @binding(8) var<uniform> dims: DecoderDims;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let batch = gid.x;
  if (batch >= dims.batch) { return; }
  var hidden1: array<f32, 256>;
  var hidden2: array<f32, 256>;
  for (var oc = 0u; oc < dims.channels; oc = oc + 1u) {
    var sum = layer1_bias[oc];
    for (var ic = 0u; ic < dims.channels; ic = ic + 1u) {
      sum = sum + presence_states[batch * dims.channels + ic] * layer1_weight[oc * dims.channels + ic];
    }
    hidden1[oc] = max(sum, 0.0);
  }
  for (var oc = 0u; oc < dims.channels; oc = oc + 1u) {
    var sum = layer2_bias[oc];
    for (var ic = 0u; ic < dims.channels; ic = ic + 1u) {
      sum = sum + hidden1[ic] * layer2_weight[oc * dims.channels + ic];
    }
    hidden2[oc] = max(sum, 0.0);
  }
  var logit = layer3_bias[0];
  for (var ic = 0u; ic < dims.channels; ic = ic + 1u) {
    logit = logit + hidden2[ic] * layer3_weight[ic];
  }
  output_logits[batch] = clamp(logit, -10.0, 10.0);
}
`;

const RPB_AXIS_HIDDEN_WGSL = `
struct RpbAxisDims {
  batch: u32,
  query_tokens: u32,
  axis_tokens: u32,
  channels: u32,
  coord_axis: u32,
};

@group(0) @binding(0) var<storage, read> reference_boxes: array<f32>;
@group(0) @binding(1) var<storage, read> layer1_weight: array<f32>;
@group(0) @binding(2) var<storage, read> layer1_bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> axis_hidden: array<f32>;
@group(0) @binding(4) var<uniform> dims: RpbAxisDims;

fn log_delta(value: f32) -> f32 {
  let scaled = value * 8.0;
  return sign(scaled) * log2(abs(scaled) + 1.0) / log2(8.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.query_tokens * dims.axis_tokens * dims.channels;
  if (index >= total) { return; }
  let channel = index % dims.channels;
  let axis_index = (index / dims.channels) % dims.axis_tokens;
  let query = (index / (dims.channels * dims.axis_tokens)) % dims.query_tokens;
  let batch = index / (dims.channels * dims.axis_tokens * dims.query_tokens);
  let box_base = (batch * dims.query_tokens + query) * 4u;
  let center = select(reference_boxes[box_base], reference_boxes[box_base + 1u], dims.coord_axis == 1u);
  let size = select(reference_boxes[box_base + 2u], reference_boxes[box_base + 3u], dims.coord_axis == 1u);
  let coord = (f32(axis_index) + 0.5) / f32(dims.axis_tokens);
  let delta0 = log_delta(coord - (center - size / 2.0));
  let delta1 = log_delta(coord - (center + size / 2.0));
  axis_hidden[index] = max(layer1_bias[channel] + delta0 * layer1_weight[channel * 2u] + delta1 * layer1_weight[channel * 2u + 1u], 0.0);
}
`;

const RPB_COMBINE_WGSL = `
struct DecoderDims {
  batch: u32,
  query_tokens: u32,
  prompt_tokens: u32,
  spatial_tokens: u32,
  channels: u32,
  heads: u32,
  head_dim: u32,
  mlp_hidden: u32,
  height: u32,
  width: u32,
  sine_features: u32,
  total: u32,
};

@group(0) @binding(0) var<storage, read> x_hidden: array<f32>;
@group(0) @binding(1) var<storage, read> x_layer2_weight: array<f32>;
@group(0) @binding(2) var<storage, read> x_layer2_bias: array<f32>;
@group(0) @binding(3) var<storage, read> y_hidden: array<f32>;
@group(0) @binding(4) var<storage, read> y_layer2_weight: array<f32>;
@group(0) @binding(5) var<storage, read> y_layer2_bias: array<f32>;
@group(0) @binding(6) var<storage, read_write> output_bias: array<f32>;
@group(0) @binding(7) var<uniform> dims: DecoderDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch * dims.heads * (dims.query_tokens + 1u) * dims.spatial_tokens;
  if (index >= total) { return; }
  let spatial = index % dims.spatial_tokens;
  let token_with_presence = (index / dims.spatial_tokens) % (dims.query_tokens + 1u);
  let head = (index / (dims.spatial_tokens * (dims.query_tokens + 1u))) % dims.heads;
  let batch = index / (dims.spatial_tokens * (dims.query_tokens + 1u) * dims.heads);
  if (token_with_presence == 0u) {
    output_bias[index] = 0.0;
    return;
  }
  let query = token_with_presence - 1u;
  let x = spatial % dims.width;
  let y = spatial / dims.width;
  let x_base = ((batch * dims.query_tokens + query) * dims.width + x) * dims.channels;
  let y_base = ((batch * dims.query_tokens + query) * dims.height + y) * dims.channels;
  var x_score = x_layer2_bias[head];
  var y_score = y_layer2_bias[head];
  for (var c = 0u; c < dims.channels; c = c + 1u) {
    x_score = x_score + x_hidden[x_base + c] * x_layer2_weight[head * dims.channels + c];
    y_score = y_score + y_hidden[y_base + c] * y_layer2_weight[head * dims.channels + c];
  }
  output_bias[index] = x_score + y_score;
}
`;

const DETR_DECODER_ROUTE_SOURCE_MARKERS = [
  'defineProgram',
  'runProgram',
  'detr-decoder-sine-box-position',
  'detr-decoder-box-rpb',
  'detr-decoder-vision-attention-softmax',
  'detr-decoder-box-refinement',
];

function requiredStages(layerCount = 6) {
  const stages = ['load-detr-decoder-tensors'];
  for (let layer = 0; layer < layerCount; layer += 1) {
    stages.push(
      `detr-decoder-sine-box-position-${layer}`,
      `detr-decoder-ref-point-head-1-${layer}`,
      `detr-decoder-ref-point-head-${layer}`,
      `detr-decoder-pad-query-position-${layer}`,
      `detr-decoder-box-rpb-x-hidden-${layer}`,
      `detr-decoder-box-rpb-y-hidden-${layer}`,
      `detr-decoder-box-rpb-${layer}`,
      `detr-decoder-self-add-pos-${layer}`,
      `detr-decoder-self-q-${layer}`,
      `detr-decoder-self-k-${layer}`,
      `detr-decoder-self-v-${layer}`,
      `detr-decoder-self-attention-softmax-${layer}`,
      `detr-decoder-self-output-${layer}`,
      `detr-decoder-self-residual-${layer}`,
      `detr-decoder-self-layernorm-${layer}`,
      `detr-decoder-text-add-pos-${layer}`,
      `detr-decoder-text-q-${layer}`,
      `detr-decoder-text-k-${layer}`,
      `detr-decoder-text-v-${layer}`,
      `detr-decoder-text-attention-softmax-${layer}`,
      `detr-decoder-text-output-${layer}`,
      `detr-decoder-text-residual-${layer}`,
      `detr-decoder-text-layernorm-${layer}`,
      `detr-decoder-vision-add-pos-${layer}`,
      `detr-decoder-vision-q-${layer}`,
      `detr-decoder-vision-key-add-pos-${layer}`,
      `detr-decoder-vision-k-${layer}`,
      `detr-decoder-vision-v-${layer}`,
      `detr-decoder-vision-attention-softmax-${layer}`,
      `detr-decoder-vision-output-${layer}`,
      `detr-decoder-vision-residual-${layer}`,
      `detr-decoder-vision-layernorm-${layer}`,
      `detr-decoder-mlp-fc1-${layer}`,
      `detr-decoder-mlp-fc2-${layer}`,
      `detr-decoder-mlp-residual-${layer}`,
      `detr-decoder-mlp-${layer}`,
      `detr-decoder-slice-query-${layer}`,
      `detr-decoder-output-layernorm-${layer}`,
      `detr-decoder-box-head-1-${layer}`,
      `detr-decoder-box-head-2-${layer}`,
      `detr-decoder-box-head-3-${layer}`,
      `detr-decoder-box-refinement-${layer}`,
      `detr-decoder-slice-presence-${layer}`,
      `detr-decoder-presence-layernorm-${layer}`,
      `detr-decoder-presence-head-${layer}`,
    );
  }
  stages.push('readback-detr-decoder-outputs');
  return stages;
}

function createDefaultScheduler(layerCount = 6) {
  const stages = requiredStages(layerCount);
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(stages.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: stages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-detr-decoder-outputs' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: stages.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-detr-decoder-outputs' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-detr-decoder-outputs' })),
      notes: 'SAM3 DETR decoder phase program cooperates between query sine position, BoxRPB, self/text/vision attention, box refinement, presence, and readback phases.',
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
  const queryTokens = shape.queryTokens;
  const promptTokens = shape.promptTokens;
  const spatialTokens = shape.spatialTokens;
  const channels = shape.channels;
  const heads = shape.heads || 8;
  const layerCount = shape.layerCount || 6;
  const mlpHidden = shape.mlpHidden || 2048;
  const sineFeatures = shape.sineFeatures || channels / 2;
  const height = shape.height;
  const width = shape.width;
  if (!Number.isInteger(batch) || batch <= 0) throw new Error('shape.batch must be a positive integer');
  if (!Number.isInteger(queryTokens) || queryTokens <= 0) throw new Error('shape.queryTokens must be a positive integer');
  if (!Number.isInteger(promptTokens) || promptTokens <= 0) throw new Error('shape.promptTokens must be a positive integer');
  if (!Number.isInteger(spatialTokens) || spatialTokens <= 0) throw new Error('shape.spatialTokens must be a positive integer');
  if (!Number.isInteger(channels) || channels <= 0) throw new Error('shape.channels must be a positive integer');
  if (!Number.isInteger(heads) || heads <= 0 || channels % heads !== 0) throw new Error('shape.heads must divide channels');
  if (!Number.isInteger(layerCount) || layerCount <= 0) throw new Error('shape.layerCount must be a positive integer');
  if (!Number.isInteger(mlpHidden) || mlpHidden <= 0) throw new Error('shape.mlpHidden must be a positive integer');
  if (!Number.isInteger(sineFeatures) || sineFeatures <= 0) throw new Error('shape.sineFeatures must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new Error('shape.height must be a positive integer');
  if (!Number.isInteger(width) || width <= 0) throw new Error('shape.width must be a positive integer');
  if (height * width !== spatialTokens) throw new Error('shape.height * shape.width must equal spatialTokens');
  return { batch, queryTokens, promptTokens, spatialTokens, channels, heads, layerCount, mlpHidden, sineFeatures, headDim: channels / heads, height, width };
}

function requireLen(array, length, name) {
  if (array.length !== length) throw new Error(`${name} length mismatch`);
}

function validateDecoderLayer(layer, index, shape) {
  if (!layer || typeof layer !== 'object') throw new Error(`layers.${index} is required`);
  const names = [
    'selfQWeight', 'selfQBias', 'selfKWeight', 'selfKBias', 'selfVWeight', 'selfVBias', 'selfOWeight', 'selfOBias', 'selfLayerNormWeight', 'selfLayerNormBias',
    'textQWeight', 'textQBias', 'textKWeight', 'textKBias', 'textVWeight', 'textVBias', 'textOWeight', 'textOBias', 'textLayerNormWeight', 'textLayerNormBias',
    'visionQWeight', 'visionQBias', 'visionKWeight', 'visionKBias', 'visionVWeight', 'visionVBias', 'visionOWeight', 'visionOBias', 'visionLayerNormWeight', 'visionLayerNormBias',
    'fc1Weight', 'fc1Bias', 'fc2Weight', 'fc2Bias', 'mlpLayerNormWeight', 'mlpLayerNormBias',
  ];
  const out = {};
  for (const name of names) out[name] = ensureFloat32Array(layer[name], `layers.${index}.${name}`);
  for (const name of names.filter(name => name.endsWith('Bias') || name.endsWith('NormWeight'))) {
    if (name === 'fc1Bias') continue;
    requireLen(out[name], shape.channels, `layers.${index}.${name}`);
  }
  for (const name of ['selfQWeight', 'selfKWeight', 'selfVWeight', 'selfOWeight', 'textQWeight', 'textKWeight', 'textVWeight', 'textOWeight', 'visionQWeight', 'visionKWeight', 'visionVWeight', 'visionOWeight']) {
    requireLen(out[name], shape.channels * shape.channels, `layers.${index}.${name}`);
  }
  requireLen(out.fc1Weight, shape.mlpHidden * shape.channels, `layers.${index}.fc1Weight`);
  requireLen(out.fc1Bias, shape.mlpHidden, `layers.${index}.fc1Bias`);
  requireLen(out.fc2Weight, shape.channels * shape.mlpHidden, `layers.${index}.fc2Weight`);
  requireLen(out.fc2Bias, shape.channels, `layers.${index}.fc2Bias`);
  return out;
}

function validateDecoderInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const visionFeatures = ensureFloat32Array(input.visionFeatures, 'visionFeatures');
  const visionPosEncoding = ensureFloat32Array(input.visionPosEncoding, 'visionPosEncoding');
  const promptFeatures = ensureFloat32Array(input.promptFeatures, 'promptFeatures');
  const promptMask = ensureFloat32Array(input.promptMask, 'promptMask');
  const queryEmbed = ensureFloat32Array(input.queryEmbed, 'queryEmbed');
  const referencePoints = ensureFloat32Array(input.referencePoints, 'referencePoints');
  const presenceToken = ensureFloat32Array(input.presenceToken, 'presenceToken');
  requireLen(visionFeatures, shape.batch * shape.spatialTokens * shape.channels, 'visionFeatures');
  requireLen(visionPosEncoding, visionFeatures.length, 'visionPosEncoding');
  requireLen(promptFeatures, shape.batch * shape.promptTokens * shape.channels, 'promptFeatures');
  requireLen(promptMask, shape.batch * shape.promptTokens, 'promptMask');
  requireLen(queryEmbed, shape.queryTokens * shape.channels, 'queryEmbed');
  requireLen(referencePoints, shape.queryTokens * 4, 'referencePoints');
  requireLen(presenceToken, shape.channels, 'presenceToken');
  if (!Array.isArray(input.layers) || input.layers.length !== shape.layerCount) throw new Error('layers length must equal shape.layerCount');
  const layers = input.layers.map((layer, index) => validateDecoderLayer(layer, index, shape));
  const shared = {};
  for (const name of [
    'outputLayerNormWeight', 'outputLayerNormBias',
    'refPointHeadLayer1Weight', 'refPointHeadLayer1Bias', 'refPointHeadLayer2Weight', 'refPointHeadLayer2Bias',
    'boxHeadLayer1Weight', 'boxHeadLayer1Bias', 'boxHeadLayer2Weight', 'boxHeadLayer2Bias', 'boxHeadLayer3Weight', 'boxHeadLayer3Bias',
    'boxRpbXLayer1Weight', 'boxRpbXLayer1Bias', 'boxRpbXLayer2Weight', 'boxRpbXLayer2Bias',
    'boxRpbYLayer1Weight', 'boxRpbYLayer1Bias', 'boxRpbYLayer2Weight', 'boxRpbYLayer2Bias',
    'presenceLayerNormWeight', 'presenceLayerNormBias', 'presenceHeadLayer1Weight', 'presenceHeadLayer1Bias', 'presenceHeadLayer2Weight', 'presenceHeadLayer2Bias', 'presenceHeadLayer3Weight', 'presenceHeadLayer3Bias',
  ]) {
    shared[name] = ensureFloat32Array(input[name], name);
  }
  for (const name of ['outputLayerNormWeight', 'outputLayerNormBias', 'refPointHeadLayer1Bias', 'refPointHeadLayer2Bias', 'boxHeadLayer1Bias', 'boxHeadLayer2Bias', 'boxRpbXLayer1Bias', 'boxRpbYLayer1Bias', 'presenceLayerNormWeight', 'presenceLayerNormBias', 'presenceHeadLayer1Bias', 'presenceHeadLayer2Bias']) requireLen(shared[name], shape.channels, name);
  requireLen(shared.refPointHeadLayer1Weight, shape.channels * shape.channels * 2, 'refPointHeadLayer1Weight');
  requireLen(shared.refPointHeadLayer2Weight, shape.channels * shape.channels, 'refPointHeadLayer2Weight');
  requireLen(shared.boxHeadLayer1Weight, shape.channels * shape.channels, 'boxHeadLayer1Weight');
  requireLen(shared.boxHeadLayer2Weight, shape.channels * shape.channels, 'boxHeadLayer2Weight');
  requireLen(shared.boxHeadLayer3Weight, 4 * shape.channels, 'boxHeadLayer3Weight');
  requireLen(shared.boxHeadLayer3Bias, 4, 'boxHeadLayer3Bias');
  requireLen(shared.boxRpbXLayer1Weight, shape.channels * 2, 'boxRpbXLayer1Weight');
  requireLen(shared.boxRpbXLayer2Weight, shape.heads * shape.channels, 'boxRpbXLayer2Weight');
  requireLen(shared.boxRpbXLayer2Bias, shape.heads, 'boxRpbXLayer2Bias');
  requireLen(shared.boxRpbYLayer1Weight, shape.channels * 2, 'boxRpbYLayer1Weight');
  requireLen(shared.boxRpbYLayer2Weight, shape.heads * shape.channels, 'boxRpbYLayer2Weight');
  requireLen(shared.boxRpbYLayer2Bias, shape.heads, 'boxRpbYLayer2Bias');
  requireLen(shared.presenceHeadLayer1Weight, shape.channels * shape.channels, 'presenceHeadLayer1Weight');
  requireLen(shared.presenceHeadLayer2Weight, shape.channels * shape.channels, 'presenceHeadLayer2Weight');
  requireLen(shared.presenceHeadLayer3Weight, shape.channels, 'presenceHeadLayer3Weight');
  requireLen(shared.presenceHeadLayer3Bias, 1, 'presenceHeadLayer3Bias');
  return { shape, visionFeatures, visionPosEncoding, promptFeatures, promptMask, queryEmbed, referencePoints, presenceToken, layers, shared };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function inverseSigmoid(x) {
  const clipped = Math.min(Math.max(x, 1e-5), 1 - 1e-5);
  return Math.log(clipped / (1 - clipped));
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
    const inputBase = token * inputChannels;
    const outputBase = token * outputChannels;
    for (let oc = 0; oc < outputChannels; oc += 1) {
      let sum = bias[oc];
      const weightBase = oc * inputChannels;
      for (let ic = 0; ic < inputChannels; ic += 1) sum += input[inputBase + ic] * weight[weightBase + ic];
      out[outputBase + oc] = relu ? Math.max(sum, 0) : sum;
    }
  }
  return out;
}

function attention(q, k, v, keyMask, additiveBias, shape, queryTokens, keyTokens) {
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
          if (additiveBias) score += additiveBias[((b * shape.heads + h) * queryTokens + n) * keyTokens + t];
          scores[t] = score;
          if (score > maxScore) maxScore = score;
        }
        let denom = 0;
        for (let t = 0; t < keyTokens; t += 1) denom += Math.exp(scores[t] - maxScore);
        for (let d = 0; d < shape.headDim; d += 1) {
          let value = 0;
          for (let t = 0; t < keyTokens; t += 1) {
            const weight = Math.exp(scores[t] - maxScore) / denom;
            value += weight * v[(b * keyTokens + t) * shape.channels + headOffset + d];
          }
          out[(b * queryTokens + n) * shape.channels + headOffset + d] = value;
        }
      }
    }
  }
  return out;
}

function encodeBoxes(referenceBoxes, shape) {
  const out = new Float32Array(shape.batch * shape.queryTokens * shape.channels * 2);
  const dimT = Array.from({ length: shape.sineFeatures }, (_, i) => Math.pow(10000, 2 * Math.floor(i / 2) / shape.sineFeatures));
  for (let b = 0; b < shape.batch; b += 1) {
    for (let q = 0; q < shape.queryTokens; q += 1) {
      const boxBase = (b * shape.queryTokens + q) * 4;
      const coords = [referenceBoxes[boxBase + 1], referenceBoxes[boxBase], referenceBoxes[boxBase + 2], referenceBoxes[boxBase + 3]];
      let outOffset = (b * shape.queryTokens + q) * shape.channels * 2;
      for (const coord of coords) {
        for (let i = 0; i < shape.sineFeatures; i += 1) {
          const value = coord * Math.PI * 2 / dimT[i];
          out[outOffset] = i % 2 === 0 ? Math.sin(value) : Math.cos(value);
          outOffset += 1;
        }
      }
    }
  }
  return out;
}

function computeRpb(referenceBoxes, shared, shape) {
  const out = new Float32Array(shape.batch * shape.heads * (shape.queryTokens + 1) * shape.spatialTokens);
  const logBase = Math.log2(8);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let q = 0; q < shape.queryTokens; q += 1) {
      const boxBase = (b * shape.queryTokens + q) * 4;
      const cx = referenceBoxes[boxBase];
      const cy = referenceBoxes[boxBase + 1];
      const w = referenceBoxes[boxBase + 2];
      const h = referenceBoxes[boxBase + 3];
      const xBounds = [cx - w / 2, cx + w / 2];
      const yBounds = [cy - h / 2, cy + h / 2];
      for (let y = 0; y < shape.height; y += 1) {
        const yCoord = (y + 0.5) / shape.height;
        const yDelta = yBounds.map(bound => {
          const scaled = (yCoord - bound) * 8;
          return Math.sign(scaled) * Math.log2(Math.abs(scaled) + 1) / logBase;
        });
        const yHidden = linearAll(new Float32Array(yDelta), 1, 2, shape.channels, shared.boxRpbYLayer1Weight, shared.boxRpbYLayer1Bias, true);
        const yBias = linearAll(yHidden, 1, shape.channels, shape.heads, shared.boxRpbYLayer2Weight, shared.boxRpbYLayer2Bias);
        for (let x = 0; x < shape.width; x += 1) {
          const xCoord = (x + 0.5) / shape.width;
          const xDelta = xBounds.map(bound => {
            const scaled = (xCoord - bound) * 8;
            return Math.sign(scaled) * Math.log2(Math.abs(scaled) + 1) / logBase;
          });
          const xHidden = linearAll(new Float32Array(xDelta), 1, 2, shape.channels, shared.boxRpbXLayer1Weight, shared.boxRpbXLayer1Bias, true);
          const xBias = linearAll(xHidden, 1, shape.channels, shape.heads, shared.boxRpbXLayer2Weight, shared.boxRpbXLayer2Bias);
          const spatial = y * shape.width + x;
          for (let head = 0; head < shape.heads; head += 1) {
            const queryWithPresence = q + 1;
            out[((b * shape.heads + head) * (shape.queryTokens + 1) + queryWithPresence) * shape.spatialTokens + spatial] = xBias[head] + yBias[head];
          }
        }
      }
    }
  }
  return out;
}

function concatPresenceAndQueries(presenceToken, queryEmbed, shape) {
  const out = new Float32Array(shape.batch * (shape.queryTokens + 1) * shape.channels);
  for (let b = 0; b < shape.batch; b += 1) {
    out.set(presenceToken, b * (shape.queryTokens + 1) * shape.channels);
    for (let q = 0; q < shape.queryTokens; q += 1) {
      const source = q * shape.channels;
      const dest = (b * (shape.queryTokens + 1) + q + 1) * shape.channels;
      out.set(queryEmbed.slice(source, source + shape.channels), dest);
    }
  }
  return out;
}

function sliceQueries(hidden, shape) {
  const out = new Float32Array(shape.batch * shape.queryTokens * shape.channels);
  for (let b = 0; b < shape.batch; b += 1) {
    const source = (b * (shape.queryTokens + 1) + 1) * shape.channels;
    const dest = b * shape.queryTokens * shape.channels;
    out.set(hidden.slice(source, source + shape.queryTokens * shape.channels), dest);
  }
  return out;
}

function slicePresence(hidden, shape) {
  const out = new Float32Array(shape.batch * shape.channels);
  for (let b = 0; b < shape.batch; b += 1) out.set(hidden.slice(b * (shape.queryTokens + 1) * shape.channels, b * (shape.queryTokens + 1) * shape.channels + shape.channels), b * shape.channels);
  return out;
}

export function createSam3DetrDecoderPhaseProgramCpuOracle(input) {
  const { shape, visionFeatures, visionPosEncoding, promptFeatures, promptMask, queryEmbed, referencePoints, presenceToken, layers, shared } = validateDecoderInputs(input);
  const queryTokenCount = shape.batch * shape.queryTokens;
  const hiddenTokenCount = shape.batch * (shape.queryTokens + 1);
  const promptTokenCount = shape.batch * shape.promptTokens;
  const spatialTokenCount = shape.batch * shape.spatialTokens;
  const queryPosPresence = new Float32Array(hiddenTokenCount * shape.channels);
  let hiddenStates = concatPresenceAndQueries(presenceToken, queryEmbed, shape);
  let referenceBoxes = new Float32Array(shape.batch * shape.queryTokens * 4);
  for (let index = 0; index < referenceBoxes.length; index += 1) referenceBoxes[index] = sigmoid(referencePoints[index % (shape.queryTokens * 4)]);
  const allHs = [];
  const allBoxes = [];
  const presenceLogits = new Float32Array(shape.layerCount * shape.batch);
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    const layer = layers[layerIndex];
    const sine = encodeBoxes(referenceBoxes, shape);
    const queryPos = linearAll(linearAll(sine, queryTokenCount, shape.channels * 2, shape.channels, shared.refPointHeadLayer1Weight, shared.refPointHeadLayer1Bias, true), queryTokenCount, shape.channels, shape.channels, shared.refPointHeadLayer2Weight, shared.refPointHeadLayer2Bias, true);
    queryPosPresence.fill(0);
    for (let b = 0; b < shape.batch; b += 1) queryPosPresence.set(queryPos.slice(b * shape.queryTokens * shape.channels, (b + 1) * shape.queryTokens * shape.channels), (b * (shape.queryTokens + 1) + 1) * shape.channels);
    const hiddenPlusPos = addArrays(hiddenStates, queryPosPresence);
    const selfAttn = attention(
      linearAll(hiddenPlusPos, hiddenTokenCount, shape.channels, shape.channels, layer.selfQWeight, layer.selfQBias),
      linearAll(hiddenPlusPos, hiddenTokenCount, shape.channels, shape.channels, layer.selfKWeight, layer.selfKBias),
      linearAll(hiddenStates, hiddenTokenCount, shape.channels, shape.channels, layer.selfVWeight, layer.selfVBias),
      null,
      null,
      shape,
      shape.queryTokens + 1,
      shape.queryTokens + 1,
    );
    hiddenStates = layerNorm(addArrays(hiddenStates, linearAll(selfAttn, hiddenTokenCount, shape.channels, shape.channels, layer.selfOWeight, layer.selfOBias)), layer.selfLayerNormWeight, layer.selfLayerNormBias, hiddenTokenCount, shape.channels);
    const textQuery = addArrays(hiddenStates, queryPosPresence);
    const textAttn = attention(
      linearAll(textQuery, hiddenTokenCount, shape.channels, shape.channels, layer.textQWeight, layer.textQBias),
      linearAll(promptFeatures, promptTokenCount, shape.channels, shape.channels, layer.textKWeight, layer.textKBias),
      linearAll(promptFeatures, promptTokenCount, shape.channels, shape.channels, layer.textVWeight, layer.textVBias),
      promptMask,
      null,
      shape,
      shape.queryTokens + 1,
      shape.promptTokens,
    );
    hiddenStates = layerNorm(addArrays(hiddenStates, linearAll(textAttn, hiddenTokenCount, shape.channels, shape.channels, layer.textOWeight, layer.textOBias)), layer.textLayerNormWeight, layer.textLayerNormBias, hiddenTokenCount, shape.channels);
    const visionQuery = addArrays(hiddenStates, queryPosPresence);
    const visionKey = addArrays(visionFeatures, visionPosEncoding);
    const rpb = computeRpb(referenceBoxes, shared, shape);
    const visionAttn = attention(
      linearAll(visionQuery, hiddenTokenCount, shape.channels, shape.channels, layer.visionQWeight, layer.visionQBias),
      linearAll(visionKey, spatialTokenCount, shape.channels, shape.channels, layer.visionKWeight, layer.visionKBias),
      linearAll(visionFeatures, spatialTokenCount, shape.channels, shape.channels, layer.visionVWeight, layer.visionVBias),
      null,
      rpb,
      shape,
      shape.queryTokens + 1,
      shape.spatialTokens,
    );
    hiddenStates = layerNorm(addArrays(hiddenStates, linearAll(visionAttn, hiddenTokenCount, shape.channels, shape.channels, layer.visionOWeight, layer.visionOBias)), layer.visionLayerNormWeight, layer.visionLayerNormBias, hiddenTokenCount, shape.channels);
    const mlp = linearAll(linearAll(hiddenStates, hiddenTokenCount, shape.channels, shape.mlpHidden, layer.fc1Weight, layer.fc1Bias, true), hiddenTokenCount, shape.mlpHidden, shape.channels, layer.fc2Weight, layer.fc2Bias);
    hiddenStates = layerNorm(addArrays(hiddenStates, mlp), layer.mlpLayerNormWeight, layer.mlpLayerNormBias, hiddenTokenCount, shape.channels);
    const queryHsNormed = layerNorm(sliceQueries(hiddenStates, shape), shared.outputLayerNormWeight, shared.outputLayerNormBias, queryTokenCount, shape.channels);
    const boxDelta = linearAll(linearAll(linearAll(queryHsNormed, queryTokenCount, shape.channels, shape.channels, shared.boxHeadLayer1Weight, shared.boxHeadLayer1Bias, true), queryTokenCount, shape.channels, shape.channels, shared.boxHeadLayer2Weight, shared.boxHeadLayer2Bias, true), queryTokenCount, shape.channels, 4, shared.boxHeadLayer3Weight, shared.boxHeadLayer3Bias);
    const newBoxes = new Float32Array(referenceBoxes.length);
    for (let index = 0; index < newBoxes.length; index += 1) newBoxes[index] = sigmoid(inverseSigmoid(referenceBoxes[index]) + boxDelta[index]);
    referenceBoxes = newBoxes;
    allHs.push(queryHsNormed);
    allBoxes.push(referenceBoxes);
    const presHidden = layerNorm(slicePresence(hiddenStates, shape), shared.presenceLayerNormWeight, shared.presenceLayerNormBias, shape.batch, shape.channels);
    const pres = linearAll(linearAll(linearAll(presHidden, shape.batch, shape.channels, shape.channels, shared.presenceHeadLayer1Weight, shared.presenceHeadLayer1Bias, true), shape.batch, shape.channels, shape.channels, shared.presenceHeadLayer2Weight, shared.presenceHeadLayer2Bias, true), shape.batch, shape.channels, 1, shared.presenceHeadLayer3Weight, shared.presenceHeadLayer3Bias);
    for (let b = 0; b < shape.batch; b += 1) presenceLogits[layerIndex * shape.batch + b] = Math.max(Math.min(pres[b], 10), -10);
  }
  const decoderHiddenStates = new Float32Array(shape.layerCount * shape.batch * shape.queryTokens * shape.channels);
  const decoderBoxes = new Float32Array(shape.layerCount * shape.batch * shape.queryTokens * 4);
  for (let layer = 0; layer < shape.layerCount; layer += 1) {
    decoderHiddenStates.set(allHs[layer], layer * shape.batch * shape.queryTokens * shape.channels);
    decoderBoxes.set(allBoxes[layer], layer * shape.batch * shape.queryTokens * 4);
  }
  return {
    shape,
    decoderHiddenStates,
    lastHs: allHs[allHs.length - 1],
    decoderBoxes,
    referenceBoxes,
    presenceLogits,
  };
}

export function createSam3DetrDecoderPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam3-detr-decoder-tensors', input.tensorPacket),
      createRouteReceiptInputArtifact('sam3-detr-decoder-weights', input.weightsPacket),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3DetrDecoderPhaseProgramRouteDefinition(input = {}) {
  const layerCount = input.shape?.layerCount || input.layerCount || 6;
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: requiredStages(layerCount),
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'mlx-reference-detr-decoder', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(layerCount),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3DetrDecoderPhaseProgramRoute', upstreamBoundary: 'mlx-reference-detr-encoder' },
  });
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM DETR decoder outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  const artifacts = {
    lastHs: { artifactId: roleArtifact(request.outputs, 'last-hs').artifactId, sha256: hashes.lastHs, shape: [shape.batch, shape.queryTokens, shape.channels] },
    referenceBoxes: { artifactId: roleArtifact(request.outputs, 'reference-boxes').artifactId, sha256: hashes.referenceBoxes, shape: [shape.batch, shape.queryTokens, 4] },
    presenceLogits: { artifactId: roleArtifact(request.outputs, 'presence-logits').artifactId, sha256: hashes.presenceLogits, shape: [shape.layerCount, shape.batch, 1] },
  };
  const decoderHiddenStatesOutput = Array.isArray(request.outputs)
    ? request.outputs.find(output => output?.role === 'decoder-hidden-states')
    : request.outputs?.['decoder-hidden-states'];
  if (hashes.decoderHiddenStates && decoderHiddenStatesOutput) {
    artifacts.decoderHiddenStates = {
      artifactId: decoderHiddenStatesOutput.artifactId,
      sha256: hashes.decoderHiddenStates,
      shape: [shape.layerCount, shape.batch, shape.queryTokens, shape.channels],
    };
  }
  return artifacts;
}

function initialHidden(queryEmbed, presenceToken, shape) {
  const out = new Float32Array(shape.batch * (shape.queryTokens + 1) * shape.channels);
  for (let b = 0; b < shape.batch; b += 1) {
    out.set(presenceToken, b * (shape.queryTokens + 1) * shape.channels);
    for (let q = 0; q < shape.queryTokens; q += 1) {
      out.set(queryEmbed.slice(q * shape.channels, (q + 1) * shape.channels), (b * (shape.queryTokens + 1) + q + 1) * shape.channels);
    }
  }
  return out;
}

function initialReferenceBoxes(referencePoints, shape) {
  const out = new Float32Array(shape.batch * shape.queryTokens * 4);
  for (let b = 0; b < shape.batch; b += 1) {
    for (let q = 0; q < shape.queryTokens; q += 1) {
      for (let c = 0; c < 4; c += 1) out[(b * shape.queryTokens + q) * 4 + c] = sigmoid(referencePoints[q * 4 + c]);
    }
  }
  return out;
}

function layerKey(layer, name) {
  return `layer${layer}${name[0].toUpperCase()}${name.slice(1)}`;
}

function bindTensor(resource, access = 'read-only-storage') {
  return { name: resource.replace(/^tensor:/, '').replace(/[^A-Za-z0-9_]/g, '_'), resource, visibility: WEBGPU_SHADER_STAGE.compute, access };
}

function bindUniform(name) {
  return { name, resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' };
}

export async function runSam3DetrDecoderPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const projection = validateDecoderInputs(input.tensors || {});
  const { shape, visionFeatures, visionPosEncoding, promptFeatures, promptMask, queryEmbed, referencePoints, presenceToken, layers, shared } = projection;
  const route = input.route || createSam3DetrDecoderPhaseProgramRouteDefinition({ kernel: input.kernel, shape });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const tensorPacket = roleArtifact(input.request.inputs, 'sam3-detr-decoder-tensors');
  const weightsPacket = roleArtifact(input.request.inputs, 'sam3-detr-decoder-weights');

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-detr-decoder-phase-program',
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

  const hiddenTokens = shape.batch * (shape.queryTokens + 1);
  const queryTokens = shape.batch * shape.queryTokens;
  const spatialTokens = shape.batch * shape.spatialTokens;
  const promptTokens = shape.batch * shape.promptTokens;
  const hiddenTotal = hiddenTokens * shape.channels;
  const queryTotal = queryTokens * shape.channels;
  const promptTotal = promptTokens * shape.channels;
  const spatialTotal = spatialTokens * shape.channels;
  const mlpTotal = hiddenTokens * shape.mlpHidden;
  const sineTotal = queryTokens * shape.channels * 2;
  const boxTotal = queryTokens * 4;
  const rpbTotal = shape.batch * shape.heads * (shape.queryTokens + 1) * shape.spatialTokens;
  const initialHiddenStates = initialHidden(queryEmbed, presenceToken, shape);
  const initialBoxes = initialReferenceBoxes(referencePoints, shape);

  let tensors = null;
  await runtime.runStage('load-detr-decoder-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage });
    tensors = {
      visionFeatures: tensor('sam3.detr-decoder.vision-features', [shape.batch, shape.spatialTokens, shape.channels], readonlyUsage),
      visionPosEncoding: tensor('sam3.detr-decoder.vision-pos', [shape.batch, shape.spatialTokens, shape.channels], readonlyUsage),
      promptFeatures: tensor('sam3.detr-decoder.prompt-features', [shape.batch, shape.promptTokens, shape.channels], readonlyUsage),
      promptMask: tensor('sam3.detr-decoder.prompt-mask', [shape.batch, shape.promptTokens], readonlyUsage),
      hidden: tensor('sam3.detr-decoder.hidden', [shape.batch, shape.queryTokens + 1, shape.channels]),
      hiddenPlusPos: tensor('sam3.detr-decoder.hidden-plus-pos', [shape.batch, shape.queryTokens + 1, shape.channels]),
      q: tensor('sam3.detr-decoder.q', [shape.batch, shape.queryTokens + 1, shape.channels]),
      kHidden: tensor('sam3.detr-decoder.k-hidden', [shape.batch, shape.queryTokens + 1, shape.channels]),
      vHidden: tensor('sam3.detr-decoder.v-hidden', [shape.batch, shape.queryTokens + 1, shape.channels]),
      kPrompt: tensor('sam3.detr-decoder.k-prompt', [shape.batch, shape.promptTokens, shape.channels]),
      vPrompt: tensor('sam3.detr-decoder.v-prompt', [shape.batch, shape.promptTokens, shape.channels]),
      kVision: tensor('sam3.detr-decoder.k-vision', [shape.batch, shape.spatialTokens, shape.channels]),
      kVisionProjected: tensor('sam3.detr-decoder.k-vision-projected', [shape.batch, shape.spatialTokens, shape.channels]),
      vVision: tensor('sam3.detr-decoder.v-vision', [shape.batch, shape.spatialTokens, shape.channels]),
      attention: tensor('sam3.detr-decoder.attention', [shape.batch, shape.queryTokens + 1, shape.channels]),
      projected: tensor('sam3.detr-decoder.projected', [shape.batch, shape.queryTokens + 1, shape.channels]),
      residual: tensor('sam3.detr-decoder.residual', [shape.batch, shape.queryTokens + 1, shape.channels]),
      mlpHidden: tensor('sam3.detr-decoder.mlp-hidden', [shape.batch, shape.queryTokens + 1, shape.mlpHidden]),
      sine: tensor('sam3.detr-decoder.sine', [shape.batch, shape.queryTokens, shape.channels * 2]),
      refPointHidden: tensor('sam3.detr-decoder.ref-point-hidden', [shape.batch, shape.queryTokens, shape.channels]),
      queryPos: tensor('sam3.detr-decoder.query-pos', [shape.batch, shape.queryTokens, shape.channels]),
      queryPosPadded: tensor('sam3.detr-decoder.query-pos-padded', [shape.batch, shape.queryTokens + 1, shape.channels]),
      queryRaw: tensor('sam3.detr-decoder.query-raw', [shape.batch, shape.queryTokens, shape.channels]),
      lastHs: tensor('sam3.detr-decoder.last-hs', [shape.batch, shape.queryTokens, shape.channels]),
      boxHidden1: tensor('sam3.detr-decoder.box-hidden-1', [shape.batch, shape.queryTokens, shape.channels]),
      boxHidden2: tensor('sam3.detr-decoder.box-hidden-2', [shape.batch, shape.queryTokens, shape.channels]),
      boxDelta: tensor('sam3.detr-decoder.box-delta', [shape.batch, shape.queryTokens, 4]),
      presenceRaw: tensor('sam3.detr-decoder.presence-raw', [shape.batch, shape.channels]),
      presenceNormed: tensor('sam3.detr-decoder.presence-normed', [shape.batch, shape.channels]),
      referenceA: tensor('sam3.detr-decoder.reference-a', [shape.batch, shape.queryTokens, 4]),
      referenceB: tensor('sam3.detr-decoder.reference-b', [shape.batch, shape.queryTokens, 4]),
      rpbXHidden: tensor('sam3.detr-decoder.rpb-x-hidden', [shape.batch, shape.queryTokens, shape.width, shape.channels]),
      rpbYHidden: tensor('sam3.detr-decoder.rpb-y-hidden', [shape.batch, shape.queryTokens, shape.height, shape.channels]),
      rpb: tensor('sam3.detr-decoder.rpb', [shape.batch, shape.heads, shape.queryTokens + 1, shape.spatialTokens]),
      dummyMask: tensor('sam3.detr-decoder.dummy-mask', [1], readonlyUsage),
      decoderDims: stage.createUniformBuffer({
        label: 'sam3.detr-decoder.dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'query_tokens', type: 'u32' },
          { name: 'prompt_tokens', type: 'u32' },
          { name: 'spatial_tokens', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'heads', type: 'u32' },
          { name: 'head_dim', type: 'u32' },
          { name: 'mlp_hidden', type: 'u32' },
          { name: 'height', type: 'u32' },
          { name: 'width', type: 'u32' },
          { name: 'sine_features', type: 'u32' },
          { name: 'total', type: 'u32' },
        ],
        values: { batch: shape.batch, query_tokens: shape.queryTokens, prompt_tokens: shape.promptTokens, spatial_tokens: shape.spatialTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, mlp_hidden: shape.mlpHidden, height: shape.height, width: shape.width, sine_features: shape.sineFeatures, total: 0 },
      }),
      hiddenLayerNormDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.hidden-ln-dims', schema: [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }], values: { total_tokens: hiddenTokens, channels: shape.channels } }),
      queryLayerNormDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.query-ln-dims', schema: [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }], values: { total_tokens: queryTokens, channels: shape.channels } }),
      presenceLayerNormDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.presence-ln-dims', schema: [{ name: 'total_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }], values: { total_tokens: shape.batch, channels: shape.channels } }),
      hiddenAddDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.hidden-add-dims', schema: [{ name: 'total', type: 'u32' }], values: { total: hiddenTotal } }),
      spatialAddDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.spatial-add-dims', schema: [{ name: 'total', type: 'u32' }], values: { total: spatialTotal } }),
      hiddenLinearDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.hidden-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.channels, total_output: hiddenTotal } }),
      promptLinearDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.prompt-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.channels, total_output: promptTotal } }),
      visionLinearDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.vision-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.channels, total_output: spatialTotal } }),
      fc1Dims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.fc1-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.mlpHidden, total_output: mlpTotal } }),
      fc2Dims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.fc2-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.mlpHidden, output_channels: shape.channels, total_output: hiddenTotal } }),
      sineLinearDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.sine-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels * 2, output_channels: shape.channels, total_output: queryTotal } }),
      queryLinearDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.query-linear-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: shape.channels, total_output: queryTotal } }),
      boxDeltaDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.box-delta-dims', schema: [{ name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }], values: { input_channels: shape.channels, output_channels: 4, total_output: boxTotal } }),
      rpbXDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.rpb-x-dims', schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'axis_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'coord_axis', type: 'u32' }], values: { batch: shape.batch, query_tokens: shape.queryTokens, axis_tokens: shape.width, channels: shape.channels, coord_axis: 0 } }),
      rpbYDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.rpb-y-dims', schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'axis_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'coord_axis', type: 'u32' }], values: { batch: shape.batch, query_tokens: shape.queryTokens, axis_tokens: shape.height, channels: shape.channels, coord_axis: 1 } }),
      selfAttentionDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.self-attn-dims', schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: 'mask_mode', type: 'u32' }], values: { batch: shape.batch, query_tokens: shape.queryTokens + 1, key_tokens: shape.queryTokens + 1, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, total_output: hiddenTotal, mask_mode: 0 } }),
      textAttentionDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.text-attn-dims', schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: 'mask_mode', type: 'u32' }], values: { batch: shape.batch, query_tokens: shape.queryTokens + 1, key_tokens: shape.promptTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, total_output: hiddenTotal, mask_mode: 1 } }),
      visionAttentionDims: stage.createUniformBuffer({ label: 'sam3.detr-decoder.vision-attn-dims', schema: [{ name: 'batch', type: 'u32' }, { name: 'query_tokens', type: 'u32' }, { name: 'key_tokens', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'heads', type: 'u32' }, { name: 'head_dim', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: 'mask_mode', type: 'u32' }], values: { batch: shape.batch, query_tokens: shape.queryTokens + 1, key_tokens: shape.spatialTokens, channels: shape.channels, heads: shape.heads, head_dim: shape.headDim, total_output: hiddenTotal, mask_mode: 0 } }),
      sharedWeights: {},
      layerWeights: [],
      presenceLogits: [],
    };
    stage.uploadTensor(tensors.visionFeatures, visionFeatures);
    stage.uploadTensor(tensors.visionPosEncoding, visionPosEncoding);
    stage.uploadTensor(tensors.promptFeatures, promptFeatures);
    stage.uploadTensor(tensors.promptMask, promptMask);
    stage.uploadTensor(tensors.hidden, initialHiddenStates);
    stage.uploadTensor(tensors.referenceA, initialBoxes);
    stage.uploadTensor(tensors.dummyMask, new Float32Array([1]));
    for (const [name, values] of Object.entries(shared)) {
      const weightShape = name.includes('Layer3Bias') || name.includes('RpbXLayer2Bias') || name.includes('RpbYLayer2Bias') ? [values.length] : [values.length];
      const tensorName = `sam3.detr-decoder.shared.${name}`;
      tensors.sharedWeights[name] = tensor(tensorName, weightShape, readonlyUsage);
      stage.uploadTensor(tensors.sharedWeights[name], values);
    }
    for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
      const layerTensors = {};
      for (const [name, values] of Object.entries(layers[layerIndex])) {
        layerTensors[name] = tensor(`sam3.detr-decoder.layer-${layerIndex}.${name}`, [values.length], readonlyUsage);
        stage.uploadTensor(layerTensors[name], values);
      }
      tensors.layerWeights.push(layerTensors);
      tensors.presenceLogits.push(tensor(`sam3.detr-decoder.layer-${layerIndex}.presence-logit`, [shape.batch], usage));
    }
    await stage.yieldToBrowser({ reason: 'after-sam3-detr-decoder-upload' });
  }, { shape });

  const programTensors = {
    visionFeatures: tensors.visionFeatures,
    visionPosEncoding: tensors.visionPosEncoding,
    promptFeatures: tensors.promptFeatures,
    promptMask: tensors.promptMask,
    hidden: tensors.hidden,
    hiddenPlusPos: tensors.hiddenPlusPos,
    q: tensors.q,
    kHidden: tensors.kHidden,
    vHidden: tensors.vHidden,
    kPrompt: tensors.kPrompt,
    vPrompt: tensors.vPrompt,
    kVision: tensors.kVision,
    kVisionProjected: tensors.kVisionProjected,
    vVision: tensors.vVision,
    attention: tensors.attention,
    projected: tensors.projected,
    residual: tensors.residual,
    mlpHidden: tensors.mlpHidden,
    sine: tensors.sine,
    refPointHidden: tensors.refPointHidden,
    queryPos: tensors.queryPos,
    queryPosPadded: tensors.queryPosPadded,
    queryRaw: tensors.queryRaw,
    lastHs: tensors.lastHs,
    boxHidden1: tensors.boxHidden1,
    boxHidden2: tensors.boxHidden2,
    boxDelta: tensors.boxDelta,
    presenceRaw: tensors.presenceRaw,
    presenceNormed: tensors.presenceNormed,
    referenceA: tensors.referenceA,
    referenceB: tensors.referenceB,
    rpbXHidden: tensors.rpbXHidden,
    rpbYHidden: tensors.rpbYHidden,
    rpb: tensors.rpb,
    dummyMask: tensors.dummyMask,
  };
  for (const [name, tensor] of Object.entries(tensors.sharedWeights)) programTensors[name] = tensor;
  tensors.presenceLogits.forEach((tensor, index) => { programTensors[`presenceLogits${index}`] = tensor; });

  const uniforms = {
    decoderDims: tensors.decoderDims,
    hiddenLayerNormDims: tensors.hiddenLayerNormDims,
    queryLayerNormDims: tensors.queryLayerNormDims,
    presenceLayerNormDims: tensors.presenceLayerNormDims,
    hiddenAddDims: tensors.hiddenAddDims,
    spatialAddDims: tensors.spatialAddDims,
    hiddenLinearDims: tensors.hiddenLinearDims,
    promptLinearDims: tensors.promptLinearDims,
    visionLinearDims: tensors.visionLinearDims,
    fc1Dims: tensors.fc1Dims,
    fc2Dims: tensors.fc2Dims,
    sineLinearDims: tensors.sineLinearDims,
    queryLinearDims: tensors.queryLinearDims,
    boxDeltaDims: tensors.boxDeltaDims,
    rpbXDims: tensors.rpbXDims,
    rpbYDims: tensors.rpbYDims,
    selfAttentionDims: tensors.selfAttentionDims,
    textAttentionDims: tensors.textAttentionDims,
    visionAttentionDims: tensors.visionAttentionDims,
  };
  const kernels = {};
  const phases = [];
  let referenceInput = 'referenceA';
  let referenceOutput = 'referenceB';
  const addKernel = (name, code, bindings) => { kernels[name] = { code, bindings }; };
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
    const layerWeights = tensors.layerWeights[layerIndex];
    const layerTensorKeys = {};
    for (const [name, tensor] of Object.entries(layerWeights)) {
      const key = layerKey(layerIndex, name);
      layerTensorKeys[name] = key;
      programTensors[key] = tensor;
    }
    const k = suffix => `layer${layerIndex}${suffix}`;
    addKernel(k('Sine'), SINE_BOX_WGSL, [bindTensor(`tensor:${referenceInput}`), bindTensor('tensor:sine', 'storage'), bindUniform('decoderDims')]);
    addKernel(k('Ref1'), LINEAR_RELU_WGSL, [bindTensor('tensor:sine'), bindTensor('tensor:refPointHeadLayer1Weight'), bindTensor('tensor:refPointHeadLayer1Bias'), bindTensor('tensor:refPointHidden', 'storage'), bindUniform('sineLinearDims')]);
    addKernel(k('Ref2'), LINEAR_RELU_WGSL, [bindTensor('tensor:refPointHidden'), bindTensor('tensor:refPointHeadLayer2Weight'), bindTensor('tensor:refPointHeadLayer2Bias'), bindTensor('tensor:queryPos', 'storage'), bindUniform('queryLinearDims')]);
    addKernel(k('PadPos'), PAD_QUERY_POS_WGSL, [bindTensor('tensor:queryPos'), bindTensor('tensor:queryPosPadded', 'storage'), bindUniform('decoderDims')]);
    addKernel(k('RpbXHidden'), RPB_AXIS_HIDDEN_WGSL, [bindTensor(`tensor:${referenceInput}`), bindTensor('tensor:boxRpbXLayer1Weight'), bindTensor('tensor:boxRpbXLayer1Bias'), bindTensor('tensor:rpbXHidden', 'storage'), bindUniform('rpbXDims')]);
    addKernel(k('RpbYHidden'), RPB_AXIS_HIDDEN_WGSL, [bindTensor(`tensor:${referenceInput}`), bindTensor('tensor:boxRpbYLayer1Weight'), bindTensor('tensor:boxRpbYLayer1Bias'), bindTensor('tensor:rpbYHidden', 'storage'), bindUniform('rpbYDims')]);
    addKernel(k('Rpb'), RPB_COMBINE_WGSL, [bindTensor('tensor:rpbXHidden'), bindTensor('tensor:boxRpbXLayer2Weight'), bindTensor('tensor:boxRpbXLayer2Bias'), bindTensor('tensor:rpbYHidden'), bindTensor('tensor:boxRpbYLayer2Weight'), bindTensor('tensor:boxRpbYLayer2Bias'), bindTensor('tensor:rpb', 'storage'), bindUniform('decoderDims')]);
    addKernel(k('AddPos'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:queryPosPadded'), bindTensor('tensor:hiddenPlusPos', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('SelfQ'), LINEAR_WGSL, [bindTensor('tensor:hiddenPlusPos'), bindTensor(`tensor:${layerTensorKeys.selfQWeight}`), bindTensor(`tensor:${layerTensorKeys.selfQBias}`), bindTensor('tensor:q', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('SelfK'), LINEAR_WGSL, [bindTensor('tensor:hiddenPlusPos'), bindTensor(`tensor:${layerTensorKeys.selfKWeight}`), bindTensor(`tensor:${layerTensorKeys.selfKBias}`), bindTensor('tensor:kHidden', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('SelfV'), LINEAR_WGSL, [bindTensor('tensor:hidden'), bindTensor(`tensor:${layerTensorKeys.selfVWeight}`), bindTensor(`tensor:${layerTensorKeys.selfVBias}`), bindTensor('tensor:vHidden', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('SelfAttn'), ATTENTION_MASKED_WGSL, [bindTensor('tensor:q'), bindTensor('tensor:kHidden'), bindTensor('tensor:vHidden'), bindTensor('tensor:dummyMask'), bindTensor('tensor:attention', 'storage'), bindUniform('selfAttentionDims')]);
    addKernel(k('SelfOut'), LINEAR_WGSL, [bindTensor('tensor:attention'), bindTensor(`tensor:${layerTensorKeys.selfOWeight}`), bindTensor(`tensor:${layerTensorKeys.selfOBias}`), bindTensor('tensor:projected', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('SelfResidual'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:projected'), bindTensor('tensor:residual', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('SelfNorm'), LAYERNORM_WGSL, [bindTensor('tensor:residual'), bindTensor(`tensor:${layerTensorKeys.selfLayerNormWeight}`), bindTensor(`tensor:${layerTensorKeys.selfLayerNormBias}`), bindTensor('tensor:hidden', 'storage'), bindUniform('hiddenLayerNormDims')]);
    addKernel(k('TextAddPos'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:queryPosPadded'), bindTensor('tensor:hiddenPlusPos', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('TextQ'), LINEAR_WGSL, [bindTensor('tensor:hiddenPlusPos'), bindTensor(`tensor:${layerTensorKeys.textQWeight}`), bindTensor(`tensor:${layerTensorKeys.textQBias}`), bindTensor('tensor:q', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('TextK'), LINEAR_WGSL, [bindTensor('tensor:promptFeatures'), bindTensor(`tensor:${layerTensorKeys.textKWeight}`), bindTensor(`tensor:${layerTensorKeys.textKBias}`), bindTensor('tensor:kPrompt', 'storage'), bindUniform('promptLinearDims')]);
    addKernel(k('TextV'), LINEAR_WGSL, [bindTensor('tensor:promptFeatures'), bindTensor(`tensor:${layerTensorKeys.textVWeight}`), bindTensor(`tensor:${layerTensorKeys.textVBias}`), bindTensor('tensor:vPrompt', 'storage'), bindUniform('promptLinearDims')]);
    addKernel(k('TextAttn'), ATTENTION_MASKED_WGSL, [bindTensor('tensor:q'), bindTensor('tensor:kPrompt'), bindTensor('tensor:vPrompt'), bindTensor('tensor:promptMask'), bindTensor('tensor:attention', 'storage'), bindUniform('textAttentionDims')]);
    addKernel(k('TextOut'), LINEAR_WGSL, [bindTensor('tensor:attention'), bindTensor(`tensor:${layerTensorKeys.textOWeight}`), bindTensor(`tensor:${layerTensorKeys.textOBias}`), bindTensor('tensor:projected', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('TextResidual'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:projected'), bindTensor('tensor:residual', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('TextNorm'), LAYERNORM_WGSL, [bindTensor('tensor:residual'), bindTensor(`tensor:${layerTensorKeys.textLayerNormWeight}`), bindTensor(`tensor:${layerTensorKeys.textLayerNormBias}`), bindTensor('tensor:hidden', 'storage'), bindUniform('hiddenLayerNormDims')]);
    addKernel(k('VisionAddPos'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:queryPosPadded'), bindTensor('tensor:hiddenPlusPos', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('VisionQ'), LINEAR_WGSL, [bindTensor('tensor:hiddenPlusPos'), bindTensor(`tensor:${layerTensorKeys.visionQWeight}`), bindTensor(`tensor:${layerTensorKeys.visionQBias}`), bindTensor('tensor:q', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('VisionKeyAdd'), ADD_WGSL, [bindTensor('tensor:visionFeatures'), bindTensor('tensor:visionPosEncoding'), bindTensor('tensor:kVision', 'storage'), bindUniform('spatialAddDims')]);
    addKernel(k('VisionK'), LINEAR_WGSL, [bindTensor('tensor:kVision'), bindTensor(`tensor:${layerTensorKeys.visionKWeight}`), bindTensor(`tensor:${layerTensorKeys.visionKBias}`), bindTensor('tensor:kVisionProjected', 'storage'), bindUniform('visionLinearDims')]);
    addKernel(k('VisionV'), LINEAR_WGSL, [bindTensor('tensor:visionFeatures'), bindTensor(`tensor:${layerTensorKeys.visionVWeight}`), bindTensor(`tensor:${layerTensorKeys.visionVBias}`), bindTensor('tensor:vVision', 'storage'), bindUniform('visionLinearDims')]);
    addKernel(k('VisionAttn'), ATTENTION_BIAS_WGSL, [bindTensor('tensor:q'), bindTensor('tensor:kVisionProjected'), bindTensor('tensor:vVision'), bindTensor('tensor:rpb'), bindTensor('tensor:attention', 'storage'), bindUniform('visionAttentionDims')]);
    addKernel(k('VisionOut'), LINEAR_WGSL, [bindTensor('tensor:attention'), bindTensor(`tensor:${layerTensorKeys.visionOWeight}`), bindTensor(`tensor:${layerTensorKeys.visionOBias}`), bindTensor('tensor:projected', 'storage'), bindUniform('hiddenLinearDims')]);
    addKernel(k('VisionResidual'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:projected'), bindTensor('tensor:residual', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('VisionNorm'), LAYERNORM_WGSL, [bindTensor('tensor:residual'), bindTensor(`tensor:${layerTensorKeys.visionLayerNormWeight}`), bindTensor(`tensor:${layerTensorKeys.visionLayerNormBias}`), bindTensor('tensor:hidden', 'storage'), bindUniform('hiddenLayerNormDims')]);
    addKernel(k('Mlp1'), LINEAR_RELU_WGSL, [bindTensor('tensor:hidden'), bindTensor(`tensor:${layerTensorKeys.fc1Weight}`), bindTensor(`tensor:${layerTensorKeys.fc1Bias}`), bindTensor('tensor:mlpHidden', 'storage'), bindUniform('fc1Dims')]);
    addKernel(k('Mlp2'), LINEAR_WGSL, [bindTensor('tensor:mlpHidden'), bindTensor(`tensor:${layerTensorKeys.fc2Weight}`), bindTensor(`tensor:${layerTensorKeys.fc2Bias}`), bindTensor('tensor:projected', 'storage'), bindUniform('fc2Dims')]);
    addKernel(k('MlpResidual'), ADD_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:projected'), bindTensor('tensor:residual', 'storage'), bindUniform('hiddenAddDims')]);
    addKernel(k('MlpNorm'), LAYERNORM_WGSL, [bindTensor('tensor:residual'), bindTensor(`tensor:${layerTensorKeys.mlpLayerNormWeight}`), bindTensor(`tensor:${layerTensorKeys.mlpLayerNormBias}`), bindTensor('tensor:hidden', 'storage'), bindUniform('hiddenLayerNormDims')]);
    addKernel(k('SliceQuery'), SLICE_QUERIES_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:queryRaw', 'storage'), bindUniform('decoderDims')]);
    addKernel(k('OutputNorm'), LAYERNORM_WGSL, [bindTensor('tensor:queryRaw'), bindTensor('tensor:outputLayerNormWeight'), bindTensor('tensor:outputLayerNormBias'), bindTensor('tensor:lastHs', 'storage'), bindUniform('queryLayerNormDims')]);
    addKernel(k('BoxHead1'), LINEAR_RELU_WGSL, [bindTensor('tensor:lastHs'), bindTensor('tensor:boxHeadLayer1Weight'), bindTensor('tensor:boxHeadLayer1Bias'), bindTensor('tensor:boxHidden1', 'storage'), bindUniform('queryLinearDims')]);
    addKernel(k('BoxHead2'), LINEAR_RELU_WGSL, [bindTensor('tensor:boxHidden1'), bindTensor('tensor:boxHeadLayer2Weight'), bindTensor('tensor:boxHeadLayer2Bias'), bindTensor('tensor:boxHidden2', 'storage'), bindUniform('queryLinearDims')]);
    addKernel(k('BoxHead3'), LINEAR_WGSL, [bindTensor('tensor:boxHidden2'), bindTensor('tensor:boxHeadLayer3Weight'), bindTensor('tensor:boxHeadLayer3Bias'), bindTensor('tensor:boxDelta', 'storage'), bindUniform('boxDeltaDims')]);
    addKernel(k('BoxRefine'), BOX_APPLY_WGSL, [bindTensor(`tensor:${referenceInput}`), bindTensor('tensor:boxDelta'), bindTensor(`tensor:${referenceOutput}`, 'storage'), bindUniform('decoderDims')]);
    addKernel(k('SlicePresence'), SLICE_PRESENCE_WGSL, [bindTensor('tensor:hidden'), bindTensor('tensor:presenceRaw', 'storage'), bindUniform('decoderDims')]);
    addKernel(k('PresenceNorm'), LAYERNORM_WGSL, [bindTensor('tensor:presenceRaw'), bindTensor('tensor:presenceLayerNormWeight'), bindTensor('tensor:presenceLayerNormBias'), bindTensor('tensor:presenceNormed', 'storage'), bindUniform('presenceLayerNormDims')]);
    addKernel(k('PresenceHead'), PRESENCE_HEAD_WGSL, [bindTensor('tensor:presenceNormed'), bindTensor('tensor:presenceHeadLayer1Weight'), bindTensor('tensor:presenceHeadLayer1Bias'), bindTensor('tensor:presenceHeadLayer2Weight'), bindTensor('tensor:presenceHeadLayer2Bias'), bindTensor('tensor:presenceHeadLayer3Weight'), bindTensor('tensor:presenceHeadLayer3Bias'), bindTensor(`tensor:presenceLogits${layerIndex}`, 'storage'), bindUniform('decoderDims')]);
    phases.push(
      { name: `detr-decoder-sine-box-position-${layerIndex}`, kernel: k('Sine'), dispatch: [workgroups(sineTotal)], yieldAfter: true },
      { name: `detr-decoder-ref-point-head-1-${layerIndex}`, kernel: k('Ref1'), dispatch: [workgroups(queryTotal)], yieldAfter: true },
      { name: `detr-decoder-ref-point-head-${layerIndex}`, kernel: k('Ref2'), dispatch: [workgroups(queryTotal)], yieldAfter: true },
      ...(input.includeIntermediateReadback === true && layerIndex === 0
        ? [{ name: 'debug-detr-decoder-layer-0-query-pos', readbacks: [{ name: 'queryPosLayer0', tensor: 'queryPos' }] }]
        : []),
      { name: `detr-decoder-pad-query-position-${layerIndex}`, kernel: k('PadPos'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-box-rpb-x-hidden-${layerIndex}`, kernel: k('RpbXHidden'), dispatch: [workgroups(shape.batch * shape.queryTokens * shape.width * shape.channels)], yieldAfter: true },
      { name: `detr-decoder-box-rpb-y-hidden-${layerIndex}`, kernel: k('RpbYHidden'), dispatch: [workgroups(shape.batch * shape.queryTokens * shape.height * shape.channels)], yieldAfter: true },
      { name: `detr-decoder-box-rpb-${layerIndex}`, kernel: k('Rpb'), dispatch: [workgroups(rpbTotal)], yieldAfter: true },
      ...(input.includeIntermediateReadback === true && layerIndex === 0
        ? [{ name: 'debug-detr-decoder-layer-0-rpb', readbacks: [{ name: 'rpbLayer0Prefix', tensor: 'rpb', options: { size: 4096 } }] }]
        : []),
      { name: `detr-decoder-self-add-pos-${layerIndex}`, kernel: k('AddPos'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-q-${layerIndex}`, kernel: k('SelfQ'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-k-${layerIndex}`, kernel: k('SelfK'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-v-${layerIndex}`, kernel: k('SelfV'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-attention-softmax-${layerIndex}`, kernel: k('SelfAttn'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-output-${layerIndex}`, kernel: k('SelfOut'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-residual-${layerIndex}`, kernel: k('SelfResidual'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-self-layernorm-${layerIndex}`, kernel: k('SelfNorm'), dispatch: [workgroups(hiddenTokens)], yieldAfter: true },
      { name: `detr-decoder-text-add-pos-${layerIndex}`, kernel: k('TextAddPos'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-text-q-${layerIndex}`, kernel: k('TextQ'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-text-k-${layerIndex}`, kernel: k('TextK'), dispatch: [workgroups(promptTotal)], yieldAfter: true },
      { name: `detr-decoder-text-v-${layerIndex}`, kernel: k('TextV'), dispatch: [workgroups(promptTotal)], yieldAfter: true },
      { name: `detr-decoder-text-attention-softmax-${layerIndex}`, kernel: k('TextAttn'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-text-output-${layerIndex}`, kernel: k('TextOut'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-text-residual-${layerIndex}`, kernel: k('TextResidual'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-text-layernorm-${layerIndex}`, kernel: k('TextNorm'), dispatch: [workgroups(hiddenTokens)], yieldAfter: true },
      { name: `detr-decoder-vision-add-pos-${layerIndex}`, kernel: k('VisionAddPos'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-q-${layerIndex}`, kernel: k('VisionQ'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-key-add-pos-${layerIndex}`, kernel: k('VisionKeyAdd'), dispatch: [workgroups(spatialTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-k-${layerIndex}`, kernel: k('VisionK'), dispatch: [workgroups(spatialTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-v-${layerIndex}`, kernel: k('VisionV'), dispatch: [workgroups(spatialTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-attention-softmax-${layerIndex}`, kernel: k('VisionAttn'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-output-${layerIndex}`, kernel: k('VisionOut'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-residual-${layerIndex}`, kernel: k('VisionResidual'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-vision-layernorm-${layerIndex}`, kernel: k('VisionNorm'), dispatch: [workgroups(hiddenTokens)], yieldAfter: true },
      { name: `detr-decoder-mlp-fc1-${layerIndex}`, kernel: k('Mlp1'), dispatch: [workgroups(mlpTotal)], yieldAfter: true },
      { name: `detr-decoder-mlp-fc2-${layerIndex}`, kernel: k('Mlp2'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-mlp-residual-${layerIndex}`, kernel: k('MlpResidual'), dispatch: [workgroups(hiddenTotal)], yieldAfter: true },
      { name: `detr-decoder-mlp-${layerIndex}`, kernel: k('MlpNorm'), dispatch: [workgroups(hiddenTokens)], yieldAfter: true },
      { name: `detr-decoder-slice-query-${layerIndex}`, kernel: k('SliceQuery'), dispatch: [workgroups(queryTotal)], yieldAfter: true },
      { name: `detr-decoder-output-layernorm-${layerIndex}`, kernel: k('OutputNorm'), dispatch: [workgroups(queryTokens)], yieldAfter: true },
      { name: `detr-decoder-box-head-1-${layerIndex}`, kernel: k('BoxHead1'), dispatch: [workgroups(queryTotal)], yieldAfter: true },
      { name: `detr-decoder-box-head-2-${layerIndex}`, kernel: k('BoxHead2'), dispatch: [workgroups(queryTotal)], yieldAfter: true },
      { name: `detr-decoder-box-head-3-${layerIndex}`, kernel: k('BoxHead3'), dispatch: [workgroups(boxTotal)], yieldAfter: true },
      { name: `detr-decoder-box-refinement-${layerIndex}`, kernel: k('BoxRefine'), dispatch: [workgroups(boxTotal)], yieldAfter: true },
      ...((input.includeIntermediateReadback === true && layerIndex === 0) || input.includeAllHiddenStatesReadback === true
        ? [{
            name: `debug-detr-decoder-layer-${layerIndex}-outputs`,
            readbacks: [
              { name: `lastHsLayer${layerIndex}`, tensor: 'lastHs' },
              { name: `referenceBoxesLayer${layerIndex}`, tensor: referenceOutput },
            ],
          }]
        : []),
      { name: `detr-decoder-slice-presence-${layerIndex}`, kernel: k('SlicePresence'), dispatch: [workgroups(shape.batch * shape.channels)], yieldAfter: true },
      { name: `detr-decoder-presence-layernorm-${layerIndex}`, kernel: k('PresenceNorm'), dispatch: [workgroups(shape.batch)], yieldAfter: true },
      { name: `detr-decoder-presence-head-${layerIndex}`, kernel: k('PresenceHead'), dispatch: [shape.batch], yieldAfter: true },
    );
    const tmp = referenceInput;
    referenceInput = referenceOutput;
    referenceOutput = tmp;
  }
  phases.push({ name: 'readback-detr-decoder-outputs', readbacks: [{ name: 'lastHs', tensor: 'lastHs' }, { name: 'referenceBoxes', tensor: referenceInput }, ...tensors.presenceLogits.map((_, index) => ({ name: `presenceLogits${index}`, tensor: `presenceLogits${index}` }))] });

  const program = runtime.defineProgram({
    name: 'sam3.detr-decoder-phase-program',
    tensors: programTensors,
    uniforms,
    kernels,
    phases,
    metadata: { routeId: SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID },
  });

  const run = await runtime.runProgram(program);
  const lastHs = run.outputs.lastHs;
  const referenceBoxes = run.outputs.referenceBoxes;
  const presenceParts = tensors.presenceLogits.map((_, index) => new Float32Array(run.outputs[`presenceLogits${index}`]));
  const presenceLogits = new Float32Array(shape.layerCount * shape.batch);
  for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) presenceLogits.set(presenceParts[layerIndex], layerIndex * shape.batch);
  let decoderHiddenStates = null;
  if (input.includeAllHiddenStatesReadback === true) {
    decoderHiddenStates = new Float32Array(shape.layerCount * shape.batch * shape.queryTokens * shape.channels);
    const layerSize = shape.batch * shape.queryTokens * shape.channels;
    for (let layerIndex = 0; layerIndex < shape.layerCount; layerIndex += 1) {
      decoderHiddenStates.set(new Float32Array(run.outputs[`lastHsLayer${layerIndex}`]), layerIndex * layerSize);
    }
  }
  const outputs = outputArtifacts(input.request, {
    lastHs: await sha256Hex(lastHs),
    decoderHiddenStates: decoderHiddenStates ? await sha256Hex(decoderHiddenStates.buffer) : null,
    referenceBoxes: await sha256Hex(referenceBoxes),
    presenceLogits: await sha256Hex(presenceLogits.buffer),
  }, shape);
  const receipt = createSam3DetrDecoderPhaseProgramRouteReceipt({
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
      lastHs: Array.from(new Float32Array(lastHs)),
      referenceBoxes: Array.from(new Float32Array(referenceBoxes)),
      presenceLogits: Array.from(presenceLogits),
    };
    if (decoderHiddenStates) {
      authoritative.debugReadback.decoderHiddenStates = Array.from(decoderHiddenStates);
    }
    if (input.includeIntermediateReadback === true) {
      authoritative.debugReadback.intermediate = {};
      const debugLayerCount = input.includeAllHiddenStatesReadback === true ? shape.layerCount : 1;
      for (let layerIndex = 0; layerIndex < debugLayerCount; layerIndex += 1) {
        authoritative.debugReadback.intermediate[`lastHsLayer${layerIndex}`] = Array.from(new Float32Array(run.outputs[`lastHsLayer${layerIndex}`]));
        authoritative.debugReadback.intermediate[`referenceBoxesLayer${layerIndex}`] = Array.from(new Float32Array(run.outputs[`referenceBoxesLayer${layerIndex}`]));
      }
      authoritative.debugReadback.intermediate.queryPosLayer0 = Array.from(new Float32Array(run.outputs.queryPosLayer0));
      authoritative.debugReadback.intermediate.rpbLayer0Prefix = Array.from(new Float32Array(run.outputs.rpbLayer0Prefix));
    }
  }
  return authoritative;
}

export { DETR_DECODER_ROUTE_SOURCE_MARKERS };
