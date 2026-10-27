import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import { roundBfloat16 } from '../../trellis2/sparse-prefix.js';

const source = new URL('../pixal3d-block.js', import.meta.url);
assert.ok(existsSync(source), 'Missing Pixal3D projection-modulated block implementation.');
const {
  PIXAL3D_BLOCK_ROUTE,
  PIXAL3D_BLOCK_CHECKPOINT_SUFFIXES,
  buildPixal3dBlockPlan,
  pixal3dBlockWeightShapes,
  runPixal3dCrossProjLinearCpu,
  createPixal3dBlockWorkspace,
  createPixal3dBlockAdapter,
} = await import(source);

assert.equal(PIXAL3D_BLOCK_ROUTE, 'pixal3d.proj-modulated-block.webgpu.v0');

// 1. Default dense SS block plan: 16^3 rows = 4096, contextRows = 5, projInChannels = 1024
const ssPlan = buildPixal3dBlockPlan();
assert.equal(ssPlan.rows, 4096);
assert.equal(ssPlan.channels, 1536);
assert.equal(ssPlan.heads, 12);
assert.equal(ssPlan.headDim, 128);
assert.equal(ssPlan.contextRows, 5);
assert.equal(ssPlan.contextChannels, 1024);
assert.equal(ssPlan.projInChannels, 1024);
assert.equal(ssPlan.hidden, 8192);
assert.deepEqual(ssPlan.outputShape, [4096, 1536]);
assert.deepEqual(ssPlan.projectedConditioningShape, [4096, 1024]);
assert.ok(ssPlan.stages.includes('cross-proj-linear'));
assert.equal(
  ssPlan.stages.indexOf('cross-proj-linear'),
  ssPlan.stages.indexOf('cross-output') + 1,
  'cross-proj-linear must execute immediately after cross-output and before cross-residual',
);
assert.equal(
  ssPlan.stages.indexOf('cross-residual'),
  ssPlan.stages.indexOf('cross-proj-linear') + 1,
);

// 2. Sparse SLat block plan: tokenRows -> default projInChannels = 2048
const slatPlan = buildPixal3dBlockPlan({ tokenRows: 250 });
assert.equal(slatPlan.rows, 250);
assert.equal(slatPlan.contextRows, 5);
assert.equal(slatPlan.projInChannels, 2048);
assert.deepEqual(slatPlan.outputShape, [250, 1536]);
assert.deepEqual(slatPlan.projectedConditioningShape, [250, 2048]);

// Weight shapes include cross.proj.weight and cross.proj.bias
const ssShapes = pixal3dBlockWeightShapes(ssPlan);
assert.deepEqual(ssShapes['cross.proj.weight'], [1536, 1024]);
assert.deepEqual(ssShapes['cross.proj.bias'], [1536]);
const slatShapes = pixal3dBlockWeightShapes(slatPlan);
assert.deepEqual(slatShapes['cross.proj.weight'], [1536, 2048]);
assert.deepEqual(slatShapes['cross.proj.bias'], [1536]);
assert.equal(PIXAL3D_BLOCK_CHECKPOINT_SUFFIXES['cross.proj.weight'], 'cross_attn.proj_linear.weight');
assert.equal(PIXAL3D_BLOCK_CHECKPOINT_SUFFIXES['cross.proj.bias'], 'cross_attn.proj_linear.bias');
assert.equal(PIXAL3D_BLOCK_CHECKPOINT_SUFFIXES['cross.q.weight'], 'cross_attn.cross_attn_block.to_q.weight');

// Validation checks
assert.throws(() => buildPixal3dBlockPlan({ channels: 1536, heads: 11 }), /divisible/);
assert.throws(() => buildPixal3dBlockPlan({ projInChannels: 0 }), /projInChannels/);

// 3. Fake runtime tests for resource custody, stage sequence, resident workspace, and polarity switching
const small = buildPixal3dBlockPlan({
  resolution: 2,
  channels: 12,
  heads: 3,
  contextChannels: 6,
  contextRows: 5,
  projInChannels: 8,
  hidden: 20,
});
const weights = Object.fromEntries(
  Object.entries(pixal3dBlockWeightShapes(small)).map(([name, shape]) => [
    name,
    new Float32Array(shape.reduce((a, b) => a * b, 1)).fill(0.01),
  ]),
);
weights.gelu = new Float32Array(65536);

const resources = [], runs = [], uploads = [];
const runtime = {
  device: { limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 } },
  createTensor(spec) {
    const byteLength = spec.shape.reduce((a, b) => a * b, 4);
    const tensor = {
      ...spec,
      byteLength,
      usage: spec.usage ?? (U.storage | U.copyDst | U.copySrc),
      buffer: { destroy() { tensor.destroyed = true; } },
    };
    resources.push(tensor);
    return tensor;
  },
  uploadTensor(tensor, values) { uploads.push({ tensor, values }); },
  defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); },
  readTensor() { assert.fail('Serving block must not read back any tensor.'); },
};

const projected = runtime.createTensor({ name: 'producer.projected', shape: [8, 12], dtype: 'f32' });
const modulation = runtime.createTensor({ name: 'producer.modulation', shape: [1, 72], dtype: 'f32' });
const globalCond = runtime.createTensor({ name: 'producer.globalCond', shape: [5, 6], dtype: 'f32' });
const projCond = runtime.createTensor({ name: 'producer.projCond', shape: [8, 8], dtype: 'f32' });
const phaseTensor = runtime.createTensor({ name: 'producer.phases', shape: [8, 2, 2], dtype: 'f32' });
const producerResources = new Set(resources);

const workspace = createPixal3dBlockWorkspace({
  route: { runtime },
  config: small,
  conditioningTensor: globalCond,
  projectedConditioningTensor: projCond,
  phaseTensor,
});
const adapter = createPixal3dBlockAdapter({
  route: { runtime },
  config: small,
  weights,
  inputs: { projected, modulation },
  workspace,
});

const invocation = { id: 'pixal3d-block-job' };
await workspace.prepareConditioning(false, invocation);
assert.equal(runs.at(-1).options.stage, 'flow-resident-conditioning-bf16');
runs.length = 0;

const output = await adapter.run(invocation);
assert.ok(output.hidden.buffer);
assert.deepEqual(output.hidden.shape, [8, 12]);
assert.deepEqual(runs.map(row => row.options.stage), adapter.plan.stages);
assert.ok(runs.every(row => row.options.schedulerInvocation === invocation));
assert.ok(!runs.some(row => /var<[^>]+>\s+shared\b/.test(row.kernel.code)));

// Check negative conditioning polarity preparation
await workspace.prepareConditioning(true, invocation);
assert.equal(runs.at(-1).options.stage, 'flow-resident-negative-zero');

adapter.dispose();
workspace.dispose();
assert.ok(resources.filter(t => !producerResources.has(t)).every(t => t.destroyed));
assert.ok([...producerResources].every(t => !t.destroyed), 'Consumer must not destroy producer buffers.');

// 4. Numerical verification of runPixal3dCrossProjLinearCpu (positive and negative conditioning)
const c = 4, projIn = 6, rows = 3;
const tinyPlan = buildPixal3dBlockPlan({
  tokenRows: rows,
  channels: c,
  heads: 2,
  contextChannels: 4,
  contextRows: 5,
  projInChannels: projIn,
  hidden: 8,
});
const projContext = Float32Array.from({ length: rows * projIn }, (_, i) => roundBfloat16((i - 8) * 0.125));
const projWeight = Float32Array.from({ length: c * projIn }, (_, i) => roundBfloat16(((i % 7) - 3) * 0.1));
const projBias = Float32Array.from({ length: c }, (_, i) => roundBfloat16((i - 1.5) * 0.25));
const crossOut = Float32Array.from({ length: rows * c }, (_, i) => roundBfloat16((i + 1) * 0.05));

const posActual = runPixal3dCrossProjLinearCpu({
  plan: tinyPlan,
  projectedConditioning: projContext,
  weight: projWeight,
  bias: projBias,
  crossOut,
  zeroConditioning: false,
});
const negActual = runPixal3dCrossProjLinearCpu({
  plan: tinyPlan,
  projectedConditioning: projContext,
  weight: projWeight,
  bias: projBias,
  crossOut,
  zeroConditioning: true,
});
const negFromZeros = runPixal3dCrossProjLinearCpu({
  plan: tinyPlan,
  projectedConditioning: new Float32Array(rows * projIn),
  weight: projWeight,
  bias: projBias,
  crossOut,
  zeroConditioning: false,
});
assert.deepEqual(negActual, negFromZeros, 'zeroConditioning polarity must match zeroed projectedConditioning');
for (let r = 0; r < rows; r++) {
  for (let col = 0; col < c; col++) {
    const expectedNeg = roundBfloat16(Math.fround(roundBfloat16(projBias[col]) + crossOut[r * c + col]));
    assert.equal(negActual[r * c + col], expectedNeg);
  }
}
assert.notDeepEqual(posActual, negActual);

console.log('pixal3d-block-contracts.mjs: PASS');
