// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneLightingGraph} from '../scene-lighting-graph.mjs';
registerHooks({resolve(specifier,context,next){
 const local={'three':'../lib/three.webgpu.js','three/webgpu':'../lib/three.webgpu.js','three/tsl':'../lib/three.tsl.js'}[specifier];
 return local?{url:new URL(local,import.meta.url).href,shortCircuit:true}:next(specifier,context);
}});
let api={};try{api=await import('../scene-worker-scene-resources.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||error.url!==new URL('../scene-worker-scene-resources.mjs',import.meta.url).href)throw error;}
const context=()=>{const signal=new AbortController().signal;return {signal,assertCurrent(){signal.throwIfAborted();},reports:[],report(value){this.reports.push(value);}};};
const source='demos/material-recipes/two-finishes.glb',bytes=readFileSync(new URL('../'+source,import.meta.url));
const saved=(id='mesh')=>({version:8,objects:[{id,type:'glb',source,transform:{position:[1,2,3],rotation:[0,.4,0],scale:[2,1,1]},materials:{side:THREE.DoubleSide,transparent:true,opacity:.6}}],groups:[],activeObjectId:id,selectionIds:[id],
 environment:{name:'neutral',exposure:2,intensity:.7,showBackground:true,ground:{height:-2,color:'#123456'}},postprocessing:{sceneGI:{gain:3,radius:7}}});
function fixture({document=null,failInit=false,failRetire=false,domainOverrides={}}={}){
 assert.equal(typeof api.createSceneWorkerSceneResources,'function','actual ordinary scene constructor is required');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,2,.1,200),events=[],targets=[];
 const renderer={toneMappingExposure:1,capabilities:{getMaxAnisotropy:()=>8},isWebGPURenderer:true,hasFeature:()=>false,getDrawingBufferSize:v=>v.set(64,32),library:{fromMaterial:material=>material},backend:{get:()=>({texture:'actual-recorded-depth'})}};
 const pmremGenerator={fromEquirectangular:target,fromScene:target};
 function target(){const t={texture:new THREE.Texture(),dispose(){events.push('map.dispose');}};targets.push(t);return t;}
 const renderResources={renderer,pmremGenerator,lighting:null,initializeLighting(){events.push('lighting');this.lighting=createSceneLightingGraph({...shell.lightingOptions,THREE,scene,camera,renderer});this.lighting.renderPipeline.render=()=>events.push('draw');return this.lighting;}};
 const device={queue:{onSubmittedWorkDone:async()=>events.push('settle')}},ctx=context();let ordinary,cleanups=0,inputs=[];
 const domain={initialize(){events.push('domain.initialize');if(failInit)throw Error('domain construction denied');},prepareVolume(){events.push('domain.prepareVolume');},attachVolume(){events.push('domain.attachVolume');},retire(){events.push('domain.retire');if(failRetire&&cleanups++===0)throw Error('domain cleanup held');},
  readFrameState:()=>({simInputs:{flame:{active:false},water:{active:false},ash:{active:false}},radianceReady:true,transportRequired:false}),
  readDrawSettings:()=>({waterVisible:true,flameHDRActive:false}),readDrawResources:()=>({waterFeature:{host:null}}),drawOperations:{beforeDraw(){},syncProxies(){}},
  document:{assertSupported(){},prepareDocument(){},beforeReplace(){},afterReplace(){}},assertRecordSupported:record=>{throw Error('No domain mount for '+record.type);},
  applyFrameInputs(input){inputs.push(input);},...domainOverrides};
 const payload={viewport:{width:64,height:32,pixelRatio:1},flameControls:{},preferences:null,location:{href:'http://localhost/?scene_worker=1'},admission:document?{data:document,plan:{}}:null};
 const shell=api.createSceneWorkerSceneResources({THREE,scene,camera,renderer,pmremGenerator,renderResources,sharedGpu:{device,queue:device.queue},payload,viewport:()=>payload.viewport,lifecycle:{},readFlameControls:()=>({}),applyFlameControls(){},readAppHost:()=>null,
  createDomains(value){events.push('domain.shell');ordinary=value.ordinary;return domain;},services:{loadHDR:async()=>new THREE.Texture(),readAssetBytes:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}});
 return {shell,scene,camera,events,targets,ctx,domain,renderer,renderResources,ordinary:()=>ordinary,inputs};
}
test('retained shell builds actual appearance, SSGI, display and ordinary frames without a page owner',async()=>{
 const f=fixture();assert.deepEqual(f.events,[]);assert.equal(f.scene.children.length,0);
 await f.shell.initialize(f.ctx);assert.equal(f.scene.children.some(o=>o.userData?.kaminosEditorHelper),false);
 assert(f.shell.ordinary.appearance.ground.isMesh);assert.equal(f.shell.ordinary.readSettings().gi.mode,'combined');
 assert.equal(f.renderResources.lighting.renderPipeline.renderer,f.renderer);assert(f.renderResources.lighting.sceneGI.source.isNode);
 assert.equal(f.ctx.reports.some(r=>r.ui?.initialization?.sceneApplied),false);
 await f.shell.prepareVolume({volume:{},context:f.ctx});await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 f.shell.applyFrameInputs({now:1},f.ctx);f.shell.frames.setForegroundServiceActive(true);
 const frame=f.shell.frames.runForegroundFrame(()=>({}));assert.equal(frame.sceneDrawn,true);assert(f.events.includes('draw'));
 assert.deepEqual(f.inputs,[{now:1}]);assert(f.events.indexOf('domain.prepareVolume')<f.events.indexOf('domain.attachVolume'));
 await f.shell.retire(f.ctx);assert.equal(f.shell.ordinary.appearance,null);
});
test('saved GLB reaches actual parser, registry, transform/material restore and lighting before applied marker',async()=>{
 globalThis.self=globalThis;const f=fixture({document:saved()});
 try{
 await f.shell.initialize(f.ctx);assert.equal(f.shell.ordinary.workingScene.objects.length,0);
 await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 const entry=f.shell.ordinary.workingScene.find('mesh');assert.equal(entry.object.parent,f.scene);assert.deepEqual(entry.object.position.toArray(),[1,2,3]);
 entry.object.traverse(n=>{if(n.isMesh){assert.equal(n.material.opacity,.6);assert.equal(n.material.side,THREE.DoubleSide);}});
 assert.equal(f.shell.ordinary.appearance.ground.position.y,-2);assert.equal(f.shell.ordinary.readSettings().gi.gain,3);assert.equal(f.renderer.toneMappingExposure,2);
 assert(f.ctx.reports.some(r=>r.ui?.initialization?.sceneApplied===true));
 const old=entry.object;await f.shell.commands['scene.applyDocument']({document:saved('replacement')},f.ctx);assert.equal(old.parent,null);
 assert.deepEqual(f.shell.ordinary.workingScene.objects.map(o=>o.id),['replacement']);
 await f.shell.retire(f.ctx);
 }finally{delete globalThis.self;}
});
test('unmounted domain and unsupported presentation refuse before clearing registered roots',async()=>{
 globalThis.self=globalThis;const f=fixture({document:saved()});try{
 await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});const prior=f.shell.ordinary.workingScene.find('mesh').object;
 const unsupported=saved('other');unsupported.objects[0].type='image';
 await assert.rejects(f.shell.commands['scene.applyDocument']({document:unsupported},f.ctx),/No domain mount/);
 f.domain.document.assertSupported=()=>{throw Error('Output mount missing');};
 await assert.rejects(f.shell.commands['scene.applyDocument']({document:saved('other')},f.ctx),/Output mount missing/);
 assert.equal(f.shell.ordinary.workingScene.find('mesh').object,prior);assert.equal(prior.parent,f.scene);await f.shell.retire(f.ctx);
 }finally{delete globalThis.self;}
});
test('failed initialization retains actual domain cleanup shell and retry never retires borrowed renderer',async()=>{
 const f=fixture({failInit:true,failRetire:true});await assert.rejects(f.shell.initialize(f.ctx),/domain construction denied/);
 await assert.rejects(f.shell.retire(f.ctx),/domain cleanup held/);await f.shell.retire(f.ctx);
 assert.equal(f.events.filter(v=>v==='domain.shell').length,1);assert.equal(f.events.filter(v=>v==='domain.retire').length,2);
 assert.equal(f.renderResources.renderer,f.renderer);assert.equal(f.ctx.reports.some(r=>r.ui?.initialization?.sceneApplied),false);
});
