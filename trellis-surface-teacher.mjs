// Source attributes and PBR lookup for the shared SurfaceTeacher transport.
// A single opaque source material; map footprint is explicit LOD 0 at every hit.
import {sourceMaterialUniform} from './trellis-source-material.mjs';
import {SurfaceTeacher} from './surface-teacher.mjs';
import {materializeFragments} from './trellis-local-support.mjs';

export const TRELLIS_SURFACE_WGSL=/* wgsl */`
struct SourceParams {color:vec4f,factors:vec4f,baseUV:array<vec4f,3>,roughUV:array<vec4f,3>,metalUV:array<vec4f,3>}
struct SourceTriangle {uv01:vec4f,uv2Side:vec4f,n0:vec4f,n1:vec4f,n2:vec4f}
@group(1) @binding(0) var<uniform> sourceParams:SourceParams;
@group(1) @binding(1) var sourceBase:texture_2d<f32>;
@group(1) @binding(2) var sourceRough:texture_2d<f32>;
@group(1) @binding(3) var sourceMetal:texture_2d<f32>;
@group(1) @binding(4) var sourceBaseSampler:sampler;
@group(1) @binding(5) var sourceRoughSampler:sampler;
@group(1) @binding(6) var sourceMetalSampler:sampler;
@group(1) @binding(7) var<storage,read> sourceTriangles:array<SourceTriangle>;
fn sourceUV(p:vec2f,m:array<vec4f,3>)->vec2f{return m[0].xy*p.x+m[1].xy*p.y+m[2].xy;}
fn sourceMaterial(hit:Hit)->Material{
 let a=sourceTriangles[hit.id];let uv=a.uv01.xy*(1.0-hit.uv.x-hit.uv.y)+a.uv01.zw*hit.uv.x+a.uv2Side.xy*hit.uv.y;
 let base=textureSampleLevel(sourceBase,sourceBaseSampler,sourceUV(uv,sourceParams.baseUV),0.0);
 let rough=textureSampleLevel(sourceRough,sourceRoughSampler,sourceUV(uv,sourceParams.roughUV),0.0).g;
 let metal=textureSampleLevel(sourceMetal,sourceMetalSampler,sourceUV(uv,sourceParams.metalUV),0.0).b;
 let factor=materials[u32(triangles[hit.id].a.w)];
 return Material(vec4f(base.rgb*sourceParams.color.rgb*factor.color.rgb,1.0),vec4f(rough*sourceParams.factors.x*factor.optics.x,metal*sourceParams.factors.y*factor.optics.y,0.0,0.0));
}
fn sourceVisible(id:u32,direction:vec3f)->bool{
 let side=sourceTriangles[id].uv2Side.z;let t=triangles[id];let facing=dot(cross(t.e1.xyz,t.e2.xyz),direction);
 return side==2.0||(side==0.0&&facing<0.0)||(side==1.0&&facing>0.0);
}
fn sourceNormal(hit:Hit,direction:vec3f)->vec3f{
 let a=sourceTriangles[hit.id];let interpolated=a.n0.xyz*(1.0-hit.uv.x-hit.uv.y)+a.n1.xyz*hit.uv.x+a.n2.xyz*hit.uv.y;
 if(dot(interpolated,interpolated)<1e-20){return hit.normal;}
 var n=normalize(interpolated);if(dot(n,hit.normal)<0.0){n=-n;}
 // Keep shading in the visible geometric hemisphere. Offsets remain geometric.
 if(dot(n,-direction)<=0.0){return hit.normal;}return n;
}
`;
const finite=(v,n)=>v?.length===n&&Array.from(v).every(Number.isFinite);
export function sourceRegionTriangles(source,candidate){
 const p=materializeFragments(source,candidate.patch,candidate.frame);
 if(!p.uvs)throw Error('Textured source teacher requires original UV0');
 return Array.from({length:p.positions.length/9},(_,i)=>{
  const a=k=>Array.from(p.positions.subarray(i*9+k*3,i*9+k*3+3));
  return {a:a(0),b:a(1),c:a(2),materialIndex:0,
   sourceUVs:[0,1,2].map(k=>Array.from(p.uvs.subarray(i*6+k*2,i*6+k*2+2))),
   sourceNormals:p.normals?[0,1,2].map(k=>Array.from(p.normals.subarray(i*9+k*3,i*9+k*3+3))):null,
   sourceTriangle:p.sourceTriangle[i*3],sourceBarycentrics:Array.from(p.barycentrics.subarray(i*9,i*9+9))};
 });
}
export const SOURCE_TEACHER_UNIT_MATERIAL={color:[1,1,1],roughness:1,metalness:1};
export function createTrellisTeacherSurface(device,{binding,side=0}){
 if(![0,1,2].includes(side))throw Error('Source side must be FrontSide, BackSide or DoubleSide');
 const configData=sourceMaterialUniform(binding);let disposed=false,attributes,order=null;
 const config=device.createBuffer({label:'Source transport material factors and UV transforms',size:configData.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(config,0,configData);
 const maps=[binding.base,binding.rough,binding.metal];
 return {
  wgsl:TRELLIS_SURFACE_WGSL,
  setTriangles(triangles,triangleIndices){
   if(disposed)throw Error('Source transport surface is disposed');
   if(triangles.some(t=>t.materialIndex!==0||!t.sourceUVs||t.sourceUVs.length!==3||t.sourceUVs.some(v=>!finite(v,2))||t.sourceNormals&&(t.sourceNormals.length!==3||t.sourceNormals.some(v=>!finite(v,3)))))throw Error('Every source triangle needs UV0 and optional finite vertex normals with materialIndex 0');
   const data=new Float32Array(Math.max(1,triangleIndices.length)*20);
   triangleIndices.forEach((id,i)=>{const t=triangles[id],n=t.sourceNormals??[[0,0,0],[0,0,0],[0,0,0]];data.set([...t.sourceUVs[0],...t.sourceUVs[1],...t.sourceUVs[2],side,0,...n[0],0,...n[1],0,...n[2],0],i*20);});
   if(!data.every(Number.isFinite))throw Error('Source attributes must be representable as float32');
   if(data.byteLength>device.limits.maxStorageBufferBindingSize||data.byteLength>device.limits.maxBufferSize)throw Error('Source attributes exceed device buffer capacity');
   const next=device.createBuffer({label:'BVH-ordered original source UV and normal attributes',size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(next,0,data);attributes?.destroy();attributes=next;order=Array.from(triangleIndices);
  },
  bind(pass,pipeline){
   if(disposed||!attributes)throw Error('Source transport surface has no active triangle attributes');
   const resources=[{buffer:config},...maps.map(m=>m.texture.createView()),...maps.map(m=>m.sampler),{buffer:attributes}];
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:resources.map((resource,binding)=>({binding,resource}))});pass.setBindGroup(1,group);
  },
  read(){return {route:'original-uv-textured-shared-transport',sampling:'explicit source texture LOD 0 at every bounce',side,triangleOrder:order?.slice()??null,disposed};},
  dispose(){if(disposed)return;disposed=true;config.destroy();attributes?.destroy();}
 };
}

// A local-source observation, not a complete training target: no external scene
// transport, footprint average, learned response or support-exit continuation.
export async function evaluateSourceRegionLighting(device,{source,candidate,binding,queries,side=0,lightDirection=candidate.frame.n,bounces=1}){
 if(!finite(lightDirection,3)||Math.hypot(...lightDirection)===0)throw Error('Finite nonzero incident-light direction required');
 const triangles=sourceRegionTriangles(source,candidate),surface=createTrellisTeacherSurface(device,{binding,side});let teacher;
 try{
  teacher=new SurfaceTeacher(device,{triangles,materials:[SOURCE_TEACHER_UNIT_MATERIAL],surface,lights:[{type:'directional',position:Array.from(lightDirection),color:[1,1,1]}],environment:0,bounces});
  const radiance=await teacher.evaluate(queries);
  if(!radiance.flat().every(Number.isFinite))throw Error('Non-finite source lighting response');
  return {route:'textured-clipped-source-shared-transport',triangles:triangles.length,bounces,lightDirection:Array.from(lightDirection),environment:0,radiance,
   sampling:surface.read().sampling,scope:'clipped source region only; no exterior geometry or footprint integral',alpha:'raw teacher alpha is 1, not coverage; use bounded source hit/exit records separately'};
 }finally{teacher?.dispose();surface.dispose();}
}
