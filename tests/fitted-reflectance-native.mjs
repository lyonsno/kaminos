// kaminos-test: node
import assert from 'node:assert/strict';
import {FITTED_REFLECTANCE_WGSL,readFittedReflectance,loadFittedReflectance} from '../fitted-reflectance.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';

await withKaminosGpu(async ctx=>{
 const result=await evalWgslBatch(ctx,{preamble:FITTED_REFLECTANCE_WGSL,
  argTypes:['f32','f32','f32','f32'],returnType:'vec3<f32>',
  body:`return fittedReflectance(vec3(.3,.2,.1),vec3(.4),vec2(0.),vec2(.2,.6),arg3,vec3(0.,0.,1.),vec3(arg0,arg1,arg2));`,
  inputs:[[0,0,1,0],[0,0,-1,0],[.6,0,.8,0],[0,.6,.8,0],[.6,0,.8,Math.PI/2]]});
 assert.ok(Math.abs(result[0][0]-(.3/Math.PI+.4/(4*Math.PI*.2*.6)))<1e-5);
 assert.deepEqual(result[1],[0,0,0]);
 assert.ok(result[3][0]>result[2][0]*1.3,'wide axis should retain more off-mirror energy');
 assert.ok(Math.abs(result[4][0]-result[3][0])<1e-5,'turning grain must turn its reflected lobe');
},{wgslSources:[{label:'fitted-reflectance',code:FITTED_REFLECTANCE_WGSL+
 '@compute @workgroup_size(1) fn main(){_=fittedReflectance(vec3(0.),vec3(.5),vec2(0.),vec2(.3),0.,vec3(0.,0.,1.),vec3(0.,0.,1.));}',entryPoint:'main'}]});

const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const bytes=Buffer.from(new Float32Array([.2,.3,.4,.2,.3,.4,0,0,.2,.3,0]).buffer);
const meta={schema:'kaminos.fitted-reflectance.v1',response:'projected-bsdf',filtering:'nearest-authored-texel-mip',
 sourceSha256:'a'.repeat(64),layout:['diffuseRGB','specularF0RGB','slopeXY','alphaXY','azimuth'],
 levels:[{size:1,url:'fit-1.f32',sha256:await digest(bytes)}]};
assert.throws(()=>readFittedReflectance({...meta,response:'unprojected'}),/Invalid/);
const payload=Buffer.from(JSON.stringify(meta));
const request='http://localhost/api/read?root=fixture&path=dir%2Ffitted.model';
const sha256=await digest(payload);
const loaded=await loadFittedReflectance(request,{sha256,fetcher(url){
 const item=new URL(url).searchParams.get('path');
 assert.ok(['dir/fitted.model','dir/fit-1.f32'].includes(item));
 return new Response(item.endsWith('.model')?payload:bytes);
}});
assert.ok(Math.abs(loaded.levels[0].data[8]-.2)<1e-6);
await assert.rejects(loadFittedReflectance(request,{sha256,fetcher(url){
 return new Response(new URL(url).searchParams.get('path').endsWith('.model')?payload:Buffer.alloc(bytes.length));
}}),/digest mismatch/);
