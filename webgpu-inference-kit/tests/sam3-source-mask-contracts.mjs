import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const url = new URL('../src/sam3-source-mask.js', import.meta.url);
assert.ok(existsSync(url), 'source-size export must resize logits before thresholding');
const { resizeSam3MaskLogits, createSam3SourceMask } = await import(url);
// Meta sam3_image_processor.py: bilinear, align_corners=False, sigmoid > .5.
const logits = new Float32Array([-1, 3]);
assert.deepEqual(Array.from(resizeSam3MaskLogits(logits, 2, 1, 4, 1)), [-1, 0, 2, 3]);
const output = { width: 2, height: 1, instances: [{ index: 7, logits }, { index: 8, logits: new Float32Array([2, -4]) }] };
assert.deepEqual(Array.from(createSam3SourceMask(output, [7], 4, 1)), [0, 0, 1, 1]);
assert.deepEqual(Array.from(createSam3SourceMask(output, [7, 8], 4, 1)), [1, 1, 1, 1]);
assert.deepEqual(Array.from(createSam3SourceMask(output, [], 4, 1)), [0, 0, 0, 0]);
assert.throws(() => createSam3SourceMask(output, [9], 4, 1), /unknown instance/);
assert.throws(() => resizeSam3MaskLogits([1], 2, 1, 4, 1), /length/);
assert.throws(() => resizeSam3MaskLogits([NaN], 1, 1, 1, 1), /finite/);
console.log('SAM source-size mask contracts passed');
