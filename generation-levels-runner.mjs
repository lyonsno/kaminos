import {MAX_SURFEL_RESOLUTION} from './trellis-surfels.mjs';
// GI proxy tiers for a stored TRELLIS hero (lod-generation-levels.mjs prepareGenerationLevels), built from
// the run's raw decode and material fields in a module worker so tens of seconds of remesh and bake
// never hold the page's main thread. Always resolves with a report; a failure names its phase.
export function runGenerationLevels({decode=null,materialFields=null,source,heroGLB=null,surfelGLB=null,surfelSource=null,replace=false,completeMissing=false,input=null,route=null,reference='hero',targets,surfelFactors,textureLevels=true,
  WorkerClass=globalThis.Worker,workerUrl=new URL('./generation-levels-worker.mjs',import.meta.url),onPhase=()=>{}}){
  const automatic=surfelFactors===undefined&&reference==='hero'&&!!(decode?.coordinates||surfelGLB||surfelSource);
  const unsupported=automatic&&Number.isSafeInteger(materialFields?.resolution)&&materialFields.resolution>MAX_SURFEL_RESOLUTION;
  const surfels=unsupported?{status:'skipped',reason:'unsupported-resolution',resolution:materialFields.resolution,maxResolution:MAX_SURFEL_RESOLUTION}:null;
  if(automatic)surfelFactors=unsupported?[]:[4,8,16];
  if(!source)return Promise.resolve({phase:'skipped',reason:'no stored hero mesh to attach tiers to (surfels-only run)'});
  if(!WorkerClass)return Promise.resolve({phase:'skipped',reason:'no Worker in this environment'});
  return new Promise(resolve=>{
    let worker;
    const finish=report=>{try{worker?.terminate();}catch{}resolve(surfels?{...report,surfels}:report);};
    try{worker=new WorkerClass(workerUrl,{type:'module'});}catch(error){finish({phase:'worker',error:String(error?.message||error)});return;}
    worker.addEventListener('message',({data})=>{
      if(data?.kind==='phase')onPhase(data);
      else if(data?.kind==='done')finish(data.report);
    });
    worker.addEventListener('error',event=>finish({phase:'worker',error:String(event?.data?.message||event?.message||'the levels worker failed to load or threw before reporting (a module load failure carries no message)')}));
    const message={...(textureLevels===false?{textureLevels:false}:{}),...(decode?{decode}:{}),...(materialFields?{materialFields}:{}),...(heroGLB?{heroGLB}:{}),...(surfelGLB?{surfelGLB}:{}),...(surfelSource?{surfelSource}:{}),...(replace?{replace}:{}),...(completeMissing?{completeMissing}:{}),source,input,route,...(reference!==undefined&&reference!=='hero'?{reference}:{}),...(targets?{targets}:{}),...(surfelFactors?{surfelFactors}:{})};
    const transfers=[...(decode?[decode.vertices.buffer,decode.triangles.buffer,...(decode.coordinates?[decode.coordinates.buffer]:[])]:[]),...(materialFields?[materialFields.features.buffer,materialFields.coordinates.buffer]:[]),...(heroGLB instanceof ArrayBuffer?[heroGLB]:[]),...(surfelGLB instanceof ArrayBuffer?[surfelGLB]:[])];
    worker.postMessage(message,transfers);
  });
}
