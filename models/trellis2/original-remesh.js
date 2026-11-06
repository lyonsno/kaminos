import {remeshSettings} from './original-remesh-grid.js';
import {createRemeshGpu} from './original-remesh-gpu.js';
import {reduceCuMeshSurface} from './original-remesh-simplify.js';
import {validateRemeshSurface} from './original-remesh-bvh.js';
import {admitSignal,abortError} from './finishing-worker.js';
export const ORIGINAL_REMESH_ROUTE='TRELLIS.2/original-narrow-band-dc/WebGPU';

export function createOriginalRemeshPostprocess({device,resolution=512,band=1,projectBack=0,targetFaces,WorkerClass=globalThis.Worker,signal,onProgress=()=>{},onReconstruction}={}){
  if(!device?.createBuffer||!device.queue)throw TypeError('original remesh requires the app GPU device');
  if(typeof WorkerClass!=='function')throw TypeError('original remesh requires a module Worker');
  if(!Number.isSafeInteger(targetFaces)||targetFaces<1)throw RangeError('positive caller-selected targetFaces required');
  admitSignal(signal);const settings=remeshSettings({resolution,band,projectBack});
  let gpu=null,worker=null,pending=null,sequence=0,withCpu=(_phase,work)=>work(),withGpu=(_phase,work)=>work();
  const check=()=>{if(signal?.aborted)throw abortError(signal);};
  const stop=()=>{pending?.reject(abortError(signal));pending=null;worker?.terminate();worker=null;};
  function request(operation,input={}){
    return withCpu('original-remesh-'+operation,()=>requestAdmitted(operation,input));
  }
  function requestAdmitted(operation,input={}){
    check();if(pending)throw Error('original remesh worker already has pending work');
    return new Promise((resolve,reject)=>{
      const id=++sequence;pending={id,resolve,reject};
      const message={id,operation,...input},transfer=Object.values(input).filter(v=>v instanceof ArrayBuffer);
      try{worker.postMessage(message,transfer);}catch(error){pending=null;reject(error);}
    });
  }
  const dispose=()=>{gpu?.dispose();gpu=null;worker?.terminate();worker=null;signal?.removeEventListener('abort',stop);};
  const postprocess=async mesh=>{
    if(worker||gpu)throw Error('original remesh provider must finish/dispose its previous surface first');
    check();validateRemeshSurface(mesh.vertices,mesh.triangles);
    const started=performance.now(),inputVertices=mesh.vertices.length/3,inputFaces=mesh.triangles.length/3,trace=[];
    worker=new WorkerClass(new URL('./original-remesh-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{const p=pending;pending=null;if(!p)return;
      if(data.id!==p.id)p.reject(Error('original remesh worker response identity mismatch'));
      else if(data.ok!==true)p.reject(Error(data.error));else p.resolve(data);};
    worker.onerror=e=>{pending?.reject(Error('original remesh worker: '+e.message));pending=null;};
    worker.onmessageerror=()=>{pending?.reject(Error('original remesh worker decoding failed'));pending=null;};
    signal?.addEventListener('abort',stop,{once:true});
    try{
      onProgress({kind:'original-remesh-prefill-bvh'});
      const bvh=await request('initialize',{vertices:mesh.vertices.slice().buffer,triangles:mesh.triangles.slice().buffer,settings});
      gpu=await createRemeshGpu({device,bvh:{nodes:bvh.nodes,vertices:new Float32Array(bvh.vertices),triangles:new Uint32Array(bvh.triangles),order:new Uint32Array(bvh.order)},signal,onProgress,withGpu});
      let state=await request('grid-start');
      for(;;){
        const hits=await gpu.query(new Float32Array(state.points));
        trace.push({operation:'sparse-grid',resolution:state.level,queries:hits.distances.length});
        onProgress(trace.at(-1));state=await request('grid-refine',{distances:hits.distances.buffer});if(state.done)break;
      }
      const hits=await gpu.query(new Float32Array(state.points)),sdf=hits.distances;
      for(let i=0;i<sdf.length;i++)sdf[i]=Math.fround(sdf[i]-settings.epsilon);
      const coords=new Uint32Array(state.coords),indices=new Uint32Array(state.indices);
      const contour=await gpu.contour(coords,indices,sdf);
      const rebuilt=await request('topology',{dual:contour.dual.buffer,intersections:contour.intersections.buffer});
      let vertices=new Float32Array(rebuilt.vertices),triangles=new Uint32Array(rebuilt.triangles);
      if(settings.projectBack>0){const projection=await gpu.query(vertices);for(let i=0;i<vertices.length;i++)vertices[i]=Math.fround(vertices[i]-Math.fround(settings.projectBack*Math.fround(vertices[i]-projection.positions[i])));}
      trace.push({operation:'narrow-band-dual-contour',vertices:vertices.length/3,faces:triangles.length/3,activeCells:coords.length/3,activeCorners:sdf.length});
      // Diagnostic persistence sees the actual reconstructed surface before any
      // reducer can change it. Observer errors are failures, never dropped data.
      if(onReconstruction)await onReconstruction({vertices:vertices.slice(),triangles:triangles.slice(),settings,trace:[...trace]});
      onProgress({kind:'original-remesh-reduce',faces:triangles.length/3});
      const reduced=await reduceCuMeshSurface(vertices,triangles,{targetFaces,device,request,signal,onProgress,withGpu});
      vertices=reduced.vertices;triangles=reduced.triangles;
      validateRemeshSurface(vertices,triangles);
      worker.terminate();worker=null;
      return {...mesh,vertices,triangles,metadata:{...mesh.metadata,postprocess:{schema:'trellis2.mesh-postprocess.v0',status:'succeeded',requestedMode:'original-remesh',
        effectiveRoute:ORIGINAL_REMESH_ROUTE,execution:'app-device-WebGPU/module-worker',settings,targetFaces,inputVertices,inputFaces,outputVertices:vertices.length/3,outputFaces:triangles.length/3,
        operationTrace:trace,prefill:bvh.prefill,reducer:reduced.reducer,modelCalls:0,elapsedSeconds:(performance.now()-started)/1000,
        parityReference:'TRELLIS.2 5565d240 / TRELLIS2MLX cumesh/metal_remeshing.py',
        parityLimit:'Native perimeter/reducer arithmetic and adjacency accumulation order are not certified bit-identical; equidistant projection uses lowest original face id rather than native BVH traversal order'}}};
    }catch(error){dispose();throw error;}
  };
  // Material baking must project texel positions onto the original filled
  // surface, not sample the newly inflated narrow-band shell directly.
  postprocess.projectMaterialPositions=async positions=>{if(!gpu)throw Error('original surface projection unavailable');return (await gpu.query(positions)).positions;};
  postprocess.setExecutionContext=context=>{
    if(typeof context?.withCpu!=='function'||typeof context.withGpu!=='function')throw TypeError('original remesh requires CPU windows and admitted GPU duties');
    withCpu=context.withCpu;withGpu=context.withGpu;
  };
  postprocess.withCpu=(phase,work)=>withCpu(phase,work);
  postprocess.dispose=dispose;
  return postprocess;
}
