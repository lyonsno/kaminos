import assert from 'node:assert/strict';import * as contracts from '../tools/stone-grain-evidence.mjs';
assert.equal(typeof contracts.requireGrainEvidence,'function','Grain smoke needs independent negative closure controls');
const native={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',backend:'webgpu',adapterFallback:false,connectivity:'elastic-support',runId:'native',submittedSteps:1};
const good={status:native,grains:{route:'kaminos.stone.connected-grains.v1',groups:[[0,1],[2]],scale:.3},faces:{route:'kaminos.stone.exposed-cell-faces.webgpu.v1',exteriorTriangles:24,interiorTriangles:4,totalTriangles:28,capacityTriangles:48},state:{runId:'native',model:{points:3},observation:{kind:'full-diagnostic'},state:Array(48).fill(0),bonds:[0,1,0,0]}};
assert.doesNotThrow(()=>contracts.requireGrainEvidence(good));
for(const bad of [{...good,status:{...native,adapterFallback:true}},{...good,grains:null},{...good,faces:{...good.faces,totalTriangles:0}},{...good,faces:{...good.faces,totalTriangles:27}},{...good,state:{...good.state,runId:'stale'}},{...good,state:{...good.state,observation:{kind:'submitted'}}},{...good,state:{...good.state,state:[]}}])assert.throws(()=>contracts.requireGrainEvidence(bad));
console.log('Wrong route, missing grains, blank/partial exposure, stale and submitted-only material cannot close grain exercise');
