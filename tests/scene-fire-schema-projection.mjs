// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
import * as fire from '../scene-fire-domain.mjs';
import {createSceneLoadRequests} from '../scene-load-generation.mjs';
import {resolveReactantCombustionConfig} from '../volume-reactant-combustion.mjs';
import {resolveTransportConfig,resolveImmersedSourceConfig,resolveInflowBoundaryConfig} from '../volume-core.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const start=html.indexOf('  if(restorePlan.fireSettings) {'),end=html.indexOf('  if (legacyBurner',start);assert.ok(start>=0&&end>start);
const additions=['volume-reaction-law','volume-reactant-mixing-time','volume-reactant-cooling-time','volume-physical-kelvin-per-heat','volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin','volume-appearance-model','volume-wavelet-turbulence','volume-wavelet-octaves','volume-wavelet-strength','volume-wavelet-octave1-weight','volume-wavelet-octave2-weight','volume-pressure-resolution','volume-reactant-soot-yield'];
test('observed pre-composition scene migrates independent soot history without altering authored values',()=>{
 const {settings}=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url)));
 const result=fire.projectFireSettingsToSchema(settings,schema);
 assert.equal(result.domControls['volume-reactant-soot-yield'].value,2);
 assert.equal(result.domControls['volume-world-smoke-intermediate'].value,'off');
 for(const e of schema.controls.filter(e=>e.additiveSinceControlCount>=269))assert.equal(result.domControls[e.key].value,e.additiveDefault);
 for(const entry of schema.controls)if(settings.domControls[entry.key])assert.deepEqual(result.domControls[entry.key],settings.domControls[entry.key]);
 const hole=structuredClone(settings);delete hole.domControls['volume-pressure-solver'];
 assert.throws(()=>fire.projectFireSettingsToSchema(hole,schema),/Missing authored fire control volume-pressure-solver/);
});
// Native74383 restore-diagnostic-r2 observed these three declared additions
// absent from an otherwise intact saved fire record (249 controls).
function oldSettings(){return{domControls:Object.fromEntries(schema.controls.filter(e=>!additions.includes(e.key)&&!e.key.startsWith('volume-world-smoke')&&!(e.additiveSinceControlCount>=269)).map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:e.additiveDefault??0}])),rendererControls:Object.fromEntries(schema.rendererControls.filter(e=>!['volume-ray-start-noise','volume-tone-mapping'].includes(e.key)).map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:e.key.endsWith('radius')?.03:e.key.endsWith('coherence')?2:0}])),presentationControls:Object.fromEntries(schema.presentationControls.map(e=>[e.key,{id:e.key,param:e.param,tagName:e.tagName,type:e.type,value:'on'}]))};}
for(const damaged of [false,true])test(`${damaged?'damaged':'old'} embedded fire state loads a warning-bearing preview instead of rejecting the scene`,async()=>{
 const saved=damaged?{}:oldSettings();if(!damaged)saved.domControls['volume-immersed-fuel'].value=.789012345;const before=structuredClone(saved);let written;const sceneLoadRequests=createSceneLoadRequests(),loadRequestId=sceneLoadRequests.begin();
 const fallback={domControls:{'volume-immersed-fuel':{value:.25}},source:{presetId:'preview',runtimeFallback:{}}};let warned;
 const context=vm.createContext({volumePrototype:null,DEFAULT_VOLUME_SCENE:'flame',volumePressureConfigForMode:()=>({pressureIterations:2}),flameSettingsState:s=>s,sceneLoadRequests,loadRequestId,restorePlan:{fireSettings:saved},flameEmitterPose:{position:[1,2,3]},activeVolumeSettingsPresetReceipt:null,runtimeFireSettings:fire.runtimeFireSettings,projectFireSettingsToSchema:fire.projectFireSettingsToSchema,fetch:async()=>({ok:true,json:async()=>schema}),loadAuthoredFlameBasin:async(id,options)=>{assert.equal(id,'@reactant-preview');assert.equal(options.sourceSize,'current');return structuredClone(fallback);},console:{warn:value=>warned=value},setInfo:()=>{},writeFlameSettingsState:state=>written=state});
 await vm.runInContext('(async()=>{'+html.slice(start,end)+'})()',context);
 assert.equal(written.domControls['volume-immersed-fuel'].value,.25);
 assert.match(warned,/SAVED FIRE REPLACED/);assert.equal(written.source.runtimeFallback.warning,warned);
 assert.deepEqual(saved,before,'source document remains unchanged');
});
test('schema projection keeps authored reactant values and refuses holes or unknown controls',()=>{
 const old=oldSettings(),before=structuredClone(old),projected=fire.projectFireSettingsToSchema(old,schema);assert.deepEqual(old,before);
 projected.domControls['volume-reaction-law'].value='reactant-v0';projected.domControls['volume-reactant-mixing-time'].value=4.567;
 const second=fire.projectFireSettingsToSchema(projected,schema);assert.equal(second.domControls['volume-reaction-law'].value,'reactant-v0');assert.equal(second.domControls['volume-reactant-mixing-time'].value,4.567);
 const hole=oldSettings();delete hole.domControls['volume-density'];assert.throws(()=>fire.projectFireSettingsToSchema(hole,schema),/Missing authored fire control volume-density/);
 const unknown=oldSettings();unknown.domControls['volume-not-declared']={value:1};assert.throws(()=>fire.projectFireSettingsToSchema(unknown,schema),/Unsupported authored fire control/);
 // A hole is not history: a record that still carries wavelet strength (introduced at 259) cannot be missing the pressure solver (212).
 const lateHole=oldSettings();delete lateHole.domControls['volume-pressure-solver'];assert.throws(()=>fire.projectFireSettingsToSchema(lateHole,schema),/Missing authored fire control volume-pressure-solver/);
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

test('runtime scene settings preserve current Reactant values but identify obsolete or damaged state for preview',()=>{
 const {settings:observed}=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url)));
 const projected=fire.projectFireSettingsToSchema(observed,schema);
 projected.domControls['volume-reaction-law'].value='reactant-v0';
 projected.domControls['volume-emitter-source-law'].value='immersed-source';
 projected.domControls['emitter-assay-family'].value='wick';
 projected.domControls['volume-appearance-model'].value='shred-only';
 projected.domControls['volume-advection-scheme'].value='maccormack';
 projected.domControls['volume-pressure-solver'].value='converged-open-top';
 projected.domControls['volume-projection'].value=1;
 const current=fire.runtimeFireSettings(projected,schema);
 assert.equal(current.reason,null);assert.deepEqual(current.settings,projected);
 for(const change of [s=>s.domControls['volume-reaction-law'].value='authored',s=>delete s.domControls['volume-reaction-law'],s=>delete s.domControls['volume-pressure-solver'],s=>s.domControls['volume-emitter-source-law'].value='legacy-volume',s=>{s.domControls['volume-advection-scheme'].value='legacy';s.domControls['volume-common-gas-transport'].value=false;}]){
  const old=structuredClone(projected);change(old);const before=structuredClone(old);
  const result=fire.runtimeFireSettings(old,schema);assert.equal(result.settings,null);assert.ok(result.reason);assert.deepEqual(old,before);
 }
 const transport=resolveTransportConfig({advectionScheme:'legacy',commonGasTransport:false});
 const rejected=resolveReactantCombustionConfig({reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source'},{transportCommonCharacteristic:transport.effective.commonCharacteristic});
 assert.equal(rejected.effective.reason,'reactant-law-requires-common-gas-transport');
});

test('runtime scene pressure admission agrees with production source and combustion resolvers',()=>{
 const {settings}=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url)));
 const current=fire.projectFireSettingsToSchema(settings,schema);
 for(const [id,value] of Object.entries({'volume-reaction-law':'reactant-v0','volume-emitter-source-law':'immersed-source','emitter-assay-family':'wick','volume-advection-scheme':'maccormack','volume-pressure-solver':'converged-open-top','volume-projection':1}))current.domControls[id].value=value;
 const cases=[{pressureSolver:'legacy'},{pressureSolver:'converged'},{projection:0},{projection:.001},{pressureIterations:0},{pressureSolver:'converged-open-top',projection:1,pressureIterations:2}];
 for(const patch of cases){
  const controls={emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',projection:1,...patch};
  const immersed=resolveImmersedSourceConfig(controls,{grid:32}).effective;
  const inflow=resolveInflowBoundaryConfig(controls,{sourceLaw:'inflow-boundary',family:'wick',inflow:{apertureKind:'disc',center:[0,0],sideAxis:[1,0],ringRadius:0,bandHalfWidth:.2,halfLength:0,inletVelocity:.1,fuelFraction:.5,inletTemperature:1}},{grid:32}).effective;
  const combustion=resolveReactantCombustionConfig({reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source'},{sourceAdmitted:immersed.admitted,transportCommonCharacteristic:true}).effective;
  assert.equal(immersed.admitted,inflow.admitted);assert.equal(combustion.admitted,immersed.admitted);
  for(const law of ['immersed-source','inflow-boundary']){
   const saved=structuredClone(current);saved.domControls['volume-emitter-source-law'].value=law;
   if(Object.hasOwn(patch,'pressureSolver'))saved.domControls['volume-pressure-solver'].value=patch.pressureSolver;
   if(Object.hasOwn(patch,'projection'))saved.domControls['volume-projection'].value=patch.projection;
   const result=fire.runtimeFireSettings(saved,schema,{pressureIterations:patch.pressureIterations});
   assert.equal(!!result.settings,immersed.admitted,JSON.stringify({law,patch,reason:result.reason}));
  }
 }
});
