import {workerData,threadId} from 'node:worker_threads';
import * as THREE from '../../lib/three.webgpu.js';
import {installSceneWorkerHost} from '../../scene-worker-handoff.mjs';
import {createSceneWorkerMutationBinding} from '../../scene-worker-mutation-binding.mjs';
import {createSceneFrameComposition} from '../../scene-frame-composition.mjs';
import {createWebGpuForegroundService} from '../../webgpu-inference-kit/src/core.js';
installSceneWorkerHost({port:workerData.port,createRuntime:async()=>{
 const object=new THREE.Object3D(),device={queue:{submit(){}}};let finish,frames=0;
 const foreground=createWebGpuForegroundService({routeId:'worker-edits',device});
 const composition=createSceneFrameComposition({readInputs:()=>({}),draw:()=>frames++,frameCount:()=>frames});
 const appHost={device,queue:device.queue,activateFrames:async()=>composition.setForegroundServiceActive(true),
  requester:request=>foreground.request({...request,run:service=>composition.runForegroundFrame(()=>request.run(service))})};
 return {...createSceneWorkerMutationBinding({appHost}),
  commands:{model:async(_,ctx)=>{
   const snapshot=object.position.x,run=await foreground.beginRun('worker-model',{routeId:'klein'});
   return ctx.withFrames(async()=>{try{return await run.withForeground('cpu-wait',async()=>{
    const gate=new Promise(resolve=>finish=resolve);ctx.report({waiting:true});await gate;return {snapshot,threadId};
   });}finally{await run.finish();}});
  }},foregroundCommands:{move:(x,ctx)=>{ctx.assertCurrent();object.position.x=x;return {x:object.position.x,threadId};}},
  requestFrame:(_,ctx,draw)=>appHost.requester({requestId:ctx.requestId,run:draw}).completion,
  frame:()=>({x:object.position.x,threadId}),control:action=>{if(action!=='finish')throw Error('Unsupported test control');finish();return true;},
  retire:async()=>{await foreground.dispose();return {retired:true};},
 };
}});
