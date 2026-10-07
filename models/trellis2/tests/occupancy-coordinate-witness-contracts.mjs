import assert from 'node:assert/strict';
import * as existing from '../sparse-decoder-witness-checks.js';
assert.equal(typeof existing.validateOccupancyCoordinateFixture, 'function', 'Native coordinate evidence needs source/config/type/hash admission.');
const { validateOccupancyCoordinateFixture, compareOccupancyCoordinates } = existing;
const h = 'a'.repeat(64), m = { schema: 'trellis2.occupancy-coordinate-reference.v0', status: 'succeeded', modelCalls: 0,
  referenceRoute: 'numpy-cpu-source-occupancy-coordinate-policy', config: { resolution: 4 },
  source: { commit: 'b'.repeat(40), dirty: '', 'generate.py': h }, producer: { commit: 'c'.repeat(40), dirty: '' },
  input: { decoderManifestSha256: h, logitsSha256: h }, coordinateOrder: 'z-y-x-lexicographic', threshold: 0,
  rows: 2, tensors: {} };
for (const [name, shape, dtype] of [['logits', [1, 1, 4, 4, 4], 'float32'], ['expected.coordinates', [2, 3], 'int32'], ['expected.flags', [8], 'uint32']]) {
  m.tensors[name] = { shape, dtype, file: name + '.bin', sha256: h, byteLength: shape.reduce((a, b) => a * b, 4) };
}
assert.equal(validateOccupancyCoordinateFixture(m).candidateRows, 8);
const mutate = f => { const x = structuredClone(m); f(x); assert.throws(() => validateOccupancyCoordinateFixture(x)); };
mutate(x => x.referenceRoute = 'unverified-projection'); mutate(x => x.threshold = -1);
mutate(x => x.rows = 0); mutate(x => x.coordinateOrder = 'x-y-z'); mutate(x => x.source.dirty = 'M generate.py');
mutate(x => x.tensors['expected.coordinates'].dtype = 'float32'); mutate(x => delete x.tensors.logits);
mutate(x => x.input.logitsSha256 = ''); mutate(x => x.tensors['expected.flags'].byteLength = 4);
validateOccupancyCoordinateFixture({ ...m, unrelatedAdditiveField: true });
assert.equal(compareOccupancyCoordinates(new Int32Array([0, 0, 0, 1, 1, 1]), new Int32Array([0, 0, 0, 1, 1, 1])).passed, true);
assert.equal(compareOccupancyCoordinates(new Int32Array([0, 0, 0]), new Int32Array([0, 0, 0, 1, 1, 1])).passed, false);
assert.equal(compareOccupancyCoordinates(new Int32Array([0, 0, 0, 1, 1, 0]), new Int32Array([0, 0, 0, 1, 1, 1])).passed, false);
assert.equal(compareOccupancyCoordinates(new Int32Array(), new Int32Array()).passed, false);
assert.throws(() => compareOccupancyCoordinates(new Float32Array([NaN]), new Int32Array([0])), /Int32/);
console.log('Coordinate witness rejects wrong route/source/precision/order/threshold, partial or blank proof and retains additive compatibility. Synthetic fixture is not external conformance.');
