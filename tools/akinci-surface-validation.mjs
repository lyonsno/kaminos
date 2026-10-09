// Validation is separate from the browser producer, using full native fields.
import {evaluateAkinciSurface} from '../finger-fluid-akinci.mjs';
import {validateNativeCases} from './ipbf-material-response.mjs';
export function validateSurfaceCases(cases){
 validateNativeCases(cases);
 for(const c of cases){
  if(!Array.isArray(c.positions)||!c.positions.length||c.positions.some(p=>!Array.isArray(p)||p.length!==3||!p.every(x=>Number.isFinite(Math.fround(x)))))throw Error('Surface case positions missing or invalid');
  if(c.phases&&(!Array.isArray(c.phases)||c.phases.length!==c.positions.length||c.phases.some(x=>!Number.isFinite(Math.fround(x))||x<0)))throw Error('Surface source tags missing or invalid');
 }
}
export function validateNativeSurface(native,expectedCases){
 validateSurfaceCases(expectedCases);
 if(native?.route!=='actual-factory-akinci-surface'||native?.adapter?.vendor!=='apple'||native?.adapter?.fallback!==false)throw Error('Wrong/unknown surface backend');
 if(native.effective?.pressureSolver!=='ipbf'||native.effective?.cohesionModel!=='akinci_2013')throw Error('Wrong effective surface model');
 const settings=native.effective.surface;
 if(!settings||settings.referenceDensity!==1000||!Number.isFinite(settings.particleVolume)||settings.particleVolume<=0||Math.abs(settings.neighborhoodRadius-2*Math.cbrt(settings.particleVolume))>1e-12)throw Error('Missing or inconsistent surface settings');
 if(!Array.isArray(native.cases)||native.cases.length!==expectedCases.length)throw Error('Missing/partial surface responses');
 for(let k=0;k<expectedCases.length;k++){
  const a=native.cases[k],e=expectedCases[k],n=e.positions.length;
  if(a.name!==e.name||a.dt!==e.dt||a.strength!==e.strength)throw Error('Surface case configuration mismatch');
  if(a.input?.length!==n*16||a.output?.length!==n*16||!a.input.every(Number.isFinite)||!a.output.every(Number.isFinite))throw Error('Missing/nonfinite surface vectors');
  if(a.fields?.length!==n*8||!a.fields.every(Number.isFinite))throw Error('Missing/nonfinite surface fields');
  if(a.simulationWords?.length!==56||!a.simulationWords.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff))throw Error('Missing effective surface configuration');
  const packet=new Uint32Array(a.simulationWords),p=new Float32Array(packet.buffer);
  if(packet[1]!==n||p[0]!==Math.fround(e.dt)||p[29]!==Math.fround(e.strength))throw Error('Stale effective surface configuration');
  for(let i=0;i<n;i++){
   const expected=new Float32Array([...e.positions[i],1,...e.positions[i].map(x=>x+1),1,0,0,0,e.phases?.[i]??.08,0,0,0,4.86]);
   for(let j=0;j<16;j++)if(a.input[i*16+j]!==expected[j])throw Error('Surface fixture input mismatch');
   for(let j=0;j<16;j++)if((j<8||j>10)&&a.output[i*16+j]!==a.input[i*16+j])throw Error('Surface dispatch changed immutable particle state');
  }
  const oracle=evaluateAkinciSurface({positions:e.positions.map(v=>v.map(Math.fround)),volume:settings.particleVolume,coefficient:Math.fround(e.strength)});
  let maxVelocityError=0,maxFieldError=0;
  const near=(actual,expected,what)=>{const error=Math.abs(actual-expected);if(error>5e-5*Math.max(1,Math.abs(expected)))throw Error('Native surface '+what+' differs from source equation');return error;};
  for(let i=0;i<n;i++){
   maxFieldError=Math.max(maxFieldError,near(a.fields[i*8+4],oracle.densityRatios[i],'density'));
   for(let axis=0;axis<3;axis++){
    maxFieldError=Math.max(maxFieldError,near(a.fields[i*8+axis],oracle.normals[i][axis],'normal'));
    maxVelocityError=Math.max(maxVelocityError,near(a.output[i*16+8+axis],Math.fround(e.dt)*oracle.accelerations[i][axis],'velocity'));
   }
  }
  const centerOfMassAcceleration=[0,1,2].map(axis=>a.output.reduce((s,v,index)=>s+(index%16===8+axis?v:0),0)/n/Math.fround(e.dt));
  if(Math.hypot(...centerOfMassAcceleration)>5e-5*Math.max(1,...oracle.accelerations.flat().map(Math.abs)))throw Error('Native surface internal momentum drift');
  Object.assign(a,{oracle,maxVelocityError,maxFieldError,centerOfMassAcceleration});
 }
 return native;
}
