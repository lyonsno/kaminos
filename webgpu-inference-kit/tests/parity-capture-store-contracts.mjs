import assert from 'node:assert/strict';
import { createWebGpuParityCaptureRegistry } from '../src/index.js';

const captures = createWebGpuParityCaptureRegistry({ runId: 'run-a' });
const source = new Float32Array([1, 2, 3, 4]);
const shape = [2, 2];
const description = captures.capture('encoder', source, { shape, layout: 'NC' });
assert.equal(Object.hasOwn(description, 'values'), false, 'capture returns metadata, not retained values');
source.fill(99);
shape[0] = 999;
assert.deepEqual(captures.describe('encoder').shape, [2, 2]);
assert.equal(description.byteLength, 16);
assert.equal(description.elementCount, 4);
assert.equal(description.typedArrayConstructor, 'Float32Array');
assert.equal(description.runId, 'run-a');
assert.equal(description.stageId, 'encoder');
assert.equal(captures.describe('missing'), null);
assert.throws(() => captures.capture('encoder', source), /already exists/);
assert.throws(() => captures.capture('empty', new Float32Array()), /empty/);
assert.throws(() => captures.capture('shape', source, { shape: [9] }), /shape/);
assert.throws(() => captures.capture('layout', source, { layout: {} }), /layout/);
assert.throws(() => captures.capture('double', new Float64Array([1])), /Float64Array/);

const exact = captures.compare('encoder', new Float32Array([1, 2, 3, 4]));
assert.equal(exact.metrics.exactMatch, true);
assert.equal(exact.stageId, 'encoder');
assert.equal(exact.runId, 'run-a');
const sampled = captures.compare('encoder', new Float32Array([1, 8, 3, 9]), {
  sampling: { mode: 'stride', stride: 2 },
});
assert.equal(sampled.metrics.exactMatch, true);
assert.equal(sampled.sourceElementCount, 4);
assert.equal(sampled.comparedElementCount, 2);
assert.throws(() => captures.compare('encoder', new Float32Array([1, 2])), /same length/);
assert.throws(() => captures.compare('missing', source), /missing/);

const part = captures.readBytes('encoder', { byteOffset: 4, byteLength: 8 });
assert.deepEqual(new Float32Array(part.buffer), new Float32Array([2, 3]));
part.fill(0);
assert.equal(captures.compare('encoder', new Float32Array([1, 2, 3, 4])).metrics.exactMatch, true);
for (const range of [
  { byteOffset: -1, byteLength: 4 },
  { byteOffset: 0.5, byteLength: 4 },
  { byteOffset: 12, byteLength: 8 },
  { byteOffset: 0, byteLength: -1 },
]) assert.throws(() => captures.readBytes('encoder', range), /range/);
assert.throws(() => captures.readBytes('missing', { byteOffset: 0, byteLength: 1 }), /missing/);
assert.equal(captures.release('encoder'), true);
assert.equal(captures.release('encoder'), false);
assert.throws(() => captures.compare('encoder', source), /missing/);
assert.throws(() => captures.readBytes('encoder', { byteOffset: 0, byteLength: 1 }), /missing/);
captures.capture('next', new Uint32Array([0, 4294967295]));
assert.equal(captures.compare('next', new Uint32Array([0, 4294967295])).metrics.exactMatch, true);
captures.clear();
assert.deepEqual(captures.stageIds(), []);
console.log('private parity capture store contracts passed');
