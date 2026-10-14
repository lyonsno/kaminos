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
export function createOwnerWaterCapability({state,debug,pressure,apply,pause,advance,restart,dispose,identity=null,material=null,applyMaterial=null,playback=null,setPlaybackRate=null,setPlaybackMode=null}) {
 const ownerIdentity=identity??(()=>state().generation);
 let generation=ownerIdentity(),closed=false;
 const current=()=>{if(closed)throw Error('Owner water is disposed');const value=state();if(!value.available||ownerIdentity()!==generation)throw Error('Owner water generation changed');return value;};
 const read=()=>({clock:current(),controls:material?.()?.available?material():pressure(),runtime:debug()});
 const facade={get available(){try{return !!current().available;}catch{return false;}},getDebugState:()=>{current();return debug();},getPressureControls:()=>{current();return pressure();},getMaterialControls:()=>{current();return material?.()??{available:false};}};
 return Object.freeze({
  read,
  getSolver(){current();return facade;},
  applyMaterial(patch){current();if(!applyMaterial)throw Error('Material capability unavailable');return applyMaterial(patch);},
  setPlaybackRate(value){current();if(!setPlaybackRate)throw Error('Playback capability unavailable');return setPlaybackRate(value);},
  setPlaybackMode(value){current();if(!setPlaybackMode)throw Error('Playback mode capability unavailable');return setPlaybackMode(value);},
  applyPressure(patch){current();return apply(patch);},
  setPaused(value){current();return pause(value);},
  advanceTo(step){current();return advance(step);},
  async restart(){current();const owner=ownerIdentity(),receipt=await restart();if(closed||(identity&&ownerIdentity()!==owner))throw Error('Owner changed during restart');if(!identity&&state().generation!==generation&&receipt?.generation!==state().generation)throw Error('Restart changed generation without an owned renewal receipt');generation=ownerIdentity();return read();},
  async dispose(){if(closed)return;closed=true;if(ownerIdentity()===generation)await dispose();},
 });
}

// Reopening the same definition/inputs honors its existing cockpit settings URL.
// A new definition or new inputs starts with that owner's chosen configuration.
export function restoreOwnerFluidReplay(setup,params,{id,inputs}) {
 if(params.get('experiment')!==id||(params.get('experiment_inputs')??'{}')!==JSON.stringify(inputs))return setup;
 const solver={...setup.solver};
 const fields={finger_fluid_ipbf_pressure_radius_scale:'ipbfPressureRadiusScale',finger_fluid_ipbf_beta:'ipbfDampingBeta',finger_fluid_density_iterations:'densityIterations',finger_fluid_capillary_strength:'capillaryStrength',finger_fluid_ipbf_alternative_compliance:'ipbfAlternativeCompliance'};
 for(const [query,key]of Object.entries(fields))if(params.has(query)){const value=Number(params.get(query));if(!Number.isFinite(value))throw Error('Invalid owner replay '+query);solver[key]=value;}
 if(!solver.diagnosticPopulation&&params.has('finger_fluid_particle_count'))solver.particleCount=Number(params.get('finger_fluid_particle_count'));
 return {...setup,solver};
}

export function ownerFluidRouteParams(setup,params) {
 const next=new URLSearchParams(params),solver=setup.solver;
 const fields={particleCount:'finger_fluid_particle_count',fixedVolumeReferenceParticleCount:'finger_fluid_fixed_volume_reference_count',pressureSolver:'finger_fluid_pressure_solver',cohesionModel:'finger_fluid_cohesion_model',capillaryStrength:'finger_fluid_capillary_strength',densityIterations:'finger_fluid_density_iterations',ipbfPressureRadiusScale:'finger_fluid_ipbf_pressure_radius_scale',ipbfAlternativeCompliance:'finger_fluid_ipbf_alternative_compliance',ipbfDampingBeta:'finger_fluid_ipbf_beta',ipbfBoundaryMode:'finger_fluid_ipbf_boundary',truthScene:'finger_fluid_truth_scene',rendererMode:'finger_fluid_renderer',opticalDebugMode:'finger_fluid_optical_debug'};
 for(const [key,query]of Object.entries(fields))if(solver[key]!==undefined&&solver[key]!==null)next.set(query,String(solver[key]));
 if(solver.fixedVolumeReferenceParticleCount==null)next.delete('finger_fluid_fixed_volume_reference_count');
 next.set('finger_fluid_pressure_cockpit',solver.livePressureControls?'1':'0');return next;
}

/** Complete producer inputs can opt out; existing pressure replay remains default. */
export function prepareOwnerFluidOpen(setup,params,{definition=null,restoreReplay=true}={}){
 if(typeof restoreReplay!=='boolean')throw new TypeError('Replay restoration policy must be boolean');
 return restoreReplay&&definition?restoreOwnerFluidReplay(setup,params,definition):setup;
}
