// kaminos-test: node
import assert from 'node:assert/strict';
import { T5Encoder } from '../models/unimate/unimate-t5.js';
const buffers = [], dispatches = [];
const device = { queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
  createBuffer({ size }) { const b = { size, destroyed: false, destroy() { this.destroyed = true; }, async mapAsync() {},
    getMappedRange: () => new ArrayBuffer(size), unmap() {} }; buffers.push(b); return b; },
  createShaderModule: ({ code }) => code,
  createComputePipeline: ({ compute }) => ({ code: compute.module, getBindGroupLayout() {} }),
  createBindGroup() {}, createCommandEncoder() { return {
    beginComputePass() { let code; return { setPipeline(p) { code = p.code; }, setBindGroup() {}, dispatchWorkgroups(...grid) { dispatches.push({ code, grid }); }, end() {} }; },
    copyBufferToBuffer() {}, finish: () => ({}),
  }; },
};
const oldMap = globalThis.GPUMapMode; globalThis.GPUMapMode = { READ: 1 };
const manifest = { config: { feed_forward_proj: 'gated-gelu', d_model: 1, num_heads: 1, d_kv: 1, d_ff: 1, num_layers: 2, layer_norm_epsilon: 1e-6 }, relative_buckets: { min_distance: 0, buckets: [0] } };
const names = ['shared', 'final_layer_norm', ...[0, 1].flatMap(l => ['ln_attn', 'qkv', 'o', 'ln_ff', 'wi', 'wo'].map(n => `block${l}.${n}`))];
const t5 = new T5Encoder(device, manifest, new Map(names.map(n => [n, { buffer: device.createBuffer({ size: 256 }) }])), new Float32Array(1), { encode: () => [0] });
try {
  await t5.encode('walk'); const direct = dispatches.splice(0);
  const duties = [], controller = new AbortController();
  const schedule = { signal: controller.signal, invocation: {}, control: { async runDuty(work) { return work(); } },
    runtime: { async prepareCommandDutyAtBoundary(d) { duties.push(d.phase); return d; }, settleCommandDuty() {} } };
  const start = buffers.length;
  const encoded = await t5.encode('walk', { schedule });
  assert(duties.includes('unimate.t5.block0') && duties.includes('unimate.t5.block1'), 'each encoder block must offer the foreground a service boundary');
  assert.deepEqual(dispatches.splice(0), direct, 'cooperation preserves kernel and dispatch ordering');
  assert.equal(encoded.duties.length, duties.length);
  assert(buffers.slice(start).every(b => b.destroyed));
  duties.length = 0; const abortedStart = buffers.length;
  schedule.control.runDuty = async work => { await work(); controller.abort('stop at first block'); };
  await assert.rejects(t5.encode('walk', { schedule }), { name: 'AbortError' });
  assert.deepEqual(duties, ['unimate.t5.block0']);
  assert(buffers.slice(abortedStart).every(b => b.destroyed), 'cancelled encoder settles and releases temporaries');
  console.log('T5 preserves dispatches and services controls/foreground between encoder blocks');
} finally { t5.destroy(); globalThis.GPUMapMode = oldMap; }
