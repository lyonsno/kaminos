import {createFingerFluidBoxReference} from '../../finger-fluid-box-fixtures.mjs';
import {viscosityScale} from '../../finger-fluid-viscosity-scale.mjs';
import {validateMaterialControls} from '../../finger-fluid-material-controls.mjs';
export function lazarusFiniteSetup(input={}){
 const values={scene:'block_drop',resolution:24,dt:1/240,rate:1,scaling:'nominal_diffusion',particleRepulsionStrength:.62,densityIterations:3,capillaryStrength:.48,freeFlightViscosityBoost:.30,...input};
 for(const key of Object.keys(input))if(!Object.hasOwn({scene:1,resolution:1,dt:1,rate:1,scaling:1,particleRepulsionStrength:1,densityIterations:1,capillaryStrength:1,freeFlightViscosityBoost:1},key))throw Error('Unknown finite PBF setting: '+key);
 if(![1/240,1/120,1/60].includes(values.dt))throw Error('Unsupported physics timestep');
 if(!Number.isFinite(values.rate)||values.rate<=0)throw Error('Playback rate must be finite and positive');
 const fixture=createFingerFluidBoxReference(values),h=.185*Math.cbrt(fixture.population.particleVolumeScale);
 viscosityScale(values.scaling,values.dt,h);
 validateMaterialControls({particleRepulsionStrength:values.particleRepulsionStrength,densityIterations:values.densityIterations,capillaryStrength:values.capillaryStrength,freeFlightViscosityBoost:values.freeFlightViscosityBoost});
 return {inputs:values,dt:values.dt,playbackRate:values.rate,support:{kind:'invisible_box',box:fixture.box},sampling:{worldVolume:fixture.representedVolume,particleVolume:fixture.particleVolume,spacing:fixture.spacing,supportRadius:h,supportMode:'PBF_volume_scaled'},
 guide:{question:'Does this water remain coherent at the same physical size as sampling changes?',tryThis:'Keep physics timestep and density passes fixed. Playback speed changes viewing cadence. Compare the same simulated time.',whyThisMatters:'Nominal diffusion scaling derives b h² / dt independently of the accepted river tuning.'},
 solver:{particleCount:fixture.particleCount,diagnosticPopulation:fixture.population,diagnosticBox:fixture.box,diagnosticDynamics:'assembled',pressureSolver:'pbf',cohesionModel:'legacy',truthScene:'multi_regime_playground',rendererMode:'screen_space_refraction',colorMode:'phase',viscosityScaling:values.scaling,particleRepulsionStrength:values.particleRepulsionStrength,densityIterations:values.densityIterations,capillaryStrength:values.capillaryStrength,freeFlightViscosityBoost:values.freeFlightViscosityBoost,substeps:1,adaptiveDensity:false,densityCellRejection:true,uniformVolumeDensityKernel:true,energyDiagnosticsMode:'disabled'}};
}
