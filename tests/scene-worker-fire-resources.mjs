// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {applySceneObjectTransformState,sceneObjectTransformState,getMaterialStateForObject} from '../scene-object-state.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {defaultLocalLiquidSetup,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';
const path=new URL('../scene-worker-fire-resources.mjs',import.meta.url);
const api=await import(path).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===path.href)return {};throw error;});
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const historicalBasin=JSON.parse(readFileSync(new URL('./fixtures/worker-fire-basin-1685273e.json',import.meta.url)));
const basin=JSON.parse(execFileSync('python3',['-c',`import json,sys,serve
artifact=json.load(sys.stdin)
payload,projection=serve.normalize_volume_settings_preset_payload(artifact['preset'],tolerate_foreign_controls=True)
artifact['preset']=payload;artifact['schemaProjection']=projection;artifact['controlCount']=payload['controlCount']
print(json.dumps(artifact))`],{cwd:new URL('..',import.meta.url),input:JSON.stringify(historicalBasin),encoding:'utf8'}));
const observed=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url))).settings;
const values=JSON.parse(readFileSync(new URL('./fixtures/volume-runtime-controls/page-b99.json',import.meta.url)))[0].expected;
const pose={position:[.2,.3,.4],rotation:[0,0,0],scale:[.5,.5,.5]};
function fixture({route={},realLoader=false,waterHost=null}={}){
 assert.equal(typeof api.createSceneWorkerFireResources,'function','common worker needs actual fire/source/domain construction');
 const calls=[],scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),objects=[],device={queue:{onSubmittedWorkDone:async()=>{}}};let controls={...values,emitterSourceLaw:'immersed-source',worldSmoke:'on'},active=false;
 const document=buildSceneDocument({objects:[{id:'source',type:'flame-emitter',source:FLAME_EMITTER_SOURCE,transform:pose}],fireSettings:observed,
  composition:{schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:basin.presetId,stationary:true},route:{volume_light_field:'1',...route},lightGainStops:0},flameDomainTranslation:[0,0,0]});
 const prepared={controls,settings:observed,presentation:'on',clamps:[],source:{presetId:'vsp-'+'a'.repeat(64)}};
 const ordinary={scene,camera,appearance:{applyStudio:()=>calls.push('studio')},workingScene:{objects},visible:()=>true,authored:{records:createSceneRecordOperations({readers:{transform:sceneObjectTransformState,materials:getMaterialStateForObject}})},frames:{consumeTransport(){},depth:()=>({device,camera,texture:{}})},
  registerSceneObject(object,metadata){const record=createSceneObjectRecord(object,metadata,{id:metadata.id});objects.push(record);return record;},lightingPreparation:{setExternalHold(){},request:async change=>change?.()},
  surfaceLighting:{},readSettings:()=>({gi:{mode:'combined',view:'scene'}}),bloom:{read:()=>({settings:{composeFlame:false}})},decorateOutput:node=>node,rebuildDisplay(){calls.push('display');}};
 const ctx={signal:new AbortController().signal,assertCurrent(){},report(){}};
 const volume={setSceneCompositionPresentation(value){assert.equal(active,false);calls.push(['transparent',value]);},isActive:()=>active,debugState:()=>({simulationPaused:false}),setControls:c=>calls.push(['controls',c]),
  setActive:async value=>{calls.push(['active',value]);active=value;},setVolumePrimitives:value=>calls.push(['primitives',value]),restoreWorldFrame:value=>calls.push(['world',value]),
  setImmersedSources:value=>calls.push(['sources',value]),relocateOrdinaryDomain:(...args)=>calls.push(['domain',...args]),setRaymarchSmokePresentationMode:mode=>({effectiveMode:mode}),
  setSceneTransportConsumer:value=>calls.push(['transport',value]),emissiveCameraState:()=>null};
 const input={THREE,scene,camera,sharedGpu:{device},renderResources:{renderer:{}},ordinary,payload:{location:{href:'http://localhost/?scene_worker=1'},admission:{data:document}},
  readFlameControls:()=>controls,applyFlameControls(next){calls.push(['accepted',next]);controls={...controls,...next};}};
 const options={settingsLoader:{prepare:async()=>prepared},mountRadiance:async mount=>{calls.push(['mount-device',mount.readResources().device]);mount.readResources().onStatus({status:'mounted'});return ({debugState(){throw Error('Resource-bearing debug is worker-local');},canRender:()=>true,dispose(){calls.push('radiance.dispose');},setGain(){},setSurfaceGain(){},setSurfaceScattering(){},setSmokeMode(){},setSourceSoftness(){},setDirections(value){calls.push(['directions',value]);},setAngularPattern(value){calls.push(['pattern',value]);},setShadowCasterLevel:async value=>calls.push(['casterLevel',value]),prepareShadowCasters:async()=>calls.push('casters')});}};
 if(waterHost)options.loadWaterHost=async()=>({createAuthoredWaterHost:async()=>waterHost});
 if(realLoader){delete options.settingsLoader;options.definitions=JSON.parse(execFileSync('python3',[new URL('../tools/scene-worker-control-definitions.py',import.meta.url).pathname,'--page',new URL('../index.html',import.meta.url).pathname])).controls;options.fetch=async url=>({ok:true,json:async()=>url.includes('schema')?schema:basin});}
 const resources=api.createSceneWorkerFireResources(input,options);
 return {resources,input,volume,ctx,calls,ordinary,document,plan:planSceneRestore(document),active:()=>active};
}
test('saved fire remains dormant until actual document roots and sources are installed',async()=>{
 const f=fixture();await f.resources.initialize(f.ctx);assert.equal(f.resources.initialVolumeActive,false);
 assert.ok(f.calls.some(row=>row[0]==='accepted'));await f.resources.prepareVolume({volume:f.volume,context:f.ctx});
 assert.equal(f.active(),false);assert.ok(f.calls.some(row=>row[0]==='world'));
 await f.resources.attachVolume({volume:f.volume,appHost:{},context:f.ctx});assert.equal(f.active(),false);
 const record=f.plan.flameSources[0];const root=await f.resources.loaders.flame(record,{context:f.ctx});
 assert.equal(root.parent,f.input.scene);assert.deepEqual(root.position.toArray(),pose.position);
 await f.resources.document.afterReplace(f.document,f.plan,{context:f.ctx,requestId:1});
 assert.equal(f.active(),true);const sources=f.calls.findLast(row=>row[0]==='sources')[1];
 assert.equal(sources.length,1);assert.equal(sources[0].id,'source');assert.equal(sources[0].worldSource,true);
 assert.equal(sources[0].controls.immersedCentreX,pose.position[0]);
 await f.resources.retire(f.ctx);assert.equal(f.active(),false);assert.ok(f.calls.includes('radiance.dispose'));
});
test('unmounted requested domains refuse before an authored replacement starts',()=>{
 const f=fixture();
 assert.throws(()=>f.resources.document.assertSupported({...f.document,postprocessing:{dof:{enabled:true}}},f.plan),/DOF/);
 assert.throws(()=>f.resources.assertRecordSupported({type:'ash',id:'ash'}),/not mounted|Unsupported/);
});
test('inactive ordinary source contribution exposes no private frame loop or fabricated water host',async()=>{
 const f=fixture();f.input.payload.admission=null;const r=api.createSceneWorkerFireResources(f.input,{settingsLoader:{prepare:async()=>null}});
 await r.initialize(f.ctx);assert.equal(r.initialVolumeActive,false);assert.equal(r.readDrawResources().waterFeature.host,null);
 assert.equal(r.readFrameState().simInputs.flame.active,false);await r.retire(f.ctx);
});

test('failed receiver construction retains the first actual placeholder allocation for retirement',async()=>{
 const f=fixture(),old=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};let created=0,destroyed=0;
 f.input.sharedGpu.device.createTexture=()=>{if(++created===2)throw Error('second placeholder refused');return {destroy(){destroyed++;}};};
 try{
  assert.throws(()=>f.resources.createFireLightReceiver(THREE.TSL.float(0),THREE.TSL.float(1),THREE.TSL.vec3(0,1,0)),/second placeholder refused/);
  await f.resources.retire(f.ctx);assert.equal(destroyed,1,'retirement must release the allocation made before constructor failure');
 }finally{if(old===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=old;}
});

// The pinned receipt is observed from the actual layered server store; fetch
// below is a local composition fixture, not a new HTTP conformance claim.
test('actual default loader maps the candidate composition route at boot and replacement',async()=>{
 const f=fixture({realLoader:true,route:{volume_light_field_grid:'8'}});await f.resources.initialize(f.ctx);
 let applied=f.calls.findLast(row=>row[0]==='accepted')[1];assert.equal(applied.fireLightField,true);assert.equal(applied.fireLightFieldGrid,8);
 const next=structuredClone(f.document);next.composition.route.volume_light_field='1';next.composition.route.volume_light_field_grid='12';const plan=planSceneRestore(next);
 await f.resources.document.prepareDocument(next,plan,{context:f.ctx});await f.resources.document.beforeReplace(next,plan,{context:f.ctx});
 applied=f.calls.findLast(row=>row[0]==='accepted')[1];assert.equal(applied.fireLightField,true);assert.equal(applied.fireLightFieldGrid,12);await f.resources.retire(f.ctx);
});
test('leaving a fire document rebuilds ordinary output and clears retired lighting status',async()=>{
 const f=fixture();await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});
 await f.resources.document.afterReplace(f.document,f.plan,{context:f.ctx});const before=f.calls.filter(row=>row==='display').length,studioBefore=f.calls.filter(row=>row==='studio').length;assert.equal(f.resources.readUi().fireLighting.status,'mounted');
 const next={version:8,objects:[],groups:[]},plan=planSceneRestore(next,{allowEmpty:true});
 await f.resources.document.prepareDocument(next,plan,{context:f.ctx});await f.resources.document.beforeReplace(next,plan,{context:f.ctx});await f.resources.document.afterReplace(next,plan,{context:f.ctx});
 assert.equal(f.resources.readFrameState().fireLightFieldRoute,false);assert.ok(f.calls.filter(row=>row==='display').length>before,'ordinary output must be rebuilt after the fire route is removed');assert.equal(f.resources.readUi().fireLighting,null);assert.ok(f.calls.filter(row=>row==='studio').length>studioBefore);await f.resources.retire(f.ctx);
});

test('hybrid lighting preserves route angular sampling and selects caster geometry before preparation',async()=>{
 const f=fixture({route:{volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_hybrid_light_directions:'8',volume_light_field_hybrid_light_pattern:'blue',volume_light_field_hybrid_caster_level:'5k'}});
 await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});await f.resources.document.afterReplace(f.document,f.plan,{context:f.ctx});
 assert.deepEqual(f.calls.findLast(row=>row[0]==='directions'),['directions',8]);assert.deepEqual(f.calls.findLast(row=>row[0]==='pattern'),['pattern','blue']);assert.deepEqual(f.calls.find(row=>row[0]==='casterLevel'),['casterLevel','5k']);assert(f.calls.findIndex(row=>row[0]==='casterLevel')<f.calls.indexOf('casters'));await f.resources.retire(f.ctx);
 const explicit=fixture({route:{volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_hybrid_light_directions:'8',volume_light_field_hybrid_light_pattern:'blue'}});
 explicit.document.postprocessing??={};explicit.document.postprocessing.fireLighting={'rendering-angular-samples':12,'rendering-angular-pattern':'spatial'};
 await explicit.resources.initialize(explicit.ctx);await explicit.resources.prepareVolume({volume:explicit.volume,context:explicit.ctx});await explicit.resources.document.afterReplace(explicit.document,planSceneRestore(explicit.document),{context:explicit.ctx});
 assert.deepEqual(explicit.calls.findLast(row=>row[0]==='directions'),['directions',12]);assert.deepEqual(explicit.calls.findLast(row=>row[0]==='pattern'),['pattern','spatial']);await explicit.resources.retire(explicit.ctx);
});

test('fire presentation uses the live shared-device owner supplied by the common constructor',async()=>{
 const f=fixture(),next={queue:{onSubmittedWorkDone:async()=>{}}};f.input.readSharedGpu=()=>({device:next,queue:next.queue});
 await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});await f.resources.document.afterReplace(f.document,f.plan,{context:f.ctx});
 assert.equal(f.calls.findLast(row=>row[0]==='mount-device')[1],next);await f.resources.retire(f.ctx);
});

test('actual authored water preview restores beside fire without allocating a water solver',async()=>{
 const f=fixture();const source=createLocalLiquidEmitterSceneRecord({id:'water-source',transform:{position:[.2,1,.1],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'finite_drop',drop:{width:.3,samplesPerUnit:8}}});
 f.document.objects.push(source);f.document.localLiquid=defaultLocalLiquidSetup();const plan=planSceneRestore(f.document);
 await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});
 await f.resources.document.prepareDocument(f.document,plan,{context:f.ctx});await f.resources.document.beforeReplace(f.document,plan,{context:f.ctx});
 await f.resources.loaders.flame(plan.flameSources[0],{context:f.ctx});const root=await f.resources.loaders.water(source,{context:f.ctx});
 await f.resources.document.afterReplace(f.document,plan,{context:f.ctx});const water=f.resources.commands['water.read'](null,f.ctx);
 assert.equal(root.parent,f.input.scene);assert.deepEqual(root.position.toArray(),source.transform.position);assert.equal(water.present,true);assert.equal(water.preview,true);assert.equal(water.paused,true);assert.equal(water.host,null);
 assert(root.children.some(node=>node.userData.kaminosWaterPreview&&node.visible));assert.equal(f.resources.readFrameState().simInputs.water.active,false);
 assert.equal(f.resources.readUi().water.preview,true);assert.equal(f.resources.readDrawResources().waterFeature.host,null);await f.resources.retire(f.ctx);
});


test('ordinary and fire replacements update the actual inactive volume surface presentation',async()=>{
 const {createKaminosVolumePrototype}=await import('../volume-core.js');
 const {createOffscreenVolumeSurface}=await import('../volume-runtime-surface.mjs');
 const f=fixture({realLoader:true});f.input.payload.admission=null;
 const r=api.createSceneWorkerFireResources(f.input,{definitions:JSON.parse(execFileSync('python3',[new URL('../tools/scene-worker-control-definitions.py',import.meta.url).pathname,'--page',new URL('../index.html',import.meta.url).pathname])).controls,fetch:async url=>({ok:true,json:async()=>url.includes('schema')?schema:basin})});
 await r.initialize(f.ctx);let transparent=null;
 const surface=createOffscreenVolumeSurface({canvas:{width:16,height:16,getContext(){throw Error('Unexpected GPU admission');}},readViewport:()=>({width:16,height:16}),onTransparent:value=>{transparent=value;}});
 const volume=createKaminosVolumePrototype({THREE,camera:f.input.camera,getControls:()=>({resolution:16}),presentationSurface:surface,...r.volumeOptions,frameScheduleOwner:'host',frameScheduler:{requestAnimationFrame(){throw Error('Unexpected frame admission');},cancelAnimationFrame(){}}});
 try{
  await r.prepareVolume({volume,context:f.ctx});assert.equal(transparent,false);assert.equal(volume.isActive(),false);
  const ordinary={version:8,objects:[],groups:[]};
  for(const [data,expected]of [[f.document,true],[ordinary,false],[f.document,true]]){
   const next=planSceneRestore(data,{allowEmpty:true});await r.document.prepareDocument(data,next,{context:f.ctx});await r.document.beforeReplace(data,next,{context:f.ctx});
   assert.equal(volume.isActive(),false);assert.equal(transparent,expected);assert.equal(volume.debugState().sceneCompositionPresentation.transparentCanvas,expected);
  }
 }finally{await r.retire(f.ctx);await volume.dispose();}
});


test('water admission validates source shape before mutating the existing scene',()=>{
 const f=fixture();const source=createLocalLiquidEmitterSceneRecord({id:'water-source',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'continuous',baseRadius:.08,strength:1.15,rate:1200}});
 const data={...f.document,objects:[...f.document.objects,source],localLiquid:defaultLocalLiquidSetup()},next=planSceneRestore(data);
 source.localLiquidEmitter.baseRadius=0;next.objects.find(row=>row.id===source.id).localLiquidEmitter.baseRadius=0;
 const before=f.calls.length;assert.throws(()=>f.resources.document.assertSupported(data,next),/baseRadius/);assert.equal(f.calls.length,before);assert.equal(f.resources.readDrawResources().waterFeature.setup,null);
});

test('reattachment prepares a replacement volume from the current authored plan without replaying startup',async()=>{
 const f=fixture();await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});
 const next=structuredClone(f.document),domain=next.objects.find(row=>row.type==='simulation-domain');domain.transform.position[0]=2;domain.simulation.followSource=false;const plan=planSceneRestore(next);assert.deepEqual(plan.flameDomainTranslation,[2,0,0]);
 await f.resources.document.prepareDocument(next,plan,{context:f.ctx});await f.resources.document.beforeReplace(next,plan,{context:f.ctx});
 await f.resources.loaders.flame(plan.flameSources[0],{context:f.ctx});await f.resources.document.afterReplace(next,plan,{context:f.ctx});
 const before=f.calls.length,restored=[];const volume={...f.volume,restoreWorldFrame:value=>restored.push(['world',value]),setVolumePrimitives:value=>restored.push(['primitives',value]),relocateOrdinaryDomain:(...value)=>restored.push(['domain',...value]),setImmersedSources:value=>restored.push(['sources',value])};
 await f.resources.prepareVolume({volume,context:f.ctx});
 assert.equal(typeof f.resources.reattachVolume,'function');await f.resources.reattachVolume({volume,context:f.ctx});
 assert.deepEqual(restored.find(row=>row[0]==='domain')[1],[2,0,0]);assert.equal(restored.filter(row=>row[0]==='world').length,1);assert.equal(restored.filter(row=>row[0]==='primitives').length,1);assert.equal(restored.find(row=>row[0]==='sources')[1][0].id,'source');
 assert.equal(f.calls.slice(before).some(row=>row[0]==='accepted'),false);assert.equal(f.ordinary.workingScene.objects.length,1);assert(f.calls.slice(before).some(row=>row[0]==='mount-device'));await f.resources.retire(f.ctx);
});

 test('fire read returns the already plain lighting status without exporting resource-bearing debug',async()=>{
 const f=fixture();try{await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});await f.resources.document.afterReplace(f.document,f.plan,{context:f.ctx});
 const result=f.resources.commands['fire.read'](null,f.ctx);assert.deepEqual(result.lighting,{status:'mounted'});assert.deepEqual(structuredClone(result),result);
 }finally{await f.resources.retire(f.ctx);}
});

 test('live source edits and captured fire settings preserve the current canonical fire owners',async()=>{
 const f=fixture();try{await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});const record=f.plan.flameSources[0],root=await f.resources.loaders.flame(record,{context:f.ctx});await f.resources.document.afterReplace(f.document,f.plan,{context:f.ctx});
 const pose={position:[1,.5,0],rotation:[0,0,0],scale:[.5,.5,.5]};f.resources.authoring.checkTransform(f.ordinary.workingScene.objects[0],pose);applySceneObjectTransformState(root,pose);f.resources.prepareFrame();
 assert.equal(f.calls.findLast(row=>row[0]==='sources')[1][0].controls.immersedCentreX,1);
 const values=f.resources.authoring.capture(),objects=f.ordinary.workingScene.objects.map(f.ordinary.authored.records.serialize);
 const captured=buildSceneDocument({...values,objects}),plan=planSceneRestore(captured);
 assert.deepEqual(plan.flameSources[0].transform,pose);assert.deepEqual(plan.fireSettings.domControls,observed.domControls);assert.deepEqual(values.flameDomainTranslation,[0,0,0]);
 f.input.applyFlameControls({density:987});assert.throws(()=>f.resources.authoring.capture(),/saving would lose/);
 }finally{await f.resources.retire(f.ctx);}
});

test('water transport uses its own visibility and opt-out rather than bloom composition',async()=>{
 const waterHost={paused:false,presentation:'full',supportsVolumeTransport:true,setPaused(){},setEmitters(){},setSetup(){},state:()=>({mode:'continuous',solver:{pending:true},clock:{backlogSeconds:.08}}),dispose(){}};
 const f=fixture({waterHost,route:{volume_light_field_scene_depth:'1'}}),hidden=new Set();f.ordinary.lighting={renderPipeline:{}};f.ordinary.visible=id=>!hidden.has(id);
 const source=createLocalLiquidEmitterSceneRecord({id:'flow',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'continuous',baseRadius:.08,strength:1.15,rate:100}});
 f.document.objects.push(source);f.document.localLiquid=defaultLocalLiquidSetup();const plan=planSceneRestore(f.document);
 try{await f.resources.initialize(f.ctx);await f.resources.prepareVolume({volume:f.volume,context:f.ctx});await f.resources.document.prepareDocument(f.document,plan,{context:f.ctx});await f.resources.document.beforeReplace(f.document,plan,{context:f.ctx});await f.resources.loaders.flame(plan.flameSources[0],{context:f.ctx});await f.resources.loaders.water(source,{context:f.ctx});await f.resources.document.afterReplace(f.document,plan,{context:f.ctx});
  const state=f.resources.readFrameState();assert.equal(state.transportRequired,true,'visible supported water uses transport with composeFlame false');assert.deepEqual(state.simInputs.water,{active:true,pending:true,backlogSeconds:.08});assert.equal(f.resources.readUi().surfaces.volume.visible,false);
  for(const composeFlame of [false,true]){f.ordinary.bloom.read=()=>({settings:{composeFlame}});hidden.add('water-field');assert.equal(f.resources.readFrameState().transportRequired,false);assert.equal(f.resources.readFrameState().simInputs.water.active,false);assert.equal(f.resources.readUi().surfaces.volume.visible,true,'hidden water must return fire to its native canvas');hidden.delete('water-field');assert.equal(f.resources.readFrameState().transportRequired,true);}
  hidden.delete('water-field');f.document.composition.route.volume_light_field_water_transport='0';await f.resources.document.afterReplace(f.document,planSceneRestore(f.document),{context:f.ctx});assert.equal(f.resources.readFrameState().transportRequired,false,'explicit optical opt-out remains authoritative');
 }finally{await f.resources.retire(f.ctx);}
});
