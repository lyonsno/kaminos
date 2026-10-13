// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {immersedControlsForFlamePose,defaultFlameEmitterPose} from '../scene-flame-emitter.mjs';
test('exact limit tolerates only floating-point boundary noise',()=>{
 const pose={...defaultFlameEmitterPose(),scale:Array(3).fill(1.0000000000000002)};
 assert.equal(immersedControlsForFlamePose({immersedRadius:.5},pose).immersedRadius,.5);
 assert.throws(()=>immersedControlsForFlamePose({immersedRadius:.501},pose),/radius/);
});
