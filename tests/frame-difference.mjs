// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {meanAbsolutePixelDifference} from '../screenshot-png-rgb.mjs';

const frame = (width, height, channels, fill) => ({width, height, channels, pixels: Buffer.from(Array.from({length: width * height * channels}, (_, i) => fill(i)))});

test('identical frames differ by zero and a uniform shift by its size', () => {
 const a = frame(2, 2, 4, () => 10), b = frame(2, 2, 4, () => 13);
 assert.equal(meanAbsolutePixelDifference(a, a), 0);
 assert.equal(meanAbsolutePixelDifference(a, b), 3);
 assert.equal(meanAbsolutePixelDifference(b, a), 3, 'symmetric');
});

test('the difference averages every channel of every pixel', () => {
 const a = frame(2, 1, 3, () => 0), b = frame(2, 1, 3, i => (i === 0 ? 60 : 0));
 assert.equal(meanAbsolutePixelDifference(a, b), 10);
});

test('frames of different shape cannot be compared', () => {
 assert.throws(() => meanAbsolutePixelDifference(frame(2, 2, 4, () => 0), frame(2, 1, 4, () => 0)), /shape/);
 assert.throws(() => meanAbsolutePixelDifference(frame(2, 2, 4, () => 0), frame(2, 2, 3, () => 0)), /shape/);
});
