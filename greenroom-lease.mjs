// A model run in the page holds a cooperative Greenroom lease (serve.py /api/gpu-lease), so Greenroom's
// queued jobs and other lanes' leases wait for it, and it waits for them. Claims never block: while the GPU
// is held the run waits and retries, naming the holder. While the run works the lease is renewed; it is
// released however the run ends. A server with no Greenroom, or a page already inside a Greenroom job (an
// automated witness), runs without a lease of its own and the returned lease status says which.
// An unreachable server fails the run: running unleased silently is what the lease exists to prevent.
export async function withGreenroomLease({post,runId,route,insideJob=null,signal=null,onWait=()=>{},
  retryMs=15000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)},run){
  const stopped=()=>{if(signal?.aborted)throw Object.assign(Error('GPU wait stopped'),{name:'AbortError'});};
  let lease;
  for(;;){
    stopped();
    try{lease=await post({action:'claim',runId,route,...(insideJob?{insideJob}:{})});}
    catch(error){throw Error(`Greenroom lease claim failed: ${error?.message||error}`);}
    if(lease?.status!=='waiting')break;
    onWait(lease);await sleep(retryMs);
  }
  if(!['held','unconfigured','inside-job'].includes(lease?.status))throw Error(`Greenroom lease claim failed: ${lease?.error||lease?.status||'no answer'}`);
  if(lease.status!=='held')return {result:await run(lease),lease};
  let timer=null,renewError=null;
  const renewEvery=Math.max(5000,(lease.ttlSeconds??120)*1000/4);
  const renew=()=>{timer=setTimer(async()=>{
    try{await post({action:'renew',leaseId:lease.leaseId});}catch(error){renewError=String(error?.message||error);}
    if(timer!==null)renew();},renewEvery);};
  renew();
  try{return {result:await run(lease),lease:{...lease,...(renewError?{renewError}:{})}};}
  finally{
    const t=timer;timer=null;clearTimer(t);
    await post({action:'release',leaseId:lease.leaseId,reason:'page run ended'}).catch(()=>{});
  }
}
