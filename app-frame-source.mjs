// The ordinary scene as a foreground frame owner. Models borrow frames the same way
// they do from the fire scene's volume prototype: one requester at a time, each
// animation frame requested through it and submitted inside the model's foreground
// window. With no requester installed the app renders on its own, as before.
export function createAppFrameSource({device,queue,requestAnimationFrame:raf=globalThis.requestAnimationFrame}){
  let requester=null,pending=null,sequence=0,scheduled=false;
  const state={completedFrames:0,lastReceipt:null,error:null};
  function schedule(){if(requester&&!scheduled&&!pending){scheduled=true;raf(tick);}}
  function tick(){
    scheduled=false;
    if(!requester||pending)return;
    const current=requester,requestId=`app-frame-${++sequence}`;
    pending={requestId};
    let handle;
    try{
      handle=current({requestId,metadata:{renderer:'kaminos-app'},run(service){
        if(service?.device!==device||service?.queue!==queue)throw Error('app foreground device/queue mismatch');
        // The host's runForegroundFrame wrapper renders the scene; nothing else to submit here.
        return {status:'submitted'};
      }});
    }catch(error){pending=null;state.error=error?.message||String(error);schedule();return;}
    pending=handle;
    Promise.resolve(handle?.completion).then(receipt=>{state.completedFrames+=1;state.lastReceipt=receipt;})
      .catch(error=>{state.error=error?.message||String(error);})
      .finally(()=>{pending=null;schedule();});
  }
  return {
    foregroundGpuContext:()=>({renderer:'kaminos-app',productFrameOwner:'app',device,queue}),
    setForegroundOpportunityRequester(next){
      if(next!==null&&typeof next!=='function')throw Error('foreground requester must be a function or null');
      if(pending)throw Error('foreground frame is still pending');
      requester=next;schedule();
    },
    debugState:()=>({...state,active:!!requester,pending:!!pending}),
  };
}
