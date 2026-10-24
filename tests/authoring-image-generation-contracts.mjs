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

function harness({features=['shader-f16'],gate=null,deliverFails=0,swapFails=0,modelWeights=null,loadFails=0,clock=undefined,onLoad=null,onGenerate=null}={}){
 let loadFailures=loadFails;
 let swapFailures=swapFails;const pipelines=[];
 let deliverFailures=deliverFails;
 const log=[],delivered=[],prototype=prototypeDouble(),host={setForegroundServiceActive:value=>log.push(`active:${value}`),runForegroundFrame:run=>run()};
 const handoff=createForegroundHandoff({prototype,host,waitFrame:tick});
 const device={features:new Set(features),queue:{submit(){}}};
 let loads=0,generations=[];const swaps=[];
 const service=createKleinAuthoringImageGeneration({
  clock,context:()=>({sharedGpu:{device,queue:device.queue},prototype,host,handoff}),
  kit:async()=>kitDouble(log),
  weights:modelWeights|| (async()=>'/klein-weights'),
  createPipeline:(givenDevice,urls,model='flux2')=>{assert.equal(givenDevice,device,'klein must run on the host shared device');pipelines.push({...urls,model});
   const root=model==='flux3'?'/flux3-weights':'/klein-weights';assert.deepEqual({...urls,transformerUrl:undefined},{textEncoderUrl:`${root}/te`,transformerUrl:undefined,vaeUrl:`${root}/vae`});
   return{sampling:model==='flux3'?{shift:3,steps:4}:undefined,ditManifest:model==='flux3'?{source:{repo:'black-forest-labs/flux-3-image-klein-base',revision:'observed-revision'},lora:{sha256:'observed-adapter-hash'}}:undefined,
    destroy:async()=>log.push(`destroy:${model}`),
    load:async progress=>{await onLoad?.();loads++;log.push(`load:${model}`);if(loadFailures-->0)throw Error('local weight load failed');progress('transformer','dit/double00.bin',{loadedBytes:30,totalBytes:120});},
    loadTransformer:async(url,progress)=>{swaps.push(url);if(swapFailures-->0)throw Error('bundle download failed');progress?.('transformer','double00.bin',{loadedBytes:10,totalBytes:20});return {downloadedBytes:0};},
    generate:async request=>{generations.push(request);await onGenerate?.(request);log.push(`owner:${handoff.owner()}`);request.onPhase('text');request.onStep(2,4);if(gate)await gate.promise;
     if(request.schedule.signal.aborted)throw request.schedule.signal.reason;return{rgba:new Uint8ClampedArray(request.width*request.height*4),width:request.width,height:request.height,timings:{totalMs:5}};}};},
  encodePng:async(rgba,width,height)=>{assert.equal(rgba.length,width*height*4);return new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))],{type:'image/png'});},
  deliver:async(file,provenance)=>{if(deliverFailures-->0)throw Error('image inbox unavailable');delivered.push({file,provenance});return{source:`/api/read?root=image-inbox&path=${file.name}`,name:file.name};},
 });
 return {service,log,delivered,handoff,prototype,generations,swaps,pipelines,loads:()=>loads};
}

test('a prompt becomes a saved image on the shared device while the kiln stays on the foreground service',async()=>{
 const h=harness(),sf3d=()=>({completion:Promise.resolve()});h.handoff.recording('sf3d').setForegroundOpportunityRequester(sf3d);
 const progress=[];const states=[];
 const first=await h.service.run({prompt:'A bronze lantern',seed:42,size:512,onState:s=>states.push(s)});
 assert.equal(first.name,'klein-a-bronze-lantern-s42.png');
 assert.equal(h.delivered.length,1);assert.equal(h.delivered[0].file.type,'image/png');
 assert.deepEqual(module.readPngProvenance(new Uint8Array(await h.delivered[0].file.arrayBuffer())),h.delivered[0].provenance,'the stored file itself carries the provenance');
 assert.deepEqual((({elapsed,...rest})=>rest)(h.delivered[0].provenance),{schema:'kaminos.image-generation.v1',route:'flux2-klein.text-to-image.authoring-shared-device.v0',model:'FLUX.2 [klein] 4B',prompt:'A bronze lantern',seed:42,width:512,height:512,weights:'/klein-weights',aspect:'square',weightsLevel:'4-bit',transformer:'/klein-weights/dit',timings:{totalMs:5}});
 assert.ok(h.log.includes('owner:klein'),'denoising runs while klein owns the kiln foreground');
 assert.equal(h.handoff.owner(),'sf3d','after the image the kiln returns to SF3D so mesh generation keeps interleaving frames');
 assert.ok(h.log.indexOf('finish')>h.log.indexOf('drain'),'route drains before the foreground run finishes');
 assert.equal(h.generations[0].textLength,'fit16');assert.equal(h.generations[0].steps,undefined,'klein keeps its own step count');
 await h.service.run({prompt:'A clay teapot',seed:7,size:512});
 assert.equal(h.loads(),1,'weights load once per page and stay for the next prompt');
 assert.equal(h.service.read().status,'complete');assert.equal(h.service.read().results.length,2);
});

test('FLUX.3 uses its pipeline and local weights and saves the effective model recipe in the PNG',async()=>{
 const h=harness({modelWeights:async model=>model==='flux3'?'/flux3-weights':'/klein-weights'});
 await h.service.run({model:'flux3',prompt:'a copper kettle',seed:9});
 assert.equal(h.pipelines[0].model,'flux3','a FLUX.3 request must not silently use KleinPipeline');
 assert.equal(h.pipelines[0].transformerUrl,'/flux3-weights/dit');
 const p=h.delivered[0].provenance;
 assert.equal(p.model,'FLUX.3 Image Klein');assert.equal(p.route,'flux3-klein.text-to-image.authoring-shared-device.v0');
 assert.equal(p.weights,'/flux3-weights');assert.deepEqual(p.sampling,{shift:3,steps:4});
 assert.deepEqual(p.source,{repo:'black-forest-labs/flux-3-image-klein-base',revision:'observed-revision'});
 assert.deepEqual(p.lora,{sha256:'observed-adapter-hash'});
 assert.deepEqual(module.readPngProvenance(new Uint8Array(await h.delivered[0].file.arrayBuffer())),p);
 assert.ok(h.log.includes(`route:${p.route}`),'the runtime route must agree with the saved image');
 await h.service.run({model:'flux3',prompt:'a copper kettle',seed:10});assert.equal(h.loads(),1);
 await h.service.run({model:'flux2',prompt:'a copper kettle',seed:11});
 assert.ok(h.log.indexOf('destroy:flux3')<h.log.indexOf('load:flux2'),'release the previous model before loading another');
 assert.equal(h.delivered.at(-1).provenance.model,'FLUX.2 [klein] 4B');
});

test('FLUX.3 cannot silently substitute published FLUX.2 weights or an unsupported quantization',async()=>{
 assert.equal(typeof module.authoringImageWeightRoot,'function','the app needs a model-aware runtime-config resolver');
 assert.equal(module.authoringImageWeightRoot({klein:{mounted:true,weightsUrl:'/local-2'}},'flux2'),'/local-2');
 assert.equal(module.authoringImageWeightRoot({},'flux2'),module.KLEIN_PUBLISHED_WEIGHTS);
 assert.throws(()=>module.authoringImageWeightRoot({klein:{mounted:true,weightsUrl:'/local-2'}},'flux3'),/local FLUX.3 weights/i);
 assert.throws(()=>module.authoringImageWeightRoot({flux3:{mounted:false,weightsUrl:'/wrong'}},'flux3'),/local FLUX.3 weights/i);
 assert.equal(module.authoringImageWeightRoot({flux3:{mounted:true,weightsUrl:'/local-3'}},'flux3'),'/local-3');
 const h=harness();
 await assert.rejects(h.service.run({model:'flux3',prompt:'kettle',seed:1,level:'3-bit'}),/FLUX.3.*4-bit/);
 await assert.rejects(h.service.run({model:'typo',prompt:'kettle',seed:1}),/Unknown image model/);
 assert.equal(h.loads(),0);
});

test('the actual pipeline factory selects Flux3Pipeline for FLUX.3',async()=>{
 assert.equal(typeof module.createAuthoringImagePipeline,'function','the app needs an actual FLUX.3 constructor path');
 const {Flux3Pipeline}=await import('../models/flux3-klein/flux3-pipeline.js');
 const p=await module.createAuthoringImagePipeline({queue:{}},{textEncoderUrl:'/te',transformerUrl:'/dit',vaeUrl:'/vae'},'flux3');
 assert.ok(p instanceof Flux3Pipeline);assert.deepEqual(p.urls,{textEncoderUrl:'/te',transformerUrl:'/dit',vaeUrl:'/vae'});
});

test('a failed model load releases its partial pipeline and can be retried',async()=>{
 const h=harness({modelWeights:async model=>model==='flux3'?'/flux3-weights':'/klein-weights',loadFails:1});
 await assert.rejects(h.service.run({model:'flux3',prompt:'kettle',seed:1}),/local weight load failed/);
 assert.ok(h.log.includes('destroy:flux3'),'a failed load must not strand model GPU buffers');
 await h.service.run({model:'flux3',prompt:'kettle',seed:1});
 assert.equal(h.loads(),2);assert.equal(h.delivered.length,1);
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

test('the small sizes 256 and 384 reach the pipeline as square images',async()=>{
 const h=harness();
 for(const size of [256,384]){await h.service.run({prompt:'lantern',seed:size,size});}
 assert.deepEqual(h.generations.map(g=>[g.width,g.height]),[[256,256],[384,384]]);
});

test('the transformer level is chosen per run: 4-bit by default, 3-bit and 2-bit swap only the transformer',async()=>{
 const h=harness();
 await h.service.run({prompt:'lantern',seed:1});
 assert.deepEqual(h.swaps,[],'the default 4-bit level is the one loaded with the pipeline');
 assert.equal(h.delivered[0].provenance.weightsLevel,'4-bit');
 await h.service.run({prompt:'lantern',seed:2,level:'3-bit'});
 assert.deepEqual(h.swaps,['/klein-weights/dit-q3']);assert.equal(h.delivered[1].provenance.weightsLevel,'3-bit');
 await h.service.run({prompt:'lantern',seed:3,level:'3-bit'});
 assert.equal(h.swaps.length,1,'a level already loaded is not loaded again');
 await h.service.run({prompt:'lantern',seed:4,level:'2-bit'});await h.service.run({prompt:'lantern',seed:5,level:'4-bit'});
 assert.deepEqual(h.swaps,['/klein-weights/dit-q3','/klein-weights/dit-q2','/klein-weights/dit']);
 assert.equal(h.loads(),1,'the text encoder and decoder load once');
 await assert.rejects(h.service.run({prompt:'lantern',seed:6,level:'1-bit'}),/4-bit, 3-bit or 2-bit/);
 assert.equal(h.generations.length,5,'an unknown level is refused before GPU work');
});

test('KLO-01: a failed transformer swap is never taken for the level that was loaded before it',async()=>{
 const h=harness({swapFails:1});
 await h.service.run({prompt:'lantern',seed:1});
 await assert.rejects(h.service.run({prompt:'lantern',seed:2,level:'3-bit'}),/bundle download failed/);
 await h.service.run({prompt:'lantern',seed:3,level:'4-bit'});
 assert.deepEqual(h.swaps,['/klein-weights/dit-q3','/klein-weights/dit'],'returning to 4-bit reloads it: the failed swap destroyed it');
 assert.equal(h.delivered.at(-1).provenance.weightsLevel,'4-bit');
});

test('a first run at 3-bit loads the 3-bit transformer directly, without loading 4-bit first',async()=>{
 const h=harness();
 await h.service.run({prompt:'lantern',seed:1,level:'3-bit'});
 assert.equal(h.pipelines[0].transformerUrl,'/klein-weights/dit-q3');assert.deepEqual(h.swaps,[]);
 assert.equal(h.delivered[0].provenance.weightsLevel,'3-bit');
});

test('landscape and portrait keep the selected size as the long side and crop the short side to 16:9, a multiple of 16',async()=>{
 const h=harness();
 await h.service.run({prompt:'lantern',seed:1,size:512,aspect:'landscape'});
 await h.service.run({prompt:'lantern',seed:2,size:384,aspect:'portrait'});
 await h.service.run({prompt:'lantern',seed:3,size:1024,aspect:'landscape'});
 await h.service.run({prompt:'lantern',seed:4,size:256});
 assert.deepEqual(h.generations.map(g=>[g.width,g.height]),[[512,288],[224,384],[1024,576],[256,256]]);
 assert.deepEqual(h.delivered.map(d=>d.provenance.aspect),['landscape','portrait','landscape','square']);
 await assert.rejects(h.service.run({prompt:'lantern',seed:5,aspect:'panorama'}),/square, landscape or portrait/);
 assert.equal(h.generations.length,4,'an unknown aspect is refused before GPU work');
});


test('partial previews belong to their active run and cannot replace a completed or subsequent image',async()=>{
 const gate=deferred(),h=harness({gate});const run=h.service.run({prompt:'kettle',seed:1});await tick();await tick();
 const first=h.generations[0];assert.equal(typeof first.onPreview,'function','Authoring must connect the existing pipeline preview callback');
 const frame={width:2,height:1,rgba:new Uint8ClampedArray([120,40,10,255,60,20,5,255]),step:1,steps:4};
 first.onPreview(frame);assert.deepEqual(h.service.read().preview.rgba,frame.rgba);assert.equal(h.service.read().preview.step,1);
 gate.resolve();await run;assert.equal(h.service.read().preview,null,'saved output replaces partial preview');
 first.onPreview({...frame,step:4});assert.equal(h.service.read().preview,null,'late readback cannot restore a preview');
 const next=h.service.run({prompt:'another kettle',seed:2});first.onPreview(frame);assert.equal(h.service.read().preview,null,'old run cannot publish into new loading state');await next;
});

test('Stop rejects later preview readbacks and clears the unfinished preview',async()=>{
 const gate=deferred(),h=harness({gate});const run=h.service.run({prompt:'kettle',seed:1});await tick();await tick();
 const request=h.generations[0];assert.equal(typeof request.onPreview,'function');
 request.onPreview({width:1,height:1,rgba:new Uint8ClampedArray([120,40,10,255]),step:1,steps:4});
 h.service.stop();request.onPreview({width:1,height:1,rgba:new Uint8ClampedArray([0,0,0,255]),step:2,steps:4});
 gate.resolve();await run;assert.equal(h.service.read().preview,null);
});

test('live and retained elapsed time separates model loading from generation and survives saving',async()=>{
 let now=1000;const gate=deferred();const h=harness({clock:()=>now,gate,onLoad:()=>{now+=2000;},onGenerate:()=>{now+=5000;}});
 const run=h.service.run({prompt:'kettle',seed:1});await tick();await tick();
 assert.equal(h.service.read().timing?.loadMs,2000,'load time is separate');
 assert.equal(h.service.read().timing?.generationMs,5000,'running timer uses observed elapsed time');
 now+=300;gate.resolve();await run;
 assert.equal(h.service.read().timing.generationMs,5300);now+=100000;
 assert.equal(h.service.read().timing.generationMs,5300,'completed duration is frozen');
 assert.deepEqual(h.delivered[0].provenance.elapsed,{loadMs:2000,generationMs:5300});
 const stored=module.readPngProvenance(new Uint8Array(await h.delivered[0].file.arrayBuffer()));assert.deepEqual(stored.elapsed,h.delivered[0].provenance.elapsed);
});

test('elapsed labels distinguish running, completed and stopped generation',()=>{
 assert.equal(module.imageGenerationTimeLabel({loadMs:2000,generationMs:null},'loading'),'Loading model · 2.0 s');
 assert.equal(module.imageGenerationTimeLabel({loadMs:2000,generationMs:5300},'running'),'Generating 5.3 s · model load 2.0 s');
 assert.equal(module.imageGenerationTimeLabel({loadMs:0,generationMs:5300},'complete'),'Generated in 5.3 s');
 assert.equal(module.imageGenerationTimeLabel({loadMs:0,generationMs:5300},'stopped'),'Stopped after 5.3 s');
});

test('Decode now requests a saved early result without aborting and resets between runs',async()=>{
 const gate=deferred(),h=harness({gate});
 assert.equal(typeof h.service.decodeNow,'function','generation needs a separate decode action');
 assert.equal(h.service.decodeNow(),false);
 const run=h.service.run({prompt:'lantern',seed:1});
 for(let i=0;i<20&&!h.generations.length;i++)await tick();
 assert.equal(h.service.decodeNow(),true);
 assert.equal(h.generations[0].shouldDecode(),true);
 assert.equal(h.generations[0].schedule.signal.aborted,false);
 gate.resolve();await run;assert.equal(h.delivered.length,1);
 assert.equal(h.service.decodeNow(),false);
 await h.service.run({prompt:'lantern',seed:2});
 assert.equal(h.generations[1].shouldDecode(),false);
});

test('image conditioning keeps its input and effective route in the saved PNG',async()=>{
 const h=harness({modelWeights:async()=>'/flux3-weights'});
 const reference={width:16,height:32,rgb:new Float32Array(16*32*3),provenance:{source:'/api/read?root=image-inbox&path=input.png',sha256:'observed-input',width:16,height:32}};
 await h.service.run({model:'flux3',prompt:'make it blue',seed:2,reference});
 assert.equal(h.generations[0].reference,reference);
 const p=h.delivered[0].provenance;
 assert.equal(p.route,'flux3-klein.image-and-text.authoring-shared-device.v0');assert.deepEqual(p.reference,reference.provenance);
 assert.ok(h.log.includes(`route:${p.route}`));
 assert.deepEqual(module.readPngProvenance(new Uint8Array(await h.delivered[0].file.arrayBuffer())),p);
 await assert.rejects(h.service.run({model:'flux2',prompt:'blue',seed:2,reference}),/reference.*FLUX.3/i);
});
