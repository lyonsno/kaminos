import assert from 'node:assert/strict';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { buildSparseBlockPlan, sparseBlockWeightShapes } from '../sparse-block.js';
import { createTrellisSLatFlowAdapter } from '../slat-flow.js';
import { createTrellisSLatSamplerAdapter } from '../slat-sampler.js';

const config = { tokenRows: 5, channels: 24, heads: 3, contextRows: 7,
  contextChannels: 5, hidden: 20, frequencyDim: 6, numBlocks: 1, steps: 3 };
const plan = buildSparseBlockPlan(config), c = plan.channels;
const prefixShapes = { 'input.weight': [c, 32], 'input.bias': [c], 'time0.weight': [c, 6],
  'time0.bias': [c], 'time2.weight': [c, c], 'time2.bias': [c], 'mod.weight': [6 * c, c], 'mod.bias': [6 * c] };
const arrays = shapes => Object.fromEntries(Object.entries(shapes).map(([key, shape]) =>
  [key, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
const weights = { prefix: arrays(prefixShapes), blocks: [arrays({ ...sparseBlockWeightShapes(plan), gelu: [65536] })],
  terminal: { weight: new Float32Array(32 * c), bias: new Float32Array(32) } };
const allocated = [], uploads = [], runs = [];
let failureStage;
const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728 } },
  createTensor(spec) { const t = { ...spec, byteLength: spec.shape.reduce((a, b) => a * b, 4),
    buffer: { destroy() { t.destroyed = true; } } }; allocated.push(t); return t; },
  uploadTensor(t, data) { uploads.push({ t, data }); }, defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) {
    runs.push({ kernel, options });
    if (options.stage === failureStage) { failureStage = undefined; throw new Error('injected dispatch failure'); }
  }, readTensor() { assert.fail('composed serving flow/sampler must not read sample bytes back'); } };
const route = { runtime, routeId: 'composed-resident-slat-contract' };
const sample = runtime.createTensor({ name: 'producer-owned-noise', shape: [5, 32], dtype: 'f32', usage: U.storage });
const flow = createTrellisSLatFlowAdapter({ route, config, weights, sampleTensor: sample,
  coordinates: new Int32Array(15), conditioning: new Float32Array(35) });
const options = { route, flow, config, conditioning: new Float32Array(35), initialSampleTensor: sample };
const sampler = createTrellisSLatSamplerAdapter(options), invocation = { id: 'one-resident-composition' };
// The pre-fix production flow accepts this borrowed tensor, but its production
// sampler rejects run() and also rejects the alternative CPU reupload route.
const result = await sampler.run({}, invocation);
assert.equal(result.stepsExecuted, 3);
assert.strictEqual(result.sample, sample);
assert.ok(runs.every(r => r.options.schedulerInvocation === invocation));
const updates = runs.filter(r => r.options.stage === 'sampler-euler-update');
assert.equal(updates.length, 3);
assert.ok(updates.every(r => r.kernel.bindings.at(-1).resource === sample));
assert.ok(!uploads.some(r => r.t === sample), 'Resident initialization and recurrence must not reupload caller noise.');
await assert.rejects(sampler.run({}, invocation), /next step/);
sampler.dispose(); assert.ok(!sample.destroyed);

const unrelated = runtime.createTensor({ name: 'unrelated-noise', shape: [5, 32], dtype: 'f32', usage: U.storage });
assert.throws(() => createTrellisSLatSamplerAdapter({ ...options, initialSampleTensor: unrelated }), /initial.*sample.*same|initial.*sample.*flow/i);
assert.throws(() => createTrellisSLatSamplerAdapter({ ...options, initialStepIndex: 3 }), /initial.*step/i);
const failed = createTrellisSLatSamplerAdapter(options);
failureStage = 'self-qkv';
await assert.rejects(failed.step({}, invocation), /injected dispatch failure/);
await assert.rejects(failed.step({}, invocation), /failed dispatch.*fresh sample/);
await assert.rejects(failed.run({}, invocation), /failed dispatch.*fresh sample/);
await assert.rejects(failed.run({ sample: new Float32Array(160) }, invocation), /borrowed/);
await assert.rejects(failed.step({}, invocation), /failed dispatch.*fresh sample/,
  'An unsuccessful CPU replacement must not clear poisoned resident state.');
failed.dispose();
// A failed sampler has no implicit reset. The producer must restore initialized
// GPU state and explicitly construct a new sampler admitting that exact tensor.
await runtime.runKernel({ name: 'caller-noise-producer', bindings: [{ resource: sample }] },
  { stage: 'caller-initializes-noise', schedulerInvocation: invocation });
const restarted = createTrellisSLatSamplerAdapter(options);
assert.equal((await restarted.run({}, invocation)).stepsExecuted, 3);
restarted.dispose(); flow.dispose();
assert.ok(!sample.destroyed && !unrelated.destroyed, 'Disposal must preserve borrowed producer buffers.');
assert.ok(allocated.filter(t => t !== sample && t !== unrelated).every(t => t.destroyed));
console.log('Actual flow + sampler admit identical resident noise without CPU bytes, preserve recurrence and poisoned failure, and release only owned buffers. Fake runtime is not numerical evidence.');
