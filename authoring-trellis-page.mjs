// TRELLIS 2 in this page: the selected image's prepared pixels run on the app GPU host
// (app-gpu-host.mjs) through the model's own bridge (models/trellis2/shared-host.js), and
// the learned fields are finished into a GLB in the page. No server model process, no GPU
// queue. The GLB is finished while the run still holds its route: the bridge releases the
// resident geometry and material tensors when the run finishes.

const MODEL_DEPS=async()=>{
  const [host,inputs,generation,material,mesh]=await Promise.all([import('./models/trellis2/shared-host.js'),
    import('./models/trellis2/generation-inputs.js'),import('./models/trellis2/trellis-generation.js'),import('./models/trellis2/trellis-material.js'),
    import('./models/trellis2/trellis-mesh.js')]);
  return {createTrellisSharedHost:host.createTrellisSharedHost,loadGenerationInputs:inputs.loadGenerationInputs,
    createTrellisImageGenerationAdapter:generation.createTrellisImageGenerationAdapter,createTrellisAssetAdapter:material.createTrellisAssetAdapter,
    createTrellisMeshAdapter:mesh.createTrellisMeshAdapter};
};

// decoderActivationStorage 'f16' is the queued route's accepted setting (half the decoder
// activation memory); it needs shader-f16 on the shared device.
// Every run also yields a surfel asset (trellis-surfels.mjs) from the decoded field, built from the raw
// mesh before any cleanup. finishMesh:false stops there: no cleanup, UV or bake, and no mesh GLB.
export async function runTrellisInPage({appGpu,manifest:source,fetchTensor,pixelValues,finishing,finishMesh=true,decoderActivationStorage,signal,onPhase=()=>{},provenance={},deps}){
  if(!(pixelValues instanceof Float32Array)||pixelValues.length!==512*512*3)
    throw TypeError('TRELLIS needs the selected image as prepared 512x512 RGB pixels');
  if(finishMesh&&(typeof finishing?.postprocessMesh!=='function'||typeof finishing?.unwrapMesh!=='function'))
    throw TypeError('TRELLIS page finishing needs mesh cleanup and UV providers');
  if(decoderActivationStorage!==undefined&&!['f32','f16'].includes(decoderActivationStorage))throw TypeError('f32 or f16 decoder activation storage');
  if(decoderActivationStorage==='f16'&&appGpu.device?.features?.has?.('shader-f16')===false)throw Error('f16 decoder activations need shader-f16 on the page device');
  const manifest=decoderActivationStorage?structuredClone(source):source;
  if(decoderActivationStorage)for(const role of ['shapeDecoder','textureDecoder'])manifest.models[role].config.activationStorage=decoderActivationStorage;
  const d=deps??await MODEL_DEPS();
  const stop=signal??new AbortController().signal;
  // The bridge takes the session itself; the app host hands it out asynchronously.
  const session=await appGpu.session();
  const host=await d.createTrellisSharedHost({appGpu:{device:appGpu.device,queue:appGpu.queue,session,
    beginRun:(runId,options)=>appGpu.beginRun(runId,options)}});
  let run,generation,asset,released=false,result,timing=null;
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
    run=await host.beginRun({runId:`authoring-trellis-page-${globalThis.crypto.randomUUID()}`,signal:stop});
    await timed({phase:'checkpoint-loading'});
    // CPU/network spans open a foreground window so scene frames run while they wait;
    // GPU work and readbacks keep the run's boundary admission.
    const inputs=await run.withForeground('trellis-checkpoint-loading',()=>d.loadGenerationInputs(manifest,fetchTensor,{pixelValues}));
    generation=d.createTrellisImageGenerationAdapter({...inputs,route:run.route,onPhase:timed});
    const job=run.route.enqueue({jobId:run.runId+':image-to-fields',execute:invocation=>generation.run(invocation)});
    const completed=await job.completion;
    if(completed.status!=='succeeded'){
      const error=Error(completed.failure?.message??`TRELLIS generation ${completed.status}`);
      error.name=completed.failure?.name??'Error';throw error;
    }
    const out=completed.output;
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
    let failure=null;
    if(run){
      const gpu=await run.route?.runtime?.settleGpuTiming?.().catch(()=>null);
      closePhase();
      timing={gpu:gpu?{...gpu}:run.route?.runtime?.profile?.gpuTiming??null,stages:stageSummary(run.route?.runtime?.profile),phases:phases.map(p=>({phase:p.phase,modelRole:p.modelRole,
        wallMs:Math.round(p.endMs-p.startMs),gpuMs:p.gpuStart==null?null:Math.round(((p===phases.at(-1)?gpu?.totalGpuMs??p.gpuEnd:p.gpuEnd)-p.gpuStart)*10)/10}))};
      const report=await run.finish().catch(error=>({status:'held',error}));
      released=report?.status==='released';
      // gpuRouteHeld: GPU work did not settle, so a holder of the GPU (a Greenroom lease) must not hand it back.
      if(!released)failure=Object.assign(Error(`TRELLIS GPU route was not released: ${report?.status}${report?.error?` (${report.error.message})`:''}`),{gpuRouteHeld:true});
    }else released=true;
    // A held run keeps its tensors; disposing under it would free resources still in use.
    if(released){asset?.dispose();generation?.dispose();await host.dispose();}
    if(failure)throw failure;
  }
  // Checked here: the run's GPU route was released and the asset is a GLB.
  return {...result,timing,receiptValidation:{ok:true,by:'authoring-trellis-page',checks:['route-released','glb-magic']}};
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

const sha256=async bytes=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
// The checkpoint package the server mounts (serve.py /trellis-checkpoints/). The manifest
// must be the one the runtime config identified; each tensor is checked by the model's reader.
export async function createTrellisPageCheckpoints({config,fetch=globalThis.fetch}){
  if(!config?.mounted||!config.checkpointUrl)throw Error('no TRELLIS checkpoint package is mounted on this server');
  const base=config.checkpointUrl.replace(/\/$/,'');
  const response=await fetch(`${base}/manifest.json`,{cache:'no-store'});
  if(!response.ok)throw Error(`TRELLIS checkpoint manifest unavailable (${response.status})`);
  const bytes=await response.arrayBuffer(),manifestSha256=await sha256(bytes);
  if(manifestSha256!==config.manifestSha256)throw Error('the TRELLIS checkpoint manifest changed since the server identified it');
  const manifest=JSON.parse(new TextDecoder().decode(bytes));
  const {readGenerationTensor}=await import('./models/trellis2/generation-storage.js');
  const fetchTensor=name=>{
    const row=manifest.tensors?.[name];if(!row)throw Error(`TRELLIS checkpoint tensor missing: ${name}`);
    return readGenerationTensor(row,{fetchFile:file=>fetch(`${base}/${file}`),hash:sha256});
  };
  return {manifest,manifestSha256,fetchTensor};
}

// The Generate drawer's service for TRELLIS in this page: same read/run/stop/retryPersistence
// shape as the SF3D and queued TRELLIS services. The input is the selected image.
const STAGES=[[/^(dinov3|load-dinov3|checkpoint-loading)/,'Reading the image'],[/^sparse-structure|^occupancy/,'Shape structure'],
  [/^low-resolution-shape|^high-resolution-shape|learned-geometry/,'Shape detail'],[/texture-sampling|material-decoding/,'Texture'],
  [/^post-model-(mesh-extraction|material-readback|mesh-postprocess)/,'Cleaning the mesh'],[/^post-model-uv/,'Unwrapping UVs'],[/^post-model-(texture-bake|pbr-glb)/,'Baking textures']];
export function trellisPageStage(phase){return STAGES.find(([pattern])=>pattern.test(String(phase||'')))?.[1]??'Generating';}

export function createTrellisPageAuthoringGeneration({availability,runPage,persist,changed=()=>{},blocked=()=>null,now=()=>Date.now(),
  setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval}){
  // Output: 'mesh' (the finished mesh, with its surfels beside it) or 'surfels' (surfels only: no mesh finishing).
  let active=false,abort=null,started=0,output='mesh';
  let state={status:'idle',progress:'TRELLIS 2 runs in this page on its GPU; it takes many minutes.',stage:null,percent:null,canStop:false,error:null,results:[],pending:null};
  const publish=()=>changed(structuredClone({...state,pending:state.pending?{label:state.pending.label}:null}));
  const set=values=>{Object.assign(state,values);publish();};
  const unavailable=()=>{const reason=blocked();if(reason)return reason;const value=availability();if(!value)return 'TRELLIS availability is loading.';
    return value.status==='available'?null:(value.message||'TRELLIS cannot run in this page');};
  const elapsed=()=>{const s=Math.round((now()-started)/1000);return s<60?`${s}s`:`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;};
  async function storePending(){
    const {glb,generation,label,surfelGlb,surfels,levelInputs,meshError}=state.pending;
    set({status:'saving',stage:glb?'Saving mesh':'Saving surfels',progress:glb?'Saving generated mesh…':'Saving the surfels from the decoded field…'});
    const saved=await persist(glb,generation,label,{surfelGlb,surfels,levelInputs});
    state.results.push(saved);state.pending=null;
    // A mesh-finishing failure stays the run's outcome; the surfels are what it kept.
    if(meshError)set({status:'failed',error:`inference: ${meshError}; surfels saved`,stage:null,progress:'The mesh could not be finished. The surfels from the decoded field were saved.'});
    else set({status:'complete',error:null,stage:'Complete',progress:glb?'Mesh saved. Add it to this scene when you want.':'Surfels saved. Add them to this scene when you want.'});
    return saved;
  }
  return {
    preparesInput:true,
    output:()=>output,
    setOutput(value){if(!['mesh','surfels'].includes(value))throw Error('TRELLIS output must be mesh or surfels');if(active)throw Error('Generation is already running');output=value;publish();},
    // The drawer keeps the model choice bound to this service while it runs, saves, or
    // holds a generated mesh that still needs saving.
    busy:()=>active||!!state.pending,
    read(){
      const view={...structuredClone({...state,pending:null}),pending:state.pending?{label:state.pending.label}:null};
      if(state.status==='idle'||state.status==='unavailable'){const reason=unavailable();return reason?{...view,status:'unavailable',error:reason}:{...view,status:'idle'};}
      return view;
    },
    stop(){if(!active||!abort||abort.signal.aborted)return false;abort.abort(new DOMException('TRELLIS stopped','AbortError'));set({status:'stopping',canStop:false,progress:'Stopping at the next GPU step…'});return true;},
    async retryPersistence(){
      if(active)throw Error('Generation is already running');if(!state.pending)throw Error('No generated output needs saving');
      active=true;try{return await storePending();}catch(error){set({status:'failed',error:`persistence: ${error.message}`});throw error;}finally{active=false;publish();}
    },
    async run(input){
      if(active)throw Error('Generation is already running');
      if(state.pending)throw Error('Save the retained generated output before another run');
      // The selected image itself: the page prepares it (alpha, or browser U2Net for a photo).
      const cutout=input?.source;if(!cutout)throw Error('Choose a source image');
      const reason=unavailable();if(reason)throw Error(reason);
      active=true;abort=new AbortController();started=now();let phase='inference';
      set({status:'running',error:null,inputPreview:null,stage:'Reading the image',canStop:true,progress:'Starting TRELLIS in this page…'});
      // A model phase can last minutes without another event. This is elapsed time,
      // not a claim that another model step completed; keep it live until inference ends.
      const clock=setInterval(()=>{
        if(active&&state.status==='running')set({progress:`${state.stage} · ${elapsed()}`});
      },1000);
      clock?.unref?.();
      const label=(input.label||input.name||'Generated').replace(/\.[^.]+$/,'');
      try{
        const out=await runPage({image:{source:cutout},label,signal:abort.signal,finishMesh:output!=='surfels',onInput:used=>set({inputPreview:{...used,input:input.source}}),onPhase:event=>{
          const stage=trellisPageStage(event?.phase);set({stage,progress:`${stage} · ${elapsed()}`});}});
        state.pending={glb:out.glb,generation:{...out.generation,input:{...out.generation?.input,source:input.source}},label:out.label||label,surfelGlb:out.surfelGlb??null,surfels:out.surfels??null,levelInputs:out.levelInputs??null};
        phase='persistence';return await storePending();
      }catch(error){
        // A clean stop is the cancellation itself; a release or settlement failure met while
        // stopping is still a failure (the run may hold resources).
        const cancelled=error===abort.signal.reason||error?.name==='AbortError';
        if(abort.signal.aborted&&cancelled&&phase!=='persistence'){set({status:'stopped',error:null,stage:null,progress:'TRELLIS stopped. Your scene is unchanged.'});return null;}
        // Decoding succeeded and mesh finishing failed: keep the surfels built before cleanup, saved
        // through the same pending/retry path, with the mesh failure as the run's outcome.
        const kept=phase==='inference'&&!cancelled?error?.trellisSurfelsRun:null;
        if(kept?.surfelGlb){
          const message=error?.message||String(error);
          state.pending={glb:null,generation:{...kept.generation,input:{...kept.generation?.input,source:input.source}},label:kept.label||label,
            surfelGlb:kept.surfelGlb,surfels:kept.surfels??null,meshError:message};
          try{await storePending();}catch(persistError){set({status:'failed',error:`inference: ${message}; surfels not saved yet: ${persistError.message}`,stage:null});}
          throw error;
        }
        set({status:'failed',error:`${phase}: ${error?.message||error}`,stage:null});throw error;
      }finally{clearInterval(clock);active=false;abort=null;state.canStop=false;publish();}
    },
  };
}

// A selected image becomes TRELLIS input in the page, with no server step: decoded RGBA with
// real alpha goes straight to the alpha preparation; an opaque photo is first segmented by
// browser U2Net (models/u2net). Decoding copies native pixels, as the alpha preparation does.
export async function prepareImageForTrellis({bytes,type,signal,ImageDecoderClass=globalThis.ImageDecoder,
  prepareTrellisAlphaRgba,removeForegroundU2Net,runner}){
  if(typeof ImageDecoderClass!=='function')throw Error('ImageDecoder is unavailable; no Canvas pixel fallback');
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(!type&&[137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v))type='image/png';
  if(!type)throw Error('image MIME type is required');
  const decoder=new ImageDecoderClass({type,data,colorSpaceConversion:'none',preferAnimation:false});
  let rgba,width,height,nativeFormat;
  try{
    const decoded=await decoder.decode({frameIndex:0,completeFramesOnly:true});const frame=decoded.image;
    if(!decoded.complete||!frame)throw Error('incomplete decoded image');
    nativeFormat=frame.format;width=frame.codedWidth;height=frame.codedHeight;rgba=new Uint8Array(width*height*4);
    const layout=[{offset:0,stride:width*4}];
    if(['RGBA','BGRA','RGBX','BGRX'].includes(nativeFormat)){
      // Packed: copy native bytes, reorder channels only; X formats carry no alpha.
      await frame.copyTo(rgba,{layout});
      if(nativeFormat[0]==='B')for(let i=0;i<rgba.length;i+=4){const b=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=b;}
      if(nativeFormat.endsWith('X'))for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
    }else{
      // Planar YUV (a JPEG decodes as I420): the decoder converts to sRGB RGBA; such
      // images have no alpha, so alpha is opaque by definition.
      await frame.copyTo(rgba,{layout,format:'RGBA',colorSpace:'srgb'});
      for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
    }
    frame.close();
  }finally{decoder.close();}
  if(signal?.aborted)throw signal.reason;
  let hasAlpha=false;for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255){hasAlpha=true;break;}
  let segmentation=null;
  if(!hasAlpha){
    const cut=await removeForegroundU2Net({pixels:rgba,width,height,channels:4,runner:await runner(),signal});
    segmentation=cut.provenance;rgba=cut.rgba;width=cut.width;height=cut.height;
  }
  const prepared=await prepareTrellisAlphaRgba({pixels:rgba,width,height,signal});
  // The cutout itself is returned so the caller can keep and show the input it actually used.
  return {...prepared,cutout:hasAlpha?null:{rgba,width,height},provenance:{route:hasAlpha?'input-alpha':'browser-u2net',decoder:{nativeFormat,converted:!['RGBA','BGRA','RGBX','BGRX'].includes(nativeFormat)},segmentation,preparation:prepared.provenance}};
}

// What the page actually fed TRELLIS, for the drawer: an image that already had alpha is used
// as it is; a browser U2Net cutout is saved to the image library so it can be seen and reused.
// A cutout that could not be saved is reported as such, never replaced by the original photo.
export async function describeTrellisInput({image,cutout,label,fetch=globalThis.fetch,encode}){
  if(!cutout)return {kind:'original-alpha',source:image.source};
  try{
    const png=await encode(cutout),name=`${String(label).replace(/[^\w.-]+/g,'-')}-cutout.png`;
    const response=await fetch('/api/ingest-image?'+new URLSearchParams({name}),{method:'POST',body:png});
    const saved=await response.json().catch(()=>null);
    if(!response.ok||!saved?.entry?.source)throw Error(saved?.error||`cutout storage HTTP ${response.status}`);
    return {kind:'cutout',source:saved.entry.source};
  }catch(error){return {kind:'cutout-unsaved',source:null,error:error?.message||String(error)};}
}

async function buildRunSurfels({runtime,out,rawMesh,withForeground,provenance}){
  try{
    if(!rawMesh)throw Error('the asset consumer did not hand over the raw mesh');
    const [gc,mc,mf]=await Promise.all([out.geometry.coordinates,out.material.coordinates,out.material.features].map(t=>runtime.readTensor(t)));
    const {buildSurfelField,encodeSurfelGLB}=await import('./trellis-surfels.mjs');
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
