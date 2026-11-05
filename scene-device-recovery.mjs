// The page replaces GPU resources while retaining its document and editor.
// Every asynchronous replacement carries an epoch; a lost candidate cannot publish.
export function createDeviceRecovery({device,stop,rebuild,changed=()=>{}}) {
 let epoch=0,recoveries=0,phase='active',error=null,loss=null,task=null,stopping=Promise.resolve(),observed=device;
 const state=()=>({phase,generation:epoch,recoveries,error,loss});
 const publish=()=>changed(state());
 function watch(next){
  if(!next?.lost?.then)throw Error('Recovery requires a GPUDevice.lost promise');
  observed=next;
  next.lost.then(info=>{
   if(phase==='disposed'||observed!==next)return;
   epoch++;loss={reason:info.reason,message:info.message};phase='recovering';error=null;
   // Stop admission immediately, before any replacement awaits.
   try{stopping=Promise.resolve(stop(loss));}catch(cause){stopping=Promise.reject(cause);}
   stopping.catch(()=>{});publish();run();
  });
  return ()=>{if(observed===next)observed=null;};
 }
 function run(){
  if(task||phase==='disposed')return task??Promise.resolve();
  task=Promise.resolve().then(async()=>{
   while(phase==='recovering'){
    const ticket=epoch;
    const assertCurrent=()=>{if(ticket!==epoch||phase==='disposed')throw Error('Device replacement superseded');};
    try{
     await stopping;assertCurrent();
     await rebuild({generation:ticket,assertCurrent,watch:next=>{assertCurrent();return watch(next);}});
     assertCurrent();phase='active';recoveries++;error=null;publish();
    }catch(cause){
     if(phase==='disposed')return;
     if(ticket!==epoch)continue;
     phase='failed';error=String(cause?.message??cause);publish();
    }
   }
  }).finally(()=>{task=null;});
  return task;
 }
 watch(device);
 return {state,whenSettled:()=>task??Promise.resolve(),
  retry(){if(phase!=='failed')return task??Promise.resolve();epoch++;phase='recovering';error=null;publish();return run();},
  dispose(){epoch++;observed=null;phase='disposed';publish();},
 };
}
