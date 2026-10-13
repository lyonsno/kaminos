import assert from 'node:assert/strict';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { buildSparseBlockPlan, sparseBlockWeightShapes, createTrellisSparseBlockAdapter,
  createTrellisSparseBlockWorkspace } from '../sparse-block.js';
import { buildSLatFlowPlan } from '../slat-flow.js';

const config = { tokenRows: 70, channels: 32, heads: 2, contextChannels: 8,
  contextRows: 90, hidden: 64, attentionKernel: 'tiled' };
const plan = buildSparseBlockPlan(config);
assert.equal(plan.attentionKernel, 'tiled', 'Requested tiled attention must not silently execute GEMM.');
assert.equal(plan.scoresBytes, 0, 'Tiled attention must not retain the quadratic score buffer.');
assert.equal(buildSparseBlockPlan().attentionKernel, 'gemm');
assert.equal(buildSLatFlowPlan({ ...config, mode: 'texture' }).flow.block.attentionKernel, 'tiled');
assert.throws(() => buildSparseBlockPlan({ attentionKernel: 'typo' }), /attentionKernel/);
assert.throws(() => buildSparseBlockPlan({ ...config, channels: 12, heads: 3 }), /head dimension/);
const resources = [], runs = [], uploads = [];
const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728 } },
  createTensor(spec) { const t = { ...spec, buffer: { destroy() { t.destroyed = true; } } }; resources.push(t); return t; },
  uploadTensor(tensor, values) { uploads.push({ tensor, values }); },
  defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); },
  readTensor() { assert.fail('Attention adoption must stay resident.'); } };
const route = { runtime }, projected = runtime.createTensor({ shape: [70, 32], dtype: 'f32' }),
  modulation = runtime.createTensor({ shape: [1, 192], dtype: 'f32' });
const shared = createTrellisSparseBlockWorkspace({ route, config,
  conditioning: new Float32Array(90 * 8), phases: new Float32Array(70 * 16) });
const weights = Object.fromEntries(Object.entries(sparseBlockWeightShapes(plan)).map(([name, shape]) =>
  [name, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
weights.gelu = new Float32Array(65536);
const adapter = createTrellisSparseBlockAdapter({ route, config, weights,
  inputs: { projected, modulation }, workspace: shared });
const invocation = { id: 'current-attention-consumer' };
await adapter.run(invocation);
assert.deepEqual(runs.map(row => row.options.stage), plan.stages);
assert.ok(runs.every(row => row.options.schedulerInvocation === invocation && row.options.yieldAfter));
assert.ok(!resources.some(t => t.name?.includes('attention-scores-scratch')));
for (const [prefix, keys, components, component] of [['self', 70, 3, 2], ['cross', 90, 2, 1]]) {
  const at = runs.findIndex(row => row.options.stage === `${prefix}-tiled-attention`);
  assert.ok(at >= 0);
  const { kernel, options } = runs[at];
  assert.deepEqual(options.dispatch, [2, 2, 1], 'Tail queries and all heads must execute.');
  assert.equal(kernel.bindings.length, 5);
  assert.equal(kernel.bindings[3].access, 'storage');
  assert.equal(kernel.bindings[4].type, 'uniform');
  assert.ok(kernel.bindings[4].resource.usage & U.uniform);
  const words = uploads.find(row => row.tensor === kernel.bindings[4].resource).values;
  assert.deepEqual([...words.slice(0, 6)], [70, keys, 2, 2, 0, 70]);
  assert.deepEqual([...words.slice(8, 12)], [0, 32, 16, 70 * 32]);
  assert.deepEqual([...words.slice(12, 16)], [0, 32, 16, keys * 32]);
  assert.deepEqual([...words.slice(16, 20)], [component * 32, components * 32, 16, keys * components * 32]);
  assert.equal(new Float32Array(words.buffer)[6], 1 / Math.sqrt(16));
  assert.equal(runs[at + 1].options.stage, `${prefix}-attention-bf16`);
  assert.match(runs[at + 1].kernel.code, /values\[i\] = round_bf16\(values\[i\]\)/);
  assert.equal(runs[at + 1].kernel.bindings[0].resource, kernel.bindings[3].resource);
  assert.equal(runs[at + 2].options.stage, `${prefix}-output`);
  assert.equal(runs[at + 2].kernel.bindings[0].resource, kernel.bindings[3].resource);
}
assert.ok(!uploads.some(row => row.tensor === projected || row.tensor === modulation));
const params = uploads.filter(row => row.tensor.usage & U.uniform).map(row => row.tensor);
adapter.dispose();
assert.ok(params.every(t => t.destroyed));
assert.ok(!projected.destroyed && !modulation.destroyed && !adapter.outputs.hidden.destroyed);
shared.dispose();
assert.ok(adapter.outputs.hidden.destroyed);
console.log('Tiled self/cross layout, BF16 handoff, tail coverage, route identity and resource custody pass. Fake runtime: no native arithmetic or speed claim.');
