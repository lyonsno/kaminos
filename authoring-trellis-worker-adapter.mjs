import {createTrellisPageAuthoringGeneration} from './authoring-trellis-page.mjs';
import {createTrellisAuthoringOperation} from './authoring-trellis-operation.mjs';
import {createTrellisAuthoringPersistence} from './authoring-trellis-persistence.mjs';
import {withGreenroomLease} from './greenroom-lease.mjs';

// Worker-local model owner. The page consumes saved references, not live fields.
export function createTrellisSceneWorkerAdapter({appHost,request=globalThis.fetch,changed=()=>{},availability,history=null,capture=()=>{},
 operation=createTrellisAuthoringOperation({appGpuHost:appHost,request,target:'scene-worker',history,capture}),
 persistence=createTrellisAuthoringPersistence({request}),lease=withGreenroomLease}={}){
 if(typeof appHost!=='function')throw TypeError('TRELLIS worker requires its application host');
 let active=null,pending=null,available=null,held=null,retired=false;
 const check=()=>{if(retired)throw Error('TRELLIS worker operation retired');if(held)throw held;};
 async function refresh(){
  if(availability)available=await availability();
  else{const response=await request('/api/runtime-config',{cache:'no-store'});if(!response.ok)throw Error(`TRELLIS configuration HTTP ${response.status}`);
   const config=await response.json();available=config.trellisPage?.mounted?{status:'available'}:{status:'unavailable',message:config.modelAvailability?.trellisPage?.reason||'This server mounts no TRELLIS checkpoint package'};}
 }
 const service=createTrellisPageAuthoringGeneration({availability:()=>available,blocked:()=>held?.message??null,
  changed(state){
   if(!active)return;try{active.context.assertCurrent();}catch{return;}
   try{active.context.report({...state,model:'trellis-page',origin:active.origin});changed(state);}catch{/* presentation never decides the model outcome */}
  },
  async runPage(options){
   const ticket=active,ctx=ticket.context;ctx.assertCurrent();const app=await appHost();ctx.assertCurrent();
   const post=async body=>{const response=await request('/api/gpu-lease',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw Error(value.error||`GPU lease HTTP ${response.status}`);return value;};
   let outcome;
   try{outcome=await lease({post,runId:crypto.randomUUID(),route:'trellis2.image-generation.webgpu.v0',signal:options.signal,admission:'queue',
    unsettledWork:()=>app.unsettledRuns(),onWait:wait=>options.onPhase?.({phase:'waiting-for-gpu',heldBy:wait.heldBy})},
    ()=>operation.run({...options,assertCurrent:()=>ctx.assertCurrent()}));}
   catch(error){if(error?.gpuRouteHeld||['kept-blocking','release-failed','withdrawal-failed'].includes(error?.greenroomHandback?.state))held=error;throw error;}
   const {result,lease:receipt}=outcome;
   if(receipt.state==='kept-blocking'||receipt.releaseError)held=Object.assign(Error(receipt.releaseError||'TRELLIS admission handback unresolved'),{greenroomHandback:receipt});
   if(result?.generation)result.generation.gpuLease=receipt;
   ctx.assertCurrent();return result;
  },
  persist(glb,generation,label,extra){
   const ticket=active;ticket.runId=generation.runId;
   return persistence.persist({glb,generation,label,...extra},{assertCurrent:()=>ticket.context.assertCurrent()});
  },
 });
 const snapshot=()=>({state:service.read(),model:'trellis-page',preparesInput:true,stop:'cancel',controls:[]});
 async function execute(ctx,ticket,work){
  check();ctx.assertCurrent();if(active)throw Error('A TRELLIS worker operation is already pending');active=ticket;
  try{const entry=await work();ctx.assertCurrent();
   return {entry,runId:entry?.generation?.runId??ticket.runId??null,origin:ticket.origin};
  }catch(error){if(!held)ctx.assertCurrent();throw error;
  }finally{
   if(ctx.signal.aborted&&service.read().pending)service.discardPending('TRELLIS output belongs to a canceled command');
   pending=service.read().pending?ticket:null;active=null;
  }
 }
 return {commands:{
  async 'mesh.read'(_input,ctx){ctx.assertCurrent();await refresh();ctx.assertCurrent();return snapshot();},
  'mesh.generate':(input,ctx)=>ctx.withFrames(async()=>{
   check();ctx.assertCurrent();await refresh();ctx.assertCurrent();
   return execute(ctx,{context:ctx,origin:{requestId:ctx.requestId,epoch:structuredClone(ctx.epoch())}},()=>service.run({...input,signal:ctx.signal}));
  }),
  async 'mesh.retrySave'(_input,ctx){return ctx.withFrames(()=>{
   check();ctx.assertCurrent();if(!pending)throw Error('No retained TRELLIS output needs saving');
   const epoch=ctx.epoch();
   if(pending.context.signal.aborted||Object.keys(pending.origin.epoch).some(key=>pending.origin.epoch[key]!==epoch[key])){
    service.discardPending('TRELLIS output belongs to a stale request or worker epoch');pending=null;throw Error('TRELLIS output belongs to a stale request or worker epoch');
   }
   pending.context=ctx;return execute(ctx,pending,()=>service.retryPersistence());
  });},
 },async retire(){if(active)throw Error('TRELLIS generation is still active');if(held)throw held;
   await operation.retire();await persistence.retire();retired=true;}};
}
