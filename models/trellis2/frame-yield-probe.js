// Offline retained-block experiment on the actual Kaminos app GPU host.
import {createTrellisSharedHost} from './shared-host.js';
import {createTrellisSparseBlockAdapter,buildSparseBlockPlan,sparseBlockWeightShapes} from './sparse-block.js';
import {createTrellisFrameAwareSleep} from './frame-aware-yield.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function runFrameYieldProbe(config){
 const state={schema:'trellis2.retained-block-frame-yield.v0',status:'failed',phase:'app-host',runs:[],config};
 const post=async(name,body)=>{const r=await fetch('/__frame_yield/'+name,{method:'POST',body});if(!r.ok)throw Error('evidence storage failed '+name);return r.json();};
 const save=()=>post('state.json',JSON.stringify(state));
 let host,run,block,input,modulation,drawing=true;const errors=[];
 const redraw=()=>{if(drawing){window._kaminosDirty?.();requestAnimationFrame(redraw);}};
 try{
  await save();
  if(config.scene){
   const link=window.kaminosAssetSmokeLinkDebugState?.();
   const r=await fetch(link?.effectiveUrl??'/missing-scene');if(!r.ok)throw Error('scene bytes unavailable');
   state.scene={state:link,objects:window.kaminosSceneObjectDebugState?.()??[],sha256:await hash(await r.arrayBuffer())};
   if(state.scene.sha256!==config.scene.sha256)throw Error('scene asset bytes changed');
  }
  const app=await window.kaminosAppGpu();const info=app.adapter.info;
  state.backend={vendor:info.vendor,architecture:info.architecture,isFallbackAdapter:app.adapter.isFallbackAdapter??info.isFallbackAdapter};
  if(info.vendor!=='apple'||!info.architecture.includes('metal')||state.backend.isFallbackAdapter!==false)throw Error('actual nonfallback Apple Metal required');
  const actualSession=await app.session();
  const policy={sleep:ms=>new Promise(r=>setTimeout(r,ms))};
  // Route-local injection consumes the existing API; the application still owns its session and frames.
  const session=Object.create(actualSession,{registerRoute:{value:o=>actualSession.registerRoute({...o,runtimeOptions:{...o.runtimeOptions,sleep:ms=>policy.sleep(ms)}})}});
  const appProxy={device:app.device,queue:app.queue,session,beginRun:app.beginRun.bind(app)};
  const controller=new AbortController();host=await createTrellisSharedHost({appGpu:appProxy});
  run=await host.beginRun({runId:'trellis-frame-yield-'+crypto.randomUUID(),signal:controller.signal});
  const route=run.route,runtime=route.runtime;
  if(runtime.device!==app.device||runtime.queue!==app.queue)throw Error('shared device identity mismatch');
  state.effectiveRoute=route.routeId;state.session=actualSession.snapshot().sessionId;
  if(state.effectiveRoute!=='trellis2.image-generation.webgpu.v0')throw Error('effective model route mismatch');
  runtime.device.addEventListener('uncapturederror',e=>errors.push({name:e.error.name,message:e.error.message}));
  const load=async(group,name)=>{
   const spec=config.fixtures[group].tensors[name];if(!spec||spec.dtype!=='float32')throw Error('missing F32 fixture '+name);
   const r=await fetch('/__frame_fixture/'+group+'/'+spec.file);if(!r.ok)throw Error('missing fixture bytes '+name);
   const bytes=await r.arrayBuffer();if(bytes.byteLength!==spec.byteLength||await hash(bytes)!==spec.sha256)throw Error('fixture changed '+name);
   return new Float32Array(bytes);
  };
  state.phase='fixture-loading';await save();const plan=buildSparseBlockPlan(config.fixtures.block.config),weights={};
  for(const name of [...Object.keys(sparseBlockWeightShapes(plan)),'gelu'])weights[name]=await load('block',name);
  const conditioning=await load('block','conditioning'),phases=await load('block','phases');
  const tensor=(name,shape)=>runtime.createTensor({name,shape,dtype:'f32',usage:U.storage|U.copyDst|U.copySrc});
  input=tensor('assay.retained.projected',plan.outputShape);modulation=tensor('assay.retained.modulation',[1,6*plan.channels]);
  runtime.uploadTensor(input,await load('prefix','expected.projected'));runtime.uploadTensor(modulation,await load('prefix','expected.modulation'));
  block=createTrellisSparseBlockAdapter({route,config:config.fixtures.block.config,weights,conditioning,phases,inputs:{projected:input,modulation}});
  state.plan=plan;requestAnimationFrame(redraw);
  const execute=async mode=>{
   const sleeper=mode==='frame-aware'?createTrellisFrameAwareSleep({queue:app.queue,frameBudgetMs:config.frameBudgetMs,maxTaskYieldsPerFrame:config.maxTaskYieldsPerFrame,signal:controller.signal}):ms=>new Promise(r=>setTimeout(r,ms));
   policy.sleep=sleeper;state.phase=mode;await save();const frames=[];let recording=true;
   const tick=()=>{if(recording){frames.push(performance.now());requestAnimationFrame(tick);}};
   const before=window.kaminosViewportShadingDebugState?.()?.lastRender?.sceneFrameCount??null;
   const start=performance.now();requestAnimationFrame(tick);
   const job=route.enqueue({jobId:'retained-block-'+mode,execute:i=>block.run(i)}),completion=await job.completion;
   await app.queue.onSubmittedWorkDone();const end=performance.now();recording=false;
   const after=window.kaminosViewportShadingDebugState?.()?.lastRender?.sceneFrameCount??null;
   if(completion.status!=='succeeded')throw Error('retained block failed '+JSON.stringify(completion.failure??completion));
   const bytes=await runtime.readTensor(block.outputs.hidden);const data=new Float32Array(bytes);
   if(data.length!==plan.rows*plan.channels||!data.every(Number.isFinite)||!data.some(x=>x!==0))throw Error('blank/partial/nonfinite block result');
   const stored=await post(mode+'.f32',bytes),sha256=await hash(bytes);if(stored.sha256!==sha256||stored.byteLength!==bytes.byteLength)throw Error('stored output receipt mismatch');
   return {mode,startMs:start,endMs:end,wallMs:end-start,frames,sceneFramesBefore:before,sceneFramesAfter:after,output:{...stored,sha256,shape:plan.outputShape},policy:sleeper.snapshot?.()??{kind:'current-timer-zero-delay'}};
  };
  // Warm this same block before comparing policies so compilation is not assigned only to the baseline.
  state.runs.push(await execute('warmup'));state.runs.push(await execute('baseline'));state.runs.push(await execute('frame-aware'));
  if(state.runs[1].output.sha256!==state.runs[2].output.sha256)throw Error('scheduler changed final block output');
  if(!state.runs[2].policy.frameYields||state.runs[2].sceneFramesAfter<=state.runs[2].sceneFramesBefore)throw Error('candidate supplied no actual foreground frames');
  state.phase='stop';await save();let stopAt;
  const stopFrame=requestAnimationFrame(()=>{stopAt=performance.now();controller.abort(new DOMException('assay Stop','AbortError'));});
  const stopStart=performance.now(),job=route.enqueue({jobId:'retained-block-stop',execute:i=>block.run(i)});const terminal=await job.completion;cancelAnimationFrame(stopFrame);
  state.stop={requestedAt:stopAt,observedAt:performance.now(),startedAt:stopStart,status:terminal.status,failure:terminal.failure};
  if(!stopAt||terminal.status==='succeeded'||terminal.failure?.name!=='AbortError')throw Error('actual route Stop not observed');
  state.release=await run.finish();run=null;
  if(state.release.status!=='released'||actualSession.snapshot().routes.length)throw Error('app route did not release');
  state.errors=errors;if(errors.length)throw Error('uncaptured WebGPU error');
  state.status='completed';state.phase='complete';
 }catch(error){state.error={name:error.name,message:error.message,stack:error.stack};}
 finally{
  drawing=false;
  if(run)try{state.release=await run.finish();}catch(error){state.cleanupError=error.message;}
  try{block?.dispose();input?.buffer.destroy();modulation?.buffer.destroy();await host?.dispose();}catch(error){state.cleanupError=error.message;}
  if(state.cleanupError)state.status='failed';await save();
 }
 return {status:state.status,phase:state.phase,error:state.error};
}
