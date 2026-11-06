// finishTrellisMesh bakeMaterial provider for the page: the same
// bakeTrellisMaterialTextures, in material-bake-worker.js when a WorkerClass is
// given, so a large surface or a 4K texture does not stall the page thread.
// Stop terminates the worker; the caller's arrays are copied, never detached.
import {bakeTrellisMaterialTextures,trellisMaterialBakePositions} from './trellis-material.js';
import {admitSignal,abortError,runFinishingWorker} from './finishing-worker.js';

export function createBrowserMaterialBaker({WorkerClass,signal,projectPositions,withCpu=(_phase,work)=>work()}={}){
  if(WorkerClass!==undefined&&typeof WorkerClass!=='function')throw TypeError('WorkerClass must be a Worker constructor');
  admitSignal(signal);
  if(projectPositions!==undefined&&typeof projectPositions!=='function')throw TypeError('original surface projector must be a function');
  const tag=(textures,execution)=>({...textures,metadata:{...textures.metadata,execution}});
  if(!WorkerClass)return async input=>{
    // Synchronous on this thread: Stop is honoured before and after, not mid-call.
    if(signal?.aborted)throw abortError(signal);
    const samplePositions=projectPositions?await projectPositions(trellisMaterialBakePositions(input)):undefined;
    const textures=bakeTrellisMaterialTextures({...input,...(samplePositions?{samplePositions}:{})});
    if(signal?.aborted)throw abortError(signal);
    return tag(textures,'caller-thread');
  };
  return async ({vertices,triangles,uvs,coordinates,features,resolution,textureSize})=>{
    const arrays={vertices:Float32Array.from(vertices),triangles:Uint32Array.from(triangles),uvs:Float32Array.from(uvs),
      coordinates:Int32Array.from(coordinates),features:Float32Array.from(features)};
    if(projectPositions){
      const rasterArrays={vertices:arrays.vertices.slice(),triangles:arrays.triangles.slice(),uvs:arrays.uvs.slice()};
      const positions=await withCpu('original-remesh-texel-raster',()=>runFinishingWorker({WorkerClass,url:new URL('./material-bake-worker.js',import.meta.url),signal,label:'original surface texel positions',
        message:{operation:'positions',...Object.fromEntries(Object.entries(rasterArrays).map(([k,v])=>[k,v.buffer])),textureSize},transfer:Object.values(rasterArrays).map(v=>v.buffer)}));
      arrays.samplePositions=await projectPositions(new Float32Array(positions.positions));
      if(!(arrays.samplePositions instanceof Float32Array)||arrays.samplePositions.length!==positions.positions.byteLength/4||!arrays.samplePositions.every(Number.isFinite))
        throw Error('complete finite original-surface sample positions required');
    }
    const data=await withCpu('trellis-texture-bake',()=>runFinishingWorker({WorkerClass,url:new URL('./material-bake-worker.js',import.meta.url),signal,label:'texture bake',
      message:{...Object.fromEntries(Object.entries(arrays).map(([k,v])=>[k,v.buffer])),resolution,textureSize},
      transfer:Object.values(arrays).map(v=>v.buffer)}));
    const {id,ok,baseColor,metallicRoughness,...rest}=data;
    return tag({...rest,baseColor:new Uint8Array(baseColor),metallicRoughness:new Uint8Array(metallicRoughness)},'module-worker');
  };
}
