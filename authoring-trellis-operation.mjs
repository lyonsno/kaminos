import {prepareImageForTrellis,describeTrellisInput} from './authoring-trellis-page.mjs';
export const U2NET_PACKAGE_URL='https://huggingface.co/BasinShapers/u2net-webgpu/resolve/f4f82a54b6e8d7ffd4321005dbff1cb03198c78b/f32/';

// The ordinary page and scene worker use this same model composition.
export function createTrellisAuthoringOperation({appGpuHost,request=globalThis.fetch,history=null,capture=()=>{},target='this-page',
 loadModule=specifier=>import(specifier),WorkerClass=globalThis.Worker}={}){
 if(typeof appGpuHost!=='function')throw TypeError('TRELLIS requires the actual application GPU host');
 let u2netRunner=null;
 function backgroundRunner(appGpu){
  if(!u2netRunner){
   const pending=(async()=>{const {loadU2NetPackage,createU2NetRunner}=await loadModule('./models/u2net/u2net-webgpu.js');
    return createU2NetRunner({device:appGpu.device,...await loadU2NetPackage(U2NET_PACKAGE_URL)});})();
   u2netRunner=pending;
   // Failed initialization owns no returned runner; another attempt may load it.
   pending.catch(()=>{if(u2netRunner===pending)u2netRunner=null;});
  }
  return u2netRunner;
 }
  const run=async({pixels,highResolutionPixels,image,label='TRELLIS page',signal,onPhase,onInput,onPreview,finishMesh=true,textureSize=1024,scheduling,finishingMode='original-remesh',assertCurrent=()=>{}}={})=>{
    const check=()=>{signal?.throwIfAborted();assertCurrent();};check();
    const response=await request('/api/runtime-config',{cache:'no-store'});const config=response.ok?await response.json():{};
    const [{runTrellisInPage,createTrellisPageCheckpoints},{createBrowserMeshPostprocess},{createWasmXatlasUnwrapper}]=await Promise.all([
      loadModule('./authoring-trellis-page.mjs'),loadModule('./models/trellis2/mesh-cleanup.js'),loadModule('./models/trellis2/wasm-xatlas.js')]);
    check();const pack=await createTrellisPageCheckpoints({config:config.trellisPage,fetch:request});check();
    // pixels:'package' (the stand-in), or an alpha image (a saved SAM cutout, or the
    // Generate step's prepared image) prepared here by the model's own browser kernel.
    let pixelValues=pixels==='package'?await pack.fetchTensor(pack.manifest.image.pixelTensor):pixels,preparation=null,imageSha256=pixels==='package'?pack.manifest.image.pixelValuesSha256:null;
    const needsHighConditioning=(pack.manifest.pipelineType??'1024_cascade')==='1024_cascade';
    if(pixels==='package'&&needsHighConditioning&&!pack.manifest.image.highResolution?.pixelTensor)
      throw Error('This image package has only 512 pixels; select the original image or prepare the package again for 1024 conditioning');
    let highResolutionPixelValues=pixels==='package'&&needsHighConditioning
      ?await pack.fetchTensor(pack.manifest.image.highResolution?.pixelTensor):highResolutionPixels;
    const appGpu=await appGpuHost();if(!appGpu)throw Error('TRELLIS in this page needs the app GPU host');
    if(image){
      // In the page, no server step: real alpha goes to the alpha preparation, an opaque photo
      // through browser U2Net first (weights from the shop's hosted package).
      const [{prepareTrellisAlphaRgba},{normalizePreparedTrellisRgb},{removeForegroundU2Net}]=await Promise.all([
        loadModule('./models/trellis2/alpha-preparation.js'),loadModule('./models/trellis2/generation-inputs.js'),loadModule('./models/u2net/rembg-u2net.js')]);
      const response=await request(image.source,{signal});if(!response.ok)throw Error(`TRELLIS input image HTTP ${response.status}`);
      const blob=await response.blob(),bytes=new Uint8Array(await blob.arrayBuffer());
      imageSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      const prepared=await prepareImageForTrellis({bytes,type:blob.type||undefined,signal,prepareTrellisAlphaRgba,highResolution:needsHighConditioning,
        removeForegroundU2Net:async options=>{
          // One model at a time on the page device: U2Net holds the app run while it segments,
          // yielding scene frames and Stop between its GPU segments (foreground: the run).
          const run=await appGpu.beginRun(`u2net-${crypto.randomUUID()}`,{routeId:'u2net.foreground-removal'});
          try{return await removeForegroundU2Net({...options,foreground:run});}finally{await run.finish();}
        },
        runner:()=>backgroundRunner(appGpu)});
      check();pixelValues=normalizePreparedTrellisRgb(prepared);
      highResolutionPixelValues=needsHighConditioning?normalizePreparedTrellisRgb(prepared.highResolution):undefined;preparation={source:image.source,...prepared.provenance};
      // What TRELLIS actually used, kept and shown: the image itself, or the saved U2Net cutout.
      const used=await describeTrellisInput({image,cutout:prepared.cutout,label,fetch:request,encode:async({rgba,width,height})=>{
        const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);
        return (await canvas.convertToBlob({type:'image/png'})).arrayBuffer();}});
      preparation.used=used;if(used.kind==='cutout')preparation.cutoutSource=used.source;if(used.error)preparation.cutoutSaveError=used.error;
      await onInput?.(used);
    }
    // Caller pixels without an image are identified by their own bytes.
    imageSha256??=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixelValues)),b=>b.toString(16).padStart(2,'0')).join('');
    const runId=`authoring-trellis-page-${crypto.randomUUID()}`;
    // Initialization/capture and durable history finish never join model progress.
    let historyForRun=null;
    const historyStarted=(history?history():Promise.resolve(null)).then(history=>{
      if(!history)return null;
      history.start({runId,label,source:{routeId:'trellis2.image-generation.webgpu.v0',inputSha256:imageSha256,checkpointManifestSha256:pack.manifestSha256}});
      historyForRun=history;return history;
    });
    historyStarted.catch(error=>console.warn('TRELLIS history initialization failed',error));
    const previewForProduct=preview=>{
      if(history&&!historyForRun)throw Error('TRELLIS history viewer was unavailable at preview delivery');
      historyForRun?.capture(preview);
      return onPreview?.(preview);
    };
    const finishHistory=status=>{historyStarted.then(history=>history?.finish(runId,status)).catch(error=>console.warn('TRELLIS history retention failed',error));};
    const postprocessMesh=createBrowserMeshPostprocess({targetFaces:200000,WorkerClass,signal,mode:finishingMode,
      device:appGpu.device,resolution:needsHighConditioning?1024:512});
    const {createBrowserMaterialBaker}=await loadModule('./models/trellis2/material-bake.js');
    const bakeMaterial=createBrowserMaterialBaker({WorkerClass,signal,projectPositions:postprocessMesh.projectMaterialPositions,
      withCpu:postprocessMesh.withCpu});
    try{
      const result=await runTrellisInPage({appGpu,runId,manifest:pack.manifest,fetchTensor:pack.fetchTensor,pixelValues,highResolutionPixelValues,signal,onPhase,...(history||onPreview?{onPreview:previewForProduct}:{}),scheduling,decoderActivationStorage:'f16',finishMesh:finishMesh!==false,textureSize,
        // Stop reaches the finishing providers too (cleanup and UV in workers where supported).
        finishing:{postprocessMesh,bakeMaterial,unwrapMesh:createWasmXatlasUnwrapper({WorkerClass,signal,normalMode:finishingMode==='original-remesh'?'source-original':'post-uv'})},
        provenance:{checkpointManifestSha256:pack.manifestSha256,
          input:image?`alpha image prepared by ${target}: ${image.source}`:pixels==='package'?'checkpoint package prepared pixels (Python-prepared stand-in), not a selected image':'caller-prepared pixels'}});
      check();finishHistory('completed');
      const generation={schema:'kaminos.asset-generation.v1',runId,route:result.route,target,
        ...(history?{history:{schema:'trellis2.voxel-history.v1',runId,source:'/api/trellis-history?'+new URLSearchParams({runId}),retention:'independent-of-generation-completion'}}:{}),
        receiptValidation:result.receiptValidation,conditioningShapes:result.conditioningShapes,input:{sha256:imageSha256,pixels:image?'page-alpha-prepared':pixels==='package'?'checkpoint-package-prepared':'caller-prepared',source:image?.source??null,preparation,checkpointManifestSha256:pack.manifestSha256},decoderActivationStorage:'f16',
        meshFinishing:result.meshFinishing,uv:result.uv,material:result.material,scheduling:result.timing?.scheduling,
        ...(result.previewDelivery?{previewDelivery:result.previewDelivery}:{})};
      return {glb:result.glb,generation,label,timing:result.timing,surfelGlb:result.surfelGlb??null,surfels:result.surfels??null,levelInputs:result.levelInputs??null};
    }catch(error){
      finishHistory(signal?.aborted?'stopped':'failed');
      // Kept for a decoder-only replay: the run's own capture plus the exact input and settings.
      // Decoding succeeded and mesh finishing failed: the surfels built before cleanup go back with the run's identity.
      if((error?.trellisSurfels?.surfelGlb||error?.trellisSurfels?.levelInputs)&&!signal?.aborted)error.trellisSurfelsRun={surfelGlb:error.trellisSurfels.surfelGlb,surfels:error.trellisSurfels.surfels,levelInputs:error.trellisSurfels.levelInputs,label,
        generation:{schema:'kaminos.asset-generation.v1',runId,route:error.trellisSurfels.route,target,receiptValidation:error.trellisSurfels.receiptValidation,
          input:{sha256:imageSha256,pixels:image?'page-alpha-prepared':pixels==='package'?'checkpoint-package-prepared':'caller-prepared',source:image?.source??null,preparation,checkpointManifestSha256:pack.manifestSha256},
          decoderActivationStorage:'f16',meshFinishing:{status:'failed',error:error.message}}};
      if(error?.trellisCapture)capture({...error.trellisCapture,error:{name:error.name,message:error.message},
        input:{pixels:pixelValues,highResolutionPixels:highResolutionPixelValues,sha256:imageSha256,source:image?.source??null,preparation,checkpointManifestSha256:pack.manifestSha256,decoderActivationStorage:'f16'}});
      throw error;
    }
  };

 return {run,async retire(){
  const pending=u2netRunner;if(!pending)return;
  let runner;
  try{runner=await pending;}catch{if(u2netRunner===pending)u2netRunner=null;return;}
  const app=await appGpuHost();await app.queue.onSubmittedWorkDone();runner.dispose();
  if(u2netRunner===pending)u2netRunner=null;
 }};
}
