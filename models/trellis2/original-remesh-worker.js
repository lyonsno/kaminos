import {buildRemeshBVH} from './original-remesh-bvh.js';
import {prefillRemeshHoles} from './original-remesh-prefill.js';
import {initialCells,gridPoints,refineCells,cornerTable,contourTopology} from './original-remesh-grid.js';
import {simplifyMesh} from './mesh-simplify.js';
import {loadSimplifier} from './wasm-simplify.js';
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
    }else if(operation==='reduce'){
      const v=new Float32Array(data.vertices),t=new Uint32Array(data.triangles);
      const {engine,route,reason}=await loadSimplifier({prefer:data.simplifier??'auto'});
      const reduced=t.length/3<=data.targetFaces?{points:v,triangles:t}:simplifyMesh(v,t,{targetReduction:1-data.targetFaces/(t.length/3),engine:engine??undefined});
      result={vertices:Float32Array.from(reduced.points).buffer,triangles:Uint32Array.from(reduced.triangles).buffer,
        reducer:{route,reason:reason??null,sourceLimit:'Browser fast-simplification QEM; not native CuMesh parallel QEM',inputFaces:t.length/3,outputFaces:reduced.triangles.length/3}};
    }else throw Error('unknown original remesh worker operation '+operation);
    // One transfer per backing buffer, including typed BVH arrays.
    const message={id,ok:true,...result};for(const [k,v] of Object.entries(message))if(ArrayBuffer.isView(v))message[k]=v.buffer;
    const transfer=[...new Set(Object.values(message).filter(v=>v instanceof ArrayBuffer))];
    self.postMessage(message,transfer);
  }catch(error){self.postMessage({id,ok:false,error:String(error?.stack??error)});}
};
