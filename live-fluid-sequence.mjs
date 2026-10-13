import {renderSequence,sequenceSchedule} from './simulation-sequence.mjs';
import {createBrowserSequenceSink} from './browser-sequence-directory.mjs';

// Current page, current allocation. It never opens or replaces the author's water.
export function createLiveFluidSequenceAdapter({window,source,hold,advance}){
 let renderedStep=null;
 const read=async()=>{
  const entry=window.kaminosWorkbenchExperiments,owner=entry.state(),state=await entry.read();
  const s=window.kaminosFingerFluidBenchSessionState(),r=window.kaminosFingerFluidBenchDebugState()?.runtime,v=window.kaminosFingerFluidBenchViewportState();
  if(owner.id!=='lazarus/finite-pbf'||!s?.available||!r?.available||r.solver_backend!=='webgpu_compute'||v?.effective!=='shared'||v.failure||!v.lastFrame?.presentedByHost||r.effectiveRendererMode!=='screen_space_refraction')throw Error('Effective shared WebGPU water unavailable');
  return {clock:{runId:owner.id+':'+s.generation,step:s.step,dt:s.fixedTimeStepSeconds,paused:s.paused,backend:r.solver_backend,renderer:r.effectiveRendererMode},source,conditions:{owner,settings:state.settings,sampling:state.sampling},view:{camera:window.kaminosCameraDebugState(),presentation:Object.fromEntries(['width','height','route','opticalDebugMode','captureColorSpace','displayTransform','exposure','environmentIntensity','environmentSource','environmentGeneration'].map(k=>[k,v.lastFrame[k]]))}};
 };
 return {read,hold,
  async advanceToStep(step){await advance(step);renderedStep=step;},
  async render(){const before=await read();if(renderedStep!==before.clock.step){const c=window.kaminosFingerFluidBenchDebugState().config;await window.kaminosFingerFluidBenchRenderCurrentStateForWitness(c.effectiveRendererMode,c.effectiveOpticalDebugMode,c.requestedOpticalLightingMode,c.requestedOpticalFootprintMode,c.requestedTransmissionFootprintMode,c.requestedBodyTransportMode,c.requestedInterfaceFrequencyMode);renderedStep=before.clock.step;}const after=await read();if(after.clock.step!==before.clock.step||!after.clock.paused)throw Error('Water changed during render');return {step:after.clock.step};},
  async capture(){const canvas=window.document.getElementById('kaminos-host-renderer-canvas');if(!canvas)throw Error('Shared canvas missing');const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Canvas PNG capture failed')),'image/png'));return new Uint8Array(await blob.arrayBuffer());},
 };
}

export function exportLiveFluidSequence({window,transport,request,signal,onProgress,hold,advance}){
 // Validate before asking for a folder or touching water. Open picker in gesture.
 sequenceSchedule(request,transport.read().dt);
 if(request.startSeconds<transport.read().step*transport.read().dt)throw Error('Export starts before current water; replay or seek first');
 if(typeof window.showDirectoryPicker!=='function')throw Error('Folder export is unavailable in this browser; use the scripted sequence exporter');
 const chosen=window.showDirectoryPicker({mode:'readwrite',id:'kaminos-sequences'});
 return transport.exclusive(async()=>{
  const parent=await chosen;if(signal.aborted)return 'Export cancelled before changing water';
  const name='sequence-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+window.crypto.randomUUID(),directory=await parent.getDirectoryHandle(name,{create:true});
  const sink=await createBrowserSequenceSink(directory);
  let dispatched=false;
  try{
   // Observed server provenance, not an attestation of already-loaded module bytes.
   const response=await window.fetch('/api/runtime-config');if(!response.ok)throw Error('Runtime source read failed: '+response.status);
   const source={url:window.location.href,owner:window.kaminosWorkbenchExperiments.state(),runtimeConfig:await response.json(),provenance:'observed server configuration at export; loaded module revision is unverified'};
   dispatched=true;const result=await renderSequence({adapter:createLiveFluidSequenceAdapter({window,source,hold,advance}),sink,request,signal,onProgress});
   return `${result.completedFrames===sequenceSchedule(request,transport.read().dt).count?'Saved':'Cancelled; retained'} sequence in ${name}`;
  }catch(e){if(!dispatched)await sink.finish({status:'failed',complete:false,failurePhase:'live-export',failure:String(e)});throw e;}
 });
}
