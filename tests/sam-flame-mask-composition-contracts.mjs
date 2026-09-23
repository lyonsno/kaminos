import assert from 'node:assert/strict';

const { encodeSamFlameMaskPixels, fitSamFlameTexture } = await import('../sam-image-tools.js');
assert.equal(typeof encodeSamFlameMaskPixels, 'function', 'SAM-to-flame composition needs an explicit mask texture contract');
assert.equal(typeof fitSamFlameTexture, 'function', 'live fire must preserve its aspect ratio inside the selected image mask');

assert.deepEqual([...encodeSamFlameMaskPixels(Uint8Array.from([0, 1, 1, 0]), 2, 2)], [
  0, 0, 0, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 0, 0, 0, 255,
], 'alpha-map green channel must preserve the selected binary source mask');
assert.throws(() => encodeSamFlameMaskPixels(Uint8Array.from([1]), 2, 1), /Mask size/);
assert.throws(() => encodeSamFlameMaskPixels(Uint8Array.from([0, 2]), 2, 1), /binary/);
assert.throws(() => encodeSamFlameMaskPixels(Uint8Array.from([0]), 0, 1), /positive/);

assert.deepEqual(fitSamFlameTexture(200, 100, 100, 100), { scaleX: 1, scaleY: 0.5, offsetX: 0, offsetY: 0.25 });
assert.deepEqual(fitSamFlameTexture(100, 200, 200, 100), { scaleX: 0.25, scaleY: 1, offsetX: 0.375, offsetY: 0 });
assert.throws(() => fitSamFlameTexture(0, 100, 100, 100), /positive/);

console.log('SAM live-flame mask texture contracts passed');
