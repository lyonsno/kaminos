const OUTPUT_TILE = 16;
const REDUCTION_TILE = 16;

const TILED_LINEAR_WGSL = `
struct LinearDims {
  _unused0: u32,
  _unused1: u32,
  _unused2: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;

var<workgroup> input_tile: array<f32, 256>;
var<workgroup> weight_tile: array<f32, 256>;

__ACTIVATION_HELPERS__

fn activate(value: f32) -> f32 {
  return __ACTIVATION__;
}

@compute @workgroup_size(8, 8, 1)
fn main(
  @builtin(local_invocation_id) local_id: vec3<u32>,
  @builtin(workgroup_id) workgroup_id: vec3<u32>,
  @builtin(num_workgroups) dispatch_grid: vec3<u32>,
) {
  let output_channels = arrayLength(&bias);
  let input_channels = arrayLength(&weight) / output_channels;
  let token_count = arrayLength(&output_values) / output_channels;
  let output_base = workgroup_id.x * 16u;
  let token_tile = workgroup_id.y + workgroup_id.z * dispatch_grid.y;
  let token_base = token_tile * 16u;
  let lane = local_id.y * 8u + local_id.x;

  var sums: array<f32, 4>;
  for (var token_half = 0u; token_half < 2u; token_half = token_half + 1u) {
    for (var output_half = 0u; output_half < 2u; output_half = output_half + 1u) {
      let output_channel = output_base + local_id.x + output_half * 8u;
      let accumulator_index = token_half * 2u + output_half;
      sums[accumulator_index] = 0.0;
      if (output_channel < output_channels) {
        sums[accumulator_index] = bias[output_channel];
      }
    }
  }

  for (var k_base = 0u; k_base < input_channels; k_base = k_base + 16u) {
    for (var tile_index = lane; tile_index < 256u; tile_index = tile_index + 64u) {
      let tile_row = tile_index / 16u;
      let tile_column = tile_index % 16u;
      let token = token_base + tile_row;
      let output_channel = output_base + tile_row;
      let input_channel = k_base + tile_column;
      input_tile[tile_index] = 0.0;
      if (token < token_count && input_channel < input_channels) {
        input_tile[tile_index] = input_values[token * input_channels + input_channel];
      }
      weight_tile[tile_index] = 0.0;
      if (output_channel < output_channels && input_channel < input_channels) {
        weight_tile[tile_index] = weight[output_channel * input_channels + input_channel];
      }
    }
    workgroupBarrier();

    for (var token_half = 0u; token_half < 2u; token_half = token_half + 1u) {
      let token_local = local_id.y + token_half * 8u;
      for (var output_half = 0u; output_half < 2u; output_half = output_half + 1u) {
        let output_local = local_id.x + output_half * 8u;
        let accumulator_index = token_half * 2u + output_half;
        for (var k_local = 0u; k_local < 16u; k_local = k_local + 1u) {
          sums[accumulator_index] = sums[accumulator_index]
            + input_tile[token_local * 16u + k_local]
            * weight_tile[output_local * 16u + k_local];
        }
      }
    }
    workgroupBarrier();
  }

  for (var token_half = 0u; token_half < 2u; token_half = token_half + 1u) {
    let token = token_base + local_id.y + token_half * 8u;
    for (var output_half = 0u; output_half < 2u; output_half = output_half + 1u) {
      let output_channel = output_base + local_id.x + output_half * 8u;
      if (token < token_count && output_channel < output_channels) {
        let accumulator_index = token_half * 2u + output_half;
        output_values[token * output_channels + output_channel] = activate(sums[accumulator_index]);
      }
    }
  }
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
  return TILED_LINEAR_WGSL
    .replace('__ACTIVATION_HELPERS__', helpers)
    .replace('__ACTIVATION__', activation);
}

export const SAM_TILED_LINEAR_WGSL = shader({ activation: 'value' });
export const SAM_TILED_LINEAR_RELU_WGSL = shader({ activation: 'max(value, 0.0)' });
export const SAM_TILED_LINEAR_GELU_WGSL = shader({ activation: 'gelu_exact_approx(value)', helpers: GELU_HELPERS });

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function tiledLinearDispatch(tokenCount, outputChannels, options = {}) {
  const tokens = positiveInteger(tokenCount, 'tokenCount');
  const outputs = positiveInteger(outputChannels, 'outputChannels');
  const maxWorkgroupsPerDimension = positiveInteger(
    options.maxWorkgroupsPerDimension ?? 65_535,
    'maxWorkgroupsPerDimension',
  );
  const outputTiles = Math.ceil(outputs / OUTPUT_TILE);
  if (outputTiles > maxWorkgroupsPerDimension) {
    throw new Error(`output tile count ${outputTiles} exceeds maxComputeWorkgroupsPerDimension ${maxWorkgroupsPerDimension}`);
  }
  const tokenTiles = Math.ceil(tokens / OUTPUT_TILE);
  const dispatchY = Math.min(tokenTiles, maxWorkgroupsPerDimension);
  const dispatchZ = Math.ceil(tokenTiles / dispatchY);
  if (dispatchZ > maxWorkgroupsPerDimension) {
    throw new Error(`token tile volume ${tokenTiles} exceeds two-dimensional dispatch capacity`);
  }
  return [outputTiles, dispatchY, dispatchZ];
}

export function tiledLinearDispatchForDevice(tokenCount, outputChannels, device) {
  return tiledLinearDispatch(tokenCount, outputChannels, {
    maxWorkgroupsPerDimension: device?.limits?.maxComputeWorkgroupsPerDimension ?? 65_535,
  });
}

export const SAM_TILED_LINEAR_TILE = Object.freeze({
  outputRows: OUTPUT_TILE,
  outputColumns: OUTPUT_TILE,
  reduction: REDUCTION_TILE,
});
