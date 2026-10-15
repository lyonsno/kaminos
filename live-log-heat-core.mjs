export const LIVE_LOG_HEAT_IDENTITY='kaminos.live-log.local-heat.v1';
export const LIVE_LOG_THERMAL_MODEL='temperature-driven-char-no-self-emission-v1';
export const LIVE_LOG_GRID=16;
export function checkLiveLogFrame(frame,device) {
  if(frame?.device!==device)throw Error('Live log requires the same GPU device as the fluid');
  if(!frame.fluid||!Array.isArray(frame.dimensions)||frame.dimensions.length!==3||!frame.dimensions.every(n=>Number.isInteger(n)&&n>0))throw Error('Live log requires current fluid and dimensions');
  if(!Number.isInteger(frame.simStepCount)||frame.simStepCount<0||typeof frame.allocationId!=='string')throw Error('Live log requires source step/allocation identity');
  if(!Number.isFinite(frame.dt)||frame.dt<=0)throw Error('Live log requires a positive reference-step duration');
  if(!frame.transform?.translate?.every(Number.isFinite)||frame.transform.translate.length!==3||!Number.isFinite(frame.transform.scale)||frame.transform.scale<=0)throw Error('Invalid live volume transform');
  return frame;
}
// Deterministic numerical oracle, not a runtime feedback path or a wood calibration.
export function stepLiveLogThermal(state,exposure,dt) {
  if(![...state,exposure,dt].every(Number.isFinite)||dt<=0||exposure<0)throw Error('Invalid thermal step');
  const temperature=Math.max(0,state[0]+(exposure*1.6-state[0]*.35)*dt);
  const t=Math.max(0,Math.min(1,(temperature-.45)/.5));const ignition=t*t*(3-2*t);
  const consumed=Math.min(1-state[1],(1-state[1])*ignition*.18*dt);
  return [temperature,state[1]+consumed,consumed/(.18*dt),exposure];
}
