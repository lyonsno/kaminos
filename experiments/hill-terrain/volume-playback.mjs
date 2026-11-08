// Interactive service budget, not a physical-time or substep-count cap.
// Wall-clock credit is retained until completed steps service it. Exact/manual
// advances service their complete integer step count through the same budget.
export function createVolumePlayback({dt,frameBudgetSeconds=1/120/4,now=()=>performance.now()/1000}){
 if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(frameBudgetSeconds)||frameBudgetSeconds<=0)throw Error('Playback needs positive timestep and frame budget');
 let credit=0,stepSeconds=null,inFlight=null,hostSeconds=0,hostFrames=0,completedSeconds=0;
 const plan=available=>Math.min(available,stepSeconds===null?1:Math.max(1,Math.floor(frameBudgetSeconds/stepSeconds)));
 const observe=(steps,seconds)=>{if(steps>0&&Number.isFinite(seconds)&&seconds>0)stepSeconds=seconds/steps;};
 return{
  add(seconds){if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(credit+seconds))throw Error('Playback frame time must be finite and nonnegative');credit+=seconds;if(seconds>0){hostSeconds+=seconds;hostFrames++;}},
  plan,observe,
  take(){
   if(inFlight)return 0;const available=Math.floor(credit/dt);if(available<1)return 0;
   const steps=plan(available);
   credit-=steps*dt;inFlight={steps,started:now()};return steps;
  },
  complete(){if(!inFlight)return;const elapsed=now()-inFlight.started;observe(inFlight.steps,elapsed);completedSeconds+=inFlight.steps*dt;inFlight=null;},
  reset(){credit=0;inFlight=null;hostSeconds=0;hostFrames=0;completedSeconds=0;},
  read(){return{mode:'adaptive fixed-step service',dt,frameBudgetSeconds,hostFrameHz:hostSeconds>0?hostFrames/hostSeconds:null,physicalSecondsPerWallSecond:hostSeconds>0?completedSeconds/hostSeconds:null,completedPhysicalSeconds:completedSeconds,hostElapsedSeconds:hostSeconds,observedSecondsPerStep:stepSeconds,pendingSeconds:credit+(inFlight?.steps??0)*dt,inFlightSteps:inFlight?.steps??0};}
 };
}
