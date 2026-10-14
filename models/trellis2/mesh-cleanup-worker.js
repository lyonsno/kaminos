// Module worker for the browser mesh finisher, so a page keeps rendering while
// a multi-million-triangle surface is simplified and cleaned.
import {cleanupAndSimplifyPreservingSurface} from './mesh-cleanup.js';

self.onmessage=({data})=>{
  const {id,vertices,triangles,targetFaces,keepLargest}=data??{};
  try{
    const result=cleanupAndSimplifyPreservingSurface(new Float32Array(vertices),new Uint32Array(triangles),{targetFaces,keepLargest});
    self.postMessage({id,ok:true,vertices:result.vertices.buffer,triangles:result.faces.buffer,trace:result.trace},
      [result.vertices.buffer,result.faces.buffer]);
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message??error)});}
};
