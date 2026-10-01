import assert from 'node:assert/strict';
import * as decoder from '../sparse-decoder.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';

assert.equal(typeof decoder.buildSLatDecoderPlan, 'function',
  'Learned shape codes need the actual sparse geometry/material decoder, not occupied cubes or MLX serving.');
const { buildSLatDecoderPlan, slatDecoderWeightShapes, createTrellisSLatDecoderAdapter } = decoder;
const full = buildSLatDecoderPlan({ tokenRows: 1728 });
assert.deepEqual(full.channels, [1024, 512, 256, 128, 64]);
assert.deepEqual(full.numBlocks, [4, 16, 8, 4, 0]);
assert.equal(full.outputResolution, 512);
assert.equal(full.arithmetic, 'semantic-f16-torso-f32-endpoints');
assert.equal(full.coordinateOrder, 'parent-row-then-child-z-bit0-y-bit1-x-bit2');
assert.equal(full.subdivisionLevels, 4);
assert.equal(full.mode, 'shape');
assert.equal(buildSLatDecoderPlan({ tokenRows: 6978, resolution: 64 }).outputResolution, 1024);
const tex = buildSLatDecoderPlan({ tokenRows: 1728, mode: 'texture' });
assert.equal(tex.outChannels, 6);
assert.ok(!Object.keys(slatDecoderWeightShapes(tex)).some(n => n.includes('to_subdiv')));
for (const config of [{ tokenRows: 0 }, { tokenRows: 1, channels: [12, 8], numBlocks: [1, 0] },
  { tokenRows: 1, mode: 'mesh-cubes' }, { tokenRows: 1, channels: [16, 8], numBlocks: [1] }])
  assert.throws(() => buildSLatDecoderPlan(config), /rows|tokenRows|channels|blocks|mode/i);

const config = { tokenRows: 3, latentChannels: 2, resolution: 2, channels: [16, 8], numBlocks: [1, 0] };
function harness(count = 5) {
  const allocations = [], uploads = [], runs = [], reads = []; let failure;
  const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 },
    queue: { async onSubmittedWorkDone() {} } },
    createTensor(spec) { const t = { ...spec, byteLength: spec.shape.reduce((a, b) => a * b, 4),
      buffer: spec.buffer ?? { destroy() { t.destroyed = true; } } }; allocations.push(t); return t; },
    uploadTensor(t, values) { uploads.push({ t, values }); }, defineComputeKernel(spec) { return spec; },
    async runKernel(kernel, options) { runs.push({ kernel, options }); if (options.stage === failure) throw Error('injected decoder failure'); },
    async readTensor(t) { reads.push(t); assert.equal(t.dtype, 'u32'); assert.equal(t.byteLength, 4);
      return new Uint32Array([t.name.includes('hash-status') ? 0 : count]); } };
  const route = { runtime, routeId: 'local-sparse-decoder-contract' };
  const sample = runtime.createTensor({ name: 'shape-owned-codes', shape: [3, 2], dtype: 'f32', usage: U.storage });
  const coordinates = runtime.createTensor({ name: 'shape-owned-coordinates', shape: [3, 3], dtype: 'i32', usage: U.storage });
  const plan = buildSLatDecoderPlan(config), weights = Object.fromEntries(Object.entries(slatDecoderWeightShapes(plan))
    .map(([name, shape]) => [name, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
  const siluTable = new Float32Array(65536);
  return { runtime, route, sample, coordinates, weights, siluTable, allocations, uploads, runs, reads,
    fail(stage) { failure = stage; } };
}
const h = harness(), adapter = createTrellisSLatDecoderAdapter({ route: h.route, config, weights: h.weights,
  siluTable: h.siluTable, sampleTensor: h.sample, coordinateTensor: h.coordinates });
assert.strictEqual(adapter.inputs.sample, h.sample);
assert.strictEqual(adapter.inputs.coordinates, h.coordinates);
assert.equal(adapter.outputs.features, undefined, 'Dynamic output must not pretend to exist before decoding.');
const invocation = { id: 'one-resident-sparse-decoder' }, result = await adapter.run(invocation);
assert.deepEqual(result.features.shape, [5, 7]);
assert.deepEqual(result.coordinates.shape, [5, 3]);
assert.equal(result.subdivisions.length, 1);
assert.equal(result.metadataReadbackBytes, 12);
assert.equal(result.convolutionsExecuted, 3);
assert.equal(result.convNeXtBlocksExecuted, 1);
assert.ok(h.runs.every(r => r.options.schedulerInvocation === invocation));
for (const r of h.runs) if (r.options.stage === 'decoder-silu') {
  assert.equal(new Set(r.kernel.bindings.map(b => b.resource.buffer)).size, r.kernel.bindings.length,
    'In-place SiLU must have one writable storage binding, not alias it through a second read-only binding.');
}
assert.equal(h.reads.length, 3, 'Only hash-validation words and learned child-count metadata cross CPU during serving.');
assert.ok(!h.uploads.some(r => r.t === h.sample || r.t === h.coordinates));
assert.match(h.runs.find(r => r.options.stage === 'decoder-neighbors').kernel.code, /offset\/9u/);
assert.match(h.runs.find(r => r.options.stage === 'decoder-sparse-conv').kernel.code, /round_f16\(sum\)/,
  'Source sparse convolution rounds every per-neighbor dot to FP16 before the accumulated FP16 add.');
assert.match(h.runs.find(r => r.options.stage === 'decoder-subdivision-scatter').kernel.code, /child%2u/);
assert.match(h.runs.find(r => r.options.stage === 'decoder-subdivision-scatter').kernel.code, /col\/4u/,
  'Skip repeats each source channel, not the complete vector.');
assert.equal(adapter.outputs.features, result.features);
await assert.rejects(adapter.run(invocation), /single|completed/);
adapter.dispose(); adapter.dispose();
assert.ok(!h.sample.destroyed && !h.coordinates.destroyed);
assert.ok(h.allocations.filter(t => t !== h.sample && t !== h.coordinates).every(t => t.destroyed));

for (const count of [0, 25]) {
  const x = harness(count), a = createTrellisSLatDecoderAdapter({ route: x.route, config, weights: x.weights,
    siluTable: x.siluTable, sampleTensor: x.sample, coordinateTensor: x.coordinates });
  await assert.rejects(a.run(invocation), /empty|count.*capacity/);
  assert.equal(a.outputs.features, undefined, 'Partial/empty failed decode must not publish a replacement output.');
  await assert.rejects(a.run(invocation), /failed|poison/); a.dispose();
}
const bad = harness();
assert.throws(() => createTrellisSLatDecoderAdapter({ route: bad.route, config, weights: bad.weights,
  sampleTensor: bad.sample, coordinateTensor: bad.coordinates }), /SiLU|silu/);
assert.throws(() => createTrellisSLatDecoderAdapter({ route: bad.route, config, weights: bad.weights,
  siluTable: bad.siluTable, sampleTensor: { ...bad.sample, dtype: 'f16' }, coordinateTensor: bad.coordinates }), /F32|f32/);
console.log('Full learned sparse-decoder geometry, source FP16/child order, resident handoff, dynamic counts and poisoned failure contracts pass; fake runtime is not numerical conformance.');
