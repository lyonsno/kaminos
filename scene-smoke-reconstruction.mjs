export function buildSmokeReconstructionCells(geometry, dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length !== 3 || !dimensions.every(n=>Number.isInteger(n)&&n>0)) throw new Error('positive smoke dimensions required');
  const {triangles, triangleCount} = geometry;
  if (!(triangles instanceof Float32Array) || !Number.isInteger(triangleCount) || triangleCount<0 || triangles.length<triangleCount*12) throw new Error('packed static triangles required');
  const pitch=2/dimensions[0], binDims=dimensions.map(n=>n+1);
  const count=binDims.reduce((a,b)=>a*b,1), counts=new Uint32Array(count);
  const ranges=new Int32Array(triangleCount*6).fill(-1);
  const index=(x,y,z)=>x+binDims[0]*(y+binDims[1]*z);
  for(let t=0;t<triangleCount;t++) {
    const at=t*12, range=[];
    for(let axis=0;axis<3;axis++) {
      const a=triangles[at+axis], b=a+triangles[at+4+axis], c=a+triangles[at+8+axis];
      if (![a,b,c].every(Number.isFinite)) throw new Error('finite packed triangle coordinates required');
      const lo=Math.min(a,b,c),hi=Math.max(a,b,c),domainHi=-1+dimensions[axis]*pitch;
      if(hi < -1 || lo > domainHi) {range.length=0;break;}
      // Include both adjacent bins when a triangle lies on their shared face.
      range.push(Math.max(0,Math.ceil((lo+1)/pitch-.5)),Math.min(dimensions[axis],Math.floor((hi+1)/pitch+.5)));
    }
    if(!range.length) continue;
    ranges.set(range,t*6);
    for(let z=range[4];z<=range[5];z++)for(let y=range[2];y<=range[3];y++)for(let x=range[0];x<=range[1];x++)counts[index(x,y,z)]++;
  }
  const references=counts.reduce((a,b)=>a+b,0);
  const words=new Uint32Array(count*2+references),next=new Uint32Array(count);
  let offset=count*2,maxCandidates=0,emptyCells=0;
  for(let i=0;i<count;i++) {
    words[i*2]=next[i]=offset;words[i*2+1]=counts[i];offset+=counts[i];
    maxCandidates=Math.max(maxCandidates,counts[i]);if(!counts[i])emptyCells++;
  }
  for(let t=0;t<triangleCount;t++) {
    const at=t*6;if(ranges[at]<0)continue;
    for(let z=ranges[at+4];z<=ranges[at+5];z++)for(let y=ranges[at+2];y<=ranges[at+3];y++)for(let x=ranges[at];x<=ranges[at+1];x++)words[next[index(x,y,z)]++]=t;
  }
  return {words,dimensions:binDims,triangleReferences:references,maxCandidates,emptyCells};
}

export function createDistributedSmokeBindings(device) {
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},
    {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
  ]});
  let last=null,group=null;
  return {layout, update(frame) {
    const r=frame.smokeReconstruction;
    if(!frame.texture || r?.identity!=='prepared-clear-box-support-v3' || !r.texture || !r.masks || !Number.isInteger(r.staticPreparations) || r.staticPreparations<1 || !Number.isInteger(r.updates) || r.updates<1) throw new Error('distributed smoke requires current prepared reconstruction resources');
    const handles=[r.texture,r.masks];
    if(!last || handles.some((h,i)=>h!==last[i])) {
      group=device.createBindGroup({layout,entries:[{binding:0,resource:r.texture.createView()},
        {binding:1,resource:{buffer:r.masks}}]});
      last=handles;
    }
    return group;
  }};
}

export const DISTRIBUTED_SMOKE_WGSL=`
@group(2) @binding(0) var distributedIncident:texture_3d<f32>;
@group(2) @binding(1) var<storage,read> smokeBoundaryMasks:array<u32>;
var<private> distributedLastMaskFlags:vec2<f32>;
fn distributedMeanIncident(p:vec3<f32>)->vec3<f32> {
  distributedLastMaskFlags=vec2<f32>(0);
  let dims=textureDimensions(distributedIncident);let pitch=2.0/f32(dims.x);
  let lo=vec3<f32>(-1.0);let hi=lo+vec3<f32>(dims)*pitch;
  if(any(p<lo)||any(p>hi)){distributedLastMaskFlags=vec2<f32>(1,0);return vec3<f32>(0.0);}
  let q=(p-lo)/pitch-vec3<f32>(0.5);let base=vec3<i32>(floor(q));let w=fract(q);
  let nearest=vec3<u32>(clamp(vec3<i32>(floor((p-lo)/pitch)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1)));
  let nearestId=nearest.x+dims.x*(nearest.y+dims.y*nearest.z);
  distributedLastMaskFlags.x=select(0.0,1.0,smokeBoundaryMasks[nearestId]==0u);
  var total=0.0;
  var sum=vec3<f32>(0.0);
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
    let c=clamp(base+vec3<i32>(i32(x),i32(y),i32(z)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
    let donor=textureLoad(distributedIncident,c,0);
    let id=u32(c.x)+dims.x*(u32(c.y)+dims.y*u32(c.z));let packed=smokeBoundaryMasks[id];
    let radius=vec3<f32>(f32(packed&1023u),f32((packed>>10u)&1023u),f32((packed>>20u)&1023u))/1023.0;
    // Evaluate at the clamped domain position so edge replication preserves
    // the ordinary trilinear value instead of counting a donor eight times.
    let delta=abs(w-vec3<f32>(f32(x),f32(y),f32(z)));
    let tent=max(vec3<f32>(0),vec3<f32>(1)-delta/max(radius,vec3<f32>(1e-20)));
    let weight=select(0.0,tent.x*tent.y*tent.z,all(radius>vec3<f32>(0)));
    sum+=donor.rgb*weight;total+=weight;
  }}}
  // Normalize supported samples without amplifying a vanishing tent into a
  // discontinuous bright island. Below quarter coverage, fade continuously.
  distributedLastMaskFlags.y=1.0-min(total,1.0);
  return sum/max(total,0.25);
}`;

// CPU scalar reference for the compact basis, used by numerical invariants.
export function smokeSupportWeight(delta,radius){
  const extents=Array.isArray(radius)?radius:[radius,radius,radius];
  if(extents.some(r=>!(r>0)))return 0;
  return delta.reduce((w,d,i)=>w*Math.max(0,1-Math.abs(d)/extents[i]),1);
}
