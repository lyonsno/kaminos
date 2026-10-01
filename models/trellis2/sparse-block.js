import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { BF16_WGSL, roundBfloat16 } from './sparse-prefix.js';

export const SPARSE_BLOCK_ROUTE = 'trellis2.sparse-flow-block.webgpu.v0';

export function buildSparseBlockPlan({ resolution = 16, channels = 1536, heads = 12,
  contextChannels = 1024, contextRows = 1029, hidden = 8192 } = {}) {
  for (const [name, value] of Object.entries({ resolution, channels, heads, contextChannels, contextRows, hidden })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  if (channels % heads) throw new RangeError('channels must be divisible by heads');
  const headDim = channels / heads, rows = resolution ** 3;
  if (headDim % 2) throw new RangeError('RoPE requires an even head dimension');
  const stages = ['block-modulation', 'self-layernorm', 'self-adaln', 'self-qkv', 'self-q-norm', 'self-k-norm', 'self-q-rope', 'self-k-rope'];
  for (let h = 0; h < heads; h++) stages.push(`self-score-${h}`, `self-softmax-${h}`, `self-value-${h}`);
  stages.push('self-output', 'self-residual', 'cross-layernorm', 'cross-query', 'cross-kv', 'cross-q-norm', 'cross-k-norm');
  for (let h = 0; h < heads; h++) stages.push(`cross-score-${h}`, `cross-softmax-${h}`, `cross-value-${h}`);
  stages.push('cross-output', 'cross-residual', 'mlp-layernorm', 'mlp-adaln', 'mlp-input-linear', 'mlp-gelu', 'mlp-output-linear', 'mlp-residual');
  const scoresBytes = rows * Math.max(rows, contextRows) * 4, hiddenBytes = rows * hidden * 4;
  if (![scoresBytes, hiddenBytes, rows * 3 * channels * 4].every(n => Number.isSafeInteger(n) && n < 2 ** 32)) {
    throw new RangeError('tensor exceeds WebGPU u32 byte addressing');
  }
  return Object.freeze({ resolution, channels, heads, headDim, contextChannels, contextRows, hidden, rows,
    outputShape: [rows, channels], scoresBytes, hiddenBytes, stages,
    arithmetic: 'bf16-values-in-f32-storage/f32-score-softmax', attention: 'complete-per-head-score-buffer' });
}

export function sparseBlockWeightShapes(p) {
  const c = p.channels, h = p.hidden;
  return { modulation: [6 * c], 'norm2.weight': [c], 'norm2.bias': [c],
    'self.qkv.weight': [3 * c, c], 'self.qkv.bias': [3 * c],
    'self.out.weight': [c, c], 'self.out.bias': [c],
    'self.q.gamma': [p.heads, p.headDim], 'self.k.gamma': [p.heads, p.headDim],
    'cross.q.weight': [c, c], 'cross.q.bias': [c],
    'cross.kv.weight': [2 * c, p.contextChannels], 'cross.kv.bias': [2 * c],
    'cross.out.weight': [c, c], 'cross.out.bias': [c],
    'cross.q.gamma': [p.heads, p.headDim], 'cross.k.gamma': [p.heads, p.headDim],
    'mlp.in.weight': [h, c], 'mlp.in.bias': [h], 'mlp.out.weight': [c, h], 'mlp.out.bias': [c] };
}

const workspaceStates = new WeakMap();

// One named activation set across serialized blocks. Diagnostics and hidden
// are borrowed views: the next block overwrites them after their last use.
// Offline observers may snapshot them; serving does not retain per-block copies.
export function createTrellisSparseBlockWorkspace({ route, config = {}, conditioning, phases }) {
  const runtime = route?.runtime, plan = buildSparseBlockPlan(config);
  if (!runtime?.createTensor || !runtime?.uploadTensor) throw new TypeError('registered WebGPU runtime required');
  for (const [name, values, count] of [['conditioning', conditioning, plan.contextRows * plan.contextChannels],
    ['phases', phases, plan.rows * plan.headDim]]) {
    if (!(values instanceof Float32Array) || values.length !== count || !values.every(Number.isFinite)) throw new TypeError(`complete finite ${name} required`);
  }
  const resources = new Map(); let disposed = false, inUse = false;
  const available = () => { if (disposed) throw new Error('sparse block workspace disposed'); };
  const allocate = (name, shape) => {
    available();
    const existing = resources.get(name);
    if (existing) {
      if (JSON.stringify(existing.shape) !== JSON.stringify(shape)) throw new Error(`workspace shape changed: ${name}`);
      return existing;
    }
    const bytes = shape.reduce((a, b) => a * b, 4);
    if (bytes > (runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728)) throw new RangeError('workspace exceeds storage binding capacity');
    const t = runtime.createTensor({ name: `trellis.block.shared.${name}`, shape, dtype: 'f32', usage: U.storage | U.copyDst | U.copySrc });
    resources.set(name, t); return t;
  };
  const dispose = () => {
    if (inUse) throw new Error('sparse block workspace in use');
    if (disposed) return; disposed = true;
    for (const t of resources.values()) t.buffer?.destroy?.();
  };
  try {
    const context = allocate('conditioning', [plan.contextRows, plan.contextChannels]);
    const rope = allocate('rope-phases', [plan.rows, plan.headDim / 2, 2]);
    runtime.uploadTensor(context, Float32Array.from(conditioning, roundBfloat16));
    runtime.uploadTensor(rope, phases);
    const workspace = Object.freeze({ plan, conditioning: context, phases: rope, dispose,
      setConditioning(values) {
        available(); if (inUse) throw new Error('sparse block workspace in use');
        if (!(values instanceof Float32Array) || values.length !== plan.contextRows * plan.contextChannels ||
            !values.every(Number.isFinite)) throw new TypeError('complete finite conditioning required');
        runtime.uploadTensor(context, Float32Array.from(values, roundBfloat16));
      } });
    workspaceStates.set(workspace, { runtime, plan, allocate, available,
      acquire() { available(); if (inUse) throw new Error('sparse block workspace in use'); inUse = true; },
      release() { inUse = false; } });
    return workspace;
  } catch (error) { dispose(); throw error; }
}

// Native [out,in] checkpoint weights; 16x16 shared tiles. No activation cap.
// The accumulator is F32 and only linear output is rounded to BF16.
function matrixShader({ rows, columns, reduction, aStride, aOffset = 0,
  bStride, bOffset = 0, bTransposed = false, outStride = columns, outOffset = 0,
  bias = false, scale = 1, rounded = true }) {
  return `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
${bias ? '@group(0) @binding(2) var<storage, read> bias: array<f32>;' : ''}
@group(0) @binding(${bias ? 3 : 2}) var<storage, read_write> output: array<f32>;
var<workgroup> tile_a: array<f32, 256>;
var<workgroup> tile_b: array<f32, 256>;
${BF16_WGSL}
@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let row = wid.y * 16u + lid.y; let col = wid.x * 16u + lid.x;
  var sum = 0.0;
  for (var base = 0u; base < ${reduction}u; base += 16u) {
    let ak = base + lid.x; let bk = base + lid.y;
    var av = 0.0; var bv = 0.0;
    if (row < ${rows}u && ak < ${reduction}u) { av = a[row * ${aStride}u + ak + ${aOffset}u]; }
    if (col < ${columns}u && bk < ${reduction}u) {
      bv = b[${bTransposed ? `bk * ${bStride}u + col` : `col * ${bStride}u + bk`} + ${bOffset}u];
    }
    tile_a[lid.y * 16u + lid.x] = av; tile_b[lid.y * 16u + lid.x] = bv;
    workgroupBarrier();
    for (var k = 0u; k < 16u; k++) { sum += tile_a[lid.y * 16u + k] * tile_b[k * 16u + lid.x]; }
    workgroupBarrier();
  }
  if (row < ${rows}u && col < ${columns}u) {
    let value = sum * ${Number(scale).toPrecision(12)} ${bias ? '+ bias[col]' : ''};
    output[row * ${outStride}u + col + ${outOffset}u] = ${rounded ? 'round_bf16(value)' : 'value'};
  }
}`;
}

function normShader({ rows, width, stride = width, offset = 0, rms = false, affine = false }) {
  return `
@group(0) @binding(0) var<storage, read> input: array<f32>;
${affine || rms ? '@group(0) @binding(1) var<storage, read> weight: array<f32>;' : ''}
${affine ? '@group(0) @binding(2) var<storage, read> bias: array<f32>;' : ''}
@group(0) @binding(${affine ? 3 : rms ? 2 : 1}) var<storage, read_write> output: array<f32>;
var<workgroup> partial: array<f32, 256>;
${BF16_WGSL}
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3<u32>) {
  let row = wid.x; var sum = 0.0;
  for (var i = lane; i < ${width}u; i += 256u) { let x = input[row * ${stride}u + i + ${offset}u]; sum += ${rms ? 'x * x' : 'x'}; }
  partial[lane] = sum; workgroupBarrier();
  for (var s = 128u; s > 0u; s /= 2u) { if (lane < s) { partial[lane] += partial[lane + s]; } workgroupBarrier(); }
  ${rms ? 'let inverse = inverseSqrt(partial[0] + 1e-12);' : `let mean = partial[0] / ${width}.0;
  workgroupBarrier(); sum = 0.0;
  for (var i = lane; i < ${width}u; i += 256u) { let x = input[row * ${stride}u + i + ${offset}u] - mean; sum += x * x; }
  partial[lane] = sum; workgroupBarrier();
  for (var s = 128u; s > 0u; s /= 2u) { if (lane < s) { partial[lane] += partial[lane + s]; } workgroupBarrier(); }
  let inverse = inverseSqrt(partial[0] / ${width}.0 + 1e-6);`}
  for (var i = lane; i < ${width}u; i += 256u) {
    let value = ${rms ? `input[row * ${stride}u + i + ${offset}u] * inverse * weight[(row % HEADS) * ${width}u + i] * sqrt(${width}.0)` :
    `(input[row * ${stride}u + i + ${offset}u] - mean) * inverse ${affine ? '* weight[i] + bias[i]' : ''}`};
    output[row * ${width}u + i] = round_bf16(value);
  }
}`;
}

function elementShader(count, declarations, expression) {
  return `${declarations}
${BF16_WGSL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) grid: vec3<u32>) {
  let i = gid.x + gid.y * grid.x * 64u;
  if (i >= ${count}u) { return; }
  ${expression}
}`;
}

export function createTrellisSparseBlockAdapter({ route, config = {}, weights, inputs, conditioning, phases, workspace }) {
  const runtime = route?.runtime, plan = buildSparseBlockPlan(config);
  if (!runtime?.createTensor || !runtime?.defineComputeKernel) throw new TypeError('registered WebGPU runtime required');
  const shared = workspace === undefined ? null : workspaceStates.get(workspace);
  if (workspace !== undefined) {
    if (!shared || shared.runtime !== runtime) throw new TypeError('workspace runtime must match block runtime');
    shared.available();
    if (JSON.stringify(shared.plan) !== JSON.stringify(plan)) throw new TypeError('workspace configuration must match block configuration');
    if (conditioning !== undefined || phases !== undefined) throw new TypeError('workspace owns conditioning and phases; do not replace them per block');
  }
  for (const [name, shape] of Object.entries({ projected: plan.outputShape, modulation: [1, 6 * plan.channels] })) {
    const value = inputs?.[name];
    if (!value?.buffer || value.dtype !== 'f32' || JSON.stringify(value.shape) !== JSON.stringify(shape)) {
      throw new TypeError(`${name} must be the resident prefix tensor with shape ${shape}`);
    }
  }
  const shapes = sparseBlockWeightShapes(plan);
  for (const [name, shape] of Object.entries(shapes)) {
    if (!(weights?.[name] instanceof Float32Array) || weights[name].length !== shape.reduce((a, b) => a * b, 1) || !weights[name].every(Number.isFinite)) {
      throw new TypeError(`incomplete or non-finite block weight ${name}`);
    }
  }
  if (!(weights.gelu instanceof Float32Array) || weights.gelu.length !== 65536) throw new TypeError('complete source BF16 GELU table required');
  if (!shared) for (const [name, array, count] of [['conditioning', conditioning, plan.contextRows * plan.contextChannels],
    ['phases', phases, plan.rows * plan.headDim]]) {
    if (!(array instanceof Float32Array) || array.length !== count || !array.every(Number.isFinite)) throw new TypeError(`complete finite ${name} required`);
  }
  const largest = Math.max(plan.scoresBytes, plan.hiddenBytes, plan.rows * 3 * plan.channels * 4,
    ...Object.values(shapes).map(shape => shape.reduce((a, b) => a * b, 4)));
  if (largest > (runtime.device?.limits?.maxStorageBufferBindingSize ?? 134217728)) throw new RangeError(`block requires ${largest} bytes of storage binding capacity`);
  const resources = [], kernels = [], tensors = {}, w = {};
  let disposed = false, running = false;
  const tensor = (name, shape) => { const t = runtime.createTensor({ name: `trellis.block.${name}`, shape, dtype: 'f32', usage: U.storage | U.copyDst | U.copySrc }); resources.push(t); return t; };
  const activation = (name, shape) => shared ? shared.allocate(name, shape) : tensor(name, shape);
  const allocate = (name, rows = plan.rows, width = plan.channels) => (tensors[name] = activation(name, [rows, width]));
  const add = (name, code, args, dispatch) => kernels.push({ name, dispatch, kernel: runtime.defineComputeKernel({
    name: `trellis.block.${name}`, code, bindings: args.map((resource, i) => ({ name: `b${i}`, resource,
      access: i === args.length - 1 ? 'storage' : 'read-only-storage' })) }) });
  const grid = count => { const n = Math.ceil(count / 64), limit = runtime.device?.limits?.maxComputeWorkgroupsPerDimension ?? 65535;
    const x = Math.min(n, limit), y = Math.ceil(n / x); if (y > limit) throw new RangeError('dispatch exceeds device capacity'); return [x, y, 1]; };
  const decl = names => names.map((name, i) => `@group(0) @binding(${i}) var<storage, ${i === names.length - 1 ? 'read_write' : 'read'}> ${name}: array<f32>;`).join('\n');
  const c = plan.channels, r = plan.rows, d = plan.headDim, heads = plan.heads, s = plan.contextRows;
  try {
    for (const [name, shape] of Object.entries({ ...shapes, gelu: [65536] })) { w[name] = tensor(name, shape); runtime.uploadTensor(w[name], weights[name]); }
    const context = workspace?.conditioning ?? tensor('conditioning', [s, plan.contextChannels]);
    const rope = workspace?.phases ?? tensor('rope-phases', [r, d / 2, 2]);
    if (!shared) { runtime.uploadTensor(context, Float32Array.from(conditioning, roundBfloat16)); runtime.uploadTensor(rope, phases); }
    const mod = activation('modulation', [6 * c]);
    add('block-modulation', elementShader(6 * c, decl(['timestep_mod', 'bias', 'output']), 'output[i] = round_bf16(timestep_mod[i] + bias[i]);'), [inputs.modulation, w.modulation, mod], grid(6 * c));
    const norm = (stage, input, name, affine = false) => { const out = allocate(name); add(stage, normShader({ rows: r, width: c, affine }),
      affine ? [input, w['norm2.weight'], w['norm2.bias'], out] : [input, out], [r, 1, 1]); return out; };
    const adaln = (stage, input, name, shift, scale) => { const out = allocate(name); add(stage, elementShader(r * c, decl(['input', 'modulation', 'output']),
      `let ch = i % ${c}u; let scale = round_bf16(1.0 + modulation[${scale * c}u + ch]); output[i] = round_bf16(round_bf16(input[i] * scale) + modulation[${shift * c}u + ch]);`), [input, mod, out], grid(r * c)); return out; };
    const linear = (stage, input, name, key, rowCount = r) => { const [outDim, inDim] = shapes[`${key}.weight`], out = allocate(name, rowCount, outDim);
      add(stage, matrixShader({ rows: rowCount, columns: outDim, reduction: inDim, aStride: inDim, bStride: inDim, bias: true }),
        [input, w[`${key}.weight`], w[`${key}.bias`], out], [Math.ceil(outDim / 16), Math.ceil(rowCount / 16), 1]); return out; };
    const rms = (stage, input, name, key, rowCount, components, component) => { const out = allocate(name, rowCount, c);
      // Fused QKV/KV is token,component,head,channel. The head row stride is
      // nonuniform at token boundaries, so map it explicitly before reduction.
      const shader = normShader({ rows: rowCount * heads, width: d, rms: true })
        .replaceAll('row * ' + d + 'u + i + 0u', `(row / ${heads}u) * ${components * c}u + ${component * c}u + (row % ${heads}u) * ${d}u + i`)
        .replaceAll('HEADS', `${heads}u`);
      add(stage, shader, [input, w[`${key}.gamma`], out], [rowCount * heads, 1, 1]); return out; };
    const rotate = (stage, input, name) => { const out = allocate(name); add(stage, elementShader(r * c / 2, decl(['input', 'phases', 'output']),
      `let token = i / ${c / 2}u; let pair = i % ${d / 2}u; let p = token * ${d}u + pair * 2u;
       let a = input[i * 2u]; let b = input[i * 2u + 1u]; let cs = phases[p]; let sn = phases[p + 1u];
       output[i * 2u] = round_bf16(a * cs - b * sn); output[i * 2u + 1u] = round_bf16(a * sn + b * cs);`), [input, rope, out], grid(r * c / 2)); return out; };
    const scores = activation('attention-scores-scratch', [r, Math.max(r, s)]);
    const attend = (prefix, q, k, v, keyRows, vComponents, vComponent) => {
      const out = allocate(`${prefix}.attention`);
      for (let head = 0; head < heads; head++) {
        add(`${prefix}-score-${head}`, matrixShader({ rows: r, columns: keyRows, reduction: d, aStride: c,
          aOffset: head * d, bStride: c, bOffset: head * d, scale: 1 / Math.sqrt(d), rounded: false }), [q, k, scores], [Math.ceil(keyRows / 16), Math.ceil(r / 16), 1]);
        add(`${prefix}-softmax-${head}`, `
@group(0) @binding(0) var<storage, read_write> scores: array<f32>;
var<workgroup> partial: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3<u32>) {
  let row = wid.x; var maximum = -3.402823e38;
  for (var i = lane; i < ${keyRows}u; i += 256u) { maximum = max(maximum, scores[row * ${keyRows}u + i]); }
  partial[lane] = maximum; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) { if (lane < stride) { partial[lane] = max(partial[lane], partial[lane + stride]); } workgroupBarrier(); }
  maximum = partial[0]; workgroupBarrier(); var sum = 0.0;
  for (var i = lane; i < ${keyRows}u; i += 256u) { let e = exp(scores[row * ${keyRows}u + i] - maximum); scores[row * ${keyRows}u + i] = e; sum += e; }
  partial[lane] = sum; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) { if (lane < stride) { partial[lane] += partial[lane + stride]; } workgroupBarrier(); }
  let denominator = partial[0];
  for (var i = lane; i < ${keyRows}u; i += 256u) { scores[row * ${keyRows}u + i] /= denominator; }
}`, [scores], [r, 1, 1]);
        add(`${prefix}-value-${head}`, matrixShader({ rows: r, columns: d, reduction: keyRows, aStride: keyRows,
          bStride: vComponents * c, bOffset: vComponent * c + head * d, bTransposed: true,
          outStride: c, outOffset: head * d }), [scores, v, out], [Math.ceil(d / 16), Math.ceil(r / 16), 1]);
      }
      return out;
    };
    const residual = (stage, input, value, name, gate = null) => { const out = allocate(name); add(stage,
      elementShader(r * c, decl(gate === null ? ['input', 'value', 'output'] : ['input', 'value', 'modulation', 'output']),
        `output[i] = round_bf16(input[i] + ${gate === null ? 'value[i]' : `round_bf16(value[i] * modulation[${gate * c}u + i % ${c}u])`});`),
      gate === null ? [input, value, out] : [input, value, mod, out], grid(r * c)); return out; };
    const n1 = norm('self-layernorm', inputs.projected, 'norm1');
    const sa = adaln('self-adaln', n1, 'modulated_self_input', 0, 1);
    const qkv = linear('self-qkv', sa, 'self.qkv', 'self.qkv');
    const qn = rms('self-q-norm', qkv, 'q_post_norm', 'self.q', r, 3, 0);
    const kn = rms('self-k-norm', qkv, 'k_post_norm', 'self.k', r, 3, 1);
    const q = rotate('self-q-rope', qn, 'q_post_rope'), k = rotate('self-k-rope', kn, 'k_post_rope');
    const selfRaw = attend('self', q, k, qkv, r, 3, 2);
    const self = linear('self-output', selfRaw, 'self_attn', 'self.out');
    const afterSelf = residual('self-residual', inputs.projected, self, 'after_self', 2);
    const n2 = norm('cross-layernorm', afterSelf, 'norm2', true);
    const cq = linear('cross-query', n2, 'cross.q', 'cross.q');
    const ckv = linear('cross-kv', context, 'cross.kv', 'cross.kv', s);
    const cqn = rms('cross-q-norm', cq, 'cross_q_post_norm', 'cross.q', r, 1, 0);
    const ckn = rms('cross-k-norm', ckv, 'cross_k_post_norm', 'cross.k', s, 2, 0);
    const crossRaw = attend('cross', cqn, ckn, ckv, s, 2, 1);
    const cross = linear('cross-output', crossRaw, 'cross_attn', 'cross.out');
    const afterCross = residual('cross-residual', afterSelf, cross, 'after_cross');
    const n3 = norm('mlp-layernorm', afterCross, 'norm3');
    const mi = adaln('mlp-adaln', n3, 'mlp_input', 3, 4);
    const fc1 = linear('mlp-input-linear', mi, 'mlp_fc1', 'mlp.in');
    const gelu = allocate('mlp_gelu', r, plan.hidden);
    add('mlp-gelu', elementShader(r * plan.hidden, decl(['input', 'table', 'output']), 'output[i] = table[bitcast<u32>(input[i]) >> 16u];'), [fc1, w.gelu, gelu], grid(r * plan.hidden));
    const fc2 = linear('mlp-output-linear', gelu, 'mlp_fc2', 'mlp.out');
    const output = residual('mlp-residual', afterCross, fc2, 'after_mlp', 5);
    if (JSON.stringify(kernels.map(x => x.name)) !== JSON.stringify(plan.stages)) throw new Error('block stage plan mismatch');
    return Object.freeze({ plan, outputs: { hidden: output }, diagnostics: Object.freeze({ ...tensors, modulation: mod }),
      async run(invocation) { if (disposed) throw new Error('sparse block adapter disposed');
        if (running) throw new Error('sparse block workspace/adapter in use');
        shared?.acquire(); running = true;
        try {
          for (const { name, kernel, dispatch } of kernels) await runtime.runKernel(kernel, { stage: name, dispatch, schedulerInvocation: invocation, yieldAfter: true });
          return { hidden: output, arithmetic: plan.arithmetic };
        } finally { running = false; shared?.release(); } },
      dispose() { if (running) throw new Error('sparse block adapter in use'); if (disposed) return; disposed = true; for (const t of resources) t.buffer?.destroy?.(); } });
  } catch (error) { for (const t of resources) t.buffer?.destroy?.(); throw error; }
}
