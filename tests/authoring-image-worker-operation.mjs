// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import * as page from '../authoring-image-generation.mjs';
import * as operation from '../authoring-image-operation.mjs';

test('the page keeps the existing operation exports',()=>{
  for(const [name,value] of Object.entries(operation))assert.equal(page[name],value,name);
  assert.equal(typeof page.createForegroundHandoff,'function');
  assert.equal(typeof page.installKleinImageGeneration,'function');
});

test('a worker executes preparation and repeated generation using only its injected app host',async()=>{
  const worker=new Worker(`
    const {parentPort,isMainThread}=require('node:worker_threads');
    (async()=>{
      const {createKleinAuthoringImageGeneration,readPngProvenance}=await import(${JSON.stringify(new URL('../authoring-image-operation.mjs',import.meta.url).href)});
      const log=[],device={features:new Set(['shader-f16']),queue:{onSubmittedWorkDone:async()=>{}}},png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
      let loads=0,prepared=0;
      const session={registerRoute:async({routeId})=>({routeId,runtime:{runInvocation:async(_options,work)=>work({})},
        enqueue:({execute})=>({completion:Promise.resolve().then(()=>execute({})).then(output=>({status:'succeeded',output}))}),
        drain:async()=>log.push('drain')}),unregisterRoute:()=>log.push('unregister')};
      const app={queue:device.queue,session:()=>session,beginRun:async()=>({foregroundOpportunities:{},withForeground:async(_phase,work)=>work(),finish:async()=>log.push('finish')})};
      const saved=[];
      const service=createKleinAuthoringImageGeneration({
        context:()=>({sharedGpu:{device}}),appHost:()=>app,weights:async()=>'/weights',
        kit:async()=>({createWebGpuInferenceControl:()=>({close:async()=>log.push('close')})}),
        prepareReference:async()=>{prepared++;log.push('reference');return {width:16,height:16,rgb:new Float32Array(768),provenance:{source:'/reference.png'}};},
        createPipeline:()=>({load:async()=>{loads++;log.push('load');},generate:async request=>{
          log.push('generate');request.onStep(1,1);
          return {width:request.width,height:request.height,rgba:new Uint8ClampedArray(request.width*request.height*4),timings:{}};
        }}),
        encodePng:async()=>new Blob([png],{type:'image/png'}),
        deliver:async(file,provenance)=>{saved.push(readPngProvenance(new Uint8Array(await file.arrayBuffer())));return {source:'/saved/'+file.name};},
      });
      await service.run({prompt:'copper lantern',seed:1,size:256,reference:{kind:'image',source:'/reference.png'}});
      await service.run({prompt:'blue kettle',seed:2,size:256});
      parentPort.postMessage({isMainThread,loads,prepared,log,saved,state:service.read()});
    })().catch(error=>{throw error;});
  `,{eval:true});
  let result;
  try{
    result=await new Promise((resolve,reject)=>{
      worker.once('message',resolve);worker.once('error',reject);
      worker.once('exit',code=>reject(Error(`Worker exited before returning its operation result (${code})`)));
    });
  }finally{await worker.terminate();}
  assert.equal(result.isMainThread,false);
  assert.equal(result.loads,1);assert.equal(result.prepared,1);
  assert.deepEqual(result.log,['reference','load','generate','close','unregister','finish','drain','unregister','generate','close','unregister','finish','drain','unregister']);
  assert.deepEqual(result.saved.map(p=>[p.seed,p.width,p.height]),[[1,256,256],[2,256,256]]);
  assert.equal(result.saved[0].reference.source,'/reference.png');
  assert.equal(result.state.status,'complete');assert.equal(result.state.results.length,2);
});
