// Bounded diagnostic consumer: a third of the reference population travels
// through a shallow descent, flat reach, and gentle bend beside the waterfall.
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
export const RIVER_COLUMNS=31, RIVER_ROWS=101, RIVER_SPACING=.055, RIVER_INLET_SPEED=.3;
export const sampleRiverCenter=z=>-2.05+1.5*smoothstep(.9,2.8,z);
export const sampleRiverBed=z=>-.55-.15*smoothstep(-2.8,-.2,z)-.13*smoothstep(.9,2.8,z);
export function sampleRiverTerrain(x,z,oldHeight) {
  const lateral=Math.abs(x-sampleRiverCenter(z));
  const blend=(1-smoothstep(1.08,1.25,lateral))*smoothstep(-3.2,-2.8,z)*(1-smoothstep(2.8,3.2,z));
  const channel=sampleRiverBed(z)+.36*smoothstep(.82,1.0,lateral);
  return oldHeight+(channel-oldHeight)*blend;
}
export function riverSample(ordinal) {
  const row=ordinal%RIVER_ROWS, lane=Math.floor(ordinal/RIVER_ROWS);
  const xOffset=(lane%RIVER_COLUMNS-15)*RIVER_SPACING;
  const height=RIVER_SPACING*(1+Math.floor(lane/RIVER_COLUMNS));
  const z=-2.75+row*RIVER_SPACING;
  const velocity=[(sampleRiverCenter(z+.005)-sampleRiverCenter(z-.005))/.01*RIVER_INLET_SPEED,(sampleRiverBed(z+.005)-sampleRiverBed(z-.005))/.01*RIVER_INLET_SPEED,RIVER_INLET_SPEED];
  return {position:[sampleRiverCenter(z)+xOffset,sampleRiverBed(z)+height,z],velocity,xOffset,height,releaseSlot:RIVER_ROWS-1-row};
}
export function riverReleaseDue(frame,dt,slot) {
  const interval=Math.max(1,Math.round(RIVER_SPACING/RIVER_INLET_SPEED/dt));
  const now=Math.floor(frame/interval),before=Math.floor((frame-1)/interval);
  return now>before&&(now-1)%RIVER_ROWS===slot;
}
export const RIVER_WGSL=/*wgsl*/`
const riverPlaygroundEnabled: bool = false;
fn riverCenter(z: f32) -> f32 { return -2.05 + 1.5 * smoothstep(0.9, 2.8, z); }
fn riverBed(z: f32) -> f32 { return -0.55 - 0.15 * smoothstep(-2.8, -0.2, z) - 0.13 * smoothstep(0.9, 2.8, z); }
fn riverTerrain(p: vec3<f32>, oldHeight: f32) -> f32 {
  let lateral = abs(p.x - riverCenter(p.z));
  let blend = (1.0 - smoothstep(1.08, 1.25, lateral)) * smoothstep(-3.2, -2.8, p.z) * (1.0 - smoothstep(2.8, 3.2, p.z));
  let channel = riverBed(p.z) + 0.36 * smoothstep(0.82, 1.0, lateral);
  return mix(oldHeight, channel, blend);
}
`;
