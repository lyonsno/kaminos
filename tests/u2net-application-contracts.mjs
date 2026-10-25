// kaminos-test: node
import assert from 'node:assert/strict';
import * as api from '../models/u2net/u2net-webgpu.js';
import {createWebGpuInferenceSession, createWebGpuForegroundService} from '../webgpu-inference-kit/src/core.js';
import {removeForegroundU2Net} from '../models/u2net/rembg-u2net.js';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const graph={schema:'kaminos.u2net-package.v0',input:{name:'input',shape:[1,3,320,320]},output:'out',ops:[
  {op:'sigmoid',inputs:['input'],output:'out',outShape:[1,1,320,320]}]};
function device({failPipeline=false,failMap=false}={}) {
  const buffers=[],log=[];
  return {buffers,log,features:new Set(),limits:{},lost:new Promise(()=>{}),destroyed:0,
    destroy(){this.destroyed++;},addEventListener(){},removeEventListener(){},
    createBuffer({size,usage}) { const b={size,usage,destroyed:0,destroy(){this.destroyed++;},
      async mapAsync(){if(failMap)throw Error('map failed');},unmap(){},getMappedRange(){return new ArrayBuffer(size);}};buffers.push(b);return b; },
    createShaderModule:()=>({}),createComputePipeline:()=>{if(failPipeline)throw Error('pipeline failed');return {getBindGroupLayout:()=>({})};},
    createBindGroup:()=>({}),createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),copyBufferToBuffer(){},finish:()=>('model')}),
    queue:{writeBuffer(){},submit(items){log.push(...items);},onSubmittedWorkDone:tick}
  };
}
// Failed construction must not strand buffers the application cannot reach.
{
  const dev=device({failPipeline:true});
  assert.throws(()=>api.createU2NetRunner({device:dev,graph,weights:new Float32Array()}),/pipeline failed/);
  assert.ok(dev.buffers.length>0);
  assert.ok(dev.buffers.every(b=>b.destroyed===1),'failed U2Net construction must release all model allocations');
}
// A rejected readback retires every temporary buffer and leaves resident state disposable.
{
  const dev=device({failMap:true}),r=api.createU2NetRunner({device:dev,graph,weights:new Float32Array()});
  await assert.rejects(r.run(new Float32Array(3*320*320),{capture:['input']}),/map failed/);
  assert.ok(dev.buffers.filter(b=>b.usage&1).every(b=>b.destroyed===1),'all staging buffers retire on readback failure');
  r.dispose();assert.ok(dev.buffers.every(b=>b.destroyed===1));
}
const {createU2NetApp}=await import('../models/u2net/u2net-app.js');
{
 const dev=device(),adapter={features:dev.features,limits:dev.limits,info:{vendor:'fixture'},requestDevice:async()=>dev};
 const app=await createU2NetApp({gpu:{requestAdapter:async()=>adapter},load:false});
 assert.equal(app.device,dev);await app.destroy();assert.equal(dev.destroyed,1,'owned device retires');
}
const pkg={graph,weights:new Float32Array()};
const pixels=new Uint8Array(4*3*3).fill(128),image={pixels,width:4,height:3};
async function frame(f,id){assert.equal((await f.request({requestId:id,run:c=>c.submit([id])}).completion).status,'completed');}
{
  const dev=device(),session=await createWebGpuInferenceSession({device:dev,sessionId:'u2net-shared',adapterName:'fixture'}),foreground=createWebGpuForegroundService({device:dev,routeId:'host'});
  const route=await session.registerRoute({routeId:'host'}),held=deferred(),entered=deferred();
  const host=route.enqueue({jobId:'host-run',execute:async()=>{const f=await foreground.beginRun('host-run');entered.resolve();await held.promise;await f.finish();}});
  await entered.promise;
  let loads=0,fail=true;
  const app=await createU2NetApp({session,foreground,load:false,loadPackage:async()=>{loads++;if(fail)throw Error('load failed');return pkg;}});
  const load=app.load();assert.equal(app.load(),load);await tick();assert.equal(loads,0,'load waits for admission');
  held.resolve();await host.completion;await assert.rejects(load,/load failed/);assert.equal(app.model,null);
  fail=false;await app.load();assert.equal(loads,2);
  const b=await createU2NetApp({session,foreground,loadPackage:async()=>pkg});assert.notEqual(app.routeId,b.routeId);
  const direct=await removeForegroundU2Net({...image,runner:app.model});
  const result=await app.removeForeground(image);assert.deepEqual(result,direct,'complete result/provenance retained');
  await Promise.all([app.removeForeground(image),b.removeForeground(image)]);
  const wait=deferred(),inHost=deferred();
  const busy=route.enqueue({jobId:'host-busy',execute:async()=>{const f=await foreground.beginRun('host-busy');inHost.resolve();await wait.promise;await f.finish();}});
  await inHost.promise;const pending=app.removeForeground(image);await tick();app.stop();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(foreground.snapshot().activeRun.runId,'host-busy');wait.resolve();await busy.completion;
  await assert.rejects(app.removeForeground({...image,pixels:new Uint8Array(1)}),/complete/);
  await app.removeForeground(image);await frame(foreground,'after');
  const closing=app.destroy();assert.equal(app.destroy(),closing);await closing;await b.destroy();
  assert.equal(session.snapshot().routes.length,1);assert.equal(session.snapshot().status,'active');assert.equal(foreground.snapshot().disposed,false);assert.equal(dev.destroyed,0);
  await frame(foreground,'after-destroy');assert.ok(dev.buffers.every(b=>b.destroyed===1));
  assert.throws(()=>app.removeForeground(image),/destroyed/);
  await foreground.dispose();session.close();
}
// Pause owns the actual GPU duty; stop while parked releases it and permits a repeat.
{
  const dev=device(),app=await createU2NetApp({device:dev,loadPackage:async()=>pkg});
  const entered=deferred(),release=deferred();
  // A real control paused during the preceding CPU window also gates the GPU call.
  const run=app.removeForeground({...image,onPhase:async phase=>{if(phase==='u2net-input'){entered.resolve();await release.promise;}}});
  await entered.promise;const paused=app.pause();release.resolve();assert.equal((await paused).status,'paused');
  await frame(app.foreground,'paused');app.stop();await assert.rejects(run,{name:'AbortError'});
  await app.removeForeground(image);await app.destroy();assert.ok(dev.buffers.every(b=>b.destroyed===1));
}
// Destroy cancels a failed/pending load without creating a model after closure.
{
  const dev=device(),started=deferred();
  const app=await createU2NetApp({device:dev,load:false,loadPackage:async(_, {signal})=>{
    started.resolve();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true});});
  }});
  const load=app.load();const outcome=load.catch(e=>e);await started.promise;await app.destroy();
  assert.equal((await outcome).name,'AbortError');assert.equal(dev.buffers.length,0);assert.equal(app.session.snapshot().status,'closed');
}
console.log('U2Net application admission, options, cancellation, retry and ownership passed');
