// Observe existing model work. UI summaries stay small; the complete trace is copied only on export.
export function createTrellisLiveTelemetry({input,now=()=>Date.now(),requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis),readFrame=()=>null}={}){
  const startedAtMs=now(),events=[],frames=[],heartbeats=[];
  let endedAtMs=null,terminal=null,phase=null,latestOperation=null,completedOperations=0,failedOperations=0,raf=null;
  let lastFrameAt=null,maxFrameGapMs=0,lastHeartbeatAt=startedAtMs,maxHeartbeatGapMs=0,frame=null;
  const tick=()=>{if(terminal)return;const atMs=now(),gapMs=lastFrameAt===null?null:atMs-lastFrameAt;
    frames.push({atMs,gapMs});if(gapMs!==null)maxFrameGapMs=Math.max(maxFrameGapMs,gapMs);lastFrameAt=atMs;raf=requestFrame(tick);};
  if(typeof requestFrame==='function')raf=requestFrame(tick);
  function record(event){
    if(terminal)return;
    const row={...structuredClone(event),observedAtMs:now()};events.push(row);
    if(row.kind==='phase')phase=row;
    if(['kernel','kernel-prepare','gpu-duty'].includes(row.kind)){
      latestOperation=row;if(row.kind==='kernel'&&row.status==='completed')completedOperations++;
      if(row.status==='failed')failedOperations++;
    }
  }
  function summary(){const at=endedAtMs??now();return{schema:'trellis2.live-telemetry.v1',startedAtMs,elapsedMs:at-startedAtMs,
    terminal,eventCount:events.length,phase:phase?structuredClone(phase):null,
    latestOperation:latestOperation?structuredClone(latestOperation):null,operationElapsedMs:latestOperation?.status==='started'?at-latestOperation.observedAtMs:latestOperation?.durationMs??null,completedOperations,failedOperations,
    animation:{available:typeof requestFrame==='function',observedFrames:frames.length,lastGapMs:frames.at(-1)?.gapMs??null,
      maxGapMs:frames.length>1?maxFrameGapMs:null,ageMs:lastFrameAt===null?null:at-lastFrameAt},
    heartbeat:{lastAtMs:lastHeartbeatAt,maxGapMs:maxHeartbeatGapMs},frame:frame?structuredClone(frame):null};}
  return{
    record,summary,
    heartbeat(){if(terminal)return;const atMs=now(),gapMs=atMs-lastHeartbeatAt;lastHeartbeatAt=atMs;maxHeartbeatGapMs=Math.max(maxHeartbeatGapMs,gapMs);heartbeats.push({atMs,gapMs});
      try{frame=readFrame();}catch(error){frame={error:String(error?.message??error)};}},
    finish(status){if(terminal)return;terminal=status;endedAtMs=now();if(raf!==null&&typeof cancelFrame==='function')cancelFrame(raf);},
    export(){return{...summary(),input:structuredClone(input),retention:'all-observed-events-in-this-tab-until-reload-or-close',
      timingAuthority:'host-operation-wall-time-and-animation-callbacks-not-exclusive-gpu-time',events:structuredClone(events),frames:structuredClone(frames),heartbeats:structuredClone(heartbeats)};},
  };
}

export function formatTrellisLiveTelemetry(t){
  if(!t)return '';
  const seconds=n=>Number.isFinite(n)?(n/1000).toFixed(2)+'s':'unavailable',op=t.latestOperation,f=t.frame;
  return [`Elapsed: ${seconds(t.elapsedMs)}`,`Phase: ${t.phase?.phase??'Preparing input'}`,
    `Operation: ${op?`${op.name} · ${op.status}`:'not observed yet'}`,
    `Operation wall time: ${seconds(t.operationElapsedMs)} (includes host waits)`,
    `Kernel calls returned: ${t.completedOperations} · failed operations: ${t.failedOperations}`,
    `Animation gap: last ${seconds(t.animation.lastGapMs)} · worst ${seconds(t.animation.maxGapMs)}`,
    `Last animation callback: ${seconds(t.animation.ageMs)} ago`,
    `Worst heartbeat interval: ${seconds(t.heartbeat.maxGapMs)}`,
    ...(f?.error?[`Scene telemetry unavailable: ${f.error}`]:f?[`Scene/simulation frames: ${f.frameCount??'unavailable'} / ${f.simStepCount??'unavailable'}`,
      `Existing queue-completion probe: ${seconds(f.queueDoneMs)}${f.queueProbePending?' · pending':''}`]:[]),
    `Observed events: ${t.eventCount}${t.terminal?' · '+t.terminal:''}`,
    'Host/animation/queue proxies; not GPU-exclusive kernel timing.',
    'Complete trace stays in this tab. Save JSON to keep it across reloads.'].join('\n');
}
