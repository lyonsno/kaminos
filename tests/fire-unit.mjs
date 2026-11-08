// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedFireUnitPose,checkedFireUnitRecord,fireUnitFrame,moveLinkedFireEmitter,FIRE_UNIT_SOURCE,fireUnitRecordDomain} from '../fire-unit-record.mjs';
import {worldSmokeMapping} from '../volume-world-smoke.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
const pose=(position=[0,0,0],scale=1)=>({position,rotation:[0,0,0],scale:[scale,scale,scale]});
const record=()=>({id:'fire-a',type:'fire-unit',source:FIRE_UNIT_SOURCE,label:'Fire A',transform:pose(),fireUnit:{controls:{resolution:16,worldSmoke:'on',worldSmokeResolution:8,raySteps:1,renderScale:.1},moveEmitterWithGrid:true,emitter:pose([.2,-.76,0])}});
test('nested fire unit records survive ordinary scene serialization with independent identities',()=>{
 const ops=createSceneRecordOperations({domains:[fireUnitRecordDomain],readers:{transform:o=>o.pose,materials:()=>null}});
 for(const id of ['fire-a','fire-b']){const r={...record(),id},n=ops.normalize(r);assert.equal(n.id,id);assert.deepEqual(n.fireUnit,r.fireUnit);assert.equal(ops.reloadable(n),true);const s=ops.serialize({...n,object:{pose:n.transform,userData:{kaminosSceneObject:n}}});assert.deepEqual(s.fireUnit,n.fireUnit);assert.deepEqual(checkedFireUnitRecord(s).transform,r.transform);}
});
test('moving the outer unit carries a linked source exactly once, including undo and scale',()=>{
 const a=pose(),b=pose([4,2,-1],2),source=pose([.2,-.76,0]);
 const next=moveLinkedFireEmitter(source,a,b,true);
 assert.deepEqual(next.position,[4.4,.48,-1]);assert.deepEqual(next.scale,[2,2,2]);
 const restored=moveLinkedFireEmitter(next,b,a,true);assert.ok(restored.position.every((v,i)=>Math.abs(v-source.position[i])<1e-12));assert.deepEqual(restored.scale,source.scale);
 assert.deepEqual(moveLinkedFireEmitter(source,a,b,false),source);
 assert.deepEqual(fireUnitFrame(b),{translate:[4,2,-1],scale:2});
});
test('unsupported grid rotation and nonuniform scale fail before a partial move',()=>{
 assert.throws(()=>checkedFireUnitPose({...pose(),rotation:[0,.1,0]}),/aligned/);
 assert.throws(()=>checkedFireUnitPose({...pose(),scale:[1,2,1]}),/uniform/);
 assert.throws(()=>checkedFireUnitRecord({...record(),fireUnit:{...record().fireUnit,moveEmitterWithGrid:'yes'}}),/boolean/);
 assert.throws(()=>checkedFireUnitRecord({...record(),fireUnit:{...record().fireUnit,controls:{resolution:NaN}}}),/finite/);
});

test('whole-unit movement retains gas resources and does not enter the Fine remap path',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const source=process.env.FIRE_UNIT_CORE_SOURCE?fs.readFileSync(process.env.FIRE_UNIT_CORE_SOURCE,'utf8'):fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const start=source.indexOf('    repositionOrdinaryUnit(');
 assert.ok(start>=0,'runtime has no whole-unit transform; Fine relocation would remap and leave World anchored');
 const body=source.slice(start,source.indexOf('\n    },',start)+6).trim().replace(/^repositionOrdinaryUnit\(/,'function repositionOrdinaryUnit(');
 const ctx={structuredClone,productFrameOwner:'prototype',followingDomain:null,pendingDomainRemap:null,
  productTransform:{translate:[0,0,0],scale:1},worldSmoke:{anchor:{translate:[1,2,3],scale:1},gas:{identity:'gas-a'}},worldFrameRestore:undefined,state:{},lastResidualPartials:null};
 const plan={min:[-3,-3,-3],max:[3,9,3],materialPitch:.75},beforeMapping=worldSmokeMapping(plan,ctx.worldSmoke.anchor,ctx.productTransform);
 vm.createContext(ctx);vm.runInContext(body,ctx);const gas=ctx.worldSmoke.gas;
 ctx.repositionOrdinaryUnit([4,5,6],2);
 assert.deepEqual(Array.from(ctx.worldSmoke.anchor.translate),[6,9,12]);assert.equal(ctx.worldSmoke.anchor.scale,2);
 const afterMapping=worldSmokeMapping(plan,ctx.worldSmoke.anchor,ctx.productTransform);assert.deepEqual(afterMapping,beforeMapping,'rigid Fine and World movement leaves the local render mapping unchanged, including while paused');
 assert.equal(ctx.worldSmoke.gas,gas);assert.equal(ctx.pendingDomainRemap,null);assert.equal(ctx.state.unitTransform.resampled,false);
 const before=JSON.stringify(ctx.productTransform);assert.throws(()=>ctx.repositionOrdinaryUnit([NaN,0,0],1),/finite/);assert.equal(JSON.stringify(ctx.productTransform),before);
 ctx.pendingDomainRemap={};assert.throws(()=>ctx.repositionOrdinaryUnit([0,0,0],1),/Finish Fine relocation/);
});
