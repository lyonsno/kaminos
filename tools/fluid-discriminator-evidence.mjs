export function validateDiscriminatorState(actual,request) {
  if(actual?.adapter?.vendor!=='apple'||actual.adapter.isFallbackAdapter!==false)throw Error('Unverified native backend');
  const reduced=request.arm!=='assembled',d=actual.dynamics;
  if(d?.effective!==(reduced?'pressure_surface':'assembled')||d.neighborSmoothing!==!reduced||d.vorticityConfinement!==!reduced||d.speedClipping!==!reduced)throw Error('Effective dynamics mismatch');
  if(actual.step!==request.step)throw Error('Stale step');
  const near=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=1e-6*Math.max(Math.abs(b),1e-8);
  if(d.population?.particleCount!==request.particleCount||!near(d.population.particleVolume,request.volume)||!near(actual.pressure?.radius,request.radius)||!near(actual.surface?.neighborhoodRadius,request.surfaceRadius)||!near(actual.surface?.coefficient,request.gamma))throw Error('Effective configuration mismatch');
  if(!Array.isArray(actual.words)||actual.words.length!==request.particleCount*16||!actual.words.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff))throw Error('Missing complete particle state');
  const values=new Float32Array(new Uint32Array(actual.words).buffer);
  if(!values.every(Number.isFinite))throw Error('Particle state is not finite');
  for(let i=0;i<request.particleCount;i++)if(values[i*16+11]<.15)throw Error('Inactive/recycling source in finite pour');
  return values;
}
export function summarizeParticleState(values) {
  const n=values.length/16,center=[0,0,0],velocity=[0,0,0],variance=[0,0,0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let energy=0;
  for(let i=0;i<n;i++)for(let k=0;k<3;k++){const p=values[i*16+k],v=values[i*16+8+k];center[k]+=p/n;velocity[k]+=v/n;energy+=v*v/n;min[k]=Math.min(min[k],p);max[k]=Math.max(max[k],p);}
  for(let i=0;i<n;i++)for(let k=0;k<3;k++)variance[k]+=(values[i*16+k]-center[k])**2/n;
  return {count:n,center,meanVelocity:velocity,variance,bounds:{min,max},rmsSpeed:Math.sqrt(energy),shapeRatio:Math.sqrt(Math.max(...variance)/Math.min(...variance))};
}
