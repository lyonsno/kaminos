import * as THREE from './lib/three.webgpu.js';

// PCSS geometry, expressed as angular offsets for a radial-distance cube.
// NVIDIA: developer.download.nvidia.com/assets/gamedev/docs/PCSS_Integration.pdf
export function penumbraAngularRadius(sourceRadius,receiverDistance,blockerDistance) {
  if(![sourceRadius,receiverDistance,blockerDistance].every(Number.isFinite)||sourceRadius<0||receiverDistance<=0||blockerDistance<=0)throw Error('finite nonnegative source radius and positive distances required');
  return sourceRadius*Math.max(0,receiverDistance-blockerDistance)/(blockerDistance*receiverDistance);
}
export function receiverPlaneDistance(delta,normal,direction) {
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),plane=dot(delta,normal),denominator=dot(direction,normal);
  return plane*denominator>0?plane/denominator:null;
}
export const BLOCKER_DISK=Object.freeze([[0,0],...Array.from({length:8},(_,i)=>{
  const r=Math.sqrt((i+.5)/8),a=i*2.399963229728653;return Object.freeze([r*Math.cos(a),r*Math.sin(a)]);
})]);
export const FILTER_DISK=Object.freeze(Array.from({length:16},(_,i)=>{
  const r=Math.sqrt((i+.5)/16),a=i*2.399963229728653;return Object.freeze([r*Math.cos(a),r*Math.sin(a)]);
}));

// Fixed sample pattern, no temporal history or additional cube rendering.
// Compare taps against the receiver plane: using the center's radial distance
// at every tap would treat a tilted floor as a sphere and cause grazing acne.
export function radialSoftVisibility({sampleDepth,delta,normal,distance,bias,sourceRadius,softness,hardVisibility}) {
  const {Fn,If,float,vec3}=THREE.TSL;
  return Fn(()=>{
    const result=hardVisibility.toVar();
    If(softness.greaterThan(0),()=>{
    const direction=delta.div(distance.max(1e-5)),radius=sourceRadius.max(0).mul(softness);
    const axis=direction.y.abs().lessThan(.9).select(vec3(0,1,0),vec3(1,0,0));
    const tangent=axis.cross(direction).normalize(),bitangent=direction.cross(tangent),plane=normal.dot(delta);
    const tap=(xy,width)=>{
      const ray=direction.add(tangent.mul(width.mul(xy[0]))).add(bitangent.mul(width.mul(xy[1]))).normalize();
      const denominator=normal.dot(ray),valid=plane.mul(denominator).greaterThan(0);
      const receiver=plane.abs().div(denominator.abs().max(1e-6));
      return {depth:sampleDepth(ray),receiver,valid};
    };
    const blockerSum=float(0).toVar(),blockerCount=float(0).toVar(),searchRadius=radius.div(distance.max(1e-5));
    for(const xy of BLOCKER_DISK){
      const p=tap(xy,searchRadius),blocked=p.valid.and(p.depth.lessThan(p.receiver.sub(bias)));
      blockerSum.addAssign(blocked.select(p.depth,0));blockerCount.addAssign(blocked.select(1,0));
    }
    result.assign(1);
    If(blockerCount.greaterThan(0),()=>{
    const blocker=blockerSum.div(blockerCount.max(1)).max(1e-5);
    const width=radius.mul(distance.sub(blocker).max(0)).div(blocker.mul(distance.max(1e-5)));
    const lit=float(0).toVar(),weight=float(0).toVar();
    for(const xy of FILTER_DISK){
      const p=tap(xy,width);
      lit.addAssign(p.valid.select(p.depth.greaterThanEqual(p.receiver.sub(bias)).select(1,0),0));
      weight.addAssign(p.valid.select(1,0));
    }
    result.assign(weight.greaterThan(0).select(lit.div(weight.max(1)),hardVisibility));
    });
    });
    return result;
  })();
}
