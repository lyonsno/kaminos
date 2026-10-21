// A model run in the page holds a cooperative Greenroom lease (serve.py /api/gpu-lease), so Greenroom's
// queued jobs and other lanes' leases wait for it, and it waits for them. Claims never block: while the GPU
// is held the run waits and retries, naming the holder. While the run works the lease is renewed.
// Release only follows settled GPU work: a run that reports its GPU route still held (error.gpuRouteHeld)
// keeps Greenroom blocked. Renewal stops, so Greenroom moves the lease to ownership_unknown, and the error
// carries the recovery obligation. A failed release is reported, never swallowed. A server with no
// Greenroom runs without a lease and says so. An unreachable server, or a broken Greenroom configuration,
// fails the run: running unleased silently is what the lease exists to prevent.
export async function withGreenroomLease({post,runId,route,signal=null,onWait=()=>{},
  retryMs=15000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)},run){
  const stopped=()=>{if(signal?.aborted)throw Object.assign(Error('GPU wait stopped'),{name:'AbortError'});};
  let lease;
  for(;;){
    stopped();
    try{lease=await post({action:'claim',runId,route});}
    catch(error){throw Error(`Greenroom lease claim failed: ${error?.message||error}`);}
    if(lease?.status!=='waiting')break;
    onWait(lease);await sleep(retryMs);
  }
  if(!['held','unconfigured'].includes(lease?.status))throw Error(`Greenroom lease claim failed: ${lease?.error||lease?.status||'no answer'}`);
  if(lease.status!=='held')return {result:await run(lease),lease};
  let timer=null,renewError=null;
  const renewEvery=Math.max(5000,(lease.ttlSeconds??120)*1000/4);
  const renew=()=>{timer=setTimer(async()=>{
    try{const r=await post({action:'renew',leaseId:lease.leaseId});
      if(r?.lifecycle&&r.lifecycle!=='active')renewError=`lease is ${r.lifecycle}, not active`;}
    catch(error){renewError=String(error?.message||error);}
    if(timer!==null)renew();},renewEvery);};
  const stopRenewing=()=>{const t=timer;timer=null;clearTimer(t);};
  const release=()=>post({action:'release',leaseId:lease.leaseId,reason:'page run ended'}).then(()=>null,error=>String(error?.message||error));
  renew();
  let result;
  try{result=await run(lease);}
  catch(error){
    stopRenewing();
    if(error?.gpuRouteHeld){
      error.greenroomHandback={leaseId:lease.leaseId,state:'kept-blocking',reason:`GPU work did not settle (${error.message}); the lease is left to Greenroom recovery`};
      throw error;
    }
    const releaseError=await release();
    if(releaseError&&error&&typeof error==='object')error.greenroomHandback={leaseId:lease.leaseId,state:'release-failed',releaseError};
    throw error;
  }
  stopRenewing();
  const releaseError=await release();
  return {result,lease:{...lease,...(renewError?{renewError}:{}),...(releaseError?{releaseError}:{})}};
}
