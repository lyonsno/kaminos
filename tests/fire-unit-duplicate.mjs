// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createDuplicateCommit} from '../scene-duplicate-commit.mjs';
import {FIRE_UNIT_TYPE} from '../fire-unit-record.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),source=html.slice(html.indexOf('function canDuplicateObject('),html.indexOf('const sceneMembershipBatch='));
const original={id:'fire',type:FIRE_UNIT_TYPE,source:'kaminos:fire-unit',label:'Flame',transform:{position:[2,1,0],rotation:[0,0,0],scale:[1,1,1]},fireUnit:{moveEmitterWithGrid:false,emitter:{position:[3,0,0],rotation:[0,0,0],scale:[1,1,1]},fineOffset:[.25,.5,0],fineScale:.8,controls:{worldSmoke:'on'},settings:{domControls:{}}}};
function fixture({initialization,startAccepted=false}={}){const copies=new Map(),calls={recorded:[],removed:[],initialized:0,messages:[],complete:null},context={createDuplicateCommit,FIRE_UNIT_TYPE,FLAME_EMITTER_TYPE:'flame',LOCAL_LIQUID_EMITTER_TYPE:'water',ASH_SOURCE_TYPE:'ash-source',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural',Date,
 assertSceneConstructionAvailable(){},workingScene:{objects:[original],groups:[]},makeSceneObjectId:()=> 'copy',serializeSceneObject:()=>structuredClone(original),sceneObjectDisplayLabel:o=>o.label,
 ensureSceneObjectMembershipTarget:()=> 'copy-membership',scenePlacementTools:{edits:{assertCanRecordApplied(){},discard(){},state:()=>({active:null,replaying:false})},start:(_mode,complete)=>{calls.complete=complete;return startAccepted;}},
 mountAuthoredFireUnitShell:record=>{copies.set(record.id,record);return {initialize:async()=>{calls.initialized++;await initialization;}};},sceneMaterials:{read:()=>({bindings:[]})},setActiveSceneObject(){},renderSceneObjectList(){},setInfo:message=>calls.messages.push(message),
 recordSceneObjectInsertion:id=>calls.recorded.push(id),removeSceneObjectInternal:id=>{calls.removed.push(id);copies.delete(id);}};
 vm.createContext(context);vm.runInContext(source,context);return {context,copies,calls};}
test('native Duplicate supports a Flame and copies authored layout and source without shared mutable data',async()=>{const {context,copies,calls}=fixture();assert.equal(context.canDuplicateObject(original),true,'ordinary Duplicate must admit the Flame primitive');const id=context.duplicateSceneObject('fire');assert.equal(id,'copy');const record=copies.get(id);assert.deepEqual(record.fireUnit,original.fireUnit);assert.deepEqual(record.transform,original.transform);record.fireUnit.fineOffset[0]=8;assert.equal(original.fireUnit.fineOffset[0],.25);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.recorded,['copy']);assert.equal(calls.initialized,1);});
test('cancelled native duplicate placement removes only its new unit and records no insertion',()=>{const {context,copies,calls}=fixture();assert.throws(()=>context.duplicateSceneObject('fire',{interactive:true}),/Could not start duplicate placement/);assert.equal(copies.size,0);assert.deepEqual(calls.removed,['copy']);assert.deepEqual(calls.recorded,[]);assert.equal(context.workingScene.objects[0],original);});


test('a rejected native Flame duplicate cleans up before or after placement without a completed insertion',async()=>{
 for(const committed of [false,true]){
  let reject;const initialization=new Promise((_resolve,r)=>{reject=r;}),{context,copies,calls}=fixture({initialization,startAccepted:true});
  context.duplicateSceneObject('fire',{interactive:true});if(committed)calls.complete({commit:true});reject(Error('GPU initialization rejected'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(copies.size,0,'failed copy must be removed');assert.deepEqual(calls.removed,['copy']);assert.deepEqual(calls.recorded,[],'failed initialization must never produce a successful insertion');assert.equal(context.workingScene.objects[0],original);assert.ok(calls.messages.some(x=>x.includes('GPU initialization rejected')));
 }
});


test('asynchronous duplicate rejection waits for another gesture and preserves unrelated history',async()=>{
 let reject,removed=false,error;const ready=new Promise((_resolve,r)=>{reject=r;}),values={other:0,copy:0};
 const edits=createSceneEdits({read(){},write(){}});for(const key of Object.keys(values))edits.register('@data:'+key,{read:()=>({value:values[key]}),check:v=>v,write:v=>{values[key]=v.value;}});
 edits.apply('@data:other',{value:1});edits.apply('@data:copy',{value:2});
 const complete=createDuplicateCommit({edits,ready,ids:['copy'],commit(){throw Error('failed GPU must not insert');},cancel(){removed=true;},onError:e=>{error=e;}});complete({commit:true});
 edits.begin('@data:other');edits.preview({value:3});reject(Error('GPU initialization rejected'));await new Promise(resolve=>setImmediate(resolve));assert.equal(removed,false,'another active gesture remains intact');assert.equal(edits.state().active.id,'@data:other');
 edits.commit();await new Promise(resolve=>setImmediate(resolve));assert.equal(removed,true);assert.match(error.message,/GPU initialization rejected/);assert.equal(edits.state().undoCount,2,'only failed-copy history is discarded');edits.undo();assert.equal(values.other,1);edits.undo();assert.equal(values.other,0);assert.equal(values.copy,2);
});
