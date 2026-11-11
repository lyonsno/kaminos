// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {once} from 'node:events';
import * as THREE from '../lib/three.core.js';
import {createSceneRenderObjects} from '../scene-render-bootstrap.mjs';
import {createSceneWorkerClient,installSceneWorkerHost} from '../scene-worker-handoff.mjs';
import * as realKit from '../webgpu-inference-kit/src/core.js';
const {createWebGpuForegroundService}=realKit;
const module=await import('../scene-worker-runtime.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
function factory(options){assert.equal(typeof module.createSceneWorkerRuntimeFactory,'function','actual worker composition must return a retained shell before allocation');return module.createSceneWorkerRuntimeFactory(options);}
function fixture({failInitialize=false,failCleanup=false}={}){
 const calls=[],device={queue:{submit(){},onSubmittedWorkDone:async()=>calls.push('settled')},destroy:()=>calls.push('device.dispose')},shared={device,adapter:{},queue:device.queue};
 const signal=new AbortController().signal,context={signal,assertCurrent(){signal.throwIfAborted();},report(){}};
 let owner=null,volumeOptions,objects,registered=false,cleanupFails=failCleanup;
 const sceneFrames={runForegroundFrame:run=>({...run(),sceneDrawn:true}),setForegroundServiceActive:()=>calls.push('foreground.active')};
 const sceneResources={frames:sceneFrames,commands:{'scene.read':()=>({registered})},foregroundCommands:{'scene.move':()=>{registered=true;return {moved:true};}},
  async initialize(){calls.push('scene.initialize');if(failInitialize)throw Error('scene allocation failed');},
  async attachVolume(input){assert.equal(input.volume,owner);calls.push('scene.attach');},
  applyFrameInputs(payload){calls.push(['input',payload]);},
  async retire(){calls.push('scene.dispose');if(cleanupFails){cleanupFails=false;throw Error('resource retirement failed');}}};
 const renderer={dispose:()=>calls.push('renderer.dispose')};
 const renderResources={renderer,pmremGenerator:{dispose:()=>calls.push('pmrem.dispose')},lighting:null,
  async initializeRenderer(){calls.push('renderer.initialize');},
  initializeLighting(){calls.push('lighting.initialize');this.lighting={};},
  resize(){calls.push('render.resize');},
  async retire(){if(this.lighting){calls.push('lighting.dispose');this.lighting=null;}this.pmremGenerator.dispose();renderer.dispose();},
 };
 const initializeScene=sceneResources.initialize;sceneResources.initialize=async function(ctx){await initializeScene.call(this,ctx);renderResources.initializeLighting(ctx);};
 const options={THREE,createSceneResources:input=>{assert.equal(input.sharedGpu,shared);assert.equal(input.renderResources,renderResources,'retain the actual renderer resource owner before domain initialization');calls.push('scene.shell');return sceneResources;},imageOptions:null,
  services:{createRenderResources:input=>{assert.equal(input.readSharedGpu(),shared);calls.push('render.shell');return renderResources;},requestDevice:async()=>{calls.push('acquire');return shared;},kit:{createWebGpuForegroundService},
   createRenderObjects:input=>(objects=createSceneRenderObjects(input)),
   createVolume:input=>{volumeOptions=input;owner={setActive:async active=>{input.presentationSurface.setActive(active);calls.push(['volume.active',active]);},setControls:input=>{calls.push(['controls',input]);if(input.resolution===0)throw Error('invalid grid');},dispose:()=>calls.push('volume.dispose'),
    foregroundGpuContext:()=>({device,queue:device.queue,renderer:'ordinary-volume',productFrameOwner:'prototype'}),
    renderSharedFrame:({service})=>{assert.equal(service.device,device);calls.push('volume.frame');return {flameDrawn:true};}};return owner;},
  }};
 const payload={sceneCanvas:{},volumeCanvas:{getContext(){}},viewport:{width:32,height:32,pixelRatio:1},flameControls:{resolution:16}};
 return {options,payload,context,calls,device,sceneResources,objects:()=>objects,volumeOptions:()=>volumeOptions};
}
test('factory retains a shell before any allocation and composes one admitted ordinary frame',async()=>{
 const f=fixture(),runtime=factory(f.options)({payload:f.payload,lifecycle:{}});assert.deepEqual(f.calls,[]);assert.equal(runtime.host,null);
 await runtime.initialize(f.context);assert.equal(runtime.host.device,f.device);
 const options=f.volumeOptions();assert.equal(options.sharedGpuContext.device,f.device);assert.equal(options.frameScheduleOwner,'host');assert.equal(options.productFrameOwner,'prototype');
 assert.deepEqual(options.getControls(),f.payload.flameControls);assert.equal(options.presentationSurface.canvas,f.payload.volumeCanvas);
 const payload={now:1};const receipt=await runtime.requestFrame(payload,f.context,()=>runtime.frame(payload,f.context));
 assert.equal(receipt.status,'completed');assert.equal(receipt.result.flameDrawn,true);assert.equal(receipt.result.sceneDrawn,true);assert.equal(receipt.result.ui?.surfaces?.volume?.active,true);
 assert.deepEqual(f.calls.filter(Array.isArray).at(-1),['input',payload]);
 const mutation=await runtime.requestMutation('scene.move',{},f.context,()=>runtime.foregroundCommands['scene.move']());
 assert.equal(mutation.mutationApplied,true);assert.equal(runtime.commands['scene.read']().registered,true);
 await runtime.retire(f.context);assert.deepEqual(f.calls.slice(-6),['scene.dispose','volume.dispose','lighting.dispose','pmrem.dispose','renderer.dispose','device.dispose']);
});
test('failed scene initialization retains exact resources and retries only failed cleanup',async()=>{
 const f=fixture({failInitialize:true,failCleanup:true}),runtime=factory(f.options)({payload:f.payload,lifecycle:{}});
 await assert.rejects(runtime.initialize(f.context),/scene allocation failed/);assert.equal(f.calls.includes('device.dispose'),false);
 await assert.rejects(runtime.retire(f.context),/resource retirement failed/);assert.equal(f.calls.includes('renderer.dispose'),false);
 await runtime.retire(f.context);assert.equal(f.calls.filter(x=>x==='acquire').length,1);assert.equal(f.calls.filter(x=>x==='scene.dispose').length,2);
 assert.equal(f.calls.filter(x=>x==='renderer.dispose').length,1);assert.equal(f.calls.filter(x=>x==='device.dispose').length,1);
});
test('scene command collision cannot replace model or reserved lifecycle operations',async()=>{
 const f=fixture();f.sceneResources.commands.initialize=()=>{};const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});
 await assert.rejects(runtime.initialize(f.context),/reserved|collision/);await runtime.retire(f.context);
});

test('the composed model adapter keeps ordinary frame and edit admission live on its same app host',async t=>{
 const f=fixture();f.device.features=new Set(['shader-f16']);f.device.lost=new Promise(()=>{});let open,failStart,finish;
 const started=new Promise((resolve,reject)=>{open=resolve;failStart=reject;}),gate=new Promise(resolve=>{finish=resolve;});
 f.options.services.kit={...realKit,createWebGpuInferenceSession:async options=>{
  const session=await realKit.createWebGpuInferenceSession(options);
  return {...session,async close(){await session.close();f.calls.push('session.close');}};
 }};
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
 f.options.imageOptions={weights:async()=>'/weights',deliver:async()=>({source:'/saved/image.png'}),encodePng:async()=>new Blob([png],{type:'image/png'}),
  createPipeline:()=>({load:async()=>{},destroy:async()=>f.calls.push('model.dispose'),generate:async input=>{
   await input.schedule.withForeground('model-cpu',async()=>{open();await gate;});
   return {rgba:new Uint8ClampedArray(4),width:1,height:1,timings:{}};
  }}),
 };
 const {port1,port2}=new MessageChannel();let runtime;const make=factory(f.options);
 const host=installSceneWorkerHost({port:port2,createRuntime:input=>(runtime=make({...input,payload:{...input.payload,sceneCanvas:f.payload.sceneCanvas,volumeCanvas:f.payload.volumeCanvas}}))});
 const client=createSceneWorkerClient({port:port1,sessionId:'composed-runtime'});
 t.after(()=>{finish();client.disconnect();host.disconnect();port1.close();port2.close();});
 // Recording canvas services stay local; this is CPU composition evidence, not a native canvas witness.
 await client.initialize({viewport:f.payload.viewport,flameControls:f.payload.flameControls}).completion;
 const model=client.request('image.generate',{prompt:'lantern',seed:1,size:256});model.completion.catch(failStart);
 await started;assert.equal(runtime.host.device,f.device);assert.equal(runtime.host.unsettledRuns().length,1);
 const frame=await client.request('frame',{now:2}).completion;assert.equal(frame.output.result.flameDrawn,true);assert.equal(frame.output.ui?.surfaces?.volume?.active,true);
 const edit=await client.request('scene.move',{}).completion;assert.equal(edit.output.mutationApplied,true);
 const controls=await client.request('flame.controls',{resolution:32}).completion;assert.equal(controls.output.mutationApplied,true);assert.equal(controls.output.value.acceptedControls.resolution,32);assert.equal(controls.output.ui?.surfaces?.volume?.active,true);
 finish();assert.equal((await model.completion).output.entry.source,'/saved/image.png');
 await client.request('retire').completion;assert.ok(f.calls.indexOf('model.dispose')<f.calls.indexOf('session.close'));
});

test('initialization cannot publish a scene without its frame-input consumer',async()=>{
 const f=fixture();delete f.sceneResources.applyFrameInputs;const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});
 await assert.rejects(runtime.initialize(f.context),/frame input/);await runtime.retire(f.context);
});

test('frame viewport and authored controls reach the live readers without rewriting the boot payload',async()=>{
 const f=fixture();f.options.services.timeOrigin=1000;const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});await runtime.initialize(f.context);
 const input={now:20,timeOrigin:1500,viewport:{width:80,height:40,pixelRatio:2},camera:viewSnapshot([1,2,3])};
 await runtime.requestFrame(input,f.context,()=>runtime.frame(input,f.context));
 assert.equal(f.volumeOptions().presentationSurface.viewport().width,80);assert.equal(f.calls.findLast(row=>row[0]==='input')[1].now,520);
 assert.equal(f.payload.viewport.width,32,'accepted state is not mutable invocation input');
 assert.equal(typeof runtime.foregroundCommands['flame.controls'],'function');
 const accepted=runtime.foregroundCommands['flame.controls']({resolution:32},f.context);assert.equal(accepted.acceptedControls.resolution,32);
 assert.equal(f.volumeOptions().getControls().resolution,32);assert.equal(f.payload.flameControls.resolution,16);
 assert.throws(()=>runtime.foregroundCommands['flame.controls']({resolution:0},f.context),/invalid grid/);assert.equal(f.volumeOptions().getControls().resolution,32);
 await runtime.retire(f.context);
});

function viewSnapshot(position){const camera=new THREE.PerspectiveCamera(51,2,.1,300);camera.position.fromArray(position);camera.lookAt(0,0,0);return {type:'PerspectiveCamera',position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),target:[0,0,0],fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,zoom:camera.zoom,filmGauge:camera.filmGauge,filmOffset:camera.filmOffset,projectionMatrix:camera.projectionMatrix.toArray()};}
test('common factory applies initial and admitted camera snapshots to its actual scene camera',async()=>{
 const f=fixture();f.payload.camera=viewSnapshot([2,3,6]);const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});await runtime.initialize(f.context);
 assert.deepEqual(f.objects().camera.position.toArray(),[2,3,6]);
 const input={now:1,viewport:{width:80,height:40,pixelRatio:2},camera:viewSnapshot([-2,4,7])};
 await runtime.requestFrame(input,f.context,()=>runtime.frame(input,f.context));
 assert.deepEqual(f.objects().camera.position.toArray(),[-2,4,7]);assert.deepEqual(f.objects().camera.projectionMatrix.toArray(),input.camera.projectionMatrix);
 assert.equal(f.calls.filter(row=>row==='render.resize').length,1);await runtime.retire(f.context);
});

test('saved initialization controls apply before volume allocation through the same live admitted control owner',async t=>{
 const f=fixture();let inputs;const create=f.options.createSceneResources;
 f.options.createSceneResources=value=>{inputs=value;return create(value);};
 const initialize=f.sceneResources.initialize;
 f.sceneResources.initialize=async function(ctx){
  assert.equal(typeof inputs.applyFlameControls,'function','saved recipes must update accepted controls before allocating the volume');
  inputs.applyFlameControls({resolution:32},ctx);assert.equal(inputs.readFlameControls().resolution,32);
  assert.equal(f.volumeOptions(),undefined,'do not allocate a default field before applying saved dimensions');
  await initialize.call(this,ctx);
 };
 const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});t.after(()=>runtime.retire(f.context));await runtime.initialize(f.context);
 assert.equal(f.volumeOptions().getControls().resolution,32);assert.equal(f.payload.flameControls.resolution,16);
 runtime.foregroundCommands['flame.controls']({resolution:48},f.context);assert.equal(inputs.readFlameControls().resolution,48);
});


test('saved volume resources are prepared before first activation, and preparation failure never activates',async()=>{
 for(const fail of [false,true]){
  const f=fixture();f.sceneResources.prepareVolume=async({volume,context})=>{context.assertCurrent();assert.equal(volume.foregroundGpuContext().device,f.device);assert.equal(f.calls.some(row=>Array.isArray(row)&&row[0]==='volume.active'),false);f.calls.push('volume.prepare');if(fail)throw Error('saved source preparation failed');};
  const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});
  if(fail){await assert.rejects(runtime.initialize(f.context),/saved source preparation failed/);assert.equal(f.calls.some(row=>Array.isArray(row)&&row[0]==='volume.active'),false);}
  else{await runtime.initialize(f.context);assert.ok(f.calls.indexOf('volume.prepare')<f.calls.findIndex(row=>Array.isArray(row)&&row[0]==='volume.active'));}
  await runtime.retire(f.context);
 }
});

test('scene without fire can keep its retained volume inactive at initialization',async()=>{
 const f=fixture();f.sceneResources.initialVolumeActive=false;const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});
 await runtime.initialize(f.context);assert.deepEqual(f.calls.filter(row=>Array.isArray(row)&&row[0]==='volume.active'),[['volume.active',false]]);
 await runtime.retire(f.context);
});

test('current domain UI reaches serviced frame and edit receipts without reusing initializer progress',async()=>{
 const f=fixture();let phase='initial';f.sceneResources.readUi=()=>({lighting:{phase},surfaces:{volume:{visible:false}}});
 const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});await runtime.initialize(f.context);phase='live';
 const input={now:1},frame=await runtime.requestFrame(input,f.context,()=>runtime.frame(input,f.context));
 assert.equal(frame.result.ui.lighting?.phase,'live');assert.equal(frame.result.ui.surfaces.volume.visible,false);assert.equal(frame.result.ui.surfaces.volume.active,true);
 phase='edited';const edit=await runtime.requestMutation('scene.move',{},f.context,()=>runtime.foregroundCommands['scene.move']());
 assert.equal(edit.ui.lighting?.phase,'edited');assert.equal(edit.ui.surfaces.volume.visible,false);await runtime.retire(f.context);
});

test('actual domain constructor receives a live shared-device reader that clears after retirement',async()=>{
 const f=fixture();let input;const create=f.options.createSceneResources;f.options.createSceneResources=value=>{input=value;return create(value);};
 const runtime=factory(f.options)({payload:f.payload,lifecycle:{}});await runtime.initialize(f.context);
 assert.equal(typeof input.readSharedGpu,'function','presentation recovery needs the current owner rather than the initial device snapshot');assert.equal(input.readSharedGpu().device,f.device);
 const read=input.readSharedGpu;await runtime.retire(f.context);assert.equal(read(),null);
});

function recoveryFixture({failReplacement=false}={}){
 const f=fixture();let lose,epochChanged,attempt=0,input;
 f.device.lost=new Promise(resolve=>{lose=resolve;});
 const next={queue:{submit(){},onSubmittedWorkDone:async()=>{}},lost:new Promise(()=>{}),destroy:()=>f.calls.push('next.device.dispose')};
 const shared={device:next,queue:next.queue,adapter:{}};
 const originalCreate=f.options.createSceneResources;f.options.createSceneResources=value=>{input=value;return originalCreate(value);};
 const acquire=f.options.services.requestDevice;f.options.services.requestDevice=async options=>++attempt===1?acquire(options):shared;
 let active=true,paused=true;
 f.options.services.createVolume=options=>({isActive:()=>active,debugState:()=>({simulationPaused:paused}),retireLostDevice:()=>f.calls.push('volume.lost'),setSimulationPaused:value=>{paused=value;},setActive:async value=>{active=value;options.presentationSurface.setActive(value);f.calls.push(['volume.active',value]);},
  setControls:()=>{},dispose:()=>f.calls.push('volume.dispose'),foregroundGpuContext:()=>({device:options.sharedGpuContext.device,queue:options.sharedGpuContext.device.queue,renderer:'ordinary-volume',productFrameOwner:'prototype'}),renderSharedFrame:({service})=>{assert.equal(service.device,options.sharedGpuContext.device);return {flameDrawn:active};}});
 Object.assign(f.sceneResources,{async attachVolume(){f.calls.push('scene.attach');},stopRendererResources(){f.calls.push('presentation.stop');},async releaseVolume(){f.calls.push('volume.release');},async releaseRendererPresentation(){f.calls.push('presentation.release');},async restoreRendererPresentation(){f.calls.push('presentation.restore');},async prepareVolume(){f.calls.push('volume.prepare');},async reattachVolume(){f.calls.push('volume.reattach');}});
 const render=f.options.services.createRenderResources;f.options.services.createRenderResources=options=>{const owner=render(options);owner.replaceRenderer=async shared=>{f.calls.push('renderer.replace');assert.equal(shared.device,next);if(failReplacement){failReplacement=false;throw Error('replacement allocation refused');}owner.renderer={replacement:true};return {renderer:owner.renderer};};return owner;};
 const invalidated=new Promise(resolve=>{epochChanged=resolve;});
 return {...f,next,invalidated,lose:()=>lose({reason:'destroyed',message:'controlled loss'}),input:()=>input,createRuntime:args=>factory(f.options)({...args,payload:{...args.payload,sceneCanvas:f.payload.sceneCanvas,volumeCanvas:f.payload.volumeCanvas},lifecycle:{...args.lifecycle,invalidate(part){const value=args.lifecycle.invalidate(part);epochChanged(value);return value;}}})};
}
test('explicit device recovery retains authored state and accepted controls on the new shared host',async t=>{
 const f=recoveryFixture(),{port1,port2}=new MessageChannel();let runtime;
 const host=installSceneWorkerHost({port:port2,createRuntime:args=>(runtime=f.createRuntime(args))}),client=createSceneWorkerClient({port:port1,sessionId:'retained-recovery'});
 t.after(()=>{client.disconnect();host.disconnect();port1.close();port2.close();});
 await client.initialize({viewport:f.payload.viewport,flameControls:f.payload.flameControls}).completion;assert.equal(typeof runtime.commands['renderer.recover'],'function');await client.request('scene.move',{}).completion;await client.request('flame.controls',{resolution:32}).completion;
 const epoch=once(port1,'message');f.lose();await f.invalidated;await epoch;assert.equal(host.read().phase,'invalidated');assert.equal(f.calls.includes('presentation.stop'),true);await assert.rejects(client.request('frame',{now:1}).completion,/not active/);
 await client.request('renderer.recover',{}).completion;assert.equal(host.read().phase,'active');assert.equal(runtime.host.device,f.next);assert.equal(f.input().readSharedGpu().device,f.next);assert.equal(f.input().readFlameControls().resolution,32);
 assert.equal((await client.request('scene.read',{}).completion).output.registered,true);assert.equal(f.calls.filter(row=>row==='scene.initialize').length,1);assert.equal(f.calls.includes('scene.dispose'),false);
 assert(f.calls.indexOf('volume.release')<f.calls.indexOf('presentation.release'));assert(f.calls.indexOf('presentation.restore')<f.calls.indexOf('volume.reattach'));
 assert.equal((await client.request('frame',{now:2}).completion).output.result.flameDrawn,true);assert.equal((await client.request('renderer.read',{}).completion).output.phase,'active');
 await client.request('retire').completion;
});
