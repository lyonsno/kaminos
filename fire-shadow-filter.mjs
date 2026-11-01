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

// Four nearest distance reads, compared separately before bilinear weighting.
// Directions beyond a face edge are sampled through the adjacent cube face.
export function cubeComparisonFootprint(ray,resolution){
  const a=ray.map(Math.abs),axis=a[0]>=a[1]&&a[0]>=a[2]?0:a[1]>=a[2]?1:2;
  const other=axis===0?[1,2]:axis===1?[0,2]:[0,1];
  const p=other.map(i=>(ray[i]/a[axis]+1)*resolution/2-.5),base=p.map(Math.floor),f=p.map((v,i)=>v-base[i]);
  return [0,1].flatMap(y=>[0,1].map(x=>{const d=[0,0,0];d[axis]=ray[axis]>=0?1:-1;
    other.forEach((i,j)=>d[i]=(base[j]+(j===0?x:y)+.5)*2/resolution-1);
    const length=Math.hypot(...d);return {direction:d.map(v=>v/length),weight:(x?f[0]:1-f[0])*(y?f[1]:1-f[1])};}));
}
export function cubeComparisonVisibility({sampleDepth,ray,delta,normal,bias,resolution}){
  const {Fn,vec2,vec3,float}=THREE.TSL;
  return Fn(()=>{
    const a=ray.abs().toVar(),isX=a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z)),isY=isX.not().and(a.y.greaterThanEqual(a.z));
    const major=a.x.max(a.y).max(a.z).max(1e-8).toVar();
    const uv=isX.select(ray.yz,isY.select(vec2(ray.x,ray.z),ray.xy)).div(major).toVar();
    const p=uv.add(1).mul(float(resolution).div(2)).sub(.5).toVar(),base=p.floor().toVar(),f=p.sub(base).toVar();
    const sign=isX.select(ray.x,isY.select(ray.y,ray.z)).greaterThanEqual(0).select(1,-1);
    const plane=normal.dot(delta).toVar(),lit=float(0).toVar(),weight=float(0).toVar();
    for(const y of [0,1])for(const x of [0,1]){
      const q=base.add(vec2(x+.5,y+.5)).mul(float(2).div(resolution)).sub(1).toVar();
      const d=isX.select(vec3(sign,q.x,q.y),isY.select(vec3(q.x,sign,q.y),vec3(q.x,q.y,sign))).normalize().toVar();
      const denominator=normal.dot(d),valid=plane.mul(denominator).greaterThan(0);
      const receiver=plane.abs().div(denominator.abs().max(1e-6));
      const w=(x?f.x:float(1).sub(f.x)).mul(y?f.y:float(1).sub(f.y));
      lit.addAssign(valid.select(sampleDepth(d).greaterThanEqual(receiver.sub(bias)).select(w,0),0));
      weight.addAssign(valid.select(w,0));
    }
    return weight.greaterThan(0).select(lit.div(weight.max(1e-8)),0);
  })();
}

// Fixed sample pattern, no temporal history or additional cube rendering.
// Compare taps against the receiver plane: using the center's radial distance
// at every tap would treat a tilted floor as a sphere and cause grazing acne.
export function radialSoftVisibility({sampleDepth,delta,normal,distance,bias,sourceRadius,softness,hardVisibility,complementary,filterCoordinates=THREE.TSL.screenCoordinate,filterDifferential=null,screenAligned=true,blockerSamples=9,filterSamples=16,filterPattern=null,edgeFilter=null,resolution=256,runtimeQuality=null}) {
  if(!runtimeQuality&&filterPattern&&filterPattern.count!==filterSamples)throw Error('shadow filter pattern count mismatch');
  const blockers=runtimeQuality?null:shadowDisk(blockerSamples,true),samples=runtimeQuality?null:shadowDisk(filterSamples),{bands,sectors}=shadowStrata(filterSamples);
  const {Fn,If,Loop,int,float,vec2,vec3,dFdx,screenCoordinate}=THREE.TSL;
  return Fn(()=>{
    const direction=delta.div(distance.max(1e-5));
    const compare=ray=>cubeComparisonVisibility({sampleDepth,ray,delta,normal,bias,resolution});
    const result=hardVisibility.toVar();
    if(edgeFilter)If(edgeFilter.and(softness.lessThanEqual(0)),()=>result.assign(compare(direction)));
    If(softness.greaterThan(0),()=>{
    const radius=sourceRadius.max(0).mul(softness);
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
      return {depth:sampleDepth(ray),receiver,valid,ray};
    };
    const blockerSum=float(0).toVar(),blockerCount=float(0).toVar(),searchRadius=radius.div(distance.max(1e-5));
    const visitBlocker=xy=>{const p=tap(xy,searchRadius),blocked=p.valid.and(p.depth.lessThan(p.receiver.sub(bias)));blockerSum.addAssign(blocked.select(p.depth,0));blockerCount.addAssign(blocked.select(1,0));};
    if(runtimeQuality)Loop({start:int(0),end:runtimeQuality.blockerSamples,type:'int',condition:'<'},({i})=>{
      const n=float(runtimeQuality.blockerSamples).sub(1).max(1),j=float(i).sub(1),r=j.add(.5).div(n).max(0).sqrt(),a=j.mul(2.399963229728653);
      visitBlocker(i.equal(0).select(vec2(0),vec2(r.mul(a.cos()),r.mul(a.sin()))));
    });else for(const xy of blockers)visitBlocker(xy);
    result.assign(1);
    // No detected blocker is the lit side of the same texel edge. Filter it
    // too, otherwise that side jumps from one to the first fractional tap.
    if(edgeFilter)If(edgeFilter.and(blockerCount.equal(0)),()=>result.assign(compare(direction)));
    If(blockerCount.greaterThan(0),()=>{
    const blocker=blockerSum.div(blockerCount.max(1)).max(1e-5);
    const width=radius.mul(distance.sub(blocker).max(0)).div(blocker.mul(distance.max(1e-5)));
    const lit=float(0).toVar(),weight=float(0).toVar();
    const visitFilter=(index,xy)=>{
      let complementaryOffset;
      if(!runtimeQuality&&filterPattern?.node)complementaryOffset=filterPattern.node.element(phaseY.mul(4).add(phaseX).mul(filterSamples).add(index).toUint()).xy;
      else {
        const sectorsNode=runtimeQuality?float(runtimeQuality.sectors):float(sectors),bandsNode=runtimeQuality?float(runtimeQuality.bands):float(bands);
        const band=runtimeQuality?float(index).div(sectorsNode).floor():float(Math.floor(index/sectors)),sector=runtimeQuality?float(index).mod(sectorsNode):float(index%sectors);
        const area=phaseY.add(sector.mul(3)).add(band).mod(4).add(.5).div(4).add(band).div(bandsNode);
        const angle=phaseX.add(band.mul(3)).add(sector).mod(4).add(.5).div(4).add(sector).mul(float(2*Math.PI).div(sectorsNode));
        const radius=area.sqrt();complementaryOffset=vec2(radius.mul(angle.cos()),radius.mul(angle.sin()));
      }
      const sample=complementary.select(complementaryOffset,Array.isArray(xy)?vec2(...xy):xy);
      const p=tap(sample,width,filterTangent);
      const visibility=float(0).toVar(),nearest=()=>visibility.assign(p.depth.greaterThanEqual(p.receiver.sub(bias)).select(1,0));
      if(edgeFilter)If(edgeFilter,()=>visibility.assign(compare(p.ray))).Else(nearest);else nearest();
      lit.addAssign(p.valid.select(visibility,0));weight.addAssign(p.valid.select(1,0));
    };
    if(runtimeQuality)Loop({start:int(0),end:runtimeQuality.filterSamples,type:'int',condition:'<'},({i})=>{
      const r=float(i).add(.5).div(float(runtimeQuality.filterSamples)).sqrt(),a=float(i).mul(2.399963229728653);visitFilter(i,vec2(r.mul(a.cos()),r.mul(a.sin())));
    });else for(const [index,xy]of samples.entries())visitFilter(index,xy);
    result.assign(weight.greaterThan(0).select(lit.div(weight.max(1)),hardVisibility));
    });
    });
    return result;
  })();
}
