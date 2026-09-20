import { createLinearDispatch } from './runtime-primitives.js';

const VECTOR_LINEAR_WGSL = `
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

__ACTIVATION_HELPERS__

fn activate(value: f32) -> f32 {
  return __ACTIVATION__;
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
  for (var channel = 0u; channel < dims.input_channels; channel = channel + 4u) {
    sum = sum + input_values[input_base + channel] * weight[weight_base + channel];
    sum = sum + input_values[input_base + channel + 1u] * weight[weight_base + channel + 1u];
    sum = sum + input_values[input_base + channel + 2u] * weight[weight_base + channel + 2u];
    sum = sum + input_values[input_base + channel + 3u] * weight[weight_base + channel + 3u];
  }
  output_values[index] = activate(sum);
}
`;

const GELU_HELPERS = `
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

function shader({ activation, helpers = '' }) {
  return VECTOR_LINEAR_WGSL
    .replace('__ACTIVATION_HELPERS__', helpers)
    .replace('__ACTIVATION__', activation);
}

export const SAM_VECTOR_LINEAR_WGSL = shader({ activation: 'value' });
export const SAM_VECTOR_LINEAR_RELU_WGSL = shader({ activation: 'max(value, 0.0)' });
export const SAM_VECTOR_LINEAR_GELU_WGSL = shader({ activation: 'gelu_exact_approx(value)', helpers: GELU_HELPERS });

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function vectorLinearDispatch(tokenCount, inputChannels, outputChannels, options = {}) {
  const tokens = positiveInteger(tokenCount, 'tokenCount');
  const inputs = positiveInteger(inputChannels, 'inputChannels');
  if (inputs % 4 !== 0) throw new Error('inputChannels must be divisible by 4');
  const outputs = positiveInteger(outputChannels, 'outputChannels');
  const maxWorkgroupsPerDimension = positiveInteger(
    options.maxWorkgroupsPerDimension ?? 65_535,
    'maxWorkgroupsPerDimension',
  );
  return createLinearDispatch(tokens * outputs, {
    workgroupSize: 64,
    maxWorkgroupsPerDimension,
  });
}

export function vectorLinearDispatchForDevice(tokenCount, inputChannels, outputChannels, device) {
  return vectorLinearDispatch(tokenCount, inputChannels, outputChannels, {
    maxWorkgroupsPerDimension: device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535,
  });
}

export const SAM_VECTOR_LINEAR_WIDTH = 4;
