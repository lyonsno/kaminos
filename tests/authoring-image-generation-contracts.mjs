import test from 'node:test';import assert from 'node:assert/strict';
import * as module from '../authoring-image-generation.mjs';
const {kleinDeviceRequirements,composeDeviceRequirements,createForegroundHandoff,createKleinAuthoringImageGeneration,kleinImageName}=module;
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const LIMITS={maxBufferSize:4294967296,maxStorageBufferBindingSize:4294967292,maxStorageBuffersPerShaderStage:31,maxComputeWorkgroupStorageSize:32768};

test('klein asks the one shared device for shader-f16 and the adapter limits its kernels use',()=>{
 const adapter={features:new Set(['shader-f16','timestamp-query','float32-filterable']),limits:{...LIMITS,maxTextureDimension2D:16384}};
 assert.deepEqual(kleinDeviceRequirements(adapter),{requiredFeatures:['shader-f16'],requiredLimits:LIMITS});
 assert.equal(kleinDeviceRequirements({features:new Set(['timestamp-query']),limits:LIMITS}),null,'an adapter without f16 leaves the device unchanged; klein reports itself unavailable');
});

test('device requirements compose upward for max limits, downward for alignments, and union features',()=>{
 assert.deepEqual(composeDeviceRequirements(
  {requiredFeatures:['shader-f16'],requiredLimits:{maxBufferSize:10,minStorageBufferOffsetAlignment:256}},
  null,
  {requiredFeatures:['timestamp-query','shader-f16'],requiredLimits:{maxBufferSize:40,minStorageBufferOffsetAlignment:64,maxComputeWorkgroupStorageSize:32768}}),
 {requiredFeatures:['shader-f16','timestamp-query'],requiredLimits:{maxBufferSize:40,minStorageBufferOffsetAlignment:64,maxComputeWorkgroupStorageSize:32768}});
 assert.equal(composeDeviceRequirements(null,undefined),null);
});

test('image names carry the prompt and seed and stay inside the image inbox name rules',()=>{
 assert.equal(kleinImageName('A weathered bronze lantern, studio light!',42),'klein-a-weathered-bronze-lantern-studio-light-s42.png');
 assert.match(kleinImageName('x'.repeat(400),7),/^klein-x{1,80}-s7\.png$/);
 assert.equal(kleinImageName('???',3),'klein-image-s3.png');
});

function prototypeDouble(){
 const installs=[];let pendingRefusals=0;
 return {installs,refuseNext(n){pendingRefusals=n;},
  setForegroundOpportunityRequester(requester){if(pendingRefusals>0){pendingRefusals--;throw Error('foreground frame is still pending');}installs.push(requester);},
  foregroundGpuContext:()=>({renderer:'ordinary-volume',productFrameOwner:'prototype'})};
}

test('foreground handoff records the SF3D requester, lends the kiln to klein, and waits out a pending frame',async()=>{
 const prototype=prototypeDouble(),host={setForegroundServiceActive(){},runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 const sf3dView=handoff.recording('sf3d');const sf3d=()=>({completion:Promise.resolve()});
 sf3dView.setForegroundOpportunityRequester(sf3d);
 assert.equal(sf3dView.foregroundGpuContext().renderer,'ordinary-volume','the recording view must still be the real prototype for SF3D checks');
 assert.equal(handoff.owner(),'sf3d');
 const klein=()=>({completion:Promise.resolve()});handoff.install('klein',klein);
 prototype.refuseNext(2);await handoff.activate('klein');
 assert.equal(prototype.installs.at(-1),klein);assert.equal(handoff.owner(),'klein');
 await handoff.activate('sf3d');assert.equal(prototype.installs.at(-1),sf3d);
 await assert.rejects(handoff.activate('nobody'),/no foreground requester/);
});

test('release returns the kiln to its private loop so SF3D can install its requester without a pending frame',async()=>{
 const prototype=prototypeDouble(),active=[],host={setForegroundServiceActive:value=>active.push(value),runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 handoff.install('klein',()=>({completion:Promise.resolve()}));await handoff.activate('klein');
 prototype.refuseNext(1);await handoff.release();
 assert.equal(prototype.installs.at(-1),null);assert.equal(handoff.owner(),null);assert.deepEqual(active,[true,false]);
 await handoff.release();assert.equal(prototype.installs.length,2,'releasing an unowned kiln does nothing');
});

function kitDouble(log){
 return {
  createWebGpuInferenceSession:async options=>({options,registerRoute:async({routeId,runtimeOptions})=>{log.push(`route:${routeId}`);return{routeId,runtime:{label:runtimeOptions.runtimeLabel},
   enqueue:({jobId,execute})=>({completion:(async()=>{try{return{status:'succeeded',output:await execute({jobId})};}catch(error){return{status:error.name==='AbortError'?'canceled':'failed',failure:{name:error.name,message:error.message}};}})()}),
   drain:async()=>log.push('drain')};},unregisterRoute:id=>log.push(`unregister:${id}`)}),
  createWebGpuForegroundService:({routeId,device})=>({routeId,device,request:input=>({requestId:input.requestId,completion:Promise.resolve({status:'completed'})}),
   beginRun:async runId=>{log.push(`begin:${runId.split(':')[0]}`);return{foregroundOpportunities:{},withForeground:fn=>fn(),finish:async()=>log.push('finish')};}}),
  createWebGpuInferenceControl:({signal})=>({signal,close:async()=>log.push('close'),snapshot:()=>({status:'running'})}),
 };
}

function harness({features=['shader-f16'],gate=null}={}){
 const log=[],delivered=[],prototype=prototypeDouble(),host={setForegroundServiceActive:value=>log.push(`active:${value}`),runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 const device={features:new Set(features),queue:{submit(){}}};
 let loads=0,generations=[];
 const service=createKleinAuthoringImageGeneration({
  context:()=>({sharedGpu:{device,queue:device.queue},prototype,host,handoff}),
  kit:async()=>kitDouble(log),
  weights:async()=>'/klein-weights',
  createPipeline:(givenDevice,urls)=>{assert.equal(givenDevice,device,'klein must run on the host shared device');assert.deepEqual(urls,{textEncoderUrl:'/klein-weights/te',transformerUrl:'/klein-weights/dit',vaeUrl:'/klein-weights/vae'});
   return{load:async progress=>{loads++;progress('transformer','dit/double00.bin',{loadedBytes:30,totalBytes:120});},
    generate:async request=>{generations.push(request);log.push(`owner:${handoff.owner()}`);request.onPhase('text');request.onStep(2,4);if(gate)await gate.promise;
     if(request.schedule.signal.aborted)throw request.schedule.signal.reason;return{rgba:new Uint8ClampedArray(request.width*request.height*4),width:request.width,height:request.height,timings:{totalMs:5}};}};},
  encodePng:async(rgba,width,height)=>{assert.equal(rgba.length,width*height*4);return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});},
  deliver:async(file,provenance)=>{delivered.push({file,provenance});return{source:`/api/read?root=image-inbox&path=${file.name}`,name:file.name};},
 });
 return {service,log,delivered,handoff,prototype,generations,loads:()=>loads};
}

test('a prompt becomes a saved image on the shared device while the kiln stays on the foreground service',async()=>{
 const h=harness(),sf3d=()=>({completion:Promise.resolve()});h.handoff.recording('sf3d').setForegroundOpportunityRequester(sf3d);
 const progress=[];const states=[];
 const first=await h.service.run({prompt:'A bronze lantern',seed:42,size:512,onState:s=>states.push(s)});
 assert.equal(first.name,'klein-a-bronze-lantern-s42.png');
 assert.equal(h.delivered.length,1);assert.equal(h.delivered[0].file.type,'image/png');
 assert.deepEqual(h.delivered[0].provenance,{schema:'kaminos.image-generation.v1',route:'flux2-klein.text-to-image.authoring-shared-device.v0',model:'FLUX.2 [klein] 4B',prompt:'A bronze lantern',seed:42,width:512,height:512,weights:'/klein-weights',timings:{totalMs:5}});
 assert.ok(h.log.includes('owner:klein'),'denoising runs while klein owns the kiln foreground');
 assert.equal(h.handoff.owner(),'sf3d','after the image the kiln returns to SF3D so mesh generation keeps interleaving frames');
 assert.ok(h.log.indexOf('finish')>h.log.indexOf('drain'),'route drains before the foreground run finishes');
 assert.equal(h.generations[0].textLength,'fit16');assert.equal(h.generations[0].steps,undefined,'klein keeps its own step count');
 await h.service.run({prompt:'A clay teapot',seed:7,size:512});
 assert.equal(h.loads(),1,'weights load once per page and stay for the next prompt');
 assert.equal(h.service.read().status,'complete');assert.equal(h.service.read().results.length,2);
});

test('progress reports weight bytes and denoising steps, never an invented whole-run percentage',async()=>{
 const gate=deferred(),h=harness({gate});const seen=[];
 const run=h.service.run({prompt:'lantern',seed:1,size:512});
 for(let i=0;i<20&&!h.generations.length;i++)await tick();
 const state=h.service.read();assert.equal(state.status,'running');assert.equal(state.stage,'Denoising');assert.equal(state.percent,50);assert.equal(state.canStop,true);
 gate.resolve();await run;assert.equal(h.service.read().percent,100);
});

test('Stop during denoising leaves no image, settles the route, and gives the kiln back',async()=>{
 const gate=deferred(),h=harness({gate}),sf3d=()=>({completion:Promise.resolve()});h.handoff.recording('sf3d').setForegroundOpportunityRequester(sf3d);
 const run=h.service.run({prompt:'lantern',seed:1,size:512});
 for(let i=0;i<20&&!h.generations.length;i++)await tick();
 assert.equal(h.service.stop(),true);assert.equal(h.service.read().status,'stopping');
 gate.resolve();assert.equal(await run,null);
 assert.equal(h.service.read().status,'stopped');assert.equal(h.delivered.length,0);
 assert.ok(h.log.includes('drain')&&h.log.includes('finish')&&h.log.includes('close'));assert.equal(h.handoff.owner(),'sf3d');
 assert.equal(h.service.busy(),false);
});

test('a device without shader-f16 makes klein unavailable instead of failing inside a kernel',async()=>{
 const h=harness({features:[]});
 assert.equal(h.service.read().status,'unavailable');assert.match(h.service.read().error,/shader-f16/);
 await assert.rejects(h.service.run({prompt:'lantern',seed:1,size:512}),/shader-f16/);assert.equal(h.loads(),0);
});

test('an empty prompt and a concurrent run are refused before any GPU work',async()=>{
 const gate=deferred(),h=harness({gate});
 await assert.rejects(h.service.run({prompt:'   ',seed:1,size:512}),/Describe/);assert.equal(h.loads(),0);
 const run=h.service.run({prompt:'lantern',seed:1,size:512});await tick();
 await assert.rejects(h.service.run({prompt:'teapot',seed:2,size:512}),/already running/);
 gate.resolve();await run;
});

test('image size is one of the tested klein sizes and reaches the pipeline',async()=>{
 const h=harness();
 await h.service.run({prompt:'lantern',seed:1,size:768});
 assert.equal(h.generations[0].width,768);assert.equal(h.generations[0].height,768);
 assert.equal(h.delivered[0].provenance.width,768);
 await assert.rejects(h.service.run({prompt:'lantern',seed:1,size:640}),/512, 768 or 1024/);
 assert.equal(h.generations.length,1,'an unsupported size is refused before GPU work');
});
