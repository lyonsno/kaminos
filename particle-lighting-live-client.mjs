import {liveParticleLightingSettings,LIVE_LIGHT_SOLVE_KEYS} from './particle-lighting-live-plan.mjs';
const sourceKeys=['radius','stretch','flowAlignment','expansion','supportFloor','gain','opacity','stateLife','lifeFade'];
export function createLiveParticleLighting({runtime,settings:initial={},createWorker=()=>new Worker(new URL('./particle-lighting-live.worker.mjs',import.meta.url),{type:'module'}),onChange=()=>{},record=()=>{},clock=()=>performance.now()}){
 let settings=liveParticleLightingSettings(initial),worker=null,disposed=false,busy=false,revision=0,sequence=0,active=null,lastAttempt=null,lastResult=null,error=null,phase=settings.enabled?'waiting':'off',blocked=false,cancelled=0;
 const emit=()=>onChange();
 const continueLatest=()=>queueMicrotask(()=>{if(!disposed&&settings.enabled)void tick();});
 const current=()=>{try{return runtime()?.opticalParticleState();}catch{return null;}};
 function read(){const source=current()?.lightingSource;return {requested:{...settings},phase,busy,error,revision,cancelled,preparation:active?{stage:active.stage,detail:active.detail??'',revision:active.revision,desiredRevision:revision,elapsedMilliseconds:clock()-active.started,stageMilliseconds:clock()-active.stageStarted,timings:active.timings??{}}:null,effective:lastResult?{route:lastResult.route,adapter:lastResult.adapter,plan:lastResult.plan,sourceIdentity:lastResult.field.sourceIdentity,sourceStep:lastResult.field.sourceStep,sourceRevision:lastResult.field.sourceRevision,sourceUpdatesOld:source&&source.identity===lastResult.field.sourceIdentity?source.revision-lastResult.field.sourceRevision:null,transferBytes:lastResult.transferBytes,pipelineMilliseconds:lastResult.pipelineMilliseconds,timings:lastResult.timings}:null};}
 function clear(){const target=lastResult?.runtime;try{target?.setParticleIncidentField(null);}catch{}lastResult=null;}
 function stopWorker(){if(worker){worker.terminate();worker=null;}busy=false;active=null;}
 function fail(cause,stage){blocked=true;error=cause?.message??String(cause);phase='error';busy=false;record({kind:'particle-lighting.worker-error',phase:stage,error,revision});emit();}
 function apply(result=lastResult){if(result)result.runtime.setParticleIncidentField({...result.field,albedo:settings.albedo,gain:settings.gain,mode:settings.mode});}
 function ensureWorker(){if(worker)return;const own=createWorker();worker=own;
  own.onerror=event=>{if(own!==worker||disposed)return;stopWorker();blocked=true;fail(Error(event.message??'Lighting worker failed'),'worker');};
  own.onmessage=({data:message})=>{if(own!==worker||disposed)return;
   if(message.kind==='device-lost'){stopWorker();blocked=true;fail(Error(message.error),'device');return;}
   if(!active||message.id!==active.id||message.revision!==active.revision)return;const job=active;
   if(message.kind==='progress'){if(job.revision!==revision)return;job.stage=message.phase;job.detail=message.detail;job.timings=message.timings;job.stageStarted=clock();emit();return;}
   busy=false;active=null;if(message.kind==='cancelled')cancelled++;
   if(message.kind==='cancelled'){lastAttempt=null;phase=lastResult?'live':'waiting';emit();continueLatest();return;}
   if(job.revision!==revision||!settings.enabled){lastAttempt=null;emit();continueLatest();return;}
   const now=current();if(runtime()!==job.runtime||now?.lightingSource?.identity!==job.sourceIdentity){lastAttempt=null;clear();phase='waiting';emit();continueLatest();return;}
   if(message.kind==='failed'){fail(Error(message.error??'Lighting worker rejected its source'),message.phase??'worker');return;}
   try{
    const f=message.field,count=Array.isArray(f?.dims)&&f.dims.length===3&&f.dims.every(v=>Number.isSafeInteger(v)&&v>0)?f.dims.reduce((a,b)=>a*b,1):NaN;
    if(message.kind!=='solved'||message.revision!==job.revision||message.route!=='worker-webgpu-particle-sweeps'||message.adapter?.isFallbackAdapter!==false||!(f?.data instanceof Float32Array)||!Number.isSafeInteger(count)||f.data.length!==count*4||!Array.isArray(f.origin)||!Array.isArray(f.extent)||f.sourceIdentity!==job.sourceIdentity||f.sourceStep!==job.sourceStep||f.sourceRevision!==job.sourceRevision||!(message.sourceRecords instanceof Float32Array)||message.sourceRecords.byteLength!==job.sourceBytes||message.sourceState?.slots!==job.slots)throw Error('Lighting worker result does not match the native source, hardware route or complete field');
    const next={...message,runtime:job.runtime,pipelineMilliseconds:clock()-job.started};apply(next);lastResult=next;error=null;phase='live';record({kind:'particle-lighting.field',revision,sourceStep:f.sourceStep,sourceRevision:f.sourceRevision,plan:message.plan,route:message.route,adapter:message.adapter,transferBytes:message.transferBytes});emit();
   }catch(cause){fail(cause,'result');}
  };
 }
 async function tick(){
  if(disposed||!settings.enabled||busy||blocked)return read();
  const target=runtime(),state=target?.opticalParticleState(),context=state?.lightingSource;
  if(state?.effective!=='world-optical-particles'||!context||!target.sampleOpticalParticlesForLighting||!target.setParticleIncidentField){phase='waiting';emit();return read();}
  if(lastResult&&(lastResult.runtime!==target||lastResult.field.sourceIdentity!==context.identity)){clear();lastAttempt=null;}
  const signature=JSON.stringify([context.identity,context.revision,context.dims,sourceKeys.map(k=>state.settings?.[k]),context.material,LIVE_LIGHT_SOLVE_KEYS.map(k=>settings[k])]);
  if(signature===lastAttempt)return read();lastAttempt=signature;busy=true;phase='snapshot';error=null;
  const job={id:++sequence,revision,runtime:target,sourceIdentity:context.identity,started:clock(),stage:'snapshot',stageStarted:clock()};active=job;emit();
  try{
   const snapshot=await target.sampleOpticalParticlesForLighting();
   if(disposed||active!==job)return read();
   if(job.revision!==revision||!settings.enabled){busy=false;active=null;lastAttempt=null;emit();continueLatest();return read();}
   if(!snapshot?.available||snapshot.state?.effective!=='world-optical-particles'||!(snapshot.records instanceof Float32Array)||snapshot.records.length!==snapshot.state.slots*24||snapshot.state.lightingSource?.identity!==job.sourceIdentity)throw Error('Complete current native particle snapshot unavailable');
   job.sourceStep=snapshot.state.lightingSource.step;job.sourceRevision=snapshot.state.lightingSource.revision;job.sourceBytes=snapshot.records.byteLength;job.slots=snapshot.state.slots;
   ensureWorker();phase='transport';job.stage='worker';job.stageStarted=clock();worker.postMessage({kind:'solve',id:job.id,revision:job.revision,records:snapshot.records,state:snapshot.state,settings:{...settings}},[snapshot.records.buffer]);emit();
  }catch(cause){if(active===job){active=null;if(cause?.code==='PARTICLE_SOURCE_CHANGED'){busy=false;lastAttempt=null;phase='waiting';emit();continueLatest();}else fail(cause,'snapshot');}}
  return read();
 }
 function setOptions(patch){if(disposed)throw Error('Live lighting has been disposed');const next=liveParticleLightingSettings({...settings,...patch}),displayChanged=['albedo','gain','mode'].some(k=>next[k]!==settings[k]),solveChanged=LIVE_LIGHT_SOLVE_KEYS.some(k=>next[k]!==settings[k]),enableChanged=next.enabled!==settings.enabled;settings=next;
  if(solveChanged||enableChanged){if(blocked)stopWorker();revision++;lastAttempt=null;blocked=false;error=null;if(active&&worker)worker.postMessage({kind:'invalidate',revision});}
  if(!settings.enabled){clear();stopWorker();error=null;phase='off';}
  else{if(!busy&&!error)phase=lastResult?'live':'waiting';if(displayChanged)apply();}
  record({kind:'particle-lighting.settings',settings:{...settings}});emit();return read();
 }
 return {read,tick,setOptions,retry(){stopWorker();blocked=false;error=null;lastAttempt=null;revision++;phase=settings.enabled?'waiting':'off';emit();return read();},evidence(){return lastResult?{...read(),sourceState:structuredClone(lastResult.sourceState),sourceRecords:new Float32Array(lastResult.sourceRecords),field:{...lastResult.field,data:new Float32Array(lastResult.field.data)}}:null;},dispose(){if(disposed)return;disposed=true;clear();stopWorker();}};
}
