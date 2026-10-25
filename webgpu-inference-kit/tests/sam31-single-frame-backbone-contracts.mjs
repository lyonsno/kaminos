// kaminos-test: node
import assert from 'node:assert/strict';
import * as backbone from '../src/sam31-two-image-backbone.js';

assert.equal(typeof backbone.createSam31SingleFrameBackboneForTest, 'function',
  'the tracker needs a single-frame backbone that does not require a second image');

const calls = [];
const receipt = (routeId, tag) => ({ status: 'real', fallbackReason: null,
  requestedRouteId: routeId, effectiveRouteId: routeId, outputs: [{ artifactId: `feature:${tag}` }] });
const weights = { patchProjection: new Float32Array([1]) };
let releaseTrunk;
let hold = false;
let fallback = false;
let loaded = 0;
let expectedSchedule;
const owner = await backbone.createSam31SingleFrameBackboneForTest({
  manifest: { shape: { imageHeight: 2, imageWidth: 2 } }, errors: [],
  async loadWeights() { loaded++; return weights; },
  async runTrunk(input) {
    assert.equal(input.schedule, expectedSchedule, 'trunk receives this frame admission');
    calls.push(['trunk', input.frameIndex, input.rgba[0], input.manifest.sourceImages[input.frameIndex].rgbaSha256]);
    assert.equal(input.patchProjection, weights.patchProjection);
    assert.equal(input.verificationAttached, false);
    if (hold) await new Promise(resolve => { releaseTrunk = resolve; });
    input.requestIds.push(`trunk:${input.invocationTag}`);
    return { receipts: [receipt('trunk', input.invocationTag)], routes: ['trunk'], timing: { totalMs: 1 } };
  },
  async runNeck(input) {
    assert.equal(input.schedule, expectedSchedule, 'neck receives this frame admission');
    calls.push([input.branch, input.frameIndex]);
    input.requestIds.push(`${input.branch}:${input.invocationTag}`);
    const r = receipt(input.branch, input.invocationTag);
    if (fallback) r.fallbackReason = 'test';
    return { result: { receipt: r }, route: { routeId: input.branch },
      features: [null, null, new Float32Array([input.frameIndex])],
      position2: new Float32Array([2]), durationMs: 1 };
  },
  async runHighResolution(input) {
    assert.equal(input.schedule, expectedSchedule, 'projection receives this frame admission');
    calls.push(['high', input.frameIndex, input.branch]);
    input.requestIds.push(`high:${input.invocationTag}`);
    return { result: { receipt: receipt('high', input.invocationTag) }, route: { routeId: 'high' },
      highResolutionS0: new Float32Array([3]), highResolutionS1: new Float32Array([4]), durationMs: 1 };
  },
});
const rgba = new Uint8Array(16).fill(7);
expectedSchedule = { invocation: { invocationId: 'frame:0' } };
const first = await owner.run({ rgba, frameIndex: 0, conditioning: true, invocationTag: 'video-a:0', schedule: expectedSchedule });
assert.equal(loaded, 1);
assert.deepEqual(calls.map(x => x[0]), ['trunk', 'propagation', 'interactive']);
assert.equal(first.frame.interactiveEmbedding[0], 0);
assert.equal(first.frame.highResolutionS0, undefined, 'mask conditioning does not need the propagation mask projection');
assert.equal(first.verificationAttached, false);
assert.equal(first.parityPassed, null, 'serving execution is not numerical parity evidence');
assert.equal(first.routeChainPassed, true);
calls.length = 0;
expectedSchedule = { invocation: { invocationId: 'frame:1' } };
const second = await owner.run({ rgba, frameIndex: 1, conditioning: false, invocationTag: 'video-a:1', schedule: expectedSchedule });
assert.equal(loaded, 1, 'static weights are loaded once across frames');
assert.deepEqual(calls.map(x => x[0]), ['trunk', 'propagation', 'high']);
assert.equal(second.sourceImageSha256, first.sourceImageSha256, 'repeated camera content is valid');
assert.equal(second.frame.interactiveEmbedding, undefined);
assert.equal(second.frame.propagationEmbedding[0], 1);
assert.deepEqual(Array.from(second.frame.highResolutionS0), [3]);
assert.notDeepEqual(first.requestIds, second.requestIds);
assert.equal(calls[0][3], second.sourceImageSha256);

await assert.rejects(owner.run({ rgba: new Uint8Array(3), frameIndex: 2, conditioning: false, invocationTag: 'bad' }), /RGBA/);
await assert.rejects(owner.run({ rgba, frameIndex: -1, conditioning: false, invocationTag: 'bad' }), /frameIndex/);
await assert.rejects(owner.run({ rgba, frameIndex: 2, conditioning: 'false', invocationTag: 'bad' }), /conditioning/);
await assert.rejects(owner.run({ rgba, frameIndex: 2, conditioning: false, invocationTag: '' }), /invocationTag/);
expectedSchedule = undefined;
hold = true;
const inFlight = owner.run({ rgba, frameIndex: 2, conditioning: false, invocationTag: 'video-a:2' });
rgba.fill(9);
while (!releaseTrunk) await new Promise(resolve => setImmediate(resolve));
await assert.rejects(owner.run({ rgba, frameIndex: 3, conditioning: false, invocationTag: 'video-a:3' }), /running/);
assert.throws(() => owner.close(), /running/);
assert.equal(calls.findLast(x => x[0] === 'trunk')[2], 7, 'capture bytes are snapshotted before the first await');
releaseTrunk();
await inFlight;
hold = false;
fallback = true;
await assert.rejects(owner.run({ rgba, frameIndex: 3, conditioning: false, invocationTag: 'video-a:3' }), /route chain/);
fallback = false;
assert.deepEqual(owner.close(), { status: 'closed' });
assert.deepEqual(owner.close(), { status: 'closed' });
await assert.rejects(owner.run({ rgba, frameIndex: 4, conditioning: false, invocationTag: 'video-a:4' }), /closed/);
console.log('SAM3.1 single-frame backbone contracts passed (mock phases; no GPU/parity claim)');
