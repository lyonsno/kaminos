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
    {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},
    {binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
    {binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
  ]});
  const bounds=device.createBuffer({label:'distributed fine exterior receiver bounds',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  let last=null,group=null;
  return {layout, update(frame) {
    const r=frame.smokeReconstruction;
    if(!frame.texture || r?.identity!=='prepared-geometry-visible-v1' || !r.texture || !r.masks || !Number.isInteger(r.staticPreparations) || r.staticPreparations<1 || !Number.isInteger(r.updates) || r.updates<1) throw new Error('distributed smoke requires current prepared reconstruction resources');
    const exterior=frame.exteriorSmokeReconstruction;
    if(exterior&&(exterior.identity!=='prepared-geometry-visible-v1'||!exterior.texture||!exterior.masks||!(exterior.staticPreparations>=1)||!(exterior.updates>=1)))throw Error('exterior reconstruction resources are not current');
    const outer=exterior??r;
    const lo=r.localMin??[-1,-1,-1],hi=r.localMax??[1,3,1],elo=outer.localMin??lo,ehi=outer.localMax??hi;
    device.queue.writeBuffer(bounds,0,new Float32Array([...lo,0,...hi,exterior?1:0,...elo,0,...ehi,0]));
    const handles=[r.texture,r.masks,outer.texture,outer.masks];
    if(!last || handles.some((h,i)=>h!==last[i])) {
      group=device.createBindGroup({layout,entries:[{binding:0,resource:r.texture.createView()},
        {binding:1,resource:{buffer:r.masks}},{binding:2,resource:outer.texture.createView()},
        {binding:3,resource:{buffer:outer.masks}},{binding:4,resource:{buffer:bounds}}]});
      last=handles;
    }
    return group;
  },destroy(){bounds.destroy();}};
}

const lookup=(name,texture,masks,lo,hi)=>`
fn ${name}(p:vec3<f32>)->vec3<f32> {
  distributedLastMaskFlags=vec2<f32>(0);
  let dims=textureDimensions(${texture});let lo=${lo};let hi=${hi};let pitch=(hi-lo)/vec3<f32>(dims);
  if(any(p<lo)||any(p>hi)){distributedLastMaskFlags=vec2<f32>(1,0);return vec3<f32>(0.0);}
  let q=(p-lo)/pitch-vec3<f32>(0.5);let base=vec3<i32>(floor(q));let w=fract(q);
  let nearest=vec3<u32>(clamp(vec3<i32>(floor((p-lo)/pitch)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1)));
  let nearestId=nearest.x+dims.x*(nearest.y+dims.y*nearest.z);
  if(${masks}[nearestId]!=0u){distributedLastMaskFlags=vec2<f32>(1,0);return vec3<f32>(0);}
  let bin=vec3<u32>(clamp(base+vec3<i32>(1),vec3<i32>(0),vec3<i32>(dims)));
  let binDims=dims+vec3<u32>(1u);let id=bin.x+binDims.x*(bin.y+binDims.y*bin.z);
  if(${masks}[dims.x*dims.y*dims.z+id]!=0u){distributedLastMaskFlags=vec2<f32>(0,1);return textureLoad(${texture},vec3<i32>(nearest),0).rgb;}
  var sum=vec3<f32>(0.0);
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
    let weight=select(1.0-w.x,w.x,x==1u)*select(1.0-w.y,w.y,y==1u)*select(1.0-w.z,w.z,z==1u);
    if(weight==0.0){continue;}
    let c=clamp(base+vec3<i32>(i32(x),i32(y),i32(z)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
    sum+=textureLoad(${texture},c,0).rgb*weight;
  }}}
  return sum;
}`;
export const DISTRIBUTED_SMOKE_WGSL=`
@group(2) @binding(0) var distributedIncident:texture_3d<f32>;
@group(2) @binding(1) var<storage,read> smokeBoundaryMasks:array<u32>;
@group(2) @binding(2) var exteriorDistributedIncident:texture_3d<f32>;
@group(2) @binding(3) var<storage,read> exteriorSmokeBoundaryMasks:array<u32>;
struct DistributedBounds{fineLo:vec4<f32>,fineHi:vec4<f32>,outerLo:vec4<f32>,outerHi:vec4<f32>}
@group(2) @binding(4) var<uniform> distributedBounds:DistributedBounds;
var<private> distributedLastMaskFlags:vec2<f32>;
${lookup('fineDistributedIncident','distributedIncident','smokeBoundaryMasks','distributedBounds.fineLo.xyz','distributedBounds.fineHi.xyz')}
${lookup('outerDistributedIncident','exteriorDistributedIncident','exteriorSmokeBoundaryMasks','distributedBounds.outerLo.xyz','distributedBounds.outerHi.xyz')}
fn distributedMeanIncident(p:vec3<f32>)->vec3<f32> {
  if(distributedBounds.fineHi.w>.5&&(any(p<distributedBounds.fineLo.xyz)||any(p>distributedBounds.fineHi.xyz))){return outerDistributedIncident(p);}
  return fineDistributedIncident(p);
}`;
