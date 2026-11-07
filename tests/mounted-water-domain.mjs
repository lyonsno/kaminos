// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createMountedWaterDomain,presentWaterBounds} from '../mounted-water-domain.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
test('mounted bounds and native gesture history retain authored units across changed views',()=>{
 const feature={setup:{schema:'kaminos.local-liquid-setup.v1',support:'scene_primitives',particleCount:30000,densityIterations:3,showSupportGeometry:false,waterSampling:{spacing:.05/Math.cbrt(3),container:null,worldBounds:{min:[-1,0,-2],max:[1,2,2]}}}},ordinary={setup:null};let frame={translation:[4,5,6],scale:.1};
 const domain=createMountedWaterDomain({id:'a',feature,sources:()=>[],frame:()=>frame});assert.deepEqual(presentWaterBounds(feature.setup.waterSampling.worldBounds,frame),{min:[3.9,5,5.8],max:[4.1,5.2,6.2]});
 const edits=createSceneEdits({read(){},write(){}});edits.register(domain.worldId,domain.world);edits.register(domain.localId,domain.local);edits.apply(domain.worldId,{position:[4.1,5.1,6]});assert.ok(Math.abs(domain.local.read().position[0]-1)<1e-10);
 frame={translation:[-2,8,1],scale:.4};edits.undo();assert.ok(domain.local.read().position.every((v,i)=>Math.abs(v-[0,1,0][i])<1e-10));edits.redo();assert.ok(Math.abs(domain.local.read().position[0]-1)<1e-10);assert.equal(ordinary.setup,null);assert.equal(feature.setup.particleCount,30000);
 edits.apply(domain.localId,{scale:[4,2,4]});assert.deepEqual(domain.local.read().scale,[4,2,4]);assert.equal(domain.owns(ordinary),false);
});
