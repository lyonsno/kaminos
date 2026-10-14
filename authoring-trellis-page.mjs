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

export async function runTrellisInPage({appGpu,manifest,fetchTensor,pixelValues,finishing,signal,onPhase=()=>{},provenance={},deps}){
  if(!(pixelValues instanceof Float32Array)||pixelValues.length!==512*512*3)
    throw TypeError('TRELLIS needs the selected image as prepared 512x512 RGB pixels');
  if(typeof finishing?.postprocessMesh!=='function'||typeof finishing?.unwrapMesh!=='function')
    throw TypeError('TRELLIS page finishing needs mesh cleanup and UV providers');
  const d=deps??await MODEL_DEPS();
  const stop=signal??new AbortController().signal;
  // The bridge takes the session itself; the app host hands it out asynchronously.
  const session=await appGpu.session();
  const host=await d.createTrellisSharedHost({appGpu:{device:appGpu.device,queue:appGpu.queue,session,
    beginRun:(runId,options)=>appGpu.beginRun(runId,options)}});
  let run,generation,asset,released=false;
  try{
    run=await host.beginRun({runId:`authoring-trellis-page-${globalThis.crypto.randomUUID()}`,signal:stop});
    await onPhase({phase:'checkpoint-loading'});
    const inputs=await d.loadGenerationInputs(manifest,fetchTensor,{pixelValues});
    generation=d.createTrellisImageGenerationAdapter({...inputs,route:run.route,onPhase});
    const job=run.route.enqueue({jobId:run.runId+':image-to-fields',execute:invocation=>generation.run(invocation)});
    const completed=await job.completion;
    if(completed.status!=='succeeded'){
      const error=Error(completed.failure?.message??`TRELLIS generation ${completed.status}`);
      error.name=completed.failure?.name??'Error';throw error;
    }
    const out=completed.output;
    asset=d.createTrellisAssetAdapter({runtime:run.route.runtime,geometry:out.geometry,material:out.material,
      postprocessMesh:finishing.postprocessMesh,unwrapMesh:finishing.unwrapMesh,
      provenance:{...provenance,route:run.route.routeId,modelIdentities:out.modelIdentities,input:'selected image, prepared in the page'},
      onPhase});
    const finished=await asset.run();
    return {glb:finished.glb,uv:finished.mesh?.uvMetadata??null,material:finished.textures?.metadata??null,route:run.route.routeId};
  }finally{
    let failure=null;
    if(run){
      const report=await run.finish().catch(error=>({status:'held',error}));
      released=report?.status==='released';
      if(!released)failure=Error(`TRELLIS GPU route was not released: ${report?.status}${report?.error?` (${report.error.message})`:''}`);
    }else released=true;
    // A held run keeps its tensors; disposing under it would free resources still in use.
    if(released){asset?.dispose();generation?.dispose();await host.dispose();}
    if(failure)throw failure;
  }
}
