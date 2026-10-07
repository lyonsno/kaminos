import assert from 'node:assert/strict';
const { buildSparseBlockPlan, sparseBlockWeightShapes, createTrellisSparseBlockAdapter,
  createTrellisSparseBlockWorkspace } = await import('../sparse-block.js');

const config = { resolution: 2, channels: 12, heads: 3, contextChannels: 5, contextRows: 7, hidden: 20 };
const plan = buildSparseBlockPlan(config), resources = [], uploads = [], runs = [];
const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728 } },
  createTensor(spec) { const t = { ...spec, buffer: { destroy() { t.destroyed = true; } } }; resources.push(t); return t; },
  uploadTensor(tensor) { uploads.push(tensor); }, defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); }, readTensor() { assert.fail('no inter-block CPU readback'); } };
const route = { runtime }, conditioning = new Float32Array(35), phases = new Float32Array(32);
assert.equal(typeof createTrellisSparseBlockWorkspace, 'function', 'Missing shared sparse-block activation/conditioning lifetime.');
const shared = createTrellisSparseBlockWorkspace({ route, config, conditioning, phases });
const weights = Object.fromEntries(Object.entries(sparseBlockWeightShapes(plan)).map(([name, shape]) =>
  [name, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
weights.gelu = new Float32Array(65536);
const projected = runtime.createTensor({ name: 'producer', shape: [8, 12], dtype: 'f32' });
const modulation = runtime.createTensor({ name: 'modulation', shape: [1, 72], dtype: 'f32' });
const first = createTrellisSparseBlockAdapter({ route, config, weights, inputs: { projected, modulation }, workspace: shared });
const allocationAfterFirst = resources.length;
const second = createTrellisSparseBlockAdapter({ route, config, weights,
  inputs: { projected: first.outputs.hidden, modulation }, workspace: shared });
assert.equal(resources.length - allocationAfterFirst, Object.keys(weights).length, 'Another block may allocate only its weights, not another activation/conditioning set.');
assert.equal(uploads.filter(t => t === shared.conditioning).length, 1);
assert.equal(uploads.filter(t => t === shared.phases).length, 1);
assert.equal(second.outputs.hidden, first.outputs.hidden, 'Exit storage is reused after the previous hidden state is consumed.');
for (const key of Object.keys(first.diagnostics)) assert.equal(first.diagnostics[key], second.diagnostics[key]);
const invocation = { id: 'serialized-consumer-job' };
await first.run(invocation); await second.run(invocation);
assert.equal(runs.length, plan.stages.length * 2);
assert.ok(runs.every(row => row.options.schedulerInvocation === invocation));
const secondRuns = runs.slice(plan.stages.length);
assert.ok(secondRuns.some(row => row.options.stage === 'self-layernorm' && row.kernel.bindings[0].resource === first.outputs.hidden));
assert.ok(secondRuns.some(row => row.options.stage === 'self-residual' && row.kernel.bindings[0].resource === first.outputs.hidden));
assert.ok(!uploads.includes(first.outputs.hidden) && !uploads.includes(projected) && !uploads.includes(modulation));
assert.throws(() => createTrellisSparseBlockAdapter({ route: { runtime: { ...runtime } }, config, weights,
  inputs: { projected, modulation }, workspace: shared }), /workspace.*runtime/);
assert.throws(() => createTrellisSparseBlockAdapter({ route, config: { ...config, heads: 2 }, weights,
  inputs: { projected, modulation }, workspace: shared }), /workspace.*configuration/);
const active = second.run(invocation);
await assert.rejects(first.run(invocation), /workspace.*in use/);
assert.throws(() => shared.dispose(), /in use/);
assert.throws(() => second.dispose(), /in use/);
await active;
const execute = runtime.runKernel;
runtime.runKernel = async () => { throw new Error('dispatch failure'); };
await assert.rejects(first.run(invocation), /dispatch failure/);
runtime.runKernel = execute;
await second.run(invocation); // Failure must release the workspace lease.
first.dispose(); second.dispose();
assert.ok(!shared.conditioning.destroyed && !shared.phases.destroyed && !first.outputs.hidden.destroyed);
assert.ok(!projected.destroyed && !modulation.destroyed);
shared.dispose(); shared.dispose();
assert.ok(first.outputs.hidden.destroyed && shared.conditioning.destroyed && shared.phases.destroyed);
await assert.rejects(second.run(invocation), /disposed/);
assert.throws(() => createTrellisSparseBlockAdapter({ route, config, weights, inputs: { projected, modulation }, workspace: shared }), /workspace.*disposed/);
console.log('Serialized two-adapter handoff reuses activations, preserves producer/weight custody, uploads common inputs once, and rejects concurrent use. Fake runtime: not native numerical evidence.');
