import assert from 'node:assert/strict';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
import {
  nattenWindowIndices,
  buildPixal3dNafPlan,
  pixal3dNafWeightShapes,
  runPixal3dNafCpu,
  createPixal3dNafAdapter,
} from '../naf.js';

// 1. NATTEN dilated window indices with inward-shifted border windows.
const idx8_3_2 = nattenWindowIndices(8, 3, 2);
assert.deepEqual(
  [...idx8_3_2],
  [
    [0, 2, 4],
    [1, 3, 5],
    [0, 2, 4],
    [1, 3, 5],
    [2, 4, 6],
    [3, 5, 7],
    [2, 4, 6],
    [3, 5, 7],
  ].flat(),
);
// Every row has 3 distinct in-bounds indices in its dilation group.
for (let r = 0; r < 8; r++) {
  const row = [...idx8_3_2.subarray(r * 3, (r + 1) * 3)];
  assert.equal(new Set(row).size, 3);
  assert.ok(row.every(v => v >= 0 && v < 8 && v % 2 === r % 2));
}
assert.throws(() => nattenWindowIndices(5, 3, 2), /neighborhood kernel/);

// 2. Canonical NAF plan and 37-tensor checkpoint coverage (naf_release.safetensors).
const defaultPlan = buildPixal3dNafPlan();
assert.equal(defaultPlan.dim, 256);
assert.equal(defaultPlan.headsAttn, 4);
assert.equal(defaultPlan.headsRope, 4);
assert.equal(defaultPlan.kernelSize, 9);
assert.equal(defaultPlan.imgLayers, 2);
assert.equal(defaultPlan.numGroups, 8);
assert.deepEqual(defaultPlan.outputShape, [1, 1024, 512, 512]);
const shapes = pixal3dNafWeightShapes(defaultPlan);
assert.equal(Object.keys(shapes).length, 37);
assert.deepEqual(shapes['image_encoder.encoder.0.weight'], [128, 3, 1, 1]);
assert.deepEqual(shapes['image_encoder.sem_encoder.0.weight'], [128, 3, 3, 3]);
assert.deepEqual(shapes['image_encoder.sem_encoder.2.conv2.weight'], [128, 128, 3, 3]);
assert.deepEqual(shapes['image_encoder.rope.periods'], [16]);

for (const bad of [
  { dim: 15 },
  { dim: 256, headsAttn: 3 },
  { dim: 256, kernelSize: 4 },
  { dim: 256, outputHeight: 16, featureHeight: 32 },
]) {
  assert.throws(() => buildPixal3dNafPlan(bad));
}

// 3. Deterministic CPU reference matches MLX NAF (dim=16, heads=2, kernel=3, dilation=2).
const smallPlan = buildPixal3dNafPlan({
  dim: 16,
  headsAttn: 2,
  headsRope: 2,
  kernelSize: 3,
  imgLayers: 1,
  numGroups: 8,
  imageHeight: 6,
  imageWidth: 6,
  featureHeight: 3,
  featureWidth: 3,
  featureChannels: 4,
  outputHeight: 6,
  outputWidth: 6,
  prefixTokens: 0,
});
const smallShapes = pixal3dNafWeightShapes(smallPlan);
const weights = {};
for (const [idx, key] of Object.keys(smallShapes).sort().entries()) {
  const shape = smallShapes[key];
  const n = shape.reduce((a, b) => a * b, 1);
  const arr = Float32Array.from({ length: n }, (_, i) => (((i + 1 + idx * 7) % 19) - 9) / 16.0);
  if (key.endsWith('periods')) {
    for (let i = 0; i < n; i++) arr[i] = 100.0 ** ((2 * i) / (2 * n));
  } else if (key.includes('norm') && key.endsWith('weight')) {
    for (let i = 0; i < n; i++) arr[i] = 1.0 + arr[i] * 0.25;
  }
  weights[key] = arr;
}
const imageBchw = Float32Array.from({ length: 3 * 6 * 6 }, (_, i) => (i % 11) / 11.0);
const featuresBchw = Float32Array.from({ length: 4 * 3 * 3 }, (_, i) => ((i % 13) - 6) / 7.0);
const cpuOut = runPixal3dNafCpu({
  plan: smallPlan,
  weights,
  image: imageBchw,
  imageLayout: 'bchw',
  features: featuresBchw,
  featureLayout: 'bchw',
});
assert.equal(cpuOut.length, 4 * 6 * 6);
const expectedHead = [
  -0.355428010225296, -0.2820970118045807, -0.2735069990158081, -0.2932650148868561,
  -0.31249600648880005, -0.3044529855251312, -0.2918510138988495, -0.2757349908351898,
];
const expectedTail = [
  -0.11070600152015686, -0.0720050036907196, 0.002455000067129731, -0.15747299790382385,
  -0.3048959970474243, -0.03542700037360191, -0.12015999853610992, -0.17327700555324554,
];
for (let i = 0; i < 8; i++) {
  assert.ok(
    Math.abs(cpuOut[i] - expectedHead[i]) <= 2e-5,
    `NAF head mismatch at ${i}: got ${cpuOut[i]} vs ${expectedHead[i]}`,
  );
  const t = cpuOut.length - 8 + i;
  assert.ok(
    Math.abs(cpuOut[t] - expectedTail[i]) <= 2e-5,
    `NAF tail mismatch at ${t}: got ${cpuOut[t]} vs ${expectedTail[i]}`,
  );
}

// 4. WebGPU adapter custody, kernel stages, and buffer cleanup.
const allocated = [], dispatches = [];
const runtime = {
  device: { limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 } },
  createTensor(spec) {
    const count = spec.shape.reduce((a, b) => a * b, 1);
    const t = {
      ...spec,
      byteLength: count * 4,
      buffer: { destroy() { t.destroyed = true; } },
    };
    allocated.push(t);
    return t;
  },
  uploadTensor() {},
  defineComputeKernel(spec) {
    return spec;
  },
  async runKernel(kernel, options) {
    dispatches.push({ kernel, options });
  },
  readTensor() {
    assert.fail('Serving NAF adapter must not read back GPU tensors.');
  },
};
const imageTensor = runtime.createTensor({ name: 'image', shape: [1, 6, 6, 3], dtype: 'f32', usage: U.storage });
const condTensor = runtime.createTensor({ name: 'dino', shape: [1, 9, 4], dtype: 'f32', usage: U.storage });
const producerSet = new Set([imageTensor, condTensor]);

const adapter = createPixal3dNafAdapter({
  route: { runtime, routeId: 'naf-test' },
  config: smallPlan,
  weights,
  imageTensor,
  conditioningTensor: condTensor,
});
const invocation = { jobId: 'naf-job' };
const result = await adapter.run(invocation);
assert.equal(result.highResFeatures, adapter.outputs.highResFeatures);
assert.deepEqual(result.highResFeatures.shape, [1, 4, 6, 6]);
assert.deepEqual(dispatches.map(d => d.options.stage), adapter.plan.stages);
assert.ok(dispatches.every(d => d.options.schedulerInvocation === invocation));
assert.ok(
  dispatches.slice(0, -1).every(d => d.options.yieldAfter === false),
  'Intermediate NAF kernels must not yield individually.',
);
assert.equal(dispatches.at(-1).options.yieldAfter, true, 'Final NAF kernel must yield cooperatively.');
adapter.dispose();
assert.ok(allocated.filter(t => !producerSet.has(t)).every(t => t.destroyed));
assert.ok([...producerSet].every(t => !t.destroyed));

console.log('Pixal3D NAF NATTEN border windows, 37-tensor checkpoint coverage, MLX numerical parity, and GPU custody pass.');
