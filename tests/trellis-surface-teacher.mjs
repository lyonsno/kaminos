// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceTeacher} from '../surface-teacher.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
const triangles=[{a:[-2,0,-2],b:[2,0,2],c:[2,0,-2],materialIndex:0}];
const materials=[{color:[.8,.5,.3],roughness:.8,metalness:0}];
test('source material hook participates inside shared transport rather than relabeling its result',async()=>{
 await withKaminosGpu(async({device})=>{
  const teacher=new SurfaceTeacher(device,{triangles,materials,environment:0,bounces:1,lights:[{type:'directional',position:[0,1,0],color:[1,1,1]}],surface:{
   wgsl:`fn sourceMaterial(hit:Hit)->Material{return Material(materials[u32(triangles[hit.id].a.w)].color*0.0,vec4f(1,0,0,0));}
   fn sourceNormal(hit:Hit,direction:vec3f)->vec3f{return hit.normal;}
   fn sourceVisible(id:u32,direction:vec3f)->bool{return true;}`,
   setTriangles(){},bind(){}
  }});
  try{const [rgb]=await teacher.evaluate([{origin:[.3,1,0],direction:[0,-1,0]}]);for(const v of rgb.slice(0,3))assert.ok(Math.abs(v-.04/(4*Math.PI))<1e-6);}
  finally{teacher.dispose();}
 });
});

import {createTrellisTeacherSurface,SOURCE_TEACHER_UNIT_MATERIAL,sourceRegionTriangles} from '../trellis-surface-teacher.mjs';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {evalWgslBatch} from '../tools/shader-herder.mjs';
import {SURFACE_TEACHER_COMMON_WGSL} from '../surface-teacher-wgsl.mjs';
const near=(a,b,e=3e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function textureBinding(device){
 const base=device.createTexture({size:[2,1],format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const mr=device.createTexture({size:[2,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 device.queue.writeTexture({texture:base},Uint8Array.from([192,64,16,255,32,128,224,255]),{bytesPerRow:8},[2,1]);
 device.queue.writeTexture({texture:mr},Uint8Array.from([0,220,32,255,0,110,200,255]),{bytesPerRow:8},[2,1]);
 const sampler=device.createSampler({minFilter:'nearest',magFilter:'nearest',addressModeU:'repeat'}),map=texture=>({texture,sampler,transform:[1,0,0,0,1,0,0,0,1]});
 return {binding:{color:[.8,.7,.6,1],roughness:.9,metalness:.8,base:map(base),rough:map(mr),metal:map(mr)},dispose(){base.destroy();mr.destroy();}};
}
test('actual transport resolves BVH reordered source UVs, PBR maps and source sidedness',async()=>{
 await withKaminosGpu(async({device})=>{
  const tex=textureBinding(device),tri=[],queries=[],mats=[];
  const linear=v=>v/255<=.04045?v/255/12.92:((v/255+.055)/1.055)**2.4;
  for(let j=0;j<12;j++){
   const x=(11-j)*3,u=j%2?.75:.25;
   tri.push({a:[x,0,0],b:[x,0,1],c:[x+1,0,0],materialIndex:0,sourceUVs:[[u,.5],[u,.5],[u,.5]],sourceNormals:[[0,1,0],[0,1,0],[0,1,0]]});
   queries.push({origin:[x+.2,1,.3],direction:[0,-1,0]});
   const c=j%2?[32,128,224]:[192,64,16],mr=j%2?[110,200]:[220,32];mats.push({color:c.map((v,k)=>linear(v)*tex.binding.color[k]),roughness:mr[0]/255*.9,metalness:mr[1]/255*.8});
  }
  const surface=createTrellisTeacherSurface(device,{binding:tex.binding,side:0}),light=[{type:'directional',position:[.6,1,0],color:[1,1,1]}];let teacher,reference;
  try{
   teacher=new SurfaceTeacher(device,{triangles:tri,materials:[SOURCE_TEACHER_UNIT_MATERIAL],surface,environment:0,bounces:1,lights:light});
   reference=new SurfaceTeacher(device,{triangles:tri.map((t,i)=>({...t,materialIndex:i})),materials:mats,environment:0,bounces:1,lights:light});
   assert.notDeepEqual(surface.read().triangleOrder,tri.map((_,i)=>i),'fixture must actually reorder BVH triangles');
   const actual=await teacher.evaluate(queries),expected=await reference.evaluate(queries);
   actual.forEach((row,i)=>row.slice(0,3).forEach((v,k)=>near(v,expected[i][k],4e-4)));
   const back=await teacher.evaluate([{origin:queries[0].origin.map((v,k)=>k===1?-1:v),direction:[0,1,0]}]);assert.deepEqual(back[0].slice(0,3),[0,0,0]);
  }finally{teacher?.dispose();reference?.dispose();surface.dispose();tex.dispose();}
 });
});
test('directional material teacher uses barycentric UV interpolation and shading normals in the same transport',async()=>{
 await withKaminosGpu(async ctx=>{
  const {device}=ctx,tex=textureBinding(device),n=[.6,.8,0];
  const tri=[{a:[0,0,0],b:[0,0,1],c:[1,0,0],materialIndex:0,sourceUVs:[[0,0],[0,1],[1,0]],sourceNormals:[n,n,n]}];
  const surface=createTrellisTeacherSurface(device,{binding:tex.binding,side:0});let teacher;
  try{
   teacher=new SurfaceMaterialTeacher(device,{triangles:tri,materials:[SOURCE_TEACHER_UNIT_MATERIAL],surface,environment:0,bounces:1});
   // Material uv(.7,.8) maps to world(.2, .1, .3); barycentrics (.5,.3,.2).
   const result=await teacher.evaluateMaterial(new Float32Array([.7,.8,0,0,0,0,0,0]),{tileSize:1,referenceHeight:.1,resolution:16777216,samples:1,seed:3});
   const srgb=v=>((v/255+.055)/1.055)**2.4,color=[192,64,16].map((v,k)=>srgb(v)*tex.binding.color[k]);
   const expected=await evalWgslBatch(ctx,{preamble:SURFACE_TEACHER_COMMON_WGSL,argTypes:['f32'],returnType:'vec3f',inputs:[[0]],body:`return bsdf(vec3f(.6,.8,0),vec3f(0,1,0),vec3f(0,1,0),Material(vec4f(${color.join(',')},1),vec4f(${220/255*.9},${32/255*.8},0,0)))*.8;`});
   result.forEach((v,k)=>near(v,expected[0][k],4e-4));
   // Moving within the same triangle must select the other texel, not a triangle constant.
   const other=await teacher.evaluateMaterial(new Float32Array([1.2,.6,0,0,0,0,0,0]),{tileSize:1,referenceHeight:.1,resolution:16777216,samples:1,seed:3});
   assert.ok(other[2]>other[0]&&result[0]>result[2]);
   assert.throws(()=>surface.setTriangles([{...tri[0],sourceUVs:null}],new Uint32Array([0])),/UV0/);
  }finally{teacher?.dispose();surface.dispose();tex.dispose();}
 });
});
test('clipped fragments retain original UV and unnormalized interpolated normals for hit interpolation',()=>{
 const source={positions:new Float32Array([0,0,0,1,0,0,0,0,-1]),indices:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1]),normals:new Float32Array([0,1,0,.6,.8,0,0,.8,.6])};
 const candidate={frame:{origin:[0,0,0],u:[1,0,0],v:[0,0,-1],n:[0,1,0],radius:1},patch:[{sourceTriangle:0,vertices:[{p:[.25,.25,0],b:[.5,.25,.25]},{p:[.5,.25,0],b:[.25,.5,.25]},{p:[.25,.5,0],b:[.25,.25,.5]}]}]};
 const [t]=sourceRegionTriangles(source,candidate);assert.deepEqual(t.sourceUVs,[[.25,.25],[.5,.25],[.25,.5]]);near(t.sourceNormals[0][0],.15);near(t.sourceNormals[0][1],.9);near(t.sourceNormals[0][2],.15);assert.deepEqual(t.a,[.25,0,-.25]);
});
