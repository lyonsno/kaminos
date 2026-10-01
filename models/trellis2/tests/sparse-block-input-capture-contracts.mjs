import assert from 'node:assert/strict';
import * as witness from '../sparse-block-witness.js';
assert.equal(typeof witness.createSparseBlockInputCapture, 'function', 'Missing GPU-only snapshot of the exact incoming block hidden.');
const copies = [], destroyed = [];
const runtime = {
  device: { createCommandEncoder() { return { copyBufferToBuffer(...args) { copies.push(args); }, finish() { return {}; } }; } },
  queue: { submit() { for (const [from, , to] of copies.splice(0)) to.values.set(from.values); } },
  createTensor(spec) { return { ...spec, byteLength: 16, bufferOffset: 0,
    buffer: { values: new Float32Array(4), destroy() { destroyed.push(this); } } }; },
  readTensor() { assert.fail('Input capture must not read back between blocks.'); },
  uploadTensor() { assert.fail('Input capture must not replace the resident input.'); },
};
const source = { shape: [2, 2], dtype: 'f32', byteLength: 16, bufferOffset: 0, usage: 4,
  buffer: { values: Float32Array.of(1, 2, 3, 4) } };
const capture = witness.createSparseBlockInputCapture(runtime, source);
capture.capture();
source.buffer.values.fill(99); // The shared workspace is subsequently overwritten.
assert.deepEqual([...capture.tensor.buffer.values], [1, 2, 3, 4]);
assert.throws(() => capture.capture(), /already captured/);
capture.dispose(); capture.dispose();
assert.equal(destroyed.length, 1);
assert.ok(!destroyed.includes(source.buffer), 'Consumer-owned input must survive observer cleanup.');
assert.throws(() => capture.capture(), /disposed/);
for (const change of [s => { s.usage = 0; }, s => { s.dtype = 'f16'; }, s => { s.byteLength = 8; }]) {
  const bad = { ...source }; change(bad);
  assert.throws(() => witness.createSparseBlockInputCapture(runtime, bad), /input/);
}
console.log('Offline GPU input capture preserves pre-overwrite bytes without a CPU interstage handoff.');
