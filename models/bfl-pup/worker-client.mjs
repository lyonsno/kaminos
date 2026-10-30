// The worker owns model residency. Requests remain isolated; cancellation or an
// error retires the context, while successful resident requests retain weights.
export function createWorkerPromptHelper({modelUrl,onProgress=()=>{},WorkerClass=globalThis.Worker,keepLoaded=false}={}){
 if(!modelUrl)throw Error('A model package URL is required.');
 let active=null,worker=null,disposed=false,resident=false,sequence=0;
 const retire=()=>{worker?.terminate();worker=null;resident=false;};
 return {
  get busy(){return active!==null;},get resident(){return resident;},
  expand({prompt,images=[],signal,onText=()=>{},onProgress:requestProgress=onProgress}){
   if(disposed)return Promise.reject(Error('Prompt helper is disposed.'));
   if(active)return Promise.reject(Error('Prompt helper is already generating.'));
   if(signal?.aborted)return Promise.reject(signal.reason??Error('Prompt expansion cancelled.'));
   return new Promise((resolve,reject)=>{
    const requestId=++sequence;
    const abort=()=>finish(false,signal?.reason??Error('Prompt expansion cancelled.'));
    const finish=(success,value)=>{
     if(active?.requestId!==requestId)return;
     signal?.removeEventListener('abort',abort);active=null;
     if(!success||!keepLoaded)retire();else resident=true;
     success?resolve(value):reject(value instanceof Error?value:Error(String(value)));
    };
    try{
     if(!worker)worker=new WorkerClass(new URL('./worker-browser.mjs',import.meta.url),{type:'module'});
     const owned=worker;active={requestId,reject:reason=>finish(false,reason)};
     worker.onmessage=({data})=>{
      if(worker!==owned)return;
      if(data.type==='error'&&data.requestId===null&&!active){retire();return;}
      if(active?.requestId!==requestId||data.requestId!==requestId)return;
      try{
       if(data.type==='progress')requestProgress(data.value);
       else if(data.type==='text')onText(data.value);
       else if(data.type==='complete')finish(true,data.value);
       else if(data.type==='error')finish(false,Error(data.value));
      }catch(error){finish(false,error);}
     };
     worker.onerror=event=>{if(worker===owned){if(active)active.reject(Error(event.message||'The prompt worker failed.'));else retire();}};
     worker.onmessageerror=()=>{if(worker===owned){if(active)active.reject(Error('The prompt worker returned an unreadable result.'));else retire();}};
     signal?.addEventListener('abort',abort,{once:true});
     worker.postMessage({requestId,modelUrl,prompt,images,keepLoaded});
     if(signal?.aborted)abort();
    }catch(error){if(active?.requestId===requestId)finish(false,error);else{retire();reject(error);}}
   });
  },
  async dispose(){disposed=true;if(active)active.reject(Error('Prompt helper is disposed.'));retire();},
 };
}
