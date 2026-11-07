// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {SPLIT_OPTICAL_MATH_WGSL,splitIntegralSettings} from '../volume-split-integral.mjs';

test('local contributions compose through foreground transmission and evolve light/opacity independently',async()=>{
 await withKaminosGpu(async ctx=>{
  const r=await evalWgslBatch(ctx,{preamble:SPLIT_OPTICAL_MATH_WGSL,argTypes:['f32','f32'],returnType:'vec4<f32>',
   body:`let a=SplitObservation(vec4<f32>(0,0,0,arg0),vec4<f32>(0,0,0,arg1));let b=SplitObservation(vec4<f32>(4,2,1,0),vec4<f32>(0,0,0,1));return splitCompose(splitTransfer(a,1,4,8),splitTransfer(b,2,4,8));`,inputs:[[0,1],[Math.log(2),1],[Math.log(2),5]]});
  assert.deepEqual(Array.from(r[0]),[8,4,2,1]);
  assert.ok(Math.abs(r[1][0]-4)<1e-5);assert.ok(Math.abs(r[1][3]-.5)<1e-5);
  assert.ok(r[2][0]>r[1][0]&&r[2][0]<8,'aging foreground opacity reveals rear emission');
  const age=await evalWgslBatch(ctx,{preamble:SPLIT_OPTICAL_MATH_WGSL,argTypes:['f32'],returnType:'vec4<f32>',body:'return splitTransfer(SplitObservation(vec4<f32>(4,2,1,1),vec4<f32>(0,0,0,arg0)),2,2,8);',inputs:[[1],[5]]});
  assert.ok(age[1][0]<age[0][0]);assert.ok(age[1][3]>age[0][3]);
 });
});
test('settings reject impossible budgets and preserve independent optical lifetimes',()=>{
 assert.throws(()=>splitIntegralSettings({fresh:3}),/1 or 2/);
 assert.throws(()=>splitIntegralSettings({exploration:2}),/fraction/);
 assert.deepEqual([splitIntegralSettings({memory:3,opacityMemory:8}).memory,splitIntegralSettings({memory:3,opacityMemory:8}).opacityMemory],[3,8]);
});

import {SPLIT_OPTICAL_WGSL,createSplitIntegral} from '../volume-split-integral.mjs';
test('production retained banks compose two local samples, refresh one, preserve pause and reset source',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owner=createSplitIntegral(d),empty=owner.emptyLayout;
  const target=d.createTexture({size:[1,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const code=`fn worldInsideFine(p:vec3<f32>)->bool{return true;}fn worldToCell(p:vec3<f32>)->vec3<f32>{return p;}
   fn sampleFluidSlot(p:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(0,0,1,0);}
   ${SPLIT_OPTICAL_WGSL}
   @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);}
   @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{
    let ro=vec3<f32>(0,0,-1);let rd=vec3<f32>(0,0,1);var r=splitInit(p.xy,ro,rd,0,2,.75);
    let t=splitSampleDepth(r,ro,rd,.5);let rear=t>1.0;
    splitObserve(&r,0u,ro+rd*t,select(vec3<f32>(0),vec3<f32>(4,2,1),rear),select(.69314718056,0.0,rear));
    if(splitOptions.size.z==2u){splitObserve(&r,1u,vec3<f32>(0,0,.5),vec3<f32>(4,2,1),0);}
    return splitFinish(r,0u,ro,rd);
   }`;
  const module=d.createShaderModule({code});const info=await module.getCompilationInfo();assert.deepEqual(info.messages.filter(m=>m.type==='error'),[]);
  const pipeline=d.createRenderPipeline({layout:d.createPipelineLayout({bindGroupLayouts:[empty,empty,empty,owner.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
  const viewProj=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  async function draw(settings,step,identity='a'){
   const e=d.createCommandEncoder(),prepared=owner.prepare(e,{width:1,height:1,settings,identity,step,viewProj,backtrace:.1,fineScale:1,staggered:false});
   const p=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});p.setPipeline(pipeline);for(let i=0;i<3;i++)p.setBindGroup(i,owner.emptyGroup);p.setBindGroup(3,prepared.group);p.draw(3);p.end();
   const b=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:target},{buffer:b,bytesPerRow:256},[1,1]);d.queue.submit([e.finish()]);
   try{await b.mapAsync(GPUMapMode.READ);return {state:prepared.state,value:Array.from(new Float32Array(b.getMappedRange()).slice(0,4)),sample:await owner.sample()};}finally{b.unmap();b.destroy();}
  }
  try{
   const split=await draw({mode:'split'},10);assert.ok(Math.abs(split.value[0]-2)<1e-5);assert.ok(Math.abs(split.value[3]-.5)<1e-5);assert.equal(split.sample.records.length,16);assert.equal(split.state.freshEvaluations,2);
   const retained=await draw({mode:'transport',fresh:1,exploration:0,response:1,memory:100,opacityMemory:100},11);
   assert.equal(retained.state.freshEvaluations,1);assert.equal(retained.state.stepDelta,1);assert.ok(retained.sample.records[14]>.5,'rear source anchor advected independently');
   const paused=await draw({mode:'transport',fresh:1,exploration:0,response:1,memory:100,opacityMemory:100},11);
   assert.equal(paused.state.stepDelta,0);assert.equal(paused.sample.records[14],retained.sample.records[14]);
   const reset=await draw({mode:'transport',fresh:1},11,'new-camera');assert.equal(reset.state.frames,1);assert.equal(reset.sample.records[15],0,'old rear contribution absent after source reset');
   owner.disable();assert.equal(owner.read().bytes,0);assert.equal((await owner.sample()).available,false);
  }finally{owner.dispose();target.destroy();}
 });
});
