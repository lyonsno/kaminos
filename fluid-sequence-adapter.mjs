// An isolated, caller-owned Playwright page over the existing shared Fluid host.
// Source/store verification belongs to the browser launcher, not this adapter.
export function createFluidSequenceAdapter({page,source}){
 let renderedStep=null;
 const read=()=>page.evaluate(source=>{
  const entry=window.kaminosWorkbenchExperiments,owner=entry?.state();
  if(!owner?.id)throw Error('Owner experiment is unavailable');
  const s=window.kaminosFingerFluidBenchSessionState(),r=window.kaminosFingerFluidBenchDebugState()?.runtime,v=window.kaminosFingerFluidBenchViewportState();
  if(!s?.available||!r?.available||r.solver_backend!=='webgpu_compute'||v?.effective!=='shared'||v.failure||!v.lastFrame?.presentedByHost)throw Error('Effective shared WebGPU Fluid route unavailable');
  if(r.effectiveRendererMode!=='screen_space_refraction')throw Error('Unexpected effective Fluid renderer');
  return Promise.resolve(entry.read()).then(state=>({
   clock:{runId:owner.id+':'+s.generation,step:s.step,dt:s.fixedTimeStepSeconds,paused:s.paused,backend:r.solver_backend,renderer:r.effectiveRendererMode},
   source,conditions:{owner,settings:state.settings,sampling:state.sampling},
   view:{camera:window.kaminosCameraDebugState(),presentation:Object.fromEntries(['width','height','route','opticalDebugMode','captureColorSpace','displayTransform','exposure','environmentIntensity','environmentSource','environmentGeneration'].map(k=>[k,v.lastFrame[k]]))},
  }));
 },source);
 return {
  read,
  async hold(){await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('paused',true));},
  async advanceToStep(step){
   const receipt=await page.evaluate(step=>window.kaminosFingerFluidBenchAdvanceToStepForWitness(step),step);
   if(receipt.endStep!==step||!receipt.exact)throw Error('Fluid exact advancement did not complete');
   // Existing advancement renders already. Do not duplicate that render.
   renderedStep=step;
  },
  async render(){
   const before=await read();
   if(renderedStep!==before.clock.step){
    await page.evaluate(()=>{
     const c=window.kaminosFingerFluidBenchDebugState().config;
     return window.kaminosFingerFluidBenchRenderCurrentStateForWitness(c.effectiveRendererMode,c.effectiveOpticalDebugMode,c.requestedOpticalLightingMode,c.requestedOpticalFootprintMode,c.requestedTransmissionFootprintMode,c.requestedBodyTransportMode,c.requestedInterfaceFrequencyMode);
    });renderedStep=before.clock.step;
   }
   const after=await read();
   if(after.clock.step!==before.clock.step||!after.clock.paused)throw Error('Fluid changed during export render');
   return {step:after.clock.step};
  },
  async capture(){
   const data=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const canvas=document.getElementById('kaminos-host-renderer-canvas');
    if(!canvas){reject(Error('Shared renderer canvas missing'));return;}
    canvas.toBlob(blob=>{if(!blob){reject(Error('Canvas PNG capture failed'));return;}const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);},'image/png');
   }));
   if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw Error('Canvas capture is not PNG');
   return Buffer.from(data.slice('data:image/png;base64,'.length),'base64');
  },
 };
}
