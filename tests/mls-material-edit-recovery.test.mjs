// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {normalizeLocalLiquidSetup,defaultLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {resolveAuthoredWaterSampling} from '../authored-water-drop.mjs';
import {authoredMlsMaterial} from '../authored-mls-water.mjs';
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
 const authoredWaterControls={refresh:()=>authoredMlsMaterial(records,localLiquidSetup)};
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
