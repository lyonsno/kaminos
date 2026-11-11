// Sleep only after sustained low motion and acceleration, rather than cutting
// off a fixed-duration animation or mistaking an oscillation's apex for rest.
export function createSettlingMonitor() {
 let previous=null,quietSeconds=0;
 return {observe(state,seconds){
  if(!Number.isFinite(seconds)||seconds<=0)throw Error('Positive settling interval required');
  let speed=0,angular=0,acceleration=Infinity,angularAcceleration=Infinity;
  if(previous){acceleration=0;angularAcceleration=0;}
  for(const i of state.activeJoints){
   speed=Math.max(speed,Math.hypot(...state.pointVelocities[i]));angular=Math.max(angular,Math.abs(state.angularVelocities[i]));
   if(previous){acceleration=Math.max(acceleration,Math.hypot(...state.pointVelocities[i].map((v,k)=>(v-previous.pointVelocities[i][k])/seconds)));angularAcceleration=Math.max(angularAcceleration,Math.abs(state.angularVelocities[i]-previous.angularVelocities[i])/seconds);}
  }
  const quiet=state.converged&&speed<.005&&angular<.01&&acceleration<.02&&angularAcceleration<.04;
  quietSeconds=quiet?quietSeconds+seconds:0;previous=state;
  return {asleep:quietSeconds>=.2,quietSeconds,speed,angular,acceleration,angularAcceleration};
 }};
}
