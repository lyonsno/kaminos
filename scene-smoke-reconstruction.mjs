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
    {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
  ]});
  let last=null,group=null;
  return {layout, update(frame) {
    const r=frame.smokeReconstruction;
    if(!frame.texture || r?.identity!=='geometry-visible-trilinear-v1' || !r.cellIndices || !r.triangles) throw new Error('distributed smoke requires current reconstruction resources');
    const handles=[frame.texture,r.cellIndices,r.triangles];
    if(!last || handles.some((h,i)=>h!==last[i])) {
      group=device.createBindGroup({layout,entries:[{binding:0,resource:frame.texture.createView()},
        {binding:1,resource:{buffer:r.cellIndices}},{binding:2,resource:{buffer:r.triangles}}]});
      last=handles;
    }
    return group;
  }};
}

export const DISTRIBUTED_SMOKE_WGSL=`
@group(2) @binding(0) var distributedIncident:texture_3d<f32>;
@group(2) @binding(1) var<storage,read> smokeReconstructionCells:array<u32>;
struct SmokeReconstructionTriangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
@group(2) @binding(2) var<storage,read> smokeReconstructionTriangles:array<SmokeReconstructionTriangle>;
fn smokeReceiverVisible(p:vec3<f32>,receiver:vec3<f32>,start:u32,count:u32)->bool {
  let delta=receiver-p;
  if(dot(delta,delta)==0.0){return true;}
  for(var i=0u;i<count;i++) {
    let tri=smokeReconstructionTriangles[smokeReconstructionCells[start+i]];
    let h=cross(delta,tri.e2.xyz);let det=dot(tri.e1.xyz,h);
    if(abs(det)<=1e-12*length(tri.e1.xyz)*length(tri.e2.xyz)*length(delta)){continue;}
    let s=p-tri.a.xyz;let u=dot(s,h)/det;let q=cross(s,tri.e1.xyz);let v=dot(delta,q)/det;
    let t=dot(tri.e2.xyz,q)/det;
    // Conservative f32 edge tolerance prevents cracks at shared triangle edges.
    let edgeTolerance=0.000002;
    if(u>=-edgeTolerance&&v>=-edgeTolerance&&u+v<=1.0+edgeTolerance&&t>=0.0&&t<=1.0){return false;}
  }
  return true;
}
fn distributedMeanIncident(p:vec3<f32>)->vec3<f32> {
  let dims=textureDimensions(distributedIncident);let pitch=2.0/f32(dims.x);
  let lo=vec3<f32>(-1.0);let hi=lo+vec3<f32>(dims)*pitch;
  if(any(p<lo)||any(p>hi)){return vec3<f32>(0.0);}
  let q=(p-lo)/pitch-vec3<f32>(0.5);let base=vec3<i32>(floor(q));let w=fract(q);
  let bin=vec3<u32>(clamp(base+vec3<i32>(1),vec3<i32>(0),vec3<i32>(dims)));
  let binDims=dims+vec3<u32>(1u);let id=bin.x+binDims.x*(bin.y+binDims.y*bin.z);
  let start=smokeReconstructionCells[id*2u];let count=smokeReconstructionCells[id*2u+1u];
  var sum=vec3<f32>(0.0);var weightSum=0.0;
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
    let weight=select(1.0-w.x,w.x,x==1u)*select(1.0-w.y,w.y,y==1u)*select(1.0-w.z,w.z,z==1u);
    if(weight==0.0){continue;}
    let c=clamp(base+vec3<i32>(i32(x),i32(y),i32(z)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
    let receiver=lo+(vec3<f32>(c)+vec3<f32>(0.5))*pitch;
    if(count>0u&&!smokeReceiverVisible(p,receiver,start,count)){continue;}
    sum+=textureLoad(distributedIncident,c,0).rgb*weight;weightSum+=weight;
  }}}
  if(weightSum==0.0){return vec3<f32>(0.0);}
  return sum/weightSum;
}`;
