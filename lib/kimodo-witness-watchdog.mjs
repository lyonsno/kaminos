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
