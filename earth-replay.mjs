import {checkedEarthDesign} from './earth-specimen.mjs';
import {createEarthDynamics} from './earth-dynamics.mjs';
export const EARTH_PROGRAM_SCHEMA='kaminos.earth-program.v1';
export function checkedEarthProgram(input){
 if(input?.schema!==EARTH_PROGRAM_SCHEMA||!Array.isArray(input.actions))throw Error('Invalid earth replay program');
 const design=checkedEarthDesign(input.design);
 for(const a of input.actions){
  if(!['advance','sweep','material'].includes(a?.kind))throw Error('Unknown earth replay action');
  if(a.kind==='material'){
   if(!a.values||typeof a.values!=='object'||Array.isArray(a.values)||Object.entries(a.values).some(([k,v])=>!['cohesion','friction','plasticYield','plasticRate','breakStrain','clodStrength','interfaceStrength','gritBinding'].includes(k)||!Number.isFinite(v)||v<0))throw Error('Invalid replay material change');
  }else{
   if(!Number.isFinite(a.seconds)||a.seconds<=0)throw Error('Invalid replay duration');
   for(const pose of a.kind==='sweep'?[a.from,a.to]:a.tool?[a.tool]:[])if(!Array.isArray(pose?.position)||pose.position.length!==3||!pose.position.every(Number.isFinite)||!Number.isFinite(pose.radius)||pose.radius<=0)throw Error('Invalid replay tool pose');
  }
 }
 return structuredClone({...input,design});
}
// A replay owns a separate worker and a frozen applied program. Pause retains
// its last complete physical chunk; cancellation never changes the live bed.
export function createEarthReplay(input,quality,{onProgress=()=>{},WorkerType=globalThis.Worker}={}){
 const program=checkedEarthProgram(input);let model,paused=false,cancelled=false,wake,status='running',completed=0,snapshot=null,error=null;
 const read=(includeSnapshot=false)=>({status,completed,total:program.actions.length,quality:{...quality},...(includeSnapshot?{snapshot:snapshot?structuredClone(snapshot):null}:{}),error});
 const publish=()=>onProgress(read());
 const finished=(async()=>{
  try{
   model=await createEarthDynamics({design:program.design,config:quality,WorkerType});snapshot=model.snapshot();publish();
   for(const action of program.actions){
    while(paused&&!cancelled)await new Promise(resolve=>{wake=resolve;});
    if(cancelled)break;
    if(action.kind==='material')await model.setMaterial(action.values);
    else if(action.kind==='sweep')await model.sweep(action.seconds,action.from,action.to);
    else await model.advance(action.seconds,{tool:action.tool??null});
    completed++;snapshot=model.snapshot();publish();
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   status=cancelled?'cancelled':'complete';publish();return read(true);
  }catch(e){status=cancelled?'cancelled':'failed';error=cancelled?null:e.message;publish();if(!cancelled)throw e;return read(true);}
  finally{model?.dispose();}
 })();
 return {read,finished,pause(value=true){if(!['running','paused'].includes(status))return read();paused=!!value;status=paused?'paused':'running';if(!paused){wake?.();wake=null;}publish();return read(true);},cancel(){cancelled=true;wake?.();wake=null;model?.dispose();return read();}};
}
