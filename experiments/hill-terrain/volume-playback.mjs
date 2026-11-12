// Physical frame credit determines the minimum normal service quantum. A queue
// completion wait includes dispatch/presentation latency; treating it as the
// incremental cost of one step can trap playback at one step per host frame.
// Measured allowance governs extra catch-up work, never the current-frame due
// work. All unserved time remains credit, including after a host/queue stall.
export function createVolumePlayback({dt,frameBudgetSeconds=1/120/4,maxBatchSeconds=Infinity,now=()=>performance.now()/1000}){
 if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(frameBudgetSeconds)||frameBudgetSeconds<=0)throw Error('Playback needs positive timestep and frame budget');
 let credit=0,stepSeconds=null,inFlight=null,hostSeconds=0,hostFrames=0,completedSeconds=0;
 const frameIntervals=[1/120,1/120];
 const frameSeconds=()=>[...frameIntervals].sort((a,b)=>a-b)[Math.floor(frameIntervals.length/2)];
 const plan=available=>Math.min(available,Math.max(1,Math.ceil(maxBatchSeconds/dt)),Math.max(1,Math.ceil(frameSeconds()/dt),stepSeconds===null?0:Math.floor(frameBudgetSeconds/stepSeconds)));
 const observe=(steps,seconds)=>{if(steps>0&&Number.isFinite(seconds)&&seconds>0)stepSeconds=seconds/steps;};
 return{
  add(seconds){if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(credit+seconds))throw Error('Playback frame time must be finite and nonnegative');credit+=seconds;if(seconds>0){hostSeconds+=seconds;hostFrames++;frameIntervals.push(seconds);if(frameIntervals.length>3)frameIntervals.shift();}},
  plan,observe,
  take(){
   if(inFlight)return 0;const available=Math.floor(credit/dt);if(available<1)return 0;
   const steps=plan(available);
   credit-=steps*dt;inFlight={steps,started:now()};return steps;
  },
  complete(){if(!inFlight)return;const elapsed=now()-inFlight.started;observe(inFlight.steps,elapsed);completedSeconds+=inFlight.steps*dt;inFlight=null;},
  reset(){credit=0;inFlight=null;hostSeconds=0;hostFrames=0;completedSeconds=0;},
  read(){return{mode:'adaptive fixed-step service',dt,frameBudgetSeconds,budgetRole:'extra catch-up allowance; current-frame demand is not throttled',serviceFrameSeconds:frameSeconds(),hostFrameHz:hostSeconds>0?hostFrames/hostSeconds:null,physicalSecondsPerWallSecond:hostSeconds>0?completedSeconds/hostSeconds:null,completedPhysicalSeconds:completedSeconds,hostElapsedSeconds:hostSeconds,observedSecondsPerStep:stepSeconds,pendingSeconds:credit+(inFlight?.steps??0)*dt,inFlightSteps:inFlight?.steps??0};}
 };
}
