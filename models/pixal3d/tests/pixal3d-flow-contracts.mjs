import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { buildPixal3dBlockPlan, pixal3dBlockWeightShapes } from '../pixal3d-block.js';
import { createTrellisSparseSamplerAdapter } from '../../trellis2/sparse-sampler.js';
import { createTrellisSLatSamplerAdapter } from '../../trellis2/slat-sampler.js';

const source = new URL('../pixal3d-flow.js', import.meta.url);
assert.ok(existsSync(source), 'Missing Pixal3D sparse and SLat flow implementation.');
const {
  PIXAL3D_SPARSE_FLOW_ROUTE,
  PIXAL3D_SLAT_FLOW_ROUTE,
  buildPixal3dSparseFlowPlan,
  createPixal3dSparseFlowAdapter,
  createPixal3dSparseFlowAdapterAsync,
  buildPixal3dSLatFlowPlan,
  createPixal3dSLatFlowAdapter,
  createPixal3dSLatFlowAdapterAsync,
} = await import(source);

assert.equal(PIXAL3D_SPARSE_FLOW_ROUTE, 'pixal3d.sparse-flow.webgpu.v0');
assert.equal(PIXAL3D_SLAT_FLOW_ROUTE, 'pixal3d.slat-flow.webgpu.v0');

// 1. Default plans
const ssPlan = buildPixal3dSparseFlowPlan();
assert.equal(ssPlan.numBlocks, 30);
assert.equal(ssPlan.outChannels, 8);
assert.equal(ssPlan.block.rows, 4096);
assert.equal(ssPlan.block.contextRows, 5);
assert.equal(ssPlan.block.projInChannels, 1024);
assert.equal(ssPlan.terminalEpsilon, 1e-5);
assert.deepEqual(ssPlan.outputShape, [1, 8, 16, 16, 16]);

const slatPlan = buildPixal3dSLatFlowPlan({ tokenRows: 3436 });
assert.equal(slatPlan.flow.numBlocks, 30);
assert.equal(slatPlan.flow.block.rows, 3436);
assert.equal(slatPlan.flow.block.contextRows, 5);
assert.equal(slatPlan.flow.block.projInChannels, 2048);
assert.deepEqual(slatPlan.outputShape, [3436, 32]);
assert.throws(() => buildPixal3dSLatFlowPlan({ tokenRows: 0 }), /tokenRows/);
assert.throws(() => buildPixal3dSLatFlowPlan({ tokenRows: 5, mode: 'unknown' }), /mode/);

function makeHarness(routeId = 'pixal3d-flow-contract') {
  const allocations = [], uploads = [], runs = [];
  const runtime = {
    device: {
      limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 },
      queue: { async onSubmittedWorkDone() {} },
    },
    createTensor(spec) {
      const t = {
        ...spec,
        byteLength: spec.shape.reduce((a, b) => a * b, 4),
        usage: spec.usage ?? (U.storage | U.copyDst | U.copySrc),
        buffer: { destroy() { t.destroyed = true; } },
      };
      allocations.push(t);
      return t;
    },
    uploadTensor(t, data) { uploads.push({ t, data }); },
    defineComputeKernel(spec) { return spec; },
    async runKernel(kernel, options) { runs.push({ kernel, options }); },
    readTensor() { assert.fail('serving flow must not read tensors back'); },
  };
  return { runtime, allocations, uploads, runs, route: { runtime, routeId } };
}

function makeFlowWeights(config) {
  const blockPlan = buildPixal3dBlockPlan(config);
  const inCh = config.inChannels ?? 8;
  const outCh = config.outChannels ?? 8;
  const c = blockPlan.channels;
  const freqDim = config.frequencyDim ?? 256;
  const prefixSizes = {
    'input.weight': c * inCh,
    'input.bias': c,
    'time0.weight': c * freqDim,
    'time0.bias': c,
    'time2.weight': c * c,
    'time2.bias': c,
    'mod.weight': 6 * c * c,
    'mod.bias': 6 * c,
  };
  return {
    prefix: Object.fromEntries(Object.entries(prefixSizes).map(([k, n]) => [k, new Float32Array(n)])),
    blocks: Array.from({ length: config.numBlocks ?? 30 }, () =>
      Object.fromEntries(
        Object.entries({ ...pixal3dBlockWeightShapes(blockPlan), gelu: [65536] }).map(([k, shape]) => [
          k,
          new Float32Array(shape.reduce((a, b) => a * b, 1)),
        ]),
      ),
    ),
    terminal: { weight: new Float32Array(outCh * c), bias: new Float32Array(outCh) },
  };
}

// 2. Dense Sparse Structure Flow + Sampler Composition
{
  const h = makeHarness('ss-flow-test');
  const config = {
    resolution: 2,
    inChannels: 2,
    outChannels: 3,
    channels: 12,
    heads: 3,
    contextRows: 5,
    contextChannels: 6,
    projInChannels: 8,
    hidden: 20,
    frequencyDim: 6,
    numBlocks: 2,
  };
  const weights = makeFlowWeights(config);
  const sample = h.runtime.createTensor({ name: 'sampler-owned-state', shape: [1, 2, 2, 2, 2], dtype: 'f32' });
  const globalCond = h.runtime.createTensor({ name: 'global-cond', shape: [5, 6], dtype: 'f32' });
  const projCond = h.runtime.createTensor({ name: 'proj-cond', shape: [8, 8], dtype: 'f32' });
  const adapter = createPixal3dSparseFlowAdapter({
    route: h.route,
    config,
    weights,
    sampleTensor: sample,
    conditioningTensor: globalCond,
    projectedConditioningTensor: projCond,
    phases: new Float32Array(8 * 4),
  });
  assert.strictEqual(adapter.inputs.conditioning, globalCond);
  assert.strictEqual(adapter.inputs.projectedConditioning, projCond);
  assert.deepEqual(adapter.outputs.prediction.shape, [1, 3, 2, 2, 2]);
  const invocation = { id: 'ss-forward' };
  const result = await adapter.run({ timestep: 1000, zeroConditioning: false }, invocation);
  assert.equal(result.blocksExecuted, 2);
  assert.ok(h.runs.some(r => r.options.stage === 'cross-proj-linear'));
  assert.match(h.runs.at(-2).kernel.code, /0\.00001/, 'terminal LayerNorm uses eps=1e-5');
  assert.match(h.runs.at(-1).kernel.code, /output\[col \* 8u \+ row\]/, 'dense terminal output is NCDHW');
  adapter.dispose();
  assert.ok(!sample.destroyed && !globalCond.destroyed && !projCond.destroyed);
}

// 3. Sparse SLat Flow (shape & texture) + SLat Sampler Composition
const coordinates = new Int32Array([0, 0, 0, 1, 2, 3, 4, 5, 6, 31, 0, 7, 8, 9, 10]);
for (const mode of ['shape', 'texture']) {
  const h = makeHarness(`slat-${mode}-test`);
  const config = {
    tokenRows: 5,
    mode,
    channels: 24,
    heads: 3,
    contextRows: 5,
    contextChannels: 6,
    projInChannels: 10,
    hidden: 20,
    frequencyDim: 6,
    numBlocks: 2,
  };
  const flowPlan = buildPixal3dSLatFlowPlan(config);
  const weights = makeFlowWeights(flowPlan.flowConfig);
  const globalCond = h.runtime.createTensor({ name: 'global-cond', shape: [5, 6], dtype: 'f32' });
  const projCond = h.runtime.createTensor({ name: 'proj-cond', shape: [5, 10], dtype: 'f32' });
  const concat = mode === 'texture'
    ? h.runtime.createTensor({ name: 'shape-cond', shape: [5, 32], dtype: 'f32' })
    : undefined;

  const flow = await createPixal3dSLatFlowAdapterAsync({
    route: h.route,
    config,
    weights: { prefix: weights.prefix, terminal: weights.terminal },
    loadBlockWeights: async idx => weights.blocks[idx],
    conditioningTensor: globalCond,
    projectedConditioningTensor: projCond,
    coordinates,
    concatTensor: concat,
  });
  assert.strictEqual(flow.inputs.conditioning, globalCond);
  assert.strictEqual(flow.inputs.projectedConditioning, projCond);
  assert.deepEqual(flow.outputs.prediction.shape, [5, 32]);

  // Verify direct compatibility with createTrellisSLatSamplerAdapter
  const sampler = createTrellisSLatSamplerAdapter({
    route: h.route,
    flow,
    config: { tokenRows: 5, mode, steps: 2 },
    conditioningTensor: globalCond,
  });
  const invocation = { id: `slat-sampler-${mode}` };
  const sampleOut = await sampler.run({ sample: new Float32Array(5 * 32).fill(0.1) }, invocation);
  assert.equal(sampleOut.stepsExecuted, 2);
  flow.releaseParameters();
  sampler.dispose();
  flow.dispose();
}

console.log('pixal3d-flow-contracts.mjs: PASS');
