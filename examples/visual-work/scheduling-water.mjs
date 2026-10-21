import fs from 'node:fs/promises';
import path from 'node:path';
import {checkWater} from './scheduling-evidence.mjs';

export default async function waterCase({page,retain,inputs,out}) {
  await page.waitForFunction(()=>{
    const s=window.kaminosLocalLiquidState();
    if(s.failure)throw Error(s.failure);
    return s.mounted && s.solver?.stepCount>0;
  });
  await page.exposeFunction('assayStarted',()=>process.send?.({type:'water-start',at:Date.now()}));
  const evidence=await page.evaluate(async requestedSteps=>{
    window.kaminosPauseLocalLiquid(true);
    const initial=window.kaminosLocalLiquidState(),startStep=initial.solver.stepCount;
    const samples=[];
    await window.assayStarted();
    window.kaminosPauseLocalLiquid(false);
    await new Promise((resolve,reject)=>{
      const tick=()=>{
        const state=window.kaminosLocalLiquidState();
        if(state.failure){reject(Error(state.failure));return;}
        samples.push({at:Date.now(),step:state.solver.stepCount});
        if(state.solver.stepCount-startStep>=requestedSteps){window.kaminosPauseLocalLiquid(true);resolve();}
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return {requestedSteps,startStep,initial,samples,state:window.kaminosLocalLiquidState()};
  },inputs.steps);
  await fs.writeFile(path.join(out,'water.json'),JSON.stringify(evidence,null,2));
  checkWater(evidence);
  await retain({name:'water',observe:async()=>evidence.state});
  return {steps:evidence.requestedSteps,startStep:evidence.startStep,finalStep:evidence.state.solver.stepCount};
}
