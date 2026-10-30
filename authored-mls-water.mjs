import {Euler,Vector3} from './lib/three.core.js';
import {normalizeLocalLiquidEmitter,normalizeLocalLiquidEmitterPose,LOCAL_LIQUID_EMITTER_TYPE} from './local-liquid-setup.mjs';
import {describeAuthoredWaterDrop,inspectAuthoredWaterCompatibility,resolveAuthoredWaterSampling} from './authored-water-drop.mjs';
import {mlsConfig,MLS_ROUTE,validateMlsPacket} from './mls-juice-contract.mjs';

// Source objects retain their authored units. The old PBF adapter's radius and
// speed divisors are deliberately absent from this engine's world-unit packet.
export function authoredMlsInlets(records,epochMs=Date.now(),generation=1){
 const emitters=[];
 for(const r of records){
  if(r?.type!==LOCAL_LIQUID_EMITTER_TYPE||typeof r.id!=='string'||!r.id)throw Error('Invalid authored MLS water source');
  const pose=normalizeLocalLiquidEmitterPose(r.transform),s=normalizeLocalLiquidEmitter(r.localLiquidEmitter,pose);
  if(s.mode==='finite_drop')continue;
  emitters.push({id:r.id,active:s.rate>0,origin_world:pose.position,aim_world:new Vector3(0,0,1).applyEuler(new Euler(...pose.rotation)).toArray(),
   radius:s.baseRadius*pose.scale[0],strength:s.strength,source_flux_particles_per_second:s.rate,lifetime_seconds:s.lifetimeSeconds??1e30});
 }
 return validateMlsPacket({packet_id:`authored-mls-${generation}`,route_identity:MLS_ROUTE,authority:{simulation_safe:true},timestamp_ms:epochMs,emitters});
}

export function authoredMlsSetup(records,options={}){
 authoredMlsInlets(records.filter(r=>r.localLiquidEmitter?.mode!=='finite_drop'));
 const finite=records.filter(r=>r.localLiquidEmitter.mode==='finite_drop');
 const sampling=resolveAuthoredWaterSampling(records,options);
 const compatibility=inspectAuthoredWaterCompatibility(records,options.waterSampling?sampling:null);
 if(!compatibility.compatible)throw Error(compatibility.message);
 const drops=finite.map(r=>({record:r,...describeAuthoredWaterDrop(r.localLiquidEmitter.drop,r.transform,sampling)}));
 const initialCount=drops.reduce((n,d)=>n+d.particleCount,0);
 const hasFlow=records.some(r=>r.localLiquidEmitter.mode!=='finite_drop');
 const capacity=initialCount+(hasFlow?(options.particleCount??12000):0);
 // One unit of mass per sample, at the producer's rest density of three samples
// per grid cell. Deriving cell width from authored spacing preserves that law.
 const cell=finite.length?sampling.spacing*Math.cbrt(3):.05;
 const bounds=structuredClone(sampling.container??sampling.worldBounds);
 const gridSize=bounds.max.map((v,i)=>Math.ceil((v-bounds.min[i])/cell)+5);
 const originWorld=bounds.min.map(v=>v-2*cell);
 const solver={particleCount:capacity||options.particleCount||12000,cellSize:cell,gridSize,originWorld,
  boundaryWalls:sampling.container!==null,obstacle:null,trackPopulation:true};
 const config=mlsConfig(solver),initialParticles=new Float32Array(initialCount*20);let slot=0;
 for(const d of drops){
  const rotation=new Euler(...d.record.transform.rotation),origin=new Vector3(...d.record.transform.position);
  for(let x=0;x<d.samplesAcross;x++)for(let y=0;y<d.samplesAcross;y++)for(let z=0;z<d.samplesAcross;z++){
   const p=new Vector3(x-(d.samplesAcross-1)/2,y-(d.samplesAcross-1)/2,z-(d.samplesAcross-1)/2).multiplyScalar(d.spacing).applyEuler(rotation).add(origin);
   const grid=p.toArray().map((v,i)=>(v-config.min[i])/cell);
   if(grid.some((v,i)=>v<2||v>config.dimensions[i]-3))throw Error('Initial water lies outside the MLS grid. Fit the simulation bounds before releasing.');
   initialParticles.set([...grid,1e30],slot++*20); // finite releases do not age out
  }
 }
 return {route:MLS_ROUTE,solver,initialParticles,waterSampling:sampling,sourceIds:records.map(r=>r.id),initialCount,
  sourceRecords:records.map(({id,type,transform,localLiquidEmitter})=>structuredClone({id,type,transform,localLiquidEmitter})),mode:finite.length?(hasFlow?'mixed':'finite_drop'):'continuous'};
}
