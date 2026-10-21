// Authored immersed sources share a field, but retain their local supply law.
import {resolveImmersedSourceConfig,immersedSourceUniformValues,immersedCoverageMapForConfig,createImmersedSourceWeightCache} from './volume-core.js';
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
  return {id:record.id,controls};
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
  const config=resolveImmersedSourceConfig(local,{grid,gridHeight,solidCells,weightCache:cache,inletSignals:inlet,puffFactor:inlet.puffFactor});
  const offset=(index+1)*layerFloats;data.set(immersedSourceUniformValues(config),offset);
  if(config.effective.admitted){
   const map=immersedCoverageMapForConfig(config),noise=inlet.turbulence?.field;
   for(let z=0;z<grid;z++)for(let x=0;x<grid;x++){
    const j=z*grid+x,k=offset+((z+1)*width+x)*4;data[k]=map?.cells[j]??1;data[k+1]=noise?.[j]??0;
   }
  }
  return {id:record.id,config};
 });
 return {identity:IMMERSED_COLLECTION_IDENTITY,count:sources.length,width,height,layers:sources.length+1,data,sources};
}
export {IMMERSED_COLLECTION_WGSL} from './volume-immersed-source-collection-wgsl.mjs';
