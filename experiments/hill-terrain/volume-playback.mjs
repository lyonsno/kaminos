// Interactive service budget, not a physical-time or substep-count cap.
// Wall-clock credit is retained until completed steps service it. Exact/manual
// advances use the solver directly and do not pass through this scheduler.
export function createVolumePlayback({dt,frameBudgetSeconds=1/60,now=()=>performance.now()/1000}){
 if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(frameBudgetSeconds)||frameBudgetSeconds<=0)throw Error('Playback needs positive timestep and frame budget');
 let credit=0,stepSeconds=null,inFlight=null;
 return{
  add(seconds){if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(credit+seconds))throw Error('Playback frame time must be finite and nonnegative');credit+=seconds;},
  take(){
   if(inFlight)return 0;const available=Math.floor(credit/dt);if(available<1)return 0;
   const quantum=stepSeconds===null?1:Math.max(1,Math.floor(frameBudgetSeconds/stepSeconds));const steps=Math.min(available,quantum);
   credit-=steps*dt;inFlight={steps,started:now()};return steps;
  },
  complete(){if(!inFlight)return;const elapsed=now()-inFlight.started;if(Number.isFinite(elapsed)&&elapsed>0)stepSeconds=elapsed/inFlight.steps;inFlight=null;},
  reset(){credit=0;inFlight=null;},
  read(){return{mode:'adaptive fixed-step service',dt,frameBudgetSeconds,observedSecondsPerStep:stepSeconds,pendingSeconds:credit+(inFlight?.steps??0)*dt,inFlightSteps:inFlight?.steps??0};}
 };
}
