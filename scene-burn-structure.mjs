import {collectFractureSurface} from './fracture-coarse-surface.mjs';
import {createBurnStructureGpu} from './burn-structure-gpu.mjs';

export function createSceneBurnStructure({renderer,field,parent,workerFactory=url=>new Worker(url,{type:'module'})}){
 let enabled=false,disposed=false,generation=0,worker=null,rejectPending=null,gpu=null,status='off',error=null;
 const {mesh,bounds,dimensions,initial}=field.residentState();
 function release(){worker?.terminate();worker=null;const reject=rejectPending;rejectPending=null;reject?.(Error('Structural preparation cancelled'));gpu?.dispose();gpu=null;}
 function present(){if(!gpu)return;mesh.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);gpu.overlay.matrix.copy(parent.matrixWorld).invert().multiply(mesh.matrixWorld);gpu.overlay.updateWorldMatrix(false,false);}
 async function configure(value){
  if(disposed||enabled===value)return;
  enabled=value;const token=++generation;release();error=null;status=value?'preparing':'off';if(!value)return;
  try{
   const {arrays:source,materials:sourceMaterials}=collectFractureSurface(mesh),material={bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},dimensions,initial};
   const result=await new Promise((resolve,reject)=>{
    rejectPending=reject;const current=workerFactory(new URL('./burn-structure.worker.mjs',import.meta.url));worker=current;
    current.onmessage=({data})=>{current.terminate();if(worker===current)worker=null;rejectPending=null;data.error?reject(Error(data.error)):resolve(data);};
    current.onerror=e=>{current.terminate();if(worker===current)worker=null;rejectPending=null;reject(Error(e.message));};
    current.postMessage({source,material});
   });
   if(disposed||token!==generation)return;
   status='compiling';const candidate=await createBurnStructureGpu({renderer,field,...result,sourceMaterials});
   if(disposed||token!==generation){candidate.dispose();return;}
   gpu=candidate;gpu.overlay.matrixAutoUpdate=false;parent.add(gpu.overlay);present();status='resident';
  }catch(cause){if(disposed||token!==generation)return;error=cause.message;status='failed';release();}
 }
 return {configure,present,encode:encoder=>gpu?.encode(encoder),
  read:()=>({enabled,status,error,...(gpu?.read()??{})}),
  snapshot:()=>gpu?.snapshot()??null,
  resident:()=>gpu?.resident()??null,
  dispose(){if(disposed)return;disposed=true;generation++;release();status='disposed';},
 };
}
