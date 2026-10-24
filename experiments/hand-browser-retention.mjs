export async function openBrowserCaptureStore({onFailure,Worker=globalThis.Worker}={}) {
  const worker=new Worker(new URL('./hand-browser-retention-worker.mjs',import.meta.url),{type:'module'});
  let sequence=0,failure=null,dead=false,closed=false,loaded=false;
  const pending=new Set(),flushes=new Map();
  let resolveLoad,rejectLoad;
  const load=new Promise((resolve,reject)=>{resolveLoad=resolve;rejectLoad=reject;});
  const fail=cause=>{
    if(failure)return;
    failure=cause instanceof Error?cause:Error(String(cause));
    if(!loaded)rejectLoad(failure);else onFailure?.(failure);
  };
  worker.onmessage=({data})=>{
    if(data.type==='loaded'){loaded=true;resolveLoad();return;}
    if(data.type==='load_error'){fail(data.error);return;}
    if(data.type!=='settled'){fail('Unknown capture-worker response');return;}
    pending.delete(data.sequence);
    if(data.error)fail(data.error);
    const waiter=flushes.get(data.sequence);
    if(waiter){flushes.delete(data.sequence);if(failure)waiter.reject(failure);else waiter.resolve();}
  };
  const broken=event=>{
    dead=true;fail(event.error??event.message??'Capture worker failed');
    for(const waiter of flushes.values())waiter.reject(failure);
    flushes.clear();
  };
  worker.onerror=broken;worker.onmessageerror=broken;
  try {await load;}catch(error){worker.terminate();throw error;}
  const check=()=>{if(failure)throw failure;if(closed)throw Error('Capture worker closed');};
  const send=(message,transfer=[])=>{
    if(closed||dead)throw failure??Error('Capture worker closed');
    const id=++sequence;pending.add(id);
    try{worker.postMessage({...message,sequence:id},transfer);}catch(error){pending.delete(id);fail(error);throw error;}
    return id;
  };
  const flush=()=>{
    if(dead)return Promise.reject(failure);
    return new Promise((resolve,reject)=>{
      try{const id=send({type:'flush'});flushes.set(id,{resolve,reject});}catch(error){reject(error);}
    });
  };
  return {
    begin(capture,bitmap){check();send({type:'capture',capture,bitmap},[bitmap]);},
    // Already sampled inputs still need terminal outcomes after a retention error.
    finish(captureId,outcome){send({type:'outcome',captureId,outcome});},
    event(value){send({type:'event',value});},
    check,flush,
    read:()=>({pending:pending.size,error:failure?String(failure):null}),
    async close(){try{if(!closed)await flush();}finally{closed=true;worker.terminate();}},
  };
}
