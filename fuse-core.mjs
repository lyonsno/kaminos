export const FUSE_SAMPLES=96;
export const FUSE_IDENTITY='kaminos.curved-fuse.local-material.v1';
// Provisional energetic cord, not the log's wood law or a calibrated commercial fuse.
export const FUSE_LAW=Object.freeze({diffusivity:.0007,cooling:.5,burnRate:2,heatYield:5,ignitionTemperature:.8,doseSeconds:.12});
export const FUSE_EVOLUTION_WGSL=`
struct FuseCell { material:vec4<f32>, burn:vec4<f32> }
fn evolveFuse(old:FuseCell,exposure:f32,neighbourMean:f32,dt:f32,spacing:f32)->FuseCell {
 let conducted=mix(old.material.x,neighbourMean,1.0-exp(-2.0*${FUSE_LAW.diffusivity}*dt/(spacing*spacing)));
 let preheated=max(0.0,conducted*exp(-${FUSE_LAW.cooling}*dt)+exposure*1.6*dt);
 let dose=clamp(old.burn.x+max(0.0,preheated-${FUSE_LAW.ignitionTemperature})*dt/${FUSE_LAW.doseSeconds}-select(dt*.5,0.0,preheated>=${FUSE_LAW.ignitionTemperature}),0.0,1.0);
 let ignited=select(0.0,1.0,(old.burn.w>.5||dose>=1.0)&&old.burn.y>0.0);
 let consumed=old.burn.y*(1.0-exp(-${FUSE_LAW.burnRate}*dt))*smoothstep(.45,.85,preheated)*ignited;
 let fuel=max(0.0,old.burn.y-consumed);
 let heat=preheated+${FUSE_LAW.heatYield}*consumed;
 return FuseCell(vec4<f32>(heat,1.0-fuel,consumed/dt,exposure),vec4<f32>(dose,fuel,consumed,ignited));
}`;
export function coldFuse(count=FUSE_SAMPLES){
  if(!Number.isInteger(count)||count<3)throw Error('Fuse requires at least three material samples');
  const cells=new Float32Array(count*8);for(let i=0;i<count;i++)cells[i*8+5]=1;return cells;
}
export function stepFuse(cells,exposures,dt,spacing){
  if(!(cells instanceof Float32Array)||cells.length%8||exposures.length!==cells.length/8||![dt,spacing].every(n=>Number.isFinite(n)&&n>0)||!cells.every(Number.isFinite)||!Array.from(exposures).every(n=>Number.isFinite(n)&&n>=0))throw Error('Invalid fuse material chain');
  const next=cells.slice();
  for(let i=0;i<exposures.length;i++){
    const at=i*8,old=cells.subarray(at,at+8),mean=(cells[Math.max(0,i-1)*8]+cells[Math.min(exposures.length-1,i+1)*8])/2;
    const conducted=old[0]+(mean-old[0])*(1-Math.exp(-2*FUSE_LAW.diffusivity*dt/(spacing*spacing)));
    const preheated=Math.max(0,conducted*Math.exp(-FUSE_LAW.cooling*dt)+exposures[i]*1.6*dt);
    const dose=Math.max(0,Math.min(1,old[4]+Math.max(0,preheated-.8)*dt/.12-(preheated<.8?dt*.5:0)));
    const ignited=(old[7]>.5||dose>=1)&&old[5]>0?1:0;
    const t=Math.max(0,Math.min(1,(preheated-.45)/.4));
    const consumed=old[5]*(1-Math.exp(-FUSE_LAW.burnRate*dt))*t*t*(3-2*t)*ignited,fuel=Math.max(0,old[5]-consumed);
    next.set([preheated+FUSE_LAW.heatYield*consumed,1-fuel,consumed/dt,exposures[i],dose,fuel,consumed,ignited],at);
  }
  return next;
}
