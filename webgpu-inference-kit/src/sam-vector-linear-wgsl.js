import { createWebGpuLinearShader } from './linear-kernel.js';
import { createLinearDispatch } from './runtime-primitives.js';

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
  return createWebGpuLinearShader({
    variant: 'sequential4', activationExpression: activation, activationHelpers: helpers,
  });
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
