// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {CARRIER_DEFORMATION_WGSL} from '../volume-carrier-deformation.mjs';
import {evalWgslBatch,withKaminosGpu} from '../tools/shader-herder.mjs';

test('optical support accumulates rotation and shear, with independent zero and relaxation',async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{
   preamble:CARRIER_DEFORMATION_WGSL,argTypes:['u32'],returnType:'vec4<f32>',
   body:`let identity=mat3x3<f32>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));
    var g=mat3x3<f32>(vec3<f32>(0),vec3<f32>(0),vec3<f32>(0));
    if(arg0==1u){g=mat3x3<f32>(vec3<f32>(0,1,0),vec3<f32>(-1,0,0),vec3<f32>(0));}
    if(arg0==2u||arg0==3u){g[1]=vec3<f32>(1,0,0);}
    var f=identity;
    if(arg0==4u){f[1]=vec3<f32>(2,1,0);}
    let dt=select(1.0,1.57079632679,arg0==1u);
    f=carrierDeformation(f,g,dt,select(1.0,0.0,arg0==3u),select(1.0,0.0,arg0==3u),select(0.0,0.69314718056,arg0==4u));
    return vec4<f32>(f[0].xy,f[1].xy);`,
   inputs:[[0],[1],[2],[3],[4]],
  });
  const expected=[[1,0,0,1],[0,1,-1,0],[1,0,1,1],[1,0,0,1],[1,0,1,1]];
  result.forEach((row,i)=>row.forEach((v,j)=>assert.ok(Math.abs(v-expected[i][j])<.0001,`case ${i} component ${j}: ${v} != ${expected[i][j]}`)));
 },{wgslSources:[{label:'carrier-deformation',entryPoint:'main',code:`${CARRIER_DEFORMATION_WGSL}\n@compute @workgroup_size(1) fn main(){let f=mat3x3<f32>(vec3<f32>(1,0,0),vec3<f32>(0,1,0),vec3<f32>(0,0,1));_=carrierDeformation(f,f,0.0,1.0,1.0,0.0);}`} ]});
});
