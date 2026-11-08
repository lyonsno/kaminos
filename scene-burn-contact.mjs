import {createBurnContactWorldGpu} from './burn-contact-world-gpu.mjs';

// Rebuild only when participant ownership/topology changes, never on placement,
// light edits, fuel loss or bond separation. Native object transforms are read at
// each shared step; thermal state and mechanical state stay with each owner.
export function createSceneBurnContact({renderer,createWorld=createBurnContactWorldGpu}){
 let current=null,participants=[],disposed=false,generation=0,pending=null,error=null;
 const same=rows=>rows.length===participants.length&&rows.every((r,i)=>r.resident===participants[i].resident);
 return {
  matches(rows){return !disposed&&!pending&&!error&&same(rows);},
  async sync(rows){
   if(disposed)return;if(same(rows)&&!error)return pending;
   const token=++generation;current?.dispose();current=null;participants=rows;error=null;
   if(!rows.length){pending=null;return;}
   const build=(async()=>{const world=await createWorld({device:renderer.backend.device,participants:rows});if(disposed||token!==generation){world.dispose();return;}current=world;})();
   pending=build;
   try{await build;}catch(cause){if(token===generation)error=cause.message;throw cause;}finally{if(token===generation)pending=null;}
  },
  advance(dt,rows){if(!this.matches(rows))throw Error(error??'Shared burn contact participants are not synchronized');current?.advance(dt);},
  read:()=>({status:disposed?'disposed':error?'failed':pending?'compiling':current?'live':'empty',error,mechanics:current?.read()??null}),
  dispose(){if(disposed)return;disposed=true;generation++;current?.dispose();current=null;participants=[];},
 };
}
