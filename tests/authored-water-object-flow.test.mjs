// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const actual=name=>{const a=html.indexOf('async function '+name+'('),b=html.indexOf('\n}',a);return html.slice(a,b+2);};
const first=createLocalLiquidEmitterSceneRecord({id:'first',label:'Water drop',transform:{position:[.3,1,0],rotation:[0,.5,0],scale:[1.2,1.2,1.2]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'finite_drop',drop:{width:.6,samplesPerUnit:40}}});
const created=[];
const c={THREE,structuredClone,LOCAL_LIQUID_EMITTER_TYPE,LOCAL_LIQUID_EMITTER_SCHEMA,sceneObjects:[first],assertSceneConstructionAvailable(){},localLiquidSetup:{},makeSceneObjectId:()=> 'second',
 controls:{target:new THREE.Vector3()},localLiquidEmitterRecords:()=>[first],selectedWaterSource:()=>first,sceneObjectDisplayLabel:r=>r.label,
 createLocalLiquidEmitterSceneRecord,createLocalLiquidEmitterObject:(T,r)=>({object:{},record:r}),scene:{add(){}},registerSceneObject:(o,r)=>created.push(r),recordSceneObjectInsertion:async()=>{},syncLocalLiquidHostEmitters(){},setActiveSceneObject(){},setActiveTab(){},authoredWaterControls:null,sharedWorkbench:null,window:{_kaminosDirty(){}}};
vm.createContext(c);vm.runInContext(actual('addAuthoredWaterDrop'),c);await c.addAuthoredWaterDrop();
const second=created[0];
assert.deepEqual(second.localLiquidEmitter,first.localLiquidEmitter,'Add another water object must inherit the edited sampling and bounds, not silently introduce incompatible defaults');
assert.deepEqual(second.transform.scale,first.transform.scale,'World particle spacing also includes source scale');
assert.notEqual(second.label,first.label,'Multiple drops need distinguishable default names');
const can=html.match(/function canDuplicateObject\(entry\)\{[^\n]+/)[0];
Object.assign(c,{PROCEDURAL_MESH_TYPE:'procedural-mesh',CAMERA_TYPE:'camera'});vm.runInContext(can,c);
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
