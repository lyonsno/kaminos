import {workerData,threadId} from 'node:worker_threads';
import {installSceneWorkerHost} from '../../scene-worker-handoff.mjs';
import {createSceneFrameComposition} from '../../scene-frame-composition.mjs';

installSceneWorkerHost({port:workerData.port,createRuntime:async({payload})=>{
  let frames=0,value=payload.value;
  const composition=createSceneFrameComposition({readInputs:()=>({}),frameCount:()=>frames,draw:()=>frames++});
  composition.setForegroundServiceActive(true);
  return {host:{unsettledRuns:()=>[]},commands:{
    edit(next,ctx){ctx.assertCurrent();value=next;return {threadId,value};},
    replace(next,ctx){ctx.advanceEpoch('scene');value=next;ctx.activate();return {threadId,value};},
  },frame:()=>({...composition.runForegroundFrame(()=>({status:'submitted'})),threadId,value}),retire:async()=>({threadId,retired:true})};
}});
