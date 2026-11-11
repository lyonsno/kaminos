// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createSceneWorkerClient,installSceneWorkerHost} from '../scene-worker-handoff.mjs';
import {createWebGpuForegroundService} from '../webgpu-inference-kit/src/core.js';
const module=await import('../scene-worker-runtime.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
function factory(options){assert.equal(typeof module.createSceneWorkerRuntimeFactory,'function','actual worker composition must return a retained shell before allocation');return module.createSceneWorkerRuntimeFactory(options);}
function fixture({failInitialize=false,failCleanup=false}={}){
 const calls=[],device={queue:{submit(){},onSubmittedWorkDone:async()=>calls.push('settled')},destroy:()=>calls.push('device.dispose')},shared={device,adapter:{},queue:device.queue};
 const signal=new AbortController().signal,context={signal,assertCurrent(){signal.throwIfAborted();},report(){}};
 let owner=null,volumeOptions,registered=false,cleanupFails=failCleanup;
 const sceneFrames={runForegroundFrame:run=>({...run(),sceneDrawn:true}),setForegroundServiceActive:()=>calls.push('foreground.active')};
 const sceneResources={frames:sceneFrames,commands:{'scene.read':()=>({registered})},foregroundCommands:{'scene.move':()=>{registered=true;return {moved:true};}},
  async initialize(){calls.push('scene.initialize');if(failInitialize)throw Error('scene allocation failed');},
  async attachVolume(input){assert.equal(input.volume,owner);calls.push('scene.attach');},
  applyFrameInputs(payload){calls.push(['input',payload]);},
  async retire(){calls.push('scene.dispose');if(cleanupFails){cleanupFails=false;throw Error('resource retirement failed');}}};
 const renderer={dispose:()=>calls.push('renderer.dispose')};
 const options={THREE:{},createSceneResources:input=>{assert.equal(input.sharedGpu,shared);calls.push('scene.shell');return sceneResources;},imageOptions:null,
  services:{requestDevice:async()=>{calls.push('acquire');return shared;},kit:{createWebGpuForegroundService},
   createRenderObjects:()=>({scene:{},camera:{}}),createRenderer:async input=>{assert.equal(input.sharedGpu,shared);input.onConstructed(renderer);return {renderer,pmremGenerator:{dispose:()=>calls.push('pmrem.dispose')}};},
   createVolume:input=>{volumeOptions=input;owner={setActive:async active=>calls.push(['volume.active',active]),dispose:()=>calls.push('volume.dispose'),
    foregroundGpuContext:()=>({device,queue:device.queue,renderer:'ordinary-volume',productFrameOwner:'prototype'}),
    renderSharedFrame:({service})=>{assert.equal(service.device,device);calls.push('volume.frame');return {flameDrawn:true};}};return owner;},
  }};
 const payload={sceneCanvas:{},volumeCanvas:{getContext(){}},viewport:{width:32,height:32,pixelRatio:1},flameControls:{resolution:16}};
 return {options,payload,context,calls,device,sceneResources,volumeOptions:()=>volumeOptions};
}
test('factory retains a shell before any allocation and composes one admitted ordinary frame',async()=>{
 const f=fixture(),runtime=factory(f.options)({payload:f.payload,lifecycle:{}});assert.deepEqual(f.calls,[]);assert.equal(runtime.host,null);
 await runtime.initialize(f.context);assert.equal(runtime.host.device,f.device);
 const options=f.volumeOptions();assert.equal(options.sharedGpuContext.device,f.device);assert.equal(options.frameScheduleOwner,'host');assert.equal(options.productFrameOwner,'prototype');
 assert.deepEqual(options.getControls(),f.payload.flameControls);assert.equal(options.presentationSurface.canvas,f.payload.volumeCanvas);
 const payload={now:1};const receipt=await runtime.requestFrame(payload,f.context,()=>runtime.frame(payload,f.context));
 assert.equal(receipt.status,'completed');assert.equal(receipt.result.flameDrawn,true);assert.equal(receipt.result.sceneDrawn,true);
 assert.deepEqual(f.calls.filter(Array.isArray).at(-1),['input',payload]);
 const mutation=await runtime.requestMutation('scene.move',{},f.context,()=>runtime.foregroundCommands['scene.move']());
 assert.equal(mutation.mutationApplied,true);assert.equal(runtime.commands['scene.read']().registered,true);
 await runtime.retire(f.context);assert.deepEqual(f.calls.slice(-5),['scene.dispose','volume.dispose','pmrem.dispose','renderer.dispose','device.dispose']);
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
 const f=fixture();f.device.features=new Set(['shader-f16']);let open,finish;
 const started=new Promise(resolve=>{open=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const kit=f.options.services.kit;kit.createWebGpuInferenceSession=async()=>({
  registerRoute:async()=>({runtime:{},enqueue:({execute})=>({completion:Promise.resolve().then(()=>execute({})).then(output=>({status:'succeeded',output}))}),drain:async()=>{}}),
  unregisterRoute(){},close(){f.calls.push('session.close');},
 });kit.createWebGpuInferenceControl=()=>({close:async()=>{}});
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
 const model=client.request('image.generate',{prompt:'lantern',seed:1,size:256});model.completion.catch(()=>{});
 await started;assert.equal(runtime.host.device,f.device);assert.equal(runtime.host.unsettledRuns().length,1);
 const frame=await client.request('frame',{now:2}).completion;assert.equal(frame.output.result.flameDrawn,true);
 const edit=await client.request('scene.move',{}).completion;assert.equal(edit.output.mutationApplied,true);
 finish();assert.equal((await model.completion).output.entry.source,'/saved/image.png');
 await client.request('retire').completion;assert.ok(f.calls.indexOf('model.dispose')<f.calls.indexOf('session.close'));
});
