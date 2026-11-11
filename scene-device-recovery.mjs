// The page replaces GPU resources while retaining its document and editor.
// Every asynchronous replacement carries an epoch; a lost candidate cannot publish.
export function createDeviceRecovery({device,stop,rebuild,changed=()=>{},automatic=true}) {
 if(typeof automatic!=='boolean')throw Error('Device recovery automatic mode must be boolean');
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
   stopping.catch(()=>{});publish();if(automatic)run();
  });
  return ()=>{if(observed===next)observed=null;};
 }
 function run(command){
  if(!automatic&&typeof command?.assertCurrent!=='function')throw Error('Explicit device recovery requires command assertCurrent');
  if(task||phase==='disposed')return task??Promise.resolve();
  task=Promise.resolve().then(async()=>{
   if(!automatic&&phase==='disposed')throw Error('Device recovery disposed before rebuild');
   while(phase==='recovering'){
    const ticket=epoch;
    const assertCurrent=()=>{if(ticket!==epoch||phase==='disposed')throw Error('Device replacement superseded');command?.assertCurrent?.();};
    try{
     await stopping;assertCurrent();
     await rebuild({generation:ticket,assertCurrent,watch:next=>{assertCurrent();return watch(next);}});
     assertCurrent();phase='active';recoveries++;error=null;publish();
    }catch(cause){
     if(phase==='disposed'){if(!automatic)throw cause;return;}
     if(ticket!==epoch){if(automatic)continue;throw cause;}
     phase='failed';error=String(cause?.message??cause);publish();
     if(!automatic)throw cause;
    }
   }
   return state();
  }).finally(()=>{task=null;});
  return task;
 }
 watch(device);
 return {state,whenSettled:()=>task??Promise.resolve(),
  recover(command){if(phase!=='recovering'){if(!automatic)throw Error('No pending device recovery');return task??Promise.resolve(state());}return run(command);},
  retry(command){if(phase!=='failed'){if(!automatic)throw Error('No failed device recovery');return task??Promise.resolve(state());}
   if(!automatic&&typeof command?.assertCurrent!=='function')throw Error('Explicit device recovery requires command assertCurrent');
   epoch++;phase='recovering';error=null;publish();return run(command);},
  dispose(){epoch++;observed=null;phase='disposed';publish();},
 };
}
