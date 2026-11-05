// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {createIntegralReconstruction,INTEGRAL_FILTER_FUNCTIONS_WGSL} from '../volume-integral-reconstruction.mjs';

test('production uncertainty and rejection functions distinguish stability, noise and motion',async()=>{
  await withKaminosGpu(async ctx=>{
    const options={preamble:INTEGRAL_FILTER_FUNCTIONS_WGSL,argTypes:['f32','f32','f32','f32'],returnType:'f32',
      body:'return integralReuse(vec2<f32>(arg0,0),vec2<f32>(arg1,0),vec2<f32>(arg2),arg3,.875);',
      inputs:[[1,1,0,1],[1,0,0,1],[1,0,1,1],[1,0,0,0]]};
    const r=await evalWgslBatch(ctx,options);
    assert.ok(Math.abs(r[0]-.875)<1e-6);assert.ok(r[1]<1e-6);assert.ok(r[2]>.3);assert.ok(Math.abs(r[3]-.875)<1e-6);
    const bad=INTEGRAL_FILTER_FUNCTIONS_WGSL.replace('exp(-response*dot(d,d))','1.0');
    const wrong=await evalWgslBatch(ctx,{...options,preamble:bad});assert.ok(wrong[1]>.8,'negative control removes motion rejection');
  });
});

test('actual GPU image banks smooth linear light AND transmission, retain noise, reset and release',async()=>{
  await withKaminosGpu(async ctx=>{
    const d=ctx.device,h=createIntegralReconstruction(d);
    const camera=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,.6,0,0,0,0,0]);
    const target=d.createTexture({size:[3,3],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    const read=async texture=>{
      const b=d.createBuffer({size:768,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const e=d.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:256},[3,3]);d.queue.submit([e.finish()]);
      await b.mapAsync(GPUMapMode.READ);const data=new Float32Array(b.getMappedRange().slice(0));const center=Array.from(data.slice(64+4,64+8));b.unmap();b.destroy();return center;
    };
    const draw=async (controls,values,identity='camera-a',step=0)=>{
      const e=d.createCommandEncoder();h.prepare(3,3,controls,identity,step);
      d.queue.writeTexture({texture:h.raw},new Float32Array(values.flat()),{bytesPerRow:48},[3,3]);
      d.queue.writeTexture({texture:h.guide},new Float32Array(9).fill(10),{bytesPerRow:12},[3,3]);
      const state=h.encode(e,target.createView(),'rgba8unorm',camera);d.queue.submit([e.finish()]);return {state,value:await read(h.output),moments:await read(h.moments)};
    };
    try {
      const pixels=Array.from({length:9},(_,i)=>i===4?[3,2,1,.2]:[1,1,1,.8]);
      const raw=await draw({integralReconstruction:'spatial',reconstructionSpatial:0},pixels);
      assert.deepEqual(raw.value.map(x=>+x.toFixed(4)),[3,2,1,.2]);
      const blur=await draw({integralReconstruction:'spatial',reconstructionSpatial:1,reconstructionEdge:0},pixels,'blur');
      assert.ok(blur.value[0]<3&&blur.value[0]>1);assert.ok(blur.value[3]>.2&&blur.value[3]<.8);
      assert.ok(blur.moments[2]>blur.moments[0]**2,'spatial variation seeds uncertainty');
      const t={integralReconstruction:'temporal',reconstructionResponse:0,reconstructionWindow:8};
      await draw(t,pixels,'temporal');
      const changed=pixels.map((v,i)=>i===4?[1,1,1,.8]:[3,2,1,.2]);
      const retained=await draw(t,changed,'temporal');
      assert.ok(Math.abs(retained.value[0]-2)<1e-5);assert.ok(Math.abs(retained.value[3]-.5)<1e-5);
      const reset=await draw(t,changed,'new-camera');assert.equal(reset.state.frames,1);assert.ok(Math.abs(reset.value[0]-1)<1e-5);
      const jump=await draw(t,pixels,'new-camera',20);assert.equal(jump.state.resetReason,'simulation-discontinuity');assert.equal(jump.state.frames,1);
      h.disable();assert.equal(h.describe().bytes,0);
    }finally{h.dispose();target.destroy();}
  });
});
