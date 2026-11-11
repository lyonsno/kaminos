// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {PARTICLE_STATE_WGSL,PARTICLE_KERNEL_WGSL,particleKernelNormalization} from '../volume-particle-state.mjs';
test('actual carried reaction consumes both reactants and produces heat and soot',async()=>{
 await withKaminosGpu(async ctx=>{
  const [r]=await evalWgslBatch(ctx,{preamble:PARTICLE_STATE_WGSL,argTypes:[],returnType:'vec4<f32>',body:'return particleCompositionBurn(vec4<f32>(1,1,0,3),1.0,vec4<f32>(3,6,.15,.75),vec4<f32>(8,1000,.25,1000)).state;',inputs:[[]]});
  assert.ok(r[0]<1,'fuel must be consumed');assert.ok(r[3]<3,'oxidizer must be consumed');assert.ok(r[1]>1,'heat must be released');assert.ok(r[2]>0,'soot must be generated');assert.ok(Math.abs((1-r[0])*3-(3-r[3]))<1e-5,'stoichiometric consumption');
 });
});
test('finite authored profiles taper at the quad edge and preserve their coefficient integral',async()=>{
 await withKaminosGpu(async ctx=>{
  const profiles=[[1,0],[1,.3],[.6,.5],[1.8,.2]],n=160,dx=5/n;
  const inputs=profiles.flatMap(([power,softness])=>Array.from({length:n},(_,i)=>[-2.5+(i+.5)*dx,power,softness,particleKernelNormalization(power,softness)]));
  const r=await evalWgslBatch(ctx,{preamble:PARTICLE_KERNEL_WGSL,argTypes:['f32','f32','f32','f32'],returnType:'f32',body:'return particleKernel(vec2<f32>(arg0,0),arg1,arg2,sqrt(arg3));',inputs});
  const area=profiles.map((_,j)=>Math.pow(r.slice(j*n,(j+1)*n).reduce((a,b)=>a+Number(b),0)*dx,2));for(const a of area)assert.ok(Math.abs(a/area[0]-1)<.002,'profile changes conserve the finite coefficient amount');
  const edge=await evalWgslBatch(ctx,{preamble:PARTICLE_KERNEL_WGSL,argTypes:['f32'],returnType:'f32',body:'return particleKernel(vec2<f32>(2.5,0),1,arg0,1);',inputs:[[0],[.3]]});assert.ok(edge[0]>0);assert.equal(Number(edge[1]),0,'positive softness removes the hard quad edge');
 });
});
test('carried reaction cannot burn without oxygen and freezes without elapsed time',async()=>{
 await withKaminosGpu(async ctx=>{
  const r=await evalWgslBatch(ctx,{preamble:PARTICLE_STATE_WGSL,argTypes:['f32','f32'],returnType:'vec4<f32>',body:'return particleCompositionBurn(vec4<f32>(1,1,0,arg0),arg1,vec4<f32>(3,6,.15,.75),vec4<f32>(8,1000,.25,1000)).state;',inputs:[[0,1],[3,0]]});
  assert.equal(r[0][0],1);assert.equal(r[0][2],0);assert.deepEqual(Array.from(r[1]),[1,1,0,3]);
 });
});
test('state-controlled lifetime changes persistence and fades only at its authored end',async()=>{
 await withKaminosGpu(async ctx=>{
  const r=await evalWgslBatch(ctx,{preamble:PARTICLE_STATE_WGSL,argTypes:['f32','f32','f32','f32','f32'],returnType:'vec4<f32>',body:'return particleLifeAdvance(vec4<f32>(arg0,arg1,arg2,1),1.0,arg3,1.0,vec4<f32>(20,40,80,5),vec2<f32>(.15,.75),1.0,arg4,.2);',inputs:[[0,0,0,0,1],[1,0,0,0,1],[0,1,0,0,1],[0,0,1,0,1],[0,0,0,.85,0],[0,0,0,.7,1]]});
  assert.ok(Math.abs(r[0][0]-.2)<1e-6,'quiet material uses quiet lifetime');assert.ok(r[1][0]<r[0][0]&&r[2][0]<r[1][0]&&r[3][0]<r[2][0],'fuel/hot/smoke lifetimes act independently');assert.equal(r[0][1],1);assert.equal(r[4][0],Math.fround(.85));assert.ok(r[5][1]>0&&r[5][1]<1,'authored final fade');
 });
});
