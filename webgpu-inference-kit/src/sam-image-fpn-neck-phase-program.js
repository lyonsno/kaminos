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
import { createSam3PositionEmbeddingSine } from './sam-detr-image-ingress.js';

export const SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-fpn-neck.phase-program.webgpu-local.v0';
export const SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.propagation-neck.phase-program.webgpu-local.v0';
export const SAM31_INTERACTIVE_NECK_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.interactive-neck.phase-program.webgpu-local.v0';
export const SAM31_IMAGE_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID = 'sam3.1.image-propagation-neck.phase-program.webgpu-local.v0';

const SAM3_MODEL_ID = 'facebook/sam3';
const DEFAULT_KERNEL_PROFILE = 'sam3-image-fpn-neck-phase-program-v0';
const REQUIRED_STAGES = [
  'load-image-fpn-neck-tensors',
  'fpn-neck-transpose-conv-0-scale0',
  'fpn-neck-gelu-0',
  'fpn-neck-transpose-conv-0-scale1',
  'fpn-neck-proj1-0',
  'fpn-neck-proj2-0',
  'fpn-neck-transpose-conv-1',
  'fpn-neck-proj1-1',
  'fpn-neck-proj2-1',
  'fpn-neck-proj1-2',
  'fpn-neck-proj2-2',
  'fpn-neck-maxpool-3',
  'fpn-neck-proj1-3',
  'fpn-neck-proj2-3',
  'readback-fpn-neck-features',
];
const INPUT_ROLES = ['source-image', 'vit-backbone-hidden-states', 'sam3-image-fpn-neck-weights'];
const OUTPUT_ROLES = [
  { key: 'fpnNeckFeature0', role: 'fpn-neck-feature-0', required: true },
  { key: 'fpnNeckFeature1', role: 'fpn-neck-feature-1', required: true },
  { key: 'fpnNeckFeature2', role: 'fpn-neck-feature-2', required: true },
  { key: 'fpnNeckFeature3', role: 'fpn-neck-feature-3', required: true },
];
const SAM31_REQUIRED_STAGES = REQUIRED_STAGES.filter(stage => !stage.endsWith('-3'));
const SAM31_INPUT_ROLES = ['source-image', 'sam31-vit-backbone-hidden-states', 'sam31-propagation-neck-weights'];
const SAM31_OUTPUT_ROLES = [
  { key: 'propagationFeature0', role: 'sam31-propagation-feature-0', required: true },
  { key: 'propagationFeature1', role: 'sam31-propagation-feature-1', required: true },
  { key: 'propagationFeature2', role: 'sam31-propagation-feature-2', required: true },
];
const SAM31_IMAGE_NECK_REQUIRED_STAGES = [...SAM31_REQUIRED_STAGES.slice(0, -1), 'fpn-neck-position-2', SAM31_REQUIRED_STAGES.at(-1)];

function sam31TrackingNeckDescriptor(branch, includePosition = true) {
  if (!['interactive', 'propagation'].includes(branch)) throw new Error(`unsupported SAM3.1 tracking neck branch: ${branch}`);
  const imagePropagation = branch === 'propagation' && includePosition;
  const routeId = branch === 'interactive'
    ? SAM31_INTERACTIVE_NECK_PHASE_PROGRAM_ROUTE_ID
    : imagePropagation
      ? SAM31_IMAGE_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID
      : SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID;
  const outputRoles = [0, 1, 2].map(level => ({ key: `${branch}Feature${level}`, role: `sam31-${branch}-feature-${level}`, required: true }));
  if (includePosition) outputRoles.push({ key: `${branch}Position2`, role: `sam31-${branch}-position-2`, required: true });
  return {
    branch,
    includePosition,
    routeId,
    inputRoles: ['source-image', 'sam31-vit-backbone-hidden-states', `sam31-${branch}-neck-weights`],
    outputRoles,
    requiredStages: includePosition ? SAM31_IMAGE_NECK_REQUIRED_STAGES : SAM31_REQUIRED_STAGES,
  };
}

function sam31TrackingNeckDescriptorForRoute(route) {
  if (route.routeId === SAM31_INTERACTIVE_NECK_PHASE_PROGRAM_ROUTE_ID) return sam31TrackingNeckDescriptor('interactive', true);
  if (route.routeId === SAM31_IMAGE_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID) return sam31TrackingNeckDescriptor('propagation', true);
  if (route.routeId === SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID) return sam31TrackingNeckDescriptor('propagation', false);
  throw new Error(`unsupported SAM3.1 tracking neck route: ${route.routeId}`);
}

const TRANSPOSE_CONV2D_WGSL = `
struct FpnConvDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  input_channels: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  kernel_h: u32,
  kernel_w: u32,
  stride: u32,
  padding: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: FpnConvDims;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_output) { return; }
  let out_c = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[out_c];
  for (var ky = 0u; ky < dims.kernel_h; ky = ky + 1u) {
    if (out_y + dims.padding < ky) { continue; }
    let y_delta = out_y + dims.padding - ky;
    if ((y_delta % dims.stride) != 0u) { continue; }
    let in_y = y_delta / dims.stride;
    if (in_y >= dims.input_height) { continue; }
    for (var kx = 0u; kx < dims.kernel_w; kx = kx + 1u) {
      if (out_x + dims.padding < kx) { continue; }
      let x_delta = out_x + dims.padding - kx;
      if ((x_delta % dims.stride) != 0u) { continue; }
      let in_x = x_delta / dims.stride;
      if (in_x >= dims.input_width) { continue; }
      let input_base = ((batch * dims.input_height + in_y) * dims.input_width + in_x) * dims.input_channels;
      let weight_base = ((out_c * dims.kernel_h + ky) * dims.kernel_w + kx) * dims.input_channels;
      for (var in_c = 0u; in_c < dims.input_channels; in_c = in_c + 1u) {
        sum = sum + input_values[input_base + in_c] * weight[weight_base + in_c];
      }
    }
  }
  output_values[index] = sum;
}
`;

const CONV2D_WGSL = `
struct FpnConvDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  input_channels: u32,
  output_height: u32,
  output_width: u32,
  output_channels: u32,
  kernel_h: u32,
  kernel_w: u32,
  stride: u32,
  padding: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: FpnConvDims;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_output) { return; }
  let out_c = index % dims.output_channels;
  let out_x = (index / dims.output_channels) % dims.output_width;
  let out_y = (index / (dims.output_channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.output_channels * dims.output_width * dims.output_height);
  var sum = bias[out_c];
  for (var ky = 0u; ky < dims.kernel_h; ky = ky + 1u) {
    let in_y_signed = i32(out_y * dims.stride + ky) - i32(dims.padding);
    if (in_y_signed < 0 || in_y_signed >= i32(dims.input_height)) { continue; }
    for (var kx = 0u; kx < dims.kernel_w; kx = kx + 1u) {
      let in_x_signed = i32(out_x * dims.stride + kx) - i32(dims.padding);
      if (in_x_signed < 0 || in_x_signed >= i32(dims.input_width)) { continue; }
      let in_y = u32(in_y_signed);
      let in_x = u32(in_x_signed);
      let input_base = ((batch * dims.input_height + in_y) * dims.input_width + in_x) * dims.input_channels;
      let weight_base = ((out_c * dims.kernel_h + ky) * dims.kernel_w + kx) * dims.input_channels;
      for (var in_c = 0u; in_c < dims.input_channels; in_c = in_c + 1u) {
        sum = sum + input_values[input_base + in_c] * weight[weight_base + in_c];
      }
    }
  }
  output_values[index] = sum;
}
`;

const GELU_WGSL = `
@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;

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
  if (index >= arrayLength(&output_values)) { return; }
  output_values[index] = gelu_exact_approx(input_values[index]);
}
`;

const SAM31_NECK_POSITION_ENCODING_WGSL = `
struct PositionDims { batch: u32, height: u32, width: u32, channels: u32, total_output: u32, temperature: f32, scale: f32 };
@group(0) @binding(0) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(1) var<uniform> dims: PositionDims;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
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

const MAXPOOL2D_WGSL = `
struct FpnPoolDims {
  batch: u32,
  input_height: u32,
  input_width: u32,
  channels: u32,
  output_height: u32,
  output_width: u32,
  total_output: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(2) var<uniform> dims: FpnPoolDims;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let index = gid.x + gid.y * dispatch_grid.x * 64u;
  if (index >= dims.total_output) { return; }
  let channel = index % dims.channels;
  let out_x = (index / dims.channels) % dims.output_width;
  let out_y = (index / (dims.channels * dims.output_width)) % dims.output_height;
  let batch = index / (dims.channels * dims.output_width * dims.output_height);
  let in_y0 = out_y * 2u;
  let in_x0 = out_x * 2u;
  var max_value = -3.4028234663852886e38;
  for (var dy = 0u; dy < 2u; dy = dy + 1u) {
    let in_y = in_y0 + dy;
    if (in_y >= dims.input_height) { continue; }
    for (var dx = 0u; dx < 2u; dx = dx + 1u) {
      let in_x = in_x0 + dx;
      if (in_x >= dims.input_width) { continue; }
      let input_index = ((batch * dims.input_height + in_y) * dims.input_width + in_x) * dims.channels + channel;
      max_value = max(max_value, input_values[input_index]);
    }
  }
  output_values[index] = max_value;
}
`;

function createDefaultScheduler(requiredStages = REQUIRED_STAGES, notes = 'SAM3 image FPN-neck phase program cooperates between transpose-conv, GELU, max-pool, projection-conv, and readback boundaries for FPN levels 0..3.') {
  return createWebGpuRouteSchedulerProfile({
    requestedScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(requiredStages.map(stage => [stage, 1])) },
    effectiveScheduler: { mode: 'cooperative', yieldMs: 0, waitForSubmittedWorkDone: true, phaseChunkSize: Object.fromEntries(requiredStages.map(stage => [stage, 1])), unsupportedFields: [] },
    verificationState: 'scheduler-unverified',
    breathability: {
      spans: requiredStages.map(stage => ({ name: `${stage}-phase`, stage, kind: stage === 'readback-fpn-neck-features' ? 'readback-bound' : 'gpu-submit-bound', interruptible: false, canYieldBefore: true, canYieldAfter: true })),
      checkpoints: requiredStages.map(stage => ({ name: `after-${stage}`, kind: stage === 'readback-fpn-neck-features' ? 'readback' : 'stage-boundary', afterStage: stage, yieldable: true, waitsForSubmittedWorkDone: stage !== 'readback-fpn-neck-features' })),
      notes,
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

function normalizeShape(shape = {}, expectedLevels = 4) {
  const out = {
    batch: shape.batch,
    backboneHeight: shape.backboneHeight ?? shape.patchHeight ?? shape.height,
    backboneWidth: shape.backboneWidth ?? shape.patchWidth ?? shape.width,
    backboneChannels: shape.backboneChannels ?? shape.visionHiddenSize,
    fpnHiddenSize: shape.fpnHiddenSize ?? 256,
    levels: shape.levels,
  };
  for (const key of ['batch', 'backboneHeight', 'backboneWidth', 'backboneChannels', 'fpnHiddenSize']) {
    if (!Number.isInteger(out[key]) || out[key] <= 0) throw new Error(`shape.${key} must be a positive integer`);
  }
  if (!Array.isArray(out.levels) || out.levels.length !== expectedLevels) throw new Error(`shape.levels must describe exactly FPN levels 0 through ${expectedLevels - 1}`);
  out.levels = out.levels.map((level, index) => {
    if (!Number.isInteger(level.level) || level.level !== index) throw new Error('shape.levels must be ordered levels 0, 1, 2, and 3');
    if (!Number.isInteger(level.height) || level.height <= 0) throw new Error(`shape.levels[${index}].height must be a positive integer`);
    if (!Number.isInteger(level.width) || level.width <= 0) throw new Error(`shape.levels[${index}].width must be a positive integer`);
    return { level: index, scaleFactor: Number(level.scaleFactor), height: level.height, width: level.width };
  });
  return out;
}

function normalizeConvSpec(spec, name) {
  if (!spec || typeof spec !== 'object') throw new Error(`${name} is required`);
  const weight = ensureFloat32Array(spec.weight, `${name}.weight`);
  const bias = ensureFloat32Array(spec.bias, `${name}.bias`);
  const out = {
    weight,
    bias,
    kernelSize: spec.kernelSize,
    stride: spec.stride ?? 1,
    padding: spec.padding ?? 0,
    inChannels: spec.inChannels,
    outChannels: spec.outChannels,
    activation: spec.activation || null,
  };
  for (const key of ['kernelSize', 'stride', 'padding', 'inChannels', 'outChannels']) {
    if (!Number.isInteger(out[key]) || out[key] < 0 || (key !== 'padding' && out[key] === 0)) throw new Error(`${name}.${key} must be a valid integer`);
  }
  const expectedWeights = out.outChannels * out.kernelSize * out.kernelSize * out.inChannels;
  if (weight.length !== expectedWeights) throw new Error(`${name}.weight length ${weight.length} does not match out,kH,kW,in layout (${expectedWeights})`);
  if (bias.length !== out.outChannels) throw new Error(`${name}.bias length ${bias.length} does not match output channels (${out.outChannels})`);
  return out;
}

function normalizeWeights(weights = {}, shape, expectedLevels = 4) {
  if (!Array.isArray(weights.levels) || weights.levels.length !== expectedLevels) throw new Error(`weights.levels must contain FPN levels 0 through ${expectedLevels - 1}`);
  return {
    levels: weights.levels.map((level, index) => {
      if (!level || level.level !== index) throw new Error('weights.levels must be ordered levels 0, 1, 2, and 3');
      const scaleLayers = (level.scaleLayers || []).map((spec, scaleIndex) => normalizeConvSpec(spec, `weights.levels[${index}].scaleLayers[${scaleIndex}]`));
      const proj1 = normalizeConvSpec(level.proj1, `weights.levels[${index}].proj1`);
      const proj2 = normalizeConvSpec(level.proj2, `weights.levels[${index}].proj2`);
      if (proj1.outChannels !== shape.fpnHiddenSize || proj2.inChannels !== shape.fpnHiddenSize || proj2.outChannels !== shape.fpnHiddenSize) throw new Error(`weights.levels[${index}] projections must use shape.fpnHiddenSize`);
      return { level: index, scaleLayers, proj1, proj2 };
    }),
  };
}

function validateImageFpnNeckInputs(input = {}, expectedLevels = 4) {
  const shape = normalizeShape(input.shape, expectedLevels);
  const backboneHiddenStates = ensureFloat32Array(input.backboneHiddenStates, 'backboneHiddenStates');
  const expectedBackbone = shape.batch * shape.backboneHeight * shape.backboneWidth * shape.backboneChannels;
  if (backboneHiddenStates.length !== expectedBackbone) throw new Error(`backboneHiddenStates length ${backboneHiddenStates.length} does not match shape (${expectedBackbone})`);
  const weights = normalizeWeights(input.weights, shape, expectedLevels);
  return { shape, backboneHiddenStates, weights };
}

function gelu(value) {
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

function convTranspose2d(input, inShape, spec) {
  const outHeight = (inShape.height - 1) * spec.stride - 2 * spec.padding + spec.kernelSize;
  const outWidth = (inShape.width - 1) * spec.stride - 2 * spec.padding + spec.kernelSize;
  const out = new Float32Array(inShape.batch * outHeight * outWidth * spec.outChannels);
  for (let batch = 0; batch < inShape.batch; batch += 1) {
    for (let outY = 0; outY < outHeight; outY += 1) {
      for (let outX = 0; outX < outWidth; outX += 1) {
        for (let outChannel = 0; outChannel < spec.outChannels; outChannel += 1) {
          let sum = spec.bias[outChannel];
          for (let ky = 0; ky < spec.kernelSize; ky += 1) {
            const yDelta = outY + spec.padding - ky;
            if (yDelta < 0 || yDelta % spec.stride !== 0) continue;
            const inY = yDelta / spec.stride;
            if (inY < 0 || inY >= inShape.height) continue;
            for (let kx = 0; kx < spec.kernelSize; kx += 1) {
              const xDelta = outX + spec.padding - kx;
              if (xDelta < 0 || xDelta % spec.stride !== 0) continue;
              const inX = xDelta / spec.stride;
              if (inX < 0 || inX >= inShape.width) continue;
              const inputBase = ((batch * inShape.height + inY) * inShape.width + inX) * inShape.channels;
              const weightBase = ((outChannel * spec.kernelSize + ky) * spec.kernelSize + kx) * spec.inChannels;
              for (let inChannel = 0; inChannel < spec.inChannels; inChannel += 1) {
                sum += input[inputBase + inChannel] * spec.weight[weightBase + inChannel];
              }
            }
          }
          out[((batch * outHeight + outY) * outWidth + outX) * spec.outChannels + outChannel] = sum;
        }
      }
    }
  }
  return { data: out, shape: { batch: inShape.batch, height: outHeight, width: outWidth, channels: spec.outChannels } };
}

function conv2d(input, inShape, spec) {
  const outHeight = Math.floor((inShape.height + 2 * spec.padding - spec.kernelSize) / spec.stride) + 1;
  const outWidth = Math.floor((inShape.width + 2 * spec.padding - spec.kernelSize) / spec.stride) + 1;
  const out = new Float32Array(inShape.batch * outHeight * outWidth * spec.outChannels);
  for (let batch = 0; batch < inShape.batch; batch += 1) {
    for (let outY = 0; outY < outHeight; outY += 1) {
      for (let outX = 0; outX < outWidth; outX += 1) {
        for (let outChannel = 0; outChannel < spec.outChannels; outChannel += 1) {
          let sum = spec.bias[outChannel];
          for (let ky = 0; ky < spec.kernelSize; ky += 1) {
            const inY = outY * spec.stride + ky - spec.padding;
            if (inY < 0 || inY >= inShape.height) continue;
            for (let kx = 0; kx < spec.kernelSize; kx += 1) {
              const inX = outX * spec.stride + kx - spec.padding;
              if (inX < 0 || inX >= inShape.width) continue;
              const inputBase = ((batch * inShape.height + inY) * inShape.width + inX) * inShape.channels;
              const weightBase = ((outChannel * spec.kernelSize + ky) * spec.kernelSize + kx) * spec.inChannels;
              for (let inChannel = 0; inChannel < spec.inChannels; inChannel += 1) {
                sum += input[inputBase + inChannel] * spec.weight[weightBase + inChannel];
              }
            }
          }
          out[((batch * outHeight + outY) * outWidth + outX) * spec.outChannels + outChannel] = sum;
        }
      }
    }
  }
  return { data: out, shape: { batch: inShape.batch, height: outHeight, width: outWidth, channels: spec.outChannels } };
}

function maxPool2dStride2(input, inShape) {
  const outHeight = Math.floor(inShape.height / 2);
  const outWidth = Math.floor(inShape.width / 2);
  const out = new Float32Array(inShape.batch * outHeight * outWidth * inShape.channels);
  for (let batch = 0; batch < inShape.batch; batch += 1) {
    for (let outY = 0; outY < outHeight; outY += 1) {
      for (let outX = 0; outX < outWidth; outX += 1) {
        for (let channel = 0; channel < inShape.channels; channel += 1) {
          let maxValue = -Infinity;
          for (let dy = 0; dy < 2; dy += 1) {
            for (let dx = 0; dx < 2; dx += 1) {
              const inY = outY * 2 + dy;
              const inX = outX * 2 + dx;
              const value = input[((batch * inShape.height + inY) * inShape.width + inX) * inShape.channels + channel];
              if (value > maxValue) maxValue = value;
            }
          }
          out[((batch * outHeight + outY) * outWidth + outX) * inShape.channels + channel] = maxValue;
        }
      }
    }
  }
  return { data: out, shape: { batch: inShape.batch, height: outHeight, width: outWidth, channels: inShape.channels } };
}

function applyGelu(input) {
  const out = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) out[index] = gelu(input[index]);
  return out;
}

function createImageFpnNeckCpuOracle(input, expectedLevels) {
  const { shape, backboneHiddenStates, weights } = validateImageFpnNeckInputs(input, expectedLevels);
  const levels = [];
  const fpnNeckFeatures = [];
  for (const levelWeights of weights.levels) {
    let current = backboneHiddenStates;
    let currentShape = { batch: shape.batch, height: shape.backboneHeight, width: shape.backboneWidth, channels: shape.backboneChannels };
    for (const scaleLayer of levelWeights.scaleLayers) {
      const scaled = convTranspose2d(current, currentShape, scaleLayer);
      current = scaleLayer.activation === 'gelu' ? applyGelu(scaled.data) : scaled.data;
      currentShape = scaled.shape;
    }
    if (levelWeights.scaleLayers.length === 0 && shape.levels[levelWeights.level]?.scaleFactor <= 0.5) {
      const pooled = maxPool2dStride2(current, currentShape);
      current = pooled.data;
      currentShape = pooled.shape;
    }
    const proj1 = conv2d(current, currentShape, levelWeights.proj1);
    const proj2 = conv2d(proj1.data, proj1.shape, levelWeights.proj2);
    const expectedLevel = shape.levels[levelWeights.level];
    if (proj2.shape.height !== expectedLevel.height || proj2.shape.width !== expectedLevel.width || proj2.shape.channels !== shape.fpnHiddenSize) throw new Error(`FPN level ${levelWeights.level} output shape mismatch`);
    levels.push({ level: levelWeights.level, shape: [proj2.shape.batch, proj2.shape.height, proj2.shape.width, proj2.shape.channels] });
    fpnNeckFeatures.push(proj2.data);
  }
  return { shape, levels, fpnNeckFeatures };
}

export function createSam3ImageFpnNeckPhaseProgramCpuOracle(input) {
  return createImageFpnNeckCpuOracle(input, 4);
}

export function createSam31PropagationNeckPhaseProgramCpuOracle(input) {
  const result = createImageFpnNeckCpuOracle(input, 3);
  return { ...result, features: result.fpnNeckFeatures };
}

export function createSam31TrackingNeckPhaseProgramCpuOracle(input) {
  const branch = input.branch || 'propagation';
  sam31TrackingNeckDescriptor(branch, true);
  const result = createImageFpnNeckCpuOracle(input, 3);
  const level2 = result.shape.levels[2];
  const position2 = createSam3PositionEmbeddingSine({
    batch: result.shape.batch,
    height: level2.height,
    width: level2.width,
    channels: result.shape.fpnHiddenSize,
  });
  return { ...result, branch, features: result.fpnNeckFeatures, position2 };
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) throw new Error('crypto.subtle.digest is required to hash SAM image FPN-neck outputs');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function outputArtifacts(request, hashes, shape) {
  return {
    fpnNeckFeature0: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-0').artifactId, sha256: hashes.fpnNeckFeature0, shape: [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize] },
    fpnNeckFeature1: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-1').artifactId, sha256: hashes.fpnNeckFeature1, shape: [shape.batch, shape.levels[1].height, shape.levels[1].width, shape.fpnHiddenSize] },
    fpnNeckFeature2: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-2').artifactId, sha256: hashes.fpnNeckFeature2, shape: [shape.batch, shape.levels[2].height, shape.levels[2].width, shape.fpnHiddenSize] },
    fpnNeckFeature3: { artifactId: roleArtifact(request.outputs, 'fpn-neck-feature-3').artifactId, sha256: hashes.fpnNeckFeature3, shape: [shape.batch, shape.levels[3].height, shape.levels[3].width, shape.fpnHiddenSize] },
  };
}

export function createSam3ImageFpnNeckPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('vit-backbone-hidden-states', input.backboneHiddenStates),
      createRouteReceiptInputArtifact('sam3-image-fpn-neck-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

export function createSam3ImageFpnNeckPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: DEFAULT_KERNEL_PROFILE,
    requiredStages: REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: SAM3_MODEL_ID, revision: input.model?.revision || 'sam3-browser-image-fpn-neck', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: OUTPUT_ROLES.map(output => ({ role: output.role, required: output.required, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam3ImageFpnNeckPhaseProgramRoute', upstreamBoundary: 'browser-sam3-vit-backbone-to-detector-consumed-fpn-neck-features' },
  });
}

export function createSam31PropagationNeckPhaseProgramRouteDefinition(input = {}) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: 'sam31-propagation-neck-phase-program-v0',
    requiredStages: SAM31_REQUIRED_STAGES,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID,
    backendKind: 'webgpu-local',
    model: { id: 'facebook/sam3.1', revision: input.model?.revision || 'sam31-browser-propagation-neck', dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: SAM31_INPUT_ROLES.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: SAM31_OUTPUT_ROLES.map(output => ({ role: output.role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(SAM31_REQUIRED_STAGES, 'SAM3.1 propagation neck yields between transpose-conv, GELU, projection-conv, and three-head readback boundaries.'),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: 'runSam31PropagationNeckPhaseProgramRoute', upstreamBoundary: 'browser-sam31-vit-backbone-to-propagation-fpn-features' },
  });
}

function createSam31ImageTrackingNeckPhaseProgramRouteDefinition(input, descriptor) {
  const routeMetadata = createRouteKernelProfileMetadata(input, {
    defaultProfile: `sam31-${descriptor.branch}-neck-phase-program-v0`,
    requiredStages: descriptor.requiredStages,
    timingSource: 'queue-submit-wait',
  });
  return defineWebGpuRoute({
    routeId: descriptor.routeId,
    backendKind: 'webgpu-local',
    model: { id: 'facebook/sam3.1', revision: input.model?.revision || `sam31-browser-${descriptor.branch}-neck`, dtype: input.model?.dtype || 'fp32' },
    kernel: routeMetadata.kernel,
    inputs: descriptor.inputRoles.map(role => ({ role, required: true, artifactRequired: true, hashRequired: true })),
    outputs: descriptor.outputRoles.map(output => ({ role: output.role, required: true, artifactRequired: true, hashRequired: true })),
    requiredFeatures: input.requiredFeatures || [],
    requiredStages: routeMetadata.requiredStages,
    timingSource: routeMetadata.timingSource,
    scheduler: input.scheduler || createDefaultScheduler(descriptor.requiredStages, `SAM3.1 ${descriptor.branch} neck yields between transpose-conv, GELU, projection-conv, position encoding, and readback boundaries.`),
    backpressure: input.backpressure || createDefaultBackpressure(),
    worker: input.worker || { exportName: descriptor.branch === 'interactive' ? 'runSam31InteractiveNeckPhaseProgramRoute' : 'runSam31ImagePropagationNeckPhaseProgramRoute', upstreamBoundary: `browser-sam31-vit-backbone-to-${descriptor.branch}-fpn-features-and-position` },
  });
}

export function createSam31InteractiveNeckPhaseProgramRouteDefinition(input = {}) {
  return createSam31ImageTrackingNeckPhaseProgramRouteDefinition(input, sam31TrackingNeckDescriptor('interactive', true));
}

export function createSam31ImagePropagationNeckPhaseProgramRouteDefinition(input = {}) {
  return createSam31ImageTrackingNeckPhaseProgramRouteDefinition(input, sam31TrackingNeckDescriptor('propagation', true));
}

export function createSam31PropagationNeckPhaseProgramRouteReceipt(input) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: 'facebook/sam3.1', revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam31-vit-backbone-hidden-states', input.backboneHiddenStates),
      createRouteReceiptInputArtifact('sam31-propagation-neck-weights', input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: SAM31_OUTPUT_ROLES }),
    profile: input.profile,
  });
}

function createSam31ImageTrackingNeckPhaseProgramRouteReceipt(input, descriptor) {
  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: descriptor.routeId,
    effectiveRouteId: input.effectiveRouteId || descriptor.routeId,
    status: input.status || 'real',
    fallbackReason: null,
    backend: input.backend,
    model: { id: 'facebook/sam3.1', revision: input.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.sourceImage),
      createRouteReceiptInputArtifact('sam31-vit-backbone-hidden-states', input.backboneHiddenStates),
      createRouteReceiptInputArtifact(`sam31-${descriptor.branch}-neck-weights`, input.weights),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: descriptor.outputRoles }),
    profile: input.profile,
  });
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
    kernel_h: spec.kernelSize,
    kernel_w: spec.kernelSize,
    stride: spec.stride,
    padding: spec.padding,
    total_output: shape.batch * outShape.height * outShape.width * outShape.channels,
  };
}

function poolDimsValues(shape, inShape, outShape) {
  return {
    batch: shape.batch,
    input_height: inShape.height,
    input_width: inShape.width,
    channels: inShape.channels,
    output_height: outShape.height,
    output_width: outShape.width,
    total_output: shape.batch * outShape.height * outShape.width * outShape.channels,
  };
}

function transposeConv2dOutShape(inShape, spec) {
  return {
    height: (inShape.height - 1) * spec.stride - (2 * spec.padding) + spec.kernelSize,
    width: (inShape.width - 1) * spec.stride - (2 * spec.padding) + spec.kernelSize,
    channels: spec.outChannels,
  };
}

export async function runSam3ImageFpnNeckPhaseProgramRoute(input = {}) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || createSam3ImageFpnNeckPhaseProgramRouteDefinition({ kernel: input.kernel });
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const backboneHiddenStatesArtifact = roleArtifact(input.request.inputs, 'vit-backbone-hidden-states');
  const weightsArtifact = roleArtifact(input.request.inputs, 'sam3-image-fpn-neck-weights');
  const { shape, backboneHiddenStates, weights } = validateImageFpnNeckInputs(input.tensors || {});
  const oracleShapes = createSam3ImageFpnNeckPhaseProgramCpuOracle({ backboneHiddenStates, weights, shape }).levels;

  const runtime = await createWebGpuInferenceRuntime({
    routeId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
    runtimeLabel: input.runtimeLabel || 'sam3-image-fpn-neck-phase-program',
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
  const linearDispatch = totalInvocations => createLinearDispatch(totalInvocations, {
    workgroupSize: 64,
    maxWorkgroupsPerDimension: maxComputeWorkgroupsPerDimension,
  });

  let tensors = null;
  const backboneShape = { height: shape.backboneHeight, width: shape.backboneWidth, channels: shape.backboneChannels };
  const level0Scale0Shape = transposeConv2dOutShape(backboneShape, weights.levels[0].scaleLayers[0]);
  const level0Scale1Shape = transposeConv2dOutShape(level0Scale0Shape, weights.levels[0].scaleLayers[1]);
  const level1Scale0Shape = transposeConv2dOutShape(backboneShape, weights.levels[1].scaleLayers[0]);
  const level3PoolShape = { height: Math.floor(backboneShape.height / 2), width: Math.floor(backboneShape.width / 2), channels: shape.backboneChannels };
  await runtime.runStage('load-image-fpn-neck-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage });
    const convWeightShape = spec => [spec.outChannels, spec.kernelSize, spec.kernelSize, spec.inChannels];
    const convBiasShape = spec => [spec.outChannels];
    tensors = {
      backbone: tensor('sam3.image-fpn-neck.vit-backbone-hidden-states', [shape.batch, shape.backboneHeight, shape.backboneWidth, shape.backboneChannels]),
      level0Scale0: tensor('sam3.image-fpn-neck.level0.scale0', [shape.batch, level0Scale0Shape.height, level0Scale0Shape.width, level0Scale0Shape.channels]),
      level0Gelu: tensor('sam3.image-fpn-neck.level0.gelu', [shape.batch, level0Scale0Shape.height, level0Scale0Shape.width, level0Scale0Shape.channels]),
      level0Scale2: tensor('sam3.image-fpn-neck.level0.scale2', [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize]),
      level0Proj1: tensor('sam3.image-fpn-neck.level0.proj1', [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize]),
      level0Feature: tensor('sam3.image-fpn-neck.level0.feature', [shape.batch, shape.levels[0].height, shape.levels[0].width, shape.fpnHiddenSize]),
      level1Scale0: tensor('sam3.image-fpn-neck.level1.scale0', [shape.batch, level1Scale0Shape.height, level1Scale0Shape.width, level1Scale0Shape.channels]),
      level1Proj1: tensor('sam3.image-fpn-neck.level1.proj1', [shape.batch, shape.levels[1].height, shape.levels[1].width, shape.fpnHiddenSize]),
      level1Feature: tensor('sam3.image-fpn-neck.level1.feature', [shape.batch, shape.levels[1].height, shape.levels[1].width, shape.fpnHiddenSize]),
      level2Proj1: tensor('sam3.image-fpn-neck.level2.proj1', [shape.batch, shape.levels[2].height, shape.levels[2].width, shape.fpnHiddenSize]),
      level2Feature: tensor('sam3.image-fpn-neck.level2.feature', [shape.batch, shape.levels[2].height, shape.levels[2].width, shape.fpnHiddenSize]),
      level3Pool: tensor('sam3.image-fpn-neck.level3.maxpool', [shape.batch, shape.levels[3].height, shape.levels[3].width, shape.backboneChannels]),
      level3Proj1: tensor('sam3.image-fpn-neck.level3.proj1', [shape.batch, shape.levels[3].height, shape.levels[3].width, shape.fpnHiddenSize]),
      level3Feature: tensor('sam3.image-fpn-neck.level3.feature', [shape.batch, shape.levels[3].height, shape.levels[3].width, shape.fpnHiddenSize]),
      convDims: stage.createUniformBuffer({
        label: 'sam3.image-fpn-neck.conv-dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'input_height', type: 'u32' },
          { name: 'input_width', type: 'u32' },
          { name: 'input_channels', type: 'u32' },
          { name: 'output_height', type: 'u32' },
          { name: 'output_width', type: 'u32' },
          { name: 'output_channels', type: 'u32' },
          { name: 'kernel_h', type: 'u32' },
          { name: 'kernel_w', type: 'u32' },
          { name: 'stride', type: 'u32' },
          { name: 'padding', type: 'u32' },
          { name: 'total_output', type: 'u32' },
        ],
        values: convDimsValues(shape, backboneShape, weights.levels[0].scaleLayers[0], level0Scale0Shape),
      }),
      poolDims: stage.createUniformBuffer({
        label: 'sam3.image-fpn-neck.pool-dims',
        schema: [
          { name: 'batch', type: 'u32' },
          { name: 'input_height', type: 'u32' },
          { name: 'input_width', type: 'u32' },
          { name: 'channels', type: 'u32' },
          { name: 'output_height', type: 'u32' },
          { name: 'output_width', type: 'u32' },
          { name: 'total_output', type: 'u32' },
        ],
        values: poolDimsValues(shape, backboneShape, level3PoolShape),
      }),
    };
    for (const level of weights.levels) {
      for (const [index, scaleLayer] of level.scaleLayers.entries()) {
        tensors[`level${level.level}Scale${index}Weight`] = tensor(`sam3.image-fpn-neck.level${level.level}.scale${index}.weight`, convWeightShape(scaleLayer), readonlyUsage);
        tensors[`level${level.level}Scale${index}Bias`] = tensor(`sam3.image-fpn-neck.level${level.level}.scale${index}.bias`, convBiasShape(scaleLayer), readonlyUsage);
        stage.uploadTensor(tensors[`level${level.level}Scale${index}Weight`], scaleLayer.weight);
        stage.uploadTensor(tensors[`level${level.level}Scale${index}Bias`], scaleLayer.bias);
      }
      for (const [name, spec] of [['Proj1', level.proj1], ['Proj2', level.proj2]]) {
        tensors[`level${level.level}${name}Weight`] = tensor(`sam3.image-fpn-neck.level${level.level}.${name.toLowerCase()}.weight`, convWeightShape(spec), readonlyUsage);
        tensors[`level${level.level}${name}Bias`] = tensor(`sam3.image-fpn-neck.level${level.level}.${name.toLowerCase()}.bias`, convBiasShape(spec), readonlyUsage);
        stage.uploadTensor(tensors[`level${level.level}${name}Weight`], spec.weight);
        stage.uploadTensor(tensors[`level${level.level}${name}Bias`], spec.bias);
      }
    }
    stage.uploadTensor(tensors.backbone, backboneHiddenStates);
    await stage.yieldToBrowser({ reason: 'after-sam3-image-fpn-neck-upload' });
  }, { shape, fpnLevels: [0, 1, 2, 3], detectorConsumedLevels: [0, 1, 2], referenceBoundary: 'MLX FPNLayer scale_layers/max-pool -> proj1 -> proj2 for levels 0..3' });

  const bindTensor = (resource, access = 'read-only-storage') => ({ name: resource.replace(/^tensor:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = resource => ({ name: resource.replace(/^uniform:/, ''), resource, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const kernels = {
    transposeConv2d: { code: TRANSPOSE_CONV2D_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:weight'), bindTensor('tensor:bias'), bindTensor('tensor:output', 'storage'), bindUniform('uniform:convDims')] },
    conv2d: { code: CONV2D_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:weight'), bindTensor('tensor:bias'), bindTensor('tensor:output', 'storage'), bindUniform('uniform:convDims')] },
    gelu: { code: GELU_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:output', 'storage')] },
    maxpool2d: { code: MAXPOOL2D_WGSL, bindings: [bindTensor('tensor:input'), bindTensor('tensor:output', 'storage'), bindUniform('uniform:poolDims')] },
  };
  const metadata = { routeId: SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID, layout: 'B,H,W,C', fpnLevels: [0, 1, 2, 3], detectorConsumedLevels: [0, 1, 2] };
  const runKernel = async ({ name, kernel, inputTensor, outputTensor, weightTensor, biasTensor, inShape, outShape, spec }) => {
    tensors.convDims.update(convDimsValues(shape, inShape, spec, outShape));
    const single = runtime.defineProgram({
      name: `sam3.image-fpn-neck.${name}`,
      tensors: { ...tensors, input: tensors[inputTensor], output: tensors[outputTensor], weight: tensors[weightTensor], bias: tensors[biasTensor] },
      uniforms: { convDims: tensors.convDims },
      kernels,
      phases: [{ name, kernel, dispatch: linearDispatch(shape.batch * outShape.height * outShape.width * outShape.channels), yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(single);
  };
  const runGelu = async ({ name, inputTensor, outputTensor, total }) => {
    const single = runtime.defineProgram({
      name: `sam3.image-fpn-neck.${name}`,
      tensors: { ...tensors, input: tensors[inputTensor], output: tensors[outputTensor] },
      uniforms: { convDims: tensors.convDims },
      kernels,
      phases: [{ name, kernel: 'gelu', dispatch: linearDispatch(total), yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(single);
  };
  const runPool = async ({ name, inputTensor, outputTensor, inShape, outShape }) => {
    tensors.poolDims.update(poolDimsValues(shape, inShape, outShape));
    const single = runtime.defineProgram({
      name: `sam3.image-fpn-neck.${name}`,
      tensors: { ...tensors, input: tensors[inputTensor], output: tensors[outputTensor] },
      uniforms: { convDims: tensors.convDims, poolDims: tensors.poolDims },
      kernels,
      phases: [{ name, kernel: 'maxpool2d', dispatch: linearDispatch(shape.batch * outShape.height * outShape.width * outShape.channels), yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(single);
  };

  await runKernel({ name: 'fpn-neck-transpose-conv-0-scale0', kernel: 'transposeConv2d', inputTensor: 'backbone', outputTensor: 'level0Scale0', weightTensor: 'level0Scale0Weight', biasTensor: 'level0Scale0Bias', inShape: backboneShape, outShape: level0Scale0Shape, spec: weights.levels[0].scaleLayers[0] });
  await runGelu({ name: 'fpn-neck-gelu-0', inputTensor: 'level0Scale0', outputTensor: 'level0Gelu', total: shape.batch * level0Scale0Shape.height * level0Scale0Shape.width * level0Scale0Shape.channels });
  await runKernel({ name: 'fpn-neck-transpose-conv-0-scale1', kernel: 'transposeConv2d', inputTensor: 'level0Gelu', outputTensor: 'level0Scale2', weightTensor: 'level0Scale1Weight', biasTensor: 'level0Scale1Bias', inShape: level0Scale0Shape, outShape: level0Scale1Shape, spec: weights.levels[0].scaleLayers[1] });
  await runKernel({ name: 'fpn-neck-proj1-0', kernel: 'conv2d', inputTensor: 'level0Scale2', outputTensor: 'level0Proj1', weightTensor: 'level0Proj1Weight', biasTensor: 'level0Proj1Bias', inShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, spec: weights.levels[0].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-0', kernel: 'conv2d', inputTensor: 'level0Proj1', outputTensor: 'level0Feature', weightTensor: 'level0Proj2Weight', biasTensor: 'level0Proj2Bias', inShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[0].height, width: shape.levels[0].width, channels: shape.fpnHiddenSize }, spec: weights.levels[0].proj2 });
  await runKernel({ name: 'fpn-neck-transpose-conv-1', kernel: 'transposeConv2d', inputTensor: 'backbone', outputTensor: 'level1Scale0', weightTensor: 'level1Scale0Weight', biasTensor: 'level1Scale0Bias', inShape: backboneShape, outShape: level1Scale0Shape, spec: weights.levels[1].scaleLayers[0] });
  await runKernel({ name: 'fpn-neck-proj1-1', kernel: 'conv2d', inputTensor: 'level1Scale0', outputTensor: 'level1Proj1', weightTensor: 'level1Proj1Weight', biasTensor: 'level1Proj1Bias', inShape: level1Scale0Shape, outShape: { height: shape.levels[1].height, width: shape.levels[1].width, channels: shape.fpnHiddenSize }, spec: weights.levels[1].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-1', kernel: 'conv2d', inputTensor: 'level1Proj1', outputTensor: 'level1Feature', weightTensor: 'level1Proj2Weight', biasTensor: 'level1Proj2Bias', inShape: { height: shape.levels[1].height, width: shape.levels[1].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[1].height, width: shape.levels[1].width, channels: shape.fpnHiddenSize }, spec: weights.levels[1].proj2 });
  await runKernel({ name: 'fpn-neck-proj1-2', kernel: 'conv2d', inputTensor: 'backbone', outputTensor: 'level2Proj1', weightTensor: 'level2Proj1Weight', biasTensor: 'level2Proj1Bias', inShape: backboneShape, outShape: { height: shape.levels[2].height, width: shape.levels[2].width, channels: shape.fpnHiddenSize }, spec: weights.levels[2].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-2', kernel: 'conv2d', inputTensor: 'level2Proj1', outputTensor: 'level2Feature', weightTensor: 'level2Proj2Weight', biasTensor: 'level2Proj2Bias', inShape: { height: shape.levels[2].height, width: shape.levels[2].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[2].height, width: shape.levels[2].width, channels: shape.fpnHiddenSize }, spec: weights.levels[2].proj2 });
  await runPool({ name: 'fpn-neck-maxpool-3', inputTensor: 'backbone', outputTensor: 'level3Pool', inShape: backboneShape, outShape: level3PoolShape });
  await runKernel({ name: 'fpn-neck-proj1-3', kernel: 'conv2d', inputTensor: 'level3Pool', outputTensor: 'level3Proj1', weightTensor: 'level3Proj1Weight', biasTensor: 'level3Proj1Bias', inShape: level3PoolShape, outShape: { height: shape.levels[3].height, width: shape.levels[3].width, channels: shape.fpnHiddenSize }, spec: weights.levels[3].proj1 });
  await runKernel({ name: 'fpn-neck-proj2-3', kernel: 'conv2d', inputTensor: 'level3Proj1', outputTensor: 'level3Feature', weightTensor: 'level3Proj2Weight', biasTensor: 'level3Proj2Bias', inShape: { height: shape.levels[3].height, width: shape.levels[3].width, channels: shape.fpnHiddenSize }, outShape: { height: shape.levels[3].height, width: shape.levels[3].width, channels: shape.fpnHiddenSize }, spec: weights.levels[3].proj2 });

  const readback = await runtime.runStage('readback-fpn-neck-features', async stage => ({
    fpnNeckFeature0: await stage.readTensor(tensors.level0Feature),
    fpnNeckFeature1: await stage.readTensor(tensors.level1Feature),
    fpnNeckFeature2: await stage.readTensor(tensors.level2Feature),
    fpnNeckFeature3: await stage.readTensor(tensors.level3Feature),
  }), { outputs: oracleShapes, outputRoles: ['fpn-neck-feature-0', 'fpn-neck-feature-1', 'fpn-neck-feature-2', 'fpn-neck-feature-3'] });
  const outputs = outputArtifacts(input.request, {
    fpnNeckFeature0: await sha256Hex(readback.fpnNeckFeature0),
    fpnNeckFeature1: await sha256Hex(readback.fpnNeckFeature1),
    fpnNeckFeature2: await sha256Hex(readback.fpnNeckFeature2),
    fpnNeckFeature3: await sha256Hex(readback.fpnNeckFeature3),
  }, shape);
  const receipt = createSam3ImageFpnNeckPhaseProgramRouteReceipt({
    sourceImage,
    backboneHiddenStates: backboneHiddenStatesArtifact,
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
      fpnNeckFeature0: Array.from(new Float32Array(readback.fpnNeckFeature0)),
      fpnNeckFeature1: Array.from(new Float32Array(readback.fpnNeckFeature1)),
      fpnNeckFeature2: Array.from(new Float32Array(readback.fpnNeckFeature2)),
      fpnNeckFeature3: Array.from(new Float32Array(readback.fpnNeckFeature3)),
    };
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}

function assertSam31PropagationArchitecture(weights) {
  const scaleCounts = weights.levels.map(level => level.scaleLayers.length);
  if (scaleCounts[0] !== 2 || scaleCounts[1] !== 1 || scaleCounts[2] !== 0) {
    throw new Error('authoritative SAM3.1 propagation neck requires scale-layer counts [2, 1, 0]');
  }
  if (weights.levels[0].scaleLayers[0].activation !== 'gelu') {
    throw new Error('authoritative SAM3.1 propagation neck requires GELU after level-0 scale layer 0');
  }
}

function sam31ScaleStageName(level, scaleIndex) {
  if (level === 0) return `fpn-neck-transpose-conv-0-scale${scaleIndex}`;
  if (level === 1 && scaleIndex === 0) return 'fpn-neck-transpose-conv-1';
  throw new Error(`unsupported SAM3.1 propagation scale stage level=${level} index=${scaleIndex}`);
}

async function runSam31TrackingNeckPhaseProgramRoute(input, defaultRoute) {
  if (!input.request || typeof input.request !== 'object') throw new Error('request is required');
  const route = input.route || defaultRoute;
  const descriptor = sam31TrackingNeckDescriptorForRoute(route);
  const sourceImage = roleArtifact(input.request.inputs, 'source-image');
  const backboneHiddenStatesArtifact = roleArtifact(input.request.inputs, 'sam31-vit-backbone-hidden-states');
  const weightsArtifact = roleArtifact(input.request.inputs, `sam31-${descriptor.branch}-neck-weights`);
  const { shape, backboneHiddenStates, weights } = validateImageFpnNeckInputs(input.tensors || {}, 3);
  assertSam31PropagationArchitecture(weights);
  const oracle = descriptor.includePosition
    ? createSam31TrackingNeckPhaseProgramCpuOracle({ branch: descriptor.branch, backboneHiddenStates, weights, shape })
    : createSam31PropagationNeckPhaseProgramCpuOracle({ backboneHiddenStates, weights, shape });
  const runtime = await createWebGpuInferenceRuntime({
    routeId: descriptor.routeId,
    runtimeLabel: input.runtimeLabel || `sam31-${descriptor.branch}-neck-phase-program`,
    device: input.device,
    queue: input.queue,
    adapter: input.adapter,
    adapterName: input.adapterName,
    browser: input.browser,
    backendIdentity: input.backendIdentity,
    kernel: input.kernel || route.kernel,
    requiredStages: descriptor.requiredStages,
    timingSource: 'queue-submit-wait',
    waitForSubmittedWorkDone: true,
    yieldMs: 0,
    now: input.now,
  });
  const maxComputeWorkgroupsPerDimension = input.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535;
  const linearDispatch = totalInvocations => createLinearDispatch(totalInvocations, {
    workgroupSize: 64,
    maxWorkgroupsPerDimension: maxComputeWorkgroupsPerDimension,
  });

  const backboneShape = { height: shape.backboneHeight, width: shape.backboneWidth, channels: shape.backboneChannels };
  const scaleShapes = weights.levels.map(level => {
    const levelShapes = [];
    let current = backboneShape;
    for (const scaleLayer of level.scaleLayers) {
      current = transposeConv2dOutShape(current, scaleLayer);
      levelShapes.push(current);
    }
    return levelShapes;
  });
  let tensors = null;
  await runtime.runStage('load-image-fpn-neck-tensors', async stage => {
    const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.copySrc;
    const readonlyUsage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
    const tensor = (name, tensorShape, tensorUsage = usage) => stage.createTensor({ name, shape: tensorShape, dtype: 'f32', usage: tensorUsage });
    const convWeightShape = spec => [spec.outChannels, spec.kernelSize, spec.kernelSize, spec.inChannels];
    tensors = {
      backbone: tensor(`sam31.${descriptor.branch}-neck.vit-backbone-hidden-states`, [shape.batch, shape.backboneHeight, shape.backboneWidth, shape.backboneChannels]),
      convDims: stage.createUniformBuffer({
        label: `sam31.${descriptor.branch}-neck.conv-dims`,
        schema: [
          { name: 'batch', type: 'u32' }, { name: 'input_height', type: 'u32' }, { name: 'input_width', type: 'u32' },
          { name: 'input_channels', type: 'u32' }, { name: 'output_height', type: 'u32' }, { name: 'output_width', type: 'u32' },
          { name: 'output_channels', type: 'u32' }, { name: 'kernel_h', type: 'u32' }, { name: 'kernel_w', type: 'u32' },
          { name: 'stride', type: 'u32' }, { name: 'padding', type: 'u32' }, { name: 'total_output', type: 'u32' },
        ],
        values: convDimsValues(shape, backboneShape, weights.levels[0].scaleLayers[0], scaleShapes[0][0]),
      }),
    };
    if (descriptor.includePosition) {
      const level2 = shape.levels[2];
      const total = shape.batch * level2.height * level2.width * shape.fpnHiddenSize;
      tensors.position2 = tensor(`sam31.${descriptor.branch}-neck.position-2`, [shape.batch, level2.height, level2.width, shape.fpnHiddenSize]);
      tensors.positionDims = stage.createUniformBuffer({
        label: `sam31.${descriptor.branch}-neck.position-dims`,
        schema: [
          { name: 'batch', type: 'u32' }, { name: 'height', type: 'u32' }, { name: 'width', type: 'u32' },
          { name: 'channels', type: 'u32' }, { name: 'total_output', type: 'u32' }, { name: 'temperature', type: 'f32' }, { name: 'scale', type: 'f32' },
        ],
        values: { batch: shape.batch, height: level2.height, width: level2.width, channels: shape.fpnHiddenSize, total_output: total, temperature: 10000, scale: Math.PI * 2 },
      });
    }
    for (const level of weights.levels) {
      for (const [scaleIndex, scaleLayer] of level.scaleLayers.entries()) {
        const outShape = scaleShapes[level.level][scaleIndex];
        tensors[`level${level.level}Scale${scaleIndex}`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.scale${scaleIndex}`, [shape.batch, outShape.height, outShape.width, outShape.channels]);
        if (scaleLayer.activation === 'gelu') tensors[`level${level.level}Scale${scaleIndex}Gelu`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.scale${scaleIndex}.gelu`, [shape.batch, outShape.height, outShape.width, outShape.channels]);
        tensors[`level${level.level}Scale${scaleIndex}Weight`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.scale${scaleIndex}.weight`, convWeightShape(scaleLayer), readonlyUsage);
        tensors[`level${level.level}Scale${scaleIndex}Bias`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.scale${scaleIndex}.bias`, [scaleLayer.outChannels], readonlyUsage);
        stage.uploadTensor(tensors[`level${level.level}Scale${scaleIndex}Weight`], scaleLayer.weight);
        stage.uploadTensor(tensors[`level${level.level}Scale${scaleIndex}Bias`], scaleLayer.bias);
      }
      const levelShape = shape.levels[level.level];
      tensors[`level${level.level}Proj1`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.proj1`, [shape.batch, levelShape.height, levelShape.width, shape.fpnHiddenSize]);
      tensors[`level${level.level}Feature`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.feature`, [shape.batch, levelShape.height, levelShape.width, shape.fpnHiddenSize]);
      for (const [name, spec] of [['Proj1', level.proj1], ['Proj2', level.proj2]]) {
        tensors[`level${level.level}${name}Weight`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.${name.toLowerCase()}.weight`, convWeightShape(spec), readonlyUsage);
        tensors[`level${level.level}${name}Bias`] = tensor(`sam31.${descriptor.branch}-neck.level${level.level}.${name.toLowerCase()}.bias`, [spec.outChannels], readonlyUsage);
        stage.uploadTensor(tensors[`level${level.level}${name}Weight`], spec.weight);
        stage.uploadTensor(tensors[`level${level.level}${name}Bias`], spec.bias);
      }
    }
    stage.uploadTensor(tensors.backbone, backboneHiddenStates);
    await stage.yieldToBrowser({ reason: `after-sam31-${descriptor.branch}-neck-upload` });
  }, {
    shape,
    branch: descriptor.branch,
    levels: [0, 1, 2],
    positionLevel: descriptor.includePosition ? 2 : null,
    referenceBoundary: `Meta Sam3TriViTDetNeck ${descriptor.branch}_convs scale_layers -> proj1 -> proj2 -> PositionEmbeddingSine`,
  });

  const bindTensor = (name, access = 'read-only-storage') => ({ name, resource: `tensor:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, access });
  const bindUniform = name => ({ name, resource: `uniform:${name}`, visibility: WEBGPU_SHADER_STAGE.compute, type: 'uniform' });
  const kernels = {
    transposeConv2d: { code: TRANSPOSE_CONV2D_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('convDims')] },
    conv2d: { code: CONV2D_WGSL, bindings: [bindTensor('input'), bindTensor('weight'), bindTensor('bias'), bindTensor('output', 'storage'), bindUniform('convDims')] },
    gelu: { code: GELU_WGSL, bindings: [bindTensor('input'), bindTensor('output', 'storage')] },
    positionEncoding: { code: SAM31_NECK_POSITION_ENCODING_WGSL, bindings: [bindTensor('output', 'storage'), bindUniform('positionDims')] },
  };
  const metadata = { routeId: descriptor.routeId, layout: 'B,H,W,C', branch: descriptor.branch, levels: [0, 1, 2], referenceModel: 'facebook/sam3.1' };
  const runConv = async ({ name, kernel, inputTensor, outputTensor, weightTensor, biasTensor, inShape, outShape, spec }) => {
    tensors.convDims.update(convDimsValues(shape, inShape, spec, outShape));
    const program = runtime.defineProgram({
      name: `sam31.${descriptor.branch}-neck.${name}`,
      tensors: { input: tensors[inputTensor], output: tensors[outputTensor], weight: tensors[weightTensor], bias: tensors[biasTensor] },
      uniforms: { convDims: tensors.convDims },
      kernels,
      phases: [{ name, kernel, dispatch: linearDispatch(shape.batch * outShape.height * outShape.width * outShape.channels), yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(program);
  };
  const runGelu = async ({ name, inputTensor, outputTensor, total }) => {
    const program = runtime.defineProgram({
      name: `sam31.${descriptor.branch}-neck.${name}`,
      tensors: { input: tensors[inputTensor], output: tensors[outputTensor] },
      uniforms: {},
      kernels,
      phases: [{ name, kernel: 'gelu', dispatch: linearDispatch(total), yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(program);
  };

  for (const level of weights.levels) {
    let currentTensor = 'backbone';
    let currentShape = backboneShape;
    for (const [scaleIndex, scaleLayer] of level.scaleLayers.entries()) {
      const outputTensor = `level${level.level}Scale${scaleIndex}`;
      const outShape = scaleShapes[level.level][scaleIndex];
      await runConv({ name: sam31ScaleStageName(level.level, scaleIndex), kernel: 'transposeConv2d', inputTensor: currentTensor, outputTensor, weightTensor: `level${level.level}Scale${scaleIndex}Weight`, biasTensor: `level${level.level}Scale${scaleIndex}Bias`, inShape: currentShape, outShape, spec: scaleLayer });
      currentTensor = outputTensor;
      currentShape = outShape;
      if (scaleLayer.activation === 'gelu') {
        const geluTensor = `${outputTensor}Gelu`;
        await runGelu({ name: 'fpn-neck-gelu-0', inputTensor: outputTensor, outputTensor: geluTensor, total: shape.batch * outShape.height * outShape.width * outShape.channels });
        currentTensor = geluTensor;
      }
    }
    const levelShape = { height: shape.levels[level.level].height, width: shape.levels[level.level].width, channels: shape.fpnHiddenSize };
    await runConv({ name: `fpn-neck-proj1-${level.level}`, kernel: 'conv2d', inputTensor: currentTensor, outputTensor: `level${level.level}Proj1`, weightTensor: `level${level.level}Proj1Weight`, biasTensor: `level${level.level}Proj1Bias`, inShape: currentShape, outShape: levelShape, spec: level.proj1 });
    await runConv({ name: `fpn-neck-proj2-${level.level}`, kernel: 'conv2d', inputTensor: `level${level.level}Proj1`, outputTensor: `level${level.level}Feature`, weightTensor: `level${level.level}Proj2Weight`, biasTensor: `level${level.level}Proj2Bias`, inShape: levelShape, outShape: levelShape, spec: level.proj2 });
  }
  if (descriptor.includePosition) {
    const level2 = shape.levels[2];
    const total = shape.batch * level2.height * level2.width * shape.fpnHiddenSize;
    const program = runtime.defineProgram({
      name: `sam31.${descriptor.branch}-neck.position-2`,
      tensors: { output: tensors.position2 },
      uniforms: { positionDims: tensors.positionDims },
      kernels,
      phases: [{ name: 'fpn-neck-position-2', kernel: 'positionEncoding', dispatch: linearDispatch(total), yieldAfter: true }],
      metadata,
    });
    await runtime.runProgram(program);
  }

  const readback = await runtime.runStage('readback-fpn-neck-features', async stage => {
    const values = {};
    for (let level = 0; level < 3; level += 1) values[`${descriptor.branch}Feature${level}`] = await stage.readTensor(tensors[`level${level}Feature`]);
    if (descriptor.includePosition) values[`${descriptor.branch}Position2`] = await stage.readTensor(tensors.position2);
    return values;
  }, { outputs: oracle.levels, outputRoles: descriptor.outputRoles.map(output => output.role) });
  const outputShape = level => [shape.batch, shape.levels[level].height, shape.levels[level].width, shape.fpnHiddenSize];
  const outputs = {};
  for (let level = 0; level < 3; level += 1) {
    const key = `${descriptor.branch}Feature${level}`;
    const role = `sam31-${descriptor.branch}-feature-${level}`;
    outputs[key] = { artifactId: roleArtifact(input.request.outputs, role).artifactId, sha256: await sha256Hex(readback[key]), shape: outputShape(level) };
  }
  if (descriptor.includePosition) {
    const key = `${descriptor.branch}Position2`;
    const role = `sam31-${descriptor.branch}-position-2`;
    outputs[key] = { artifactId: roleArtifact(input.request.outputs, role).artifactId, sha256: await sha256Hex(readback[key]), shape: outputShape(2) };
  }
  const receiptInput = {
    sourceImage,
    backboneHiddenStates: backboneHiddenStatesArtifact,
    weights: weightsArtifact,
    outputs,
    backend: runtime.backendIdentity,
    model: { revision: input.model?.revision || route.model?.revision, weightsHash: input.model?.weightsHash, dtype: input.model?.dtype || 'fp32' },
    kernel: input.kernel || runtime.kernel,
    profile: runtime.profile,
  };
  const receipt = descriptor.includePosition
    ? createSam31ImageTrackingNeckPhaseProgramRouteReceipt(receiptInput, descriptor)
    : createSam31PropagationNeckPhaseProgramRouteReceipt(receiptInput);
  const result = createRouteWorkerResult(route, { request: input.request, receipt });
  const authoritative = assertAuthoritativeRouteWorkerResult(result, route);
  if (input.includeReadback === true) {
    authoritative.debugReadback = { mode: 'explicit-debug-evidence' };
    for (const [key, value] of Object.entries(readback)) authoritative.debugReadback[key] = Array.from(new Float32Array(value));
  }
  authoritative.resourceDisposal = runtime.dispose();
  return authoritative;
}

export async function runSam31PropagationNeckPhaseProgramRoute(input = {}) {
  return runSam31TrackingNeckPhaseProgramRoute(input, createSam31PropagationNeckPhaseProgramRouteDefinition({ kernel: input.kernel }));
}

export async function runSam31InteractiveNeckPhaseProgramRoute(input = {}) {
  return runSam31TrackingNeckPhaseProgramRoute(input, createSam31InteractiveNeckPhaseProgramRouteDefinition({ kernel: input.kernel }));
}

export async function runSam31ImagePropagationNeckPhaseProgramRoute(input = {}) {
  return runSam31TrackingNeckPhaseProgramRoute(input, createSam31ImagePropagationNeckPhaseProgramRouteDefinition({ kernel: input.kernel }));
}
