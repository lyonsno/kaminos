import {TRELLIS_SOURCE_NORMAL_WGSL} from './trellis-source-normal.mjs';
// Teacher for the existing raw-field mesh consumer: exact raw topology, aligned
// per-vertex PBR rows, sRGB conversion before interpolation, no UV/atlas bake.
import {prepareSupportVolume,materializeFragments,worldPoint,supportFrame} from './trellis-local-support.mjs';
import {clipSupportVolume} from './trellis-support-gpu.mjs';
import {traceSupportRays} from './trellis-support-rays.mjs';
import {SurfaceMaterialTeacher} from './surface-material-teacher.mjs';
import {SOURCE_TEACHER_UNIT_MATERIAL} from './trellis-surface-teacher.mjs';
const linear=x=>{x=Math.max(0,Math.min(1,x));return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;};
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
export function rawFieldSource(data,indices,meta){
 if(meta.ok!==true||meta.stride!==12||data.length!==meta.count*12||indices.length!==meta.triangles?.count*3||!data.every(Number.isFinite)||!indices.every(i=>i<meta.count))throw Error('Complete matching raw-field geometry and material rows required');
 const positions=new Float32Array(meta.count*3),normals=positions.slice(),materialRows=new Float32Array(meta.count*6);
 for(let i=0;i<meta.count;i++){positions.set(data.subarray(i*12,i*12+3),i*3);normals.set(data.subarray(i*12+3,i*12+6),i*3);materialRows.set(data.subarray(i*12+6,i*12+12),i*6);}
 return {positions,normals,indices,materialRows,provenance:meta};
}
export const RAW_FIELD_SURFACE_WGSL=TRELLIS_SOURCE_NORMAL_WGSL+/* wgsl */`
struct RawTriangle {c0:vec4f,c1:vec4f,c2:vec4f,o0:vec4f,o1:vec4f,o2:vec4f,n0:vec4f,n1:vec4f,n2:vec4f}
@group(1) @binding(0) var<storage,read> rawTriangles:array<RawTriangle>;
fn sourceMaterial(hit:Hit)->Material{
 let a=rawTriangles[hit.id];let b=vec3f(1.0-hit.uv.x-hit.uv.y,hit.uv);
 let color=a.c0.rgb*b.x+a.c1.rgb*b.y+a.c2.rgb*b.z;
 let optics=clamp(a.o0.xy*b.x+a.o1.xy*b.y+a.o2.xy*b.z,vec2f(0.0),vec2f(1.0));
 let factor=materials[u32(triangles[hit.id].a.w)];
 return Material(vec4f(color*factor.color.rgb,1.0),vec4f(optics*factor.optics.xy,0.0,0.0));
}
fn sourceVisible(id:u32,direction:vec3f)->bool{return true;}
fn sourceNormal(hit:Hit,direction:vec3f)->vec3f{
 let a=rawTriangles[hit.id];let n=a.n0.xyz*(1.0-hit.uv.x-hit.uv.y)+a.n1.xyz*hit.uv.x+a.n2.xyz*hit.uv.y;
 return trellisSourceNormal(n,hit.normal,-direction);
}
`;
export function createRawFieldTeacherSurface(device){
 let buffer;
 return {wgsl:RAW_FIELD_SURFACE_WGSL,setTriangles(triangles,order){
  const data=new Float32Array(order.length*36);
  order.forEach((id,i)=>{const t=triangles[id];for(let k=0;k<3;k++){data.set([...t.sourceColors[k],1],i*36+k*4);data.set([t.sourceOptics[k][0],t.sourceOptics[k][1],0,0],i*36+12+k*4);data.set([...t.sourceNormals[k],0],i*36+24+k*4);}});
  if(!data.every(Number.isFinite)||data.byteLength>device.limits.maxStorageBufferBindingSize)throw Error('Raw teacher attributes exceed finite device capacity');
  buffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);
 },bind(pass,pipeline){pass.setBindGroup(1,device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer}}]}));},dispose(){buffer?.destroy();}};
}
export async function createRawTrellisTrainingSource(device,source,{region,tileSize,samplingPlane='center-hit'}){
 if(!['center-hit','support-top'].includes(samplingPlane))throw Error('Unknown raw sampling plane');
 if(!(source.positions instanceof Float32Array)||!(source.indices instanceof Uint32Array)||!(source.normals instanceof Float32Array)||!(source.materialRows instanceof Float32Array)||source.materialRows.length!==source.positions.length*2||!source.materialRows.every(Number.isFinite))throw Error('Aligned finite raw fields required');
 if(!Number.isFinite(tileSize)||tileSize<=0||tileSize>2*region.radius)throw Error('Raw material tile must fit inside support');
 if(source.provenance?.region){const canonical=r=>JSON.stringify({...supportFrame(r),top:r.top??.01});if(canonical(source.provenance.region)!==canonical(region))throw Error('Raw manifest region mismatch; use the recorded region or extract a matching raw bundle');}
 const prepared=prepareSupportVolume(source,region),candidate={...prepared,...await clipSupportVolume(device,prepared)},f=candidate.frame;
 const rotate=(v,point=false)=>{const d=v.map((x,k)=>x-(point?f.origin[k]:0));return [dot(d,f.u),dot(d,f.n),-dot(d,f.v)];};
 const materialized=materializeFragments(source,candidate.patch,f);
 const triangles=candidate.patch.map((t,i)=>{
  const colors=[],optics=[];
  for(const v of t.vertices){
   colors.push([0,1,2].map(c=>v.b.reduce((sum,w,k)=>sum+w*linear(source.materialRows[source.indices[t.sourceTriangle*3+k]*6+c]),0)));
   optics.push([4,3].map(c=>v.b.reduce((sum,w,k)=>sum+w*source.materialRows[source.indices[t.sourceTriangle*3+k]*6+c],0)));
  }
  const points=[0,1,2].map(k=>rotate(Array.from(materialized.positions.subarray(i*9+k*3,i*9+k*3+3)),true));
  return {a:points[0],b:points[1],c:points[2],materialIndex:0,sourceColors:colors,sourceOptics:optics,sourceNormals:[0,1,2].map(k=>rotate(Array.from(materialized.normals.subarray(i*9+k*3,i*9+k*3+3)))),sourceTriangle:source.provenance?.originalTriangleIds?.[t.sourceTriangle]??t.sourceTriangle,sourceBarycentrics:t.vertices.flatMap(v=>v.b)};
 });
 const query={origin:worldPoint([0,0,candidate.hi[2]],f),direction:f.n.map(v=>-v)},probe=(await traceSupportRays(device,candidate,[query],{twoSided:true})).samples[0];
 if(samplingPlane==='center-hit'&&!probe.hit)throw Error('Raw control requires a visible center surface');
 const referenceHeight=candidate.hi[2]*f.radius,samplingPlaneHeight=samplingPlane==='support-top'?referenceHeight:rotate(probe.position,true)[1];
 const heights=triangles.flatMap(t=>[t.a[1],t.b[1],t.c[1]]),heightRange=heights.reduce((r,h)=>[Math.min(r[0],h),Math.max(r[1],h)],[Infinity,-Infinity]);
 if(!Number.isFinite(samplingPlaneHeight)||!Number.isFinite(heightRange[0])||samplingPlane==='support-top'&&heightRange[1]>samplingPlaneHeight+1e-6*Math.max(1,f.radius))throw Error('Raw support-top carrier does not enclose its source');
 const samplingPlaneSelection={method:samplingPlane==='support-top'?'support top; all clipped source vertices inset or flush':'first visible center hit',probe,sourceHeightRange:heightRange};
 const surface=createRawFieldTeacherSurface(device);let teacher;
 try{teacher=new SurfaceMaterialTeacher(device,{triangles,materials:[SOURCE_TEACHER_UNIT_MATERIAL],surface,environment:0,bounces:1});}
 catch(e){surface.dispose();throw e;}
 return {teacher,triangles,capture:{tileSize,referenceHeight,samplingPlaneHeight},source:{route:'raw-aligned-fields',region,tileSize,sourceTriangles:source.indices.length/3,upstreamSourceTriangles:source.provenance?.triangles?.sourceCount??source.indices.length/3,clippedTriangles:triangles.length,coordinateFrame:f,samplingPlaneHeight,referenceHeight,samplingPlaneSelection,material:'existing raw-field mesh semantics; vertex sRGB linearized before interpolation; metallic/roughness clamped after interpolation; opaque control',scope:'raw local geometry and aligned material rows; no UV atlas or reduction; clipped local transport only'},dispose(){teacher.dispose();surface.dispose();}};
}
