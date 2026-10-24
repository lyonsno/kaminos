// TRELLIS page caller uses the same application API as other shared-device hosts.
import {createTrellisApp,validateTrellisRunOptions} from './models/trellis2/trellis-app.js';
export {createTrellisApp,stageSummary} from './models/trellis2/trellis-app.js';
import {GENERATION_ROUTE} from './models/trellis2/sparse-generation-witness-checks.js';

export async function runTrellisInPage({appGpu,signal,...options}){
  validateTrellisRunOptions(options,appGpu);
  const app=await createTrellisApp({appGpu,routeId:GENERATION_ROUTE,...options});
  try{return await app.generate({signal});}
  finally{await app.destroy();}
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

export function createTrellisPageAuthoringGeneration({availability,runPage,persist,changed=()=>{},blocked=()=>null,now=()=>Date.now()}){
  let active=false,abort=null,started=0;
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
    else set({status:'complete',error:null,stage:'Complete',progress:'Mesh saved. Add it to this scene when you want.'});
    return saved;
  }
  return {
    preparesInput:true,
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
      const label=(input.label||input.name||'Generated').replace(/\.[^.]+$/,'');
      try{
        const out=await runPage({image:{source:cutout},label,signal:abort.signal,onInput:used=>set({inputPreview:{...used,input:input.source}}),onPhase:event=>{
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
      }finally{active=false;abort=null;state.canStop=false;publish();}
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
