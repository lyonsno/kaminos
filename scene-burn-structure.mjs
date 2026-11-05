import {collectFractureSurface} from './fracture-coarse-surface.mjs';
import {createBurnStructureGpu} from './burn-structure-gpu.mjs';

export function createSceneBurnStructure({renderer,field,parent,workerFactory=url=>new Worker(url,{type:'module'}),gpuFactory=createBurnStructureGpu}){
 let enabled=false,required=false,disposed=false,generation=0,worker=null,rejectPending=null,gpu=null,pending=null,status='off',error=null;
 const {mesh,bounds,dimensions,initial}=field.residentState();
 function release(){worker?.terminate();worker=null;const reject=rejectPending;rejectPending=null;reject?.(Error('Structural preparation cancelled'));gpu?.dispose();gpu=null;}
 function present(){if(!gpu)return;mesh.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);gpu.overlay.matrix.copy(parent.matrixWorld).invert().multiply(mesh.matrixWorld);gpu.overlay.updateWorldMatrix(false,false);}
 async function prepare(token){
  try{
   const {arrays:source,materials:sourceMaterials}=collectFractureSurface(mesh),material={bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},dimensions,initial};
   const result=await new Promise((resolve,reject)=>{
    rejectPending=reject;const current=workerFactory(new URL('./burn-structure.worker.mjs',import.meta.url));worker=current;
    current.onmessage=({data})=>{current.terminate();if(worker===current)worker=null;rejectPending=null;data.error?reject(Error(data.error)):resolve(data);};
    current.onerror=e=>{current.terminate();if(worker===current)worker=null;rejectPending=null;reject(Error(e.message));};
    const detail=new URLSearchParams(globalThis.location?.hash?.slice(1)??'').get('burn_fracture_detail')??new URLSearchParams(globalThis.location?.search??'').get('burn_fracture_detail');
    current.postMessage({source,material,detail:detail==='1'});
   });
   if(disposed||token!==generation)return;
   status='compiling';const candidate=await gpuFactory({renderer,field,...result,sourceMaterials});
   if(disposed||token!==generation){candidate.dispose();return;}
   gpu=candidate;gpu.overlay.visible=enabled;gpu.overlay.matrixAutoUpdate=false;parent.add(gpu.overlay);present();status='resident';
  }catch(cause){if(disposed||token!==generation)return;error=cause.message;status='failed';release();}
 }
 function sync(){
  if(disposed)return;
  if(gpu)gpu.overlay.visible=enabled;
  if(enabled||required){
   if(gpu||pending)return pending;
   const token=++generation;error=null;status='preparing';
   const task=prepare(token);pending=task;
   void task.finally(()=>{if(pending===task)pending=null;});return task;
  }
  generation++;pending=null;release();error=null;status='off';
 }
 return {configure(value){if(disposed||enabled===(value===true))return;enabled=value===true;return sync();},
  setRequired(value){required=value===true;return sync();},present,encode:encoder=>gpu?.encode(encoder),reset:()=>gpu?.reset(),
  read:()=>({enabled,required,status,error,...(gpu?.read()??{})}),
  snapshot:()=>gpu?.snapshot()??null,
  resident:()=>gpu?.resident()??null,
  dispose(){if(disposed)return;disposed=true;generation++;release();status='disposed';},
 };
}
