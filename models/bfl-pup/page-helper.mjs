import{withGreenroomLease}from'../../greenroom-lease.mjs';
import{createWorkerPromptHelper}from'./worker-client.mjs';

export function createPagePromptHelper({modelUrl,post,providerFactory=createWorkerPromptHelper,onProgress=()=>{},onWait=()=>{},onLease=()=>{},keepLoaded=false}){
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
  get resident(){return !!provider?.resident;},
  async expand(options){
   if(active)throw Error('Prompt page is already generating.');
   active=true;const started=performance.now();
   try{
    const {result,lease}=await withGreenroomLease({post,runId:crypto.randomUUID(),route:'bfl-pup.prompt-expansion.webgpu.v0',signal:options.signal,
     sleep:ms=>sleep(ms,options.signal),onWait,
     // Resident weights are idle after request settlement. Only active work
     // retains execution authority; abort/error terminates the owned context.
     unsettledWork:async()=>provider?.busy?['prompt worker']:[],
    },async held=>{
     onLease(held);provider??=providerFactory({modelUrl,onProgress,keepLoaded});
     let succeeded=false;
     try{const result=await provider.expand(options);succeeded=true;return result;}finally{if(!keepLoaded||!succeeded){await provider.dispose();provider=null;}}
    });
    const output={...result,backendExpandMs:result.totalMs,totalMs:performance.now()-started,
     timingScope:keepLoaded?'page request including GPU wait; idle model retained':'page request including GPU wait, setup and model disposal',gpuLease:lease};
    if(lease.releaseError||lease.state==='kept-blocking')throw Object.assign(Error(`Prompt completed, but Greenroom handback failed: ${lease.releaseError}`),{result:output});
    return output;
   }finally{active=false;}
  },
  async dispose(){await provider?.dispose();provider=null;},
 };
}
