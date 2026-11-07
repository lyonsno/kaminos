// A rolling diagnostic window, not present-time evidence. Retain the raw signal
// separately when investigating cadence. Inverse p95 is not average FPS.
export function frameCadenceSummary(intervals){
  // A manual redraw and a resumed RAF callback can carry the same timestamp.
  // Telemetry must neither count that as extra elapsed cadence nor stop the
  // renderer. Keep the exclusion count visible instead of inventing FPS.
  const valid=intervals.filter(x=>Number.isFinite(x)&&x>0),ignoredSamples=intervals.length-valid.length;
  intervals=valid;
  if(!intervals.length)return {meanFps:0,meanMs:0,p95Ms:0,p95EquivalentFps:0,samples:0,ignoredSamples};
  const sorted=[...intervals].sort((a,b)=>a-b),meanMs=intervals.reduce((a,b)=>a+b,0)/intervals.length;
  const p95Ms=sorted[Math.ceil(.95*sorted.length)-1];
  return {meanFps:1000/meanMs,meanMs,p95Ms,p95EquivalentFps:1000/p95Ms,samples:intervals.length,ignoredSamples};
}

// CPU submissions and queue completion latency do not establish display FPS.
// Keep a held flame explicit even while the ordinary scene continues drawing.
export function frameSubmissionReadout({previous,now,sceneFrames,cpuMs,volume=null}){
  const elapsed=now-previous.now;
  const rate=(current,before)=>elapsed>0&&Number.isFinite(current)&&Number.isFinite(before)&&current>=before
    ?(current-before)*1000/elapsed:null;
  const sceneSubmissionsPerSecond=rate(sceneFrames,previous.sceneFrames);
  const flameSubmissionsPerSecond=volume?.active?rate(volume.frameCount,previous.volumeFrames):null;
  const shown=value=>value===null?'…':value.toFixed(0);
  const parts=[shown(sceneSubmissionsPerSecond)+' scene submits/s'];
  if(volume?.active||volume?.error){
    const held=volume.lightingSettingsPending||volume.lightingRebuildPending;
    const paused=volume.lookFreeze||volume.simulationPaused;
    parts.push(volume.error?'flame stopped':paused?'flame paused':held?'flame held':shown(flameSubmissionsPerSecond)+' flame submits/s');
    if(held)parts.push('lighting pending');
    const timing=volume.timing;
    if(timing?.queueProbePending&&Number.isFinite(timing.queueProbeStartedAt))
      parts.push('GPU pending '+Math.max(0,now-timing.queueProbeStartedAt).toFixed(0)+'ms');
    else if(Number.isFinite(timing?.queueDoneMs))parts.push('last GPU queue '+timing.queueDoneMs.toFixed(0)+'ms');
  }
  parts.push(Number(cpuMs).toFixed(1)+'ms app CPU');
  return {sceneSubmissionsPerSecond,flameSubmissionsPerSecond,text:parts.join(' · '),
    next:{now,sceneFrames,volumeFrames:volume?.active?volume.frameCount:null}};
}
