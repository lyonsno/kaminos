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
    if(!frame.texture || r?.identity!=='prepared-geometry-visible-v1' || !r.texture || !r.masks || r.staticPreparations!==1 || r.updates<1) throw new Error('distributed smoke requires current prepared reconstruction resources');
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
fn distributedMeanIncident(p:vec3<f32>)->vec3<f32> {
  let dims=textureDimensions(distributedIncident);let pitch=2.0/f32(dims.x);
  let lo=vec3<f32>(-1.0);let hi=lo+vec3<f32>(dims)*pitch;
  if(any(p<lo)||any(p>hi)){return vec3<f32>(0.0);}
  let q=(p-lo)/pitch-vec3<f32>(0.5);let base=vec3<i32>(floor(q));let w=fract(q);
  let nearest=vec3<u32>(clamp(vec3<i32>(floor((p-lo)/pitch)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1)));
  let nearestId=nearest.x+dims.x*(nearest.y+dims.y*nearest.z);
  // A wall-intersected cell is unknown, not permission to leak light across it.
  if(smokeBoundaryMasks[nearestId]!=0u){return vec3<f32>(0);}
  let bin=vec3<u32>(clamp(base+vec3<i32>(1),vec3<i32>(0),vec3<i32>(dims)));
  let binDims=dims+vec3<u32>(1u);let id=bin.x+binDims.x*(bin.y+binDims.y*bin.z);
  if(smokeBoundaryMasks[dims.x*dims.y*dims.z+id]!=0u){return textureLoad(distributedIncident,vec3<i32>(nearest),0).rgb;}
  var sum=vec3<f32>(0.0);
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
    let weight=select(1.0-w.x,w.x,x==1u)*select(1.0-w.y,w.y,y==1u)*select(1.0-w.z,w.z,z==1u);
    if(weight==0.0){continue;}
    let c=clamp(base+vec3<i32>(i32(x),i32(y),i32(z)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
    sum+=textureLoad(distributedIncident,c,0).rgb*weight;
  }}}
  return sum;
}`;
