import assert from 'node:assert/strict';

import {
  createWebGpuWeightRepresentationPlan,
  packFp16WeightsToU32,
} from '../src/index.js';

const portable = createWebGpuWeightRepresentationPlan({
  sourceDtype: 'fp16',
  elementCount: 5,
  candidates: ['f16-native', 'f16-packed-u32'],
  adapterFeatures: [],
});

assert.equal(portable.schema, 'kaminos.webgpu-weight-representation-plan.v0');
assert.equal(portable.effectiveRepresentation, 'f16-packed-u32');
assert.equal(portable.storageDtype, 'u32');
assert.equal(portable.storageByteLength, 12);
assert.equal(portable.expandedFp32ByteLength, 20);
assert.equal(portable.accumulatorDtype, 'fp32');
assert.equal(portable.valueLoadOperation, 'wgsl-unpack2x16float');

const words = packFp16WeightsToU32(new Uint16Array([
  0x3c00,
  0xc000,
  0x3555,
  0x7bff,
  0x0001,
]));
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

console.log('weight representation contracts passed');
