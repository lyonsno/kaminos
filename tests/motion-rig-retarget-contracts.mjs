import assert from 'node:assert/strict';

const core = await import('../motion-rig-retarget-core.mjs').catch(() => ({}));
assert.equal(
  typeof core.buildKimodoHindquartersTrack,
  'function',
  'the motion-to-cat contract must expose a deterministic Kimodo hindquarters track builder',
);

const parents = [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26, 27, 28];
const frame = () => Array.from({ length: 30 }, () => [0, 0, 0]);
const a = frame();
a[0] = [0, 0, 0];
a[1] = [0, 1, 0];
a[22] = [1, 0, 0];
a[23] = [1, -1, 0];
a[24] = [1, -2, 0];
a[26] = [-1, 0, 0];
a[27] = [-1, -1, 0];
a[28] = [-1, -2, 0];
const b = structuredClone(a);
b[0] = [0.1, 0.2, -0.1];
b[1] = [0, 0.8660254, 0.5];
b[23] = [1, -0.5, 0.8660254];
b[24] = [1, -1.5, 0.8660254];
b[27] = [-1, -0.5, -0.8660254];
b[28] = [-1, -1.5, -0.8660254];
const c = structuredClone(a);
c[0] = [0.2, 0.1, 0];
c[23] = [1, 0, 1];
c[24] = [1, -1, 1];
c[27] = [-1, 0, -1];
c[28] = [-1, -1, -1];

const track = core.buildKimodoHindquartersTrack({ joints: [a, b, c], parents, num_joints: 30, num_frames: 3 });
assert.equal(track.schema, 'kaminos.kimodo-cat-hindquarters-track.v0');
assert.equal(track.frameCount, 3);
assert.deepEqual(track.targetBoneNames, [
  'pelvis',
  'hindlimb-left-hip', 'hindlimb-left-stifle', 'hindlimb-left-hock',
  'hindlimb-right-hip', 'hindlimb-right-stifle', 'hindlimb-right-hock',
]);
assert.deepEqual(track.frames[0].rootOffset, [0, 0, 0]);
assert.ok(Math.abs(track.frames[1].pelvisPitchRadians) > 0.1, 'source pelvis-to-spine orientation drives an explicit pelvis pitch channel');
assert.ok(Math.abs(track.frames[1].pelvisPitchRadians) < Math.PI / 2, 'pelvis pitch is measured around the bilateral hip axis');
assert.equal(track.frames[0].left.hipRadians, 0);
assert.equal(track.frames[0].left.stifleRadians, 0);
assert.ok(Math.abs(track.frames[1].left.hipRadians) > 0.1, 'left hip motion is derived from the source clip');
assert.ok(Math.abs(track.frames[1].left.stifleRadians) > 0.1, 'left stifle motion is derived from the source clip');
assert.ok(Math.abs(track.frames[1].left.hockRadians) > 0.1, 'left hock motion is derived from the source clip');
assert.ok(Math.abs(track.frames[1].right.hipRadians) > 0.01, 'right hip motion is derived from the source clip');
assert.ok(Math.abs(track.frames[1].right.stifleRadians) > 0.1, 'right stifle motion is derived from the source clip');
assert.deepEqual(Object.keys(track.frames[1].left).sort(), ['hipRadians', 'hockRadians', 'stifleRadians']);
assert.throws(
  () => core.buildKimodoHindquartersTrack({ joints: [a, b, c], parents: parents.map((parent, index) => index === 24 ? 22 : parent), num_joints: 30, num_frames: 3 }),
  /SOMA30.*LeftFoot.*LeftShin/,
  'the route must reject a wrong or unverified source joint tree instead of guessing',
);

const camelCaseTrack = core.buildKimodoHindquartersTrack({
  joints: [a, b, c],
  parents,
  numJoints: 30,
  numFrames: 3,
  fps: 24,
});
assert.equal(camelCaseTrack.frameCount, 3, 'the retained Kimodo export shape uses camel-case count fields');
assert.equal(camelCaseTrack.fps, 24);
assert.deepEqual(core.sampleKimodoHindquartersTrack(camelCaseTrack, 0.5).rootOffset, [0.05, 0.1, -0.05]);

assert.equal(typeof core.createMotionRigRequestGate, 'function', 'pending server replies need an explicit invalidation gate');
const requestGate = core.createMotionRigRequestGate();
const requestToken = requestGate.begin('cat-a/mesh-0');
assert.equal(requestGate.isCurrent(requestToken, 'cat-a/mesh-0'), true);
assert.equal(requestGate.isCurrent(requestToken, 'cat-b/mesh-0'), false, 'a reply cannot retarget a different selected mesh');
requestGate.invalidate();
assert.equal(requestGate.isCurrent(requestToken, 'cat-a/mesh-0'), false, 'Stop invalidates an outstanding request');

assert.deepEqual(track.frames[1].rootOffset, [0.1, 0.2, -0.1], 'source root travel is preserved as source-space data for other consumers');

assert.equal(typeof core.sampleKimodoHindquartersTrackAtElapsed, 'function', 'playback needs a bounded elapsed-time sampler');
const beforeEnd = core.sampleKimodoHindquartersTrackAtElapsed(camelCaseTrack, 1 / 24);
assert.equal(beforeEnd.done, false);
assert.equal(beforeEnd.sample.frame, 1);
const atEnd = core.sampleKimodoHindquartersTrackAtElapsed(camelCaseTrack, 2 / 24);
assert.equal(atEnd.done, true);
assert.equal(atEnd.sample.frame, 2, 'playback holds the final clip frame without wrapping to frame zero');

console.log('motion rig retarget contracts passed');
