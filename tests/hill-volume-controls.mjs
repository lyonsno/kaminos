// kaminos-test: node
// Actual experiment/solver with a device accounting double. No shader-numerics claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
globalThis.window={};globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,INDIRECT:16,MAP_READ:32};globalThis.GPUMapMode={READ:1};
const modulePath=process.env.HILL_VOLUME_TEST_MODULE??path.resolve('experiments/hill-volume.experiment.mjs');
const {default:experiment}=await import(pathToFileURL(modulePath));
function accountingDevice(fence=async()=>{}){
 const writes=[];const makeBuffer=d=>({size:d.size,label:d.label,bytes:new ArrayBuffer(d.size),getMappedRange(){return this.bytes;},unmap(){},mapAsync:async()=>{},destroy(){this.destroyed=true;}});
 const device={limits:{maxStorageBufferBindingSize:1e9,maxBufferSize:1e9},addEventListener(){},removeEventListener(){},createBuffer:makeBuffer,
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({clearBuffer:b=>new Uint8Array(b.bytes).fill(0),copyBufferToBuffer:(a,ao,b,bo,n)=>new Uint8Array(b.bytes,bo,n).set(new Uint8Array(a.bytes,ao,n)),beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})}),
  queue:{writeBuffer(b,o,data){const raw=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);new Uint8Array(b.bytes,o,raw.length).set(raw);writes.push({label:b.label,offset:o,length:raw.length});},submit(){},onSubmittedWorkDone:fence}};
 return{device,writes};
}
async function instance({fence}={}){
 const {device,writes}=accountingDevice(fence),map=new Map(),events=[];let root,view={},frame;
 const renderer={backend:{isWebGPUBackend:true,device,get(a){if(!map.has(a)){const b=device.createBuffer({size:a.array.byteLength});new Uint8Array(b.bytes).set(new Uint8Array(a.array.buffer));map.set(a,{buffer:b});}return map.get(a);}},compute(){},_attributes:{delete:a=>map.get(a)?.buffer.destroy()}};
 const session={attach:async r=>{root=r;return{id:'volume-test',root:r};},setView:v=>view=v,readView:()=>view,redraw(){},onFrame:fn=>{frame=fn;return()=>{frame=null;};},dispose:async()=>{}};
 const host={scene:{open:async()=>session}};
 const value=await experiment.create({host,inputs:{config:{dimensions:[8,8,8],spacing:.15}},record:e=>events.push(e)});
 return{value,renderer,writes,events,tick:seconds=>frame?.({deltaSeconds:seconds}),render(){root.children[0].onBeforeRender(renderer);}};
}
test('queued release retains the selected rock before subsequent edits',async()=>{
 const i=await instance();try{i.render();await i.value.operations.setPlaying(false);const first=i.value.operations.release();const edit=i.value.operations.setSettings({rock:0});await Promise.all([first,edit]);
  const writes=i.writes.filter(w=>w.label==='Hill volume rigid state'&&w.length===4);assert.equal(writes.at(-1).offset,7*40*4+12,'release must target the rock selected when it was enqueued');assert.equal(i.events.find(e=>e.kind==='hill-volume.joint-release').rock,7);
 }finally{await i.value.dispose();}
});
test('Reset before first rendering defers initialization and can recover',async()=>{
 const i=await instance();try{await i.value.operations.reset();assert.equal(i.value.read().initialized,false);assert.equal(i.value.read().error,null);i.render();await i.value.operations.setPlaying(false);assert.equal(i.value.read().initialized,true);}finally{await i.value.dispose();}
});
test('queued material impulse retains its requested velocity before later edits',async()=>{
 const i=await instance();try{i.render();await i.value.operations.setPlaying(false);await Promise.all([i.value.operations.push(),i.value.operations.setSettings({pushSpeed:9})]);const gpu=i.value.operations.gpu();assert.equal(new Float32Array(gpu.params.bytes)[20],1.5);assert.equal(i.value.read().settings.pushSpeed,9);}finally{await i.value.dispose();}
});
test('Reset during aim supersedes the captured playback state',async()=>{
 const i=await instance();try{i.render();await i.value.operations.setPlaying(true);await i.value.operations.beginShove({origin:[0,1,2],direction:[0,0,-1]});assert.equal(i.value.read().playing,false);await i.value.operations.reset();await i.value.operations.cancelShove();assert.equal(i.value.read().playing,false,'Cancelling a stale drag must not restart a reset specimen');}finally{await i.value.dispose();}
});
test('spatial release targets its rock without changing the sidebar selection',async()=>{
 const i=await instance();try{i.render();await i.value.operations.setPlaying(false);await i.value.operations.release(0);const writes=i.writes.filter(w=>w.label==='Hill volume rigid state'&&w.length===4);assert.equal(writes.at(-1).offset,12,'The pin must release its own rock, not the sidebar rock');assert.equal(i.value.read().settings.rock,7);}finally{await i.value.dispose();}
});
test('multiple represented rocks can release without resetting existing free bodies',async()=>{
 const i=await instance();try{i.render();await i.value.operations.setPlaying(false);await i.value.operations.release(0);await i.value.operations.release(7);const anchors=i.value.read().anchors;assert.equal(anchors[0].attached,false);assert.equal(anchors[7].attached,false);assert.equal(anchors[1].canRelease,true);}finally{await i.value.dispose();}
});

test('playback services accumulated time using measured batches while exact advance remains exact',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=0,held=false,release;const gate=new Promise(r=>release=r);
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
 const i=await instance({fence:()=>held?gate:Promise.resolve()});
 try{i.render();await i.value.operations.setPlaying(true);held=true;i.tick(.016);await new Promise(setImmediate);
  assert.equal(i.value.read().gpu.steps,1,'Playback bootstraps one physical step before estimating service cost');
  for(let f=0;f<120;f++)i.tick(1/60);now=100;held=false;release();await i.value.operations.setSettings({rockPushZ:2});
  i.tick(.016);await i.value.operations.setSettings({rockPushZ:2});assert.equal(i.value.read().gpu.steps,2,'A slow batch must not turn two seconds of frame debt into one enormous GPU batch');
  assert.ok(i.value.read().playback.pendingSeconds>2,'Unprocessed wall time stays represented');
  await i.value.operations.advance(.03);assert.equal(i.value.read().gpu.completedSteps,22,'Exact advance still executes all20 requested substeps');
  assert.equal(i.value.read().playback.pendingSeconds,0,'Explicit paused advance clears interactive wall-clock credit');
 }finally{held=false;release();await i.value.dispose();Object.defineProperty(globalThis,'performance',original);}
});
