import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const source = new URL('../sparse-block.js', import.meta.url);
assert.ok(existsSync(source), 'Missing resident sparse transformer block implementation (128-wide heads, full grid).');
const { buildSparseBlockPlan, createTrellisSparseBlockAdapter, sparseBlockWeightShapes } = await import(source);
const plan = buildSparseBlockPlan();
assert.equal(plan.rows, 4096);
assert.equal(plan.headDim, 128);
assert.equal(plan.contextRows, 1029);
assert.equal(plan.hidden, 8192);
assert.equal(plan.scoresBytes, 4096 * 4096 * 4);
assert.equal(plan.hiddenBytes, 134217728);
assert.deepEqual(plan.outputShape, [4096, 1536]);
assert.throws(() => buildSparseBlockPlan({ channels: 1536, heads: 11 }), /divisible/);

// A fake runtime tests resource custody and composition, not WebGPU math.
const small = buildSparseBlockPlan({ resolution: 2, channels: 12, heads: 3, contextChannels: 5, contextRows: 7, hidden: 20 });
const weights = Object.fromEntries(Object.entries(sparseBlockWeightShapes(small)).map(([name, shape]) =>
  [name, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
weights.gelu = new Float32Array(65536);
const resources = [], runs = [], uploads = [];
const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728 } },
  createTensor(spec) { const tensor = { ...spec, buffer: { destroy() { tensor.destroyed = true; } } }; resources.push(tensor); return tensor; },
  uploadTensor(tensor, values) { uploads.push(tensor); },
  defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); },
  readTensor() { assert.fail('Serving block must not read back any tensor.'); } };
const projected = runtime.createTensor({ name: 'producer.projected', shape: [8, 12], dtype: 'f32' });
const modulation = runtime.createTensor({ name: 'producer.modulation', shape: [1, 72], dtype: 'f32' });
const producerResources = new Set(resources);
const adapter = createTrellisSparseBlockAdapter({ route: { runtime }, config: small, weights,
  inputs: { projected, modulation }, conditioning: new Float32Array(35), phases: new Float32Array(8 * 2 * 2) });
const invocation = { id: 'same-session-job' };
const output = await adapter.run(invocation);
assert.ok(output.hidden.buffer);
assert.deepEqual(output.hidden.shape, [8, 12]);
assert.deepEqual(runs.map(row => row.options.stage), adapter.plan.stages);
assert.ok(runs.every(row => row.options.schedulerInvocation === invocation));
assert.ok(runs.some(row => row.kernel.bindings.some(binding => binding.resource === projected)));
assert.ok(runs.some(row => row.kernel.bindings.some(binding => binding.resource === modulation)));
assert.ok(!uploads.includes(projected) && !uploads.includes(modulation), 'Prefix GPU inputs cannot be replaced with CPU uploads.');
adapter.dispose(); adapter.dispose();
assert.ok(resources.filter(tensor => !producerResources.has(tensor)).every(tensor => tensor.destroyed));
assert.ok(!projected.destroyed && !modulation.destroyed, 'Consumer cannot destroy producer buffers.');
await assert.rejects(adapter.run(invocation), /disposed/);
assert.throws(() => createTrellisSparseBlockAdapter({ route: { runtime }, weights, config: small,
  inputs: { projected: { ...projected, shape: [7, 12] }, modulation }, conditioning: new Float32Array(35),
  phases: new Float32Array(32) }), /projected/);
assert.throws(() => createTrellisSparseBlockAdapter({ route: { runtime: { ...runtime,
  device: { limits: { maxStorageBufferBindingSize: 1 } } } }, weights, config: small,
  inputs: { projected, modulation }, conditioning: new Float32Array(35), phases: new Float32Array(32) }), /binding capacity/);
console.log('Full-grid/head geometry, resident prefix consumption, scheduler custody and buffer lifecycle pass.');
