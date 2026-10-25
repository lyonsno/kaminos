// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const url = new URL('../src/sam31-live-loop.js', import.meta.url);
assert.ok(existsSync(url), 'live video needs a backpressured consumer with paired source/mask identity');
const { createSam31LiveLoop } = await import(url);
const frame = timestamp => ({ rgba: new Uint8Array(16).fill(timestamp), timestamp });
const hash = async rgba => 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', rgba)).toString('hex');
let active = 0, peak = 0, timestamps = [], captured = 0, seen = [], loop, paused;
const tracker = { imageWidth: 2, imageHeight: 2,
  async initialize(input) { return this.track(input); },
  async track(input) {
    active++; peak = Math.max(peak, active); timestamps.push(input.timestamp);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { frameIndex: timestamps.length - 1, timestamp: input.timestamp, sourceImageSha256: await hash(input.rgba) };
  }, pause: async () => ({ status: 'paused' }), resume: async () => {}, stop() {},
};
loop = createSam31LiveLoop({ tracker, getFrame: async () => frame(++captured),
  async onFrame({ source, result }) {
    assert.equal(await hash(source.rgba), result.sourceImageSha256);
    seen.push(result.frameIndex);
    if (result.frameIndex === 0) { paused = loop.pause(); }
    if (result.frameIndex === 2) loop.stop();
  } });
const run = loop.start({ ...frame(0), mask: new Uint8Array([1, 0, 0, 0]) });
await assert.rejects(loop.start({ ...frame(0), mask: new Uint8Array([1, 0, 0, 0]) }), /running/);
while (!paused) await new Promise(resolve => setImmediate(resolve));
await paused;
assert.equal(captured, 0, 'paused loop does not acquire more source frames');
await loop.resume(); await run;
assert.equal(peak, 1);
assert.deepEqual(timestamps, [0, 1, 2]);
assert.deepEqual(seen, [0, 1, 2]);
assert.equal(loop.snapshot().status, 'stopped');
const bad = createSam31LiveLoop({ tracker: { ...tracker, initialize: async () => ({ sourceImageSha256: 'stale' }) },
  getFrame: async () => frame(1), onFrame() { assert.fail('stale result cannot reach the display'); } });
await assert.rejects(bad.start({ ...frame(0), mask: new Uint8Array([1, 0, 0, 0]) }), /source/);
assert.equal(bad.snapshot().status, 'failed');
console.log('SAM live loop preserves paired frames, backpressure, Pause/Resume and Stop (mock tracker)');
