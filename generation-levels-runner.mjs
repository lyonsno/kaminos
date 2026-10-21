// GI proxy tiers for a stored TRELLIS hero (lod-generation-levels.mjs prepareGenerationLevels), built from
// the run's raw decode and material fields in a module worker so tens of seconds of remesh and bake
// never hold the page's main thread. Always resolves with a report; a failure names its phase.
export function runGenerationLevels({decode,materialFields,source,input=null,route=null,targets,
  WorkerClass=globalThis.Worker,workerUrl=new URL('./generation-levels-worker.mjs',import.meta.url),onPhase=()=>{}}){
  if(!source)return Promise.resolve({phase:'skipped',reason:'no stored hero mesh to attach tiers to (surfels-only run)'});
  if(!WorkerClass)return Promise.resolve({phase:'skipped',reason:'no Worker in this environment'});
  return new Promise(resolve=>{
    let worker;
    const finish=report=>{try{worker?.terminate();}catch{}resolve(report);};
    try{worker=new WorkerClass(workerUrl,{type:'module'});}catch(error){finish({phase:'worker',error:String(error?.message||error)});return;}
    worker.addEventListener('message',({data})=>{
      if(data?.kind==='phase')onPhase(data);
      else if(data?.kind==='done')finish(data.report);
    });
    worker.addEventListener('error',event=>finish({phase:'worker',error:String(event?.data?.message||event?.message||'generation levels worker failed')}));
    const message={decode,materialFields,source,input,route,...(targets?{targets}:{})};
    worker.postMessage(message,[decode.vertices.buffer,decode.triangles.buffer,materialFields.features.buffer,materialFields.coordinates.buffer]);
  });
}
