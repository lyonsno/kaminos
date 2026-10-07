import { WEBGPU_BUFFER_USAGE as U, createWebGpuLinearShader } from '../../webgpu-inference-kit/src/core.js';

export const SPARSE_PREFIX_ROUTE = 'trellis2.sparse-flow-prefix.webgpu.v0';
export const BF16_WGSL = `
fn round_bf16(value: f32) -> f32 {
  let bits = bitcast<u32>(value);
  let rounded = bits + 32767u + ((bits >> 16u) & 1u);
  return bitcast<f32>(rounded & 4294901760u);
}`;

export function roundBfloat16(value) {
  const f = new Float32Array([value]);
  const u = new Uint32Array(f.buffer);
  u[0] = (u[0] + 0x7fff + ((u[0] >>> 16) & 1)) & 0xffff0000;
  return f[0];
}

export function buildSparsePrefixPlan({ resolution = 16, inChannels = 8,
  channels = 1536, frequencyDim = 256, tokenRows } = {}) {
  for (const [name, value] of Object.entries({ resolution, inChannels, channels, frequencyDim })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  if (frequencyDim % 2) throw new RangeError('frequencyDim must be even');
  if (tokenRows !== undefined && (!Number.isSafeInteger(tokenRows) || tokenRows < 1)) throw new RangeError('tokenRows must be a positive integer');
  const rows = tokenRows ?? resolution ** 3;
  if (!Number.isSafeInteger(rows * channels * 4)) throw new RangeError('tensor size exceeds integer addressing');
  return Object.freeze({ resolution, inChannels, channels, frequencyDim, rows,
    inputShape: tokenRows === undefined ? [1, inChannels, resolution, resolution, resolution] : [rows, inChannels],
    inputLayout: tokenRows === undefined ? 'ncdhw' : 'token-major',
    projectedShape: [rows, channels], modulationShape: [1, 6 * channels],
    outputArithmetic: 'bf16-values-in-f32-storage',
    stages: ['noise-input-projection', 'timestep-embedding', 'time-linear-0',
      'time-silu-0', 'time-linear-2', 'time-silu-1', 'shared-modulation'] });
}

export function validateSparsePrefixWeights(plan, weights) {
  const { channels: c, inChannels: ic, frequencyDim: f } = plan;
  const sizes = { 'input.weight': c * ic, 'input.bias': c,
    'time0.weight': c * f, 'time0.bias': c, 'time2.weight': c * c, 'time2.bias': c,
    'mod.weight': 6 * c * c, 'mod.bias': 6 * c };
  for (const [name, length] of Object.entries(sizes)) {
    const values = weights?.[name];
    if (!(values instanceof Float32Array) || values.length !== length) {
      throw new TypeError(`${name} requires ${length} float32 values`);
    }
    if (!values.every(Number.isFinite)) throw new TypeError(`${name} contains non-finite values`);
  }
  return sizes;
}

const timestepShader = frequencyDim => `
@group(0) @binding(0) var<storage, read> t: array<f32>;
@group(0) @binding(1) var<storage, read_write> embedding: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= ${frequencyDim}u) { return; }
  let half_dim = ${frequencyDim / 2}u;
  let phase = t[0] * exp(-log(10000.0) * f32(i % half_dim) / f32(half_dim));
  if (i < half_dim) { embedding[i] = cos(phase); }
  else { embedding[i] = sin(phase); }
}`;

// Input is NCDHW. Row r is the same z/y/x flattened voxel as the source's
// reshape(B,C,-1).transpose(0,2,1); checkpoint weights are [out,in].
const projectionShader = plan => `
@group(0) @binding(0) var<storage, read> noise: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> projected: array<f32>;
${BF16_WGSL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(num_workgroups) grid: vec3<u32>) {
  let index = gid.x + gid.y * grid.x * 64u;
  if (index >= ${plan.rows * plan.channels}u) { return; }
  let row = index / ${plan.channels}u;
  let channel = index % ${plan.channels}u;
  var sum = 0.0;
  for (var k = 0u; k < ${plan.inChannels}u; k++) {
    sum += noise[${plan.inputLayout === 'token-major' ? `row * ${plan.inChannels}u + k` : `k * ${plan.rows}u + row`}] * weight[channel * ${plan.inChannels}u + k];
  }
  projected[index] = round_bf16(sum + bias[channel]);
}`;

const siluShader = count => `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= ${count}u) { return; }
  let x = input[gid.x]; output[gid.x] = x / (1.0 + exp(-x));
}`;

function dispatch1D(count, workgroupSize, limit) {
  const groups = Math.ceil(count / workgroupSize);
  const x = Math.min(groups, limit);
  const y = Math.ceil(groups / x);
  if (y > limit) throw new RangeError('requested tensor exceeds device dispatch capacity');
  return [x, y, 1];
}

export function createTrellisSparsePrefixAdapter({ route, weights, config = {}, sampleTensor }) {
  const runtime = route?.runtime;
  if (!runtime?.createTensor || !runtime?.defineComputeKernel) throw new TypeError('a registered WebGPU route runtime is required');
  const plan = buildSparsePrefixPlan(config);
  const sizes = validateSparsePrefixWeights(plan, weights);
  if (sampleTensor && (!sampleTensor.buffer || sampleTensor.dtype !== 'f32' ||
      JSON.stringify(sampleTensor.shape) !== JSON.stringify(plan.inputShape) ||
      !(sampleTensor.usage & U.storage))) {
    throw new TypeError(`borrowed sample tensor must be complete F32 ${plan.inputLayout} storage`);
  }
  const resources = [];
  let disposed = false;
  const tensor = (name, shape, dtype = 'f32', usage = U.storage | U.copyDst | U.copySrc) => {
    const value = runtime.createTensor({ name: `trellis.sparse.${name}`, shape, dtype, usage });
    resources.push(value); return value;
  };
  const bindings = values => values.map(([name, resource, access]) => access === 'uniform'
    ? { name, resource, type: 'uniform' } : { name, resource, access });
  const read = (name, resource) => [name, resource, 'read-only-storage'];
  const write = (name, resource) => [name, resource, 'storage'];
  const wgLimit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
  try {
    const w = {};
    for (const [name, count] of Object.entries(sizes)) {
      w[name] = tensor(name, [count]); runtime.uploadTensor(w[name], weights[name]);
    }
    const noise = sampleTensor ?? tensor('noise', plan.inputShape);
    const time = tensor('time', [1]);
    const projected = tensor('input-projected', plan.projectedShape);
    const embedding = tensor('time-embedding', [plan.frequencyDim]);
    const time0 = tensor('time-linear-0', [plan.channels]);
    const silu0 = tensor('time-silu-0', [plan.channels]);
    const time2 = tensor('time-linear-2', [plan.channels]);
    const silu1 = tensor('time-silu-1', [plan.channels]);
    const modulation = tensor('shared-modulation', plan.modulationShape);
    const kernels = [];
    const add = (name, code, values, dispatch) => kernels.push({ name, dispatch,
      kernel: runtime.defineComputeKernel({ name: `trellis.sparse.${name}`, code, bindings: bindings(values) }) });
    add('noise-input-projection', projectionShader(plan), [read('noise', noise),
      read('weight', w['input.weight']), read('bias', w['input.bias']), write('projected', projected)],
      dispatch1D(plan.rows * plan.channels, 64, wgLimit));
    add('timestep-embedding', timestepShader(plan.frequencyDim), [read('time', time), write('embedding', embedding)],
      [Math.ceil(plan.frequencyDim / 64), 1, 1]);
    const linear = (name, input, output, inDim, outDim, key, rounded) => {
      const grid = dispatch1D(outDim, 256, wgLimit);
      const dims = tensor(`${name}.dims`, [8], 'u32', U.uniform | U.copyDst);
      runtime.uploadTensor(dims, new Uint32Array([1, inDim, outDim, grid[0], 0, 0, 0, 0]));
      add(name, createWebGpuLinearShader({ variant: 'split4',
        activationExpression: rounded ? 'round_bf16(value)' : 'value',
        activationHelpers: rounded ? BF16_WGSL : '' }), [['dims', dims, 'uniform'],
        read('input', input), read('weight', w[`${key}.weight`]), read('bias', w[`${key}.bias`]),
        write('output', output)], grid);
    };
    linear('time-linear-0', embedding, time0, plan.frequencyDim, plan.channels, 'time0', false);
    add('time-silu-0', siluShader(plan.channels), [read('input', time0), write('output', silu0)], [Math.ceil(plan.channels / 64), 1, 1]);
    linear('time-linear-2', silu0, time2, plan.channels, plan.channels, 'time2', false);
    add('time-silu-1', siluShader(plan.channels), [read('input', time2), write('output', silu1)], [Math.ceil(plan.channels / 64), 1, 1]);
    linear('shared-modulation', silu1, modulation, plan.channels, plan.channels * 6, 'mod', true);
    return Object.freeze({ plan, outputs: Object.freeze({ projected, modulation }),
      async run({ sample, timestep }, invocation) {
        if (disposed) throw new Error('sparse prefix adapter is disposed');
        if (sampleTensor && sample !== undefined) throw new TypeError('borrowed sample tensor is caller-owned; do not upload a CPU replacement');
        if (!sampleTensor && (!(sample instanceof Float32Array) || sample.length !== plan.rows * plan.inChannels || !sample.every(Number.isFinite))) {
          throw new TypeError(`sample must contain the complete finite ${plan.inputLayout} noise tensor`);
        }
        if (!Number.isFinite(timestep)) throw new TypeError('timestep must be finite');
        if (!sampleTensor) runtime.uploadTensor(noise, sample);
        runtime.uploadTensor(time, new Float32Array([timestep]));
        for (const { name, kernel, dispatch } of kernels) {
          await runtime.runKernel(kernel, { stage: name, dispatch, schedulerInvocation: invocation, yieldAfter: true });
        }
        return { projected, modulation, arithmetic: plan.outputArithmetic };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const resource of resources) resource.buffer?.destroy?.();
      },
    });
  } catch (error) {
    for (const resource of resources) resource.buffer?.destroy?.();
    throw error;
  }
}
