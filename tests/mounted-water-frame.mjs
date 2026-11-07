// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from '../lib/three.core.js';
import {createMlsJuiceRenderer} from '../mls-juice-renderer.mjs';
import {sceneLiquidCollider} from '../scene-liquid-support.mjs';
import {STAGE_MOLD_SOURCE,checkedStageMold} from '../stage-mold.mjs';

test('retained MLS rendering presents local particles in the current workshop frame',async()=>{
 globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2};
 const writes=[];const pipeline={getBindGroupLayout:()=>({})};
 const device={queue:{writeBuffer:(b,off,data)=>writes.push(Array.from(data))},createBuffer:()=>({destroy(){}}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createRenderPipelineAsync:async()=>pipeline,
  createBindGroup:()=>({}),createTexture:()=>({createView:()=>({}),destroy(){}})};
 const config={min:[-1,2,3],cell:.05,particleRadius:.02,capacity:2};
 const surface=await createMlsJuiceRenderer({device,solver:{config,particles:{},read:()=>({clock:{step:7}})}});
 const hostCamera=new PerspectiveCamera(45,1,.01,100),encoder={beginRenderPass:()=>({setPipeline(){},setBindGroup(){},draw(){},end(){}})};
 surface.encode({encoder,hostCamera,width:10,height:10,sceneColor:{},sceneDepth:{},target:{},presentationFrame:{translation:[4,5,6],scale:.2}});
 const data=writes.at(-1);for(const [i,n] of [3.8,5.4,6.6,.01].entries())assert.ok(Math.abs(data[64+i]-n)<1e-6,`presented domain word ${i}: ${data[64+i]} instead of ${n}`);
 assert.ok(Math.abs(data[70]-.004)<1e-6);assert.deepEqual(config.min,[-1,2,3]);assert.equal(config.cell,.05);surface.dispose();
});
test('the mounted mold participates in actual water support',()=>{
 const stageMold=checkedStageMold({schema:'kaminos.stage-mold.v1',label:'fixture',rows:['#####','#...#','#####'],pitch:.1,wallHeight:.2,baseThickness:.1});
 const collider=sceneLiquidCollider({id:'mold',type:'pbr',source:STAGE_MOLD_SOURCE,stageMold,transform:{position:[0,.25,0],rotation:[0,0,0],scale:[1,1,1]}});
 assert.equal(collider?.kind,'stage-mold','mold must not silently be absent from water collision');
});
test('material-frame rendering keeps optical thickness and depth tolerance in authored units',async()=>{
 globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2};
 const writes=[],pipeline={getBindGroupLayout:()=>({})};const device={queue:{writeBuffer:(b,o,d)=>writes.push(Array.from(d))},createBuffer:()=>({destroy(){}}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createRenderPipelineAsync:async()=>pipeline,createBindGroup:()=>({}),createTexture:()=>({createView:()=>({}),destroy(){}})};
 const surface=await createMlsJuiceRenderer({device,solver:{config:{min:[0,0,0],cell:.05,particleRadius:.02,capacity:1},particles:{},read:()=>({clock:{step:0}})}});
 surface.encode({encoder:{beginRenderPass:()=>({setPipeline(){},setBindGroup(){},draw(){},end(){}})},hostCamera:new PerspectiveCamera(),width:10,height:10,sceneColor:{},sceneDepth:{},target:{},presentationFrame:{translation:[0,0,0],scale:.05}});
 assert.equal(writes.at(-1).length,76,'the material must receive presentation scale as well as geometric radius');assert.ok(Math.abs(writes.at(-1)[72]-.05)<1e-7);surface.dispose();
});
