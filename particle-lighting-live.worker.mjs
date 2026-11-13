import {createParticleIncidentField} from './volume-particle-light-field.mjs';
import {particleLightingSourcePlan} from './particle-lighting-live-plan.mjs';
let device,adapter,initializing,field,fieldKey,particles,stopped=false,working=false,activeAbort,desiredRevision=0;
async function initialize(){
 if(initializing)return initializing;
 initializing=(async()=>{adapter=await navigator.gpu?.requestAdapter();if(!adapter||adapter.info?.isFallbackAdapter)throw Error('A hardware WebGPU lighting worker is required');device=await adapter.requestDevice();device.lost.then(info=>{if(!stopped)self.postMessage({kind:'device-lost',error:info.message,route:'worker-webgpu-particle-sweeps'});});})();return initializing;
}
async function read(buffer){const staging=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,staging,0,buffer.size);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);return new Float32Array(staging.getMappedRange().slice(0));}finally{staging.unmap();staging.destroy();}}
function shutdown(){field?.dispose();particles?.destroy();device?.destroy();self.close();}
// A worker message must get a turn before another expensive synchronous phase.
const yieldMessages=()=>new Promise(resolve=>setTimeout(resolve,0));
self.onmessage=async({data:job})=>{
 if(job.kind==='invalidate'){desiredRevision=Math.max(desiredRevision,job.revision);activeAbort?.abort(new DOMException('Lighting edit superseded','AbortError'));return;}
 if(job.kind==='dispose'){stopped=true;activeAbort?.abort();if(!working)shutdown();return;}
 if(stopped||job.kind!=='solve')return;
 if(working){self.postMessage({kind:'failed',id:job.id,revision:job.revision,error:'Lighting worker already owns a complete source request',phase:'admission'});return;}
 working=true;const abort=new AbortController();activeAbort=abort;let phase='source',scopes=0,stageAt=performance.now();const timings={};
 const checkpoint=()=>{abort.signal.throwIfAborted();if(job.revision<desiredRevision)throw new DOMException('Lighting edit superseded','AbortError');};
 const progress=({phase:next,detail=''})=>{const now=performance.now();timings[phase]=(timings[phase]??0)+now-stageAt;stageAt=now;phase=next;self.postMessage({kind:'progress',id:job.id,revision:job.revision,phase,detail,timings:{...timings}});};
 try{
  checkpoint();const plan=particleLightingSourcePlan(job),key=JSON.stringify([plan.dims,plan.origin,plan.extent,plan.sourceSettings,plan.transportWidth,plan.directionCount,plan.filterLength]);
  progress({phase:'device'});await initialize();await yieldMessages();checkpoint();
  device.pushErrorScope('validation');device.pushErrorScope('out-of-memory');scopes=2;
  if(!particles||particles.size!==job.records.byteLength){field?.dispose();field=null;fieldKey=null;particles?.destroy();particles=device.createBuffer({label:'complete live native particle snapshot',size:job.records.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});}
  device.queue.writeBuffer(particles,0,job.records);
  progress({phase:'prepare'});if(!field||fieldKey!==key){field?.dispose();field=null;field=await createParticleIncidentField(device,{dims:plan.dims,origin:plan.origin,extent:plan.extent,transportWidth:plan.transportWidth,directionCount:plan.directionCount,particles,slots:plan.slots,settings:plan.sourceSettings,filterLength:plan.filterLength,signal:abort.signal,onProgress:progress});fieldKey=key;}
  await yieldMessages();checkpoint();progress({phase:'encode'});const encoder=device.createCommandEncoder();field.encode(encoder);device.queue.submit([encoder.finish()]);
  progress({phase:'gpu-readback',detail:'GPU execution and field readback'});const data=await read(field.incident);await yieldMessages();checkpoint();
  progress({phase:'validate'});let gpuError;while(scopes){scopes--;const error=await device.popErrorScope();if(error)gpuError=error;}if(gpuError)throw Error(gpuError.message);checkpoint();
  if(!data.every(v=>Number.isFinite(v)&&v>=0))throw Error('Lighting worker produced a nonfinite or negative incoming field');
  timings[phase]=(timings[phase]??0)+performance.now()-stageAt;
  const info=adapter.info;self.postMessage({kind:'solved',id:job.id,revision:job.revision,route:'worker-webgpu-particle-sweeps',adapter:{vendor:info?.vendor,architecture:info?.architecture,device:info?.device,isFallbackAdapter:info?.isFallbackAdapter??false},plan,field:{dims:plan.dims,origin:plan.origin,extent:plan.extent,sourceIdentity:plan.sourceIdentity,sourceStep:plan.sourceStep,sourceFrame:plan.sourceFrame,sourceRevision:plan.sourceRevision,data},sourceState:job.state,sourceRecords:job.records,timings,transferBytes:{source:job.records.byteLength,result:data.byteLength}},[data.buffer,job.records.buffer]);
 }catch(error){while(scopes){scopes--;try{await device.popErrorScope();}catch{}}const cancelled=abort.signal.aborted||error.name==='AbortError';const result={kind:cancelled?'cancelled':'failed',id:job.id,revision:job.revision,route:'worker-webgpu-particle-sweeps',phase,error:error.message,timings,sourceState:job.state,sourceRecords:job.records};if(!stopped)self.postMessage(result,job.records?.buffer?[job.records.buffer]:[]);}
 finally{working=false;if(activeAbort===abort)activeAbort=null;if(stopped)shutdown();}
};
