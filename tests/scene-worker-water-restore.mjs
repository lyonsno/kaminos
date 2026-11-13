// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneLightingGraph} from '../scene-lighting-graph.mjs';
import {buildSceneDocument} from '../scene-persistence-core.js';
import {defaultLocalLiquidSetup,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
import {resolveAuthoredWaterSampling,describeAuthoredWaterDrop} from '../authored-water-drop.mjs';
registerHooks({resolve(specifier,context,next){const alias={'three':'../lib/three.webgpu.js','three/webgpu':'../lib/three.webgpu.js','three/tsl':'../lib/three.tsl.js'}[specifier];return alias?{url:new URL(alias,import.meta.url).href,shortCircuit:true}:next(specifier,context);}});
const {createSceneWorkerSceneResources}=await import('../scene-worker-scene-resources.mjs');
const {createSceneWorkerFireResources}=await import('../scene-worker-fire-resources.mjs');
const source=(id,width,samplesPerUnit)=>createLocalLiquidEmitterSceneRecord({id,transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'finite_drop',drop:{width,samplesPerUnit}}});
function fixture(data,domainOptions={}){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),retained=[];let domains;
 const ctx={signal:new AbortController().signal,assertCurrent(){},report(){}};
 const renderer={toneMappingExposure:1,capabilities:{getMaxAnisotropy:()=>8},isWebGPURenderer:true,hasFeature:()=>false,getDrawingBufferSize:v=>v.set(32,32),library:{fromMaterial:material=>material},backend:{get:()=>({texture:{}})}};
 const target=()=>({texture:new THREE.Texture(),dispose(){}});
 const renderResources={renderer,pmremGenerator:{fromScene:target,fromEquirectangular:target},lighting:null,
  initializeLighting(){return this.lighting=createSceneLightingGraph({...shell.lightingOptions,THREE,scene,camera,renderer,retain:value=>retained.push(value)});},resize(){}};
 const device={queue:{onSubmittedWorkDone:async()=>{}}};
 const shell=createSceneWorkerSceneResources({THREE,scene,camera,renderResources,sharedGpu:{device,queue:device.queue},viewport:()=>({width:32,height:32,pixelRatio:1}),
  payload:{location:{href:'http://localhost/?scene_worker=1'},admission:{data},flameControls:{}},readFlameControls:()=>({resolution:16}),applyFlameControls(){},readAppHost:()=>null,
  services:{loadHDR:async()=>new THREE.Texture()},createDomains:input=>(domains=createSceneWorkerFireResources(input,domainOptions))});
 const volume={isActive:()=>false,setActive:async()=>{},setSceneCompositionPresentation(){},setVolumePrimitives(){},restoreWorldFrame(){},relocateOrdinaryDomain(){},setImmersedSources(){},setSceneLightingRebuildPending(){}};
 return {shell,scene,ctx,volume,device,renderer,get domains(){return domains;},async retire(){await shell.retire(ctx);while(retained.length)await retained.pop().dispose?.();}};
}
for(const cached of [false,true])test(`actual document restoration constructs all finite previews at canonical shared sampling (cached target: ${cached})`,async()=>{
 const objects=[source('small',.25,8),source('large',.5,4)],setup=defaultLocalLiquidSetup();
 if(cached)setup.waterSampling={spacing:.25,particleTarget:72,container:{min:[-2,-1,-2],max:[2,3,2]}};
 const data=buildSceneDocument({objects,localLiquid:setup,selectionIds:['large'],activeObjectId:'large',environment:{name:'neutral'},editorDisplay:{hiddenIds:['large']}}),f=fixture(data);
 try{
  await f.shell.initialize(f.ctx);await f.shell.prepareVolume({volume:f.volume,context:f.ctx});await f.shell.attachVolume({volume:f.volume,context:f.ctx});
  const expectedSampling=resolveAuthoredWaterSampling(objects,setup),water=f.shell.commands['water.read'](null,f.ctx);
  assert.equal(water.preview,true);assert.equal(water.host,null);
  for(const record of objects){const entry=f.shell.ordinary.workingScene.find(record.id),preview=entry.object.children.find(node=>node.userData.kaminosWaterPreview),expected=describeAuthoredWaterDrop(record.localLiquidEmitter.drop,record.transform,expectedSampling);
   assert.equal(preview.userData.initialParticleCount,expected.particleCount,record.id+' must use shared initial particle count');assert.equal(preview.userData.spacing*entry.object.scale.x,expected.spacing,record.id+' must use shared world spacing');assert.deepEqual(entry.object.position.toArray(),record.transform.position);assert.equal(preview.visible,record.id!=='large');
  }
  assert.deepEqual(f.shell.ordinary.workingScene.selection.ids,['large']);
  const prior=f.shell.ordinary.workingScene.find('small').object.children.find(node=>node.userData.kaminosWaterPreview);let geometryDisposed=0,materialDisposed=0;prior.geometry.addEventListener('dispose',()=>geometryDisposed++);prior.material.addEventListener('dispose',()=>materialDisposed++);
  await f.shell.commands['scene.applyDocument']({document:data},f.ctx);assert.equal(geometryDisposed,1);assert.equal(materialDisposed,1);assert.deepEqual(f.shell.ordinary.workingScene.selection.ids,['large']);
 }finally{await f.retire();}
});

// These exercise the real document/domain/draw owners with an injected host
// boundary. Native MLS/GPU conformance is a separate consumer witness.
function hostLoader(){
 const mounts=[];
 return {mounts,loadWaterHost:async()=>({async createAuthoredWaterHost(options){
  let paused=false,disposed=0,records=structuredClone(options.emitters),frames=0,syncs=0;
  const host={get paused(){return paused;},setPaused(value){paused=value;},setEmitters(value){syncs++;records=structuredClone(value);},setSetup(){},render(){frames++;},
   state:()=>({mode:options.emitters.some(r=>r.localLiquidEmitter.mode==='finite_drop')?'finite_drop':'continuous',paused,frameCount:frames,sourceIds:records.map(r=>r.id)}),dispose(){disposed++;}};
  mounts.push({options,host,get records(){return records;},get syncs(){return syncs;},get disposed(){return disposed;}});return host;
 }})};
}
async function initialize(f){await f.shell.initialize(f.ctx);await f.shell.prepareVolume({volume:f.volume,context:f.ctx});await f.shell.attachVolume({volume:f.volume,context:f.ctx});}
const flow=()=>createLocalLiquidEmitterSceneRecord({id:'flow',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'continuous',baseRadius:.08,strength:1.15,rate:100}});
const waterDocument=objects=>buildSceneDocument({objects,localLiquid:defaultLocalLiquidSetup(),environment:{name:'neutral'}});
test('finite release, pause, live source transforms, reset and replacement use the retained shared host',async()=>{
 const loader=hostLoader(),data=waterDocument([source('drop',.25,8)]),f=fixture(data,loader);
 try{
  await initialize(f);assert.equal(loader.mounts.length,0);
  assert.equal(typeof f.shell.commands['water.release'],'function','worker must expose the actual water release command');
  const reply=await f.shell.commands['water.release'](null,f.ctx),mount=loader.mounts[0];
  assert.equal(mount.options.getDisplayPolicy().rawOutput.isNode,true);assert.equal(mount.options.device,f.device);assert.equal(mount.options.renderer,f.renderer);assert.equal(reply.ui.water.simulationMounted,true);assert.equal(reply.ui.water.paused,false);
  assert.equal(f.shell.commands['water.read'](null,f.ctx).preview,false);
  assert.equal(f.shell.foregroundCommands['water.pause']({paused:true},f.ctx).ui.water.paused,true);
  f.shell.foregroundCommands['scene.transformComponent']({id:'drop',field:'position.x',value:.2},f.ctx);f.domains.prepareFrame();assert.equal(mount.records[0].transform.position[0],.2);
  f.shell.foregroundCommands['water.pause']({paused:false},f.ctx);
  assert.equal(f.shell.foregroundCommands['water.reset'](null,f.ctx).ui.water.preview,true);assert.equal(mount.disposed,1);
  await f.shell.commands['water.release'](null,f.ctx);assert.equal(loader.mounts[1].records[0].transform.position[0],.2);
  await f.shell.commands['scene.applyDocument']({document:data},f.ctx);assert.equal(loader.mounts[1].disposed,1);assert.equal(f.shell.commands['water.read'](null,f.ctx).host,null);
 }finally{await f.retire();}
});
test('continuous sources restore into the MLS host rather than refusing the document',async()=>{
 const loader=hostLoader(),f=fixture(waterDocument([flow()]),loader);
 try{await initialize(f);assert.equal(loader.mounts.length,1);assert.equal(f.shell.commands['water.read'](null,f.ctx).host.mode,'continuous');assert.equal(f.shell.commands['water.read'](null,f.ctx).paused,false);}
 finally{await f.retire();}assert.equal(loader.mounts[0].disposed,1);
});
test('failed live water draw retires only water and resumes the ordinary fallback',async()=>{
 const loader=hostLoader(),f=fixture(waterDocument([flow()]),loader);
 try{await initialize(f);let fallback=0;assert.equal(typeof f.domains.onWaterError,'function');f.domains.onWaterError(Error('test water frame failure'),()=>fallback++);assert.equal(fallback,1);const water=f.shell.commands['water.read'](null,f.ctx);assert.equal(water.simulationMounted,false);assert.match(water.failure,/test water frame failure/);assert.equal(loader.mounts[0].disposed,1);}
 finally{await f.retire();}
});

test('cancelled async release cannot publish a candidate into the current worker scene',async()=>{
 let pending,entered;const begun=new Promise(resolve=>{entered=resolve;}),loader={loadWaterHost:async()=>({createAuthoredWaterHost:options=>new Promise(resolve=>{pending={options,resolve};entered();})})};
 const f=fixture(waterDocument([source('drop',.25,8)]),loader);
 try{
  await initialize(f);let stale=false;const context={...f.ctx,assertCurrent(){if(stale)throw Error('command cancelled');}};
  const releasing=f.shell.commands['water.release'](null,context);await begun;stale=true;
  assert.equal(pending.options.isCurrent(),false);let disposed=0;
  // The actual host observes isCurrent before publishing; exercise the feature's
  // own stale-candidate refusal too, as a later reset retires its generation.
  f.shell.foregroundCommands['water.reset'](null,f.ctx);
  pending.resolve({dispose(){disposed++;},state:()=>({mode:'finite_drop'}),setPaused(){}});
  await assert.rejects(releasing,/superseded|changed|cancelled/);assert.equal(disposed,1);assert.equal(f.shell.commands['water.read'](null,f.ctx).host,null);
 }finally{await f.retire();}
});

for(const mode of ['finite','continuous'])test(`unchanged first frame after ${mode} mount does not republish inlets`,async()=>{
 const loader=hostLoader(),f=fixture(waterDocument([mode==='finite'?source('drop',.25,8):flow()]),loader);
 try{await initialize(f);if(mode==='finite')await f.shell.commands['water.release'](null,f.ctx);const mount=loader.mounts.at(-1),before=mount.syncs;f.domains.prepareFrame();assert.equal(mount.syncs,before,'initial packet already belongs to this mounted host');}
 finally{await f.retire();}
});
for(const reset of [false,true])test(`replacement host follows Undo to a previously cached pose (reset: ${reset})`,async()=>{
 const loader=hostLoader(),f=fixture(waterDocument([flow()]),loader);
 try{await initialize(f);f.domains.prepareFrame();if(reset)f.shell.foregroundCommands['water.reset'](null,f.ctx);
  f.shell.foregroundCommands['scene.transformComponent']({id:'flow',field:'position.x',value:.2},f.ctx);await f.shell.commands['water.release'](null,f.ctx);const mount=loader.mounts.at(-1);assert.equal(mount.records[0].transform.position[0],.2);
  f.shell.foregroundCommands['scene.undo'](null,f.ctx);f.domains.prepareFrame();assert.equal(mount.records[0].transform.position[0],0,'replacement host must adopt the undone authored pose');
 }finally{await f.retire();}
});

test('new document host cannot inherit an old document source signature',async()=>{
 const loader=hostLoader(),f=fixture(waterDocument([flow()]),loader);
 try{await initialize(f);f.domains.prepareFrame();const next=waterDocument([flow()]);next.objects.find(row=>row.id==='flow').transform.position[0]=.2;
  await f.shell.commands['scene.applyDocument']({document:next},f.ctx);const mount=loader.mounts.at(-1);assert.equal(mount.records[0].transform.position[0],.2);
  f.shell.foregroundCommands['scene.transformComponent']({id:'flow',field:'position.x',value:0},f.ctx);f.domains.prepareFrame();assert.equal(mount.records[0].transform.position[0],0);
 }finally{await f.retire();}
});
