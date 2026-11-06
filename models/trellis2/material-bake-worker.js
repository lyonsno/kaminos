// Module worker for the TRELLIS texture bake, so the page keeps rendering while
// a large surface is baked.
import {bakeTrellisMaterialTextures,trellisMaterialBakePositions} from './trellis-material.js';

self.onmessage=({data})=>{
  const {id,vertices,triangles,uvs,coordinates,features,resolution,textureSize,samplePositions,operation}=data??{};
  try{
    if(operation==='positions'){
      const positions=trellisMaterialBakePositions({vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles),uvs:new Float32Array(uvs),textureSize});
      self.postMessage({id,ok:true,positions:positions.buffer},[positions.buffer]);return;
    }
    const t=bakeTrellisMaterialTextures({vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles),uvs:new Float32Array(uvs),
      coordinates:new Int32Array(coordinates),features:new Float32Array(features),resolution,textureSize,...(samplePositions?{samplePositions:new Float32Array(samplePositions)}:{})});
    self.postMessage({id,ok:true,...t,baseColor:t.baseColor.buffer,metallicRoughness:t.metallicRoughness.buffer},[t.baseColor.buffer,t.metallicRoughness.buffer]);
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message??error)});}
};
