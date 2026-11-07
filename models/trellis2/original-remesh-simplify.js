import {createCuMeshReducerGpu} from './original-remesh-simplify-gpu.js';
import {abortError} from './finishing-worker.js';

// Native simplify wrapper, shared by the original finisher and retained-stage
// replay. CPU adjacency/compaction are supplied by the existing worker request
// path. No alternate reducer or hidden iteration/output cap.
export async function reduceCuMeshSurface(vertices,triangles,{targetFaces,device,request,signal,onProgress=()=>{},withGpu=(_phase,work)=>work()}){
  const reductionTrace=[],reducerInputFaces=triangles.length/3;
  if(!Number.isSafeInteger(targetFaces)||targetFaces<1)throw RangeError('positive targetFaces required');
  let threshold=1e-8;
  if(reducerInputFaces>targetFaces){
    const step=await createCuMeshReducerGpu({device,signal,onProgress,withGpu});
    while(triangles.length/3>targetFaces){
      if(signal?.aborted)throw abortError(signal);const previous=triangles.length/3;
      const prepared=await request('reduce-prepare',{vertices:vertices.buffer,triangles:triangles.buffer});
      const result=await step(new Float32Array(prepared.vertices),new Uint32Array(prepared.triangles),
        {...prepared,packed:new Uint32Array(prepared.packed),edges:new Uint32Array(prepared.edges)},{threshold});
      const reduced=await request('reduce-compact',{vertices:result.vertices.buffer,triangles:result.triangles.buffer,flags:result.flags.buffer});
      vertices=new Float32Array(reduced.vertices);triangles=new Uint32Array(reduced.triangles);
      const faces=triangles.length/3;reductionTrace.push({threshold,inputFaces:previous,outputFaces:faces});
      onProgress({kind:'original-remesh-qem-step',...reductionTrace.at(-1)});
      if(!Number.isFinite(Math.fround(threshold))&&previous===faces)throw Error('CuMesh reduction has no eligible collapse at unbounded threshold');
      if((previous-faces)/previous<.01)threshold*=10;
    }
  }
  return {vertices,triangles,reducer:{route:'CuMesh parallel QEM / WebGPU',propagation:'native face-gather lexicographic cost/id',inputFaces:reducerInputFaces,outputFaces:triangles.length/3,targetFaces,lambdaLength:.01,lambdaSkinny:.001,steps:reductionTrace}};
}
