// kaminos-test: node
import assert from 'node:assert/strict';
import * as water from '../authored-water-drop.mjs';
assert.equal(typeof water.inspectAuthoredWaterCompatibility,'function','Authored water must diagnose mismatched setup before allocating or pressing Play');
assert.equal(typeof water.planAuthoredWaterMatch,'function','Authored water must offer an explicit inspectable match plan');
const {inspectAuthoredWaterCompatibility:inspect,planAuthoredWaterMatch:plan}=water;
const source=(id,width=.6,samplesPerUnit=20,scale=1)=>({id,label:id,transform:{position:[id==='A'?-.6:.6,1,0],rotation:[0,0,0],scale:[scale,scale,scale]},localLiquidEmitter:{mode:'finite_drop',drop:{width,samplesPerUnit,container:{min:[-2,-1,-2],max:[2,3,2]}}}});
const a=source('A'),b=source('B',.6,30),before=JSON.stringify([a,b]);
assert.equal(inspect([a,b]).compatible,false);assert.match(inspect([a,b]).message,/B.*spacing/);
const p=plan([a,b],'A');assert.ok(Math.abs(p.spacing-.05)<1e-12);assert.equal(p.changes.length,1);assert.equal(p.changes[0].id,'B');assert.equal(p.changes[0].particleCount,1728);assert.ok(Math.abs(p.changes[0].worldWidth-.6)<1e-12);assert.equal(JSON.stringify([a,b]),before,'Planning cannot mutate sources');
const apply=(records,p)=>records.map(r=>({...r,localLiquidEmitter:p.changes.find(c=>c.id===r.id)?.settings??r.localLiquidEmitter}));
assert.equal(inspect(apply([a,b],p)).compatible,true);
const odd=source('B',.64,50,1.25),q=plan([a,odd],'A');assert.ok(Math.abs(q.changes[0].worldWidth-.8)<1e-12);assert.ok(Math.abs(q.changes[0].settings.drop.width-.64)<1e-12);assert.equal(q.changes[0].particleCount,4096);assert.equal(inspect(apply([a,odd],q)).compatible,true,'World spacing includes source scale');
const rounded=plan([a,source('B',.63,100/7)],'A').changes[0];assert.ok(Math.abs(rounded.worldWidth-.65)<1e-12);assert.equal(rounded.previousWorldWidth,.63);assert.equal(rounded.particleCount,2197,'Rounded width/count are explicit before matching');
const different=source('B');different.localLiquidEmitter.drop.container={min:[-3,-1,-2],max:[3,3,2]};assert.match(inspect([a,different]).message,/B.*container/);assert.equal(inspect(apply([a,different],plan([a,different],'A'))).compatible,true);
const off=source('B');off.localLiquidEmitter.drop={...off.localLiquidEmitter.drop,container:null,worldBounds:{min:[-2,-1,-2],max:[2,3,2]}};assert.equal(inspect([a,off]).compatible,false,'Wall enablement is shared as well as bounds');
const outside=source('B');outside.transform.position=[5,1,0];assert.throws(()=>plan([a,outside],'A'),/B.*fit/,'A match must not offer a later out-of-bounds release failure');
const {authoredDropSetup}=await import('../authored-water-host.mjs');assert.equal(authoredDropSetup(apply([a,b],p)).solver.particleCount,3456,'Matched plan reaches actual shared assembly');
assert.throws(()=>authoredDropSetup([a,b]),/B.*spacing/,'Backend guard names the actual source conflict');
console.log('Water compatibility and explicit matching preserve scale, report rounding, validate bounds and feed actual assembly');


// Actual authoring/history consumer: one explicit match, one Undo, one Redo.
const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
const THREE=await import('../lib/three.core.js');
const {createLocalLiquidEmitterObject,createLocalLiquidEmitterSceneRecord}=await import('../local-liquid-scene-object.mjs');
const {normalizeLocalLiquidEmitter,LOCAL_LIQUID_EMITTER_TYPE}=await import('../local-liquid-setup.mjs');
const {createSceneEdits}=await import('../scene-edit-session.mjs');
const rows=[a,source('B',.63,100/7)].map(r=>{const built=createLocalLiquidEmitterObject(THREE,createLocalLiquidEmitterSceneRecord({id:r.id,label:r.label,transform:r.transform,settings:{...r.localLiquidEmitter,schema:'kaminos.local-liquid-emitter.v1'}}));return {...built.record,object:built.object};});
const record=()=>rows.map(({object,...r})=>structuredClone(r));
const history=createSceneEdits({read:()=>null,write(){throw Error('Unexpected transform edit');}}),original=record();
const context={structuredClone,THREE,normalizeLocalLiquidEmitter,LOCAL_LIQUID_EMITTER_TYPE,sceneObjects:rows,planAuthoredWaterMatch:plan,assertSceneConstructionAvailable(){},localLiquidEmitterRecords:record,sceneObjectTransformState:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),serializeSceneObject:r=>({...r,object:undefined}),scenePlacementTools:{edits:history},localLiquidHost:null,createLocalLiquidEmitterObject,updateWaterSourceGuides(){},syncLocalLiquidHostEmitters(){},authoredWaterControls:null,authoredWaterState:record,window:{_kaminosDirty(){}}};
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('const waterSettingTargets='),end=html.indexOf('\nlet authoredWaterSimulationTarget',start);vm.createContext(context);vm.runInContext(html.slice(start,end),context);
context.matchAuthoredWaterSetup('A');assert.equal(history.state().undoCount,1);assert.equal(inspect(record()).compatible,true);assert.equal(rows[1].object.children.find(n=>n.userData.kaminosWaterPreview).count,2197);assert.deepEqual(record()[0],original[0],'Reference source remains untouched');const matched=record();
await history.undo();assert.deepEqual(record(),original,'Undo restores exact source settings and amount');assert.equal(inspect(record()).compatible,false);
await history.redo();assert.deepEqual(record(),matched);assert.equal(inspect(record()).compatible,true);assert.equal(authoredDropSetup(record()).solver.particleCount,3925);
