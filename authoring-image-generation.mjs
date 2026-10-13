// Text -> image in the Authoring workspace with FLUX.2 [klein] 4B on the Kaminos shared
// device. The image is saved to the image inbox and becomes the selected source, so the
// existing Prepare -> SF3D path turns a prompt into a mesh while the kiln keeps rendering.
// The model lives in models/flux2-klein; this module only composes it into the host.

export const KLEIN_AUTHORING_ROUTE_ID='flux2-klein.text-to-image.authoring-shared-device.v0';
export const KLEIN_PUBLISHED_WEIGHTS='https://huggingface.co/BasinShapers/flux2-klein-4b-webgpu/resolve/main';
// The sizes klein's own demo offers and its README times.
export const KLEIN_IMAGE_SIZES=[512,768,1024];
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

export function kleinImageName(prompt,seed){
  const slug=String(prompt).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'');
  return `klein-${slug||'image'}-s${seed}.png`;
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
export async function runWithKilnHandoff({service,input,handoff,owner}){
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
  createPipeline=async(device,urls)=>{const {KleinPipeline}=await import('./models/flux2-klein/klein-pipeline.js');return new KleinPipeline(device,urls);},
  encodePng=encodeCanvasPng,changed=()=>{},blocked=()=>null}){
  let loaded=null,active=false,abort=null;
  let state={status:'idle',progress:'Weights load the first time you generate an image.',stage:null,percent:null,canStop:false,error:null,results:[]};
  const publish=()=>changed(structuredClone(state));
  const set=(values)=>{Object.assign(state,values);publish();};
  function unavailable(){
    const {sharedGpu}=context();const device=sharedGpu?.device;
    if(!device)return 'Image generation needs the Kaminos shared GPU device.';
    if(!device.features?.has?.('shader-f16'))return 'This GPU device was created without shader-f16, which FLUX.2 klein needs.';
    return blocked();
  }
  async function load(){
    const {sharedGpu}=context();
    const core=await kit(),device=sharedGpu.device,base=String(await weights()).replace(/\/$/,'');
    const session=await core.createWebGpuInferenceSession({sessionId:`kaminos-klein:${crypto.randomUUID()}`,device,adapterName:sharedGpu.adapter?.info?.description||'kaminos-shared-device',deviceOwnership:'borrowed'});
    const foreground=core.createWebGpuForegroundService({routeId:KLEIN_AUTHORING_ROUTE_ID,device});
    const pipeline=await createPipeline(device,{textEncoderUrl:`${base}/te`,transformerUrl:`${base}/dit`,vaeUrl:`${base}/vae`});
    await pipeline.load((part,name,{loadedBytes,totalBytes})=>{
      if(abort?.signal.aborted)return;
      set({stage:'Loading weights',percent:totalBytes?Math.min(100,loadedBytes/totalBytes*100):null,progress:`Loading FLUX.2 klein weights (${part})`});
    });
    return {core,session,foreground,pipeline,base};
  }
  return {
    read(){
      if(state.status==='idle'||state.status==='unavailable'){
        const reason=unavailable();
        return reason?{...structuredClone(state),status:'unavailable',error:reason}:{...structuredClone(state),status:state.status==='unavailable'?'idle':state.status};
      }
      return structuredClone(state);
    },
    busy:()=>active,
    stop(){
      if(!active||!state.canStop||abort.signal.aborted)return false;
      abort.abort(new DOMException('Image generation stopped by operator','AbortError'));set({canStop:false,status:'stopping',progress:'Stopping… waiting for the current GPU work to settle.'});return true;
    },
    async run({prompt,seed,size=512}){
      if(active)throw Error('Image generation is already running');
      const text=String(prompt||'').trim();if(!text)throw Error('Describe the image to generate');
      if(!KLEIN_IMAGE_SIZES.includes(size))throw Error('Image size must be 512, 768 or 1024');
      const reason=unavailable();if(reason)throw Error(reason);
      const scene=context();if(!scene.prototype?.foregroundGpuContext||!scene.host||!scene.handoff)throw Error('Load a Fire & smoke scene to generate images beside the kiln.');
      active=true;abort=new AbortController();let phase='weights',previous=null,handoff=null,frameRun=null,route=null,control=null,session=null;
      set({status:'loading',error:null,canStop:true,stage:null,percent:null,progress:loaded?'Starting…':'Loading FLUX.2 klein…'});
      try{
        if(!loaded)loaded=await load();
        if(abort.signal.aborted)throw abort.signal.reason;
        ({session}=loaded);const {core,foreground,pipeline,base}=loaded;
        // The kiln of the scene loaded now; a reloaded scene has a new prototype and handoff.
        const current=context();handoff=current.handoff;const host=current.host;
        if(!current.prototype?.foregroundGpuContext||!host||!handoff)throw Error('Load a Fire & smoke scene to generate images beside the kiln.');
        if(!handoff.has('klein'))handoff.install('klein',request=>foreground.request({...request,run:service=>host.runForegroundFrame(()=>request.run(service))}));
        previous=handoff.owner();await handoff.activate('klein');
        phase='inference';set({status:'running',stage:'Reading prompt',percent:null,progress:'Reading the prompt…'});
        const runId=`kaminos-klein:${crypto.randomUUID()}`;
        frameRun=await foreground.beginRun(runId);
        route=await session.registerRoute({routeId:KLEIN_AUTHORING_ROUTE_ID,runtimeOptions:{runtimeLabel:'flux2-klein',foregroundOpportunities:frameRun.foregroundOpportunities}});
        control=core.createWebGpuInferenceControl({queue:context().sharedGpu.device.queue,signal:abort.signal,withForeground:frameRun.withForeground});
        const job=route.enqueue({jobId:runId,execute:invocation=>pipeline.generate({prompt:text,seed,width:size,height:size,textLength:'fit16',
          onPhase:value=>{if(!abort.signal.aborted)set(value==='decode'?{stage:'Decoding',percent:null,progress:'Decoding the image…'}:value==='text'?{stage:'Reading prompt',percent:null,progress:'Reading the prompt…'}:{progress:'Swapping weights in from the browser cache…'});},
          onStep:(i,n)=>{if(!abort.signal.aborted)set({stage:'Denoising',percent:i/n*100,progress:`Denoising, step ${i} of ${n}`});},
          schedule:{runtime:route.runtime,invocation,control,signal:abort.signal,targetDutyMs:12,maxInFlight:2,withForeground:frameRun.withForeground}})});
        const completion=await job.completion;
        if(completion.status!=='succeeded'){const error=Error(completion.failure?.message??completion.status);error.name=completion.failure?.name??'Error';throw error;}
        const image=completion.output;
        // Completed pixels win a stop race; they are saved like any other result.
        phase='persistence';set({status:'saving',canStop:false,stage:'Saving image',percent:null,progress:'Saving the image to Source images…'});
        const provenance={schema:'kaminos.image-generation.v1',route:KLEIN_AUTHORING_ROUTE_ID,model:'FLUX.2 [klein] 4B',prompt:text,seed,width:image.width,height:image.height,weights:base,timings:image.timings};
        const blob=await withPngProvenance(await encodePng(image.rgba,image.width,image.height),provenance);
        const file=new File([blob],kleinImageName(text,seed),{type:'image/png'});
        const entry=await deliver(file,provenance);
        state.results.push({...entry,provenance});
        set({status:'complete',error:null,stage:'Complete',percent:100,progress:'Image saved and selected. Generate a mesh from it below.'});
        return entry;
      }catch(error){
        const identity=errorIdentity(error);
        if(phase!=='persistence'&&abort.signal.aborted&&identity.name==='AbortError'){set({status:'stopped',error:null,stage:null,percent:null,progress:'Image generation stopped. Your scene is unchanged.'});return null;}
        set({status:'failed',error:`${phase}: ${identity.message}`,stage:null,percent:null});throw error;
      }finally{
        try{await control?.close();}catch{/* the control reports its own close failure */}
        if(route){await route.drain();session.unregisterRoute(route.routeId);}
        if(frameRun)await frameRun.finish();
        if(previous&&previous!=='klein'&&handoff?.has(previous))await handoff.activate(previous);
        active=false;state.canStop=false;abort=null;publish();
      }
    },
  };
}

export function installKleinImageGeneration({document,controller,assets}){
  const container=document.getElementById('asset-generate');if(!container)throw Error('Generate panel is missing');
  const section=document.createElement('section');section.id='asset-text-image';
  section.innerHTML=`<p>Text → image · FLUX.2 klein</p><textarea id="asset-prompt" rows="2" spellcheck="true" placeholder="One object, e.g. a weathered bronze lantern" aria-label="Image prompt"></textarea>
    <div class="asset-text-image-actions"><button type="button" id="asset-text-run">Generate image</button><label>Size <select id="asset-image-size" aria-label="Image size"><option value="512" selected>512</option><option value="768">768 (slower)</option><option value="1024">1024 (slowest)</option></select></label><label>Seed <input id="asset-seed" type="number" min="0" step="1" aria-label="Seed"></label><button type="button" id="asset-reseed" title="New seed" aria-label="New seed">⟳</button><button type="button" id="asset-text-stop" hidden>Stop</button></div>
    <div id="asset-text-status" role="status"></div><progress id="asset-text-progress" max="100" aria-label="Image generation progress" hidden></progress>`;
  container.prepend(section);
  // Looked up in the document: the Generate layout may move these controls out of this section.
  const byId=id=>document.getElementById(id),seedInput=byId('asset-seed');
  const reseed=()=>{seedInput.value=String(Math.floor(Math.random()*1e9));};reseed();
  const meshBusy=()=>['preparing','input','loading','running','stopping','saving'].includes(assets.generation()?.status);
  function render(){
    const state=controller.read(),active=['loading','running','stopping','saving'].includes(state.status);
    byId('asset-text-run').disabled=active||state.status==='unavailable'||meshBusy();
    byId('asset-text-stop').hidden=!state.canStop&&state.status!=='stopping';byId('asset-text-stop').disabled=!state.canStop;
    byId('asset-text-stop').textContent=state.status==='stopping'?'Stopping…':'Stop';
    byId('asset-text-status').textContent=state.error||(state.status==='idle'?'':`${state.progress}${Number.isFinite(state.percent)&&state.status!=='complete'?` · ${Math.round(state.percent)}%`:''}`);
    const bar=byId('asset-text-progress');bar.hidden=!active;if(Number.isFinite(state.percent))bar.value=state.percent;else bar.removeAttribute('value');
  }
  byId('asset-reseed').onclick=reseed;
  byId('asset-text-stop').onclick=()=>controller.stop();
  const run=()=>{
    const seed=Math.max(0,Math.floor(Number(seedInput.value)||0));
    controller.run({prompt:byId('asset-prompt').value,seed,size:Number(byId('asset-image-size').value)}).then(entry=>{if(entry)reseed();}).catch(error=>{byId('asset-text-status').textContent=error.message;});
  };
  byId('asset-text-run').onclick=run;
  byId('asset-prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!byId('asset-text-run').disabled)run();}});
  return {render};
}
