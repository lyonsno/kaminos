import {createPromptReliefPixels} from './inference-kiln-relief.mjs';
import {createLogSurfaceMask} from './live-log-surface-mask.mjs';
import {LIVE_LOG_GRID} from './live-log-heat-core.mjs';
// CPU topology and voxel classification stay off the input/rendering thread.
self.onmessage=({data:{id,pixels}})=>{
 try{
  self.postMessage({id,phase:'tracing'});
  const geometry=createPromptReliefPixels(pixels);
  self.postMessage({id,phase:'classifying'});
  const mask=createLogSurfaceMask(geometry,geometry.boundingBox,LIVE_LOG_GRID,{filled:true});
  const attributes=Object.fromEntries(Object.entries(geometry.attributes).map(([key,a])=>[key,{array:a.array,itemSize:a.itemSize,normalized:a.normalized}]));
  const result={id,attributes,groups:geometry.groups,mask,samples:mask.samples,surface:mask.surface};
  const buffers=[...Object.values(attributes).map(a=>a.array.buffer),mask.buffer,mask.samples.buffer,mask.surface.buffer];
  self.postMessage(result,buffers);geometry.dispose();
 }catch(error){self.postMessage({id,error:error.message});}
};
