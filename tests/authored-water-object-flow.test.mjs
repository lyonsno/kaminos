// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {FLAME_EMITTER_TYPE} from '../scene-flame-emitter.mjs';
import {resolveAuthoredWaterSampling} from '../authored-water-drop.mjs';
import {normalizeLocalLiquidSetup,defaultLocalLiquidSetup,LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const actual=name=>{const a=html.indexOf('async function '+name+'('),b=html.indexOf('\n}',a);return html.slice(a,b+2);};
const first=createLocalLiquidEmitterSceneRecord({id:'first',label:'Water drop',transform:{position:[.3,1,0],rotation:[0,.5,0],scale:[1.2,1.2,1.2]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'finite_drop',drop:{width:.6,samplesPerUnit:40}}});
const created=[];
const c={THREE,structuredClone,LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SCHEMA,sceneObjects:[first],assertSceneConstructionAvailable(){},localLiquidSetup:defaultLocalLiquidSetup(),normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,makeSceneObjectId:()=> 'second',
 controls:{target:new THREE.Vector3()},localLiquidEmitterRecords:()=>[first],selectedWaterSource:()=>first,sceneObjectDisplayLabel:r=>r.label,
 createLocalLiquidEmitterSceneRecord,createLocalLiquidEmitterObject:(T,r)=>({object:{},record:r}),scene:{add(){}},registerSceneObject:(o,r)=>created.push(r),recordSceneObjectInsertion:async()=>{},syncLocalLiquidHostEmitters(){},setActiveSceneObject(){},setActiveTab(){},authoredWaterControls:null,sharedWorkbench:null,window:{_kaminosDirty(){}}};
sceneContext(c);vm.runInContext(actual('addAuthoredWaterDrop'),c);await c.addAuthoredWaterDrop();
const second=created[0];
assert.deepEqual(second.localLiquidEmitter,first.localLiquidEmitter,'Add another water object must inherit the edited sampling and bounds, not silently introduce incompatible defaults');
assert.deepEqual(second.transform.scale,first.transform.scale,'World particle spacing also includes source scale');
assert.notEqual(second.label,first.label,'Multiple drops need distinguishable default names');
const can=html.match(/function canDuplicateObject\(entry\)\{[^\n]+/)[0];
Object.assign(c,{FLAME_EMITTER_TYPE,PROCEDURAL_MESH_TYPE:'procedural-mesh',CAMERA_TYPE:'camera'});vm.runInContext(can,c);
assert.equal(c.canDuplicateObject(first),true,'Water uses ordinary Duplicate like other authored objects');
console.log('Ordinary water Add preserves compatible edited settings and water supports normal duplication');

// Exercise the actual editor duplication branch, including independent source
// settings and registration, rather than only its eligibility predicate.
const {createLocalLiquidEmitterObject}=await import('../local-liquid-scene-object.mjs');
const object=createLocalLiquidEmitterObject(THREE,first).object;first.object=object;
Object.assign(c,{createLocalLiquidEmitterObject,serializeSceneObject:r=>structuredClone({...r,object:undefined}),ensureSceneObjectMembershipTarget:()=> 'membership',scenePlacementTools:{edits:{assertCanRecordApplied(){}}},renderSceneObjectList(){}});
const start=html.indexOf('function duplicateSceneObject('),end=html.indexOf('\n}',start);
vm.runInContext(html.slice(start,end+2),c);c.duplicateSceneObject('first');
const copy=created.at(-1);assert.equal(copy.label,'Water drop copy');assert.deepEqual(copy.localLiquidEmitter,first.localLiquidEmitter);assert.notEqual(copy.localLiquidEmitter,first.localLiquidEmitter);
assert.equal(object.children.filter(r=>r.userData.kaminosWaterSourceGuide).length,1,'Released sources retain their own selectable initial-volume guide');
const {authoredDropSetup}=await import('../authored-water-host.mjs');
assert.equal(authoredDropSetup([first,second]).solver.particleCount,27648,'New Add must actually assemble with the saved edited source under the real shared solver contract');

// A released source must remain spatially editable after property changes and
// history replay without needing an unrelated selection refresh (HWOU-1).
const {createSceneEdits}=await import('../scene-edit-session.mjs');
const {normalizeLocalLiquidEmitter}=await import('../local-liquid-setup.mjs');
const owned=createLocalLiquidEmitterObject(THREE,first),row={...owned.record,object:owned.object};
const history=createSceneEdits({read:()=>null,write(){throw Error('Unexpected pose writer');}});
const q={structuredClone,THREE,sceneObjects:[row],activeSceneObjectId:row.id,LOCAL_LIQUID_EMITTER_TYPE,normalizeLocalLiquidEmitter,createLocalLiquidEmitterObject,
 localLiquidSetup:null,assertSceneConstructionAvailable(){},sceneObjectTransformState:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),
 serializeSceneObject:r=>({...r,object:undefined}),scenePlacementTools:{edits:history},localLiquidHost:{state:()=>({sourceIds:[row.id]})},syncLocalLiquidHostEmitters(){},authoredWaterControls:{refresh(){}},window:{_kaminosDirty(){}}};
sceneContext(q);
const writerStart=html.indexOf('const waterSettingTargets='),writerEnd=html.indexOf('\nlet authoredWaterSimulationTarget',writerStart);
vm.runInContext(html.match(/function updateWaterSourceGuides\(\)\{[^\n]+/)[0]+'\n'+html.slice(writerStart,writerEnd),q);
row.object.children.find(n=>n.userData.kaminosWaterPreview).visible=false;q.updateWaterSourceGuides();
const guide=width=>{assert.equal(row.object.children.find(n=>n.userData.kaminosWaterPreview).visible,false);const n=row.object.children.find(n=>n.userData.kaminosWaterSourceGuide);assert.equal(n.visible,true,'Selected released volume guide survives Apply and history without reselection');assert.equal(n.geometry.parameters.width,width);};
guide(.6);q.applyAuthoredWaterSettings(row.id,{drop:{...row.localLiquidEmitter.drop,width:.75,samplesPerUnit:32}});guide(.75);
await history.undo();guide(.6);await history.redo();guide(.75);
q.activeSceneObjectId=null;q.updateWaterSourceGuides();assert.equal(row.object.children.find(n=>n.userData.kaminosWaterSourceGuide).visible,false);
q.activeSceneObjectId=row.id;q.updateWaterSourceGuides();guide(.75);

// MLS accepts another ordinary continuous source beyond the retired five-inlet limit.
const flows=Array.from({length:5},(_,i)=>createLocalLiquidEmitterSceneRecord({id:'flow'+i,transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}}));
c.sceneObjects=flows;c.localLiquidEmitterRecords=()=>flows;c.LOCAL_LIQUID_EMITTER_CAPACITY=5;
const beforeDuplicates=created.length;c.duplicateSceneObject('flow0');assert.equal(created.length,beforeDuplicates+1);

// Initial particle/guide materials are preview state, never saved water
// settings. Restoring an older scene can apply its legacy opacity to both.
const serializer={THREE,LOCAL_LIQUID_EMITTER_TYPE,FLAME_EMITTER_TYPE,CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural-mesh',structuredClone,
 sceneObjectMetadataFor:o=>o.userData.kaminosSceneObject,sceneObjectTransformState:q.sceneObjectTransformState,canCollideWithFire:()=>false};
sceneContext(serializer);for(const name of ['getMaterialStateForObject','serializeSceneObject']){const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a);vm.runInContext(html.slice(a,b+2),serializer);}
const savedPreview=()=>JSON.parse(JSON.stringify(serializer.serializeSceneObject(row)));
row.object.traverse(o=>{if(o.material)o.material.opacity=.55;});const beforeDraft=savedPreview();
row.object.children.find(o=>o.userData.kaminosWaterSourceGuide).material.opacity=.7;
assert.deepEqual(savedPreview(),beforeDraft,'Transient preview replacement must not change the serialized authored scene');

// Add already selects during admission. Its async history completion must not
// steal a selection made meanwhile (including opening simulation properties).
let finishInsertion;
c.recordSceneObjectInsertion=()=>new Promise(resolve=>finishInsertion=resolve);
c.registerSceneObject=(_object,record)=>{c.activeSceneObjectId=record.id;c.activeSceneFieldId=null;};
c.setActiveSceneObject=id=>{c.activeSceneObjectId=id;c.activeSceneFieldId=null;};
const pendingAdd=c.addAuthoredWaterDrop({mode:'continuous'});
c.activeSceneObjectId=null;c.activeSceneFieldId='water-field';finishInsertion();await pendingAdd;
assert.equal(c.activeSceneFieldId,'water-field','Completing Add cannot replace the newer simulation selection');

// A new stream is independently sized, even when the existing volume is tiny or large.
c.recordSceneObjectInsertion=async()=>{};c.registerSceneObject=(_object,record)=>created.push(record);
c.sceneObjects=[first];c.localLiquidEmitterRecords=()=>[first];
for(const scale of [.25,3]){
 first.transform.scale=[scale,scale,scale];
 await c.addAuthoredWaterDrop({mode:'continuous'});
 assert.deepEqual(created.at(-1).transform.scale,[1,1,1]);
}
