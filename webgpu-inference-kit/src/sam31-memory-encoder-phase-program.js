import {
  assertAuthoritativeRouteWorkerResult,
  createRouteWorkerResult,
  defineWebGpuRoute,
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
import { createSam3PositionEmbeddingSine } from './sam-detr-image-ingress.js';

export const SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.memory-encoder.phase-program.webgpu-local.v0';

const MODEL_ID = 'facebook/sam3.1';
const DEFAULT_KERNEL_PROFILE = 'sam31-memory-encoder-phase-program-v0';
const REQUIRED_STAGES = [
  'load-memory-encoder-tensors',
  'memory-mask-resample',
  'memory-mask-downsample-0',
  'memory-mask-downsample-0-layernorm',
  'memory-mask-downsample-0-gelu',
  'memory-mask-downsample-1',
  'memory-mask-downsample-1-layernorm',
  'memory-mask-downsample-1-gelu',
  'memory-mask-downsample-2',
  'memory-mask-downsample-2-layernorm',
  'memory-mask-downsample-2-gelu',
  'memory-mask-downsample-3',
  'memory-mask-downsample-3-layernorm',
  'memory-mask-downsample-3-gelu',
  'memory-mask-final-projection',
  'memory-feature-projection',
  'memory-feature-mask-add',
  'memory-fuser-0-depthwise',
  'memory-fuser-0-layernorm',
  'memory-fuser-0-pointwise-1-gelu',
  'memory-fuser-0-pointwise-2-scale-residual',
  'memory-fuser-1-depthwise',
  'memory-fuser-1-layernorm',
  'memory-fuser-1-pointwise-1-gelu',
  'memory-fuser-1-pointwise-2-scale-residual',
  'memory-no-object-spatial-add',
  'memory-position-encoding',
  'readback-memory-encoder-features',
];
const INPUT_ROLES = [
  'source-image',
  'sam31-propagation-feature-2',
  'sam31-multiplex-mask-logits',
  'sam31-multiplex-conditioning',
  'sam31-multiplex-object-scores',
  'sam31-memory-encoder-weights',
];
const OUTPUT_ROLES = [
  { key: 'memoryFeatures', role: 'sam31-mask-memory-features', required: true },
  { key: 'memoryPositionEncoding', role: 'sam31-mask-memory-position-encoding', required: true },
];

const MEMORY_MASK_RESAMPLE_WGSL = `
struct MaskResampleDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  multiplex_count: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  condition_channels: u32,
  total_output: u32,
  sigmoid_scale: f32,
  sigmoid_bias: f32,
};

@group(0) @binding(0) var<storage, read> mask_logits: array<f32>;
@group(0) @binding(1) var<storage, read> conditioning: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(3) var<uniform> dims: MaskResampleDims;

fn transformed_mask(batch: u32, channel: u32, y: u32, x: u32) -> f32 {
  let index = (((batch * dims.multiplex_count + channel) * dims.input_height + y) * dims.input_width) + x;
  return (1.0 / (1.0 + exp(-mask_logits[index]))) * dims.sigmoid_scale + dims.sigmoid_bias;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  if (channel >= dims.multiplex_count) {
    output_values[index] = conditioning[batch * dims.multiplex_count + channel - dims.multiplex_count];
    return;
  }
  let source_y = (f32(out_y) + 0.5) * f32(dims.input_height) / f32(dims.output_height) - 0.5;
  let source_x = (f32(out_x) + 0.5) * f32(dims.input_width) / f32(dims.output_width) - 0.5;
  let floor_y = floor(source_y);
  let floor_x = floor(source_x);
  let y0 = u32(clamp(floor_y, 0.0, f32(dims.input_height - 1u)));
  let x0 = u32(clamp(floor_x, 0.0, f32(dims.input_width - 1u)));
  let y1 = u32(clamp(floor_y + 1.0, 0.0, f32(dims.input_height - 1u)));
  let x1 = u32(clamp(floor_x + 1.0, 0.0, f32(dims.input_width - 1u)));
  let y_weight = clamp(source_y - floor_y, 0.0, 1.0);
  let x_weight = clamp(source_x - floor_x, 0.0, 1.0);
  let top = mix(transformed_mask(batch, channel, y0, x0), transformed_mask(batch, channel, y0, x1), x_weight);
  let bottom = mix(transformed_mask(batch, channel, y1, x0), transformed_mask(batch, channel, y1, x1), x_weight);
  output_values[index] = mix(top, bottom, y_weight);
}
`;

const MEMORY_NO_OBJECT_SPATIAL_ADD_WGSL = `
struct NoObjectDims {
  batch: u32,
  spatial: u32,
  channels: u32,
  multiplex_count: u32,
  total_output: u32,
  score_threshold: f32,
};
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> object_scores: array<f32>;
@group(0) @binding(2) var<storage, read> no_object_embedding: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: NoObjectDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.channels;
  let batch = index / (dims.spatial * dims.channels);
  var addition = 0.0;
  for (var object = 0u; object < dims.multiplex_count; object = object + 1u) {
    if (object_scores[batch * dims.multiplex_count + object] <= dims.score_threshold) {
      addition += no_object_embedding[object * dims.channels + channel];
    }
  }
  output_values[index] = input_values[index] + addition;
}
`;

const MEMORY_CONV2D_WGSL = `
struct ConvDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  input_channels: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  kernel_size: u32,
  stride: u32,
  padding: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ConvDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let out_channel = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[out_channel];
  for (var ky = 0u; ky < dims.kernel_size; ky = ky + 1u) {
    let in_y_signed = i32(out_y * dims.stride + ky) - i32(dims.padding);
    if (in_y_signed < 0 || in_y_signed >= i32(dims.input_height)) { continue; }
    for (var kx = 0u; kx < dims.kernel_size; kx = kx + 1u) {
      let in_x_signed = i32(out_x * dims.stride + kx) - i32(dims.padding);
      if (in_x_signed < 0 || in_x_signed >= i32(dims.input_width)) { continue; }
      let input_base = ((batch * dims.input_height + u32(in_y_signed)) * dims.input_width + u32(in_x_signed)) * dims.input_channels;
      let weight_base = ((out_channel * dims.kernel_size + ky) * dims.kernel_size + kx) * dims.input_channels;
      for (var in_channel = 0u; in_channel < dims.input_channels; in_channel = in_channel + 1u) {
        sum = sum + input_values[input_base + in_channel] * weight[weight_base + in_channel];
      }
    }
  }
  output_values[index] = sum;
}
`;

const MEMORY_LAYERNORM_WGSL = `
struct LayerNormDims {
  rows: u32,
  channels: u32,
  epsilon: f32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LayerNormDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  if (row >= dims.rows) { return; }
  let base = row * dims.channels;
  var mean = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) { mean = mean + input_values[base + channel]; }
  mean = mean / f32(dims.channels);
  var variance = 0.0;
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    let centered = input_values[base + channel] - mean;
    variance = variance + centered * centered;
  }
  variance = variance / f32(dims.channels);
  let inverse = inverseSqrt(variance + dims.epsilon);
  for (var channel = 0u; channel < dims.channels; channel = channel + 1u) {
    output_values[base + channel] = (input_values[base + channel] - mean) * inverse * weight[channel] + bias[channel];
  }
}
`;

const MEMORY_EXACT_GELU_FUNCTIONS_WGSL = `
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
`;

export const SAM31_EXACT_GELU_FUNCTIONS_WGSL = MEMORY_EXACT_GELU_FUNCTIONS_WGSL;

const MEMORY_GELU_WGSL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;

${MEMORY_EXACT_GELU_FUNCTIONS_WGSL}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&output_values)) { return; }
  output_values[index] = gelu_exact_approx(input_values[index]);
}
`;

const MEMORY_ADD_WGSL = `
@group(0) @binding(0) var<storage, read> left_values: array<f32>;
@group(0) @binding(1) var<storage, read> right_values: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_values: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&output_values)) { return; }
  output_values[index] = left_values[index] + right_values[index];
}
`;

const MEMORY_DEPTHWISE_WGSL = `
struct ConvDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  input_channels: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  kernel_size: u32,
  stride: u32,
  padding: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: ConvDims;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[channel];
  for (var ky = 0u; ky < dims.kernel_size; ky = ky + 1u) {
    let in_y_signed = i32(out_y * dims.stride + ky) - i32(dims.padding);
    if (in_y_signed < 0 || in_y_signed >= i32(dims.input_height)) { continue; }
    for (var kx = 0u; kx < dims.kernel_size; kx = kx + 1u) {
      let in_x_signed = i32(out_x * dims.stride + kx) - i32(dims.padding);
      if (in_x_signed < 0 || in_x_signed >= i32(dims.input_width)) { continue; }
      let input_index = ((batch * dims.input_height + u32(in_y_signed)) * dims.input_width + u32(in_x_signed)) * dims.input_channels + channel;
      let weight_index = (channel * dims.kernel_size + ky) * dims.kernel_size + kx;
      sum = sum + input_values[input_index] * weight[weight_index];
    }
  }
  output_values[index] = sum;
}
`;

const MEMORY_POINTWISE_1_GELU_WGSL = `
struct LinearDims { rows: u32, input_channels: u32, output_channels: u32, total_output: u32 };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;
${MEMORY_EXACT_GELU_FUNCTIONS_WGSL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let out_channel = index % dims.output_channels;
  let row = index / dims.output_channels;
  var sum = bias[out_channel];
  let input_base = row * dims.input_channels;
  let weight_base = out_channel * dims.input_channels;
  for (var in_channel = 0u; in_channel < dims.input_channels; in_channel = in_channel + 1u) {
    sum = sum + input_values[input_base + in_channel] * weight[weight_base + in_channel];
  }
  output_values[index] = gelu_exact_approx(sum);
}
`;

const MEMORY_POINTWISE_2_SCALE_RESIDUAL_WGSL = `
struct LinearDims { rows: u32, input_channels: u32, output_channels: u32, total_output: u32 };
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> residual_values: array<f32>;
@group(0) @binding(2) var<storage, read> weight: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read> scale: array<f32>;
@group(0) @binding(5) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(6) var<uniform> dims: LinearDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let out_channel = index % dims.output_channels;
  let row = index / dims.output_channels;
  var sum = bias[out_channel];
  let input_base = row * dims.input_channels;
  let weight_base = out_channel * dims.input_channels;
  for (var in_channel = 0u; in_channel < dims.input_channels; in_channel = in_channel + 1u) {
    sum = sum + input_values[input_base + in_channel] * weight[weight_base + in_channel];
  }
  output_values[index] = residual_values[index] + sum * scale[out_channel];
}
`;

const MEMORY_POSITION_ENCODING_WGSL = `
struct PositionDims { batch: u32, height: u32, width: u32, channels: u32, total_output: u32, temperature: f32, scale: f32 };
@group(0) @binding(0) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(1) var<uniform> dims: PositionDims;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.channels;
  let x = (index / dims.channels) % dims.width;
  let y = (index / (dims.channels * dims.width)) % dims.height;
  let num_pos_feats = dims.channels / 2u;
  var axis_channel = channel;
  var axis_position = (f32(y) + 1.0) / (f32(dims.height) + 0.000001) * dims.scale;
  if (channel >= num_pos_feats) {
    axis_channel = channel - num_pos_feats;
    axis_position = (f32(x) + 1.0) / (f32(dims.width) + 0.000001) * dims.scale;
  }
  let exponent = 2.0 * floor(f32(axis_channel / 2u)) / f32(num_pos_feats);
  let value = axis_position / pow(dims.temperature, exponent);
  output_values[index] = select(cos(value), sin(value), (axis_channel % 2u) == 0u);
}
`;

function ensureFloat32Array(value, name) {
  if (!(value instanceof Float32Array)) throw new Error(`${name} must be a Float32Array`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function normalizeShape(shape = {}) {
  const out = {
    batch: positiveInteger(shape.batch, 'shape.batch'),
    featureHeight: positiveInteger(shape.featureHeight, 'shape.featureHeight'),
    featureWidth: positiveInteger(shape.featureWidth, 'shape.featureWidth'),
    featureChannels: positiveInteger(shape.featureChannels, 'shape.featureChannels'),
    maskHeight: positiveInteger(shape.maskHeight, 'shape.maskHeight'),
    maskWidth: positiveInteger(shape.maskWidth, 'shape.maskWidth'),
    multiplexCount: positiveInteger(shape.multiplexCount, 'shape.multiplexCount'),
    conditionChannels: shape.conditionChannels !== false,
    resampledMaskHeight: positiveInteger(shape.resampledMaskHeight ?? 1152, 'shape.resampledMaskHeight'),
    resampledMaskWidth: positiveInteger(shape.resampledMaskWidth ?? 1152, 'shape.resampledMaskWidth'),
  };
  if (out.featureChannels % 4 !== 0) throw new Error('shape.featureChannels must be a positive multiple of 4 for PositionEmbeddingSine');
  if (out.resampledMaskHeight < out.maskHeight || out.resampledMaskWidth < out.maskWidth) {
    throw new Error('SAM3.1 memory mask resampling is upsample-only because the native route does not implement the official antialias downsample kernel');
  }
  const conditionCount = out.batch * out.multiplexCount;
  if (out.conditionChannels) {
    if (!Array.isArray(shape.conditioning) && !(shape.conditioning instanceof Float32Array)) {
      throw new Error('shape.conditioning is required when conditionChannels is true');
    }
    if (shape.conditioning.length !== conditionCount) {
      throw new Error(`shape.conditioning length ${shape.conditioning.length} does not match batch * multiplexCount (${conditionCount})`);
    }
    out.conditioning = Float32Array.from(shape.conditioning);
  } else {
    out.conditioning = new Float32Array(0);
  }
  out.maskInputChannels = out.multiplexCount * (out.conditionChannels ? 2 : 1);
  return out;
}

function normalizeConfig(config = {}) {
  const out = {
    sigmoidScale: Number(config.sigmoidScale ?? 2),
    sigmoidBias: Number(config.sigmoidBias ?? -1),
    positionTemperature: Number(config.positionTemperature ?? 10000),
    objectScoreLogitThreshold: Number(config.objectScoreLogitThreshold ?? 0),
  };
  for (const [key, value] of Object.entries(out)) {
    if (!Number.isFinite(value)) throw new Error(`config.${key} must be finite`);
  }
  if (out.positionTemperature <= 0) throw new Error('config.positionTemperature must be positive');
  return out;
}

function normalizeConvSpec(spec, name, { depthwise = false } = {}) {
  if (!spec || typeof spec !== 'object') throw new Error(`${name} is required`);
  const out = {
    weight: ensureFloat32Array(spec.weight, `${name}.weight`),
    bias: ensureFloat32Array(spec.bias, `${name}.bias`),
    kernelSize: positiveInteger(spec.kernelSize, `${name}.kernelSize`),
    stride: positiveInteger(spec.stride ?? 1, `${name}.stride`),
    padding: spec.padding ?? 0,
    inChannels: positiveInteger(spec.inChannels, `${name}.inChannels`),
    outChannels: positiveInteger(spec.outChannels, `${name}.outChannels`),
    groups: positiveInteger(spec.groups ?? 1, `${name}.groups`),
  };
  if (!Number.isInteger(out.padding) || out.padding < 0) throw new Error(`${name}.padding must be a non-negative integer`);
  if (depthwise && (out.groups !== out.inChannels || out.outChannels !== out.inChannels)) {
    throw new Error(`${name} must be depthwise with groups == inChannels == outChannels`);
  }
  const expectedWeights = depthwise
    ? out.outChannels * out.kernelSize * out.kernelSize
    : out.outChannels * out.kernelSize * out.kernelSize * out.inChannels;
  if (out.weight.length !== expectedWeights) {
    const layout = depthwise ? 'out,kH,kW,1 depthwise layout' : 'out,kH,kW,in layout';
    throw new Error(`${name}.weight length ${out.weight.length} does not match ${layout} (${expectedWeights})`);
  }
  if (out.bias.length !== out.outChannels) throw new Error(`${name}.bias length does not match output channels (${out.outChannels})`);
  return out;
}

function normalizeLayerNorm(spec, channels, name) {
  if (!spec || typeof spec !== 'object') throw new Error(`${name} is required`);
  const weight = ensureFloat32Array(spec.weight, `${name}.weight`);
  const bias = ensureFloat32Array(spec.bias, `${name}.bias`);
  const epsilon = Number(spec.epsilon ?? 1e-6);
  if (weight.length !== channels || bias.length !== channels) throw new Error(`${name} must contain ${channels} channel values`);
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw new Error(`${name}.epsilon must be positive`);
  return { weight, bias, epsilon };
}

function normalizeLinear(spec, inChannels, outChannels, name) {
  if (!spec || typeof spec !== 'object') throw new Error(`${name} is required`);
  if (spec.inChannels !== inChannels || spec.outChannels !== outChannels) {
    throw new Error(`${name} must map ${inChannels} to ${outChannels} channels`);
  }
  const weight = ensureFloat32Array(spec.weight, `${name}.weight`);
  const bias = ensureFloat32Array(spec.bias, `${name}.bias`);
  if (weight.length !== inChannels * outChannels || bias.length !== outChannels) {
    throw new Error(`${name} tensors do not match out,in linear layout`);
  }
  return { weight, bias, inChannels, outChannels };
}

function convOutputShape(height, width, spec) {
  return {
    height: Math.floor((height + 2 * spec.padding - spec.kernelSize) / spec.stride) + 1,
    width: Math.floor((width + 2 * spec.padding - spec.kernelSize) / spec.stride) + 1,
    channels: spec.outChannels,
  };
}

function normalizeWeights(weights = {}, shape) {
  if (!Array.isArray(weights.downsampleLayers) || weights.downsampleLayers.length === 0) {
    throw new Error('weights.downsampleLayers must contain at least one convolution, LayerNorm2d, and GELU stage');
  }
  let spatial = { height: shape.resampledMaskHeight, width: shape.resampledMaskWidth, channels: shape.maskInputChannels };
  const downsampleLayers = weights.downsampleLayers.map((layer, index) => {
    const conv = normalizeConvSpec(layer?.conv, `weights.downsampleLayers[${index}].conv`);
    if (conv.inChannels !== spatial.channels) throw new Error(`weights.downsampleLayers[${index}].conv input channels do not match the previous stage`);
    const layerNorm = normalizeLayerNorm(layer.layerNorm, conv.outChannels, `weights.downsampleLayers[${index}].layerNorm`);
    spatial = convOutputShape(spatial.height, spatial.width, conv);
    if (spatial.height <= 0 || spatial.width <= 0) throw new Error(`weights.downsampleLayers[${index}].conv has an invalid output shape`);
    return { conv, layerNorm, outputShape: { ...spatial } };
  });
  const maskFinal = normalizeConvSpec(weights.maskFinal, 'weights.maskFinal');
  if (maskFinal.inChannels !== spatial.channels || maskFinal.outChannels !== shape.featureChannels) {
    throw new Error('weights.maskFinal must project the downsample tower to shape.featureChannels');
  }
  spatial = convOutputShape(spatial.height, spatial.width, maskFinal);
  if (spatial.height !== shape.featureHeight || spatial.width !== shape.featureWidth) {
    throw new Error(`memory mask tower output ${spatial.height}x${spatial.width} does not match propagation feature ${shape.featureHeight}x${shape.featureWidth}`);
  }
  const featureProjection = normalizeConvSpec(weights.featureProjection, 'weights.featureProjection');
  if (featureProjection.kernelSize !== 1 || featureProjection.inChannels !== shape.featureChannels || featureProjection.outChannels !== shape.featureChannels) {
    throw new Error('weights.featureProjection must be a 1x1 shape.featureChannels projection');
  }
  if (!Array.isArray(weights.fuserLayers) || weights.fuserLayers.length === 0) throw new Error('weights.fuserLayers must contain at least one CXBlock');
  const fuserLayers = weights.fuserLayers.map((layer, index) => {
    const depthwise = normalizeConvSpec(layer?.depthwise, `weights.fuserLayers[${index}].depthwise`, { depthwise: true });
    if (depthwise.inChannels !== shape.featureChannels) throw new Error(`weights.fuserLayers[${index}].depthwise must use shape.featureChannels`);
    const layerNorm = normalizeLayerNorm(layer.layerNorm, shape.featureChannels, `weights.fuserLayers[${index}].layerNorm`);
    const pointwise1 = normalizeLinear(layer.pointwise1, shape.featureChannels, shape.featureChannels * 4, `weights.fuserLayers[${index}].pointwise1`);
    const pointwise2 = normalizeLinear(layer.pointwise2, shape.featureChannels * 4, shape.featureChannels, `weights.fuserLayers[${index}].pointwise2`);
    const scale = ensureFloat32Array(layer.scale, `weights.fuserLayers[${index}].scale`);
    if (scale.length !== shape.featureChannels) throw new Error(`weights.fuserLayers[${index}].scale must contain shape.featureChannels values`);
    return { depthwise, layerNorm, pointwise1, pointwise2, scale };
  });
  const noObjectSpatialEmbedding = ensureFloat32Array(weights.noObjectSpatialEmbedding, 'weights.noObjectSpatialEmbedding');
  if (noObjectSpatialEmbedding.length !== shape.multiplexCount * shape.featureChannels) throw new Error('weights.noObjectSpatialEmbedding must contain multiplexCount * featureChannels values');
  return { downsampleLayers, maskFinal, featureProjection, fuserLayers, noObjectSpatialEmbedding };
}

function validateInputs(input = {}) {
  const shape = normalizeShape(input.shape);
  const config = normalizeConfig(input.config);
  const propagationFeature = ensureFloat32Array(input.propagationFeature, 'propagationFeature');
  const expectedFeature = shape.batch * shape.featureHeight * shape.featureWidth * shape.featureChannels;
  if (propagationFeature.length !== expectedFeature) throw new Error(`propagationFeature length ${propagationFeature.length} does not match shape (${expectedFeature})`);
  const maskLogits = ensureFloat32Array(input.maskLogits, 'maskLogits');
  const expectedMask = shape.batch * shape.multiplexCount * shape.maskHeight * shape.maskWidth;
  if (maskLogits.length !== expectedMask) throw new Error(`maskLogits length ${maskLogits.length} does not match batch * multiplexCount * maskHeight * maskWidth (${expectedMask})`);
  const objectScores = ensureFloat32Array(input.objectScores, 'objectScores');
  const expectedScores = shape.batch * shape.multiplexCount;
  if (objectScores.length !== expectedScores) throw new Error(`objectScores length ${objectScores.length} does not match batch * multiplexCount (${expectedScores})`);
  const weights = normalizeWeights(input.weights, shape);
  return { shape, config, propagationFeature, maskLogits, objectScores, weights };
}

function maskIndex(shape, batch, channel, y, x) {
  return (((batch * shape.multiplexCount + channel) * shape.maskHeight + y) * shape.maskWidth) + x;
}

function sampleBilinearMask(maskLogits, shape, batch, channel, outY, outX, config) {
  const sourceY = ((outY + 0.5) * shape.maskHeight / shape.resampledMaskHeight) - 0.5;
  const sourceX = ((outX + 0.5) * shape.maskWidth / shape.resampledMaskWidth) - 0.5;
  const floorY = Math.floor(sourceY);
  const floorX = Math.floor(sourceX);
  const y0 = Math.max(0, Math.min(shape.maskHeight - 1, floorY));
  const x0 = Math.max(0, Math.min(shape.maskWidth - 1, floorX));
  const y1 = Math.max(0, Math.min(shape.maskHeight - 1, floorY + 1));
  const x1 = Math.max(0, Math.min(shape.maskWidth - 1, floorX + 1));
  const yWeight = Math.max(0, Math.min(1, sourceY - floorY));
  const xWeight = Math.max(0, Math.min(1, sourceX - floorX));
  const transformed = (y, x) => {
    const value = maskLogits[maskIndex(shape, batch, channel, y, x)];
    return (1 / (1 + Math.exp(-value))) * config.sigmoidScale + config.sigmoidBias;
  };
  const top = transformed(y0, x0) * (1 - xWeight) + transformed(y0, x1) * xWeight;
  const bottom = transformed(y1, x0) * (1 - xWeight) + transformed(y1, x1) * xWeight;
  return top * (1 - yWeight) + bottom * yWeight;
}

function resampleAndMuxMasks(maskLogits, shape, config) {
  const output = new Float32Array(shape.batch * shape.resampledMaskHeight * shape.resampledMaskWidth * shape.maskInputChannels);
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let y = 0; y < shape.resampledMaskHeight; y += 1) {
      for (let x = 0; x < shape.resampledMaskWidth; x += 1) {
        const base = ((batch * shape.resampledMaskHeight + y) * shape.resampledMaskWidth + x) * shape.maskInputChannels;
        for (let channel = 0; channel < shape.multiplexCount; channel += 1) {
          output[base + channel] = sampleBilinearMask(maskLogits, shape, batch, channel, y, x, config);
          if (shape.conditionChannels) output[base + shape.multiplexCount + channel] = shape.conditioning[batch * shape.multiplexCount + channel];
        }
      }
    }
  }
  return output;
}

function conv2d(input, batch, inShape, spec, { depthwise = false } = {}) {
  const outShape = convOutputShape(inShape.height, inShape.width, spec);
  const output = new Float32Array(batch * outShape.height * outShape.width * outShape.channels);
  for (let b = 0; b < batch; b += 1) {
    for (let outY = 0; outY < outShape.height; outY += 1) {
      for (let outX = 0; outX < outShape.width; outX += 1) {
        for (let outChannel = 0; outChannel < outShape.channels; outChannel += 1) {
          let sum = spec.bias[outChannel];
          for (let ky = 0; ky < spec.kernelSize; ky += 1) {
            const inY = outY * spec.stride + ky - spec.padding;
            if (inY < 0 || inY >= inShape.height) continue;
            for (let kx = 0; kx < spec.kernelSize; kx += 1) {
              const inX = outX * spec.stride + kx - spec.padding;
              if (inX < 0 || inX >= inShape.width) continue;
              if (depthwise) {
                const inputIndex = ((b * inShape.height + inY) * inShape.width + inX) * inShape.channels + outChannel;
                const weightIndex = (outChannel * spec.kernelSize + ky) * spec.kernelSize + kx;
                sum += input[inputIndex] * spec.weight[weightIndex];
              } else {
                const inputBase = ((b * inShape.height + inY) * inShape.width + inX) * inShape.channels;
                const weightBase = ((outChannel * spec.kernelSize + ky) * spec.kernelSize + kx) * spec.inChannels;
                for (let inChannel = 0; inChannel < spec.inChannels; inChannel += 1) {
                  sum += input[inputBase + inChannel] * spec.weight[weightBase + inChannel];
                }
              }
            }
          }
          output[((b * outShape.height + outY) * outShape.width + outX) * outShape.channels + outChannel] = sum;
        }
      }
    }
  }
  return { data: output, shape: outShape };
}

function layerNorm2d(input, batch, height, width, channels, spec) {
  const output = new Float32Array(input.length);
  for (let token = 0; token < batch * height * width; token += 1) {
    const base = token * channels;
    let mean = 0;
    for (let channel = 0; channel < channels; channel += 1) mean += input[base + channel];
    mean /= channels;
    let variance = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const centered = input[base + channel] - mean;
      variance += centered * centered;
    }
    variance /= channels;
    const inverse = 1 / Math.sqrt(variance + spec.epsilon);
    for (let channel = 0; channel < channels; channel += 1) {
      output[base + channel] = (input[base + channel] - mean) * inverse * spec.weight[channel] + spec.bias[channel];
    }
  }
  return output;
}

function gelu(value) {
  if (value < -10) return 0;
  if (value > 10) return value;
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value / Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * magnitude);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-magnitude * magnitude));
  return 0.5 * value * (1 + erf);
}

function applyGelu(input) {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) output[index] = gelu(input[index]);
  return output;
}

function linear(input, rows, spec, applyActivation = false) {
  const output = new Float32Array(rows * spec.outChannels);
  for (let row = 0; row < rows; row += 1) {
    for (let outChannel = 0; outChannel < spec.outChannels; outChannel += 1) {
      let sum = spec.bias[outChannel];
      const weightBase = outChannel * spec.inChannels;
      const inputBase = row * spec.inChannels;
      for (let inChannel = 0; inChannel < spec.inChannels; inChannel += 1) sum += input[inputBase + inChannel] * spec.weight[weightBase + inChannel];
      output[row * spec.outChannels + outChannel] = applyActivation ? gelu(sum) : sum;
    }
  }
  return output;
}

export function createSam31MemoryEncoderPhaseProgramCpuOracle(input = {}) {
  const { shape, config, propagationFeature, maskLogits, objectScores, weights } = validateInputs(input);
  let maskFeatures = resampleAndMuxMasks(maskLogits, shape, config);
  let maskShape = { height: shape.resampledMaskHeight, width: shape.resampledMaskWidth, channels: shape.maskInputChannels };
  const downsampleShapes = [];
  for (const layer of weights.downsampleLayers) {
    const convolved = conv2d(maskFeatures, shape.batch, maskShape, layer.conv);
    maskFeatures = applyGelu(layerNorm2d(convolved.data, shape.batch, convolved.shape.height, convolved.shape.width, convolved.shape.channels, layer.layerNorm));
    maskShape = convolved.shape;
    downsampleShapes.push([shape.batch, maskShape.height, maskShape.width, maskShape.channels]);
  }
  const maskProjected = conv2d(maskFeatures, shape.batch, maskShape, weights.maskFinal);
  const projectedFeature = conv2d(propagationFeature, shape.batch, {
    height: shape.featureHeight,
    width: shape.featureWidth,
    channels: shape.featureChannels,
  }, weights.featureProjection);
  let features = new Float32Array(projectedFeature.data.length);
  for (let index = 0; index < features.length; index += 1) features[index] = projectedFeature.data[index] + maskProjected.data[index];
  const rows = shape.batch * shape.featureHeight * shape.featureWidth;
  for (const layer of weights.fuserLayers) {
    const residual = features;
    const depthwise = conv2d(features, shape.batch, {
      height: shape.featureHeight,
      width: shape.featureWidth,
      channels: shape.featureChannels,
    }, layer.depthwise, { depthwise: true });
    const normalized = layerNorm2d(depthwise.data, shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels, layer.layerNorm);
    const hidden = linear(normalized, rows, layer.pointwise1, true);
    const projected = linear(hidden, rows, layer.pointwise2, false);
    features = new Float32Array(projected.length);
    for (let row = 0; row < rows; row += 1) {
      for (let channel = 0; channel < shape.featureChannels; channel += 1) {
        const index = row * shape.featureChannels + channel;
        features[index] = residual[index] + projected[index] * layer.scale[channel];
      }
    }
  }
  let noObjectSpatialApplied = false;
  const spatial = shape.featureHeight * shape.featureWidth;
  for (let batch = 0; batch < shape.batch; batch += 1) {
    for (let object = 0; object < shape.multiplexCount; object += 1) {
      if (objectScores[batch * shape.multiplexCount + object] > config.objectScoreLogitThreshold) continue;
      noObjectSpatialApplied = true;
      for (let position = 0; position < spatial; position += 1) {
        for (let channel = 0; channel < shape.featureChannels; channel += 1) {
          features[(batch * spatial + position) * shape.featureChannels + channel] += weights.noObjectSpatialEmbedding[object * shape.featureChannels + channel];
        }
      }
    }
  }
  const positionEncoding = createSam3PositionEmbeddingSine({
    batch: shape.batch,
    height: shape.featureHeight,
    width: shape.featureWidth,
    channels: shape.featureChannels,
    temperature: config.positionTemperature,
  });
  return {
    features,
    positionEncoding,
    featureShape: [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels],
    positionShape: [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels],
    downsampleShapes,
    noObjectSpatialApplied,
    layout: 'B,H,W,C',
    sourceLayout: 'B,C,H,W',
  };
}

function createDefaultScheduler() {
  const phaseChunkSize = Object.fromEntries(REQUIRED_STAGES.map(stage => [stage, 1]));
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize, unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: REQUIRED_STAGES.map(stage => ({ name: `${stage}-phase`, stage, kind: stage.startsWith('readback-') ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: REQUIRED_STAGES.map(stage => ({ name: `after-${stage}`, kind: stage.startsWith('readback-') ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: !stage.startsWith('readback-') })),
      notes: 'SAM3.1 memory encoding yields between muxed mask resampling, each downsample/norm/GELU stage, feature fusion, each ConvNeXt substage, position encoding, and readback.',
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
  const artifact = Array.isArray(artifacts) ? artifacts.find(entry => entry?.role === role) : artifacts?.[role];
  if (!artifact) throw new Error(`${role} artifact is required`);
  return artifact;
}

export function createSam31MemoryEncoderPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: MODEL_ID, revision: input.model?.revision || 'sam31-browser-multiplex-memory-encoder', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(({ role }) => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam31MemoryEncoderPhaseProgramRoute', upstreamBoundary: 'browser-sam31-multiplex-mask-logits-to-temporal-memory-features' },
  });
}

export function createSam31MemoryEncoderPhaseProgramRouteReceipt(input = {}) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam31-propagation-feature-2', input.propagationFeature),
      createRouteReceiptInputArtifact('sam31-multiplex-mask-logits', input.maskLogits),
      createRouteReceiptInputArtifact('sam31-multiplex-conditioning', input.conditioning),
      createRouteReceiptInputArtifact('sam31-multiplex-object-scores', input.objectScores),
      createRouteReceiptInputArtifact('sam31-memory-encoder-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM3.1 memory encoder outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function workgroups(total) {
  return Math.max(1, Math.ceil(total / 64));
}

function convDimsValues(shape, inShape, spec, outShape) {
  return {
    batch: shape.batch,
    input_height: inShape.height,
    input_width: inShape.width,
    input_channels: inShape.channels,
    output_height: outShape.height,
    output_width: outShape.width,
    output_channels: outShape.channels,
    kernel_size: spec.kernelSize,
    stride: spec.stride,
    padding: spec.padding,
    total_output: shape.batch * outShape.height * outShape.width * outShape.channels,
  };
}

function linearDimsValues(rows, spec) {
  return {
    rows,
    input_channels: spec.inChannels,
    output_channels: spec.outChannels,
    total_output: rows * spec.outChannels,
  };
}

export async function runSam31MemoryEncoderPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam31MemoryEncoderPhaseProgramRouteDefinition({ kernel: input.kernel });
  const { shape, config, propagationFeature: propagationFeatureValues, maskLogits: maskLogitValues, objectScores: objectScoreValues, weights: normalizedWeights } = validateInputs(input.tensors || {});
  if (normalizedWeights.downsampleLayers.length !== 4 || normalizedWeights.fuserLayers.length !== 2) {
    throw new Error('authoritative SAM3.1 memory route requires exactly four mask downsample layers and two CXBlock fuser layers');
  }
  if (!shape.conditionChannels) throw new Error('authoritative SAM3.1 memory route requires multiplex conditioning channels');
  const conditioning = roleArtifact(input.request.inputs, 'sam31-multiplex-conditioning');
  const objectScores = roleArtifact(input.request.inputs, 'sam31-multiplex-object-scores');
  if (JSON.stringify(conditioning.shape) !== JSON.stringify([shape.batch, shape.multiplexCount])) {
    throw new Error(`sam31-multiplex-conditioning artifact shape must be [${shape.batch},${shape.multiplexCount}]`);
  }
  const conditioningSha256 = await sha256Hex(shape.conditioning);
  if (conditioning.sha256 !== conditioningSha256) {
    throw new Error(`sam31-multiplex-conditioning artifact hash mismatch: expected ${conditioning.sha256}, got ${conditioningSha256}`);
  }
  if (JSON.stringify(objectScores.shape) !== JSON.stringify([shape.batch * shape.multiplexCount, 1])) throw new Error(`sam31-multiplex-object-scores artifact shape must be [${shape.batch * shape.multiplexCount},1]`);
  const objectScoresSha256 = await sha256Hex(objectScoreValues);
  if (objectScores.sha256 !== objectScoresSha256) throw new Error(`sam31-multiplex-object-scores artifact hash mismatch: expected ${objectScores.sha256}, got ${objectScoresSha256}`);
  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam31-memory-encoder-phase-program',
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

  const downsampleShapes = normalizedWeights.downsampleLayers.map(layer => layer.outputShape);
  const featureShape = { height: shape.featureHeight, width: shape.featureWidth, channels: shape.featureChannels };
  let tensors = null;
  await runtime.runStage('load-memory-encoder-tensors', async stage => {
    const readwriteUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, usage = readwriteUsage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage });
    const convWeightShape = spec => [spec.outChannels, spec.kernelSize, spec.kernelSize, spec.inChannels];
    tensors = {
      maskLogits: tensor('sam31.memory.mask-logits', [shape.batch, shape.multiplexCount, shape.maskHeight, shape.maskWidth], readonlyUsage),
      conditioning: tensor('sam31.memory.conditioning', [shape.batch, shape.multiplexCount], readonlyUsage),
      objectScores: tensor('sam31.memory.object-scores', [shape.batch, shape.multiplexCount], readonlyUsage),
      noObjectSpatialEmbedding: tensor('sam31.memory.no-object-spatial-embedding', [shape.multiplexCount, shape.featureChannels], readonlyUsage),
      resampledMask: tensor('sam31.memory.resampled-mask', [shape.batch, shape.resampledMaskHeight, shape.resampledMaskWidth, shape.maskInputChannels]),
      propagationFeature: tensor('sam31.memory.propagation-feature-2', [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels], readonlyUsage),
      maskProjected: tensor('sam31.memory.mask-projected', [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]),
      featureProjected: tensor('sam31.memory.feature-projected', [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]),
      fusedInitial: tensor('sam31.memory.fused-initial', [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]),
      positionEncoding: tensor('sam31.memory.position-encoding', [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]),
      noObjectOutput: tensor('sam31.memory.no-object-output', [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]),
      maskResampleDims: stage.createUniformBuffer({
        label: 'sam31.memory.mask-resample-dims',
        schema: [
          { name: 'batch', type: 'u32' }, { name: 'input_height', type: 'u32' }, { name: 'input_width', type: 'u32' },
          { name: 'multiplex_count', type: 'u32' }, { name: 'output_height', type: 'u32' }, { name: 'output_width', type: 'u32' },
          { name: 'output_channels', type: 'u32' }, { name: 'condition_channels', type: 'u32' }, { name: 'total_output', type: 'u32' },
          { name: 'sigmoid_scale', type: 'f32' }, { name: 'sigmoid_bias', type: 'f32' },
        ],
        values: {
          batch: shape.batch,
          input_height: shape.maskHeight,
          input_width: shape.maskWidth,
          multiplex_count: shape.multiplexCount,
          output_height: shape.resampledMaskHeight,
          output_width: shape.resampledMaskWidth,
          output_channels: shape.maskInputChannels,
          condition_channels: 1,
          total_output: shape.batch * shape.resampledMaskHeight * shape.resampledMaskWidth * shape.maskInputChannels,
          sigmoid_scale: config.sigmoidScale,
          sigmoid_bias: config.sigmoidBias,
        },
      }),
      convDims: stage.createUniformBuffer({
        label: 'sam31.memory.conv-dims',
        schema: [
          { name: 'batch', type: 'u32' }, { name: 'input_height', type: 'u32' }, { name: 'input_width', type: 'u32' },
          { name: 'input_channels', type: 'u32' }, { name: 'output_height', type: 'u32' }, { name: 'output_width', type: 'u32' },
          { name: 'output_channels', type: 'u32' }, { name: 'kernel_size', type: 'u32' }, { name: 'stride', type: 'u32' },
          { name: 'padding', type: 'u32' }, { name: 'total_output', type: 'u32' },
        ],
        values: convDimsValues(shape, { height: shape.resampledMaskHeight, width: shape.resampledMaskWidth, channels: shape.maskInputChannels }, normalizedWeights.downsampleLayers[0].conv, downsampleShapes[0]),
      }),
      layerNormDims: stage.createUniformBuffer({
        label: 'sam31.memory.layernorm-dims',
        schema: [{ name: 'rows', type: 'u32' }, { name: 'channels', type: 'u32' }, { name: 'epsilon', type: 'f32' }],
        values: { rows: shape.batch * downsampleShapes[0].height * downsampleShapes[0].width, channels: downsampleShapes[0].channels, epsilon: normalizedWeights.downsampleLayers[0].layerNorm.epsilon },
      }),
      linearDims: stage.createUniformBuffer({
        label: 'sam31.memory.linear-dims',
        schema: [{ name: 'rows', type: 'u32' }, { name: 'input_channels', type: 'u32' }, { name: 'output_channels', type: 'u32' }, { name: 'total_output', type: 'u32' }],
        values: linearDimsValues(shape.batch * shape.featureHeight * shape.featureWidth, normalizedWeights.fuserLayers[0].pointwise1),
      }),
      positionDims: stage.createUniformBuffer({
        label: 'sam31.memory.position-dims',
        schema: [
          { name: 'batch', type: 'u32' }, { name: 'height', type: 'u32' }, { name: 'width', type: 'u32' },
          { name: 'channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: 'temperature', type: 'f32' }, { name: 'scale', type: 'f32' },
        ],
        values: {
          batch: shape.batch,
          height: shape.featureHeight,
          width: shape.featureWidth,
          channels: shape.featureChannels,
          total_output: shape.batch * shape.featureHeight * shape.featureWidth * shape.featureChannels,
          temperature: config.positionTemperature,
          scale: Math.PI * 2,
        },
      }),
      noObjectDims: stage.createUniformBuffer({
        label: 'sam31.memory.no-object-dims',
        schema: [
          { name: 'batch', type: 'u32' }, { name: 'spatial', type: 'u32' }, { name: 'channels', type: 'u32' },
          { name: 'multiplex_count', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: 'score_threshold', type: 'f32' },
        ],
        values: {
          batch: shape.batch, spatial: shape.featureHeight * shape.featureWidth, channels: shape.featureChannels,
          multiplex_count: shape.multiplexCount, total_output: shape.batch * shape.featureHeight * shape.featureWidth * shape.featureChannels,
          score_threshold: config.objectScoreLogitThreshold,
        },
      }),
    };
    normalizedWeights.downsampleLayers.forEach((layer, index) => {
      const outShape = downsampleShapes[index];
      tensors[`down${index}Conv`] = tensor(`sam31.memory.downsample-${index}.conv`, [shape.batch, outShape.height, outShape.width, outShape.channels]);
      tensors[`down${index}Norm`] = tensor(`sam31.memory.downsample-${index}.norm`, [shape.batch, outShape.height, outShape.width, outShape.channels]);
      tensors[`down${index}Gelu`] = tensor(`sam31.memory.downsample-${index}.gelu`, [shape.batch, outShape.height, outShape.width, outShape.channels]);
      tensors[`down${index}Weight`] = tensor(`sam31.memory.downsample-${index}.weight`, convWeightShape(layer.conv), readonlyUsage);
      tensors[`down${index}Bias`] = tensor(`sam31.memory.downsample-${index}.bias`, [layer.conv.outChannels], readonlyUsage);
      tensors[`down${index}NormWeight`] = tensor(`sam31.memory.downsample-${index}.norm-weight`, [layer.conv.outChannels], readonlyUsage);
      tensors[`down${index}NormBias`] = tensor(`sam31.memory.downsample-${index}.norm-bias`, [layer.conv.outChannels], readonlyUsage);
      stage.uploadTensor(tensors[`down${index}Weight`], layer.conv.weight);
      stage.uploadTensor(tensors[`down${index}Bias`], layer.conv.bias);
      stage.uploadTensor(tensors[`down${index}NormWeight`], layer.layerNorm.weight);
      stage.uploadTensor(tensors[`down${index}NormBias`], layer.layerNorm.bias);
    });
    tensors.maskFinalWeight = tensor('sam31.memory.mask-final.weight', convWeightShape(normalizedWeights.maskFinal), readonlyUsage);
    tensors.maskFinalBias = tensor('sam31.memory.mask-final.bias', [normalizedWeights.maskFinal.outChannels], readonlyUsage);
    tensors.featureProjectionWeight = tensor('sam31.memory.feature-projection.weight', convWeightShape(normalizedWeights.featureProjection), readonlyUsage);
    tensors.featureProjectionBias = tensor('sam31.memory.feature-projection.bias', [normalizedWeights.featureProjection.outChannels], readonlyUsage);
    normalizedWeights.fuserLayers.forEach((layer, index) => {
      const hiddenChannels = layer.pointwise1.outChannels;
      tensors[`fuser${index}Depthwise`] = tensor(`sam31.memory.fuser-${index}.depthwise`, [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]);
      tensors[`fuser${index}Norm`] = tensor(`sam31.memory.fuser-${index}.norm`, [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]);
      tensors[`fuser${index}Hidden`] = tensor(`sam31.memory.fuser-${index}.hidden`, [shape.batch, shape.featureHeight, shape.featureWidth, hiddenChannels]);
      tensors[`fuser${index}Output`] = tensor(`sam31.memory.fuser-${index}.output`, [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels]);
      tensors[`fuser${index}DepthwiseWeight`] = tensor(`sam31.memory.fuser-${index}.depthwise-weight`, [shape.featureChannels, layer.depthwise.kernelSize, layer.depthwise.kernelSize], readonlyUsage);
      tensors[`fuser${index}DepthwiseBias`] = tensor(`sam31.memory.fuser-${index}.depthwise-bias`, [shape.featureChannels], readonlyUsage);
      tensors[`fuser${index}NormWeight`] = tensor(`sam31.memory.fuser-${index}.norm-weight`, [shape.featureChannels], readonlyUsage);
      tensors[`fuser${index}NormBias`] = tensor(`sam31.memory.fuser-${index}.norm-bias`, [shape.featureChannels], readonlyUsage);
      tensors[`fuser${index}Pw1Weight`] = tensor(`sam31.memory.fuser-${index}.pw1-weight`, [hiddenChannels, shape.featureChannels], readonlyUsage);
      tensors[`fuser${index}Pw1Bias`] = tensor(`sam31.memory.fuser-${index}.pw1-bias`, [hiddenChannels], readonlyUsage);
      tensors[`fuser${index}Pw2Weight`] = tensor(`sam31.memory.fuser-${index}.pw2-weight`, [shape.featureChannels, hiddenChannels], readonlyUsage);
      tensors[`fuser${index}Pw2Bias`] = tensor(`sam31.memory.fuser-${index}.pw2-bias`, [shape.featureChannels], readonlyUsage);
      tensors[`fuser${index}Scale`] = tensor(`sam31.memory.fuser-${index}.scale`, [shape.featureChannels], readonlyUsage);
      stage.uploadTensor(tensors[`fuser${index}DepthwiseWeight`], layer.depthwise.weight);
      stage.uploadTensor(tensors[`fuser${index}DepthwiseBias`], layer.depthwise.bias);
      stage.uploadTensor(tensors[`fuser${index}NormWeight`], layer.layerNorm.weight);
      stage.uploadTensor(tensors[`fuser${index}NormBias`], layer.layerNorm.bias);
      stage.uploadTensor(tensors[`fuser${index}Pw1Weight`], layer.pointwise1.weight);
      stage.uploadTensor(tensors[`fuser${index}Pw1Bias`], layer.pointwise1.bias);
      stage.uploadTensor(tensors[`fuser${index}Pw2Weight`], layer.pointwise2.weight);
      stage.uploadTensor(tensors[`fuser${index}Pw2Bias`], layer.pointwise2.bias);
      stage.uploadTensor(tensors[`fuser${index}Scale`], layer.scale);
    });
    stage.uploadTensor(tensors.maskLogits, maskLogitValues);
    stage.uploadTensor(tensors.conditioning, shape.conditioning);
    stage.uploadTensor(tensors.objectScores, objectScoreValues);
    stage.uploadTensor(tensors.noObjectSpatialEmbedding, normalizedWeights.noObjectSpatialEmbedding);
    stage.uploadTensor(tensors.propagationFeature, propagationFeatureValues);
    stage.uploadTensor(tensors.maskFinalWeight, normalizedWeights.maskFinal.weight);
    stage.uploadTensor(tensors.maskFinalBias, normalizedWeights.maskFinal.bias);
    stage.uploadTensor(tensors.featureProjectionWeight, normalizedWeights.featureProjection.weight);
    stage.uploadTensor(tensors.featureProjectionBias, normalizedWeights.featureProjection.bias);
    await stage.yieldToBrowser({ reason: 'after-sam31-memory-encoder-upload' });
  }, {
    shape,
    maskOwnership: 'B,M,H,W logits plus B,M conditioning values -> B,H,W,2M encoder channels',
    referenceBoundary: 'Meta VideoTrackingMultiplex._encode_new_memory -> SimpleMaskEncoder -> PositionEmbeddingSine',
  });

  const bindTensor = (name, access = 'read-only-storage') => ({ name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = name => ({ name, resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const kernels = {
    maskResample: { code: MEMORY_MASK_RESAMPLE_WGSL, bindings: [bindTensor('maskLogits'), bindTensor('conditioning'), bindTensor('output', 'storage'), bindUniform('maskResampleDims')] },
    conv2d: { code: MEMORY_CONV2D_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('convDims')] },
    layerNorm: { code: MEMORY_LAYERNORM_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('layerNormDims')] },
    gelu: { code: MEMORY_GELU_WGSL, bindings: [bindTensor('input'), bindTensor('output', 'storage')] },
    add: { code: MEMORY_ADD_WGSL, bindings: [bindTensor('left'), bindTensor('right'), bindTensor('output', 'storage')] },
    depthwise: { code: MEMORY_DEPTHWISE_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('convDims')] },
    pointwise1Gelu: { code: MEMORY_POINTWISE_1_GELU_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('linearDims')] },
    pointwise2ScaleResidual: { code: MEMORY_POINTWISE_2_SCALE_RESIDUAL_WGSL, bindings: [bindTensor('input'), bindTensor('residual'), bindTensor('weight'), bindTensor('bias'), bindTensor('scale'), bindTensor('output', 'storage'), bindUniform('linearDims')] },
    positionEncoding: { code: MEMORY_POSITION_ENCODING_WGSL, bindings: [bindTensor('output', 'storage'), bindUniform('positionDims')] },
    noObjectSpatialAdd: { code: MEMORY_NO_OBJECT_SPATIAL_ADD_WGSL, bindings: [bindTensor('input'), bindTensor('objectScores'), bindTensor('noObjectSpatialEmbedding'), bindTensor('output', 'storage'), bindUniform('noObjectDims')] },
  };
  const metadata = {
    routeId: SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
    layout: 'B,H,W,C',
    sourceLayout: 'B,C,H,W',
    checkpointRevision: input.model?.revision || route.model?.revision,
  };
  const runProgram = async ({ name, kernel, programTensors, uniforms = {}, total }) => {
    const program = runtime.defineProgram({
      name: `sam31.memory.${name}`,
      tensors: programTensors,
      uniforms,
      kernels,
      phases: [{ name, kernel, dispatch: [workgroups(total)], yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(program);
  };
  const runConv = async ({ name, inputTensor, outputTensor, weightTensor, biasTensor, inShape, outShape, spec, depthwise = false }) => {
    tensors.convDims.update(convDimsValues(shape, inShape, spec, outShape));
    await runProgram({
      name,
      kernel: depthwise ? 'depthwise' : 'conv2d',
      programTensors: { input: tensors[inputTensor], weight: tensors[weightTensor], bias: tensors[biasTensor], output: tensors[outputTensor] },
      uniforms: { convDims: tensors.convDims },
      total: shape.batch * outShape.height * outShape.width * outShape.channels,
    });
  };
  const runLayerNorm = async ({ name, inputTensor, outputTensor, weightTensor, biasTensor, height, width, channels, spec }) => {
    const rows = shape.batch * height * width;
    tensors.layerNormDims.update({ rows, channels, epsilon: spec.epsilon });
    await runProgram({
      name,
      kernel: 'layerNorm',
      programTensors: { input: tensors[inputTensor], weight: tensors[weightTensor], bias: tensors[biasTensor], output: tensors[outputTensor] },
      uniforms: { layerNormDims: tensors.layerNormDims },
      total: rows,
    });
  };

  await runProgram({
    name: 'memory-mask-resample',
    kernel: 'maskResample',
    programTensors: { maskLogits: tensors.maskLogits, conditioning: tensors.conditioning, output: tensors.resampledMask },
    uniforms: { maskResampleDims: tensors.maskResampleDims },
    total: shape.batch * shape.resampledMaskHeight * shape.resampledMaskWidth * shape.maskInputChannels,
  });
  let currentTensor = 'resampledMask';
  let currentShape = { height: shape.resampledMaskHeight, width: shape.resampledMaskWidth, channels: shape.maskInputChannels };
  for (let index = 0; index < normalizedWeights.downsampleLayers.length; index += 1) {
    const layer = normalizedWeights.downsampleLayers[index];
    const outShape = downsampleShapes[index];
    await runConv({ name: `memory-mask-downsample-${index}`, inputTensor: currentTensor, outputTensor: `down${index}Conv`, weightTensor: `down${index}Weight`, biasTensor: `down${index}Bias`, inShape: currentShape, outShape, spec: layer.conv });
    await runLayerNorm({ name: `memory-mask-downsample-${index}-layernorm`, inputTensor: `down${index}Conv`, outputTensor: `down${index}Norm`, weightTensor: `down${index}NormWeight`, biasTensor: `down${index}NormBias`, height: outShape.height, width: outShape.width, channels: outShape.channels, spec: layer.layerNorm });
    await runProgram({ name: `memory-mask-downsample-${index}-gelu`, kernel: 'gelu', programTensors: { input: tensors[`down${index}Norm`], output: tensors[`down${index}Gelu`] }, total: shape.batch * outShape.height * outShape.width * outShape.channels });
    currentTensor = `down${index}Gelu`;
    currentShape = outShape;
  }
  await runConv({ name: 'memory-mask-final-projection', inputTensor: currentTensor, outputTensor: 'maskProjected', weightTensor: 'maskFinalWeight', biasTensor: 'maskFinalBias', inShape: currentShape, outShape: featureShape, spec: normalizedWeights.maskFinal });
  await runConv({ name: 'memory-feature-projection', inputTensor: 'propagationFeature', outputTensor: 'featureProjected', weightTensor: 'featureProjectionWeight', biasTensor: 'featureProjectionBias', inShape: featureShape, outShape: featureShape, spec: normalizedWeights.featureProjection });
  const featureValues = shape.batch * shape.featureHeight * shape.featureWidth * shape.featureChannels;
  await runProgram({ name: 'memory-feature-mask-add', kernel: 'add', programTensors: { left: tensors.featureProjected, right: tensors.maskProjected, output: tensors.fusedInitial }, total: featureValues });

  let residualTensor = 'fusedInitial';
  const rows = shape.batch * shape.featureHeight * shape.featureWidth;
  for (let index = 0; index < normalizedWeights.fuserLayers.length; index += 1) {
    const layer = normalizedWeights.fuserLayers[index];
    await runConv({ name: `memory-fuser-${index}-depthwise`, inputTensor: residualTensor, outputTensor: `fuser${index}Depthwise`, weightTensor: `fuser${index}DepthwiseWeight`, biasTensor: `fuser${index}DepthwiseBias`, inShape: featureShape, outShape: featureShape, spec: layer.depthwise, depthwise: true });
    await runLayerNorm({ name: `memory-fuser-${index}-layernorm`, inputTensor: `fuser${index}Depthwise`, outputTensor: `fuser${index}Norm`, weightTensor: `fuser${index}NormWeight`, biasTensor: `fuser${index}NormBias`, height: shape.featureHeight, width: shape.featureWidth, channels: shape.featureChannels, spec: layer.layerNorm });
    tensors.linearDims.update(linearDimsValues(rows, layer.pointwise1));
    await runProgram({
      name: `memory-fuser-${index}-pointwise-1-gelu`,
      kernel: 'pointwise1Gelu',
      programTensors: { input: tensors[`fuser${index}Norm`], weight: tensors[`fuser${index}Pw1Weight`], bias: tensors[`fuser${index}Pw1Bias`], output: tensors[`fuser${index}Hidden`] },
      uniforms: { linearDims: tensors.linearDims },
      total: rows * layer.pointwise1.outChannels,
    });
    tensors.linearDims.update(linearDimsValues(rows, layer.pointwise2));
    await runProgram({
      name: `memory-fuser-${index}-pointwise-2-scale-residual`,
      kernel: 'pointwise2ScaleResidual',
      programTensors: { input: tensors[`fuser${index}Hidden`], residual: tensors[residualTensor], weight: tensors[`fuser${index}Pw2Weight`], bias: tensors[`fuser${index}Pw2Bias`], scale: tensors[`fuser${index}Scale`], output: tensors[`fuser${index}Output`] },
      uniforms: { linearDims: tensors.linearDims },
      total: featureValues,
    });
    residualTensor = `fuser${index}Output`;
  }
  await runProgram({ name: 'memory-no-object-spatial-add', kernel: 'noObjectSpatialAdd', programTensors: { input: tensors[residualTensor], objectScores: tensors.objectScores, noObjectSpatialEmbedding: tensors.noObjectSpatialEmbedding, output: tensors.noObjectOutput }, uniforms: { noObjectDims: tensors.noObjectDims }, total: featureValues });
  residualTensor = 'noObjectOutput';
  await runProgram({ name: 'memory-position-encoding', kernel: 'positionEncoding', programTensors: { output: tensors.positionEncoding }, uniforms: { positionDims: tensors.positionDims }, total: featureValues });
  const readback = await runtime.runStage('readback-memory-encoder-features', async stage => ({
    memoryFeatures: await stage.readTensor(tensors[residualTensor]),
    memoryPositionEncoding: await stage.readTensor(tensors.positionEncoding),
  }), {
    outputShape: [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels],
    outputRoles: OUTPUT_ROLES.map(output => output.role),
  });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const propagationFeature = roleArtifact(input.request.inputs, 'sam31-propagation-feature-2');
  const maskLogits = roleArtifact(input.request.inputs, 'sam31-multiplex-mask-logits');
  const weights = roleArtifact(input.request.inputs, 'sam31-memory-encoder-weights');
  const outputShape = [shape.batch, shape.featureHeight, shape.featureWidth, shape.featureChannels];
  const outputs = {
    memoryFeatures: { artifactId: roleArtifact(input.request.outputs, 'sam31-mask-memory-features').artifactId, sha256: await sha256Hex(readback.memoryFeatures), shape: outputShape },
    memoryPositionEncoding: { artifactId: roleArtifact(input.request.outputs, 'sam31-mask-memory-position-encoding').artifactId, sha256: await sha256Hex(readback.memoryPositionEncoding), shape: outputShape },
  };
  const receipt = createSam31MemoryEncoderPhaseProgramRouteReceipt({
    sourceImage,
    propagationFeature,
    maskLogits,
    conditioning,
    objectScores,
    weights,
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
      memoryFeatures: Array.from(new Float32Array(readback.memoryFeatures)),
      memoryPositionEncoding: Array.from(new Float32Array(readback.memoryPositionEncoding)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}

export const SAM31_MEMORY_ENCODER_WEBGPU_CONTRACT = Object.freeze({
  layout: 'B,H,W,C',
  sourceLayout: 'B,C,H,W',
  maskLogitsLayout: 'B,M,H,W',
  maskChannels: 'multiplex mask channels followed by multiplex conditioning channels',
  requiredStages: REQUIRED_STAGES,
  bufferUsage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc,
  shaderVisibility: WEBGPU_SHADER_STAGE.compute,
});
