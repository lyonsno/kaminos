// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {projectFireSettingsToSchema} from '../scene-fire-domain.mjs';
import experiment from '../experiments/material-hierarchy.experiment.mjs';
import {readAdaptiveMaterialControls,patchAdaptiveMaterialControls,hasAuthoredAdaptiveMaterial} from '../volume-adaptive-material-controls.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const values={'volume-adaptive-material':true,'volume-adaptive-budget':.75,'volume-adaptive-spread':.5,'volume-adaptive-max-detail':4,'volume-adaptive-persistence':2,'volume-adaptive-lookahead':1.25,'volume-adaptive-reaction-weight':0,'volume-adaptive-mixing-weight':1,'volume-adaptive-thermal-weight':.3,'volume-adaptive-smoke-weight':.1};
const descriptor=(id,value)=>({id,param:id.replaceAll('-','_'),tagName:'INPUT',type:typeof value==='boolean'?'checkbox':'number',value});
test('allocation policy is in the basin schema and the shared scene fire domain',()=>{
 for(const [id,value] of Object.entries(values)){
  const field=schema.controls.find(f=>f.key===id);assert.ok(field,`missing saved allocation control ${id}`);
  assert.equal(field.type,typeof value==='boolean'?'checkbox':'number');
 }
 const settings={domControls:Object.fromEntries(Object.entries(values).map(([id,value])=>[id,descriptor(id,value)])),rendererControls:{},presentationControls:{}};
 const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
 for(const enabled of [true,false]){
  settings.domControls['volume-adaptive-material'].value=enabled;
  const doc=JSON.parse(JSON.stringify(buildSceneDocument({objects:[],composition,fireSettings:settings})));
  assert.deepEqual(doc.objects.find(o=>o.type==='simulation-domain').simulation.settings,settings.domControls);
  assert.deepEqual(planSceneRestore(doc).fireSettings,settings);
 }
});
test('saved disabled policy is authored, but defaults projected into an old basin are not',()=>{
 const preset={domControls:{'volume-adaptive-material':descriptor('volume-adaptive-material',false)}};
 assert.equal(hasAuthoredAdaptiveMaterial({preset}),true);
 assert.equal(hasAuthoredAdaptiveMaterial({preset,serverProjection:{defaultsApplied:['volume-adaptive-material']}}),false);
 assert.equal(hasAuthoredAdaptiveMaterial({preset,retirementMigration:{addedControlIds:['volume-adaptive-material']}}),false);
 assert.equal(hasAuthoredAdaptiveMaterial({preset:{domControls:{}}}),false);
});
test('allocation patches preserve zero values and unrelated controls and reject invalid policy without mutation',()=>{
 const controls=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,descriptor(id,value)]));
 controls['volume-wind']=descriptor('volume-wind',2);
 const before=structuredClone(controls);
 const patched=patchAdaptiveMaterialControls(controls,{enabled:false,options:{budget:0,lookahead:0,weights:{reaction:0,smoke:0}}});
 const state=readAdaptiveMaterialControls(patched);
 assert.equal(state.enabled,false);assert.equal(state.options.budget,0);assert.equal(state.options.lookahead,0);assert.equal(state.options.weights.smoke,0);
 assert.equal(patched['volume-wind'].value,2);assert.deepEqual(controls,before);
 assert.throws(()=>patchAdaptiveMaterialControls(controls,{options:{maxDetail:1.5}}),/maxDetail/);
 assert.throws(()=>patchAdaptiveMaterialControls(controls,{options:{weights:{reaction:-1}}}),/weight reaction/);
 assert.deepEqual(controls,before);
});
test('old observed scene gains disabled allocation defaults without replacing its authored values',()=>{
 const {settings}=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url)));
 const next=projectFireSettingsToSchema(settings,schema);
 assert.equal(next.domControls['volume-adaptive-material']?.value,false);
 for(const id of Object.keys(values))assert.ok(next.domControls[id],id);
 for(const [id,value] of Object.entries(settings.domControls))if(next.domControls[id])assert.deepEqual(next.domControls[id],value);
});
test('the experiment edits domain state, respects saved disabled state and leaves simulation alive on close',async()=>{
 let state={enabled:false,options:{budget:.75,spread:.5,maxDetail:4,persistence:2,lookahead:1,weights:{reaction:0,mixing:1,thermal:.3,smoke:.1}}},writes=0,directRuntimeWrites=0;
 const host={controls:{document:{defaultView:{__kaminosVolumePrototype:{configureAdaptiveMaterial(){directRuntimeWrites++;},adaptiveMaterialState:()=>({effective:null})}}}},
  scene:{open:async()=>({attach:async()=>({id:'test-overlay'}),onFrame:()=>()=>{},dispose:async()=>{},redraw(){}})},
  fire:{adaptiveMaterial:{read:()=>structuredClone(state),adopt:()=>false,set:patch=>{state={...state,...patch,options:{...state.options,...patch.options,weights:{...state.options.weights,...patch.options?.weights}}};writes++;return structuredClone(state);}}}};
 const instance=await experiment.create({host,inputs:{enabled:true,options:{budget:8}},record(){},updateInputs(){}});
 assert.equal(instance.read().enabled,false,'stale experiment URL must not replace saved disabled state');
 assert.equal(instance.read().requested.budget,.75);
 instance.operations.setOptions({lookahead:2,weights:{reaction:.25}});
 assert.equal(state.options.lookahead,2);assert.equal(state.options.weights.reaction,.25);assert.equal(writes,1);
 // Loading another basin while the panel is open becomes visible immediately.
 state={...state,enabled:true,options:{...state.options,budget:0}};
 assert.equal(instance.read().enabled,true);assert.equal(instance.read().requested.budget,0);
 await instance.dispose();assert.equal(directRuntimeWrites,0,'the panel never owns the runtime lifetime');assert.equal(state.enabled,true);
});
test('legacy adoption waits for basin admission and preserves authored disabled policy',async()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function readAdaptiveMaterialSettings()'),html.indexOf('function readVolumeDomControls()'));
 for(const authored of [false,true]){
  const controls=Object.fromEntries(schema.controls.filter(f=>f.key.startsWith('volume-adaptive-')).map(f=>[f.key,descriptor(f.key,f.additiveDefault)]));
  const context=vm.createContext({window:{},volumePrototype:null,adaptiveMaterialSettingsAuthored:false,
   ADAPTIVE_MATERIAL_FIELDS:(await import('../volume-adaptive-material-controls.mjs')).ADAPTIVE_MATERIAL_FIELDS,
   readAdaptiveMaterialControls,patchAdaptiveMaterialControls,
   document:{getElementById:id=>controls[id]},readVolumeDomControlValue:el=>el.value,
   readVolumeDomControls:()=>controls,setVolumeControlValue:(id,value)=>{controls[id].value=value;}});
  vm.runInContext(source,context);
  let initialized;const ready=new Promise(resolve=>{initialized=resolve;});
  const host={volume:{ready},controls:{document:{defaultView:{}}},
   fire:{adaptiveMaterial:{read:context.readAdaptiveMaterialSettings,set:context.setAdaptiveMaterialSettings,adopt:context.adoptAdaptiveMaterialExperiment}},
   scene:{open:async()=>({attach:async()=>({id:'overlay'}),onFrame:()=>()=>{},dispose:async()=>{},redraw(){}})}};
  const pending=experiment.create({host,inputs:{enabled:true,options:{budget:.75}},record(){},updateInputs(){}});
  await new Promise(resolve=>setImmediate(resolve));
  // Finish the delayed basin's canonical control application, as startup does.
  for(const f of schema.controls.filter(f=>f.key.startsWith('volume-adaptive-')))controls[f.key].value=f.additiveDefault;
  if(authored)controls['volume-adaptive-budget'].value=0;
  context.adaptiveMaterialSettingsAuthored=authored;initialized();
  const instance=await pending,state=instance.read();
  assert.equal(state.enabled,!authored);assert.equal(state.requested.budget,authored?0:.75);
  await instance.dispose();
 }
});
test('saving with the allocation panel open does not serialize its temporary refinement boxes',async()=>{
 const scene=new THREE.Scene(),rows=[],camera=new THREE.PerspectiveCamera(),controls={target:new THREE.Vector3(),update(){}};
 const sceneHost=createWorkbenchSceneHost({scene,camera,controls,
  registerObject:(object,metadata)=>{const row={...metadata,id:'refinement-overlay',object};rows.push(row);return row;},
  findObject:object=>rows.find(row=>row.object===object),removeObject:()=>{},
  redraw(){},onFrame:()=>()=>{},loadAsset:()=>{throw Error('No assets required');}});
 const policy=readAdaptiveMaterialControls(Object.fromEntries(Object.entries(values).map(([id,value])=>[id,descriptor(id,value)])));
 const host={scene:sceneHost,volume:{ready:Promise.resolve()},controls:{document:{defaultView:{}}},
  fire:{adaptiveMaterial:{read:()=>policy,adopt(){},set(){}}}};
 const instance=await experiment.create({host,inputs:{overlay:true},record(){},updateInputs(){}});
 try {
  assert.equal(scene.children.length,1,'refinement guides are attached for display');
  const saved=buildSceneDocument({objects:rows.map(({object,...record})=>record)});
  assert.deepEqual(saved.objects,[],'display-only refinement guides must not become reloadable scene assets');
 } finally {await instance.dispose();}
 assert.equal(scene.children.length,0,'closing the editor removes its display-only guides');
});
