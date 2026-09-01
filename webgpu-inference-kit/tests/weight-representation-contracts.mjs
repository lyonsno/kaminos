import assert from 'node:assert/strict';

import {
  createWebGpuWeightRepresentationPlan,
  packFp16WeightsToU32,
} from '../src/index.js';

const native = createWebGpuWeightRepresentationPlan({
  sourceDtype: 'fp16',
  elementCount: 8_388_608,
  candidates: ['f16-native', 'f16-packed-u32'],
  adapterFeatures: ['shader-f16'],
});

assert.equal(native.schema, 'kaminos.webgpu-weight-representation-plan.v0');
assert.equal(native.requestedCandidates[0], 'f16-native');
assert.equal(native.effectiveRepresentation, 'f16-native');
assert.deepEqual(native.requiredFeatures, ['shader-f16']);
assert.equal(native.sourceByteLength, 16_777_216);
assert.equal(native.storageByteLength, 16_777_216);
assert.equal(native.expandedFp32ByteLength, 33_554_432);
assert.equal(native.savedVsExpandedFp32ByteLength, 16_777_216);
assert.equal(native.accumulatorDtype, 'fp32');
assert.equal(native.valueLoadOperation, 'wgsl-f16-load-cast-f32');

const portable = createWebGpuWeightRepresentationPlan({
  sourceDtype: 'fp16',
  elementCount: 5,
  candidates: ['f16-native', 'f16-packed-u32'],
  adapterFeatures: [],
});

assert.equal(portable.effectiveRepresentation, 'f16-packed-u32');
assert.deepEqual(portable.requiredFeatures, []);
assert.equal(portable.sourceByteLength, 10);
assert.equal(portable.storageByteLength, 12);
assert.equal(portable.expandedFp32ByteLength, 20);
assert.equal(portable.savedVsExpandedFp32ByteLength, 8);
assert.equal(portable.valueLoadOperation, 'wgsl-unpack2x16float');
assert.deepEqual(portable.rejectedCandidates, [{
  representation: 'f16-native',
  reason: 'missing-adapter-feature:shader-f16',
}]);

const words = packFp16WeightsToU32(new Uint16Array([
  0x3c00,
  0xc000,
  0x3555,
  0x7bff,
  0x0001,
]));
assert.ok(words instanceof Uint32Array);
assert.deepEqual([...words], [0xc0003c00, 0x7bff3555, 0x00000001]);

assert.throws(
  () => createWebGpuWeightRepresentationPlan({
    sourceDtype: 'fp16',
    elementCount: 8,
    candidates: ['f16-native'],
    adapterFeatures: [],
  }),
  /no requested weight representation is supported/,
);

assert.throws(
  () => createWebGpuWeightRepresentationPlan({
    sourceDtype: 'fp16',
    elementCount: 8,
    candidates: ['f32-expanded'],
    adapterFeatures: [],
    maxStorageByteLength: 16,
  }),
  /exceeds maxStorageByteLength/,
);

assert.throws(
  () => createWebGpuWeightRepresentationPlan({
    sourceDtype: 'fp16',
    elementCount: 8,
    candidates: ['fp8-native'],
    adapterFeatures: ['shader-f16'],
  }),
  /unsupported weight representation/,
);

assert.throws(
  () => packFp16WeightsToU32(new Float32Array([1, 2])),
  /Uint16Array/,
);

console.log('weight representation contracts passed');
