import assert from 'node:assert/strict';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { buildSparseBlockPlan, sparseBlockWeightShapes } from '../sparse-block.js';
import { createTrellisSLatFlowAdapter } from '../slat-flow.js';

const config = { tokenRows: 6000, channels: 24, heads: 12, contextRows: 7,
  contextChannels: 5, hidden: 20, frequencyDim: 6, numBlocks: 1 };
const p = buildSparseBlockPlan(config), c = p.channels, limit = 65535, runs = [];
const arrays = shapes => Object.fromEntries(Object.entries(shapes).map(([key, shape]) =>
  [key, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
const weights = { prefix: arrays({ 'input.weight': [c, 32], 'input.bias': [c], 'time0.weight': [c, 6],
  'time0.bias': [c], 'time2.weight': [c, c], 'time2.bias': [c], 'mod.weight': [6 * c, c], 'mod.bias': [6 * c] }),
  blocks: [arrays({ ...sparseBlockWeightShapes(p), gelu: [65536] })],
  terminal: { weight: new Float32Array(32 * c), bias: new Float32Array(32) } };
const runtime = { device: { limits: { maxStorageBufferBindingSize: 268435456, maxComputeWorkgroupsPerDimension: limit } },
  createTensor(spec) { return { ...spec, byteLength: spec.shape.reduce((a, b) => a * b, 4), buffer: { destroy() {} } }; },
  uploadTensor() {}, defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) {
    assert.ok(options.dispatch.every(n => n <= limit), `${options.stage} dispatch ${options.dispatch} exceeds effective limit ${limit}`);
    runs.push({ kernel, options });
  } };
const route = { runtime, routeId: 'actual-slat-dispatch-contract' };
const sample = runtime.createTensor({ name: 'borrowed-noise', shape: [6000, 32], dtype: 'f32', usage: U.storage });
const flow = createTrellisSLatFlowAdapter({ route, config, weights, sampleTensor: sample,
  conditioning: new Float32Array(35), coordinates: new Int32Array(6000 * 3) });
await flow.run({ timestep: 1000 }, { id: 'all-token-heads' });
for (const { kernel, options } of runs.filter(r => /^(self|cross)-[qk]-norm$/.test(r.options.stage))) {
  const expectedRows = options.stage === 'cross-k-norm' ? 7 * 12 : 6000 * 12;
  assert.match(kernel.code, /row = wid\.x \+ wid\.y \* grid\.x/);
  assert.match(kernel.code, new RegExp(`row >= ${expectedRows}u`), 'Padded last dispatch row must be guarded before barriers.');
  const covered = new Uint8Array(expectedRows), [x, y, z] = options.dispatch;
  assert.equal(z, 1);
  for (let iy = 0; iy < y; iy++) for (let ix = 0; ix < x; ix++) {
    const row = ix + iy * x; if (row < expectedRows) covered[row]++;
  }
  assert.ok(covered.every(n => n === 1), 'All token/head rows must be covered exactly once, with no cap or repeated normalization.');
}
assert.equal(runs.filter(r => /^(self|cross)-[qk]-norm$/.test(r.options.stage)).length, 4);
flow.dispose();
console.log('Production SLat flow covers all 72000 head rows within effective dispatch dimensions; dense storage policy is unchanged. Fake runtime establishes addressing/dispatch, not GPU arithmetic.');
