// Absolute simulation targets prevent comparison by wall clock or RAF count.
export function targetStep(time,dt,current=0){
 if(!Number.isFinite(time)||time<0||!Number.isFinite(dt)||dt<=0)throw new RangeError('Finite positive timestep and nonnegative time required');
 const n=Math.round(time/dt);
 if(!Number.isSafeInteger(n)||Math.abs(n*dt-time)>1e-10)throw new RangeError('Target time must be an exact multiple of timestep');
 if(n<current)throw new RangeError('Reset water before going backward in simulation time');
 return n;
}
// Paper Pilfer d46cf034 frame pump: at most one GPU batch outstanding.
export function createBoxFramePump({submit,completed,schedule,onError}){
 let enabled=false,scheduled=false,inFlight=false;
 const next=()=>{if(enabled&&!scheduled&&!inFlight){scheduled=true;schedule(frame);}};
 const frame=async()=>{scheduled=false;if(!enabled)return;inFlight=true;
  try{submit();await completed();}catch(e){enabled=false;onError(e);}finally{inFlight=false;next();}};
 return {start:()=>{enabled=true;next();},stop:()=>{enabled=false;}};
}

// Playback changes how many fixed steps are shown per wall second, never dt.
export function createFixedStepPlayback({dt,rate=1}) {
 if(!Number.isFinite(dt)||dt<=0)throw new RangeError('Positive finite physics timestep required');
 let last=null,credit=0;
 const setRate=value=>{if(!Number.isFinite(value)||value<=0)throw new RangeError('Playback rate must be finite and positive');rate=value;};
 setRate(rate);
 return {setRate,reset(){last=null;credit=0;},state:()=>({dt,rate,credit}),
  advance(now,{paused=false}={}) {
   if(!Number.isFinite(now))throw new RangeError('Finite playback clock required');
   const elapsed=last===null?0:Math.max(0,(now-last)/1000);last=now;
   if(paused){credit=0;return {steps:0,dt};}
   credit+=elapsed*rate;
   const steps=Math.floor((credit+1e-12)/dt);credit-=steps*dt;
   if(!Number.isSafeInteger(steps))throw new RangeError('Playback step count is not representable');
   return {steps,dt};
  }
 };
}
