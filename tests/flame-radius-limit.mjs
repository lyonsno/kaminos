// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {immersedControlsForFlamePose,immersedRadiusClamp,defaultFlameEmitterPose} from '../scene-flame-emitter.mjs';
test('exact limit tolerates only floating-point boundary noise',()=>{
 const pose={...defaultFlameEmitterPose(),scale:Array(3).fill(1.0000000000000002)};
 assert.equal(immersedControlsForFlamePose({immersedRadius:.5},pose).immersedRadius,.5);
 assert.equal(immersedControlsForFlamePose({immersedRadius:.501},pose).immersedRadius,.5,'an out-of-range radius is clamped, not refused');
});
// Operator, 2026-10-18: a basin value outside the range is not a reason to ban
// the basin; clamp it and warn. Only a value that is not a number is refused.
test('out-of-range radius clamps both ways and the clamp is reported',()=>{
 const pose=defaultFlameEmitterPose();
 assert.equal(immersedControlsForFlamePose({immersedRadius:.001},pose).immersedRadius,.02);
 assert.deepEqual(immersedRadiusClamp({immersedRadius:.9},pose),{requested:.9,applied:.5});
 assert.equal(immersedRadiusClamp({immersedRadius:.2},pose),null);
 assert.throws(()=>immersedControlsForFlamePose({immersedRadius:NaN},pose),/radius/);
});
