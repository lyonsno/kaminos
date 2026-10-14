import {createAuthoredWaterDrop} from './authored-water-drop.mjs';
import {createFiniteFluidHost} from './finite-fluid-host.mjs';
import {createWebGPUFingerFluidSolver,resolveFingerFluidParticleCount} from './finger-fluid-webgpu-core.js';

export function authoredDropSetup(records,{densityIterations=2,materialControls={}}={}) {
 const finite=records.filter(r=>r.localLiquidEmitter?.mode==='finite_drop');
 if(!finite.length)throw Error('No finite water source in the scene');
 if(records.some(r=>r.localLiquidEmitter?.mode!=='finite_drop'&&r.localLiquidEmitter?.rate>0))throw Error('Stop continuous sources before releasing finite water; mixed allocation is not supported yet');
 const fixtures=finite.map(r=>createAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform));
 const boxKey=f=>JSON.stringify(f.box),first=fixtures[0];
 if(fixtures.some(f=>boxKey(f)!==boxKey(first)||Math.abs(f.particleVolume-first.particleVolume)>1e-12))throw Error('Finite sources in one allocation require the same world bounds and particle spacing');
 const particleCount=fixtures.reduce((n,f)=>n+f.particleCount,0);resolveFingerFluidParticleCount(particleCount);
 const data=new Float32Array(particleCount*16);let offset=0;for(const f of fixtures){data.set(f.population.particleData,offset);offset+=f.population.particleData.length;}
 const population={...first.population,particleData:data,particleCount,worldVolume:fixtures.reduce((n,f)=>n+f.worldVolume,0)};
 return {dt:1/240,playbackMode:'render_cadence',playbackRate:1,support:{kind:'invisible_box',box:first.box},sourceIds:finite.map(r=>r.id),
  solver:{particleCount,diagnosticPopulation:population,diagnosticBox:first.box,diagnosticDynamics:'assembled',pressureSolver:'pbf',ipbfBoundaryMode:'collision_only',cohesionModel:'legacy',truthScene:'multi_regime_playground',rendererMode:'screen_space_refraction',colorMode:'phase',viscosityScaling:'nominal_diffusion',particleRepulsionStrength:.62,densityIterations,capillaryStrength:.48,freeFlightViscosityBoost:.30,...materialControls,substeps:1,adaptiveDensity:false,densityCellRejection:true,uniformVolumeDensityKernel:true,energyDiagnosticsMode:'disabled'}};
}

export async function createAuthoredWaterHost(options) {
 let records=structuredClone(options.emitters??[]);
 if(!records.some(r=>r.localLiquidEmitter?.mode==='finite_drop')){
  const {createLocalLiquidHost}=await import('./local-liquid-host.mjs');return createLocalLiquidHost(options);
 }
 const initial=authoredDropSetup(records,options.setup);
 const {createFluidViewportHost}=await import('./fluid-viewport-host.mjs');
 const finite=await createFiniteFluidHost({setup:initial,device:options.device,isCurrent:options.isCurrent,redraw:options.redraw,
  createSolver:createWebGPUFingerFluidSolver,createPresentation:solver=>createFluidViewportHost({...options,solver})});
 return {...finite,
  setEmitters(next){records=structuredClone(next);return false;},
  setSetup(){},
  state:()=>({...finite.state(),mode:'finite_drop',registered:true,mounted:true,sourceIds:initial.sourceIds,sourceGeneration:finite.capability.read().clock.generation}),
 };
}
