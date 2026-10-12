const interval=v=>Array.isArray(v)&&v.length===2&&
  [0,1].every(i=>Number.isFinite(v[i]))&&v[0]<=v[1];

const integral=(sigma,h)=>sigma===0?h:-Math.expm1(-sigma*h)/sigma;

// Envelope of the difference between any two transfer integrals whose sigma
// and signed source remain inside these ranges over the entire segment.
// Callers own that continuous-field premise; shaded corner extrema do not.
export function regionalTransferError(bounds,h) {
  if(!Number.isFinite(h)||h<0||!interval(bounds?.sigma)||bounds.sigma[0]<0||
    !Array.isArray(bounds.source)||bounds.source.length!==3||
    ![0,1,2].every(i=>interval(bounds.source[i])))throw new Error('invalid optical region ranges');
  const [lo,hi]=bounds.sigma;
  const visibleLength=integral(lo,h);
  const transmissionDifference=Math.exp(-lo*h)*-Math.expm1(-(hi-lo)*h);
  // min(a,b) is stable when hi and lo are almost equal: both independently
  // bound the integral of the transmission difference from above.
  const transmissionIntegralBound=Math.min(visibleLength,(hi-lo)*h*h/2);
  return [...bounds.source.map(([a,b])=>(b-a)*visibleLength+
    Math.max(Math.abs(a),Math.abs(b))*transmissionIntegralBound),transmissionDifference];
}

export function validateOpticalRegion(bounds,node) {
  if(!bounds||bounds.start!==node.start||bounds.end!==node.end||
    typeof bounds.authority!=='string'||!bounds.authority.trim()) {
    throw new Error('optical region must name its exact interval and bound authority');
  }
  const error=regionalTransferError(bounds,node.h);
  for(const p of node.probes) {
    const source=p.emission.map((v,k)=>v+p.scattered[k]);
    if(!Number.isFinite(p.sigma)||p.sigma<bounds.sigma[0]||p.sigma>bounds.sigma[1]||
      source.length!==3||source.some((v,k)=>!Number.isFinite(v)||v<bounds.source[k][0]||v>bounds.source[k][1])) {
      throw new Error('observed coefficient contradicts optical region');
    }
  }
  return error;
}
