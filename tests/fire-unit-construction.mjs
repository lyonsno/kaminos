// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {checkedFireUnitRecord,FIRE_UNIT_TYPE,FIRE_UNIT_SOURCE,moveLinkedFireEmitter} from '../fire-unit-record.mjs';
import {flamePoseFromImmersedControls} from '../scene-flame-emitter.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function addAuthoredFireUnit('),html.indexOf('\nasync function mountAuthoredAsh('));
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},controls={emitterSourceLaw:'immersed-source',resolution:24,immersedCentreX:.1,immersedCentreY:-.75,immersedCentreZ:0};
async function construct(options){let recorded;
 const templateData={controls,settings:{domControls:{}},emitter:{...pose,position:[2,-.75,0]},moveEmitterWithGrid:true,fineOffset:[2,1,0],worldReferenceDims:[32,64,32]};
 const ctx={structuredClone,Date,options,FIRE_UNIT_TYPE,FIRE_UNIT_SOURCE,checkedFireUnitRecord,moveLinkedFireEmitter,flamePoseFromImmersedControls,
 currentFireUnitTemplate:()=>({capture:()=>structuredClone(templateData),root:{scale:{x:1}},pose:()=>structuredClone(pose)}),makeSceneObjectId:()=> 'new-fire',assertSceneConstructionAvailable(){},readVolumeControls:()=>controls,
 activeSceneComposition:null,flameDomainScale:1,flameDomainTranslation:[0,0,0],flameEmitterPose:pose,authoredFireUnits:new Map(),controls:{target:{x:0,z:0}},groundPlane:{position:{y:0}},
 ensureSceneObjectMembershipTarget:()=> 'membership',scenePlacementTools:{edits:{assertCanRecordApplied(){}}},mountAuthoredFireUnit:async r=>{recorded=r;},recordSceneObjectInsertion:async()=>{},setActiveSceneObject(){},removeSceneObjectInternal(){}};
 vm.createContext(ctx);vm.runInContext(source,ctx);await ctx.addAuthoredFireUnit(options);return recorded;
}
test('new tuning/basin construction starts its own grid frame and source, rather than inheriting followed layout',async()=>{
 for(const options of [{controls},{settings:{domControls:{}}},{emitter:pose}]){const r=await construct(options);assert.equal(r.fireUnit.fineOffset,undefined);assert.equal(r.fireUnit.worldReferenceDims,undefined);if(!options.emitter)assert.equal(r.fireUnit.emitter.position[0],.1);}
});
test('a plain clone retains the selected fire layout and its corresponding source pose',async()=>{
 const r=await construct({position:[5,0,0]});assert.deepEqual(r.fireUnit.fineOffset,[2,1,0]);assert.deepEqual(r.fireUnit.worldReferenceDims,[32,64,32]);assert.deepEqual(r.fireUnit.emitter.position,[7,-.75,0]);
});
