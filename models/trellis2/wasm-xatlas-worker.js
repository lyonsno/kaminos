// Module worker for the browser UV step (xatlas Wasm, source post-steps and
// normal law), so a page keeps rendering during the unwrap.
import {finishUVSurface} from './wasm-xatlas.js';

self.onmessage=async({data})=>{
  const {id,vertices,triangles}=data??{};
  try{
    const r=await finishUVSurface(new Float32Array(vertices),new Uint32Array(triangles));
    self.postMessage({id,ok:true,vertices:r.vertices.buffer,triangles:r.triangles.buffer,normals:r.normals.buffer,uvs:r.uvs.buffer,info:r.info},
      [r.vertices.buffer,r.triangles.buffer,r.normals.buffer,r.uvs.buffer]);
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message??error)});}
};
