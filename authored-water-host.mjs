import {SCENE_LIQUID_SUPPORT_ROUTE} from './scene-liquid-support.mjs';
import {normalizeFiniteWaterTimeStep} from './local-liquid-setup.mjs';
import {createAuthoredWaterDrop,describeAuthoredWaterDrop,inspectAuthoredWaterCompatibility,resolveAuthoredWaterSampling} from './authored-water-drop.mjs';
import {createFiniteFluidHost} from './finite-fluid-host.mjs';
import {createWebGPUFingerFluidSolver,resolveFingerFluidParticleCount} from './finger-fluid-webgpu-core.js';

export function authoredDropSetup(records,{densityIterations=2,materialControls={},waterSampling=null,simulationStepSeconds=1/240}={}) {
 const dt=normalizeFiniteWaterTimeStep(simulationStepSeconds);
 const finite=records.filter(r=>r.localLiquidEmitter?.mode==='finite_drop');
 if(!finite.length)throw Error('No finite water source in the scene');
 if(records.some(r=>r.localLiquidEmitter?.mode!=='finite_drop'&&r.localLiquidEmitter?.rate>0))throw Error('Stop continuous sources before releasing finite water; mixed allocation is not supported yet');
 const sampling=waterSampling?resolveAuthoredWaterSampling(records,{waterSampling}):null;
 const proposed=finite.map(r=>describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,sampling));
 const particleCount=proposed.reduce((n,f)=>n+f.particleCount,0);resolveFingerFluidParticleCount(particleCount);
 const compatibility=inspectAuthoredWaterCompatibility(records,sampling);if(!compatibility.compatible)throw Error(compatibility.message);
 const fixtures=finite.map(r=>createAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,sampling));
 const first=fixtures[0];
 const data=new Float32Array(particleCount*16);let offset=0;for(const f of fixtures){data.set(f.population.particleData,offset);offset+=f.population.particleData.length;}
 const population={...first.population,particleData:data,particleCount,worldVolume:fixtures.reduce((n,f)=>n+f.worldVolume,0)};
 return {waterSampling:sampling,dt,playbackMode:'render_cadence',playbackRate:1,support:{kind:'invisible_box',box:first.box},sourceIds:finite.map(r=>r.id),sourceRecords:records.map(r=>[r.id,r.transform,r.localLiquidEmitter]),
  solver:{materialScaling:'reference_acceleration',supportContactRoute:SCENE_LIQUID_SUPPORT_ROUTE,particleCount,diagnosticPopulation:population,diagnosticBox:first.box,diagnosticDynamics:'assembled',pressureSolver:'pbf',ipbfBoundaryMode:'collision_only',cohesionModel:'legacy',truthScene:'multi_regime_playground',rendererMode:'screen_space_refraction',colorMode:'phase',viscosityScaling:'nominal_diffusion',particleRepulsionStrength:.62,densityIterations,capillaryStrength:.48,freeFlightViscosityBoost:.30,...materialControls,substeps:1,adaptiveDensity:false,densityCellRejection:true,uniformVolumeDensityKernel:true,energyDiagnosticsMode:'disabled'}};
}

export async function createAuthoredWaterHost(options) {
 let records=structuredClone(options.emitters??[]);let pendingSetup=structuredClone(options.setup??{});
 if(!records.some(r=>r.localLiquidEmitter?.mode==='finite_drop')){
  const {createLocalLiquidHost}=await import('./local-liquid-host.mjs');return createLocalLiquidHost(options);
 }
 const initial=authoredDropSetup(records,options.setup);
 const {createFluidViewportHost}=await import('./fluid-viewport-host.mjs');
 const finite=await createFiniteFluidHost({setup:initial,device:options.device,isCurrent:options.isCurrent,redraw:options.redraw,readColliders:options.readColliders??(()=>[]),
  createSolver:createWebGPUFingerFluidSolver,createPresentation:solver=>createFluidViewportHost({...options,solver,supportIdentity:initial.solver.supportContactRoute})});
 return {...finite,
  get paused(){return finite.paused;},
  get presentation(){return finite.presentation;},
  get proxyStepEvery(){return finite.proxyStepEvery;},
  setEmitters(next){records=structuredClone(next);return false;},
  setSetup(next){pendingSetup=structuredClone(next);},
  state:()=>({...finite.state(),mode:'finite_drop',registered:true,mounted:true,sourceIds:initial.sourceIds,sourceGeneration:finite.capability.read().clock.generation,pendingSourceChanges:JSON.stringify(records.map(r=>[r.id,r.transform,r.localLiquidEmitter]))!==JSON.stringify(initial.sourceRecords??[])||JSON.stringify(pendingSetup)!==JSON.stringify(options.setup??{})}),
 };
}
