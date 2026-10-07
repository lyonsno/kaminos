import assert from 'node:assert/strict';
import { buildSparseSamplerPlan, createTrellisSparseSamplerAdapter } from '../sparse-sampler.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { buildSLatSamplerPlan, createTrellisSLatSamplerAdapter } from '../slat-sampler.js';

assert.deepEqual(buildSparseSamplerPlan({ tokenRows: 5 }).shape, [5, 32],
  'SLat sampler must update all actual token rows, not an unrelated fixed dense state.');
const config = { tokenRows: 5, steps: 3, guidanceStrength: 7.5, guidanceRescale: 0.5, rescaleT: 3 };
const plan = buildSparseSamplerPlan(config);
assert.equal(plan.elements, 160);
assert.equal(plan.stdAlgorithm, 'source-sparse-token-population-moment-row-tree-segment');
assert.equal(buildSparseSamplerPlan().elements, 32768);
assert.match(buildSparseSamplerPlan().stdAlgorithm, /welford/);
assert.equal(buildSLatSamplerPlan({ tokenRows: 5 }).guidanceRescale, 0.5);
assert.equal(buildSLatSamplerPlan({ tokenRows: 5 }).rescaleT, 3);
assert.equal(buildSLatSamplerPlan({ tokenRows: 5, mode: 'texture' }).guidanceStrength, 1);
assert.equal(buildSLatSamplerPlan({ tokenRows: 5, mode: 'texture' }).guidanceRescale, 0);
assert.deepEqual(buildSLatSamplerPlan({ tokenRows: 5, mode: 'texture' }).guidanceInterval, [0.6, 0.9]);
assert.throws(() => buildSLatSamplerPlan({ tokenRows: 5, mode: 'other' }), /mode/);
const runs = [], uploads = [], calls = [], allocated = [];
const runtime = { device: { limits: { maxComputeWorkgroupsPerDimension: 65535 } },
  createTensor(spec) { const t = { ...spec, byteLength: spec.shape.reduce((a, b) => a * b, 4),
    buffer: { destroy() { t.destroyed = true; } } }; allocated.push(t); return t; },
  uploadTensor(t, data) { uploads.push({ t, data }); }, defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); },
  readTensor() { assert.fail('SLat sampler must stay resident'); } };
const sample = runtime.createTensor({ shape: [5, 32], dtype: 'f32', usage: U.storage });
const prediction = runtime.createTensor({ shape: [5, 32], dtype: 'f32', usage: U.storage });
const route = { runtime, routeId: 'slat-resident-contract' }, invocation = { id: 'one-slat-schedule' };
const flow = { runtime, routeId: route.routeId, plan: { block: { contextRows: 3, contextChannels: 4 } },
  inputs: { sample }, outputs: { prediction }, async run(input, inv) { calls.push({ input, inv }); } };
assert.throws(() => createTrellisSLatSamplerAdapter({ route, flow, config, conditioning: new Float32Array(12) }), /geometry/);
const sampler = createTrellisSparseSamplerAdapter({ route, flow, config, conditioning: new Float32Array(12) });
const result = await sampler.run({ sample: new Float32Array(160) }, invocation);
assert.equal(result.stepsExecuted, 3);
assert.equal(result.modelCalls, plan.steps.reduce((n, step) => n + (step.guided ? 2 : 1), 0));
assert.ok(calls.every(call => call.inv === invocation));
assert.ok(calls.slice(1).every(call => call.input.sample === undefined), 'Only initial noise crosses CPU.');
assert.ok(runs.every(r => r.options.schedulerInvocation === invocation));
assert.ok(runs.every(r => !r.kernel.code.includes('32768u')), 'No dense-state tail may shadow sparse caller geometry.');
const std = runs.find(r => r.options.stage === 'sampler-guidance-std').kernel.code;
assert.match(std, /row < 5u/); assert.match(std, /mean2 - mean \* mean/);
assert.doesNotMatch(std, /counts\[0\]-1\.0/, 'SparseTensor std is population, not dense Bessel correction.');
assert.ok(!uploads.some(r => r.t === sample || r.t === prediction));
sampler.dispose(); assert.ok(!sample.destroyed && !prediction.destroyed);
assert.ok(allocated.filter(t => t !== sample && t !== prediction).every(t => t.destroyed));
assert.throws(() => createTrellisSparseSamplerAdapter({ route, flow, config: { ...config, tokenRows: 6 },
  conditioning: new Float32Array(12) }), /resident/);
console.log('SLat complete schedule, actual row count, source population-std law and resident recurrence pass; fake runtime does not establish GPU numeric conformance.');
