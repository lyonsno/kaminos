// Presentation adapter for the existing Klein controls. Commands and control
// handles are real scene-worker operations; models and persistence stay there.
export function createSceneWorkerImageController({page,changed=()=>{}}){
 let active=null,state={status:'idle',outputs:[],preview:null,pending:null,canStop:false,canDecode:false,timing:null};
 const clone=value=>structuredClone(value);
 function presentation(value){
  if(!value)return value;
  const next={...value};
  if(next.preview&&!next.preview.rgba){next.previewMetadata=next.preview;next.preview=null;}
  if(Array.isArray(next.outputs))next.outputs=next.outputs.map(output=>{
   if(output.preview&&!output.preview.rgba)return {...output,previewMetadata:output.preview,preview:null};
   return output;
  });
  return next;
 }
 const publish=()=>{try{changed(read());}catch(error){state={...state,presentationError:String(error?.message??error)};}};
 function read(){return {...state,outputs:state.outputs.map(value=>({...value}))};}
 async function refresh(){
  const reply=await page.request('image.read').completion;
  if(!reply.output?.state)throw Error('Worker image status did not contain its actual state');
  state=presentation(clone(reply.output.state));publish();return read();
 }
 function progress(event){
  const value=presentation(clone(event.value));
  if(!value||typeof value.status!=='string')return;
  const outputs=state.outputs.map(row=>({...row}));
  if(value.outputId){
   const index=outputs.findIndex(row=>row.id===value.outputId),row={...(index<0?{}:outputs[index]),id:value.outputId,status:value.status,
    ...(value.request?.prompt?{prompt:value.request.prompt}:{}),preview:value.preview??null,...(value.error?{error:value.error}:{})};
   if(index<0)outputs.push(row);else outputs[index]=row;
  }
  state={...state,...value,outputs};publish();
 }
 async function execute(operation,payload){
  if(active)throw Error('A worker image operation is already pending');
  const handle=page.request(operation,payload,{onProgress:progress});active=handle;
  state={...state,status:'loading',progress:'Queued in scene worker',canStop:true,canDecode:false,error:null};publish();
  try{
   const reply=await handle.completion;
   const {entry,runId,origin}=reply.output??{};
   if(!entry)throw Error('Worker image completion did not contain its saved asset');
   const outputs=state.outputs.map(row=>({...row})),index=outputs.findIndex(row=>row.id===runId);
   const saved={...(index<0?{}:outputs[index]),id:runId,entry,origin,status:'complete',pending:false};
   if(index<0)outputs.push(saved);else outputs[index]=saved;
   state={...state,outputs,status:'complete',canStop:false,canDecode:false,statusError:null};publish();
   // Persistence already completed. A later read may lose its epoch or
   // transport; that lowers status freshness, not the saved asset's outcome.
   try{await refresh();}catch(error){state={...state,statusError:String(error?.message??error)};publish();}
   return entry;
  }catch(error){
   state={...state,status:error.name==='AbortError'?'stopped':'failed',error:error.message,canStop:false,canDecode:false};publish();throw error;
  }finally{active=null;publish();}
 }
 return Object.freeze({preparesInput:true,read,refresh,run:input=>execute('image.generate',input),
  busy:()=>active!==null,timing:()=>state.timing??null,
  stop(){if(!active||state.canStop!==true)return false;const requested=active.cancel('Operator Stop');if(requested){state={...state,status:'stopping',canStop:false};publish();}return requested;},
  async decodeNow(){if(!active||state.canDecode!==true)return false;const reply=await active.control('decodeNow').completion;return reply.output?.accepted===true;},
  retryOutput:runId=>execute('image.retrySave',{runId}),
  retryPersistence(){const id=state.outputs.find(row=>row.pending)?.id;if(!id)throw Error('No pending worker image output');return execute('image.retrySave',{runId:id});},
 });
}
