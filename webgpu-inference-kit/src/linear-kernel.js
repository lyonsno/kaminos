function sequential4({ weightType, loadWeight, weightHelper, activationExpression, activationHelpers }) {
  return `
struct LinearDims {
  input_channels: u32,
  output_channels: u32,
  total_output: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<storage, read> input_values: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<${weightType}>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> output_values: array<f32>;
@group(0) @binding(4) var<uniform> dims: LinearDims;

${weightHelper}${activationHelpers}

fn activate(value: f32) -> f32 {
  return ${activationExpression};
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
    sum = sum + input_values[input_base + channel] * ${loadWeight("weight_base + channel")};
    sum = sum + input_values[input_base + channel + 1u] * ${loadWeight("weight_base + channel + 1u")};
    sum = sum + input_values[input_base + channel + 2u] * ${loadWeight("weight_base + channel + 2u")};
    sum = sum + input_values[input_base + channel + 3u] * ${loadWeight("weight_base + channel + 3u")};
  }
  output_values[index] = activate(sum);
}
`;
}

function split4({ weightType, loadWeight, weightHelper, activationFunction, activate }) {
  return `// Linear projection: output = input @ weight + bias
// Adapted from webgpu-samples visionTransformer mlp.wgsl with 2D dispatch.
//
// Weight layout controlled by params.transposed:
//   transposed=1 (default): weight is [inDim, outDim], access ${loadWeight("k * outDim + col")}
//   transposed=0: weight is [outDim, inDim] (PyTorch native), access ${loadWeight("col * inDim + k")}

struct Params {
  numRows: u32,
  inDim: u32,
  outDim: u32,
  numWorkgroupsX: u32,
  transposed: u32,  // 1=transposed [inDim, outDim], 0=native [outDim, inDim]
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> input: array<f32>;
@group(0) @binding(2) var<storage, read> weight: array<${weightType}>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;

const WG_SIZE: u32 = 256;

${weightHelper}${activationFunction}@compute @workgroup_size(WG_SIZE)
fn main(
  @builtin(workgroup_id) wgid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;
  let idx = linearWG * WG_SIZE + lid.x;

  if (idx >= params.numRows * params.outDim) { return; }

  let row = idx / params.outDim;
  let col = idx % params.outDim;

  // 4-way split accumulation for better fp32 precision on large dot products.
  var s0 = 0.0;
  var s1 = 0.0;
  var s2 = 0.0;
  var s3 = 0.0;
  let inBase = row * params.inDim;
  let len4 = (params.inDim / 4u) * 4u;

  if (params.transposed == 1u) {
    // Transposed layout: ${loadWeight("k, col")} = ${loadWeight("k * outDim + col")}
    let wBase = col;
    let stride = params.outDim;
    for (var k = 0u; k < len4; k += 4u) {
      s0 += input[inBase + k]      * ${loadWeight("(k)      * stride + wBase")};
      s1 += input[inBase + k + 1u] * ${loadWeight("(k + 1u) * stride + wBase")};
      s2 += input[inBase + k + 2u] * ${loadWeight("(k + 2u) * stride + wBase")};
      s3 += input[inBase + k + 3u] * ${loadWeight("(k + 3u) * stride + wBase")};
    }
    for (var k = len4; k < params.inDim; k++) {
      s0 += input[inBase + k] * ${loadWeight("k * stride + wBase")};
    }
  } else {
    // Native layout: ${loadWeight("col, k")} = ${loadWeight("col * inDim + k")}
    let wBase = col * params.inDim;
    for (var k = 0u; k < len4; k += 4u) {
      s0 += input[inBase + k]      * ${loadWeight("wBase + k")};
      s1 += input[inBase + k + 1u] * ${loadWeight("wBase + k + 1u")};
      s2 += input[inBase + k + 2u] * ${loadWeight("wBase + k + 2u")};
      s3 += input[inBase + k + 3u] * ${loadWeight("wBase + k + 3u")};
    }
    for (var k = len4; k < params.inDim; k++) {
      s0 += input[inBase + k] * ${loadWeight("wBase + k")};
    }
  }
  output[idx] = ${activate("(s0 + s1) + (s2 + s3) + bias[col]")};
}
`;
}

function split4Range({ weightType, loadWeight, weightHelper, activationFunction, activate }) {
  return `// Row-range linear projection: output[row] = input[row] @ weight + bias.
// The accumulation order and weight layout match linear.wgsl exactly.

struct Params {
  totalRows: u32,
  inDim: u32,
  outDim: u32,
  rowStart: u32,
  rowCount: u32,
  numWorkgroupsX: u32,
  transposed: u32,
  _padding: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> input: array<f32>;
@group(0) @binding(2) var<storage, read> weight: array<${weightType}>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;

const WG_SIZE: u32 = 256;

${weightHelper}${activationFunction}@compute @workgroup_size(WG_SIZE)
fn main(
  @builtin(workgroup_id) wgid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;
  let localIdx = linearWG * WG_SIZE + lid.x;
  if (localIdx >= params.rowCount * params.outDim) { return; }

  let localRow = localIdx / params.outDim;
  let col = localIdx % params.outDim;
  let row = params.rowStart + localRow;
  if (row >= params.totalRows) { return; }
  let idx = row * params.outDim + col;

  var s0 = 0.0;
  var s1 = 0.0;
  var s2 = 0.0;
  var s3 = 0.0;
  let inBase = row * params.inDim;
  let len4 = (params.inDim / 4u) * 4u;

  if (params.transposed == 1u) {
    let wBase = col;
    let stride = params.outDim;
    for (var k = 0u; k < len4; k += 4u) {
      s0 += input[inBase + k]      * ${loadWeight("(k)      * stride + wBase")};
      s1 += input[inBase + k + 1u] * ${loadWeight("(k + 1u) * stride + wBase")};
      s2 += input[inBase + k + 2u] * ${loadWeight("(k + 2u) * stride + wBase")};
      s3 += input[inBase + k + 3u] * ${loadWeight("(k + 3u) * stride + wBase")};
    }
    for (var k = len4; k < params.inDim; k++) {
      s0 += input[inBase + k] * ${loadWeight("k * stride + wBase")};
    }
  } else {
    let wBase = col * params.inDim;
    for (var k = 0u; k < len4; k += 4u) {
      s0 += input[inBase + k]      * ${loadWeight("wBase + k")};
      s1 += input[inBase + k + 1u] * ${loadWeight("wBase + k + 1u")};
      s2 += input[inBase + k + 2u] * ${loadWeight("wBase + k + 2u")};
      s3 += input[inBase + k + 3u] * ${loadWeight("wBase + k + 3u")};
    }
    for (var k = len4; k < params.inDim; k++) {
      s0 += input[inBase + k] * ${loadWeight("wBase + k")};
    }
  }
  output[idx] = ${activate("(s0 + s1) + (s2 + s3) + bias[col]")};
}
`;
}

const PACKED_WEIGHT_HELPER = `
fn load_weight(index: u32) -> f32 {
  let pair = unpack2x16float(weight[index / 2u]);
  return pair[index % 2u];
}

`;

/**
 * Emit a proven scalar linear variant; the caller owns buffers, dispatch and scheduling.
 * sequential4: input/weight/bias/output/uniform bindings 0..4; input channels divisible by four.
 * split4(-range): uniform/input/weight/bias/output bindings 0..4; native or transposed weights.
 * Packed storage contains existing binary16 bits, not newly quantized f32 values.
 * Activation expressions/helpers are trusted caller WGSL, with the result named value.
 */
export function createWebGpuLinearShader({
  variant,
  weightStorage = 'f32',
  activationExpression = 'value',
  activationHelpers = '',
} = {}) {
  const generators = { sequential4, split4, 'split4-range': split4Range };
  if (!Object.hasOwn(generators, variant)) throw new RangeError('unsupported linear variant');
  if (!['f32', 'f16-packed-u32'].includes(weightStorage)) {
    throw new RangeError('unsupported weightStorage');
  }
  if (typeof activationExpression !== 'string' || !activationExpression.trim()) {
    throw new TypeError('activationExpression must be nonempty WGSL');
  }
  if (typeof activationHelpers !== 'string') {
    throw new TypeError('activationHelpers must be WGSL text');
  }
  const packed = weightStorage === 'f16-packed-u32';
  const identity = activationExpression === 'value' && activationHelpers === '';
  return generators[variant]({
    weightType: packed ? 'u32' : 'f32',
    loadWeight: index => packed ? `load_weight(${index})` : `weight[${index}]`,
    weightHelper: packed ? PACKED_WEIGHT_HELPER : '',
    activationExpression,
    activationHelpers,
    activationFunction: identity ? '' : `${activationHelpers}
fn activate(value: f32) -> f32 {
  return ${activationExpression};
}

`,
    activate: value => identity ? value : `activate(${value})`,
  });
}
