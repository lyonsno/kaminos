/** Numerical setup comes from the owner; device and presentation remain host-owned. */
export function applyFluidOwnerSetup(base,setup) {
 if(!setup||typeof setup!=='object'||!setup.solver||!Number.isFinite(setup.dt)||setup.dt<=0)throw Error('Owner fluid setup requires solver options and a positive finite timestep');
 if(!['analytical','invisible_box'].includes(setup.support?.kind))throw Error('Unsupported owner fluid support');
 if(setup.dt<1/240||setup.dt>1/30)throw Error('Owner timestep is outside the current solver step contract (1/240 to 1/30 seconds)');
 const options=setup.solver;
 if(options.rendererMode!=='screen_space_refraction')throw Error('Shared Fluid host currently requires screen_space_refraction; requested '+options.rendererMode);
 for(const name of ['canvas','webgpuDevice','hostFrameComposition','hostFramePipelineIdentity','presentationMode'])if(Object.hasOwn(options,name))throw Error('Owner setup cannot replace host '+name);
 if(!Number.isSafeInteger(options.particleCount)||options.particleCount<=0)throw Error('Owner fluid population must be a positive integer');
 if(setup.support.kind==='invisible_box'&&(!options.diagnosticPopulation||!options.diagnosticBox))throw Error('Finite owner water requires its population and collision box');
 const config={...base,ownerSetup:setup,simulationStepSeconds:setup.dt};
 const paired={particleCount:'ParticleCount',densityIterations:'PressureIterations',truthScene:'TruthScene',pressureSolver:'PressureSolver',capillaryStrength:'CapillaryStrength',rendererMode:'RendererMode',opticalDebugMode:'OpticalDebugMode',colorMode:'ColorMode',supportFriction:'SupportFriction',chemistryDiffusion:'ChemistryDiffusion',particleShiftStrength:'ParticleShiftStrength',unsupportedSheetStrength:'UnsupportedSheetStrength',freeFlightViscosityBoost:'FreeFlightViscosityBoost',adaptiveDensity:'AdaptiveDensity',energyDiagnosticsMode:'EnergyDiagnosticsMode',thinSheetVorticityAttenuation:'ThinSheetVorticityAttenuation',maxFluidSpeed:'MaxFluidSpeed'};
 for(const [key,suffix]of Object.entries(paired))if(Object.hasOwn(options,key)){config['requested'+suffix]=options[key];config['effective'+suffix]=options[key];}
 const direct={fixedVolumeReferenceParticleCount:'requestedFixedVolumeReferenceParticleCount',ipbfBoundaryMode:'requestedIPBFBoundaryMode',ipbfPressureRadiusScale:'ipbfPressureRadiusScale',ipbfAlternativeCompliance:'ipbfAlternativeCompliance',ipbfCompliance:'ipbfCompliance',ipbfDamping:'ipbfDamping',ipbfDampingBeta:'ipbfDampingBeta',cohesionModel:'cohesionModel'};
 for(const [key,dest]of Object.entries(direct))if(Object.hasOwn(options,key))config[dest]=options[key];
 config.pressureCockpitRequested=options.pressureSolver==='ipbf'&&options.livePressureControls===true;
 config.effectiveWitnessStartStep=config.effectiveWitnessTargetStep=null;
 return config;
}

/** Only the active generation can mutate water; restart explicitly renews it. */
export function createOwnerWaterCapability({state,debug,pressure,apply,pause,advance,restart,dispose,identity=()=>state().generation}) {
 let generation=identity(),closed=false;
 const current=()=>{if(closed)throw Error('Owner water is disposed');const value=state();if(!value.available||identity()!==generation)throw Error('Owner water generation changed');return value;};
 const read=()=>({clock:current(),controls:pressure(),runtime:debug()});
 const facade={get available(){try{return !!current().available;}catch{return false;}},getDebugState:()=>{current();return debug();},getPressureControls:()=>{current();return pressure();}};
 return Object.freeze({
  read,
  getSolver(){current();return facade;},
  applyPressure(patch){current();return apply(patch);},
  setPaused(value){current();return pause(value);},
  advanceTo(step){current();return advance(step);},
  async restart(){current();await restart();generation=identity();return read();},
  async dispose(){if(closed)return;closed=true;if(identity()===generation)await dispose();},
 });
}
