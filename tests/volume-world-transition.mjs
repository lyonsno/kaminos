// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as world from '../volume-world-smoke.mjs';
test('transition is compact, smooth and measured in coarse cells',()=>{
 const args={fineDims:[32,64,32],mapping:[0,0,0,1],flowPitch:.5,cells:2};
 assert.equal(world.worldTransitionSample([0,1,0],args).weight,0,'interior remains the donor');
 assert.equal(world.worldTransitionSample([1.9375,1,0],args).weight,0,'outside two-cell band');
 assert.equal(world.worldTransitionSample([1.4375,1,0],args).weight,.5);
 assert.deepEqual(world.worldTransitionSample([1.4375,1,0],args).normal,[1,0,0]);
 assert.deepEqual(world.worldTransitionSample([1.4375,1,0],args).sample,[.9375,1,0]);
 assert.equal(world.worldTransitionSample([1,1,0],{...args,cells:0}).weight,0);
 assert.equal(world.worldTransitionSample([2.875,2,0],{...args,mapping:[0,0,0,2],flowPitch:1}).weight,.5,'scaled domains preserve the band');
});
