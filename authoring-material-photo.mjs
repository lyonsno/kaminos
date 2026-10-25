import { createMaterialPhotoOperation } from './models/material-photo/material-photo-operation.js';
import { photographGlb } from './models/material-photo/photograph-glb.js';

export const PHOTOGRAPH_ROUTE='moge-supermat.material-photograph.webgpu.v0';
const check=signal=>signal?.throwIfAborted();
const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export function createPhotographAuthoringGeneration({runPage,persist,size=()=>768,changed=()=>{},blocked=()=>null}) {
  let active=false,abort=null,pending=null;
  const state={status:'idle',stage:null,progress:'',percent:null,canStop:false,error:null,results:[],inputPreview:null,inputKind:'original'};
  const read=()=>({...state,results:[...state.results],pending:pending?{label:pending.label}:null,
    ...(!active&&state.status==='idle'&&blocked()?{status:'unavailable',error:blocked()}: {})});
  const set=values=>{Object.assign(state,values);changed(read());};
  const store=async()=>{
    set({status:'saving',stage:'Saving photograph',progress:'Saving photograph',canStop:false});
    const saved=await persist(pending.glb,pending.generation,pending.label);
    state.results.push(saved);pending=null;
    set({status:'complete',stage:'Complete',progress:'Photograph saved',percent:100,error:null});return saved;
  };
  return {
    preparesInput:true,inputKind:'original',read,busy:()=>active,
    stop(){if(!active||!state.canStop)return false;abort.abort(new DOMException('Photograph stopped','AbortError'));set({status:'stopping',progress:'Stopping',canStop:false});return true;},
    async retryPersistence(){
      if(active)throw Error('Generation is already running');if(!pending)throw Error('No retained output needs saving');active=true;
      try{return await store();}catch(error){set({status:'failed',error:`persistence: ${error.message}`});throw error;}finally{active=false;changed(read());}
    },
    async run(image){
      if(active)throw Error('Generation is already running');if(pending)throw Error('Save the retained photograph before another run');
      if(!image?.source)throw Error('Choose a source image');const reason=blocked();if(reason)throw Error(reason);
      const resolution=size();if(![512,768,1024].includes(resolution))throw Error('Unsupported material resolution');
      active=true;abort=new AbortController();const current=abort;let phase='generation';
      set({status:'loading',stage:'Preparing photograph',progress:'Preparing photograph',percent:null,error:null,canStop:true,
        inputPreview:{input:image.source,source:image.source,kind:'original'}});
      try{
        const result=await runPage({image,size:resolution,signal:current.signal,onProgress:event=>{
          if(!active||abort!==current||current.signal.aborted)return;
          const model=event.stage==='geometry'?'Geometry':'Materials';
          set({status:event.phase==='loading'?'loading':'running',stage:model,progress:`${model}: ${event.phase}`});
        }});
        check(current.signal);
        if(!(result?.glb instanceof ArrayBuffer)||result.glb.byteLength<12||new DataView(result.glb).getUint32(0,true)!==0x46546c67)throw Error('Photograph returned no GLB');
        pending=result;phase='persistence';return await store();
      }catch(error){
        if(current.signal.aborted&&error.name==='AbortError'&&phase!=='persistence'){set({status:'stopped',stage:null,progress:'Photograph stopped',error:null,percent:null});return null;}
        set({status:'failed',stage:null,error:`${phase}: ${error.message}`,percent:null});throw error;
      }finally{active=false;abort=null;set({canStop:false});}
    },
  };
}

// The app host itself supplies beginRun, preserving its frame handoff and unsettled-run ledger.
export function createPagePhotographer({appHost,fetch=globalThis.fetch,weightsUrl,dependencies}={}) {
  let resident=null;
  async function apps(){
    if(resident)return resident;
    resident=(async()=>{
      const host=await appHost();if(!host?.device)throw Error('Material Photograph requires the page WebGPU host');
      const session=await host.session();
      const deps=dependencies??{...(await import('./models/moge/moge-app.js')),...(await import('./models/supermat/supermat-app.js'))};
      const common={device:host.device,session,foreground:host,load:false};
      const geometry=await deps.createMoGeApp(common);let materials;
      try{
        const half=host.device.features.has('shader-f16');
        materials=await deps.createSuperMatApp({...common,weightsUrl,adapterOptions:{weightLoading:'chunks',activations:half?'f16':'f32',
          fuseNorm:half,gemmPrecision:half?'f16-tiles':'f32',attention:'streaming'}});
        return {geometry,materials,operation:createMaterialPhotoOperation({geometry,materials})};
      }catch(error){await geometry.destroy();throw error;}
    })();resident.catch(()=>{resident=null;});return resident;
  }
  return async({image,size=768,signal,onProgress})=>{
    check(signal);
    const response=await fetch(image.source,{signal});if(!response.ok)throw Error(`Photograph input HTTP ${response.status}`);
    const blob=await response.blob(),bytes=await blob.arrayBuffer(),bitmap=await createImageBitmap(blob);
    let pixels;
    try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);pixels=context.getImageData(0,0,bitmap.width,bitmap.height);}finally{bitmap.close();}
    check(signal);const {operation}=await apps();check(signal);
    const result=await operation.infer({image:pixels,size,signal,onProgress});check(signal);
    const generation={schema:'kaminos.asset-generation.v1',runId:`material-photo-${crypto.randomUUID()}`,route:PHOTOGRAPH_ROUTE,target:'this-page',
      input:{source:image.source,sha256:await sha256(bytes),name:image.name??image.label},
      settings:{materialSize:size,depthEdge:.08},representation:'open-photograph-surface',models:['moge-2-vitl-normal','SuperMat']};
    onProgress?.({stage:'materials',phase:'exporting'});
    const label=(image.label||image.name||'Photograph').replace(/\.[^.]+$/,'');
    const glb=await photographGlb({depth:result.depth,maps:result.maps.maps,image:pixels},{name:label,receipt:generation});check(signal);
    generation.receiptValidation={ok:true,by:'authoring-material-photo',checks:['shared-app-host','original-input-sha256','moge-points','rgba-materials','embedded-glb']};
    return {glb,generation,label};
  };
}
