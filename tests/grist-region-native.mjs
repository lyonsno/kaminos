// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {REGION_MATH_WGSL} from '../earth-gpu/region-shader.mjs';
import {evalWgslBatch,withKaminosGpu} from '../tools/shader-herder.mjs';
test('region coupling corrects relative displacement reciprocally and damage cannot heal',async()=>{
 await withKaminosGpu(async ctx=>{
  const values=await evalWgslBatch(ctx,{preamble:REGION_MATH_WGSL,argTypes:['f32','f32','f32','f32'],returnType:'vec4<f32>',body:'let c=regionCorrection(vec3f(arg0,0,0),arg1,arg2);return vec4f(c,regionDamageNext(arg3,0.8,0.01,12.0));',inputs:[[2,4,.5,0],[2,4,0,.8],[0,4,1,.8]]});
  assert.ok(Math.abs(values[0][0]+.25)<1e-6,'nonzero relative displacement must cause a correction');
  assert.equal(values[1][0],0);assert.ok(values[0][3]>0);assert.ok(values[1][3]>=.8-1e-6);
  const healed=await evalWgslBatch(ctx,{preamble:REGION_MATH_WGSL,argTypes:['f32'],returnType:'f32',body:'return regionDamageNext(arg0,0.0,0.1,12.0);',inputs:[[.7]]});assert.ok(Math.abs(healed[0]-.7)<1e-6);
 },{wgslSources:[{label:'region-coupling-math',entryPoint:'main',code:REGION_MATH_WGSL+'@compute @workgroup_size(1) fn main(){_ = regionDamageNext(0,0,0,0);}'}]});
});
