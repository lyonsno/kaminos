import {createWebGpuAdaptiveCommandDutyPlanner} from './webgpu-inference-kit/src/adaptive-command-duty.js';

// The renderer's animation frame is the cooperative yield. Submit at most one
// measured range per frame and retain the rest in the physical clock. Every
// item is a complete P2G/grid/G2P step, so rendering never observes a half step.
export function createMlsStepScheduling({targetDurationMs=8}={}) {
 if(!Number.isFinite(targetDurationMs)||targetDurationMs<=0)throw Error('Invalid MLS GPU batch target');
 let planner=null,range=null,hint=4,window=0,last=null;
 return {
  next(available){
   if(!Number.isSafeInteger(available)||available<1)throw Error('MLS scheduling needs elapsed physical steps');
   if(range)throw Error('MLS scheduling range is still pending');
   if(!planner||planner.snapshot().status==='complete')planner=createWebGpuAdaptiveCommandDutyPlanner({
    plannerId:`mls-steps-${++window}`,unit:'complete-physical-step',totalItems:available,
    initialChunkItems:Math.min(hint,available),targetDurationMs,
    bounds:{minChunkItems:1,maxChunkItems:available},adjustmentGain:.5,
   });
   range=planner.nextRange();return range.itemCount;
  },
  complete(durationMs){
   if(!range)throw Error('MLS scheduling completion without a range');
   last=planner.observeRange({rangeId:range.rangeId,observedDurationMs:durationMs,timingAuthority:'queue-work-done'});
   hint=last.nextChunkItems??range.plannedChunkItems;range=null;
  },
  // Offline exact stepping consumes time outside the live scheduling window.
  reset(){if(range)throw Error('Cannot reset pending MLS scheduling');planner=null;},
  read:()=>({policy:'adaptive-complete-physical-steps',targetDurationMs,nextBatchSteps:hint,
   timingAuthority:'queue-work-done',lastObservation:last}),
 };
}
