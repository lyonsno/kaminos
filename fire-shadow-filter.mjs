import * as THREE from './lib/three.webgpu.js';
import {positiveSampleCount,shadowStrata} from './fire-shadow-quality.mjs';
import {complementaryDiskSample} from './fire-shadow-sampling.mjs';

// One immutable, padded uniform table shared by all source graphs. Only the
// disk offsets are invariant: receiver basis, penumbra and plane tests are not.
export function createShadowFilterPattern(count,{maxUniformBufferBindingSize}={}) {
  positiveSampleCount(count);
  const bytes=16*count*16;
  if(!Number.isFinite(maxUniformBufferBindingSize)||bytes>maxUniformBufferBindingSize)
    return {count,bytes,route:'arithmetic',reason:Number.isFinite(maxUniformBufferBindingSize)?'uniform-binding-capacity':'device-limit-unavailable',node:null};
  const values=new Float32Array(count*16*4);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)for(let i=0;i<count;i++)
    values.set(complementaryDiskSample(i,x,y,count),((y*4+x)*count+i)*4);
  return {count,bytes,route:'uniform',reason:null,node:THREE.TSL.buffer(values,'vec4',count*16)};
}

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
export function shadowDisk(count,center=false){
  positiveSampleCount(count);
  const n=count-(center?1:0);
  return Object.freeze([...(center?[Object.freeze([0,0])]:[]),...Array.from({length:n},(_,i)=>{
    const r=Math.sqrt((i+.5)/n),a=i*2.399963229728653;return Object.freeze([r*Math.cos(a),r*Math.sin(a)]);
  })]);
}
export const BLOCKER_DISK=shadowDisk(9,true);
export const FILTER_DISK=shadowDisk(16);

// Fixed sample pattern, no temporal history or additional cube rendering.
// Compare taps against the receiver plane: using the center's radial distance
// at every tap would treat a tilted floor as a sphere and cause grazing acne.
export function radialSoftVisibility({sampleDepth,delta,normal,distance,bias,sourceRadius,softness,hardVisibility,complementary,filterCoordinates=THREE.TSL.screenCoordinate,filterDifferential=null,screenAligned=true,blockerSamples=9,filterSamples=16,filterPattern=null}) {
  if(filterPattern&&filterPattern.count!==filterSamples)throw Error('shadow filter pattern count mismatch');
  const blockers=shadowDisk(blockerSamples,true),samples=shadowDisk(filterSamples),{bands,sectors}=shadowStrata(filterSamples);
  const {Fn,If,float,vec2,vec3,dFdx,screenCoordinate}=THREE.TSL;
  return Fn(()=>{
    const result=hardVisibility.toVar();
    If(softness.greaterThan(0),()=>{
    const direction=delta.div(distance.max(1e-5)),radius=sourceRadius.max(0).mul(softness);
    const axis=direction.y.abs().lessThan(.9).select(vec3(0,1,0),vec3(1,0,0));
    const tangent=axis.cross(direction).normalize(),plane=normal.dot(delta);
    // Align filter strata with the receiver-to-screen differential, while the
    // circular angular support and blocker search stay exactly the same.
    let filterTangent=tangent;
    if(screenAligned){
      const differential=filterDifferential??dFdx(direction),projected=differential.sub(direction.mul(direction.dot(differential)));
      const magnitude2=projected.dot(projected);
      filterTangent=complementary.and(magnitude2.greaterThan(1e-12)).select(projected.div(magnitude2.max(1e-12).sqrt()),tangent);
    }
    const phaseX=filterCoordinates.x.floor().mod(4),phaseY=filterCoordinates.y.floor().mod(4);
    const tap=(xy,width,basis=tangent)=>{
      const bitangent=direction.cross(basis);
      const ray=direction.add(basis.mul(width.mul(xy.x??xy[0]))).add(bitangent.mul(width.mul(xy.y??xy[1]))).normalize();
      const denominator=normal.dot(ray),valid=plane.mul(denominator).greaterThan(0);
      const receiver=plane.abs().div(denominator.abs().max(1e-6));
      return {depth:sampleDepth(ray),receiver,valid};
    };
    const blockerSum=float(0).toVar(),blockerCount=float(0).toVar(),searchRadius=radius.div(distance.max(1e-5));
    for(const xy of blockers){
      const p=tap(xy,searchRadius),blocked=p.valid.and(p.depth.lessThan(p.receiver.sub(bias)));
      blockerSum.addAssign(blocked.select(p.depth,0));blockerCount.addAssign(blocked.select(1,0));
    }
    result.assign(1);
    If(blockerCount.greaterThan(0),()=>{
    const blocker=blockerSum.div(blockerCount.max(1)).max(1e-5);
    const width=radius.mul(distance.sub(blocker).max(0)).div(blocker.mul(distance.max(1e-5)));
    const lit=float(0).toVar(),weight=float(0).toVar();
    for(const [index,xy] of samples.entries()){
      let complementaryOffset;
      if(filterPattern?.node)complementaryOffset=filterPattern.node.element(phaseY.mul(4).add(phaseX).mul(filterSamples).add(index).toUint()).xy;
      else {
      const band=Math.floor(index/sectors),sector=index%sectors;
      const area=phaseY.add(sector*3+band).mod(4).add(.5).div(4).add(band).div(bands);
      const angle=phaseX.add(band*3+sector).mod(4).add(.5).div(4).add(sector).mul(2*Math.PI/sectors);
      const radius=area.sqrt();
      complementaryOffset=vec2(radius.mul(angle.cos()),radius.mul(angle.sin()));
      }
      const sample=complementary.select(complementaryOffset,vec2(...xy));
      const p=tap(sample,width,filterTangent);
      lit.addAssign(p.valid.select(p.depth.greaterThanEqual(p.receiver.sub(bias)).select(1,0),0));
      weight.addAssign(p.valid.select(1,0));
    }
    result.assign(weight.greaterThan(0).select(lit.div(weight.max(1)),hardVisibility));
    });
    });
    return result;
  })();
}
