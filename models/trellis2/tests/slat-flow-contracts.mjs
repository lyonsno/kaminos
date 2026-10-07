import assert from 'node:assert/strict';
import { buildSparseFlowPlan } from '../sparse-flow.js';
import { buildSparseBlockPlan, sparseBlockWeightShapes } from '../sparse-block.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';

const config = { tokenRows: 5, channels: 24, heads: 3, contextRows: 7,
  contextChannels: 5, hidden: 20, frequencyDim: 6, numBlocks: 3 };
assert.deepEqual(buildSparseFlowPlan({ ...config, inChannels: 32, outChannels: 32 }).prefix.inputShape, [5, 32],
  'Sparse SLat rows must not be silently expanded into the dense 16-cubed input.');
assert.equal(buildSparseBlockPlan(config).rows, 5, 'The complete torso must consume the actual sparse token count.');
const { buildSLatFlowPlan, createTrellisSLatFlowAdapter } = await import('../slat-flow.js');
assert.equal(buildSLatFlowPlan({ tokenRows: 3436 }).flow.numBlocks, 30);
assert.deepEqual(buildSLatFlowPlan({ tokenRows: 3436 }).outputShape, [3436, 32]);
assert.throws(() => buildSLatFlowPlan({ tokenRows: 0 }), /tokenRows/);
assert.throws(() => buildSLatFlowPlan({ tokenRows: 2.5 }), /tokenRows/);
assert.throws(() => buildSLatFlowPlan({ tokenRows: 5, mode: 'unverified' }), /mode/);
assert.equal(buildSparseFlowPlan().block.rows, 4096, 'Dense structure route stays unchanged.');
assert.deepEqual(buildSparseFlowPlan().outputShape, [1, 8, 16, 16, 16]);

function harness() {
  const allocations = [], uploads = [], runs = [];
  const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728 } },
    createTensor(spec) { const t = { ...spec, byteLength: spec.shape.reduce((a, b) => a * b, 4),
      buffer: { destroy() { t.destroyed = true; } } }; allocations.push(t); return t; },
    uploadTensor(t, data) { uploads.push({ t, data }); }, defineComputeKernel(spec) { return spec; },
    async runKernel(kernel, options) { runs.push({ kernel, options }); },
    readTensor() { assert.fail('serving SLat flow must not read model tensors back'); } };
  return { runtime, allocations, uploads, runs, route: { runtime, routeId: 'slat-contract' } };
}
function makeWeights(mode) {
  const p = buildSparseBlockPlan(config), input = mode === 'texture' ? 64 : 32, c = p.channels;
  const sizes = { 'input.weight': c * input, 'input.bias': c, 'time0.weight': c * 6, 'time0.bias': c,
    'time2.weight': c * c, 'time2.bias': c, 'mod.weight': 6 * c * c, 'mod.bias': 6 * c };
  return { prefix: Object.fromEntries(Object.entries(sizes).map(([key, n]) => [key, new Float32Array(n)])),
    blocks: Array.from({ length: 3 }, () => Object.fromEntries(Object.entries({ ...sparseBlockWeightShapes(p), gelu: [65536] })
      .map(([key, shape]) => [key, new Float32Array(shape.reduce((a, b) => a * b, 1))]))),
    terminal: { weight: new Float32Array(32 * c), bias: new Float32Array(32) } };
}
const coordinates = new Int32Array([0, 0, 0, 1, 2, 3, 4, 5, 6, 31, 0, 7, 8, 9, 10]);
for (const mode of ['shape', 'texture']) {
  const h = harness(), sample = h.runtime.createTensor({ name: 'sampler-owned-slat', shape: [5, 32], dtype: 'f32', usage: U.storage });
  const concat = mode === 'texture' ? h.runtime.createTensor({ name: 'shape-owned-slat', shape: [5, 32], dtype: 'f32', usage: U.storage }) : undefined;
  const adapter = createTrellisSLatFlowAdapter({ route: h.route, config: { ...config, mode }, weights: makeWeights(mode),
    conditioning: new Float32Array(35), coordinates, sampleTensor: sample, concatTensor: concat });
  assert.strictEqual(adapter.inputs.sample, sample);
  assert.deepEqual(adapter.outputs.prediction.shape, [5, 32]);
  const invocation = { id: 'one-composed-slat-forward' }, result = await adapter.run({ timestep: 1000 }, invocation);
  assert.equal(result.blocksExecuted, 3);
  assert.strictEqual(result.prediction, adapter.outputs.prediction);
  assert.ok(h.runs.every(r => r.options.schedulerInvocation === invocation));
  const phaseRuns = h.runs.filter(r => r.options.stage === 'slat-coordinate-rope');
  assert.equal(phaseRuns.length, 1);
  assert.match(phaseRuns[0].kernel.code, /coordinates\[row \* 3u \+ axis\]/, 'Source coordinate order is z,y,x.');
  assert.match(h.runs.find(r => r.options.stage === 'noise-input-projection').kernel.code,
    /noise\[row \* 32u \+ k\]|noise\[row \* 64u \+ k\]/, 'Input projection is token-major.');
  assert.match(h.runs.at(-1).kernel.code, /output\[row \* 32u \+ col\]/, 'Terminal prediction is token-major.');
  if (concat) {
    const packed = h.runs.find(r => r.options.stage === 'slat-texture-concat');
    assert.strictEqual(packed.kernel.bindings[0].resource, sample);
    assert.strictEqual(packed.kernel.bindings[1].resource, concat);
    assert.match(packed.kernel.code, /input_sample\[row \* 32u \+ ch\]/);
  }
  assert.ok(!h.uploads.some(r => r.t === sample || r.t === concat), 'Borrowed model/sampler tensors must not cross CPU bytes.');
  await adapter.run({ timestep: 900 }, invocation);
  assert.equal(h.runs.filter(r => r.options.stage === 'slat-coordinate-rope').length, 1, 'Fixed coordinate phases are resident across timesteps.');
  await assert.rejects(adapter.run({ sample: new Float32Array(160), timestep: 800 }, invocation), /borrowed/);
  const active = adapter.run({ timestep: 700 }, invocation);
  await assert.rejects(adapter.run({ timestep: 600 }, invocation), /in use/);
  assert.throws(() => adapter.dispose(), /in use/); await active;
  adapter.dispose(); adapter.dispose();
  assert.ok(!sample.destroyed && !concat?.destroyed);
  assert.ok(h.allocations.filter(t => t !== sample && t !== concat).every(t => t.destroyed));
}
const h = harness();
assert.throws(() => createTrellisSLatFlowAdapter({ route: h.route, config, weights: makeWeights('shape'),
  conditioning: new Float32Array(35), coordinates: coordinates.slice(0, -1) }), /coordinates/);
console.log('Sparse row geometry, source coordinate order, complete torso, texture GPU concat, resident phases and borrowed lifetime pass; fake runtime is not numerical evidence.');
