// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_RENDER_WGSL,WORLD_RENDER_STRIDE} from '../volume-world-render.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';

test('existing World coefficient preparation publishes valid conservative leaf support without changing its219texels',async()=>{
 const fixture=`struct EmissiveMaterial{emission:vec3<f32>,absorption:f32,scattering:f32}
 struct FixtureUniforms{emissive_material:vec4<f32>,open_world_boundary:vec4<f32>}
 var<private> u:FixtureUniforms;
 struct WorldRenderConfig{loPitch:vec4<f32>,hiEnabled:vec4<f32>,atlas:vec4<f32>}
 var<private> worldRender:WorldRenderConfig;
 fn seatGridShape(){}
 fn regionSmokeMaterial(m:vec4<f32>,thermal:vec3<f32>,smoke:f32,fire:f32)->EmissiveMaterial{return EmissiveMaterial(vec3<f32>(m.y*fire),m.x*smoke,0);}
 `;
 const code=fixture+WORLD_RENDER_WGSL;
 await withKaminosGpu(async ctx=>{
  await withGpuErrorScopes(ctx.device,'World-leaf-optical-support',async()=>{
   assert.equal(WORLD_RENDER_STRIDE,219);
   const device=ctx.device,S=GPUBufferUsage.STORAGE,D=GPUBufferUsage.COPY_DST;
   const gas=device.createBuffer({size:64*32,usage:S|D});
   const nodes=device.createBuffer({size:64,usage:S});
   const work=device.createBuffer({size:4,usage:S});
   const state=device.createBuffer({size:4,usage:S});
   const params=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|D});
   const atlas=device.createTexture({dimension:'3d',size:[7,7,5],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
   const read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{
    const data=new ArrayBuffer(48);new Float32Array(data).set([4,4,4,.5,-1,-1,-1,16]);new Uint32Array(data).set([1,1,1,1],8);device.queue.writeBuffer(params,0,data);
    const module=await ctx.compileShaderModule({label:'actual World preparation support',code});
    const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'prepareWorldRender'}});
    const groups=[0,1,2].map(i=>device.createBindGroup({layout:pipeline.getBindGroupLayout(i),entries:[]}));
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(3),entries:[{binding:4,resource:{buffer:gas}},{binding:5,resource:{buffer:nodes}},{binding:6,resource:{buffer:work}},{binding:7,resource:{buffer:params}},{binding:8,resource:atlas.createView()},{binding:9,resource:{buffer:state}}]});
    const prepare=async(values)=>{
     device.queue.writeBuffer(gas,0,values);const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);groups.forEach((g,i)=>pass.setBindGroup(i,g));pass.setBindGroup(3,group);pass.dispatchWorkgroups(1);pass.end();
     encoder.copyTextureToBuffer({texture:atlas,origin:[2,0,0]},{buffer:read,bytesPerRow:256,rowsPerImage:1},[1,1,1]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const bound=Array.from(new Float32Array(read.getMappedRange().slice(0,16)));read.unmap();return bound;
    };
    const values=new Float32Array(64*8);
    const empty=await prepare(values);assert.deepEqual(empty,[0,0,0,1],'new authoritative preparation certifies empty; old unused leaf storage must not masquerade as metadata');
    values[21*8+1]=3;const thinEmission=await prepare(values);assert.ok(thinEmission[0]>=3&&thinEmission[2]>=3&&thinEmission[3]===1,'single emitting cell anywhere in the prepared support forbids an empty leaf');
    values.fill(0);values[42*8]=2;const soot=await prepare(values);assert.ok(soot[1]>=2&&soot[2]>=2&&soot[3]===1,'single extinction cell forbids an empty leaf');
    const restored=await prepare(new Float32Array(64*8));assert.deepEqual(restored,[0,0,0,1],'new source replaces prior support rather than accumulating stale positives');
    new Float32Array(data)[7]=0;device.queue.writeBuffer(params,0,data);assert.deepEqual(await prepare(values),[0,0,0,0],'featureOff invalidates old valid metadata rather than admitting stale support');
    new Float32Array(data)[7]=16;device.queue.writeBuffer(params,0,data);assert.equal((await prepare(values))[3],1,'featureOn requires fresh authoritative preparation');
   }finally{gas.destroy();nodes.destroy();work.destroy();state.destroy();params.destroy();atlas.destroy();read.destroy();}
  });
 },{wgslSources:[{label:'World-support-preparation',code,entryPoint:'prepareWorldRender'}]});
});
