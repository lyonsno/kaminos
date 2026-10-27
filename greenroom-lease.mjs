// A model run in the page holds a cooperative Greenroom lease (serve.py /api/gpu-lease), so Greenroom's
// queued jobs and other lanes' leases wait for it, and it waits for them. Claims never block: while the GPU
// is held the run waits and retries, naming the holder. While the run works the lease is renewed.
// Release only follows settled GPU work: unsettledWork() (the app GPU host's ledger) must be empty and the run
// must not report its GPU route held (error.gpuRouteHeld); otherwise Greenroom stays blocked. Renewal stops, so Greenroom moves the lease to ownership_unknown, and the error
// carries the recovery obligation. A failed release is reported, never swallowed. A server with no
// Greenroom runs without a lease and says so. An unreachable server, or a broken Greenroom configuration,
// fails the run: running unleased silently is what the lease exists to prevent.
export async function withGreenroomLease({post,runId,route,signal=null,onWait=()=>{},unsettledWork=async()=>[],
  admission='lease',bypassSignal=null,
  retryMs=15000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)},run){
  if(!['lease','queue','outside'].includes(admission))throw Error('Unknown GPU admission mode');
  const stopped=()=>{if(signal?.aborted)throw Object.assign(Error('GPU wait stopped'),{name:'AbortError'});};
  let lease,queued=false,withdrawAttempted=false;
  const withdraw=async()=>{
    withdrawAttempted=true;
    try{
      const result=await post({action:'withdraw-queued',runId,route});
      if(!['cancelled','unconfigured'].includes(result?.status))throw Error(result?.error||result?.status||'no withdrawal answer');
      queued=false;
    }catch(error){
      error.greenroomHandback={state:'withdrawal-failed',runId,reason:'The admission entry or reserved lease may still block Greenroom.',error:String(error.message||error)};
      throw error;
    }
  };
  try{
    for(;;){
      stopped();
      if(admission==='outside'||bypassSignal?.aborted){
        if(queued)await withdraw();
        lease={status:'bypassed',coordination:'outside-queue',route,reason:'explicit user choice'};break;
      }
      queued=admission==='queue';
      try{lease=await post({action:queued?'queued-claim':'claim',runId,route});}
      catch(error){throw Error(`Greenroom lease claim failed: ${error?.message||error}`);}
      if(queued&&(signal?.aborted||bypassSignal?.aborted)){
        await withdraw();stopped();
        lease={status:'bypassed',coordination:'outside-queue',route,reason:'explicit user choice'};break;
      }
      if(lease?.status!=='waiting')break;
      onWait(lease);
      const waitSignal=signal&&bypassSignal?AbortSignal.any([signal,bypassSignal]):signal||bypassSignal;
      try{await sleep(retryMs,waitSignal);}catch(error){if(!bypassSignal?.aborted)throw error;}
    }
    if(!['held','unconfigured','bypassed'].includes(lease?.status))throw Error(`Greenroom lease claim failed: ${lease?.error||lease?.status||'no answer'}`);
  }catch(error){
    if(queued&&!withdrawAttempted){try{await withdraw();}catch(cleanup){error.greenroomHandback=cleanup.greenroomHandback;}}
    throw error;
  }
  if(lease.status!=='held'){stopped();return {result:await run(lease),lease};}
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
  // Release needs positive settlement: no unsettled GPU work in the host's ledger, and no held-route marker.
  const pending=async()=>{try{return await unsettledWork();}catch(error){return [`settlement unknown: ${error?.message||error}`];}};
  let result;
  try{stopped();result=await run(lease);}
  catch(error){
    stopRenewing();
    const unsettled=await pending();
    if(error?.gpuRouteHeld||unsettled.length){
      error.greenroomHandback={leaseId:lease.leaseId,state:'kept-blocking',
        reason:`GPU work did not settle (${unsettled.length?`unsettled: ${unsettled.join(', ')}; `:''}${error.message}); the lease is left to Greenroom recovery`};
      throw error;
    }
    const releaseError=await release();
    if(releaseError&&error&&typeof error==='object')error.greenroomHandback={leaseId:lease.leaseId,state:'release-failed',releaseError};
    throw error;
  }
  stopRenewing();
  const unsettled=await pending();
  if(unsettled.length)return {result,lease:{...lease,state:'kept-blocking',...(renewError?{renewError}:{}),
    releaseError:`not released: GPU work did not settle (${unsettled.join(', ')}); the lease is left to Greenroom recovery`}};
  const releaseError=await release();
  return {result,lease:{...lease,...(renewError?{renewError}:{}),...(releaseError?{releaseError}:{})}};
}
