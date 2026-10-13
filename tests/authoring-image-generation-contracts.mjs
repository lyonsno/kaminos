// kaminos-test: node
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

function harness({features=['shader-f16'],gate=null,deliverFails=0}={}){
 let deliverFailures=deliverFails;
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
  encodePng:async(rgba,width,height)=>{assert.equal(rgba.length,width*height*4);return new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'});},
  deliver:async(file,provenance)=>{if(deliverFailures-->0)throw Error('image inbox unavailable');delivered.push({file,provenance});return{source:`/api/read?root=image-inbox&path=${file.name}`,name:file.name};},
 });
 return {service,log,delivered,handoff,prototype,generations,loads:()=>loads};
}

test('a prompt becomes a saved image on the shared device while the kiln stays on the foreground service',async()=>{
 const h=harness(),sf3d=()=>({completion:Promise.resolve()});h.handoff.recording('sf3d').setForegroundOpportunityRequester(sf3d);
 const progress=[];const states=[];
 const first=await h.service.run({prompt:'A bronze lantern',seed:42,size:512,onState:s=>states.push(s)});
 assert.equal(first.name,'klein-a-bronze-lantern-s42.png');
 assert.equal(h.delivered.length,1);assert.equal(h.delivered[0].file.type,'image/png');
 assert.deepEqual(module.readPngProvenance(new Uint8Array(await h.delivered[0].file.arrayBuffer())),h.delivered[0].provenance,'the stored file itself carries the provenance');
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

test('a mesh request the model would refuse does not take the kiln from a running image',async()=>{
 const {runWithKilnHandoff}=module;assert.equal(typeof runWithKilnHandoff,'function');
 const prototype=prototypeDouble(),host={setForegroundServiceActive(){},runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 const klein=()=>({completion:Promise.resolve()}),sf3d=()=>({completion:Promise.resolve()});
 handoff.recording('sf3d').setForegroundOpportunityRequester(sf3d);handoff.install('klein',klein);await handoff.activate('klein');
 const refusals=[
  [{status:'unavailable',error:'An image is generating. Generate the mesh when it is saved.'},{source:'x'},/image is generating/],
  [{status:'running'},{source:'x'},/already running/],
  [{status:'complete',pending:{}},{source:'x'},/Save the retained/],
  [{status:'idle'},{},/Choose a source image/],
 ];
 for(const [state,input,message] of refusals){
  let ran=false;const service={read:()=>state,run:async()=>{ran=true;}};
  await assert.rejects(runWithKilnHandoff({service,input,handoff,owner:'sf3d'}),message);
  assert.equal(ran,false);assert.equal(handoff.owner(),'klein','the running image keeps the kiln');assert.equal(prototype.installs.at(-1),klein);
 }
 let ran=false;await runWithKilnHandoff({service:{read:()=>({status:'idle'}),run:async()=>{ran=true;}},input:{source:'x'},handoff,owner:'sf3d'});
 assert.equal(ran,true);assert.equal(handoff.owner(),'sf3d');
});

test('the saved PNG carries its own generation provenance in an iTXt chunk',async()=>{
 const {withPngProvenance,readPngProvenance}=module;
 // 1x1 PNG
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 const provenance={schema:'kaminos.image-generation.v1',prompt:'A lantern — “brass”',seed:7};
 const out=new Uint8Array(await (await withPngProvenance(new Blob([png],{type:'image/png'}),provenance)).arrayBuffer());
 assert.deepEqual(readPngProvenance(out),provenance);
 assert.deepEqual([...out.slice(-12,-8)],[0,0,0,0],'IEND stays last');assert.equal(new TextDecoder().decode(out.slice(-8,-4)),'IEND');
 assert.equal(readPngProvenance(png),null);
 // A corrupted chunk is not read back as provenance (the reader checks the chunk CRC).
 const broken=out.slice();broken[broken.length-20]^=1;assert.equal(readPngProvenance(broken),null);
});

test('KMA-01: a refused mesh request after a finished SF3D run keeps the kiln with the running image',async()=>{
 const {runWithKilnHandoff}=module;
 const prototype=prototypeDouble(),host={setForegroundServiceActive(){},runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 const klein=()=>({completion:Promise.resolve()}),sf3d=()=>({completion:Promise.resolve()});
 handoff.recording('sf3d').setForegroundOpportunityRequester(sf3d);handoff.install('klein',klein);await handoff.activate('klein');
 for(const status of ['failed','complete','stopped']){
  let ran=false;const service={read:()=>({status}),run:async()=>{ran=true;}};
  await assert.rejects(runWithKilnHandoff({service,input:{source:'x'},handoff,owner:'sf3d',blocked:()=>'An image is generating. Generate the mesh when it is saved.'}),/image is generating/);
  assert.equal(ran,false);assert.equal(handoff.owner(),'klein',`terminal ${status} must not bypass admission`);
 }
});

test('KMA-02: with no optional host requirements the shared device is still acquired',async()=>{
 const {sharedDeviceHostRequirements}=module;assert.equal(typeof sharedDeviceHostRequirements,'function');
 const {requestKaminosSharedWebGpuDevice}=await import('../volume-core.js');
 const limits={maxBufferSize:2**31,maxStorageBufferBindingSize:2**31,maxStorageBuffersPerShaderStage:16,maxStorageBuffersInFragmentStage:8,maxStorageBuffersInVertexStage:8,maxComputeWorkgroupStorageSize:32768};
 const features=new Set(['timestamp-query']);let requests=0;
 const adapter={features,limits,requestDevice:async d=>{requests++;return {features:new Set(d.requiredFeatures||[]),limits:{...limits},queue:{},destroy(){},lost:new Promise(()=>{})};}};
 const shared=await requestKaminosSharedWebGpuDevice({adapter,hostRequirements:sharedDeviceHostRequirements({sam:null})});
 assert.ok(shared.device,'ordinary authoring keeps its shared device');assert.equal(requests,1);
 assert.equal(shared.device.features.has('shader-f16'),false,'klein then reports itself unavailable');
});

test('KMA-04: a finished image survives a failed save and retries without another generation',async()=>{
 const h=harness({deliverFails:1});
 await assert.rejects(h.service.run({prompt:'lantern',seed:3,size:512}),/image inbox unavailable/);
 const failed=h.service.read();assert.equal(failed.status,'failed');assert.ok(failed.pending,'the image is retained');
 await assert.rejects(h.service.run({prompt:'teapot',seed:4,size:512}),/Save the generated image/);
 const saved=await h.service.retryPersistence();
 assert.equal(h.generations.length,1,'no second inference');assert.equal(saved.name,'klein-lantern-s3.png');
 assert.equal(h.delivered[0].provenance.seed,3);assert.equal(h.service.read().status,'complete');assert.equal(h.service.read().pending,null);
});

test('with the app GPU host, klein borrows its session and runs as a klein route on the one app service',async()=>{
 const log=[],prototype=prototypeDouble(),host={setForegroundServiceActive(){},runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 const device={features:new Set(['shader-f16']),queue:{submit(){}}};
 const session={registerRoute:async({routeId})=>({routeId,runtime:{},enqueue:({jobId,execute})=>({completion:(async()=>({status:'succeeded',output:await execute({jobId})}))()}),drain:async()=>log.push('drain')}),unregisterRoute:()=>{}};
 const appHost={session:async()=>{log.push('host-session');return session;},beginRun:async(runId,{routeId})=>{log.push(`begin:${routeId}`);return {foregroundOpportunities:{},withForeground:fn=>fn(),finish:async()=>log.push('finish')};}};
 const service=createKleinAuthoringImageGeneration({
  context:()=>({sharedGpu:{device,queue:device.queue},prototype,host,handoff}),appHost:async()=>appHost,
  kit:async()=>({createWebGpuInferenceSession:async()=>{throw Error('no private session with an app host');},createWebGpuForegroundService:()=>{throw Error('no private foreground service with an app host');},createWebGpuInferenceControl:()=>({close:async()=>{}})}),
  weights:async()=>'/klein-weights',
  createPipeline:()=>({load:async()=>{},generate:async r=>({rgba:new Uint8ClampedArray(r.width*r.height*4),width:r.width,height:r.height,timings:{}})}),
  encodePng:async()=>new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'}),
  deliver:async file=>({name:file.name,source:'/s'}),
 });
 await service.run({prompt:'lantern',seed:1,size:512});
 assert.deepEqual(log,['host-session','begin:flux2-klein.text-to-image.authoring-shared-device.v0','drain','finish']);
 assert.equal(handoff.has('klein'),false,'no private klein requester when the app owns the frames');
});
