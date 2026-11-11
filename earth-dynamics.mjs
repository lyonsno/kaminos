import {EarthSpecimen} from './earth-specimen.mjs';

// The same physical model serves live forming and explicit offline advance.
// Recorded intervals use substeps at or below the configured physical timestep.
// Reconstruction never advances the physical clock.
export function createEarthDynamicsKernel(){
 let model;
 const result=()=>({snapshot:model.snapshot(),state:model.state()});
 return {apply(message){
  if(message.kind==='init'){const next=message.snapshot?EarthSpecimen.fromSnapshot(message.snapshot):new EarthSpecimen(message.config);model?.dispose();model=next;return result();}
  if(!model)throw Error('Earth dynamics has not been initialized');
  if(message.kind==='material')model.setMaterial(message.values);
  else if(message.kind==='advance')model.advance(message.seconds,{tool:message.tool});
  else if(message.kind==='sweep'){
   const {seconds,from,to}=message;
   if(!Number.isFinite(seconds)||seconds<=0)throw Error('Invalid tool sample duration');
   for(const pose of [from,to])if(!Array.isArray(pose?.position)||pose.position.length!==3||!pose.position.every(Number.isFinite)||!Number.isFinite(pose.radius)||pose.radius<=0)throw Error('Invalid swept tool pose');
   const count=Math.ceil(seconds/model.config.dt),dt=seconds/count;
   for(let i=0;i<count;i++){
    const t=i/count,position=from.position.map((v,k)=>v+(to.position[k]-v)*t);
    const velocity=to.position.map((v,k)=>(v-from.position[k])/seconds);
    model.advance(dt,{tool:{position,radius:from.radius+(to.radius-from.radius)*t,velocity}});
   }
  }else if(message.kind!=='snapshot'&&message.kind!=='material'&&message.kind!=='advance')throw Error(`Unknown earth dynamics operation ${message.kind}`);
  return result();
 },dispose(){model?.dispose();model=null;}};
}

export async function createEarthDynamics({config,snapshot,WorkerType=globalThis.Worker}={}){
 let worker,kernel,disposed=false,serial=0,current,workerError=null;
 const pending=new Map();
 if(WorkerType){
  worker=new WorkerType(new URL('./earth-dynamics-worker.mjs',import.meta.url),{type:'module'});
  const fail=error=>{workerError=error;worker.terminate();for(const task of pending.values())task.reject(error);pending.clear();};
  worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);if(data.error)task.reject(Error(data.error));else{current=data.result;task.resolve(current.state);}};
  worker.onerror=e=>fail(Error(e.message||'Earth physics worker failed'));
  worker.onmessageerror=()=>fail(Error('Earth physics worker result could not be read'));
 }else kernel=createEarthDynamicsKernel();
 const request=message=>{
  if(disposed)return Promise.reject(Error('Earth dynamics disposed'));if(workerError)return Promise.reject(workerError);
  if(!worker){try{current=kernel.apply(message);return Promise.resolve(current.state);}catch(error){return Promise.reject(error);}}
  return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});try{worker.postMessage({...message,id});}catch(error){pending.delete(id);reject(error);}});
 };
 const api={get config(){return current.snapshot.config;},state:()=>structuredClone(current.state),snapshot:()=>structuredClone(current.snapshot),
  advance:(seconds,{tool=null}={})=>request({kind:'advance',seconds,tool}),
  sweep:(seconds,from,to)=>request({kind:'sweep',seconds,from,to}),
  setMaterial:values=>request({kind:'material',values}),
  dispose(){disposed=true;worker?.terminate();kernel?.dispose();for(const task of pending.values())task.reject(Error('Earth dynamics disposed'));pending.clear();}
 };
 try{await request({kind:'init',config,snapshot});return api;}catch(error){api.dispose();throw error;}
}
