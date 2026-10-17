// Module worker for the browser mesh finisher, so a page keeps rendering while
// a multi-million-triangle surface is simplified and cleaned.
import {cleanupAndSimplifyPreservingSurface} from './mesh-cleanup.js';
import {loadSimplifier} from './wasm-simplify.js';

self.onmessage=async({data})=>{
  const {id,vertices,triangles,targetFaces,keepLargest,progress,simplifier}=data??{};
  try{
    const onProgress=progress?e=>self.postMessage({id,progress:e}):undefined;
    const {engine,route,reason}=await loadSimplifier({prefer:simplifier??'auto'});
    const result=cleanupAndSimplifyPreservingSurface(new Float32Array(vertices),new Uint32Array(triangles),{targetFaces,keepLargest,onProgress,simplifier:engine??undefined});
    self.postMessage({id,ok:true,vertices:result.vertices.buffer,triangles:result.faces.buffer,trace:result.trace,simplifier:{route,...(reason?{reason}:{}),...(engine?.fallback?{fallback:engine.fallback.reason}:{})}},
      [result.vertices.buffer,result.faces.buffer]);
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message??error)});}
};
