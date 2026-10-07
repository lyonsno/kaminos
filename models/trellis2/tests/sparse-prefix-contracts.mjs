import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleUrl = new URL('../sparse-prefix.js', import.meta.url);
const api = fs.existsSync(moduleUrl) ? await import(moduleUrl) : {};
assert.equal(typeof api.buildSparsePrefixPlan, 'function',
  'TRELLIS sparse prefix must have an executable plan for noise projection and timestep conditioning');
const plan = api.buildSparsePrefixPlan({ resolution: 16, inChannels: 8, channels: 1536, frequencyDim: 256 });
assert.deepEqual(plan.inputShape, [1, 8, 16, 16, 16]);
assert.deepEqual(plan.projectedShape, [4096, 1536]);
assert.deepEqual(plan.modulationShape, [1, 9216]);
assert.equal(plan.outputArithmetic, 'bf16-values-in-f32-storage');
assert.deepEqual(plan.stages, ['noise-input-projection', 'timestep-embedding', 'time-linear-0',
  'time-silu-0', 'time-linear-2', 'time-silu-1', 'shared-modulation']);
assert.deepEqual(api.buildSparsePrefixPlan({ resolution: 3, inChannels: 2, channels: 4,
  frequencyDim: 6 }).projectedShape, [27, 4]);
for (const config of [{ resolution: 0 }, { resolution: 1.5 }, { channels: -1 },
  { frequencyDim: 3 }, { frequencyDim: 0 }]) {
  assert.throws(() => api.buildSparsePrefixPlan(config), /positive integer|even/);
}
assert.throws(() => api.validateSparsePrefixWeights(plan, {}), /input.weight/);
assert.equal(api.roundBfloat16(1.00390625), 1);
assert.equal(api.roundBfloat16(1.01171875), 1.015625);
assert.equal(api.roundBfloat16(-1.00390625), -1);
assert.equal(api.roundBfloat16(0), 0);
const small = api.buildSparsePrefixPlan({ resolution: 2, inChannels: 2, channels: 4, frequencyDim: 6 });
const counts = { 'input.weight': 8, 'input.bias': 4, 'time0.weight': 24, 'time0.bias': 4,
  'time2.weight': 16, 'time2.bias': 4, 'mod.weight': 96, 'mod.bias': 24 };
const definitions = [], events = [];
const runtime = {
  createTensor(descriptor) { return { ...descriptor, buffer: { destroy() { events.push('destroy'); } } }; },
  uploadTensor() {},
  defineComputeKernel(definition) { definitions.push(definition); return definition; },
  async runKernel(kernel, options) { events.push(options.stage); },
};
const adapter = api.createTrellisSparsePrefixAdapter({ route: { runtime }, config: small,
  weights: Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, new Float32Array(count)])) });
for (const definition of definitions.filter(row => row.bindings[0].name === 'dims')) {
  assert.equal(definition.bindings[0].type, 'uniform', 'kit uniform bindings require type, not storage access');
}
const result = await adapter.run({ sample: new Float32Array(16), timestep: 1000 }, {});
assert.deepEqual(events, small.stages);
assert.strictEqual(result.projected, adapter.outputs.projected);
assert.strictEqual(result.modulation, adapter.outputs.modulation);
adapter.dispose(); const destroyed = events.length; adapter.dispose();
assert.equal(events.length, destroyed, 'disposal is idempotent');
await assert.rejects(() => adapter.run({ sample: new Float32Array(16), timestep: 1000 }), /disposed/);
console.log('TRELLIS sparse prefix shape, stage, precision, and weight contracts passed');
