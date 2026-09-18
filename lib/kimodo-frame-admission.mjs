// Separate devices: counter advancement is a render/simulation opportunity,
// not proof of presentation or hardware-wide priority.
export function createFrameAdmission({mode,queue,readFlame,visibility=()=>document.visibilityState,
  requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,now=()=>performance.now(),events=[]}){
  if(!['telemetry-only','frame-admission','layer-chunk-admission'].includes(mode))throw new Error(`Unknown Kimodo scheduling mode: ${mode}`);
  return function boundary({step,pass,signal,dutyId=null,chunkIndex=1,chunkCount=1,layerStart=0,layerEnd=16}){
    const event={step,pass,dutyId,chunkIndex,chunkCount,layerStart,layerEnd,mode,startedAtMs:now(),status:'pending'};events.push(event);
    if(mode==='telemetry-only'){event.status='observed-only';event.endedAtMs=now();return Promise.resolve();}
    return new Promise((resolve,reject)=>{
      let frame=null,settled=false,baseline;
      const finish=error=>{
        if(settled)return;settled=true;
        if(frame!==null)cancelFrame(frame);
        signal?.removeEventListener('abort',abort);
        event.endedAtMs=now();event.status=error?'failed':'advanced';
        if(error){event.error=error.message;reject(error);}else resolve();
      };
      const abort=()=>finish(new DOMException('Frame admission cancelled','AbortError'));
      const read=()=>{
        const s=readFlame();
        if(visibility()!=='visible'||s.active!==true||s.error||!/^WebGPU:/.test(s.backend??'')
          ||!Number.isSafeInteger(s.frameCount)||!Number.isSafeInteger(s.simStepCount))throw new Error('Foreground flame unavailable or hidden');
        return {frameCount:s.frameCount,simStepCount:s.simStepCount};
      };
      const tick=()=>{
        if(settled)return;
        try{
          const current=read();
          if(current.frameCount<baseline.frameCount||current.simStepCount<baseline.simStepCount)throw new Error('Foreground counters reset');
          if(current.frameCount>baseline.frameCount&&current.simStepCount>baseline.simStepCount){event.after=current;finish();}
          else frame=requestFrame(tick);
        }catch(error){finish(error);}
      };
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});
      Promise.resolve().then(()=>{if(!settled)return queue.onSubmittedWorkDone();}).then(()=>{
        if(settled)return;
        event.queueDoneAtMs=now();baseline=read();event.before=baseline;
        frame=requestFrame(tick);
      }).catch(finish);
    });
  };
}

export function verifyFrameAdmission(run,expectedMode,pageTimeOrigin){
  const {scheduling,diagnostics}=run??{};
  const chunked=expectedMode==='layer-chunk-admission';
  const chunksPerPass=chunked?4:1;
  const count=run?.steps*4*chunksPerPass;
  if(!['telemetry-only','frame-admission','layer-chunk-admission'].includes(expectedMode)||scheduling?.mode!==expectedMode)throw new Error('Scheduling mode mismatch');
  if(chunked&&(scheduling.layersPerDuty!==4||scheduling.chunksPerPass!==4))throw new Error('Chunk scheduling identity mismatch');
  if(chunked&&(diagnostics?.scheduling?.layersPerDuty!==4||diagnostics?.scheduling?.chunksPerPass!==4))throw new Error('Producer chunk scheduling identity mismatch');
  if(!chunked&&scheduling.layersPerDuty!=null&&scheduling.layersPerDuty!==16)throw new Error('Full-pass scheduling identity mismatch');
  if(!chunked&&diagnostics?.scheduling?.layersPerDuty!=null&&diagnostics.scheduling.layersPerDuty!==16)throw new Error('Producer full-pass scheduling identity mismatch');
  if(!Number.isSafeInteger(count)||count<4||scheduling.events?.length!==count||diagnostics?.passes?.length!==count
    ||diagnostics?.submissionReport?.duties?.length!==count||diagnostics.clock!=='performance.now')throw new Error('Missing complete scheduling diagnostics');
  if(!Number.isFinite(pageTimeOrigin)||!Number.isFinite(diagnostics.timeOrigin)
    ||diagnostics.timeOrigin!==pageTimeOrigin)throw new Error('Scheduling clock identity mismatch');
  const ordered=values=>values.every(Number.isFinite)&&values.every((v,i)=>i===0||v>=values[i-1]);
  const logicalPasses=['cond-root','cond-body','uncond-root','uncond-body'];
  const dutyIds=new Set();
  for(let i=0;i<count;i++){
    const event=scheduling.events[i],pass=diagnostics.passes[i],duty=diagnostics.submissionReport.duties[i];
    if(event.mode!==expectedMode||event.pass!==pass.pass||event.step!==Math.floor(i/(4*chunksPerPass))+1
      ||pass.dutyId!==duty.dutyId||duty.status!=='completed'
      ||!ordered([pass.encodeStartedAtMs,pass.encodeEndedAtMs,pass.admittedAtMs,event.startedAtMs,event.endedAtMs,pass.boundaryEndedAtMs,pass.readbackCompletedAtMs]))throw new Error('Incomplete or conflicting pass timing identity');
    if(typeof pass.dutyId!=='string'||!pass.dutyId||dutyIds.has(pass.dutyId))throw new Error('Missing or duplicate duty identity');
    dutyIds.add(pass.dutyId);
    if(chunked){
      const chunkIndex=i%chunksPerPass+1,layerStart=(chunkIndex-1)*4,layerEnd=chunkIndex*4;
      const expectedPass=logicalPasses[Math.floor(i/chunksPerPass)%4];
      if(event.pass!==expectedPass||event.dutyId!==pass.dutyId||!pass.dutyId.endsWith(`-c${chunkIndex}`)
        ||event.chunkIndex!==chunkIndex||pass.chunkIndex!==chunkIndex
        ||event.chunkCount!==chunksPerPass||pass.chunkCount!==chunksPerPass
        ||event.layerStart!==layerStart||pass.layerStart!==layerStart
        ||event.layerEnd!==layerEnd||pass.layerEnd!==layerEnd)throw new Error('Incomplete or conflicting chunk identity');
    }
    if(duty.timingAuthority!=='queue-work-done'
      ||!ordered([pass.encodeEndedAtMs,duty.submitStartedAtMs,duty.submitReturnedAtMs,duty.submittedAtMs,pass.admittedAtMs])
      ||!ordered([duty.submittedAtMs,duty.completedAtMs,pass.readbackCompletedAtMs]))throw new Error('Missing or conflicting current-duty completion timing');
    if(expectedMode!=='telemetry-only'){
      if(event.status!=='advanced'||!ordered([event.startedAtMs,event.queueDoneAtMs,event.endedAtMs])
        ||!ordered([duty.completedAtMs,event.queueDoneAtMs])
        ||!Number.isSafeInteger(event.before?.frameCount)||!Number.isSafeInteger(event.before?.simStepCount)
        ||!Number.isSafeInteger(event.after?.frameCount)||!Number.isSafeInteger(event.after?.simStepCount)
        ||event.after.frameCount<=event.before.frameCount||event.after.simStepCount<=event.before.simStepCount)throw new Error('Unverified foreground advancement');
    }else if(event.status!=='observed-only')throw new Error('Baseline scheduling substituted');
  }
  const foregroundQueueFence=expectedMode!=='telemetry-only';
  return {mode:expectedMode,passes:count,status:'verified',foregroundQueueFence,
    authority:chunked?'page-clock-current-chunk-duty-queue-prefix-and-fresh-dual-counter'
      :foregroundQueueFence?'page-clock-current-duty-queue-prefix-and-fresh-dual-counter':'page-clock-pass-and-duty-timing'};
}
