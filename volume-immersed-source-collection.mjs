// Authored immersed sources share a field, but retain their local supply law.
import {resolveImmersedSourceConfig,immersedSourceUniformValues,immersedCoverageMapForConfig,createImmersedSourceWeightCache,immersedSlabLookup} from './volume-core.js';
export const IMMERSED_COLLECTION_IDENTITY='kaminos.volume.immersed-source-collection.v1';
const sourceKey=key=>/^(immersed|emitter)/.test(key)||['inputRadius','flowRate','fixedSourceDephase'].includes(key);
export function checkedImmersedSources(records){
 if(!Array.isArray(records))throw Error('Immersed sources require a complete array');
 const ids=new Set();
 return records.map(record=>{
  if(!record||typeof record.id!=='string'||!record.id.trim()||!record.controls||typeof record.controls!=='object'||Array.isArray(record.controls))throw Error('Invalid immersed source record');
  if(ids.has(record.id))throw Error('Duplicate immersed source identity');ids.add(record.id);
  const controls={};
  for(const [key,value] of Object.entries(record.controls))if(sourceKey(key)){
   if(typeof value==='number'&&!Number.isFinite(value))throw Error(`Immersed source ${key} must be finite`);
   if(!['number','boolean','string'].includes(typeof value))throw Error(`Invalid immersed source control ${key}`);
   if(typeof value==='string'&&key.startsWith('immersed')&&key!=='immersedSourceEnabled'&&!Number.isFinite(Number(value)))throw Error(`Immersed source ${key} must be finite`);
   controls[key]=value;
  }
  if(controls.emitterSourceLaw!=='immersed-source')throw Error('Collection sources require the immersed source law');
  if(controls.immersedSourceEnabled!==undefined&&typeof controls.immersedSourceEnabled!=='boolean')throw Error('Immersed source enabled must be boolean');
  if(record.worldSource!==undefined&&typeof record.worldSource!=='boolean')throw Error('World source flag must be boolean');
  return {id:record.id,controls,...(record.worldSource?{worldSource:true}:{})};
 }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
// One rgba32float array layer per source: six coefficient texels in row zero,
// then coverage and the step's turbulence lattice in R/G. Layer zero is metadata.
// This consumes one sampled texture, preserving the existing storage-buffer budget.
export function compileImmersedSourceCollection(records,{controls={},grid,gridHeight,solidCells=null,signalsFor=()=>({}),weightCaches=new Map()}={}){
 const checked=checkedImmersedSources(records),width=Math.max(6,grid),height=grid+1,layerFloats=width*height*4;
 const data=new Float32Array(layerFloats*(checked.length+1));data.set([1,checked.length,grid,0]);
 const sources=checked.map((record,index)=>{
  const local={...controls,...record.controls},inlet=signalsFor(record.id,local);
  let cache=weightCaches.get(record.id);if(!cache){cache=createImmersedSourceWeightCache();weightCaches.set(record.id,cache);}
  if(record.worldSource){cache.full??=createImmersedSourceWeightCache();cache.world??=createImmersedSourceWeightCache();}
  const config=resolveImmersedSourceConfig(local,{grid,gridHeight,solidCells,weightCache:cache,inletSignals:inlet,puffFactor:inlet.puffFactor,worldSource:record.worldSource,fullWeightCache:cache.full});
  const offset=(index+1)*layerFloats;data.set(immersedSourceUniformValues(config),offset);
  if(config.effective.admitted){
   const map=immersedCoverageMapForConfig(config),noise=inlet.turbulence?.field;
   for(let z=0;z<grid;z++)for(let x=0;x<grid;x++){
    const j=z*grid+x,k=offset+((z+1)*width+x)*4;data[k]=map?.cells[j]??1;data[k+1]=noise?.[j]??0;
   }
  }
  return {id:record.id,config,...(record.worldSource?{worldSource:true,inlet,weights:config.effective.admitted?cache.world.read(config.effective,{grid,gridHeight,unbounded:true}):null}: {})};
 });
 return {identity:IMMERSED_COLLECTION_IDENTITY,count:sources.length,width,height,layers:sources.length+1,data,sources};
}
export {IMMERSED_COLLECTION_WGSL} from './volume-immersed-source-collection-wgsl.mjs';

// Fine owns injection in its cells; each disjoint exterior parcel supplies the
// same physical source to independently sized world flow/material recipients.
export function compileWorldSourceParcels(packed,{grid,gridHeight,transform,anchor}){
 const scale=transform.scale/anchor.scale,pitch=2/grid*scale,offset=transform.translate.map((v,a)=>(v-anchor.translate[a])/anchor.scale);
 const parcels=[],supports=[];let count=0;
 for(const source of packed.sources){
  const e=source.config.effective;if(!source.worldSource||!e.admitted)continue;count++;
  const noise=source.inlet?.turbulence?.field,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  let emitted=false;
  for(const cell of source.weights.cells){
   const c=[cell.x,cell.y,cell.z];
   if(c.every((v,a)=>v>=0&&v<(a===1?gridHeight:grid)))continue;
   const d=c.map((v,a)=>v+.5-e.centreCells[a]);
   const weight=cell.w*Math.max(0,1+e.inletDynamics.turbulence*(noise?.[immersedSlabLookup(d,e.basis,grid).index]??0));
   const rate=Math.min(e.capPerCell,weight*e.fullFlux/e.fullWeightSum);if(rate<=0)continue;
   const lower=c.map((v,a)=>offset[a]+(v*2/grid-1)*scale),upper=lower.map(v=>v+pitch);
   parcels.push({lo:lower,hi:upper,rate,fuel:e.fuel,heat:e.temperature,relax:Math.min(1,weight*e.momentumGain),velocity:e.direction.map(v=>v*e.speed*pitch)});
   for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],lower[a]);hi[a]=Math.max(hi[a],upper[a]);}emitted=true;
  }
  if(emitted)supports.push({lo,hi,heat:e.temperature,fuel:e.fuel});
 }
 return {parcels,supports,count};
}
