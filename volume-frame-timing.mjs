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
