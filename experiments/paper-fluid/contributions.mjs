import {boxReferenceConfiguration} from '../../fluid-box-reference-view.mjs';
import {createIPBFPressureControlState,ipbfBetaForRadius} from '../../finger-fluid-pressure-controls.mjs';
import {resolveFingerFluidParticleCount,resolveFingerFluidIPBFSampling} from '../../finger-fluid-webgpu-core.js';
import {deriveIPBFSoftnessReference} from '../../finger-fluid-ipbf-calibration.mjs';

// Numerical owner inputs and operations. The shared experiment owner supplies
// discovery, controls, clock, scene mounting and recording; no private host.
const baseVolume=resolveFingerFluidIPBFSampling({kernelRadius:.185,restDensity:24.3}).particleVolume;
export const paperRiverGuide=Object.freeze({
 question:'Does a softer comparison solve give damping a useful effect on this river?',
 tryThis:'Keep pressure radius and passes fixed for the first look. Derive the current range, then sweep alternate compliance continuously and let the change propagate. Capture a useful interval or view with your settings and observation.',
 whyThisMatters:'The range comes from a compressed local reference. The river supplies the motion judgment: whether damping changes coherence and water weight. The predicted correction percentages do not describe this whole basin.',
});
export const paperBoxGuide=Object.freeze({
 question:'How does this IPBF configuration respond to a finite dropped block of water?',
 tryThis:'Replay the fixed block in its invisible box. Explore the world pressure radius while retaining the same sampling and timestep. Capture the impact or settled state you want to discuss.',
 whyThisMatters:'Finite water removes the river inlet and recycling from the comparison. Sampling changes particle count, represented sample volume, surface support and collision offset; pressure radius stays independent in world coordinates.',
});
export const paperPressureControls=Object.freeze([
 {id:'pressureRadius',label:'Pressure radius',units:'world distance',scale:'linear',step:.001,editPolicy:'next_solver_step',meaning:'Independent cubic-kernel support radius.'},
 {id:'surfaceCoefficient',label:'Surface coefficient',units:'Akinci model coefficient',scale:'linear',step:.01,editPolicy:'next_solver_step',meaning:'Published surface-force coefficient; not calibrated N/m.'},
 {id:'passes',label:'Pressure passes',units:'iterations per step',scale:'integer',step:1,editPolicy:'next_solver_step',meaning:'Iterations of the pressure solve at the unchanged timestep.'},
 {id:'beta',label:'Damping beta',units:'fraction of pressure radius',scale:'linear',step:.001,editPolicy:'next_solver_step',meaning:'Damping separation threshold is beta times pressure radius.'},
 {id:'alternativeCompliance',label:'Alternate compliance',units:'IPBF model coefficient',scale:'logarithmic',step:.01,editPolicy:'next_solver_step',meaning:'Softens the alternate pressure solve used by damping; zero is valid through numeric entry.'},
].map(Object.freeze));
function populationCount(value,label){
 if(!Number.isSafeInteger(value))throw new RangeError(`${label} must be an integer`);
 const resolved=resolveFingerFluidParticleCount(value);
 if(resolved!==value)throw new RangeError(`${label} is outside the solver population contract`);
 return value;
}
function pressureState({baseRadius,pressureRadius,passes,surfaceCoefficient,beta,alternativeCompliance}){
 return createIPBFPressureControlState({baseRadius,cohesionModel:'akinci_2013',pressureRadiusScale:pressureRadius/baseRadius,
  densityIterations:passes,capillaryStrength:surfaceCoefficient,beta,alternativeCompliance}).read().requested;
}
export function paperRiverSetup({particleCount=36864,referenceParticleCount=36864,pressureRadius=.185,
 passes=3,surfaceCoefficient=.19,beta=60,alternativeCompliance=.001}={}){
 populationCount(particleCount,'Particle count');populationCount(referenceParticleCount,'Reference count');
 if(referenceParticleCount<particleCount)throw new RangeError('Reference population cannot be below the requested population');
 if(!Number.isFinite(pressureRadius)||pressureRadius<=0)throw new RangeError('Pressure radius must be finite and positive');
 const volumeScale=referenceParticleCount/particleCount,basePressureRadius=.185*Math.cbrt(volumeScale);
 const p=pressureState({baseRadius:basePressureRadius,pressureRadius,passes,surfaceCoefficient,beta,alternativeCompliance});
 return {dt:1/60,guide:paperRiverGuide,support:{kind:'analytical',truthScene:'river_playground'},
  sampling:{basePressureRadius,pressureRadius,particleVolume:baseVolume*volumeScale,representedVolume:baseVolume*referenceParticleCount},
  solver:{particleCount,fixedVolumeReferenceParticleCount:referenceParticleCount,truthScene:'river_playground',
   pressureSolver:'ipbf',ipbfBoundaryMode:'tangent_plane',cohesionModel:'akinci_2013',capillaryStrength:surfaceCoefficient,
   ipbfPressureRadiusScale:p.pressureRadiusScale,ipbfAlternativeCompliance:alternativeCompliance,ipbfDamping:true,ipbfDampingBeta:beta,
   densityIterations:passes,livePressureControls:true,substeps:1,adaptiveDensity:false,energyDiagnosticsMode:'disabled',
   rendererMode:'screen_space_refraction',colorMode:'phase',freeFlightViscosityBoost:.30}};
}
export function paperBoxSetup({scene='block_drop',resolution=24,pressureRadius=1/12,passes=2,
 surfaceCoefficient=0,beta=.0113,alternativeCompliance=.001,dt=1/240}={}){
 const existing=boxReferenceConfiguration({scene,resolution,pressureRadius,passes,gamma:surfaceCoefficient,beta,dt});
 const basePressureRadius=.185*Math.cbrt(existing.fixture.population.particleVolumeScale);
 pressureState({baseRadius:basePressureRadius,pressureRadius,passes,surfaceCoefficient,beta,alternativeCompliance});
 return {dt:existing.dt,guide:paperBoxGuide,support:{kind:'invisible_box',box:existing.fixture.box},
  sampling:{basePressureRadius,pressureRadius,particleVolume:existing.fixture.particleVolume,representedVolume:existing.fixture.representedVolume},
  solver:{...existing.solver,ipbfAlternativeCompliance:alternativeCompliance}};
}
export function bindPaperPressureOperations({getSolver,applyPressure}){
 if(typeof getSolver!=='function'||typeof applyPressure!=='function')throw new TypeError('Shared solver and pressure operation are required');
 const current=()=>{
  const solver=getSolver();
  if(!solver?.available||solver.getDebugState?.().pressureSolver!=='ipbf')throw new Error('Paper pressure operations require the active IPBF solver');
  const state=solver.getPressureControls?.();
  if(!state?.available)throw new Error('Active IPBF pressure controls unavailable');
  return state;
 };
 return {controls:paperPressureControls,read:current,
  apply(patch){current();return applyPressure(patch);},
  edit(id,value,{linkDamping=false}={}){
   const s=current(),v=s.requested;
   if(!Number.isFinite(value))throw new RangeError('Paper control value must be finite');
   let patch;
   if(id==='pressureRadius')patch={pressureRadiusScale:value/(v.radius/v.pressureRadiusScale),
    beta:ipbfBetaForRadius({radius:value,previousRadius:v.radius,beta:v.beta,linked:linkDamping})};
   else {const key={surfaceCoefficient:'capillaryStrength',passes:'densityIterations',beta:'beta',alternativeCompliance:'alternativeCompliance'}[id];
    if(!key)throw new RangeError('Unknown Paper pressure control: '+id);patch={[key]:value};}
   return applyPressure(patch);
  },
  referenceCurrent(reference){const s=current();return !!reference&&reference.inputGeneration===s.generation
   &&reference.particleVolume===s.particleVolume&&reference.radius===s.requested.radius&&reference.dt===s.dt;},
  deriveSoftness(){const s=current();return {...deriveIPBFSoftnessReference({particleVolume:s.particleVolume,radius:s.requested.radius,dt:s.dt}),
   inputGeneration:s.generation,inputApplication:s.generation===s.effectiveGeneration?'applied':'pending'};},
 };
}
