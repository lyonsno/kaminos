// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRayStepTelemetry} from '../volume-ray-step-telemetry.mjs';

function fixture(){
  globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4};
  globalThis.GPUShaderStage={COMPUTE:1};
  globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2,RENDER_ATTACHMENT:4};
  navigator.gpu={getPreferredCanvasFormat:()=> 'bgra8unorm'};
  const buffers=[],calls=[];
  const device={limits:{maxBufferSize:4096,maxStorageBufferBindingSize:2048,maxComputeWorkgroupsPerDimension:2},
    createBuffer(options){const buffer={...options,destroy(){this.destroyed=true;}};buffers.push(buffer);return buffer;},
    createShaderModule:()=>({}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),
    createComputePipeline:()=>({getBindGroupLayout:()=>({})}),createRenderPipeline:()=>({getBindGroupLayout:()=>({})}),
    createBindGroup:()=>({}),createTexture:()=>({createView:()=>({}),destroy(){calls.push('destroy-atlas');}}),
    queue:{copyExternalImageToTexture(){calls.push('font-upload');}}};
  const context={configure(){calls.push('configure');},unconfigure(){calls.push('unconfigure');},getCurrentTexture:()=>({createView:()=>({})})};
  const canvas={style:{},visible:true,getClientRects(){return this.visible?[{}]:[];},getContext:()=>context};
  const document={createElement:()=>({getContext:()=>({fillText(){}})})};
  const meter=createRayStepTelemetry(device,{document});
  return {meter,canvas,buffers,calls};
}

test('unavailable statistics cannot retain a live or stale display',()=>{
  const {meter,canvas,buffers}=fixture();meter.setCanvas(canvas);
  assert.equal(meter.ensure(128,128,false),false);assert.equal(buffers.length,1);
  assert.equal(meter.read().reason,'off');assert.equal(meter.active,false);
  meter.ensure(8,8,true,{supported:false,reason:'alternate-route'});
  assert.equal(meter.read().reason,'alternate-route');assert.equal(canvas.style.visibility,'hidden');
  canvas.visible=false;meter.ensure(8,8,true);assert.equal(meter.read().reason,'inspector-hidden');
  canvas.visible=true;meter.ensure(1024,1,true);assert.equal(meter.read().reason,'counter-buffer-exceeds-device-limits');
  assert.equal(meter.encode({}),false);assert.equal(buffers.length,1);
  meter.dispose();assert.equal(buffers[0].destroyed,true);
});
test('instrumentation allocates the actual pixel population and releases counters when disabled',()=>{
  const {meter,canvas,buffers,calls}=fixture();meter.setCanvas(canvas);
  assert.equal(meter.ensure(16,16,true),true);assert.equal(meter.counterBuffer.size,1024);
  assert.equal(meter.active,true);assert.equal(meter.read().readback,false);
  assert.equal(canvas.style.visibility,'visible');assert.equal(meter.ensure(16,16,true),false);
  const counter=meter.counterBuffer;assert.equal(meter.ensure(16,16,false),true);
  assert.equal(counter.destroyed,true);assert.equal(meter.counterBuffer.size,4);assert.equal(canvas.style.visibility,'hidden');
  meter.dispose();assert.ok(buffers.every(buffer=>buffer.destroyed));assert.ok(calls.includes('destroy-atlas'));
});
test('GPU work is encoded only on demand, with enough dispatch groups for every pixel',()=>{
  const {meter,canvas}=fixture();meter.setCanvas(canvas);meter.ensure(500,1,true);
  const dispatches=[],draws=[];
  const pass={setPipeline(){},setBindGroup(){},dispatchWorkgroups(...args){dispatches.push(args);},end(){}};
  const encoder={clearBuffer(){},beginComputePass:()=>pass,beginRenderPass:()=>({...pass,draw:n=>draws.push(n)})};
  assert.equal(meter.encode(encoder),true);
  assert.deepEqual(dispatches,Array.from({length:4},()=>[[2,1],[1]]).flat());assert.deepEqual(draws,[3]);
  meter.dispose();
});
test('resource preflight allocates without presenting an unrendered summary',()=>{
  const {meter,canvas}=fixture();meter.setCanvas(canvas);
  assert.equal(meter.ensure(8,8,true,{activate:false}),true);
  const prepared=meter.counterBuffer;assert.equal(prepared.size,256);
  assert.equal(meter.active,false);assert.equal(canvas.style.visibility,'hidden');
  assert.equal(meter.encode({}),false);
  assert.equal(meter.read().reason,'awaiting-instrumented-draw');
  assert.equal(meter.ensure(8,8,true,{allowResize:false}),false);
  assert.equal(meter.counterBuffer,prepared);assert.equal(meter.active,true);
  meter.dispose();
});
test('a draw cannot replace counters already referenced by an earlier pass',()=>{
  const {meter,canvas}=fixture();meter.setCanvas(canvas);
  const placeholder=meter.counterBuffer;
  meter.ensure(8,8,true,{allowResize:false});
  assert.equal(placeholder.destroyed,undefined,'first enable must wait for frame preflight');
  assert.equal(meter.active,false);assert.equal(meter.read().reason,'counter-buffer-not-prepared');
  meter.ensure(8,8,true);const recorded=meter.counterBuffer;
  meter.ensure(16,16,true,{allowResize:false});
  assert.equal(recorded.destroyed,undefined,'a resize cannot retire an encoded dependency');
  assert.equal(meter.active,false);assert.equal(meter.read().reason,'counter-buffer-not-prepared');
  meter.ensure(16,16,true);assert.equal(recorded.destroyed,true);
  assert.equal(meter.ensure(16,16,true,{allowResize:false}),false);assert.equal(meter.active,true);
  meter.dispose();
});
