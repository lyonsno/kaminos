// Provisional route-local sleep injection for the retained-block experiment.
// Normal generation keeps the current shared-runtime scheduling policy.
const postedTask=()=>new Promise((resolve,reject)=>{
 const channel=new MessageChannel();
 const close=()=>{channel.port1.close();channel.port2.close();};
 channel.port1.onmessage=()=>{close();resolve();};
 try{channel.port2.postMessage(null);}catch(error){close();reject(error);}
});
export function createTrellisFrameAwareSleep({queue,frameBudgetMs=8,signal,
 now=()=>performance.now(),task=postedTask,timer=ms=>new Promise(r=>setTimeout(r,ms)),
 requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),
 cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis)}={}){
 if(typeof queue?.onSubmittedWorkDone!=='function'||typeof requestFrame!=='function'||typeof cancelFrame!=='function')
  throw TypeError('actual queue completion and cancellable frame callbacks required');
 if(!Number.isFinite(frameBudgetMs)||frameBudgetMs<=0)throw RangeError('positive finite frame budget required');
 const counts={frameBudgetMs,taskYields:0,frameYields:0,positiveWaits:0,gpuDrains:0};
 const stopped=()=>{if(signal?.aborted)throw signal.reason??new DOMException('TRELLIS stopped','AbortError');};
 let lastFrame=now();
 const frame=()=>new Promise((resolve,reject)=>{
  let id;const remove=()=>signal?.removeEventListener('abort',abort);
  const abort=()=>{cancelFrame(id);remove();reject(signal.reason??new DOMException('TRELLIS stopped','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});
  try{id=requestFrame(()=>{remove();try{stopped();lastFrame=now();counts.frameYields++;resolve();}catch(error){reject(error);}});}
  catch(error){remove();reject(error);}
 });
 const sleep=async ms=>{
  if(!Number.isFinite(ms)||ms<0)throw RangeError('nonnegative finite delay required');
  stopped();
  if(ms>0){await timer(ms);counts.positiveWaits++;stopped();return;}
  if(now()-lastFrame>=frameBudgetMs){
   // Drain submitted model work before yielding the frame: a fast CPU task loop
   // must not put an unbounded inference backlog ahead of the ordinary renderer.
   await queue.onSubmittedWorkDone();counts.gpuDrains++;stopped();await frame();
  }else{await task();counts.taskYields++;stopped();}
 };
 sleep.snapshot=()=>({...counts});return sleep;
}
