// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {readFileSync} from 'node:fs';
import {applySceneObjectTransformState,sceneObjectTransformState,getMaterialStateForObject} from '../scene-object-state.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';
const path=new URL('../scene-worker-fire-resources.mjs',import.meta.url);
const api=await import(path).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===path.href)return {};throw error;});
const observed=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url))).settings;
const values=JSON.parse(readFileSync(new URL('./fixtures/volume-runtime-controls/page-b99.json',import.meta.url)))[0].expected;
const pose={position:[.2,.3,.4],rotation:[0,0,0],scale:[.5,.5,.5]};
function fixture(){
 assert.equal(typeof api.createSceneWorkerFireResources,'function','common worker needs actual fire/source/domain construction');
 const calls=[],scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),objects=[],device={queue:{onSubmittedWorkDone:async()=>{}}};let controls={...values,emitterSourceLaw:'immersed-source',worldSmoke:'on'},active=false;
 const document=buildSceneDocument({objects:[{id:'source',type:'flame-emitter',source:FLAME_EMITTER_SOURCE,transform:pose}],fireSettings:observed,
  composition:{schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},route:{volume_light_field:'1'},lightGainStops:0},flameDomainTranslation:[0,0,0]});
 const prepared={controls,settings:observed,presentation:'on',clamps:[],source:{presetId:'vsp-'+'a'.repeat(64)}};
 const ordinary={scene,camera,workingScene:{objects},visible:()=>true,authored:{records:createSceneRecordOperations({readers:{transform:sceneObjectTransformState,materials:getMaterialStateForObject}})},frames:{consumeTransport(){},depth:()=>({device,camera,texture:{}})},
  registerSceneObject(object,metadata){const record=createSceneObjectRecord(object,metadata,{id:metadata.id});objects.push(record);scene.add(object);return record;},lightingPreparation:{setExternalHold(){},request:async change=>change?.()},
  surfaceLighting:{},readSettings:()=>({gi:{mode:'combined',view:'scene'}}),bloom:{read:()=>({settings:{composeFlame:false}})},decorateOutput:node=>node,rebuildDisplay(){calls.push('display');}};
 const ctx={signal:new AbortController().signal,assertCurrent(){},report(){}};
 const volume={isActive:()=>active,debugState:()=>({simulationPaused:false}),setControls:c=>calls.push(['controls',c]),
  setActive:async value=>{calls.push(['active',value]);active=value;},setVolumePrimitives:value=>calls.push(['primitives',value]),restoreWorldFrame:value=>calls.push(['world',value]),
  setImmersedSources:value=>calls.push(['sources',value]),relocateOrdinaryDomain:(...args)=>calls.push(['domain',...args]),setRaymarchSmokePresentationMode:mode=>({effectiveMode:mode}),
  setSceneTransportConsumer:value=>calls.push(['transport',value]),emissiveCameraState:()=>null};
 const input={THREE,scene,camera,sharedGpu:{device},renderResources:{renderer:{}},ordinary,payload:{location:{href:'http://localhost/?scene_worker=1'},admission:{data:document}},
  readFlameControls:()=>controls,applyFlameControls(next){calls.push(['accepted',next]);controls={...controls,...next};}};
 const resources=api.createSceneWorkerFireResources(input,{settingsLoader:{prepare:async()=>prepared},mountRadiance:async()=>({canRender:()=>true,dispose(){calls.push('radiance.dispose');},setGain(){},setSurfaceGain(){},setSurfaceScattering(){},setSmokeMode(){},setSourceSoftness(){},setDirections(){},setAngularPattern(){},prepareShadowCasters:async()=>calls.push('casters')})});
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
