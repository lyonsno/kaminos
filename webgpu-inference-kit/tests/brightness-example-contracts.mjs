import assert from 'node:assert/strict';

import {
  normalizeBrightnessMultiplier,
  packRgbaPixels,
  unpackRgbaPixels,
} from '../examples/render-plus-inference.mjs';

assert.equal(normalizeBrightnessMultiplier(1.5), 1.5);
assert.equal(normalizeBrightnessMultiplier('0.5'), 0.5);
assert.throws(() => normalizeBrightnessMultiplier(0), /between 0.25 and 2/);
assert.throws(() => normalizeBrightnessMultiplier(2.5), /between 0.25 and 2/);
assert.throws(() => normalizeBrightnessMultiplier(Number.NaN), /finite/);

const source = new Uint8ClampedArray([
  40, 80, 120, 255,
  200, 240, 250, 128,
]);
const packed = packRgbaPixels(source);
assert.deepEqual([...packed], [
  0xff785028,
  0x80faf0c8,
]);
assert.deepEqual([...unpackRgbaPixels(packed)], [...source]);
assert.throws(() => packRgbaPixels(new Uint8Array([1, 2, 3])), /groups of four/);
for (const invalid of [new Uint16Array(4), new Float32Array(4), new DataView(new ArrayBuffer(4))]) {
  assert.throws(() => packRgbaPixels(invalid), /Uint8Array or Uint8ClampedArray/);
}
for (const ArrayType of [Uint8Array, Uint8ClampedArray]) {
  const buffer = new ArrayType([99, 99, 40, 80, 120, 255, 99]);
  assert.deepEqual([...packRgbaPixels(buffer.subarray(2, 6))], [0xff785028]);
}

console.log('brightness example contracts passed');
