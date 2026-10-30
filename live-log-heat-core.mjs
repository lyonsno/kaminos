export const LIVE_LOG_HEAT_IDENTITY='kaminos.live-log.local-heat.v3';
export const LIVE_LOG_THERMAL_MODEL='surface-ignition-finite-fuel-gas-feed-v3';
export const LIVE_LOG_GRID=16;
export const LIVE_LOG_BURN_RATE=.025;
export const LIVE_LOG_HEATING_GAIN=1.6;
export const LIVE_LOG_COOLING_RATE=.35;
// In these existing material-state units, passive equilibrium is
// T_material = exposure * heatingGain / coolingRate. Convert to the fluid's
// heat units for the shared renderer without changing the burn dynamics.
export const LIVE_LOG_HEAT_TO_FLUID_HEAT=LIVE_LOG_COOLING_RATE/LIVE_LOG_HEATING_GAIN;
// Provisional volume yield, not a calibrated wood density or gas equation of state.
export const LIVE_LOG_GAS_EXPANSION_RATIO=400;
export const LIVE_LOG_CELL_WGSL='struct LogCell { material:vec4<f32>, burn:vec4<f32> }';
export function logEvolutionWGSL(rate=LIVE_LOG_BURN_RATE){
 if(!Number.isFinite(rate)||rate<=0)throw Error('Invalid material burn rate');
 return `
${LIVE_LOG_CELL_WGSL}
fn evolveLog(old:LogCell,exposure:f32,conducted:f32,dt:f32,surface:bool)->LogCell {
  let temperature=max(0.0,conducted+(exposure*${LIVE_LOG_HEATING_GAIN}-conducted*${LIVE_LOG_COOLING_RATE})*dt);
  let dose=clamp(old.burn.x+max(0.0,temperature-0.8)*dt/1.2-select(dt*0.5,0.0,temperature>=0.8),0.0,1.0);
  let ignited=select(0.0,1.0,(old.burn.w>0.5||dose>=1.0)&&old.burn.y>0.0);
  let consumed=select(0.0,old.burn.y*(1.0-exp(-${rate}*dt))*smoothstep(0.4,1.0,temperature)*ignited,surface);
  let fuel=max(0.0,old.burn.y-consumed);
  let scorch=1.0-(1.0-old.material.y)*exp(-max(0.0,temperature-0.45)*0.02*dt);
  let damage=max(scorch,1.0-fuel);
  return LogCell(vec4<f32>(temperature,damage,consumed/(${rate}*dt),exposure),vec4<f32>(dose,fuel,consumed,ignited));
}`;
}
export const LIVE_LOG_EVOLUTION_WGSL=logEvolutionWGSL();
export function checkLiveLogFrame(frame,device) {
  if(frame?.device!==device)throw Error('Live log requires the same GPU device as the fluid');
  if(!frame.fluid||!Array.isArray(frame.dimensions)||frame.dimensions.length!==3||!frame.dimensions.every(n=>Number.isInteger(n)&&n>0))throw Error('Live log requires current fluid and dimensions');
  if(!frame.collision?.createView)throw Error('Live log requires the current collision texture');
  if(!Number.isInteger(frame.simStepCount)||frame.simStepCount<0||typeof frame.allocationId!=='string')throw Error('Live log requires source step/allocation identity');
  if(!Number.isFinite(frame.dt)||frame.dt<=0)throw Error('Live log requires a positive reference-step duration');
  if(!frame.transform?.translate?.every(Number.isFinite)||frame.transform.translate.length!==3||!Number.isFinite(frame.transform.scale)||frame.transform.scale<=0)throw Error('Invalid live volume transform');
  return frame;
}
// Deterministic numerical oracle, not a runtime feedback path or a wood calibration.
export function stepLiveLogThermal(state,exposure,dt) {
  if(![...state,exposure,dt].every(Number.isFinite)||dt<=0||exposure<0)throw Error('Invalid thermal step');
  const temperature=Math.max(0,state[0]+(exposure*LIVE_LOG_HEATING_GAIN-state[0]*LIVE_LOG_COOLING_RATE)*dt);
  const dose=Math.max(0,Math.min(1,(state[4]??0)+Math.max(0,temperature-.8)*dt/1.2-(temperature<.8?dt*.5:0)));
  const fuelBefore=state[5]??1,ignited=((state[7]??0)>.5||dose>=1)&&fuelBefore>0?1:0;
  const t=Math.max(0,Math.min(1,(temperature-.4)/.6));
  const consumed=fuelBefore*(1-Math.exp(-LIVE_LOG_BURN_RATE*dt))*t*t*(3-2*t)*ignited;
  const fuel=Math.max(0,fuelBefore-consumed),scorch=1-(1-state[1])*Math.exp(-Math.max(0,temperature-.45)*.02*dt);
  return [temperature,Math.max(scorch,1-fuel),consumed/(LIVE_LOG_BURN_RATE*dt),exposure,dose,fuel,consumed,ignited];
}
