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
function fixture({document=null,failInit=false,failRetire=false,domainOverrides={},liveShared=true}={}){
 assert.equal(typeof api.createSceneWorkerSceneResources,'function','actual ordinary scene constructor is required');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,2,.1,200),events=[],targets=[];
 const renderer={toneMappingExposure:1,capabilities:{getMaxAnisotropy:()=>8},isWebGPURenderer:true,hasFeature:()=>false,getDrawingBufferSize:v=>v.set(64,32),library:{fromMaterial:material=>material},backend:{get:()=>({texture:'actual-recorded-depth'})}};
 const pmremGenerator={fromEquirectangular:target,fromScene:target};const retained=[];
 function target(){const t={texture:new THREE.Texture(),releases:0,dispose(){this.releases++;events.push('map.dispose');}};targets.push(t);return t;}
 const renderResources={renderer,pmremGenerator,lighting:null,async initializeRenderer(){events.push('renderer.initialize');},resize(){},
  async retireLighting(){while(retained.length){await retained.at(-1).dispose?.();retained.pop();}this.lighting=null;},
  async retire(){await this.retireLighting();events.push('renderer.retire');},
  initializeLighting(){events.push('lighting');this.lighting=createSceneLightingGraph({...shell.lightingOptions,THREE,scene,camera,renderer:this.renderer,retain:resource=>retained.push(resource)});this.lighting.renderPipeline.render=()=>events.push('draw');return this.lighting;}};
 const device={queue:{submit(){},onSubmittedWorkDone:async()=>events.push('settle')},destroy(){events.push('device.destroy');}},ctx=context();let ordinary,cleanups=0,inputs=[];
 const domain={initialize(){events.push('domain.initialize');if(failInit)throw Error('domain construction denied');},prepareVolume(){events.push('domain.prepareVolume');},attachVolume(){events.push('domain.attachVolume');},reattachVolume(){events.push('domain.reattachVolume');},retire(){events.push('domain.retire');if(failRetire&&cleanups++===0)throw Error('domain cleanup held');},
  readFrameState:()=>({simInputs:{flame:{active:false},water:{active:false},ash:{active:false}},radianceReady:true,transportRequired:false}),
  readDrawSettings:()=>({waterVisible:true,flameHDRActive:false}),readDrawResources:()=>({waterFeature:{host:null}}),drawOperations:{beforeDraw(){},syncProxies(){}},
  document:{assertSupported(){},prepareDocument(){events.push('document.prepare');},beforeReplace(){},afterReplace(){}},assertRecordSupported:record=>{throw Error('No domain mount for '+record.type);},
  applyFrameInputs(input){inputs.push(input);},...domainOverrides};
 const payload={viewport:{width:64,height:32,pixelRatio:1},flameControls:{},preferences:null,location:{href:'http://localhost/?scene_worker=1'},admission:document?{data:document,plan:{}}:null};
 let shared={device,queue:device.queue};
 const shell=api.createSceneWorkerSceneResources({THREE,scene,camera,renderer,pmremGenerator,renderResources,sharedGpu:shared,...(liveShared?{readSharedGpu:()=>shared}:{}),payload,viewport:()=>payload.viewport,lifecycle:{},readFlameControls:()=>({}),applyFlameControls(){},readAppHost:()=>null,
  createDomains(value){events.push('domain.shell');ordinary=value.ordinary;return domain;},services:{loadHDR:async()=>new THREE.Texture(),readAssetBytes:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}});
 return {shell,scene,camera,events,targets,ctx,domain,renderer,renderResources,payload,device,ordinary:()=>ordinary,inputs,setShared:value=>{shared=value;}};
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
 const entry=f.shell.ordinary.workingScene.find('mesh');assert.equal(f.shell.ordinary.giProxies.get(entry.object)?.state,'not-generated','ordinary registration resolves the actual GI proxy selection');assert.equal(entry.object.parent,f.scene);assert.deepEqual(entry.object.position.toArray(),[1,2,3]);
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

test('actual fire joins expose bloom, selection decoration and held lighting preparation',async()=>{
 const f=fixture({domainOverrides:{prepareFrame(){f.events.push('source.prepare');}}});await f.shell.initialize(f.ctx);
 assert.equal(f.shell.ordinary.bloom.read().signal,'physical-emission');assert(f.shell.ordinary.decorateOutput(THREE.TSL.vec4(1)).isNode);
 assert.equal(f.shell.ordinary.surfaceLighting,f.renderResources.lighting.sceneGI.surfaceLighting);
 const volume={setSceneLightingRebuildPending(value){f.events.push(['volume.hold',value]);}};
 await f.shell.prepareVolume({volume,context:f.ctx});await f.shell.attachVolume({volume,appHost:{},context:f.ctx});
 await f.shell.ordinary.lightingPreparation.setExternalHold(true);assert.equal(f.shell.ordinary.lightingPreparation.state().held,true);
 f.shell.frames.setForegroundServiceActive(true);assert.equal(f.shell.frames.runForegroundFrame(()=>({})).sceneDrawn,false);
 await f.shell.ordinary.lightingPreparation.setExternalHold(false);assert.equal(f.shell.frames.runForegroundFrame(()=>({})).sceneDrawn,true);
 assert(f.events.indexOf('source.prepare')<f.events.indexOf('draw'));assert(f.events.some(e=>Array.isArray(e)&&e[0]==='volume.hold'&&e[1]));await f.shell.retire(f.ctx);
});

test('failed initial document never publishes initialization markers and remains retireable',async()=>{
 const f=fixture({document:saved(),domainOverrides:{document:{assertSupported(){throw Error('Requested domain is absent');},prepareDocument(){},beforeReplace(){},afterReplace(){}}}});
 await f.shell.initialize(f.ctx);await assert.rejects(f.shell.attachVolume({volume:{},appHost:{},context:f.ctx}),/Requested domain/);
 assert.equal(f.ctx.reports.some(r=>r.ui?.initialization?.sceneApplied||r.ui?.initialization?.preferencesApplied),false);assert.equal(f.shell.ordinary.workingScene.objects.length,0);await f.shell.retire(f.ctx);
});

test('actual selection cleanup releases owned feedback while leaving authored geometry intact',async()=>{
 const {createSelectionFeedback}=await import('../scene-selection-feedback.mjs');const feedback=createSelectionFeedback(new THREE.PerspectiveCamera());
 const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardNodeMaterial());let disposed=0;
 object.geometry.addEventListener('dispose',()=>disposed++);object.material.addEventListener('dispose',()=>disposed++);
 feedback.update([{id:'owned-by-author',object}],['owned-by-author']);feedback.dispose();feedback.dispose();assert.equal(disposed,0);assert.equal(feedback.state().meshCount,0);
});


test('actual common factory draws dormant ordinary scene through the real Kit foreground service',async()=>{
 const {createSceneWorkerRuntimeFactory}=await import('../scene-worker-runtime.mjs');const kit=await import('../webgpu-inference-kit/src/core.js');
 const f=fixture({domainOverrides:{initialVolumeActive:false}}),shared=f.shell.ordinary.sharedGpu;
 const volume={setActive:async value=>f.events.push(['active',value]),setSceneLightingRebuildPending(){},
  foregroundGpuContext:()=>({active:false,device:null,queue:null,renderer:'ordinary-volume',productFrameOwner:'prototype'}),
  renderSharedFrame:()=>({flameDrawn:false}),dispose(){f.events.push('volume.dispose');}};
 const factory=createSceneWorkerRuntimeFactory({THREE,createSceneResources:input=>{assert.equal(input.renderResources,f.renderResources);assert.equal(input.sharedGpu.device,f.device);return f.shell;},
  services:{kit,requestDevice:async()=>shared,createRenderObjects:()=>({scene:f.scene,camera:f.camera}),createRenderResources:()=>f.renderResources,createVolume:()=>volume}});
 const runtime=factory({payload:{...f.payload,sceneCanvas:{},volumeCanvas:{getContext(){}}},lifecycle:{}});
 await runtime.initialize(f.ctx);assert(f.events.some(e=>Array.isArray(e)&&e[0]==='active'&&e[1]===false));
 assert(f.events.indexOf('domain.prepareVolume')<f.events.findIndex(e=>Array.isArray(e)&&e[0]==='active'));
 const input={now:16};const receipt=await runtime.requestFrame(input,f.ctx,()=>runtime.frame(input,f.ctx));
 assert.equal(receipt.status,'completed');assert.equal(receipt.result.sceneDrawn,true);assert.equal(receipt.result.flameDrawn,false);
 await runtime.retire(f.ctx);assert(f.events.indexOf('domain.retire')<f.events.indexOf('volume.dispose'));assert.equal(f.events.at(-1),'device.destroy');
});

test('selected startup preferences reach actual ordinary bloom and GI before initialization markers',async()=>{
 const f=fixture();f.payload.preferences={schema:'kaminos.preferences.v1',sceneDefaults:{environment:{name:'neutral',exposure:1.7,intensity:.8,showBackground:true},postprocessing:{sceneGI:{gain:4},bloom:{enabled:true,radius:.2,strength:.3,threshold:.4,composeFlame:true}}}};
 await f.shell.initialize(f.ctx);assert.equal(f.shell.ordinary.readSettings().gi.gain,4);assert.equal(f.shell.ordinary.bloom.read().settings.radius,.2);assert.equal(f.renderer.toneMappingExposure,1.7);
 assert.equal(f.ctx.reports.some(r=>r.ui?.initialization?.preferencesApplied),false);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});assert(f.ctx.reports.some(r=>r.ui?.initialization?.preferencesApplied));await f.shell.retire(f.ctx);
});


test('missing live simulator state refuses instead of drawing with an implicit inactive plan',async()=>{
 const f=fixture({domainOverrides:{readFrameState:()=>({radianceReady:true,transportRequired:false})}});
 await assert.rejects(f.shell.initialize(f.ctx),/simulator state/);await f.shell.retire(f.ctx);
});


test('current UI reads include asynchronous lighting status and transport visibility without retaining an initializer',async()=>{
 const f=fixture({domainOverrides:{readUi:()=>({fireLighting:{status:'current'},surfaces:{volume:{visible:false}}})}});
 await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 f.shell.ordinary.appearance.environment.select('neutral');await f.shell.ordinary.appearance.environment.whenSettled();
 const ui=f.shell.readUi();assert.equal(ui.environmentLoading.quality,'full');assert.equal(ui.environmentLoading.mapName,'neutral');
 assert.equal(ui.surfaces.volume.visible,false);assert.equal(ui.surfaces.scene.active,true);assert.equal(ui.objects,undefined,'full registry must not be serialized on every frame');
 assert.equal(ui.fireLighting.status,'current');await f.shell.retire(f.ctx);assert.equal(f.shell.readUi().surfaces.scene.active,false);
});

test('fire contribution retains receiver cleanup ownership even when ordinary display caches it',async()=>{
 let disposed=0;const pass={outputNode:THREE.TSL.vec4(1),update(){},renderShadows(){},dispose(){disposed++;}};
 const f=fixture({domainOverrides:{readFrameState:()=>({simInputs:{flame:{active:false},water:{active:false},ash:{active:false}},radianceReady:true,transportRequired:false,fireLightFieldRoute:true}),
 createFireLightReceiver:()=>pass,retire(){pass.dispose();}}});
 await f.shell.initialize(f.ctx);assert.equal(f.shell.ordinary.output.fireLightFieldPass,pass);await f.shell.retire(f.ctx);assert.equal(disposed,1);
});

test('negative or asynchronous startup support cannot claim preference application',async()=>{
 for(const result of [false,Promise.resolve()]){
  const f=fixture({domainOverrides:{document:{assertSupported:()=>result,prepareDocument(){},beforeReplace(){},afterReplace(){}}}});
  f.payload.preferences={schema:'kaminos.preferences.v1',sceneDefaults:{environment:{name:'neutral',exposure:1.7,intensity:.8}}};
  await assert.rejects(f.shell.initialize(f.ctx),/support|synchronous/);assert.equal(f.ctx.reports.some(r=>r.ui?.initialization?.preferencesApplied),false);await f.shell.retire(f.ctx);
 }
});

test('actual merged domain route chooses distributed ground after domain initialization',async()=>{
 let prepared=false;
 const f=fixture({domainOverrides:{initialize(){prepared=true;},readRouteParams:()=>new URLSearchParams(prepared?'volume_light_field_distributed=1':'')}});
 await f.shell.initialize(f.ctx);assert.equal(f.shell.ordinary.appearance.ground.geometry.type,'RingGeometry');await f.shell.retire(f.ctx);
});

test('ordinary bloom graph consumes the same authored-width node as the actual page',async()=>{
 const {SceneBloomNode}=await import('../scene-bloom-node.mjs');const f=fixture();
 f.payload.preferences={schema:'kaminos.preferences.v1',sceneDefaults:{postprocessing:{bloom:{enabled:true,radius:.2,strength:.3,threshold:.4,composeFlame:true}}}};
 await f.shell.initialize(f.ctx);const output=f.shell.ordinary.bloom.output(THREE.TSL.vec4(0),THREE.TSL.texture(new THREE.Texture())),nodes=[];
 output.traverse(node=>nodes.push(node));assert(nodes.some(node=>node instanceof SceneBloomNode),'actual SceneBloomNode must be wired; shader equations are unchanged');await f.shell.retire(f.ctx);
});

test('document result projects its applied camera and final restored selection for the next page frame',async()=>{
 globalThis.self=globalThis;const f=fixture();try{
 await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 const document=saved();document.camera={position:[4,5,6],target:[1,0,0],up:[0,1,0],fov:57,near:.2,far:120};
 const result=await f.shell.commands['scene.applyDocument']({document},f.ctx);
 assert.deepEqual(result.ui?.camera,document.camera);assert.deepEqual(result.ui.selection.ids,document.selectionIds);assert.deepEqual(f.shell.ordinary.camera.position.toArray(),document.camera.position);
 assert.equal(f.shell.readUi().camera,undefined,'per-frame metadata does not replay a document camera');await f.shell.retire(f.ctx);
 }finally{delete globalThis.self;}
});

test('domain root hooks augment ordinary proxy, saved pose and owned geometry lifetime',async()=>{
 globalThis.self=globalThis;const hooks=[];const f=fixture({domainOverrides:{roots:{prepare:entry=>hooks.push(['prepare',entry.id]),restore:entry=>hooks.push(['restore',entry.id]),dispose:root=>hooks.push(['dispose',root])}}});
 try{await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 await f.shell.commands['scene.applyDocument']({document:saved()},f.ctx);const entry=f.shell.ordinary.workingScene.find('mesh');
 assert.equal(f.shell.ordinary.giProxies.get(entry.object)?.state,'not-generated');assert.deepEqual(entry.object.position.toArray(),[1,2,3]);
 const geometry=new Set();entry.object.traverse(n=>{if(n.geometry)geometry.add(n.geometry);});let releases=0;for(const value of geometry)value.addEventListener('dispose',()=>releases++);
 await f.shell.commands['scene.applyDocument']({document:saved('next')},f.ctx);
 assert.equal(releases,geometry.size);assert.equal(entry.object.parent,null);assert(hooks.some(([kind,root])=>kind==='dispose'&&root===entry.object));
 assert.equal(hooks.filter(([kind])=>kind==='prepare').length,2);assert.equal(hooks.filter(([kind])=>kind==='restore').length,2);await f.shell.retire(f.ctx);
 }finally{delete globalThis.self;}
});

test('invalid ordinary settings refuse before domain preparation and preserve the viable document binding',async()=>{
 globalThis.self=globalThis;let prepared=0;const f=fixture({domainOverrides:{document:{assertSupported(){},prepareDocument(){prepared++;},beforeReplace(){},afterReplace(){}}}});
 try{await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 await f.shell.commands['scene.applyDocument']({document:saved(),sceneFile:'kept.kaminos.json'},f.ctx);const kept=f.shell.ordinary.workingScene.find('mesh').object;
 const invalid=[{environment:{name:'absent-environment'}},{environment:{name:'neutral',ground:{height:'bad'}}},{postprocessing:{sceneGI:{radius:-1}}},{postprocessing:{bloom:{strength:-1}}},{postprocessing:{ao:{enabled:'false'}}},{camera:{position:[0,0,0],target:[0,0,0],up:[0,1,0],fov:50,near:.1,far:200}}];
 for(const patch of invalid){await assert.rejects(f.shell.commands['scene.applyDocument']({document:{...saved('bad'),...patch}},f.ctx));
  assert.equal(prepared,1,'invalid ordinary values cannot invoke preparation');assert.equal(f.shell.ordinary.document.session.state().filename,'kept.kaminos.json');assert.equal(f.shell.ordinary.document.session.state().blocked,false);
  assert.equal(f.shell.ordinary.workingScene.find('mesh').object,kept);assert.equal(kept.parent,f.scene);
 }await f.shell.retire(f.ctx);
 }finally{delete globalThis.self;}
});

test('legacy document camera omissions preserve the ordinary page lens and default up convention',async()=>{
 globalThis.self=globalThis;const f=fixture();try{await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 const document=saved();document.camera={position:[4,5,6],target:[0,0,0]};const result=await f.shell.commands['scene.applyDocument']({document},f.ctx);
 assert.deepEqual(result.ui.camera,{...document.camera,up:[0,1,0],fov:50,near:.1,far:200});await f.shell.retire(f.ctx);
 }finally{delete globalThis.self;}
});

test('ordinary device readers use the live owner and never revive a null device',()=>{
 const f=fixture(),next={device:{queue:{onSubmittedWorkDone:async()=>{}}}};next.queue=next.device.queue;
 f.setShared(next);assert.equal(f.shell.ordinary.sharedGpu,next);
 f.setShared(null);assert.equal(f.shell.ordinary.sharedGpu,null,'an explicit missing current device cannot fall back to the original');
 const legacy=fixture({liveShared:false});assert.equal(legacy.shell.ordinary.sharedGpu.device,legacy.device);
});

test('presentation replacement preserves unsaved authored identity and reattaches without replaying startup',async()=>{
 globalThis.self=globalThis;const f=fixture({document:saved()});try{
 await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 const ordinary=f.shell.ordinary,authored=ordinary.authored,entry=ordinary.workingScene.find('mesh'),object=entry.object,appearance=ordinary.appearance;
 object.position.set(9,8,7);ordinary.workingScene.select(['mesh'],'mesh');
 ordinary.applySettings({...saved(),postprocessing:{sceneGI:{gain:5,radius:9},bloom:{enabled:true,radius:.3,strength:.2}}},f.ctx);
 ordinary.bloom.set({strength:.73});const bloomBefore=structuredClone(ordinary.bloom.read().settings),settingsBefore=ordinary.readSettings();
 let authoredDisposals=0;object.traverse(n=>{n.geometry?.addEventListener('dispose',()=>authoredDisposals++);for(const m of [].concat(n.material??[]))m.addEventListener('dispose',()=>authoredDisposals++);});
 const oldLighting=f.renderResources.lighting,oldMap=f.scene.environment;
 assert.equal(typeof f.shell.stopRendererResources,'function');assert.doesNotThrow(()=>f.shell.stopRendererResources());
 assert.equal(f.shell.readUi().surfaces.scene.active,false);f.shell.frames.setForegroundServiceActive(true);
 assert.equal(f.shell.frames.runForegroundFrame(()=>({})).sceneDrawn,false);
 await f.shell.releaseRendererPresentation(f.ctx);assert.equal(f.renderResources.lighting,null);
 assert.equal(ordinary.authored,authored);assert.equal(ordinary.workingScene.find('mesh').object,object);assert.equal(object.parent,f.scene);assert.equal(authoredDisposals,0);
 const next={device:{queue:{onSubmittedWorkDone:async()=>{}}}};next.queue=next.device.queue;f.setShared(next);
 const replacement={...f.renderer,toneMappingExposure:1};f.renderResources.renderer=replacement;f.renderResources.pmremGenerator={...f.renderResources.pmremGenerator};
 await f.shell.restoreRendererPresentation(f.ctx);
 assert.notEqual(f.renderResources.lighting,oldLighting);assert.equal(f.renderResources.lighting.renderPipeline.renderer,replacement);
 assert.equal(ordinary.appearance,appearance);assert.notEqual(f.scene.environment,oldMap);assert.equal(replacement.toneMappingExposure,settingsBefore.environment.exposure);
 assert.deepEqual(ordinary.readSettings(),settingsBefore);assert.deepEqual(ordinary.bloom.read().settings,bloomBefore);
 assert.equal(f.shell.readUi().surfaces.scene.active,false,'restoring presentation alone cannot claim domain attachment');
 await f.shell.prepareVolume({volume:{},context:f.ctx});await f.shell.reattachVolume({volume:{},appHost:{},context:f.ctx});
 assert.deepEqual(object.position.toArray(),[9,8,7]);assert.deepEqual(ordinary.workingScene.selection.ids,['mesh']);assert.equal(authoredDisposals,0);
 assert.equal(f.events.filter(e=>e==='document.prepare').length,1,'recovery cannot reapply the initial saved document');
 assert.equal(f.ctx.reports.filter(r=>r.ui?.initialization?.sceneApplied).length,1,'recovery is not a second startup');
 assert.equal(f.events.filter(e=>e==='domain.attachVolume').length,1);assert.equal(f.events.filter(e=>e==='domain.reattachVolume').length,1);
 assert.equal(f.shell.readUi().surfaces.scene.active,true);assert.equal(f.shell.frames.runForegroundFrame(()=>({})).sceneDrawn,true);
 await f.shell.retire(f.ctx);await f.renderResources.retire();
 }finally{delete globalThis.self;}
});

test('failed presentation cleanup retains targets for Retry without clearing authored roots',async()=>{
 globalThis.self=globalThis;const f=fixture({document:saved()});try{
 await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});await f.shell.ordinary.appearance.environment.whenSettled();
 const object=f.shell.ordinary.workingScene.find('mesh').object,last=f.targets.at(-1),release=last.dispose;let denied=true;
 last.dispose=function(){if(denied)throw Error('presentation target cleanup denied');return release.call(this);};
 f.shell.stopRendererResources();await assert.rejects(f.shell.releaseRendererPresentation(f.ctx),/cleanup denied/);
 assert.equal(f.shell.ordinary.workingScene.find('mesh').object,object);assert.equal(f.events.includes('domain.retire'),false);
 await assert.rejects(f.shell.restoreRendererPresentation(f.ctx),/release|retained/);
 denied=false;await f.shell.releaseRendererPresentation(f.ctx);assert(f.targets.every(t=>t.releases===1));
 await f.shell.retire(f.ctx);await f.renderResources.retire();
 }finally{delete globalThis.self;}
});

test('superseded presentation restore stays held and retains partial allocations until cleanup',async()=>{
 const f=fixture();await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 f.shell.stopRendererResources();await f.shell.releaseRendererPresentation(f.ctx);
 const controller=new AbortController(),stale={...f.ctx,assertCurrent(){controller.signal.throwIfAborted();}},initialize=f.renderResources.initializeLighting;
 f.renderResources.initializeLighting=function(){const value=initialize.call(this);controller.abort(Error('superseded device generation'));return value;};
 await assert.rejects(f.shell.restoreRendererPresentation(stale),/superseded device generation/);
 assert(f.renderResources.lighting,'partial new graph must remain reachable for cleanup');assert.equal(f.shell.readUi().surfaces.scene.active,false);
 await assert.rejects(f.shell.restoreRendererPresentation(f.ctx),/release|retained/);
 await f.shell.releaseRendererPresentation(f.ctx);assert.equal(f.renderResources.lighting,null);
 f.renderResources.initializeLighting=initialize;await f.shell.restoreRendererPresentation(f.ctx);await f.shell.reattachVolume({volume:{},appHost:{},context:f.ctx});
 assert.equal(f.shell.readUi().surfaces.scene.active,true);await f.shell.retire(f.ctx);await f.renderResources.retire();
});


test('recovery domain can prepare fresh lighting while ordinary drawing remains held',async()=>{
 const f=fixture();await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 f.shell.stopRendererResources();await f.shell.releaseRendererPresentation(f.ctx);await f.shell.restoreRendererPresentation(f.ctx);
 Object.assign(f.renderer,{contextNode:THREE.TSL.context({}),getRenderTarget:()=>null,getMRT:()=>null,setRenderTarget(){},setMRT(){},async compileAsync(){f.events.push('recovery.compile');}});
 let changed=false;
 f.domain.reattachVolume=async()=>{
  assert.equal(f.shell.readUi().surfaces.scene.active,false);const preparation=f.shell.ordinary.lightingPreparation;
  await preparation.setExternalHold(true);
  try{await preparation.request(()=>{changed=true;});}finally{await preparation.setExternalHold(false);}
  assert.equal(f.shell.readUi().surfaces.scene.active,false);
 };
 await f.shell.reattachVolume({volume:{},appHost:{},context:f.ctx});
 assert.equal(changed,true);assert.equal(f.events.filter(e=>e==='recovery.compile').length,2);
 assert.equal(f.shell.readUi().surfaces.scene.active,true);await f.shell.retire(f.ctx);await f.renderResources.retire();
});


test('recovery releases volume presentation through its domain without retiring authored state',async()=>{
 const f=fixture();await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 const authored=f.shell.ordinary.authored,working=f.shell.ordinary.workingScene;let attempts=0;
 f.domain.releaseVolume=async input=>{assert.equal(input.context,f.ctx);if(++attempts===1)throw Error('domain GPU release denied');return {released:true};};
 f.shell.stopRendererResources();assert.equal(typeof f.shell.releaseVolume,'function');
 await assert.rejects(f.shell.releaseVolume({context:f.ctx}),/domain GPU release denied/);
 assert.equal(f.shell.ordinary.authored,authored);assert.equal(f.shell.ordinary.workingScene,working);assert.equal(f.events.includes('domain.retire'),false);
 assert.deepEqual(await f.shell.releaseVolume({context:f.ctx}),{released:true});assert.equal(attempts,2);
 delete f.domain.releaseVolume;await assert.rejects(f.shell.releaseVolume({context:f.ctx}),/domains.releaseVolume/);
 await f.shell.releaseRendererPresentation(f.ctx);await f.shell.restoreRendererPresentation(f.ctx);
 delete f.domain.reattachVolume;await assert.rejects(f.shell.reattachVolume({volume:{},context:f.ctx}),/domains.reattachVolume/);
 assert.equal(f.shell.readUi().surfaces.scene.active,false);assert.equal(f.events.filter(e=>e==='domain.attachVolume').length,1);
 await f.shell.retire(f.ctx);await f.renderResources.retire();
});


test('retained beauty proxy roots register on the new surface-lighting owner and keep releasable identities',async()=>{
 globalThis.self=globalThis;const f=fixture({document:saved()});try{
 await f.shell.initialize(f.ctx);await f.shell.attachVolume({volume:{},appHost:{},context:f.ctx});
 const {seedInitialBeautyLevels}=await import('../scene-lod-budget.mjs'),ordinary=f.shell.ordinary,root=ordinary.workingScene.find('mesh').object;
 const rung=new THREE.Group();rung.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardNodeMaterial()));
 seedInitialBeautyLevels(root,[{sha:'retained-rung',faces:12,root:rung}]);ordinary.beautyLods.update(f.camera,{viewportHeight:32});
 const old=ordinary.surfaceLighting;assert(old.proxyRoots.has(rung));assert(ordinary.beautyLods.materialRoots(root).includes(rung));
 f.shell.stopRendererResources();await f.shell.releaseRendererPresentation(f.ctx);assert.equal(old.proxyRoots.has(rung),false);
 await f.shell.restoreRendererPresentation(f.ctx);const next=ordinary.surfaceLighting;
 assert.notEqual(next,old);assert(next.proxyRoots.has(rung));assert(ordinary.beautyLods.materialRoots(root).includes(rung));
 ordinary.beautyLods.release(root);assert.equal(next.proxyRoots.has(rung),false,'original LOD release callback must unregister from the current owner');
 await f.shell.retire(f.ctx);await f.renderResources.retire();
 }finally{delete globalThis.self;}
});
