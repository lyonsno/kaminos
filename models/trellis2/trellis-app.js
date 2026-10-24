import {createWebGpuApplicationRunner} from '../../webgpu-inference-kit/src/core.js';
import {GENERATION_ROUTE} from './sparse-generation-witness-checks.js';

const MODEL_DEPS=async()=>{
  const [inputs,generation,material,mesh]=await Promise.all([import('./generation-inputs.js'),import('./trellis-generation.js'),
    import('./trellis-material.js'),import('./trellis-mesh.js')]);
  return {loadGenerationInputs:inputs.loadGenerationInputs,createTrellisImageGenerationAdapter:generation.createTrellisImageGenerationAdapter,
    createTrellisAssetAdapter:material.createTrellisAssetAdapter,createTrellisMeshAdapter:mesh.createTrellisMeshAdapter};
};
const checkSignal=signal=>{
  if(signal?.aborted)throw Object.assign(Error(String(signal.reason?.message??signal.reason??'TRELLIS stopped')),{name:'AbortError'});
};
export function validateTrellisRunOptions({pixelValues,finishing,finishMesh=true,decoderActivationStorage},appGpu){
  if(!(pixelValues instanceof Float32Array)||pixelValues.length!==512*512*3)
    throw TypeError('TRELLIS needs the selected image as prepared 512x512 RGB pixels');
  if(finishMesh&&(typeof finishing?.postprocessMesh!=='function'||typeof finishing?.unwrapMesh!=='function'))
    throw TypeError('TRELLIS page finishing needs mesh cleanup and UV providers');
  if(decoderActivationStorage!==undefined&&!['f32','f16'].includes(decoderActivationStorage))throw TypeError('f32 or f16 decoder activation storage');
  if(decoderActivationStorage==='f16'&&appGpu.device?.features?.has?.('shader-f16')===false)throw Error('f16 decoder activations need shader-f16 on the page device');
}

// Model-specific image/field/asset lifetime over the Kit's shared application runner.
// The caller lends an existing application host; this app never destroys its GPU.
export async function createTrellisApp({appGpu,session:providedSession,foreground,routeId=`${GENERATION_ROUTE}:${crypto.randomUUID()}`,
  scheduling={},deps,...defaults}={}){
  if(appGpu&&(providedSession||foreground))throw Error('one TRELLIS application host source required');
  const session=appGpu?await appGpu.session():providedSession;
  const device=appGpu?.device??session?.device,queue=device?.queue;
  if(!session||session.device!==device||session.queue!==queue||!queue||typeof queue.onSubmittedWorkDone!=='function')
    throw Error('TRELLIS needs an application session on the same device and queue');
  if(appGpu&&(appGpu.queue!==queue||typeof appGpu.beginRun!=='function'))throw Error('TRELLIS needs the actual app foreground owner');
  if(!appGpu&&(!foreground||foreground.device!==device||foreground.queue!==queue))throw Error('TRELLIS needs the session host foreground service');
  let destroyed=false,fatal=null,closing=null,resources={},settled=true,activeSignal,modelFailure;
  const assertOpen=()=>{if(destroyed)throw Error('TRELLIS app destroyed');if(fatal)throw fatal;
    if(session.snapshot().status!=='active')throw Error('TRELLIS session is not active');};
  const held=error=>Object.assign(Error(`TRELLIS GPU route was not released: held (${error.message})`,{cause:error}),{gpuRouteHeld:true});
  // Preserve the host's frame installation and unsettled-run accounting. Stop
  // during a frame boundary must be observed before a following GPU submission.
  const frames={async beginRun(runId,options){
    const run=await(appGpu?appGpu.beginRun(runId,options):foreground.beginRun(runId,options));
    if(run?.routeId!==routeId||!run.foregroundOpportunities||typeof run.withForeground!=='function'||typeof run.finish!=='function'){
      await run?.finish?.();throw Error('application foreground run must carry the actual TRELLIS model route identity');
    }
    const opportunities=run.foregroundOpportunities;
    return {withForeground:run.withForeground,finish:run.finish,foregroundOpportunities:{...opportunities,
      async serviceAtBoundary(boundary){const receipt=await opportunities.serviceAtBoundary(boundary);checkSignal(activeSignal);return receipt;}}};
  }};
  // A failed queue fence must not make unregisterRoute dispose resident model
  // buffers. That held-resource contract belongs to this model, not to the host.
  const lifetimeSession={device,registerRoute:options=>session.registerRoute(options),
    unregisterRoute(id){if(id===routeId&&!settled)throw held(Error('GPU settlement is unproved'));return session.unregisterRoute(id);}};
  const runner=createWebGpuApplicationRunner({session:lifetimeSession,foreground:frames,routeId,label:'TRELLIS generation',
    phase:'generating',runtimeLabel:'trellis-app',scheduling,assertOpen,getError:()=>fatal,
    onFatal:error=>{fatal=settled?error:held(error);},
    prepare:async signal=>{activeSignal=signal;},
    async execute(options,schedule){
      if(!schedule)throw Error('TRELLIS requires cooperative application execution');
      resources={};settled=false;
      const base=schedule.runtime,invocation=schedule.invocation;
      const attributed=options=>{
        if(options.schedulerInvocation&&options.schedulerInvocation!==invocation)throw Error('TRELLIS requires its actual admitted invocation');
        return {...options,schedulerInvocation:invocation};
      };
      const runtime={...base,
        runKernel:(kernel,options={})=>schedule.control.runDuty(()=>base.runKernel(kernel,attributed(options))),
        readTensor:(tensor,options={})=>schedule.control.runDuty(()=>base.readTensor(tensor,attributed(options)))};
      const run={runId:invocation.invocationId,invocation,route:{routeId,runtime},withForeground:schedule.withForeground};
      try{return await generateAsset({...defaults,...options,appGpu:{device},deps,run,resources});}
      catch(error){modelFailure=error;throw error;}
    },
    async settle(){
      await queue.onSubmittedWorkDone();settled=true;
      const errors=[];
      for(const resource of [resources.asset,resources.generation])try{resource?.dispose();}catch(error){errors.push(error);}
      resources={};if(errors.length)throw new AggregateError(errors,'TRELLIS model retirement failed');
    },
  });
  async function generate(options={}){
    assertOpen();validateTrellisRunOptions({...defaults,...options},{device});
    if(runner.pending)throw Error('a TRELLIS generation is already running');
    if(options.cooperative===false)throw Error('TRELLIS requires cooperative application execution');
    modelFailure=null;
    try{
      const result=await runner.run(options);
      return {...result,receiptValidation:{ok:true,by:'trellis-application',checks:['route-released',...(result.glb?['glb-magic']:[]) ]}};
    }catch(error){if(fatal)throw fatal;throw modelFailure??error;}
  }
  function destroy(){
    if(closing)return closing;destroyed=true;runner.stop('TRELLIS app destroyed');
    closing=(async()=>{await Promise.allSettled([runner.pending]);if(fatal?.gpuRouteHeld)throw fatal;})();return closing;
  }
  return Object.freeze({device,session,foreground:appGpu?.foreground??foreground,routeId,generate,
    pause:runner.pause,resume:runner.resume,stop:runner.stop,destroy,
    get generation(){return resources.generation??null;},
    snapshot:()=>({...runner.snapshot(),destroyed,error:fatal?.message??null,gpuRouteHeld:Boolean(fatal?.gpuRouteHeld),
      ownership:{device:'borrowed',session:'borrowed',foreground:'borrowed'}})});
}

async function generateAsset({appGpu,manifest:source,fetchTensor,pixelValues,finishing,finishMesh=true,decoderActivationStorage,onPhase=()=>{},provenance={},deps,run,resources}){
  const manifest=decoderActivationStorage?structuredClone(source):source;
  if(decoderActivationStorage)for(const role of ['shapeDecoder','textureDecoder'])manifest.models[role].config.activationStorage=decoderActivationStorage;
  const d=deps??await MODEL_DEPS();
  let generation,asset,result,timing=null;
  // Per phase: wall time, and GPU time from the kit's timestamp-query timer (the change in
  // its running total; timings resolve lazily, so the totals are settled before release).
  const phases=[],clock=()=>globalThis.performance.now();
  const gpuTotal=()=>run?.route?.runtime?.profile?.gpuTiming?.totalGpuMs??null;
  const closePhase=()=>{const last=phases.at(-1);if(!last||last.endMs!==undefined)return;last.endMs=clock();last.gpuEnd=gpuTotal();};
  const timed=async event=>{
    if(event?.phase&&event.phase!==phases.at(-1)?.phase){closePhase();phases.push({phase:event.phase,modelRole:event.modelRole??null,startMs:clock(),gpuStart:gpuTotal()});}
    return onPhase(event);
  };
  try{
    await timed({phase:'checkpoint-loading'});
    // CPU/network spans open a foreground window so scene frames run while they wait;
    // GPU work and readbacks keep the run's boundary admission.
    const inputs=await run.withForeground('trellis-checkpoint-loading',()=>d.loadGenerationInputs(manifest,fetchTensor,{pixelValues}));
    generation=d.createTrellisImageGenerationAdapter({...inputs,route:run.route,onPhase:timed});
    resources.generation=generation;
    const out=await generation.run(run.invocation);
    // Surfels come from the raw dual-grid mesh plus the decoded material, before any cleanup, while the
    // run still holds its tensors. A surfel failure is recorded; it never costs the mesh.
    const surfelInputs={runtime:run.route.runtime,out,withForeground:(p,w)=>run.withForeground(p,w),
      provenance:{...provenance,route:run.route.routeId,runId:run.runId}};
    if(!finishMesh){
      const meshConsumer=d.createTrellisMeshAdapter({runtime:run.route.runtime,decoded:out.geometry});
      try{
        await timed({phase:'post-model-mesh-extraction'});const raw=await meshConsumer.run();
        if(raw.status!=='surface')throw Error('learned geometry has no surface; no asset');
        const built=await buildRunSurfels({...surfelInputs,rawMesh:raw});
        if(built.surfels.status!=='built')throw Error(`surfels could not be built: ${built.surfels.error}`);
        result={glb:null,...built,route:run.route.routeId};
      }finally{meshConsumer.dispose?.();}
    }else{
    let surfels=null;
    asset=d.createTrellisAssetAdapter({runtime:run.route.runtime,geometry:out.geometry,material:out.material,
      postprocessMesh:async mesh=>{
        const rawMesh=mesh?.vertices instanceof Float32Array&&mesh?.triangles instanceof Uint32Array?{vertices:mesh.vertices,triangles:mesh.triangles}:null;
        surfels=await buildRunSurfels({...surfelInputs,rawMesh});
        return run.withForeground('trellis-mesh-cleanup',()=>finishing.postprocessMesh(mesh));},
      unwrapMesh:mesh=>run.withForeground('trellis-uv-unwrap',()=>finishing.unwrapMesh(mesh)),
      provenance:{input:'caller-prepared pixels',...provenance,route:run.route.routeId,modelIdentities:out.modelIdentities},
      onPhase:timed});
    resources.asset=asset;
    let finished;
    try{finished=await asset.run();}catch(error){if(surfels&&error&&typeof error==='object')error.trellisSurfels={...surfels,route:run.route.routeId};throw error;}
    if(!(finished.glb?.byteLength>=12)||new DataView(finished.glb).getUint32(0,true)!==0x46546c67)throw Error('TRELLIS page run returned bytes that are not a GLB');
    result={glb:finished.glb,uv:finished.mesh?.uvMetadata??null,material:finished.textures?.metadata??null,route:run.route.routeId,
      ...(surfels??{surfelGlb:null,surfels:{status:'failed',error:'the asset consumer did not hand over the raw mesh'}})};
    }
  }catch(error){
    // While the run still holds its tensors: what a decoder-only replay needs.
    if(run&&generation&&error&&typeof error==='object')
      error.trellisCapture=await captureFailure(generation,run.route.runtime).catch(failure=>({captureError:failure.message}));
    throw error;
  }finally{
    const gpu=await run.route.runtime.settleGpuTiming?.().catch(()=>null);
    closePhase();
    timing={gpu:gpu?{...gpu}:run.route.runtime.profile?.gpuTiming??null,stages:stageSummary(run.route.runtime.profile),phases:phases.map(p=>({phase:p.phase,modelRole:p.modelRole,
      wallMs:Math.round(p.endMs-p.startMs),gpuMs:p.gpuStart==null?null:Math.round(((p===phases.at(-1)?gpu?.totalGpuMs??p.gpuEnd:p.gpuEnd)-p.gpuStart)*10)/10}))};
  }
  return {...result,timing};
}

// Kit profile stages grouped by name: resolved GPU time per stage, not running-total deltas.
export function stageSummary(profile){
  const out={};
  for(const stage of profile?.stages??[]){
    const row=out[stage.name]??={count:0,wallMs:0,gpuMs:0,yields:0};
    row.count++;row.wallMs+=stage.ms??0;if(stage.gpuStatus==='resolved')row.gpuMs+=stage.gpuMs??0;row.yields+=stage.metadata?.yields?.length??0;
  }
  for(const row of Object.values(out)){row.wallMs=Math.round(row.wallMs*10)/10;row.gpuMs=Math.round(row.gpuMs*10)/10;}
  return out;
}

async function captureFailure(generation,runtime){
  const context=generation.decoderFailureContext;
  const tensors={};
  const read=async(name,tensor)=>{if(!tensor?.shape)return;tensors[name]={shape:[...tensor.shape],dtype:tensor.dtype,bytes:await runtime.readTensor(tensor)};};
  if(context){
    await read('inputs.sample',context.inputs?.sample);await read('inputs.coordinates',context.inputs?.coordinates);
    for(const [i,guide] of (context.inputs?.guideSubdivisions??[]).entries())await read(`inputs.guideSubdivisions.${i}`,guide);
    await read('coordinates',context.coordinates);await read('features',context.features);await read('subdivisionLogits',context.subdivisionLogits);
  }
  const noise={};
  for(const [stage,n] of Object.entries(generation.noiseInputs??{}))noise[stage]={shape:[...n.shape],values:n.values,seed:n.seed??null,source:n.source??null};
  return {decoder:context?{mode:context.mode,operation:context.operation,level:context.level,rows:context.rows,resolution:context.resolution,
    plan:JSON.parse(JSON.stringify(context.plan??null)),error:{...context.error}}:null,tensors,noise,stages:stageSummary(runtime?.profile)};
}

async function buildRunSurfels({runtime,out,rawMesh,withForeground,provenance}){
  try{
    if(!rawMesh)throw Error('the asset consumer did not hand over the raw mesh');
    const [gc,mc,mf]=await Promise.all([out.geometry.coordinates,out.material.coordinates,out.material.features].map(t=>runtime.readTensor(t)));
    const {buildSurfelField,encodeSurfelGLB}=await import('../../trellis-surfels.mjs');
    return await withForeground('trellis-surfels',()=>{
      const field=buildSurfelField({...rawMesh,geometryCoordinates:new Int32Array(gc),
        material:{coordinates:new Int32Array(mc),features:new Float32Array(mf),resolution:out.material.resolution}});
      const surfelGlb=encodeSurfelGLB(field,{provenance});
      // The decode and material, as copies the cleanup cannot take away, for the GI proxy tiers built
      // once the finished mesh is stored (generation-levels-runner.mjs).
      const levelInputs={decode:{vertices:rawMesh.vertices.slice(),triangles:rawMesh.triangles.slice()},
        materialFields:{features:new Float32Array(mf),coordinates:new Int32Array(mc),resolution:out.material.resolution}};
      return {surfelGlb,surfels:{status:'built',count:field.count,bytes:surfelGlb.byteLength,resolution:field.resolution},levelInputs};
    });
  }catch(error){return {surfelGlb:null,surfels:{status:'failed',error:String(error?.message||error)}};}
}
