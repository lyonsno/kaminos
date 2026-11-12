// kaminos-test: node
import assert from 'node:assert/strict';
import { createSamVideoPixels } from '../examples/sam-video.mjs';
const source = { width: 2, height: 1, timestamp: 4, rgba: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]) };
const result = { maskWidth: 2, maskHeight: 1, timestamp: 4, objectSlot: 3, maskLogits: new Float32Array(32).fill(-1) };
result.maskLogits[6] = 1;
assert.deepEqual([...createSamVideoPixels(source, result, 'mask')], [255, 255, 255, 255, 0, 0, 0, 255]);
assert.deepEqual([...createSamVideoPixels(source, result, 'cutout')], [10, 20, 30, 255, 40, 50, 60, 0]);
assert.deepEqual([...source.rgba], [10, 20, 30, 255, 40, 50, 60, 255]);
assert.throws(() => createSamVideoPixels(source, { ...result, timestamp: 3 }), /timestamp/);
assert.throws(() => createSamVideoPixels(source, { ...result, maskLogits: new Float32Array() }), /geometry/);
for (const objectSlot of [undefined, -1, 16, 1.5]) {
  assert.throws(() => createSamVideoPixels(source, { ...result, objectSlot }), /object slot/);
}
console.log('SAM video display preserves selected-slot pixels and captured timestamp (CPU)');
