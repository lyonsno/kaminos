// Scene consumers share the fluid's existing fixed-step clock. Live following
// adds no solver work; held exact advances use the same ordinary solver step.
export function createFlameSceneClock({readRuntime,pauseSimulation,stepSimulation,now=()=>performance.now(),onRelease=()=>{}}){
 if(![readRuntime,pauseSimulation,stepSimulation].every(x=>typeof x==='function'))throw Error('Flame scene clock requires the actual solver capabilities');
 const source=()=>{const s=readRuntime(),dt=s?.timeStep?.effective?.dtScale/60;if(!Number.isSafeInteger(s.simStepCount)||!Number.isFinite(dt)||dt<=0)throw Error('Flame with an effective step duration is required');return {state:s,dt};};
 const initial=source();let consumed=initial.state.simStepCount,running=false,pending=0,released=false,seconds=0,sourceTimeMs=now();const priorPaused=initial.state.simulationPaused===true;
 pauseSimulation(true);
 const active=()=>{if(released)throw Error('Flame scene clock is released');};
 const read=()=>{active();const s=source();return {authority:s.state.active&&!s.state.lookFrozen?'ordinary fluid solver step counter':'host scene delta while flame is inactive or frozen',running,seconds,pendingSeconds:pending,stepSeconds:s.dt,simStepCount:s.state.simStepCount,consumedStepCount:consumed,simulationPaused:s.state.simulationPaused};};
 return Object.freeze({read,
  setRunning(value){active();if(typeof value!=='boolean')throw Error('Clock running must be boolean');pauseSimulation(!value);running=value;consumed=source().state.simStepCount;return read();},
  take(inactiveSeconds=0){active();if(!Number.isFinite(inactiveSeconds)||inactiveSeconds<0)throw Error('Finite nonnegative host time required');const s=source();if(s.state.simStepCount<consumed)throw Error('Flame solver was reset while the scene owned its clock');const delta=running?(s.state.active&&!s.state.lookFrozen&&!s.state.simulationPaused?(s.state.simStepCount-consumed)*s.dt:inactiveSeconds):0;consumed=s.state.simStepCount;seconds+=delta;sourceTimeMs+=delta*1000;return delta;},
  advance({seconds:delta}={}){active();if(running||source().state.simulationPaused!==true)throw Error('Hold the scene before exact fire advance');if(!Number.isFinite(delta)||delta<0)throw Error('Finite nonnegative scene time required');const s=source();if(!s.state.active||s.state.lookFrozen){seconds+=delta;sourceTimeMs+=delta*1000;consumed=s.state.simStepCount;return read();}const total=pending+delta,steps=Math.floor((total+16*Number.EPSILON*Math.max(1,total))/s.dt);if(steps){stepSimulation({steps,startTimeMs:sourceTimeMs,timeStepMs:s.dt*1000});sourceTimeMs+=steps*s.dt*1000;}pending=Math.max(0,total-steps*s.dt);seconds+=delta;consumed=source().state.simStepCount;return read();},
  dispose(){if(released)return;pauseSimulation(priorPaused);released=true;onRelease();},
 });
}
