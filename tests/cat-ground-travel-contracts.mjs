import assert from 'node:assert/strict';
import { buildHindPawTravel, sampleHindPawTravel, sampleHindPawSupportOffset } from '../motion-ground-travel.mjs';
const paw = (x, y) => ({ center: [x, y, 0], soleY: y });
const frames = [
  { left: paw(0, 0), right: paw(0, 1) },
  { left: paw(-1, 0), right: paw(2, 1) },
  { left: paw(1, 1), right: paw(1, 0) },
  { left: paw(2, 1), right: paw(2, 0) },
];
const track = buildHindPawTravel(frames, [1, 0, 0]);
assert.deepEqual(track.map(x => x.distance), [0, 1, 2, 2]);
assert.equal(sampleHindPawTravel(track, 1.5), 1.5);
assert.equal(sampleHindPawTravel(track, 100), 2);
const diagonal = buildHindPawTravel([
  {left:{center:[0,0,0],soleY:0},right:paw(0,1)},
  {left:{center:[-1,0,.2],soleY:0},right:paw(0,1)},
  {left:{center:[-2,0,.3],soleY:0},right:paw(0,1)},
], [1,0,0]);
assert.deepEqual(diagonal.map(x=>x.offset), [[0,0,0],[1,0,-.2],[2,0,-.3]], 'support stroke cancels lateral as well as forward paw drift');
assert.deepEqual(sampleHindPawSupportOffset(diagonal, .5), [.5,0,-.1], 'fractional playback interpolates the support displacement');
assert.deepEqual(sampleHindPawSupportOffset(diagonal, 100), [2,0,-.3], 'endpoint holds the final support displacement');
assert.deepEqual(sampleHindPawSupportOffset(diagonal, -1), [0,0,0]);
assert.deepEqual(buildHindPawTravel(frames.map(() => frames[0]), [1, 0, 0]).map(x => x.distance), [0, 0, 0, 0], 'no arbitrary treadmill speed on a static pose');
assert.throws(() => buildHindPawTravel(frames, [0, 1, 0]), /horizontal/);
assert.throws(() => buildHindPawTravel([frames[0], { left: paw(NaN, 0), right: paw(0, 0) }], [1, 0, 0]), /invalid/);
console.log('cat ground travel contracts passed');
