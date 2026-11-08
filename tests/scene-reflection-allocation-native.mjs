// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {SCENE_REFLECTION_ALLOCATION_WGSL} from '../scene-reflection-allocation.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
test('production detail allocation follows angular footprint, hit distance, glossy grid and normal variation',async()=>{
 await withKaminosGpu(async ctx=>{
  const options={preamble:SCENE_REFLECTION_ALLOCATION_WGSL,argTypes:['f32','f32','f32','f32'],returnType:'f32',inputs:[[.001,0,64,0],[.05,1,64,0],[.5,1,64,0],[.2,.05,64,0],[.2,5,64,0],[.2,1,32,0],[.2,1,128,0],[.3,5,64,.1],[.3,5,64,0]],body:'return reflectionDetailWeight(arg0,arg1,vec3<f32>(0.0,0.0,-4.0),vec3<f32>(0.0,0.0,1.0),mat4x4<f32>(vec4<f32>(1.0,0.0,0.0,0.0),vec4<f32>(0.0,1.0,0.0,0.0),vec4<f32>(0.0,0.0,1.0,0.0),vec4<f32>(0.0,0.0,0.0,1.0)),vec2<f32>(512.0),vec2<f32>(arg2),arg3);'};
  const check=w=>{assert.equal(w[0],1,'unknown coarse hit distance still traces a mirror');assert.equal(w[1],1);assert.equal(w[2],0);assert.ok(w[3]>w[4]);assert.ok(w[5]>w[6]);assert.ok(w[7]>w[8]);for(const x of w)assert.ok(x>=0&&x<=1);};
  const values=await evalWgslBatch(ctx,options);console.log('allocation-weights:',values);check(values);
  const faulty=await evalWgslBatch(ctx,{...options,body:'return 0.0;'});assert.throws(()=>check(faulty),'all-coarse fault must be rejected');
 });
});
