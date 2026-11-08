// kaminos-test: node
import assert from 'node:assert/strict';
import {alphaDecodeWGSL,decodeAlpha} from '../alpha-carrier-model.mjs';
import {evalWgslBatch,withKaminosGpu} from '../tools/shader-herder.mjs';
const parameters=new Float32Array(121);parameters[0]=1;parameters[40]=1;parameters[112]=2;parameters[120]=-.5;
const source=alphaDecodeWGSL(parameters),inputs=[[1,0,0,0],[-1,0,0,0],[.25,0,0,0]];
const verify=result=>result.forEach((value,i)=>assert.ok(Math.abs(value-decodeAlpha(inputs[i],parameters))<1e-5,`alpha query${i}`));
await withKaminosGpu(async ctx=>{
  verify(await evalWgslBatch(ctx,{preamble:source,argTypes:['f32','f32','f32','f32'],returnType:'f32',body:'return alpha_decode(vec4<f32>(arg0,arg1,arg2,arg3));',inputs}));
  const erased=await evalWgslBatch(ctx,{preamble:source,argTypes:['f32','f32','f32','f32'],returnType:'f32',body:'return alpha_decode(vec4<f32>(0.0));',inputs});
  assert.throws(()=>verify(erased),/alpha query0/);
  console.log('Production one-call alpha decoder executes; erased-feature fault rejected');
},{wgslSources:[{code:`${source}\n@compute @workgroup_size(1) fn main(){_ = alpha_decode(vec4<f32>(0.0));}`,entryPoint:'main',label:'alpha-carrier'}]});
