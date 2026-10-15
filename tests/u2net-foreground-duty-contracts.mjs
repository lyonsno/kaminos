// kaminos-test: node
// U2Net shares the page GPU like other kit producers: with a foreground run it
// submits in segments and services a before-encode boundary before each one,
// honours Stop between segments, and without one keeps a single submission.
import assert from 'node:assert/strict';
import {createU2NetRunner} from '../models/u2net/u2net-webgpu.js';
import {removeForegroundU2Net} from '../models/u2net/rembg-u2net.js';

// A tiny graph with the same op kinds at a 320x320 input, and a recording mock device.
const shape=c=>[1,c,320,320];
const ops=[];
let prev='input.1',w=0;
for(let i=0;i<40;i++){ops.push({op:'conv',input:prev,output:'t'+i,inShape:shape(i?1:3),outShape:shape(1),kernel:1,dilation:1,pad:0,relu:true,weight:w,bias:w+(i?1:3)});w+=(i?1:3)+1;prev='t'+i;}
ops.push({op:'sigmoid',inputs:[prev],output:'out',outShape:shape(1)});
const graph={input:{name:'input.1',shape:shape(3)},output:'out',ops};
function mockDevice(log){
  const buffer=size=>({size,destroy(){},mapAsync:async()=>{},getMappedRange:()=>new ArrayBuffer(size),unmap(){}});
  return {
    createBuffer:({size})=>buffer(size),
    createShaderModule:()=>({}),
    createComputePipeline:()=>({getBindGroupLayout:()=>({})}),
    createBindGroup:()=>({}),
    createCommandEncoder(){let n=0;return {beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){n++;},end(){}}),copyBufferToBuffer(){},finish:()=>({dispatches:n})};},
    queue:{writeBuffer(){},submit(list){for(const c of list)log.push(['submit',c.dispatches]);},onSubmittedWorkDone:async()=>{}},
  };
}
const input=new Float32Array(3*320*320);

// Without a foreground run: one submission of every dispatch.
{const log=[];const runner=createU2NetRunner({device:mockDevice(log),graph,weights:new Float32Array(w+8)});
  await runner.run(input);assert.deepEqual(log,[['submit',41]]);}

// With a foreground run: a valid before-encode boundary precedes every segment.
{const log=[];const runner=createU2NetRunner({device:mockDevice(log),graph,weights:new Float32Array(w+8)});
  const foreground={foregroundOpportunities:{serviceAtBoundary:async b=>{
    for(const k of ['invocationId','boundaryId','dutyId','phase'])assert.ok(typeof b[k]==='string'&&b[k],k);
    assert.equal(b.position,'before-encode');log.push(['boundary',b.dutyId]);}}};
  await runner.run(input,{foreground,invocationId:'u2net-test'});
  const submits=log.filter(e=>e[0]==='submit'),boundaries=log.filter(e=>e[0]==='boundary');
  assert.ok(submits.length>1,'segmented submission');
  assert.equal(submits.reduce((s,e)=>s+e[1],0),41,'every dispatch submitted once');
  assert.equal(boundaries.length,submits.length);
  log.forEach((e,i)=>{if(e[0]==='submit')assert.equal(log[i-1][0],'boundary','boundary serviced before each segment');});
  assert.equal(new Set(boundaries.map(b=>b[1])).size,boundaries.length,'distinct duty ids');}

// Stop between segments: AbortError, and no further segments are submitted.
{const log=[];const runner=createU2NetRunner({device:mockDevice(log),graph,weights:new Float32Array(w+8)});
  const stop=new AbortController();let seen=0;
  const foreground={foregroundOpportunities:{serviceAtBoundary:async()=>{if(++seen===2)stop.abort();}}};
  await assert.rejects(runner.run(input,{foreground,signal:stop.signal}),e=>e.name==='AbortError');
  assert.equal(log.length,1,'only the segment before Stop was submitted');}

// The foreground run reaches the runner through removeForegroundU2Net, and CPU stages run in foreground windows.
{const windows=[];let passed;
  const runner={run:async(_,options)=>{passed=options;return {mask:new Float32Array(320*320).fill(0.5)};}};
  const foreground={foregroundOpportunities:{serviceAtBoundary:async()=>{}},withForeground:async(phase,work)=>{windows.push(phase);return work();}};
  const px=new Uint8Array(40*30*3).fill(128);
  await removeForegroundU2Net({pixels:px,width:40,height:30,runner,foreground});
  assert.equal(passed.foreground,foreground,'runner receives the foreground run');
  assert.ok(windows.length>=2,'CPU stages run inside foreground windows');}

// Handback through the real kit foreground service: a page frame that arrives
// on the next event-loop turn after the first segment must reach the GPU queue
// before the last model segment, not wait behind the whole network.
{
  const kit=await import('../webgpu-inference-kit/src/index.js');
  const queueLog=[];let frameRequested=false,service;
  const device=mockDevice([]);
  device.queue={writeBuffer(){},
    submit(list){for(const c of list){queueLog.push(typeof c==='string'?c:'model');
      if(typeof c!=='string'&&!frameRequested){frameRequested=true;
        setImmediate(()=>service.request({requestId:'page-frame',run:ctx=>{ctx.submit(['page-frame']);return 'page-frame';}}));}}},
    onSubmittedWorkDone:()=>new Promise(resolve=>setImmediate(resolve))};
  service=kit.createWebGpuForegroundService({routeId:'u2net-test',device,queue:device.queue});
  const run=await service.beginRun('u2net-run');
  const runner=createU2NetRunner({device,graph,weights:new Float32Array(w+8)});
  await runner.run(input,{foreground:run,invocationId:'u2net-run'});
  await run.finish();
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r)); // let a late frame drain as an idle frame
  const frameAt=queueLog.indexOf('page-frame'),lastModel=queueLog.lastIndexOf('model');
  assert.ok(frameAt>=0,'page frame submitted');
  assert.ok(frameAt<lastModel,`page frame must interleave between U2Net segments (queue: ${queueLog.join(',')})`);
  await service.dispose();
}

// segmentSize must be a positive safe integer; a size beyond the dispatch count is one segment.
{const fg={foregroundOpportunities:{serviceAtBoundary:async()=>{}}};
  for(const bad of [0,-1,NaN,Infinity,1.5,'8',null]){const log=[];
    const runner=createU2NetRunner({device:mockDevice(log),graph,weights:new Float32Array(w+8)});
    await assert.rejects(runner.run(input,{foreground:fg,segmentSize:bad}),RangeError,String(bad));
    assert.equal(log.length,0,'nothing submitted for '+String(bad));}
  const log=[];const runner=createU2NetRunner({device:mockDevice(log),graph,weights:new Float32Array(w+8)});
  await runner.run(input,{foreground:fg,segmentSize:1000});assert.deepEqual(log,[['submit',41]]);}

// Stop from a separate browser task, through the real kit service: later segments are not submitted.
{const kit=await import('../webgpu-inference-kit/src/index.js');
  const log=[];const device=mockDevice(log);
  device.queue.onSubmittedWorkDone=()=>new Promise(resolve=>setImmediate(resolve));
  const service=kit.createWebGpuForegroundService({routeId:'u2net-stop',device,queue:device.queue});
  const run=await service.beginRun('u2net-stop');const stop=new AbortController();
  setImmediate(()=>stop.abort());
  const runner=createU2NetRunner({device,graph,weights:new Float32Array(w+8)});
  await assert.rejects(runner.run(input,{foreground:run,signal:stop.signal,segmentSize:8}),e=>e.name==='AbortError');
  await run.finish();await service.dispose();
  assert.ok(log.length<6,`Stop must land before the remaining segments (submits: ${log.length})`);}
