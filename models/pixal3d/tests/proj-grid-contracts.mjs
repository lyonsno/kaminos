import assert from 'node:assert/strict';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import {
  PIXAL3D_CROP_SCALE,
  PIXAL3D_DEFAULT_FOV_RAD,
  computePixal3dDistanceFromFov,
  buildPixal3dProjGridPlan,
  projectPixal3dGridCpu,
  createPixal3dProjGridAdapter,
} from '../proj-grid.js';

// 1. Camera distance from FOV matches generate_pixal3d.py / upstream inference.py.
assert.equal(PIXAL3D_CROP_SCALE, 1.1);
const dDefault = computePixal3dDistanceFromFov({
  cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
  meshScale: 1.0,
  imageResolution: 512,
});
assert.ok(Math.abs(dDefault - 1.0937500142266299) <= 1e-12, `unexpected default distance: ${dDefault}`);

const dCrop = computePixal3dDistanceFromFov({
  cameraAngleX: 0.5023482854328188,
  meshScale: 1.0 / PIXAL3D_CROP_SCALE,
  imageResolution: 512,
});
assert.ok(Math.abs(dCrop - 2.143472404833187) <= 1e-12, `unexpected crop distance: ${dCrop}`);

for (const bad of [
  { cameraAngleX: 0 },
  { cameraAngleX: Math.PI },
  { cameraAngleX: -0.5 },
  { cameraAngleX: NaN },
  { meshScale: 0 },
  { meshScale: -1 },
  { imageResolution: 0 },
  { extendPixel: Infinity },
]) {
  assert.throws(() => computePixal3dDistanceFromFov(bad));
}

// 2. Plan validation for dense 16^3 SS and sparse LR/HR SLat projection.
const ssPlan = buildPixal3dProjGridPlan({
  gridResolution: 16,
  imageResolution: 512,
  featureHeight: 32,
  featureWidth: 32,
  channels: 1024,
  prefixTokens: 5,
});
assert.equal(ssPlan.rows, 4096);
assert.equal(ssPlan.outChannels, 1024);
assert.deepEqual(ssPlan.globalShape, [5, 1024]);
assert.deepEqual(ssPlan.projectedShape, [4096, 1024]);
assert.deepEqual(ssPlan.stages, ['pixal3d-global-conditioning', 'pixal3d-proj-grid-sample']);

const slatPlan = buildPixal3dProjGridPlan({
  gridResolution: 64,
  imageResolution: 1024,
  featureHeight: 32,
  featureWidth: 32,
  channels: 1024,
  highResFeatureHeight: 512,
  highResFeatureWidth: 512,
  highResChannels: 1024,
  tokenRows: 7,
  prefixTokens: 5,
});
assert.equal(slatPlan.rows, 7);
assert.equal(slatPlan.outChannels, 2048);
assert.deepEqual(slatPlan.projectedShape, [7, 2048]);

for (const bad of [
  { gridResolution: 1 },
  { imageResolution: 0 },
  { featureHeight: 0 },
  { channels: 0 },
  { tokenRows: 0 },
  { prefixTokens: -1 },
]) {
  assert.throws(() => buildPixal3dProjGridPlan(bad));
}

// 3. Deterministic 2^3 projection + bilinear sample matches pinned MLX ProjGrid output.
const fmap2 = Float32Array.from({ length: 4 * 4 * 3 }, (_, i) => i / 48.0);
const expected2 = [
  [0.7273240089416504, 0.7481570243835449, 0.7689899802207947],
  [0.75, 0.7708330154418945, 0.7916669845581055],
  [0.04104899987578392, 0.06188200041651726, 0.08271600306034088],
  [0.0, 0.020833000540733337, 0.04166699945926666],
  [0.8988919854164124, 0.9197260141372681, 0.9405590295791626],
  [0.9375, 0.9583330154418945, 0.9791669845581055],
  [0.21261799335479736, 0.2334509938955307, 0.25428399443626404],
  [0.1875, 0.20833300054073334, 0.22916699945926666],
].flat();

const cpuOut = projectPixal3dGridCpu({
  features: fmap2,
  gridResolution: 2,
  imageResolution: 512,
  featureHeight: 4,
  featureWidth: 4,
  channels: 3,
  prefixTokens: 0,
  cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
  distance: dDefault,
  meshScale: 1.0,
});
assert.equal(cpuOut.projected.length, 24);
for (let i = 0; i < expected2.length; i++) {
  assert.ok(
    Math.abs(cpuOut.projected[i] - expected2[i]) <= 1e-6,
    `mismatch at ${i}: got ${cpuOut.projected[i]} vs ${expected2[i]}`,
  );
}

// 4. Direct sparse-coordinate projection equals full-grid projection indexed by coords.
const coords = new Int32Array([0, 0, 1, 1, 0, 0, 1, 1, 1]);
const sparseOut = projectPixal3dGridCpu({
  features: fmap2,
  gridResolution: 2,
  imageResolution: 512,
  featureHeight: 4,
  featureWidth: 4,
  channels: 3,
  prefixTokens: 0,
  coordinates: coords,
  cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
  distance: dDefault,
  meshScale: 1.0,
});
const expectedIndices = [1, 4, 7];
for (let row = 0; row < 3; row++) {
  const fullRow = cpuOut.projected.subarray(expectedIndices[row] * 3, (expectedIndices[row] + 1) * 3);
  const sparseRow = sparseOut.projected.subarray(row * 3, (row + 1) * 3);
  assert.deepEqual([...sparseRow], [...fullRow]);
}

// 5. Resident WebGPU adapter custody, dispatch, and numerical parity with LR + HR features.
const prefixTokens = 2;
const condData = Float32Array.from({ length: (prefixTokens + 4 * 4) * 3 }, (_, i) =>
  i < prefixTokens * 3 ? -(i + 1) : (i - prefixTokens * 3) / 48.0,
);
const hrBchw = Float32Array.from({ length: 2 * 4 * 4 }, (_, i) => (i + 1) / 32.0);
const allocated = [], uploads = [], dispatches = [];
const runtime = {
  device: { limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 } },
  createTensor(spec) {
    const count = spec.shape.reduce((a, b) => a * b, 1);
    const t = {
      ...spec,
      byteLength: count * 4,
      data: spec.dtype === 'i32' ? new Int32Array(count) : new Float32Array(count),
      buffer: { destroy() { t.destroyed = true; } },
    };
    allocated.push(t);
    return t;
  },
  uploadTensor(tensor, values) {
    uploads.push({ tensor, values: values.slice() });
    tensor.data.set(values);
  },
  defineComputeKernel(spec) {
    const shaderBindings = [...spec.code.matchAll(/@binding\((\d+)\)/g)].map(m => Number(m[1]));
    assert.deepEqual(
      shaderBindings,
      spec.bindings.map((_, i) => i),
      `shader @binding indices must match host bindings for ${spec.name}`,
    );
    return spec;
  },
  async runKernel(kernel, options) {
    dispatches.push({ kernel, options });
  },
  readTensor() {
    assert.fail('Serving projection adapter must not read back GPU tensors.');
  },
};

const conditioningTensor = runtime.createTensor({
  name: 'dino.conditioning',
  shape: [1, prefixTokens + 16, 3],
  dtype: 'f32',
  usage: U.storage,
});
conditioningTensor.data.set(condData);
const highResTensor = runtime.createTensor({
  name: 'naf.highres',
  shape: [1, 2, 4, 4],
  dtype: 'f32',
  usage: U.storage,
});
highResTensor.data.set(hrBchw);
const coordinateTensor = runtime.createTensor({
  name: 'occupancy.coords',
  shape: [3, 3],
  dtype: 'i32',
  usage: U.storage,
});
coordinateTensor.data.set(coords);
const producerSet = new Set([conditioningTensor, highResTensor, coordinateTensor]);

// 5a. Dense ProjGrid adapter (no tokenRows, no highRes) must generate 3 bindings without coords.
{
  const denseAdapter = createPixal3dProjGridAdapter({
    route: { runtime, routeId: 'pixal3d-dense-test' },
    config: {
      gridResolution: 2,
      imageResolution: 512,
      featureHeight: 4,
      featureWidth: 4,
      channels: 3,
      prefixTokens,
    },
    conditioningTensor,
  });
  assert.equal(denseAdapter.plan.tokenRows, null);
  await denseAdapter.run({ cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD, distance: dDefault, meshScale: 1.0 });
  const sampleKernel = dispatches.find(d => d.options.stage === 'pixal3d-proj-grid-sample').kernel;
  assert.equal(sampleKernel.bindings.length, 3);
  assert.doesNotMatch(sampleKernel.code, /\bcoords\b/);
  denseAdapter.dispose();
  dispatches.length = 0;
}

const adapter = createPixal3dProjGridAdapter({
  route: { runtime, routeId: 'pixal3d-test' },
  config: {
    gridResolution: 2,
    imageResolution: 512,
    featureHeight: 4,
    featureWidth: 4,
    channels: 3,
    highResFeatureHeight: 4,
    highResFeatureWidth: 4,
    highResChannels: 2,
    tokenRows: 3,
    prefixTokens,
  },
  conditioningTensor,
  highResTensor,
  coordinateTensor,
});

const invocation = { jobId: 'proj-grid-job' };
const outputs = await adapter.run(
  { cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD, distance: dDefault, meshScale: 1.0 },
  invocation,
);
assert.equal(outputs.globalConditioning, adapter.outputs.globalConditioning);
assert.equal(outputs.projectedConditioning, adapter.outputs.projectedConditioning);
assert.deepEqual(outputs.globalConditioning.shape, [2, 3]);
assert.deepEqual(outputs.projectedConditioning.shape, [3, 5]);
assert.deepEqual(dispatches.map(d => d.options.stage), adapter.plan.stages);
assert.ok(dispatches.every(d => d.options.schedulerInvocation === invocation));

adapter.dispose();
assert.ok(allocated.filter(t => !producerSet.has(t)).every(t => t.destroyed));
assert.ok([...producerSet].every(t => !t.destroyed));
await assert.rejects(() => adapter.run({ cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD }), /disposed/);

console.log('Pixal3D ProjGrid camera distance, dense/sparse 3D-to-2D bilinear projection, and GPU custody pass.');
