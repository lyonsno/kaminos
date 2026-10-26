import {readReferenceImage} from './models/flux3-klein/reference-image.js';
// Text -> image in the Authoring workspace with Klein on the Kaminos shared
// device. The image is saved to the image inbox and becomes the selected source, so the
// existing Prepare -> SF3D path turns a prompt into a mesh while the kiln keeps rendering.
// The model lives in models/flux2-klein; this module only composes it into the host.

export const KLEIN_AUTHORING_ROUTE_ID='flux2-klein.text-to-image.authoring-shared-device.v0';
export const KLEIN_PUBLISHED_WEIGHTS='https://huggingface.co/BasinShapers/flux2-klein-4b-webgpu/resolve/main';
export const AUTHORING_IMAGE_MODELS=Object.freeze({
  flux2:{name:'FLUX.2 [klein] 4B',routeId:KLEIN_AUTHORING_ROUTE_ID,levels:['4-bit','3-bit','2-bit']},
  flux3:{name:'FLUX.3 Image Klein',routeId:'flux3-klein.text-to-image.authoring-shared-device.v0',levels:['4-bit']},
});
function imageModel(model){
  if(!Object.hasOwn(AUTHORING_IMAGE_MODELS,model))throw Error(`Unknown image model: ${model}`);
  return AUTHORING_IMAGE_MODELS[model];
}
export function authoringImageWeightRoot(config,model='flux2'){
  imageModel(model);
  const mounted=model==='flux3'?config?.flux3:config?.klein;
  if(mounted?.mounted&&typeof mounted.weightsUrl==='string'&&mounted.weightsUrl.trim())return mounted.weightsUrl;
  if(model==='flux3')throw Error('Mount local FLUX.3 weights with KAMINOS_FLUX3_WEIGHTS_ROOT before generating.');
  return KLEIN_PUBLISHED_WEIGHTS;
}
export async function createAuthoringImagePipeline(device,urls,model='flux2'){
  imageModel(model);
  if(model==='flux3'){
    const {Flux3Pipeline}=await import('./models/flux3-klein/flux3-pipeline.js');return new Flux3Pipeline(device,{...urls,cacheWeights:false});
  }
  const {KleinPipeline}=await import('./models/flux2-klein/klein-pipeline.js');return new KleinPipeline(device,{...urls,cacheWeights:!urls.transformerUrl.startsWith('/klein-weights/')});
}
// The sizes klein's own demo offers and its README times.
export const KLEIN_IMAGE_SIZES=[256,384,512,768,1024];
// Transformer weight levels (models/flux2-klein package): the text encoder, decoder and tokenizer are shared,
// so a level change swaps only the transformer. 4-bit is the package's full level ("Mint").
// Landscape and portrait keep the selected size as the long side; the short side is 9/16 of it, to a multiple of 16
// (the pipeline's requirement).
export const KLEIN_ASPECTS=Object.freeze(['square','landscape','portrait']);
export function kleinImageDimensions(size,aspect='square'){
  const short=Math.round(size*9/16/16)*16;
  return aspect==='landscape'?{width:size,height:short}:aspect==='portrait'?{width:short,height:size}:{width:size,height:size};
}
export const KLEIN_WEIGHT_LEVELS=Object.freeze({'4-bit':'dit','3-bit':'dit-q3','2-bit':'dit-q2'});
const KLEIN_LIMITS=['maxBufferSize','maxStorageBufferBindingSize','maxStorageBuffersPerShaderStage','maxComputeWorkgroupStorageSize'];

// Klein's kernels need f16 and the adapter's own buffer and workgroup limits (as its demo
// requests them). The host device is created once, so these compose into that acquisition.
export function kleinDeviceRequirements(adapter){
  if(!adapter?.features?.has?.('shader-f16'))return null;
  return {requiredFeatures:['shader-f16'],requiredLimits:Object.fromEntries(KLEIN_LIMITS.map(name=>[name,Number(adapter.limits[name])]))};
}

export function composeDeviceRequirements(...requirements){
  const present=requirements.filter(Boolean);
  if(!present.length)return null;
  const features=new Set(),limits={};
  for(const {requiredFeatures=[],requiredLimits={}} of present){
    for(const feature of requiredFeatures)features.add(feature);
    for(const [name,value] of Object.entries(requiredLimits)){
      limits[name]=!Object.hasOwn(limits,name)?value:name.startsWith('min')?Math.min(limits[name],value):Math.max(limits[name],value);
    }
  }
  return {requiredFeatures:[...features].sort(),requiredLimits:limits};
}

// The shared device's optional host requirements (SAM when mounted, klein when the
// adapter has f16). Always an object: requestKaminosSharedWebGpuDevice refuses a
// callback that yields null, which would cost ordinary authoring its shared device.
export function sharedDeviceHostRequirements({sam=null}={}){
  return async adapter=>composeDeviceRequirements(sam?await sam(adapter):null,kleinDeviceRequirements(adapter))??{};
}

export function kleinImageName(prompt,seed,model='flux2'){
  const slug=String(prompt).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'');
  return `${model==='flux3'?'flux3-klein':'klein'}-${slug||'image'}-s${seed}.png`;
}

// The volume prototype has one foreground requester. SF3D installs its own when it loads;
// klein borrows the kiln for its run and hands it back, so whichever model is running
// interleaves its duties with kiln frames.
export function createForegroundHandoff({prototype,host,waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())),settleMs=10000}){
  const requesters=new Map();let current=null;
  async function set(requester){
    const started=Date.now();
    for(;;){
      try{prototype.setForegroundOpportunityRequester(requester);return;}
      catch(error){
        // A kiln frame in flight refuses the swap; it settles within a frame or two.
        if(!/still pending/.test(error?.message)||Date.now()-started>settleMs)throw error;
        await waitFrame();
      }
    }
  }
  return {
    owner:()=>current,
    // A view of the prototype for a producer that installs its requester itself (SF3D).
    recording(owner){
      return new Proxy(prototype,{get(target,key){
        if(key==='setForegroundOpportunityRequester')return requester=>{target.setForegroundOpportunityRequester(requester);requesters.set(owner,requester);current=owner;};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }});
    },
    install(owner,requester){requesters.set(owner,requester);},
    has:owner=>requesters.has(owner),
    async activate(owner){
      if(!requesters.has(owner))throw Error(`no foreground requester for ${owner}`);
      if(current===owner)return;
      await set(requesters.get(owner));current=owner;host.setForegroundServiceActive(true);
    },
    // Back to the kiln's private animation loop, as before any model loaded, so a producer
    // that installs its own requester (SF3D) does not meet another model's pending frame.
    async release(){
      if(current===null)return;
      await set(null);current=null;host.setForegroundServiceActive(false);
    },
  };
}

// A mesh run takes the kiln's foreground requester only once its own admission would
// pass, so a refused request cannot strand a running image without kiln frames.
export async function runWithKilnHandoff({service,input,handoff,owner,blocked=()=>null}){
  // The cross-model check comes first: a model's own read() reports refusals only
  // while idle, and a finished, failed or stopped state would otherwise pass here.
  const refusal=blocked();if(refusal)throw Error(refusal);
  const state=service.read();
  if(state.status==='unavailable')throw Error(state.error||'Generation is unavailable');
  if(['input','loading','running','stopping','saving'].includes(state.status))throw Error('Generation is already running');
  if(state.pending)throw Error('Save the retained generated output before another run');
  if(!input?.source)throw Error('Choose a source image');
  if(handoff?.has(owner))await handoff.activate(owner);else await handoff?.release();
  return service.run(input);
}

// Generation provenance travels inside the PNG as an iTXt chunk (keyword below), so the
// image keeps its prompt, seed, model and route wherever it is stored or copied.
export const PNG_PROVENANCE_KEYWORD='kaminos:image-generation';
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export async function withPngProvenance(blob,provenance){
  const png=new Uint8Array(await blob.arrayBuffer()),enc=new TextEncoder();
  const data=new Uint8Array([...enc.encode(PNG_PROVENANCE_KEYWORD),0,0,0,0,0,...enc.encode(JSON.stringify(provenance))]);
  const chunk=new Uint8Array(12+data.length),view=new DataView(chunk.buffer);
  view.setUint32(0,data.length);chunk.set(enc.encode('iTXt'),4);chunk.set(data,8);view.setUint32(8+data.length,crc32(chunk.subarray(4,8+data.length)));
  const iend=png.length-12;
  if(new TextDecoder().decode(png.subarray(iend+4,iend+8))!=='IEND')throw Error('PNG does not end with IEND');
  return new Blob([png.subarray(0,iend),chunk,png.subarray(iend)],{type:'image/png'});
}
export function readPngProvenance(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),dec=new TextDecoder();
  for(let at=8;at+12<=bytes.length;){
    const length=view.getUint32(at),type=dec.decode(bytes.subarray(at+4,at+8));
    if(at+12+length>bytes.length)return null;
    if(type==='iTXt'){
      const body=bytes.subarray(at+8,at+8+length),key=dec.decode(body.subarray(0,body.indexOf(0)));
      if(key===PNG_PROVENANCE_KEYWORD){
        if(crc32(bytes.subarray(at+4,at+8+length))!==view.getUint32(at+8+length))return null;
        let i=key.length+3;i=body.indexOf(0,i)+1;i=body.indexOf(0,i)+1;
        try{return JSON.parse(dec.decode(body.subarray(i)));}catch{return null;}
      }
    }
    if(type==='IEND')return null;
    at+=12+length;
  }
  return null;
}

async function encodeCanvasPng(rgba,width,height){
  const canvas=new OffscreenCanvas(width,height);
  canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
  return canvas.convertToBlob({type:'image/png'});
}

const errorIdentity=value=>({name:typeof value?.name==='string'?value.name:'Error',message:typeof value?.message==='string'?value.message:String(value)});

export function createKleinAuthoringImageGeneration({context,deliver,weights,
  kit=()=>import('./webgpu-inference-kit/src/core.js'),
  createPipeline=createAuthoringImagePipeline,
  prepareReference=readReferenceImage,
  encodePng=encodeCanvasPng,changed=()=>{},blocked=()=>null,appHost=null,clock=()=>performance.now()}){
  // appHost (app-gpu-host.mjs): borrow the page's session and run on its one foreground
  // service. Without it, klein keeps its own session and service (the earlier route).
  let loaded=null,active=false,abort=null,decodeRequested=false;
  let state={status:'idle',progress:'Weights load the first time you generate an image.',stage:null,percent:null,canStop:false,error:null,results:[],pending:null,preview:null,timing:null};
  let startedAt=null,generationStartedAt=null,generationFinished=false;
  const timing=()=>!state.timing?null:{...state.timing,...(active&&!generationFinished?(generationStartedAt===null?{loadMs:clock()-startedAt}:{generationMs:clock()-generationStartedAt}):{})};
  // A computed image is kept until it is saved; a failed save retries these exact pixels.
  let pendingImage=null;
  async function savePending(){
    const {image,provenance,text,seed,model}=pendingImage;
    set({status:'saving',canStop:false,canDecode:false,stage:'Saving image',percent:null,progress:'Saving the image to Source images…'});
    const blob=await withPngProvenance(await encodePng(image.rgba,image.width,image.height),provenance);
    const file=new File([blob],kleinImageName(text,seed,model),{type:'image/png'});
    const entry=await deliver(file,provenance);
    pendingImage=null;state.pending=null;state.results.push({...entry,provenance});
    set({status:'complete',error:null,preview:null,stage:'Complete',percent:100,progress:'Image saved and selected. Generate a mesh from it below.'});
    return entry;
  }
  const publish=()=>changed(structuredClone(state));
  const set=(values)=>{Object.assign(state,values);publish();};
  function unavailable(){
    const {sharedGpu}=context();const device=sharedGpu?.device;
    if(!device)return 'Image generation needs the Kaminos shared GPU device.';
    if(!device.features?.has?.('shader-f16'))return 'This GPU device was created without shader-f16, which Klein needs.';
    return blocked();
  }
  async function releaseLoaded(){
    if(!loaded)return;
    const previous=loaded;loaded=null;
    await previous.pipeline.destroy();
    if(!previous.app){
      const handoff=context().handoff;if(handoff?.owner()==='klein')await handoff.release();
      await previous.foreground?.dispose?.();await previous.session.close?.();
    }
  }
  async function load(level,model){
    const spec=imageModel(model);
    const {sharedGpu}=context();
    const core=await kit(),device=sharedGpu.device,root=await weights(model);
    if(typeof root!=='string'||!root.trim())throw Error(`No weights configured for ${spec.name}`);
    const base=root.replace(/\/$/,'');
    await releaseLoaded();
    const app=appHost?await appHost():null;
    const session=app?await app.session():await core.createWebGpuInferenceSession({sessionId:`kaminos-klein:${crypto.randomUUID()}`,device,adapterName:sharedGpu.adapter?.info?.description||'kaminos-shared-device',deviceOwnership:'borrowed'});
    const foreground=app?null:core.createWebGpuForegroundService({routeId:spec.routeId,device});
    let pipeline;
    try{
    pipeline=await createPipeline(device,{textEncoderUrl:`${base}/te`,transformerUrl:`${base}/${KLEIN_WEIGHT_LEVELS[level]}`,vaeUrl:`${base}/vae`},model);
    await pipeline.load((part,name,{loadedBytes,totalBytes})=>{
      if(abort?.signal.aborted)return;
      set({stage:'Loading weights',percent:totalBytes?Math.min(100,loadedBytes/totalBytes*100):null,progress:`Loading ${spec.name} weights (${part})`});
    });
    return {core,session,foreground,pipeline,base,app,level,model};
    }catch(error){
      await pipeline?.destroy();
      if(!app){await foreground?.dispose?.();await session.close?.();}
      throw error;
    }
  }
  return {
    read(){
      if(state.status==='idle'||state.status==='unavailable'){
        const reason=unavailable();
        return reason?{...structuredClone(state),status:'unavailable',error:reason}:{...structuredClone(state),status:state.status==='unavailable'?'idle':state.status};
      }
      return {...structuredClone(state),timing:timing()};
    },
    timing,
    busy:()=>active,
    async retryPersistence(){
      if(active)throw Error('Image generation is already running');
      if(!pendingImage)throw Error('No generated image needs saving');
      active=true;
      try{return await savePending();}
      catch(error){set({status:'failed',error:`persistence: ${errorIdentity(error).message}`});throw error;}
      finally{active=false;publish();}
    },
    decodeNow(){
      if(!active||state.status!=='running'||state.stage!=='Denoising'||decodeRequested||abort.signal.aborted)return false;
      decodeRequested=true;set({canDecode:false,progress:'Decoding after the current diffusion step…'});return true;
    },
    stop(){
      if(!active||!state.canStop||abort.signal.aborted)return false;
      abort.abort(new DOMException('Image generation stopped by operator','AbortError'));set({canStop:false,status:'stopping',progress:'Stopping… waiting for the current GPU work to settle.'});return true;
    },
    async run({prompt,seed,size=512,level='4-bit',aspect='square',model='flux2',reference=null,promptExpansion=null}){
      if(active)throw Error('Image generation is already running');
      if(pendingImage)throw Error('Save the generated image before generating another');
      const text=String(prompt||'').trim();if(!text)throw Error('Describe the image to generate');
      const spec=imageModel(model);
      const routeId=reference?`${model}-klein.image-and-text.authoring-shared-device.v0`:spec.routeId;
      if(!KLEIN_IMAGE_SIZES.includes(size))throw Error('Image size must be 256, 384, 512, 768 or 1024');
      if(!Object.hasOwn(KLEIN_WEIGHT_LEVELS,level))throw Error('Weights level must be 4-bit, 3-bit or 2-bit');
      if(!spec.levels.includes(level))throw Error('FLUX.3 currently has 4-bit weights only');
      if(!KLEIN_ASPECTS.includes(aspect))throw Error('Aspect must be square, landscape or portrait');
      const {width,height}=kleinImageDimensions(size,aspect);
      const reason=unavailable();if(reason)throw Error(reason);
      const scene=context();if(!scene.prototype?.foregroundGpuContext||!scene.host||!scene.handoff)throw Error('Image generation needs the Kaminos shared GPU device and its frame owner.');
      active=true;decodeRequested=false;abort=new AbortController();const runAbort=abort;let phase='weights',previous=null,handoff=null,frameRun=null,route=null,control=null,session=null;
      startedAt=clock();generationStartedAt=null;generationFinished=false;
      set({status:'loading',error:null,canStop:true,canDecode:false,preview:null,timing:{loadMs:0,generationMs:null},stage:null,percent:null,progress:loaded?.model===model?'Starting…':`Loading ${spec.name}…`});
      try{
        if(reference&&!reference.rgb){set({stage:'Reading reference image',progress:'Reading the selected reference image…'});reference=await prepareReference(reference,{signal:abort.signal,maxArea:model==='flux2'?1024*1024:4096*4096});}
        if(!loaded||loaded.model!==model)loaded=await load(level,model);
        if(abort.signal.aborted)throw abort.signal.reason;
        if(loaded.level!==level){
          // The pipeline destroys the current transformer before loading the next, so until this resolves no level
          // is loaded: a failed or stopped swap must make the next run load its level again.
          loaded.level=null;
          set({stage:'Loading weights',percent:null,progress:`Loading the ${level} transformer…`});
          await loaded.pipeline.loadTransformer(`${loaded.base}/${KLEIN_WEIGHT_LEVELS[level]}`,(part,name,{loadedBytes,totalBytes})=>{
            if(!abort.signal.aborted)set({stage:'Loading weights',percent:totalBytes?Math.min(100,loadedBytes/totalBytes*100):null,progress:`Loading the ${level} transformer`});});
          loaded.level=level;
          if(abort.signal.aborted)throw abort.signal.reason;
        }
        ({session}=loaded);const {core,foreground,pipeline,base,app}=loaded;
        // The kiln of the scene loaded now; a reloaded scene has a new prototype and handoff.
        const current=context();handoff=current.handoff;const host=current.host;
        if(!current.prototype?.foregroundGpuContext||!host||!handoff)throw Error('Image generation needs the Kaminos shared GPU device and its frame owner.');
        previous=handoff.owner();
        if(!app){
          handoff.install('klein',request=>foreground.request({...request,run:service=>host.runForegroundFrame(()=>request.run(service))}));
          await handoff.activate('klein');
        }
        generationStartedAt=clock();state.timing={loadMs:generationStartedAt-startedAt,generationMs:0};
        phase='inference';set({status:'running',stage:'Reading prompt',percent:null,progress:'Reading the prompt…'});
        const runId=`kaminos-${model}-klein:${crypto.randomUUID()}`;
        frameRun=app?await app.beginRun(runId,{routeId}):await foreground.beginRun(runId);
        route=await session.registerRoute({routeId,runtimeOptions:{runtimeLabel:`${model}-klein`,foregroundOpportunities:frameRun.foregroundOpportunities}});
        control=core.createWebGpuInferenceControl({queue:context().sharedGpu.device.queue,signal:abort.signal,withForeground:frameRun.withForeground});
        const job=route.enqueue({jobId:runId,execute:invocation=>pipeline.generate({prompt:text,seed,width,height,textLength:'fit16',reference,
          shouldDecode:()=>decodeRequested,
          onPhase:value=>{if(!abort.signal.aborted)set(value==='reference'?{stage:'Reading reference image',canDecode:false,percent:null,progress:'Reading the reference image…'}:value==='decode'?{stage:'Decoding',canDecode:false,percent:null,progress:'Decoding the image…'}:value==='text'?{stage:'Reading prompt',percent:null,progress:'Reading the prompt…'}:value==='denoise'?{stage:'Denoising',canDecode:!decodeRequested,progress:'Denoising…'}:{progress:'Swapping weights in from the browser cache…'});},
          onStep:(i,n)=>{if(!abort.signal.aborted)set({stage:'Denoising',canDecode:!decodeRequested,percent:i/n*100,progress:decodeRequested?'Decoding after the current diffusion step…':`Denoising, step ${i} of ${n}`});},
          onPreview:frame=>{
            // GPU readback can land after Stop, save, or the next run. Only the
            // current inference may replace its own provisional image.
            if(!active||abort!==runAbort||runAbort.signal.aborted||phase!=='inference'||state.status!=='running')return;
            if(state.preview?.step>=frame.step)return;
            set({preview:{...frame,kind:'partial',runId}});
          },
          schedule:{runtime:route.runtime,invocation,control,signal:abort.signal,targetDutyMs:12,maxInFlight:2,withForeground:frameRun.withForeground}})});
        const completion=await job.completion;
        if(completion.status!=='succeeded'){const error=Error(completion.failure?.message??completion.status);error.name=completion.failure?.name??'Error';throw error;}
        const image=completion.output;
        state.timing={...timing(),generationMs:clock()-generationStartedAt};generationFinished=true;
        // Completed pixels win a stop race; they are saved like any other result.
        phase='persistence';
        const provenance={schema:'kaminos.image-generation.v1',route:routeId,model:spec.name,prompt:text,seed,width:image.width,height:image.height,weights:base,aspect,weightsLevel:level,transformer:`${base}/${KLEIN_WEIGHT_LEVELS[level]}`,timings:image.timings,elapsed:timing(),...(image.sampling?{completion:structuredClone(image.sampling)}:{}),...(promptExpansion?{promptExpansion:structuredClone(promptExpansion)}:{})};
        if(reference)provenance.reference=structuredClone(reference.provenance);
        if(pipeline.ditManifest?.source)provenance.source=structuredClone(pipeline.ditManifest.source);
        if(model==='flux3')Object.assign(provenance,{sampling:structuredClone(pipeline.sampling),source:structuredClone(pipeline.ditManifest.source),...(pipeline.ditManifest.lora?{lora:structuredClone(pipeline.ditManifest.lora)}:{})});
        pendingImage={image,provenance,text,seed,model};state.pending={name:kleinImageName(text,seed,model),provenance};
        state.preview={rgba:image.rgba,width:image.width,height:image.height,kind:'final',runId};
        return await savePending();
      }catch(error){
        const identity=errorIdentity(error);
        if(phase!=='persistence')state.preview=null;
        if(phase!=='persistence'&&abort.signal.aborted&&identity.name==='AbortError'){set({status:'stopped',error:null,stage:null,percent:null,progress:'Image generation stopped. Your scene is unchanged.'});return null;}
        set({status:'failed',error:`${phase}: ${identity.message}`,stage:null,percent:null});throw error;
      }finally{
        try{await control?.close();}catch{/* the control reports its own close failure */}
        if(route){await route.drain();session.unregisterRoute(route.routeId);}
        if(frameRun)await frameRun.finish();
        if(previous&&previous!=='klein'&&previous!=='app'&&handoff?.has(previous))await handoff.activate(previous);
        state.timing=timing();active=false;state.canStop=false;state.canDecode=false;abort=null;publish();
      }
    },
  };
}

export function imageGenerationTimeLabel(timing,status){
  if(!timing)return '';
  const seconds=ms=>`${(Math.max(0,ms)/1000).toFixed(1)} s`;
  if(timing.generationMs===null)return `Loading model · ${seconds(timing.loadMs)}`;
  const label=['running','stopping'].includes(status)?'Generating':status==='stopped'?'Stopped after':status==='failed'?'Generation elapsed':'Generated in';
  return `${label} ${seconds(timing.generationMs)}${timing.loadMs>=1000?` · model load ${seconds(timing.loadMs)}`:''}`;
}

export function installKleinImageGeneration({document,controller,assets,meshBusy:meshBusyOption=null,promptExpansion=null,promptProvenance=()=>null,reference=()=>assets.read().selected}){
  const container=document.getElementById('asset-generate');if(!container)throw Error('Generate panel is missing');
  const section=document.createElement('section');section.id='asset-text-image';
  section.innerHTML=`<p>Text → image · Klein</p><label>Model <select id="asset-image-model" aria-label="Image model"><option value="flux2">FLUX.2 Klein 4B</option><option value="flux3">FLUX.3 Image Klein (local)</option></select></label><textarea id="asset-prompt" rows="2" spellcheck="true" placeholder="One object, e.g. a weathered bronze lantern" aria-label="Image prompt"></textarea>
    <label id="asset-reference-control" hidden><input type="checkbox" id="asset-use-reference"> Use reference image <span id="asset-reference-name"></span></label>
    <div class="asset-text-image-actions"><button type="button" id="asset-text-run">Generate image</button><label>Size <select id="asset-image-size" aria-label="Image size"><option value="256">256 (fastest)</option><option value="384">384</option><option value="512" selected>512</option><option value="768">768 (slower)</option><option value="1024">1024 (slowest)</option></select></label><label>Shape <select id="asset-image-aspect" aria-label="Image shape"><option value="square" selected>Square</option><option value="landscape">Landscape 16:9</option><option value="portrait">Portrait 9:16</option></select></label><label>Weights <select id="asset-image-level" aria-label="Transformer weights"><option value="4-bit" selected>4-bit (full)</option><option value="3-bit">3-bit</option><option value="2-bit">2-bit (jankiest)</option></select></label><label>Seed <input id="asset-seed" type="number" min="0" step="1" aria-label="Seed"></label><button type="button" id="asset-reseed" title="New seed" aria-label="New seed">⟳</button><button type="button" id="asset-text-decode" hidden>Decode now</button><button type="button" id="asset-text-stop" hidden>Stop</button><button type="button" id="asset-text-retry" hidden>Retry saving image</button></div>
    <div id="asset-image-timing" hidden></div><div id="asset-text-status" role="status"></div><progress id="asset-text-progress" max="100" aria-label="Image generation progress" hidden></progress>`;
  container.prepend(section);
  // Looked up in the document: the Generate layout may move these controls out of this section.
  const byId=id=>document.getElementById(id),seedInput=byId('asset-seed');
  const reseed=()=>{seedInput.value=String(Math.floor(Math.random()*1e9));};reseed();
  const meshBusy=meshBusyOption||(()=>['preparing','input','loading','running','stopping','saving'].includes(assets.generation()?.status));
  let timer=null,timingStatus='idle';
  function renderTime(){
    const node=byId('asset-image-timing'),value=controller.timing();
    node.textContent=imageGenerationTimeLabel(value,timingStatus);node.hidden=!value;
    if(controller.busy()&&timer===null)timer=setTimeout(()=>{timer=null;renderTime();},200);
    else if(!controller.busy()&&timer!==null){clearTimeout(timer);timer=null;}
  }
  function render(){
    const state=controller.read(),active=['loading','running','stopping','saving'].includes(state.status)||!!promptExpansion?.busy();
    timingStatus=state.status;renderTime();
    byId('asset-image-model').disabled=active||!!state.pending;
    const selected=reference(),referenceControl=byId('asset-use-reference');
    byId('asset-reference-control').hidden=false;referenceControl.disabled=active||!!state.pending;
    byId('asset-reference-name').textContent=referenceControl.checked?`· ${selected?.kind==='image'?(selected.label||selected.name):'Choose an image in Browse or Open file'}`:'';
    byId('asset-text-run').disabled=active||state.status==='unavailable'||meshBusy()||!!state.pending;
    byId('asset-text-retry').hidden=!state.pending||active;
    byId('asset-text-stop').hidden=!state.canStop&&state.status!=='stopping';byId('asset-text-stop').disabled=!state.canStop;
    byId('asset-text-decode').hidden=!state.canDecode;
    byId('asset-text-stop').textContent=state.status==='stopping'?'Stopping…':'Stop';
    byId('asset-text-status').textContent=state.error||(state.status==='idle'?'':`${state.progress}${Number.isFinite(state.percent)&&state.status!=='complete'?` · ${Math.round(state.percent)}%`:''}`);
    const bar=byId('asset-text-progress');bar.hidden=!active;if(Number.isFinite(state.percent))bar.value=state.percent;else bar.removeAttribute('value');
  }
  byId('asset-reseed').onclick=reseed;
  byId('asset-image-model').onchange=()=>{
    const flux3=byId('asset-image-model').value==='flux3',levels=byId('asset-image-level');
    for(const option of levels.options)option.disabled=flux3&&option.value!=='4-bit';
    if(flux3)levels.value='4-bit';
    render();
  };
  byId('asset-use-reference').onchange=render;
  byId('asset-text-decode').onclick=()=>controller.decodeNow();
  byId('asset-text-stop').onclick=()=>controller.stop();
  byId('asset-text-retry').onclick=()=>controller.retryPersistence().catch(error=>{byId('asset-text-status').textContent=error.message;});
  const run=()=>{
    const seed=Math.max(0,Math.floor(Number(seedInput.value)||0));
    const useReference=byId('asset-use-reference').checked;
    const selected=reference();
    if(useReference&&selected?.kind!=='image'){byId('asset-text-status').textContent='Choose a source image in Browse or Open file first.';return;}
    controller.run({promptExpansion:promptProvenance(),reference:useReference?selected:null,model:byId('asset-image-model').value,prompt:byId('asset-prompt').value,seed,size:Number(byId('asset-image-size').value),level:byId('asset-image-level').value,aspect:byId('asset-image-aspect').value}).then(entry=>{if(entry)reseed();}).catch(error=>{byId('asset-text-status').textContent=error.message;});
  };
  byId('asset-text-run').onclick=run;
  byId('asset-prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!byId('asset-text-run').disabled)run();}});
  return {render};
}
