import {prepareWholeFracture} from './fracture-whole-prepare.mjs';
import {mapBurnSections} from './burn-structure-core.mjs';
self.onmessage=({data})=>{
  try{
    const {source,material}=data,extent=Math.max(...material.bounds.max.map((v,k)=>v-material.bounds.min[k]));
    const prepared=prepareWholeFracture(source,{labels:new Uint32Array(source.indices.length/3),boundaries:[]},{cellExtent:extent/4});
    self.postMessage({prepared,mapping:mapBurnSections(prepared,material)});
  }catch(error){self.postMessage({error:error.message});}
};
