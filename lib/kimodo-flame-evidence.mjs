// rAF measures page cadence. Flame counters independently establish advancement.
export const motionFrame=(now,start,fps,count)=>Math.floor(Math.max(0,now-start)/1000*fps)%count;
export function summarizeFlameSpan(samples) {
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
  const sorted = [...gaps].sort((a, b) => a - b);
  const percentile = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  const first = samples[0], last = samples.at(-1);
  const valid = samples.length > 1 && samples.every((s, i) =>
    Number.isFinite(s.t) && (i === 0 || s.t > samples[i - 1].t)
    && s.active === true && /^WebGPU:/.test(s.backend ?? '') && !s.error
    && Number.isSafeInteger(s.frameCount) && Number.isSafeInteger(s.simStepCount)
    && (i === 0 || (s.frameCount >= samples[i - 1].frameCount && s.simStepCount >= samples[i - 1].simStepCount)));
  const frameDelta = valid ? last.frameCount - first.frameCount : null;
  const simStepDelta = valid ? last.simStepCount - first.simStepCount : null;
  // Three equal-time portions buy temporal coverage, not an FPS guarantee.
  // Count only advances whose two observations are inside the same portion.
  const portions=Array.from({length:3},()=>({frameAdvances:0,simAdvances:0}));
  if(valid)for(let i=1;i<samples.length;i++){
    const bucket=s=>Math.min(2,Math.floor(3*(s.t-first.t)/(last.t-first.t)));
    const a=samples[i-1],b=samples[i],p=bucket(b);
    if(bucket(a)===p){portions[p].frameAdvances+=b.frameCount-a.frameCount;portions[p].simAdvances+=b.simStepCount-a.simStepCount;}
  }
  return {
    status: !valid ? 'unverified' : frameDelta > 0 && simStepDelta > 0 ? 'advancing' : 'stalled',
    sampleCount: samples.length, frameDelta, simStepDelta,
    durationMs: first && last ? last.t - first.t : 0,
    pageCadence: { p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1) ?? null },
    hiddenSampleCount: samples.filter(s => s.visibility !== 'visible').length,
    portions, distributedAdvancement:valid&&portions.every(p=>p.frameAdvances>0&&p.simAdvances>0),
  };
}

export function compositionVerdict({ telemetry, baseline, inference, expectedRoute }) {
  if (telemetry?.status !== 'succeeded' || telemetry?.route?.effectiveRouteId !== expectedRoute) return 'generation-unverified';
  if (baseline.status !== 'advancing' || inference.status !== 'advancing' || !inference.distributedAdvancement) return 'flame-unverified';
  if (baseline.hiddenSampleCount || inference.hiddenSampleCount) return 'visibility-confounded';
  return 'coexistence-observed';
}
