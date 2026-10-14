// Match the exact solver uniform layout. Only world pose components may vary.
export const LIVE_LIQUID_INLET_FLOATS = 20;
const poseComponents = new Set([0,1,2,4,5,6,8,9,10]);
export function canPreserveLiquidReleaseEpoch(previous,next) {
  const a=previous?.data,b=next?.data,old=previous?.normalized,current=next?.normalized;
  if(!(a instanceof Float32Array)||!(b instanceof Float32Array)||a.length!==b.length
    || a.length%LIVE_LIQUID_INLET_FLOATS!==0 || !Array.isArray(old?.inlets)||!Array.isArray(current?.inlets)
    || old.inlets.length!==current.inlets.length || old.sourceAuthority!==current.sourceAuthority)return false;
  if(old.inlets.some((inlet,i)=>inlet.id!==current.inlets[i].id))return false;
  for(let i=0;i<a.length;i++) {
    if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))return false;
    if(!poseComponents.has(i%LIVE_LIQUID_INLET_FLOATS)&&a[i]!==b[i])return false;
  }
  return true;
}
