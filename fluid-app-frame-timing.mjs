// Draw cadence includes browser scheduling and GPU pressure. Queue completion
// includes prior work on this device; neither is a display-present timestamp.
export function fluidAppFrameKey(source) {
  if(!source)return null;
  return JSON.stringify([source.scope,source.generation,source.paused,source.route,
    source.waterResolution,source.reflection,source.energy,source.diagnostics,
    source.particleCount,source.densityIterationsPerStep,source.opticalDebugMode,
    source.environmentSource,source.environmentGeneration,source.exposure]);
}
const distribution=values=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.ceil(p*sorted.length)-1];
  return {count:sorted.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:at(.5),p95:at(.95),p99:at(.99)};
};
export function createFluidAppFrameTiming({now=()=>performance.now(),onWindow=()=>{}}={}) {
  let key=null,previousStart=null,windowStart=null,frames=[],sample=null,queueSample=null,queuePending=false;
  let queueFailure=null,lastFence=-Infinity,lastDraw=null,epoch=0;
  function reset(){epoch++;key=null;previousStart=windowStart=null;frames=[];lastDraw=null;sample=queueSample=queueFailure=null;}
  function record({startedAt,endedAt,source,device,visible=true}) {
    if(!visible||!source){reset();return;}
    const nextKey=fluidAppFrameKey(source);
    if(nextKey!==key){reset();key=nextKey;}
    const intervalMs=previousStart===null?null:startedAt-previousStart;
    previousStart=startedAt;windowStart??=startedAt;lastDraw=endedAt;
    frames.push({startedAt,endedAt,cpuMs:endedAt-startedAt,intervalMs,source});
    if(endedAt-windowStart>=1000){
      const intervals=frames.map(f=>f.intervalMs).filter(v=>v!==null);
      const cpu=distribution(frames.map(f=>f.cpuMs)),cadence=distribution(intervals);
      sample={key,source,measuredAt:endedAt,windowStart,windowEnd:endedAt,frames,cpu,cadence,
        fps:cadence?1000/cadence.mean:null,scope:'complete_rendering_callback_and_actual_draw_start_intervals',presentation:'not_observed'};
      frames=[];windowStart=endedAt;
      onWindow(structuredClone(sample));
    }
    if(device&&!queuePending&&endedAt-lastFence>=1000){
      lastFence=endedAt;queuePending=true;
      const captured=structuredClone(source),capturedKey=key,capturedEpoch=epoch,submittedAt=endedAt;
      // Never await this in the frame loop or serialize normal rendering.
      try{
        Promise.resolve(device.queue.onSubmittedWorkDone()).then(()=>{
          if(capturedEpoch!==epoch)return;
          const completedAt=now();
          queueSample={key:capturedKey,source:captured,startedAt,submittedAt,completedAt,
            elapsedMs:completedAt-startedAt,scope:'cpu_callback_start_to_shared_queue_completion_including_prior_work_and_callback_delivery',presentation:'not_observed'};
          queueFailure=null;
        }).catch(error=>{if(capturedEpoch===epoch)queueFailure={key:capturedKey,message:String(error),measuredAt:now()};})
          .finally(()=>{queuePending=false;});
      }catch(error){queuePending=false;queueFailure={key:capturedKey,message:String(error),measuredAt:now()};}
    }
  }
  function read({source,visible=true}) {
    const currentKey=fluidAppFrameKey(source),matching=Boolean(source&&visible&&currentKey===key);
    const current=matching&&sample?.key===key?sample:null;
    return {status:!source?'unavailable':!visible?'hidden':!matching?'awaiting_settings':lastDraw!==null&&now()-lastDraw>1500?'idle':current?'measured':'collecting',
      sample:current,queueSample:matching&&queueSample?.key===key?queueSample:null,
      queueFailure:matching&&queueFailure?.key===key?queueFailure:null,queuePending,lastDraw:matching?lastDraw:null};
  }
  return {record,read,reset};
}
