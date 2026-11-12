// kaminos-test: node
import assert from 'node:assert/strict';
import * as module from '../src/sam31-stream-engine.js';

assert.equal(typeof module.createSam31StreamEngine, 'function', 'tracking needs a persistent frame-to-memory loop');
const { createSam31StreamEngine } = module;
let failure = null, release = null, calls = [], closed = 0;
const config = { frameTokenCount: 4, channels: 2, multiplexCount: 16,
  numMaskmem: 7, maxObjectPointerFrames: 16, maxConditioningFrames: 4 };
const frame = index => ({ rgba: new Uint8Array(16).fill(index), timestamp: index * 33 });
function result(index) {
  const values = n => new Float32Array(n).fill(index);
  return { frameIndex: index, maskLogits: values(16 * 4), maskWidth: 2, maskHeight: 2,
    objectScores: values(16), sourceImageSha256: `frame-${index}`,
    memory: { memory: values(8), memoryPosition: values(8), image: values(8), imagePosition: values(8), pointers: values(32) } };
}
const engine = createSam31StreamEngine({ config, imageWidth: 2, imageHeight: 2, async execute(input) {
  calls.push(input);
  if (release) await new Promise(resolve => { release = resolve; });
  if (failure) throw failure;
  return result(input.frameIndex);
}, async close() { closed++; } });
await assert.rejects(engine.track(frame(1)), /initialize/);
assert.throws(() => engine.reset(), /initial/i);
const mask = new Uint8Array([1, 0, 0, 0]);
const seed = await engine.initialize({ ...frame(0), mask, objectSlot: 2 });
assert.equal(seed.frameIndex, 0);
assert.equal(seed.timestamp, 0);
mask.fill(0);
assert.equal(calls[0].mask[0], 1, 'seed input must be snapshotted');
await assert.rejects(engine.initialize({ ...frame(0), mask, objectSlot: 2 }), /initialized/);
const first = await engine.track(frame(1));
assert.equal(first.frameIndex, 1);
assert.equal(first.timestamp, 33);
assert.deepEqual(calls[1].temporal.plan.spatialFrames.map(f => f.frameIndex), [0]);
first.maskLogits.fill(99);
const second = await engine.track(frame(2));
assert.deepEqual(calls[2].temporal.plan.spatialFrames.map(f => f.frameIndex), [0, 1]);
assert.equal(calls[2].temporal.spatialFrames[1].memory[0], 1);
assert.equal(second.timestamp, 66);
failure = new Error('device failure');
await assert.rejects(engine.track(frame(3)), /device failure/);
assert.equal(engine.snapshot().nextFrameIndex, 3, 'failed frames cannot advance memory');
failure = null;
await engine.track(frame(3));
await assert.rejects(engine.track(frame(3)), /timestamp/);
release = true;
const pending = engine.track(frame(4));
await assert.rejects(engine.track(frame(5)), /busy/);
assert.throws(() => engine.reset(), /busy/);
await assert.rejects(engine.close(), /busy/);
release();
await pending;
release = null;
for (let i = 5; i <= 40; i++) await engine.track(frame(i));
const snapshot = engine.snapshot();
assert.equal(snapshot.nextFrameIndex, 41);
assert.deepEqual(snapshot.spatialFrameIndices, [0, 35, 36, 37, 38, 39, 40]);
assert.deepEqual(snapshot.pointerFrameIndices, [0, ...Array.from({ length: 15 }, (_, i) => 26 + i)]);
assert.equal(snapshot.completedFrames, 41);
engine.reset();
assert.equal(engine.snapshot().nextFrameIndex, 0);
assert.deepEqual(engine.snapshot().spatialFrameIndices, []);
await engine.initialize({ ...frame(0), mask: new Uint8Array([0, 1, 0, 0]), objectSlot: 1 });
assert.equal(calls.at(-1).objectSlot, 1);
await engine.close();
await engine.close();
assert.equal(closed, 1);
await assert.rejects(engine.track(frame(1)), /closed/);
const shortPointers = createSam31StreamEngine({ config: { ...config, maxObjectPointerFrames: 2 },
  imageWidth: 2, imageHeight: 2, async execute(input) {
    if (input.frameIndex === 8) assert.deepEqual(input.temporal.spatialFrames.map(f => f.frameIndex), [0, 2, 3, 4, 5, 6, 7]);
    return result(input.frameIndex);
  }, async close() {} });
await shortPointers.initialize({ ...frame(0), mask: new Uint8Array([1, 0, 0, 0]) });
for (let i = 1; i <= 8; i++) await shortPointers.track(frame(i));
await shortPointers.close();
let closeAttempts = 0;
const retryClose = createSam31StreamEngine({ config, imageWidth: 2, imageHeight: 2,
  execute: async input => result(input.frameIndex),
  close() { if (++closeAttempts === 1) throw new Error('drain failed'); } });
await retryClose.initialize({ ...frame(0), mask: new Uint8Array([1, 0, 0, 0]) });
await assert.rejects(retryClose.close(), /drain failed/);
assert.equal(retryClose.snapshot().status, 'close-failed');
assert.throws(() => retryClose.reset(), /close/);
await assert.rejects(retryClose.track(frame(1)), /close/);
await retryClose.close();
assert.equal(closeAttempts, 2, 'failed cleanup must be retryable');
console.log('SAM3.1 streaming frame/memory lifecycle contracts passed (mock execution)');
