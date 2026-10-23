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
    {binding:18,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},
    {binding:20,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
    {binding:21,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},
  ]});
  const coverage=device.createBuffer({label:'exterior smoke lookup coverage',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  let last=null,group=null,packedMasks=null,maskSources=[],maskPreparations=[],maskOffsets=[];
  return {layout, update(frame) {
    const r=frame.smokeReconstruction;
    if(!frame.texture || r?.identity!=='prepared-geometry-visible-v1' || !r.texture || !r.masks || !Number.isInteger(r.staticPreparations) || r.staticPreparations<1 || !Number.isInteger(r.updates) || r.updates<1) throw new Error('distributed smoke requires current prepared reconstruction resources');
    const exterior=frame.exterior,e=exterior?.smokeReconstruction,m=exterior?.middle?.smokeReconstruction;
    for(const region of [exterior,exterior?.middle]){
      const e=region?.smokeReconstruction;
      if(region&&(region.generation!==frame.generation||region.frame!==frame.frame||e?.identity!=='prepared-geometry-visible-v1'||!e.texture||!e.masks||!(e.staticPreparations>0)||!(e.updates>0)||!e.localMin||!e.localMax))throw Error('exterior lighting requires current same-generation reconstruction resources');
    }
    const data=[...(e?[...e.localMin,2/r.coarseDimensions[0],...e.localMax,1]:Array(8).fill(0)),
      ...(m?[...m.localMin,(m.localMax[0]-m.localMin[0])/m.coarseDimensions[0],...m.localMax,1]:Array(8).fill(0))];
    // The ordinary fluid layout already consumes eight fragment storage slots.
    // Preserve all three geometry masks in one buffer, copying only when their
    // resources or geometry preparation changes, never for a radiance update.
    const resources=[r,e??r,m??r],sources=resources.map(v=>v.masks);
    const sizes=sources.map(v=>v.size);
    if(!sizes.every(n=>Number.isSafeInteger(n)&&n>0&&n%4===0))throw Error('prepared smoke mask byte sizes required');
    const offsets=[0,sizes[0],sizes[0]+sizes[1]],total=sizes.reduce((a,b)=>a+b,0);
    if(total>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw Error('composed smoke masks exceed device capacity');
    if(!packedMasks||packedMasks.size!==total){
      packedMasks?.destroy();packedMasks=device.createBuffer({label:'composed smoke region masks',size:total,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      maskSources=[];
    }
    const changed=resources.map((v,i)=>sources[i]!==maskSources[i]||v.staticPreparations!==maskPreparations[i]||offsets[i]!==maskOffsets[i]);
    if(changed.some(Boolean)){
      const encoder=device.createCommandEncoder({label:'copy changed smoke geometry masks'});
      changed.forEach((change,i)=>{if(change)encoder.copyBufferToBuffer(sources[i],0,packedMasks,offsets[i],sizes[i]);});
      device.queue.submit([encoder.finish()]);maskSources=sources;maskPreparations=resources.map(v=>v.staticPreparations);maskOffsets=offsets;
    }
    device.queue.writeBuffer(coverage,0,new Float32Array(data));
    device.queue.writeBuffer(coverage,64,new Uint32Array([...offsets.map(n=>n/4),0]));
    const handles=[r.texture,packedMasks,e?.texture??r.texture,m?.texture??r.texture];
    if(!last || handles.some((h,i)=>h!==last[i])) {
      group=device.createBindGroup({layout,entries:[{binding:0,resource:r.texture.createView()},
        {binding:1,resource:{buffer:packedMasks}},{binding:18,resource:handles[2].createView()},
        {binding:20,resource:{buffer:coverage}},{binding:21,resource:handles[3].createView()}]});
      last=handles;
    }
    return group;
  },destroy(){coverage.destroy();packedMasks?.destroy();last=null;group=null;}};
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
  // A wall-intersected cell is unknown, not permission to leak light across it.
  if(smokeBoundaryMasks[nearestId]!=0u){distributedLastMaskFlags=vec2<f32>(1,0);return vec3<f32>(0);}
  let bin=vec3<u32>(clamp(base+vec3<i32>(1),vec3<i32>(0),vec3<i32>(dims)));
  let binDims=dims+vec3<u32>(1u);let id=bin.x+binDims.x*(bin.y+binDims.y*bin.z);
  if(smokeBoundaryMasks[dims.x*dims.y*dims.z+id]!=0u){distributedLastMaskFlags=vec2<f32>(0,1);return textureLoad(distributedIncident,vec3<i32>(nearest),0).rgb;}
  var sum=vec3<f32>(0.0);
  for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
    let weight=select(1.0-w.x,w.x,x==1u)*select(1.0-w.y,w.y,y==1u)*select(1.0-w.z,w.z,z==1u);
    if(weight==0.0){continue;}
    let c=clamp(base+vec3<i32>(i32(x),i32(y),i32(z)),vec3<i32>(0),vec3<i32>(dims)-vec3<i32>(1));
    sum+=textureLoad(distributedIncident,c,0).rgb*weight;
  }}}
  return sum;
}`;

// Keep the fine-only kernel available for isolated numerical witnesses. Both
// fields use identical geometry-safe interpolation; no camera BVH work.
const exteriorLookup=DISTRIBUTED_SMOKE_WGSL
 .replaceAll('@binding(0)','@binding(18)').replaceAll('@binding(1)','@binding(19)')
 .replaceAll('distributedIncident','exteriorIncident').replaceAll('smokeBoundaryMasks','exteriorBoundaryMasks')
 .replaceAll('distributedLastMaskFlags','exteriorLastMaskFlags').replaceAll('distributedMeanIncident','exteriorMeanIncident')
 .replace('let pitch=2.0/f32(dims.x);','let pitch=(exteriorCoverage.hiEnabled.x-exteriorCoverage.loBlend.x)/f32(dims.x);')
 .replace('let lo=vec3<f32>(-1.0);let hi=lo+vec3<f32>(dims)*pitch;','let lo=exteriorCoverage.loBlend.xyz;let hi=exteriorCoverage.hiEnabled.xyz;');
const middleLookup=exteriorLookup.replaceAll('@binding(18)','@binding(21)').replaceAll('@binding(19)','@binding(22)')
 .replaceAll('exteriorIncident','middleIncident').replaceAll('exteriorBoundaryMasks','middleBoundaryMasks')
 .replaceAll('exteriorLastMaskFlags','middleLastMaskFlags').replaceAll('exteriorMeanIncident','middleMeanIncident')
 .replaceAll('exteriorCoverage.loBlend','exteriorCoverage.middleLoBlend').replaceAll('exteriorCoverage.hiEnabled','exteriorCoverage.middleHiEnabled');
export const COMPOSED_SMOKE_WGSL=DISTRIBUTED_SMOKE_WGSL.replace('fn distributedMeanIncident(','fn fineMeanIncident(')
 .replaceAll('smokeBoundaryMasks[','smokeBoundaryMasks[exteriorCoverage.maskOffsets.x+')+`
struct ExteriorCoverage {loBlend:vec4<f32>,hiEnabled:vec4<f32>,middleLoBlend:vec4<f32>,middleHiEnabled:vec4<f32>,maskOffsets:vec4<u32>}
@group(2) @binding(20) var<uniform> exteriorCoverage:ExteriorCoverage;
`+exteriorLookup.replace('@group(2) @binding(19) var<storage,read> exteriorBoundaryMasks:array<u32>;','')
 .replaceAll('exteriorBoundaryMasks[','smokeBoundaryMasks[exteriorCoverage.maskOffsets.y+')
 +middleLookup.replace('@group(2) @binding(22) var<storage,read> middleBoundaryMasks:array<u32>;','')
 .replaceAll('middleBoundaryMasks[','smokeBoundaryMasks[exteriorCoverage.maskOffsets.z+')+`
fn regionalMeanIncident(p:vec3<f32>)->vec3<f32>{
  let far=exteriorMeanIncident(p);
  if(exteriorCoverage.middleHiEnabled.w<0.5){return far;}
  let edge=min(p-exteriorCoverage.middleLoBlend.xyz,exteriorCoverage.middleHiEnabled.xyz-p);
  let distance=min(edge.x,min(edge.y,edge.z));
  if(distance<0.0){return far;}
  let middle=middleMeanIncident(p);
  let farMask=exteriorLastMaskFlags;
  exteriorLastMaskFlags=middleLastMaskFlags;
  // Finer solid ownership wins; coarse light must never fill its wall mask.
  if(middleLastMaskFlags.x>0.5||farMask.x>0.5){return middle;}
  return mix(far,middle,smoothstep(0.0,exteriorCoverage.middleLoBlend.w,distance));
}
fn distributedMeanIncident(p:vec3<f32>)->vec3<f32>{
  let fine=fineMeanIncident(p);
  if(exteriorCoverage.hiEnabled.w<0.5){return fine;}
  let hi=vec3<f32>(-1)+vec3<f32>(textureDimensions(distributedIncident))*(2.0/f32(textureDimensions(distributedIncident).x));
  let inside=all(p>=vec3<f32>(-1))&&all(p<=hi);
  let coarse=regionalMeanIncident(p);
  if(!inside){distributedLastMaskFlags=exteriorLastMaskFlags;return coarse;}
  // Never fill a fine solid mask from a coarse neighbor across the wall.
  if(distributedLastMaskFlags.x>0.5||exteriorLastMaskFlags.x>0.5){return fine;}
  let edge=min(p+vec3<f32>(1),hi-p);let distance=min(edge.x,min(edge.y,edge.z));
  return mix(coarse,fine,smoothstep(0.0,exteriorCoverage.loBlend.w,distance));
}
`;
