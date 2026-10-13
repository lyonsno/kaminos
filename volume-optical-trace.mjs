export const OPTICAL_TRACE_IDENTITY = 'camera-mode2-ordered-optical-trace-v0';
export const OPTICAL_TRACE_STRIDE = 32;

export function createOpticalCaptureOwner() {
  let owner=null;
  return {
    active:()=>owner,
    async run(name, capture) {
      if(owner!==null)return {ok:false,phase:'admission',failurePhase:'session-custody',reason:'another-optical-capture-active',owner};
      owner=name;
      try { return await capture(); } finally { owner=null; }
    },
  };
}

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
  // Thermal spectra retain signed linear-sRGB coordinates until display mapping.
  source.forEach(v => { if (!Number.isFinite(v)) throw new Error('source must be finite'); });
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
  let misses=0,emittingRows=0;
  for(let r=0;r<plan.rayCount;r++)for(let s=0;s<plan.sampleCount;s++) {
    const at=(r*plan.sampleCount+s)*OPTICAL_TRACE_STRIDE;
    if(values[at+3]!==1)throw new Error(`unwritten optical trace row ${r}:${s}`);
    if(values[at]!==plan.firstRay+r||values[at+1]!==plan.sampleOffset+s)throw new Error('unordered optical trace');
    for(let i=0;i<OPTICAL_TRACE_STRIDE;i++)if(!Number.isFinite(values[at+i]))throw new Error('nonfinite optical trace');
    if(values[at+2]!==values[r*plan.sampleCount*OPTICAL_TRACE_STRIDE+2])throw new Error('mixed hit/miss optical ray');
    if(values[at+2]===0){misses++;continue;}
    if(values[at+2]!==1||values[at+4]<values[at+5]||values[at+4]>values[at+6])throw new Error('invalid clipped optical trace position');
    finiteNonnegative(values[at+16],`ray ${values[at]} sample ${values[at+1]} sigma=${values[at+16]}`);
    if(values[at+17]>0||values[at+18]>0||values[at+19]>0)emittingRows++;
  }
  return {rowCount:plan.rowCount,misses,validRows:plan.rowCount-misses,emittingRows};
}

export function compareOpticalTraces(full, lean, plan) {
  if(plan.sampleOffset!==0||plan.sampleCount!==plan.subdivisions+1)throw new Error('agreement requires complete rays');
  validateTraceRows(full,plan);validateTraceRows(lean,plan);
  const criteria={identity:'optical-numerical-agreement-v2',coefficientAbsolute:1e-7,
    coefficientRelative:1e-5,cellFractionAbsolute:8e-6,transferAbsolute:1e-6,
    supportActiveThreshold:Math.fround(0.0001),supportAgreement:'consumed-predicate',
    authority:'numerical agreement on retained samples, not bitwise equality or teacher convergence'};
  const fields=Array.from({length:32},(_,index)=>({index,differences:0,violations:0,maxAbsolute:0}));
  for(let at=0;at<full.length;at++) {
    const field=at%32,a=full[at],b=lean[at],delta=Math.abs(a-b);
    const tolerance=(field>=16&&field<=22)||field===26 ?
      criteria.coefficientAbsolute+criteria.coefficientRelative*Math.max(Math.abs(a),Math.abs(b)) :
      field>=28&&field<=30 ? criteria.cellFractionAbsolute : 0;
    const stats=fields[field];
    if(delta>0)stats.differences++;
    // The shader consumes support as a threshold test, not a magnitude.
    if(field===25 ? (a>criteria.supportActiveThreshold)!==(b>criteria.supportActiveThreshold) : delta>tolerance)stats.violations++;
    stats.maxAbsolute=Math.max(stats.maxAbsolute,delta);
  }
  const transferMaxAbsolute=[0,0,0,0];
  let transferViolations=0,comparedRays=0;
  for(let ray=0;ray<plan.rayCount;ray++) {
    const base=ray*plan.sampleCount*32;
    if(full[base+2]!==lean[base+2]||!full[base+2])continue;
    const transfers=[full,lean].map(values=>{
      const probes=Array.from({length:plan.sampleCount},(_,s)=>{
        const at=base+s*32;
        if(values[at+2]!==1)throw new Error('partial hit ray in agreement');
        return {sigma:values[at+16],emission:Array.from(values.slice(at+17,at+20)),
          scattered:Array.from(values.slice(at+20,at+23))};
      });
      return integrateProbes(probes,values[base+6]-values[base+5]);
    });
    comparedRays++;
    transfers[0].forEach((v,i)=>{
      const delta=Math.abs(v-transfers[1][i]);
      if(!Number.isFinite(delta))throw new Error('nonfinite agreement transfer');
      transferMaxAbsolute[i]=Math.max(transferMaxAbsolute[i],delta);
      if(delta>criteria.transferAbsolute)transferViolations++;
    });
  }
  return {ok:fields.every(f=>f.violations===0)&&transferViolations===0,
    criteria,fields,comparedRays,transferMaxAbsolute,transferViolations};
}
