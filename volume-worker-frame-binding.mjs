// Ordinary flame frames inside the common scene worker. GPU objects stay local;
// the existing app host admits each synchronous transaction and renders the
// ordinary scene when the flame is inactive or has no scene consumer attached.
let owners=0;
export function createVolumeWorkerFrameBinding({appHost,volume,applyFrameInputs=()=>{},allowDormant=false}){
 const device=appHost?.device,queue=appHost?.queue;
 function checkVolume(){
  const context=volume?.foregroundGpuContext?.();
  const dormant=allowDormant&&context?.active===false&&context.device===null&&context.queue==null;
  if(!device||queue!==device.queue||!dormant&&(context?.device!==device||context?.queue!==queue))throw Error('worker flame binding requires the app shared device and queue');
  // Current volume has one renderer and no renderer discriminator. Preserve
  // rejection of explicit foreign legacy markers and caller-owned frames.
  if(context.renderer!==undefined&&context.renderer!=='ordinary-volume'||context.productFrameOwner!=='prototype')throw Error('worker flame binding requires the ordinary volume renderer');
 }
 checkVolume();
 if(typeof appHost.requester!=='function'||typeof appHost.activateFrames!=='function'||typeof volume.renderSharedFrame!=='function'||typeof applyFrameInputs!=='function')throw Error('worker flame binding requires frame and input callbacks');
 const owner=++owners;let sequence=0,service=null,pending=0,requester=appHost.requester;
 function frame(payload,ctx){
  if(!service)throw Error('ordinary worker flame requires foreground admission');
  ctx.assertCurrent();
  const applied=applyFrameInputs(payload,ctx);
  if(applied&&typeof applied.then==='function'){
   Promise.resolve(applied).catch(()=>{});
   throw Error('worker frame inputs must apply synchronously');
  }
  checkVolume();
  return volume.renderSharedFrame({now:payload.now,service});
 }
 async function requestFrame(payload,ctx,draw){
  ctx.assertCurrent();
  await appHost.activateFrames();
  ctx.assertCurrent();if(!requester)throw Error('worker app foreground frame owner is detached');
  if(typeof draw!=='function')throw Error('worker frame draw callback required');
  pending++;let handle;
  const cancel=()=>handle?.cancel(String(ctx.signal.reason??'worker frame cancelled'));
  try{
   handle=requester({requestId:`worker-flame-${owner}-${++sequence}`,metadata:{renderer:'ordinary-volume'},run:admitted=>{
    ctx.assertCurrent();
    if(service)throw Error('worker flame foreground transaction reentered');
    if(admitted?.device!==device||admitted?.queue!==queue)throw Error('worker flame foreground device/queue mismatch');
    service=admitted;try{return draw();}finally{service=null;}
   }});
   ctx.signal.addEventListener('abort',cancel,{once:true});if(ctx.signal.aborted)cancel();
   const receipt=await handle.completion;
   ctx.assertCurrent();
   if(receipt.status!=='completed')throw Object.assign(Error(`worker flame foreground ${receipt.status}: ${receipt.failure?.error?.message??receipt.cancellation?.reason??'frame failed'}`),{foregroundReceipt:receipt});
   return receipt;
  }finally{ctx.signal.removeEventListener('abort',cancel);pending--;}
 }
 return Object.freeze({frame,requestFrame,
  // Model beginRun installs the common requester on this owner. It never
  // installs a private requester or RAF loop on the host-scheduled volume.
  setForegroundOpportunityRequester(next){
   if(next!==null&&next!==appHost.requester)throw Error('worker flame frames require the app foreground requester');
   if(next!==requester&&pending)throw Error('worker foreground frame is still pending');
   requester=next;
  },
  foregroundGpuContext:()=>({device,queue,renderer:'kaminos-app',productFrameOwner:'app'}),
 });
}
