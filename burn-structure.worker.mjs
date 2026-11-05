import {prepareWholeFracture} from './fracture-whole-prepare.mjs';
import {mapBurnSections} from './burn-structure-core.mjs';
self.onmessage=({data})=>{
  try{
    const {source,material,detail=false}=data,extent=Math.max(...material.bounds.max.map((v,k)=>v-material.bounds.min[k]));
    const options=detail?{cellExtent:extent/6,targetPieces:80,cutVariation:1}:{cellExtent:extent/4};
    const prepared=prepareWholeFracture(source,{labels:new Uint32Array(source.indices.length/3),boundaries:[]},options);
    self.postMessage({prepared,mapping:mapBurnSections(prepared,material)});
  }catch(error){self.postMessage({error:error.message});}
};
