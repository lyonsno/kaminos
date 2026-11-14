// Page projection of the actual worker model commands. The worker retains model
// resources and unsaved output; this adapter retains only plain status and refs.
export function createSceneWorkerMeshController({page,changed=()=>{}}){
 let active=null,version=0,state={status:'unavailable',error:'Mesh availability is loading.',results:[],pending:null,canStop:false};
 const listeners=new Set(),read=()=>structuredClone(state);
 const saved=entry=>entry&&typeof entry.source==='string'&&entry.source.length>0;
 const results=(...lists)=>[...new Map(lists.flat().filter(saved).map(entry=>[entry.source,entry])).values()];
 function publish(){try{changed(read());for(const listener of listeners)listener(read());}catch(error){state={...state,presentationError:String(error?.message??error)};}}
 function apply(value){state={...value,results:results(state.results,value.results??[])};version++;publish();}
 async function refresh(){
  const before=version,reply=await page.request('mesh.read').completion,output=reply.output;
  if(output?.model!=='trellis-page'||output.preparesInput!==true||typeof output.state?.status!=='string'||!Array.isArray(output.state.results))throw Error('Worker mesh status did not contain its actual TRELLIS state');
  if(version===before)apply(structuredClone(output.state));return read();
 }
 async function execute(operation,input){
  if(active)throw Error('A worker mesh operation is already pending');
  const handle=page.request(operation,input,{onProgress:event=>{if(typeof event.value?.status==='string')apply(structuredClone(event.value));}});active=handle;
  apply({...state,status:'loading',progress:'Queued in scene worker',error:null,canStop:true});
  try{
   const reply=await handle.completion,entry=reply.output?.entry;
   if(!saved(entry))throw Error('Worker mesh completion did not contain its saved asset');
   apply({...state,status:'complete',error:null,pending:null,canStop:false,results:results(state.results,[entry])});
   // A completed write remains a saved result if later status transport fails.
   try{await refresh();}catch(error){apply({...state,statusError:String(error?.message??error)});}
   return entry;
  }catch(error){apply({...state,status:error.name==='AbortError'?'stopped':'failed',error:error.message,canStop:false,...(error.name==='AbortError'?{pending:null}:{})});throw error;}
  finally{active=null;publish();}
 }
 return Object.freeze({preparesInput:true,read,refresh,busy:()=>active!==null||!!state.pending,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  run:input=>execute('mesh.generate',input),retryPersistence:()=>execute('mesh.retrySave',{}),
  stop(){if(!active||state.canStop!==true)return false;const requested=active.cancel('Operator Stop');if(requested)apply({...state,status:'stopping',canStop:false});return requested;},
 });
}
