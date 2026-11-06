import {buildRemeshBVH} from './original-remesh-bvh.js';
import {prefillRemeshHoles} from './original-remesh-prefill.js';
import {initialCells,gridPoints,refineCells,cornerTable,contourTopology} from './original-remesh-grid.js';
import {reducerTopology,compactReduction} from './original-remesh-simplify-topology.js';
let settings,coords,level;
self.onmessage=async({data})=>{
  const {id,operation}=data;
  try{
    let result;
    if(operation==='initialize'){
      settings=data.settings;
      const filled=prefillRemeshHoles(new Float32Array(data.vertices),new Uint32Array(data.triangles));
      const bvh=buildRemeshBVH(filled.vertices,filled.triangles);result={...bvh,prefill:filled.receipt};
    }else if(operation==='grid-start'){
      level=settings.base;coords=initialCells(level);result={level,points:gridPoints(coords,level,settings,true).buffer};
    }else if(operation==='grid-refine'){
      coords=refineCells(coords,new Float32Array(data.distances),level,settings);
      if(level===settings.resolution){const table=cornerTable(coords,settings.resolution);result={done:true,coords:coords.slice().buffer,indices:table.indices.buffer,points:gridPoints(table.corners,level,settings).buffer};}
      else{level*=2;result={done:false,level,points:gridPoints(coords,level,settings,true).buffer};}
    }else if(operation==='topology'){
      const mesh=contourTopology(coords,new Float32Array(data.dual),new Int32Array(data.intersections),settings);
      result={vertices:mesh.vertices.buffer,triangles:mesh.triangles.buffer};
    }else if(operation==='reduce-prepare'){
      const v=new Float32Array(data.vertices),t=new Uint32Array(data.triangles);
      const topology=reducerTopology(v,t);
      result={...topology,vertices:v.buffer,triangles:t.buffer};
    }else if(operation==='reduce-compact'){
      const reduced=compactReduction(new Float32Array(data.vertices),new Uint32Array(data.triangles),new Uint32Array(data.flags));
      result={vertices:reduced.vertices.buffer,triangles:reduced.triangles.buffer};
    }else throw Error('unknown original remesh worker operation '+operation);
    // One transfer per backing buffer, including typed BVH arrays.
    const message={id,ok:true,...result};for(const [k,v] of Object.entries(message))if(ArrayBuffer.isView(v))message[k]=v.buffer;
    const transfer=[...new Set(Object.values(message).filter(v=>v instanceof ArrayBuffer))];
    self.postMessage(message,transfer);
  }catch(error){self.postMessage({id,ok:false,error:String(error?.stack??error)});}
};
