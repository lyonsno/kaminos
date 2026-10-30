// Fixed material quanta follow elapsed active time, independently of display
// cadence. A release may prepay one quantum so a brief gesture is not lost.
export function createFractureFrameClock({timeStep,step,now=()=>performance.now()}) {
 if(!(Number.isFinite(timeStep)&&timeStep>0))throw Error('Positive finite material timestep required');
 let active=false,last=null,balance=0,elapsed=0,steps=0,releaseSteps=0;
 function accumulate(timestamp){
  if(!Number.isFinite(timestamp))throw Error('Finite material clock timestamp required');
  if(last!==null&&timestamp<last)throw Error('Material clock cannot run backwards');
  if(active&&last!==null){const delta=(timestamp-last)/1000;balance+=delta;elapsed+=delta;}
  last=timestamp;
 }
 return {
  setActive(value,timestamp=now()){
   if(Boolean(value)===active)return;
   accumulate(timestamp);active=Boolean(value);
  },
  tick(timestamp){
   accumulate(timestamp);if(!active)return 0;
   let count=0;
   // The tolerance only absorbs arithmetic roundoff at exact step boundaries.
   while(balance+timeStep*1e-10>=timeStep){step();balance-=timeStep;steps++;count++;}
   return count;
  },
  accountReleaseStep(timestamp=now()){
   accumulate(timestamp);balance-=timeStep;steps++;releaseSteps++;
  },
  read:()=>({kind:'elapsed-active-time-fixed-step',active,timeStep,elapsedSeconds:elapsed,submittedSeconds:steps*timeStep,pendingSeconds:balance,steps,releaseSteps}),
 };
}
