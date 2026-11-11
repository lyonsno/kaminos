// Explicit synchronous authored edits use the application's existing foreground
// requester. The model keeps its admitted inputs; live scene state changes only
// inside a serviced Kit boundary on this same device and queue.
let owners=0;
export function createSceneWorkerMutationBinding({appHost}={}){
 const device=appHost?.device,queue=appHost?.queue;
 if(!device||queue!==device.queue||typeof appHost.requester!=='function'||typeof appHost.activateFrames!=='function')throw Error('worker edits require the app shared device, queue and foreground requester');
 const owner=++owners;let sequence=0;
 async function requestMutation(operation,payload,ctx,apply){
  ctx.assertCurrent();
  if(typeof operation!=='string'||!operation||typeof apply!=='function')throw Error('worker edit operation and apply callback required');
  await appHost.activateFrames();ctx.assertCurrent();
  let handle,value,entered=false,applied=false,callbackError;
  const cancel=()=>handle?.cancel(String(ctx.signal.reason??'worker edit cancelled'));
  try{
   handle=appHost.requester({requestId:`worker-edit-${owner}-${++sequence}`,metadata:{operation,kind:'authored-scene-edit'},run:service=>{
    ctx.assertCurrent();
    if(service?.device!==device||service?.queue!==queue)throw Error('worker edit foreground device/queue mismatch');
    entered=true;
    try{value=apply(service);applied=true;return {mutationApplied:true};}
    catch(error){callbackError=error;throw error;}
   }});
   ctx.signal.addEventListener('abort',cancel,{once:true});if(ctx.signal.aborted)cancel();
   const receipt=await handle.completion;
   if(callbackError)throw callbackError;
   if(receipt.status!=='completed'||!applied||receipt.result?.mutationApplied!==true)throw Object.assign(Error(`worker edit foreground ${receipt.status}: ${receipt.failure?.error?.message??receipt.cancellation?.reason??'edit not applied'}`),{foregroundReceipt:receipt});
   ctx.assertCurrent();
   return {mutationApplied:true,value,foregroundReceipt:receipt};
  }catch(cause){
   const error=cause instanceof Error?cause:Error(String(cause));
   // A later render/receipt failure cannot turn an applied edit back into a
   // pending edit. A handler that threw partway through has unknown application.
   if(!Object.hasOwn(error,'mutationApplied'))error.mutationApplied=applied?true:entered?null:false;
   throw error;
  }finally{ctx.signal.removeEventListener('abort',cancel);}
 }
 return Object.freeze({requestMutation});
}
