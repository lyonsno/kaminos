// Operator's minute-scale witness policy: 10-minute total, 120s without
// producer/load/download progress. These limits do not govern the product UI.
export function createWitnessWatchdog(startedAt,{deadlineMs=600000,stallMs=120000}={}){
  let lastProgressAt=startedAt,lastToken=null,phase='browser-launch';
  return {
    observe(nextPhase,token,now){
      const key=JSON.stringify([nextPhase,token]);
      if(key!==lastToken){lastProgressAt=now;lastToken=key;phase=nextPhase;}
    },
    check(now){
      const kind=now-startedAt>=deadlineMs?'deadline':now-lastProgressAt>=stallMs?'no-progress':null;
      return kind?{kind,phase,elapsedMs:now-startedAt,idleMs:now-lastProgressAt,deadlineMs,stallMs}:null;
    },
  };
}

// Settles the driver's awaited phase without relying on a CDP disconnect.
export function createWitnessAbort(){
  let reason,reject;
  const aborted=new Promise((_,r)=>{reject=r;});
  aborted.catch(()=>{}); // expiry may precede the next guarded operation
  return {
    get reason(){return reason;},
    abort(error){if(!reason){reason=error;reject(error);}},
    wait(operation){
      if(reason){Promise.resolve(operation).catch(()=>{});return Promise.reject(reason);}
      return Promise.race([operation,aborted]);
    },
  };
}

// Teardown is not inference: a wedged diagnostic/close must not prevent release.
export async function boundedCleanup(operation,ms,label){
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} did not finish within ${ms} ms`)),ms);})]);}
  finally{clearTimeout(timer);}
}
