// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
import * as fire from '../scene-fire-domain.mjs';
import {createSceneLoadRequests} from '../scene-load-generation.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const start=html.indexOf('  if(restorePlan.fireSettings) {'),end=html.indexOf('  if (legacyBurner',start);assert.ok(start>=0&&end>start);
const additions=['volume-reaction-law','volume-reactant-mixing-time','volume-reactant-cooling-time','volume-physical-kelvin-per-heat','volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin'];
// Native74383 restore-diagnostic-r2 observed these three declared additions
// absent from an otherwise intact saved fire record (249 controls).
function oldSettings(){return{domControls:Object.fromEntries(schema.controls.filter(e=>!additions.includes(e.key)).map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:e.additiveDefault??0}])),rendererControls:Object.fromEntries(schema.rendererControls.filter(e=>!['volume-ray-start-noise','volume-tone-mapping'].includes(e.key)).map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:e.key.endsWith('radius')?.03:e.key.endsWith('coherence')?2:0}])),presentationControls:Object.fromEntries(schema.presentationControls.map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:'on'}]))};}
test('older fire records receive only declared schema additions before application',async()=>{
 const saved=oldSettings(),before=structuredClone(saved);saved.domControls['volume-immersed-fuel'].value=.789012345;before.domControls['volume-immersed-fuel'].value=.789012345;let written;const sceneLoadRequests=createSceneLoadRequests(),loadRequestId=sceneLoadRequests.begin();
 const context=vm.createContext({sceneLoadRequests,loadRequestId,restorePlan:{fireSettings:saved},flameEmitterPose:{position:[1,2,3]},activeVolumeSettingsPresetReceipt:null,projectFireSettingsToSchema:fire.projectFireSettingsToSchema,fetch:async()=>({ok:true,json:async()=>schema}),writeFlameSettingsState:state=>written=state});
 await vm.runInContext('(async()=>{'+html.slice(start,end)+'})()',context);
 for(const id of additions)assert.equal(written.domControls[id]?.value,schema.controls.find(e=>e.key===id).additiveDefault,id+' must migrate before strict application');
 assert.equal(written.domControls['volume-immersed-fuel'].value,.789012345,'saved feed precision stays exact');assert.deepEqual(saved,before,'source document remains unchanged');
});
test('schema projection keeps authored reactant values and refuses holes or unknown controls',()=>{
 const old=oldSettings(),before=structuredClone(old),projected=fire.projectFireSettingsToSchema(old,schema);assert.deepEqual(old,before);
 projected.domControls['volume-reaction-law'].value='reactant-v0';projected.domControls['volume-reactant-mixing-time'].value=4.567;
 const second=fire.projectFireSettingsToSchema(projected,schema);assert.equal(second.domControls['volume-reaction-law'].value,'reactant-v0');assert.equal(second.domControls['volume-reactant-mixing-time'].value,4.567);
 const hole=oldSettings();delete hole.domControls['volume-density'];assert.throws(()=>fire.projectFireSettingsToSchema(hole,schema),/Missing authored fire control volume-density/);
 const unknown=oldSettings();unknown.domControls['volume-not-declared']={value:1};assert.throws(()=>fire.projectFireSettingsToSchema(unknown,schema),/Unsupported authored fire control/);
});

test('a superseded scene cannot apply a late schema response',async()=>{
 const sceneLoadRequests=createSceneLoadRequests(),loadRequestId=sceneLoadRequests.begin();let release,writes=0;const response=new Promise(resolve=>release=resolve);
 const c=vm.createContext({sceneLoadRequests,loadRequestId,restorePlan:{fireSettings:oldSettings()},flameEmitterPose:{position:[0,0,0]},activeVolumeSettingsPresetReceipt:null,projectFireSettingsToSchema:fire.projectFireSettingsToSchema,fetch:()=>response,writeFlameSettingsState:()=>writes++});
 const pending=vm.runInContext('(async()=>{'+html.slice(start,end)+'})()',c);sceneLoadRequests.invalidate();release({ok:true,json:async()=>schema});await pending;assert.equal(writes,0,'obsolete load must not publish fire settings');
});

test('older rendering inventories gain only declared auxiliary defaults',()=>{
 const saved=oldSettings();saved.rendererControls=Object.fromEntries(schema.rendererControls.filter(e=>!['volume-ray-start-noise','volume-tone-mapping'].includes(e.key)).map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:e.key.endsWith('strength')?.123456789:1}]));saved.presentationControls=Object.fromEntries(schema.presentationControls.map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:'on'}]));const before=structuredClone(saved),projected=fire.projectFireSettingsToSchema(saved,schema);
 for(const e of schema.rendererControls.filter(e=>['volume-ray-start-noise','volume-tone-mapping'].includes(e.key)))assert.equal(projected.rendererControls[e.key]?.value,e.additiveDefault,e.key+' gains its declared schema default');
 assert.equal(projected.rendererControls['volume-flow-kernel-strength'].value,.123456789);assert.deepEqual(saved,before);
 const hole=structuredClone(saved),requiredSchema=structuredClone(schema);delete hole.rendererControls['volume-flow-kernel-strength'];delete requiredSchema.rendererControls.find(e=>e.key==='volume-flow-kernel-strength').additiveDefault;assert.throws(()=>fire.projectFireSettingsToSchema(hole,requiredSchema),/Missing authored fire control volume-flow-kernel-strength/,'local policy refuses missing controls without a declared default');
 const unknown=structuredClone(saved);unknown.rendererControls.unrecognized={value:1};assert.throws(()=>fire.projectFireSettingsToSchema(unknown,schema),/Unsupported authored fire control unrecognized/);
});
