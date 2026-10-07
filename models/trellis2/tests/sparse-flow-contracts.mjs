import assert from 'node:assert/strict';
import * as flow from '../sparse-flow.js';
import { buildSparseBlockPlan, sparseBlockWeightShapes } from '../sparse-block.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';

assert.equal(typeof flow.createTrellisSparseFlowAdapter, 'function',
  'Missing complete resident sparse-flow stack and F32 terminal prediction head.');
const config = { resolution: 2, inChannels: 2, outChannels: 3, channels: 12, heads: 3,
  contextRows: 7, contextChannels: 5, hidden: 20, frequencyDim: 6, numBlocks: 3 };
const allocations = [], uploads = [], runs = [];
const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728 } },
  createTensor(spec) { const t = { ...spec, byteLength: spec.shape.reduce((a,b)=>a*b,4),
    buffer: { destroy() { t.destroyed = true; } } }; allocations.push(t); return t; },
  uploadTensor(t, data) { uploads.push({ t, data }); }, defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); },
  readTensor() { assert.fail('serving forward must not read tensors back'); } };
const plan = buildSparseBlockPlan(config);
const prefixSizes = { 'input.weight': 24, 'input.bias': 12, 'time0.weight': 72, 'time0.bias': 12,
  'time2.weight': 144, 'time2.bias': 12, 'mod.weight': 864, 'mod.bias': 72 };
const prefix = Object.fromEntries(Object.entries(prefixSizes).map(([k,n])=>[k,new Float32Array(n)]));
const blocks = Array.from({length:3},()=>Object.fromEntries(Object.entries({ ...sparseBlockWeightShapes(plan), gelu: [65536] })
  .map(([k,shape])=>[k,new Float32Array(shape.reduce((a,b)=>a*b,1))])));
const weights = { prefix, blocks, terminal: { weight: new Float32Array(36), bias: new Float32Array(3) } };
const sample = runtime.createTensor({ name: 'sampler-owned-state', shape: [1,2,2,2,2], dtype: 'f32',
  usage: U.storage | U.copyDst | U.copySrc });
const adapter = flow.createTrellisSparseFlowAdapter({ route:{runtime}, config, weights, sampleTensor:sample,
  conditioning:new Float32Array(35), phases:new Float32Array(32) });
assert.deepEqual(adapter.outputs.prediction.shape,[1,3,2,2,2]);
assert.equal(adapter.outputs.prediction.dtype,'f32');
const invocation = { id:'one-resident-forward' };
const result = await adapter.run({ timestep:1000 }, invocation);
assert.strictEqual(result.prediction,adapter.outputs.prediction);
assert.equal(result.blocksExecuted,3);
assert.equal(runs.length,7+3*plan.stages.length+2);
assert.ok(runs.every(r=>r.options.schedulerInvocation===invocation));
const selfNorm = runs.filter(r=>r.options.stage==='self-layernorm');
assert.equal(selfNorm.length,3);
assert.strictEqual(selfNorm[1].kernel.bindings[0].resource,selfNorm[2].kernel.bindings[0].resource);
assert.equal(allocations.filter(t=>t.name==='trellis.block.shared.after_mlp').length,1);
assert.ok(!uploads.some(r=>r.t===sample),'borrowed sampler state must not be CPU-reuploaded');
const terminal = runs.at(-2).kernel;
assert.match(terminal.code,/0\.00001/,'terminal LayerNorm uses source epsilon1e-5');
assert.doesNotMatch(terminal.code,/round_bf16/,'terminal output stays F32');
assert.match(runs.at(-1).kernel.code,/output\[col \* 8u \+ row\]/,'terminal output is NCDHW, not token-major');
await adapter.run({ timestep:900, conditioning:new Float32Array(35).fill(1.00390625) },invocation);
const contexts=uploads.filter(r=>r.t.name==='trellis.block.shared.conditioning');
assert.equal(contexts.length,2); assert.ok(contexts.at(-1).data.every(x=>x===1),'source conditioning casts to BF16');
await assert.rejects(adapter.run({sample:new Float32Array(16),timestep:900},invocation),/borrowed/);
const active=adapter.run({timestep:800},invocation);
await assert.rejects(adapter.run({timestep:700},invocation),/in use/);
assert.throws(()=>adapter.dispose(),/in use/); await active;
const execute=runtime.runKernel; runtime.runKernel=async()=>{throw new Error('dispatch failure');};
await assert.rejects(adapter.run({timestep:600},invocation),/dispatch failure/);
runtime.runKernel=execute; await adapter.run({timestep:500},invocation);
adapter.dispose();adapter.dispose(); assert.ok(!sample.destroyed,'sampler owns its state');
assert.ok(allocations.filter(t=>t!==sample).every(t=>t.destroyed));
await assert.rejects(adapter.run({timestep:400},invocation),/disposed/);
assert.throws(()=>flow.createTrellisSparseFlowAdapter({route:{runtime},config,weights:{...weights,blocks:blocks.slice(0,2)},
  conditioning:new Float32Array(35),phases:new Float32Array(32)}),/complete.*block/);
assert.equal(flow.buildSparseFlowPlan().numBlocks,30,'real model must not be capped to diagnostic blocks');
console.log('Complete configurable resident stack, shared activation lifetime, borrowed sampler state, CFG conditioning reuse and F32 terminal head pass; fake runtime is not numeric evidence.');
