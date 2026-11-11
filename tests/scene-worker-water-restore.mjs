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
function fixture(data){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),retained=[];
 const ctx={signal:new AbortController().signal,assertCurrent(){},report(){}};
 const renderer={toneMappingExposure:1,capabilities:{getMaxAnisotropy:()=>8},isWebGPURenderer:true,hasFeature:()=>false,getDrawingBufferSize:v=>v.set(32,32),library:{fromMaterial:material=>material},backend:{get:()=>({texture:{}})}};
 const target=()=>({texture:new THREE.Texture(),dispose(){}});
 const renderResources={renderer,pmremGenerator:{fromScene:target,fromEquirectangular:target},lighting:null,
  initializeLighting(){return this.lighting=createSceneLightingGraph({...shell.lightingOptions,THREE,scene,camera,renderer,retain:value=>retained.push(value)});},resize(){}};
 const device={queue:{onSubmittedWorkDone:async()=>{}}};
 const shell=createSceneWorkerSceneResources({THREE,scene,camera,renderResources,sharedGpu:{device,queue:device.queue},viewport:()=>({width:32,height:32,pixelRatio:1}),
  payload:{location:{href:'http://localhost/?scene_worker=1'},admission:{data},flameControls:{}},readFlameControls:()=>({resolution:16}),applyFlameControls(){},readAppHost:()=>null,
  services:{loadHDR:async()=>new THREE.Texture()},createDomains:input=>createSceneWorkerFireResources(input)});
 const volume={isActive:()=>false,setActive:async()=>{},setSceneCompositionPresentation(){},setVolumePrimitives(){},restoreWorldFrame(){},relocateOrdinaryDomain(){},setImmersedSources(){},setSceneLightingRebuildPending(){}};
 return {shell,scene,ctx,volume,async retire(){await shell.retire(ctx);while(retained.length)await retained.pop().dispose?.();}};
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
