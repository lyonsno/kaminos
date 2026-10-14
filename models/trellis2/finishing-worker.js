// One run of a browser finishing step in a module worker, ended by its result
// or by the caller's Stop. An already-aborted signal starts no worker; Stop
// terminates the worker and rejects with AbortError.
export function abortError(signal){
  const reason=signal?.reason;
  return reason?.name==='AbortError'?reason:new DOMException('finishing stopped','AbortError');
}

export function admitSignal(signal){
  if(signal!==undefined&&!(signal instanceof AbortSignal))throw TypeError('signal must be an AbortSignal');
}

export function runFinishingWorker({WorkerClass,url,message,transfer,signal,label}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(abortError(signal));
    const id=Math.random().toString(36).slice(2),worker=new WorkerClass(url,{type:'module'});
    let settled=false;
    const settle=(fn,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',onAbort);worker.terminate();fn(value);};
    const onAbort=()=>settle(reject,abortError(signal));
    signal?.addEventListener('abort',onAbort,{once:true});
    worker.onmessage=({data})=>{
      if(data?.id!==id)return settle(reject,Error(label+' worker response identity mismatch'));
      if(data.ok!==true)return settle(reject,Error(label+' worker failed: '+data.error));
      settle(resolve,data);
    };
    worker.onerror=e=>settle(reject,Error(label+' worker error: '+(e?.message??e)));
    // A dispatch that throws (e.g. DataCloneError) still releases the run.
    try{worker.postMessage({id,...message},transfer);}catch(error){settle(reject,error);}
  });
}
