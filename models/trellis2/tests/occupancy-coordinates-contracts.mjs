import assert from 'node:assert/strict';
import * as decoderModule from '../sparse-decoder.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';

assert.equal(typeof decoderModule.createTrellisOccupancyCoordinatesAdapter, 'function',
  'The actual resident decoder needs a consumer producing source-ordered occupied coordinates, not a CPU logits artifact.');
const { createTrellisOccupancyCoordinatesAdapter, buildOccupancyCoordinatesPlan } = decoderModule;
const full = buildOccupancyCoordinatesPlan();
assert.deepEqual(full.inputShape, [1, 1, 64, 64, 64]);
assert.equal(full.candidateRows, 32768);
assert.equal(full.metadataReadbackBytes, 4);
assert.equal(full.coordinateOrder, 'z-y-x-lexicographic');
for (const bad of [0, 3, 1.5]) assert.throws(() => buildOccupancyCoordinatesPlan({ resolution: bad }), /resolution/);
const plan = decoderModule.buildSparseDecoderPlan({ resolution: 2, latentChannels: 2, channels: [4, 2],
  numResBlocks: 1, numResBlocksMiddle: 1 });
const weights = Object.fromEntries(Object.entries(decoderModule.sparseDecoderWeightShapes(plan)).map(([name, shape]) =>
  [name, new Float32Array(shape.reduce((a, b) => a * b, 1))]));
const allocations = [], runs = [], uploads = [], reads = [];
let reportedCount = 7, failStage;
const runtime = { device: { limits: { maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupsPerDimension: 65535 } },
  createTensor(spec) { const t = { ...spec, byteLength: spec.shape.reduce((a, b) => a * b, 4),
    buffer: spec.buffer ?? { destroy() { t.destroyed = true; } } }; allocations.push(t); return t; },
  uploadTensor(t, data) { uploads.push({ t, data }); }, defineComputeKernel(spec) { return spec; },
  async runKernel(kernel, options) { runs.push({ kernel, options }); if (options.stage === failStage) throw Error('injected coordinate dispatch failure'); },
  async readTensor(t) { reads.push(t); assert.equal(t.dtype, 'u32'); assert.equal(t.byteLength, 4);
    return new Uint32Array([reportedCount]); } };
const route = { runtime, routeId: 'resident-decoder-coordinate-contract' };
const latent = runtime.createTensor({ name: 'sampler-owned-final-latent', shape: plan.inputShape, dtype: 'f32', usage: U.storage });
const decoder = decoderModule.createTrellisSparseDecoderAdapter({ route, config: plan, weights, sampleTensor: latent });
const coordinates = createTrellisOccupancyCoordinatesAdapter({ route, resolution: 4, logitsTensor: decoder.outputs.logits });
await assert.rejects(coordinates.coordinates(), /not.*completed|uninitialized/);
const invocation = { id: 'one-sampler-decoder-coordinate-session' };
await decoder.run({}, invocation); await coordinates.run(invocation);
const tensor = await coordinates.coordinates();
assert.deepEqual(tensor.shape, [7, 3]); assert.equal(tensor.dtype, 'i32'); assert.equal(tensor.byteLength, 84);
assert.strictEqual(tensor.buffer, coordinates.outputs.coordinateCapacity.buffer);
assert.ok(runs.every(r => r.options.schedulerInvocation === invocation));
const downsample = runs.find(r => r.options.stage === 'occupancy-max-any');
assert.strictEqual(downsample.kernel.bindings[0].resource, decoder.outputs.logits);
assert.match(downsample.kernel.code, /logits\[.*\] > 0\.0/);
const compact = runs.find(r => r.options.stage === 'occupancy-coordinate-compact');
assert.match(compact.kernel.code, /i < 8u/);
assert.deepEqual(compact.options.dispatch, [1, 1, 1]);
assert.equal(reads.length, 1, 'Only row count metadata crosses CPU; not latent, logits or coordinates.');
assert.strictEqual(await coordinates.coordinates(), tensor); assert.equal(reads.length, 1);
assert.ok(!uploads.some(r => r.t === latent || r.t === decoder.outputs.logits || r.t === coordinates.outputs.coordinateCapacity));
coordinates.dispose(); assert.ok(!decoder.outputs.logits.destroyed && !latent.destroyed);
decoder.dispose(); assert.ok(!latent.destroyed);

const logits = runtime.createTensor({ name: 'caller-owned-logits', shape: [1, 1, 4, 4, 4], dtype: 'f32', usage: U.storage });
const empty = createTrellisOccupancyCoordinatesAdapter({ route, resolution: 4, logitsTensor: logits });
reportedCount = 0; await empty.run(invocation); await assert.rejects(empty.coordinates(), /no occupied/);
reportedCount = 9; await empty.run(invocation); await assert.rejects(empty.coordinates(), /count.*capacity/);
reportedCount = 7; failStage = 'occupancy-coordinate-compact';
await assert.rejects(empty.run(invocation), /injected/);
await assert.rejects(empty.coordinates(), /not.*completed|uninitialized/);
empty.dispose(); assert.ok(!logits.destroyed);
assert.throws(() => createTrellisOccupancyCoordinatesAdapter({ route, resolution: 4,
  logitsTensor: { ...logits, dtype: 'f16' } }), /complete.*F32/);
console.log('Actual decoder output is borrowed into source threshold/max-any/lexicographic compaction; only4-byte count metadata crosses CPU. Fake runtime does not establish GPU coordinate values.');
