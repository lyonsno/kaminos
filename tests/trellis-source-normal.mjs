// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {TRELLIS_SOURCE_NORMAL_WGSL} from '../trellis-source-normal.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
test('production source-normal policy faces the hit hemisphere and falls back for zero or hidden smooth normals',async()=>{
 await withKaminosGpu(async ctx=>{
  const values=await evalWgslBatch(ctx,{preamble:TRELLIS_SOURCE_NORMAL_WGSL,argTypes:Array(9).fill('f32'),returnType:'vec3<f32>',inputs:[[0,-1,0,0,1,0,0,1,0],[0,0,0,0,1,0,0,1,0],[-1,.1,0,0,1,0,.8,.6,0],[.6,.8,0,0,1,0,0,1,0]],body:'return trellisSourceNormal(vec3<f32>(arg0,arg1,arg2),vec3<f32>(arg3,arg4,arg5),vec3<f32>(arg6,arg7,arg8));'});
  const expected=[[0,1,0],[0,1,0],[0,1,0],[.6,.8,0]];for(let i=0;i<values.length;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(values[i][c]-expected[i][c])<1e-6);
 });
});
