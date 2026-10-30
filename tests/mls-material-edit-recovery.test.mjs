// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {normalizeLocalLiquidSetup,defaultLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {resolveAuthoredWaterSampling} from '../authored-water-drop.mjs';
import {authoredMlsMaterial,inspectAuthoredMlsMaterial,authoredMlsSetup} from '../authored-mls-water.mjs';
// Exercise the actual editor function and history, substituting only scene/GPU
// consumers. Invalid material must never be installed or strand a transaction.
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function editAuthoredWaterSimulation('),html.indexOf('async function addAuthoredWaterDrop('));
const records=[{id:'drop',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.5,samplesPerUnit:20}}}];
const setup=normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),waterSampling:{spacing:.05,container:null},mlsMaterial:{pressureWaveSpeed:2,kinematicViscosity:.0005}});
const make=new Function('setup','records','createSceneEdits','normalizeLocalLiquidSetup','resolveAuthoredWaterSampling','authoredMlsMaterial',`
 let localLiquidSetup=structuredClone(setup),authoredWaterSimulationTarget=false;
 const assertSceneConstructionAvailable=()=>{},localLiquidEmitterRecords=()=>records;
 const workingScene={objects:[]},LOCAL_LIQUID_EMITTER_TYPE='local-liquid-emitter';
 const scenePlacementTools={edits:createSceneEdits({read:()=>{},write:()=>{}})};
 const syncLocalLiquidHostEmitters=()=>{},updateAuthoringPropertySelection=()=>{},window={};
 const authoredWaterControls={refresh:()=>{}};
 ${source}
 return {edit:editAuthoredWaterSimulation,read:()=>structuredClone(localLiquidSetup),history:scenePlacementTools.edits};
`);
const app=make(setup,records,createSceneEdits,normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,authoredMlsMaterial);
for(const pressureWaveSpeed of [1e20,1e-30]){
 const before=app.read();
 assert.throws(()=>app.edit({mlsMaterial:{pressureWaveSpeed,kinematicViscosity:0}}),/f32 capacity/);
 assert.deepEqual(app.read(),before,'Rejected coefficients must leave shared setup unchanged');
 assert.equal(app.history.state().active,null,'Rejected coefficients must not strand scene history');
 assert.doesNotThrow(()=>authoredMlsMaterial(records,app.read()));
 app.edit({mlsMaterial:{pressureWaveSpeed:3,kinematicViscosity:.001}});
 assert.equal(app.history.undo(),true);
 assert.deepEqual(app.read().mlsMaterial,before.mlsMaterial);
}
// Viscosity scales inversely with h^(3/2): a material representable on this
// coarse grid overflows when the same sources use a finer grid.
app.edit({mlsMaterial:{pressureWaveSpeed:2,kinematicViscosity:1e37}});
const before=app.read();
assert.throws(()=>app.edit({waterSampling:{...before.waterSampling,particleTarget:1000000}}),/f32 capacity/);
assert.deepEqual(app.read(),before);
assert.equal(app.history.state().active,null);
app.edit({mlsMaterial:null});assert.equal(app.history.undo(),true);
assert.deepEqual(app.read().mlsMaterial,before.mlsMaterial);
console.log('Rejected MLS coefficients preserve shared setup, inspector reads, next edit and Undo');

// Source width changes the cell size at a fixed particle target. Validate before
// the source transaction starts, including the shared sampling it will install.
const {normalizeLocalLiquidEmitter}=await import('../local-liquid-setup.mjs');
const sourceEdits=html.slice(html.indexOf('const waterSettingTargets=new Set();'),html.indexOf('function replaceAuthoredWaterPreviewChildren('));
const makeSources=new Function('setup','records','createSceneEdits','normalizeLocalLiquidSetup','normalizeLocalLiquidEmitter','resolveAuthoredWaterSampling','authoredMlsMaterial',`
 let localLiquidSetup=structuredClone(setup);
 const workingScene={objects:structuredClone(records).map(r=>({...r,object:{pose:r.transform,userData:{kaminosSceneObject:{}}}}))};
 const LOCAL_LIQUID_EMITTER_TYPE='local-liquid-emitter',THREE={},window={};
 const localLiquidEmitterRecords=()=>workingScene.objects.map(({object,...r})=>r),sceneObjectTransformState=o=>o.pose;
 const assertSceneConstructionAvailable=()=>{},serializeSceneObject=r=>r,replaceAuthoredWaterPreviewChildren=()=>{};
 const createLocalLiquidEmitterObject=()=>({object:{}}),syncLocalLiquidHostEmitters=()=>{},updateAuthoringPropertySelection=()=>{};
 const authoredWaterControls={refresh:()=>{}};
 const scenePlacementTools={edits:createSceneEdits({read:()=>{},write:()=>{}})};
 ${sourceEdits}
 return {edit:applyAuthoredWaterSettings,read:()=>({setup:structuredClone(localLiquidSetup),records:localLiquidEmitterRecords()}),history:scenePlacementTools.edits};
`);
const sourceSetup=normalizeLocalLiquidSetup({...setup,waterSampling:{spacing:.05,particleTarget:1000,container:null},mlsMaterial:{pressureWaveSpeed:2,kinematicViscosity:1e37}});
const sources=makeSources(sourceSetup,records,createSceneEdits,normalizeLocalLiquidSetup,normalizeLocalLiquidEmitter,resolveAuthoredWaterSampling,authoredMlsMaterial);
const original=structuredClone(sources.read());
assert.throws(()=>sources.edit('drop',{drop:{...records[0].localLiquidEmitter.drop,width:.1}}),/f32 capacity/);
assert.deepEqual(sources.read(),original,'Rejected source width must preserve source and shared sampling');
assert.equal(sources.history.state().active,null);
assert.doesNotThrow(()=>authoredMlsMaterial(sources.read().records,sources.read().setup));
sources.edit('drop',{drop:{...records[0].localLiquidEmitter.drop,width:.6}});
assert.equal(sources.history.undo(),true);
assert.equal(sources.read().records[0].localLiquidEmitter.drop.width,.5);
// Membership and native transforms can change resolution independently of this
// inspector. An already unrepresentable scene must still allow material repair.
const invalid=make({...sourceSetup,waterSampling:{...sourceSetup.waterSampling,particleTarget:1000000}},records,createSceneEdits,normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,authoredMlsMaterial);
assert.doesNotThrow(()=>invalid.edit({mlsMaterial:null}));
assert.equal(invalid.read().mlsMaterial,undefined);

// History restores authored proposals, including non-executable ones. This is
// the actual simulation target/history; the scale target substitutes only the
// native scene transform writer (exercised separately in the browser).
const scaledRecords=structuredClone(records);
const recovery=make(sourceSetup,scaledRecords,createSceneEdits,normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,authoredMlsMaterial);
recovery.history.register('@scale',{read:()=>scaledRecords[0].transform,write:pose=>{scaledRecords[0].transform=pose;}});
const check=(executable,undoCount,redoCount)=>{
 const read=inspectAuthoredMlsMaterial(scaledRecords,recovery.read());
 assert.equal(read.executable,executable);
 assert.deepEqual(recovery.history.state(),{active:null,undoCount,redoCount,replaying:false});
 if(!executable){assert.match(read.error,/f32 capacity/);assert.equal(read.kinematicViscosity,1e37);assert.throws(()=>authoredMlsSetup(scaledRecords,recovery.read()),/f32 capacity/);}
};
recovery.history.apply('@scale',{scale:[.2,.2,.2]});check(false,1,0);
recovery.edit({mlsMaterial:null});check(true,2,0);
assert.equal(recovery.history.undo(),true);check(false,1,1);
assert.equal(recovery.history.undo(),true);check(true,0,2);
assert.equal(recovery.history.redo(),true);check(false,1,1);
assert.equal(recovery.history.redo(),true);check(true,2,0);

// Fixing the same invalid proposal by enlarging its source must also be undoable.
const smallRecords=structuredClone(records);smallRecords[0].transform.scale=[.2,.2,.2];
const sourceRepair=makeSources(sourceSetup,smallRecords,createSceneEdits,normalizeLocalLiquidSetup,normalizeLocalLiquidEmitter,resolveAuthoredWaterSampling,authoredMlsMaterial);
sourceRepair.edit('drop',{drop:{...smallRecords[0].localLiquidEmitter.drop,width:2.5}});
assert.equal(inspectAuthoredMlsMaterial(sourceRepair.read().records,sourceRepair.read().setup).executable,true);
assert.equal(sourceRepair.history.undo(),true);
assert.equal(inspectAuthoredMlsMaterial(sourceRepair.read().records,sourceRepair.read().setup).executable,false);
assert.equal(sourceRepair.history.redo(),true);
assert.equal(inspectAuthoredMlsMaterial(sourceRepair.read().records,sourceRepair.read().setup).executable,true);
assert.equal(sourceRepair.history.state().active,null);
