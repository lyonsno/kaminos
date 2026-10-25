import{withGreenroomLease}from'../../greenroom-lease.mjs';
import{createWorkerPromptHelper}from'./worker-client.mjs';

export function createPagePromptHelper({modelUrl,post,providerFactory=createWorkerPromptHelper,onProgress=()=>{},onWait=()=>{},onLease=()=>{}}){
 let provider=null,active=false;
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason??Error('GPU wait stopped'));return;}
  const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const timer=setTimeout(done,ms);
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason??Error('GPU wait stopped'));};
  signal?.addEventListener('abort',abort,{once:true});
 });
 return{
  get busy(){return active;},
  async expand(options){
   if(active)throw Error('Prompt page is already generating.');
   active=true;const started=performance.now();
   try{
    const {result,lease}=await withGreenroomLease({post,runId:crypto.randomUUID(),route:'bfl-pup.prompt-expansion.webgpu.v0',signal:options.signal,
     sleep:ms=>sleep(ms,options.signal),onWait,
     // This worker owns its entire runtime context. Completion follows model
     // disposal; abort terminates that worker, like the app's page-close handback.
     unsettledWork:async()=>provider?.busy?['prompt worker']:[],
    },async held=>{
     onLease(held);provider=providerFactory({modelUrl,onProgress});
     try{return await provider.expand(options);}finally{await provider.dispose();}
    });
    const output={...result,backendExpandMs:result.totalMs,totalMs:performance.now()-started,
     timingScope:'page request including GPU wait, setup and model disposal',gpuLease:lease};
    if(lease.releaseError||lease.state==='kept-blocking')throw Object.assign(Error(`Prompt completed, but Greenroom handback failed: ${lease.releaseError}`),{result:output});
    return output;
   }finally{active=false;}
  },
  async dispose(){await provider?.dispose();},
 };
}
