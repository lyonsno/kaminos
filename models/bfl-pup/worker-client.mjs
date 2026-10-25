// Each expansion owns one worker, including model loading. Ending the operation
// terminates that worker; the surrounding app keeps no resident prompt model.
export function createWorkerPromptHelper({modelUrl,onProgress=()=>{},WorkerClass=globalThis.Worker}={}){
 if(!modelUrl)throw Error('A model package URL is required.');
 let active=null,disposed=false;
 return {
  expand({prompt,images=[],signal,onText=()=>{},onProgress:requestProgress=onProgress}){
   if(disposed)return Promise.reject(Error('Prompt helper is disposed.'));
   if(active)return Promise.reject(Error('Prompt helper is already generating.'));
   if(signal?.aborted)return Promise.reject(signal.reason??Error('Prompt expansion cancelled.'));
   return new Promise((resolve,reject)=>{
    let worker;
    const abort=()=>finish(false,signal?.reason??Error('Prompt expansion cancelled.'));
    const finish=(success,value)=>{
     if(active?.worker!==worker)return;
     signal?.removeEventListener('abort',abort);
     worker.terminate();active=null;
     success?resolve(value):reject(value instanceof Error?value:Error(String(value)));
    };
    try{
     worker=new WorkerClass(new URL('./worker-browser.mjs',import.meta.url),{type:'module'});
     active={worker,reject:reason=>finish(false,reason)};
     worker.onmessage=({data})=>{
      if(active?.worker!==worker)return;
      try{
       if(data.type==='progress')requestProgress(data.value);
       else if(data.type==='text')onText(data.value);
       else if(data.type==='complete')finish(true,data.value);
       else if(data.type==='error')finish(false,Error(data.value));
      }catch(error){finish(false,error);}
     };
     worker.onerror=event=>finish(false,Error(event.message||'The prompt worker failed.'));
     worker.onmessageerror=()=>finish(false,Error('The prompt worker returned an unreadable result.'));
     signal?.addEventListener('abort',abort,{once:true});
     worker.postMessage({modelUrl,prompt,images});
     if(signal?.aborted)abort();
    }catch(error){
     if(active&&active.worker===worker)finish(false,error);else{worker?.terminate();reject(error);}
    }
   });
  },
  async dispose(){disposed=true;active?.reject(Error('Prompt helper is disposed.'));},
 };
}
