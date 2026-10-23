import {resolveFingerFluidParticleCount} from '../../finger-fluid-webgpu-core.js';
import {createFingerFluidBoxReference,describeFingerFluidBoxReference} from '../../finger-fluid-box-fixtures.mjs';
import {viscosityScale} from '../../finger-fluid-viscosity-scale.mjs';
import {validateMaterialControls} from '../../finger-fluid-material-controls.mjs';
export function describeLazarusFiniteSetup(input={}){
 const values={scene:'block_drop',resolution:24,blockWidth:1,dt:1/240,rate:1,playbackMode:'wall_time',scaling:'nominal_diffusion',particleRepulsionStrength:.62,densityIterations:3,capillaryStrength:.48,freeFlightViscosityBoost:.30,...input};
 for(const key of Object.keys(input))if(!Object.hasOwn({scene:1,resolution:1,blockWidth:1,dt:1,rate:1,playbackMode:1,scaling:1,particleRepulsionStrength:1,densityIterations:1,capillaryStrength:1,freeFlightViscosityBoost:1},key))throw Error('Unknown finite PBF setting: '+key);
 if(![1/240,1/120,1/60].includes(values.dt))throw Error('Unsupported physics timestep');
 if(!Number.isFinite(values.rate)||values.rate<=0)throw Error('Playback rate must be finite and positive');
 if(!['wall_time','render_cadence'].includes(values.playbackMode))throw Error('Unknown playback mode');
 const fixture=describeFingerFluidBoxReference(values),h=fixture.supportRadius;
 const viscosityFactor=viscosityScale(values.scaling,values.dt,h);
 validateMaterialControls({particleRepulsionStrength:values.particleRepulsionStrength,densityIterations:values.densityIterations,capillaryStrength:values.capillaryStrength,freeFlightViscosityBoost:values.freeFlightViscosityBoost});
 let particleAdmission;try{resolveFingerFluidParticleCount(fixture.particleCount);particleAdmission={ok:true};}catch(e){particleAdmission={ok:false,reason:e.message};}
 return {inputs:values,sampling:{worldVolume:fixture.representedVolume,blockVolume:fixture.blockVolume,puddleVolume:fixture.puddleVolume,particleCount:fixture.particleCount,blockSamples:fixture.blockSamples,blockWidth:fixture.blockWidth,particleVolume:fixture.particleVolume,spacing:fixture.spacing,supportRadius:h,collisionRadius:fixture.collisionRadius,baseGlyphRadius:fixture.baseGlyphRadius,supportRatio:h/fixture.spacing,viscosityFactor,particleAdmission,supportMode:'PBF_volume_scaled'},fixture};
}
export function lazarusFiniteSetup(input={}) {
 const preview=describeLazarusFiniteSetup(input),values=preview.inputs;
 if(!preview.sampling.particleAdmission.ok)throw Error(preview.sampling.particleAdmission.reason);
 const fixture=createFingerFluidBoxReference(values);
 return {inputs:values,dt:values.dt,playbackRate:values.rate,playbackMode:values.playbackMode,support:{kind:'invisible_box',box:fixture.box},sampling:preview.sampling,
 guide:{question:'Does this water remain coherent at the same physical size as sampling changes?',tryThis:'Hold samples per unit to change only block amount. Hold block width to refine sampling. Compare the same simulated time.',whyThisMatters:'Nominal diffusion scaling derives b h² / dt independently of the accepted river tuning.'},
 solver:{materialScaling:'reference_acceleration',particleCount:fixture.particleCount,diagnosticPopulation:fixture.population,diagnosticBox:fixture.box,diagnosticDynamics:'assembled',pressureSolver:'pbf',ipbfBoundaryMode:'collision_only',cohesionModel:'legacy',truthScene:'multi_regime_playground',rendererMode:'screen_space_refraction',colorMode:'phase',viscosityScaling:values.scaling,particleRepulsionStrength:values.particleRepulsionStrength,densityIterations:values.densityIterations,capillaryStrength:values.capillaryStrength,freeFlightViscosityBoost:values.freeFlightViscosityBoost,substeps:1,adaptiveDensity:false,densityCellRejection:true,uniformVolumeDensityKernel:true,energyDiagnosticsMode:'disabled'}};
}

export function lazarusFiniteReplayURL(url,inputs){
 const setup=describeLazarusFiniteSetup(inputs),u=new URL(url);
 for(const key of ['finger_fluid_density_iterations','finger_fluid_capillary_strength','finger_fluid_repulsion_strength','finger_fluid_free_flight_viscosity_boost'])u.searchParams.delete(key);
 u.searchParams.set('experiment','lazarus/finite-pbf');u.searchParams.set('experiment_inputs',JSON.stringify(setup.inputs));return u.href;
}

// Live scalar edits keep the original population and support; never allocate N³.
export function updateLazarusFiniteControls(setup,patch) {
 const allowed=['rate','playbackMode','particleRepulsionStrength','densityIterations','capillaryStrength','freeFlightViscosityBoost'];
 for(const k of Object.keys(patch))if(!allowed.includes(k))throw Error('Setup edit requires water reset: '+k);
 const {inputs}=describeLazarusFiniteSetup({...setup.inputs,...patch});
 return {...setup,inputs,playbackRate:inputs.rate,playbackMode:inputs.playbackMode,solver:{...setup.solver,...Object.fromEntries(allowed.slice(2).map(k=>[k,inputs[k]]))}};
}
