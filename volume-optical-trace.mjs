export const OPTICAL_TRACE_IDENTITY = 'camera-mode2-ordered-optical-trace-v0';
export const OPTICAL_TRACE_STRIDE = 32;

export function validateTraceSpecialization(requested, receipt) {
  const expected = {auto:'lean-emissive-raymarch-v0','force-full':'full-authored-raymarch-v0'}[requested];
  if (!expected || receipt?.effective !== expected) {
    throw new Error(`unexpected trace specialization: ${requested} -> ${JSON.stringify(receipt)}`);
  }
}

function finiteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite nonnegative`);
}

export function constantTransfer(probe, h) {
  finiteNonnegative(h, 'h');
  finiteNonnegative(probe.sigma, 'sigma');
  const source = probe.emission.map((v,i) => v + probe.scattered[i]);
  source.forEach(v => finiteNonnegative(v, 'source'));
  const tau = probe.sigma*h;
  const integral = probe.sigma === 0 ? h : -Math.expm1(-tau)/probe.sigma;
  return [...source.map(v => v*integral), Math.exp(-tau)];
}

export function composeTransfers(a, b) {
  return [a[0]+a[3]*b[0], a[1]+a[3]*b[1], a[2]+a[3]*b[2], a[3]*b[3]];
}

export function integrateProbes(probes, h) {
  if (probes.length < 2) throw new Error('at least two probes required');
  finiteNonnegative(h, 'h');
  let transfer = [0,0,0,1];
  for(let i=1;i<probes.length;i++) {
    const a=probes[i-1], b=probes[i];
    const average={sigma:(a.sigma+b.sigma)/2,
      emission:a.emission.map((v,k)=>(v+b.emission[k])/2),
      scattered:a.scattered.map((v,k)=>(v+b.scattered[k])/2)};
    transfer=composeTransfers(transfer,constantTransfer(average,h/(probes.length-1)));
  }
  return transfer;
}

export function estimateProbeError(probes, h) {
  if (![3,5].includes(probes.length)) throw new Error('three or five probes required');
  const fine=integrateProbes(probes,h);
  const coarse=integrateProbes(probes.filter((_,i)=>i%2===0),h);
  return {fine,coarse,error:fine.map((v,i)=>Math.abs(v-coarse[i]))};
}

export function opticalProbeFeatures(probes, {h, gridPitch, direction, cellFraction}) {
  if (![3,5].includes(probes.length)) throw new Error('three or five probes required');
  if (!(gridPitch>0)) throw new Error('positive grid pitch required');
  const result=probes.flatMap(p=>[p.sigma*h,...p.emission.map(v=>v*h),...p.scattered.map(v=>v*h),...p.flags]);
  result.push(h,h/gridPitch,...direction,...cellFraction);
  if(result.length!==9*probes.length+8 || !result.every(Number.isFinite)) throw new Error('invalid optical feature shape or values');
  return result;
}

export function traceChunkPlan({firstRay,rayCount,sampleOffset,sampleCount,subdivisions,width,height,maxBytes}) {
  for(const [key,v] of Object.entries({firstRay,rayCount,sampleOffset,sampleCount,subdivisions,width,height})) {
    if(!Number.isSafeInteger(v)||v<0)throw new Error(`${key} must be a nonnegative integer`);
  }
  if(!width||!height||!subdivisions||!rayCount||!sampleCount)throw new Error('positive trace dimensions required');
  if(firstRay+rayCount>width*height)throw new Error('ray range exceeds viewport');
  if(sampleOffset+sampleCount>subdivisions+1)throw new Error('sample range exceeds subdivisions');
  const rowCount=rayCount*sampleCount,byteLength=rowCount*OPTICAL_TRACE_STRIDE*4;
  if(!Number.isSafeInteger(byteLength)||!Number.isFinite(maxBytes)||byteLength>maxBytes)throw new Error('trace chunk exceeds device storage limit; split without dropping rows');
  return {firstRay,rayCount,sampleOffset,sampleCount,subdivisions,width,height,rowCount,byteLength};
}

export function validateTraceRows(values, plan) {
  if(!(values instanceof Float32Array)||values.length!==plan.rowCount*OPTICAL_TRACE_STRIDE)throw new Error('partial optical trace');
  let misses=0;
  for(let r=0;r<plan.rayCount;r++)for(let s=0;s<plan.sampleCount;s++) {
    const at=(r*plan.sampleCount+s)*OPTICAL_TRACE_STRIDE;
    if(values[at+3]!==1)throw new Error(`unwritten optical trace row ${r}:${s}`);
    if(values[at]!==plan.firstRay+r||values[at+1]!==plan.sampleOffset+s)throw new Error('unordered optical trace');
    for(let i=0;i<OPTICAL_TRACE_STRIDE;i++)if(!Number.isFinite(values[at+i]))throw new Error('nonfinite optical trace');
    if(values[at+2]===0){misses++;continue;}
    if(values[at+2]!==1||values[at+4]<values[at+5]||values[at+4]>values[at+6])throw new Error('invalid clipped optical trace position');
    for(let i=16;i<23;i++)finiteNonnegative(values[at+i],'optical coefficient');
  }
  return {rowCount:plan.rowCount,misses,validRows:plan.rowCount-misses};
}
