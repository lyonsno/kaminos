// TRELLIS 2 in this page: the selected image's prepared pixels run on the app GPU host
// (app-gpu-host.mjs) through the model's own bridge (models/trellis2/shared-host.js), and
// the learned fields are finished into a GLB in the page. No server model process, no GPU
// queue. The GLB is finished while the run still holds its route: the bridge releases the
// resident geometry and material tensors when the run finishes.

const MODEL_DEPS=async()=>{
  const [host,inputs,generation,material]=await Promise.all([import('./models/trellis2/shared-host.js'),
    import('./models/trellis2/generation-inputs.js'),import('./models/trellis2/trellis-generation.js'),import('./models/trellis2/trellis-material.js')]);
  return {createTrellisSharedHost:host.createTrellisSharedHost,loadGenerationInputs:inputs.loadGenerationInputs,
    createTrellisImageGenerationAdapter:generation.createTrellisImageGenerationAdapter,createTrellisAssetAdapter:material.createTrellisAssetAdapter};
};

// decoderActivationStorage 'f16' is the queued route's accepted setting (half the decoder
// activation memory); it needs shader-f16 on the shared device.
export async function runTrellisInPage({appGpu,manifest:source,fetchTensor,pixelValues,finishing,decoderActivationStorage,signal,onPhase=()=>{},provenance={},deps}){
  if(!(pixelValues instanceof Float32Array)||pixelValues.length!==512*512*3)
    throw TypeError('TRELLIS needs the selected image as prepared 512x512 RGB pixels');
  if(typeof finishing?.postprocessMesh!=='function'||typeof finishing?.unwrapMesh!=='function')
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
    const inputs=await d.loadGenerationInputs(manifest,fetchTensor,{pixelValues});
    generation=d.createTrellisImageGenerationAdapter({...inputs,route:run.route,onPhase:timed});
    const job=run.route.enqueue({jobId:run.runId+':image-to-fields',execute:invocation=>generation.run(invocation)});
    const completed=await job.completion;
    if(completed.status!=='succeeded'){
      const error=Error(completed.failure?.message??`TRELLIS generation ${completed.status}`);
      error.name=completed.failure?.name??'Error';throw error;
    }
    const out=completed.output;
    asset=d.createTrellisAssetAdapter({runtime:run.route.runtime,geometry:out.geometry,material:out.material,
      postprocessMesh:finishing.postprocessMesh,unwrapMesh:finishing.unwrapMesh,
      provenance:{input:'caller-prepared pixels',...provenance,route:run.route.routeId,modelIdentities:out.modelIdentities},
      onPhase:timed});
    const finished=await asset.run();
    if(!(finished.glb?.byteLength>=12)||new DataView(finished.glb).getUint32(0,true)!==0x46546c67)throw Error('TRELLIS page run returned bytes that are not a GLB');
    result={glb:finished.glb,uv:finished.mesh?.uvMetadata??null,material:finished.textures?.metadata??null,route:run.route.routeId};
  }finally{
    let failure=null;
    if(run){
      const gpu=await run.route?.runtime?.settleGpuTiming?.().catch(()=>null);
      closePhase();
      timing={gpu:gpu?{...gpu}:run.route?.runtime?.profile?.gpuTiming??null,phases:phases.map(p=>({phase:p.phase,modelRole:p.modelRole,
        wallMs:Math.round(p.endMs-p.startMs),gpuMs:p.gpuStart==null?null:Math.round(((p===phases.at(-1)?gpu?.totalGpuMs??p.gpuEnd:p.gpuEnd)-p.gpuStart)*10)/10}))};
      const report=await run.finish().catch(error=>({status:'held',error}));
      released=report?.status==='released';
      if(!released)failure=Error(`TRELLIS GPU route was not released: ${report?.status}${report?.error?` (${report.error.message})`:''}`);
    }else released=true;
    // A held run keeps its tensors; disposing under it would free resources still in use.
    if(released){asset?.dispose();generation?.dispose();await host.dispose();}
    if(failure)throw failure;
  }
  // Checked here: the run's GPU route was released and the asset is a GLB.
  return {...result,timing,receiptValidation:{ok:true,by:'authoring-trellis-page',checks:['route-released','glb-magic']}};
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
