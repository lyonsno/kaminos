// A model run in the page holds a cooperative Greenroom lease (serve.py /api/gpu-lease), so Greenroom's
// queued jobs and other lanes' leases wait for it, and it waits for them. Claims never block: while the GPU
// is held the run waits and retries, naming the holder. While the run works the lease is renewed.
// Release only follows settled GPU work: unsettledWork() (the app GPU host's ledger) must be empty and the run
// must not report its GPU route held (error.gpuRouteHeld); otherwise Greenroom stays blocked. Renewal stops, so Greenroom moves the lease to ownership_unknown, and the error
// carries the recovery obligation. A failed release is reported, never swallowed. A server with no
// Greenroom runs without a lease and says so. An unreachable server, or a broken Greenroom configuration,
// fails the run: running unleased silently is what the lease exists to prevent.
export async function withGreenroomLease({post,runId,route,signal=null,onWait=()=>{},unsettledWork=async()=>[],
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
  // A Stop accepted while the claim was in flight wins over the grant: hand the lease straight back, run nothing.
  if(signal?.aborted){if(lease.status==='held')await post({action:'release',leaseId:lease.leaseId,reason:'stopped before the run'}).catch(()=>{});stopped();}
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
  // Release needs positive settlement: no unsettled GPU work in the host's ledger, and no held-route marker.
  const pending=async()=>{try{return await unsettledWork();}catch(error){return [`settlement unknown: ${error?.message||error}`];}};
  let result;
  try{result=await run(lease);}
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

// The page's one Greenroom lease helper for every in-page model run (TRELLIS, SF3D, Klein). It claims and waits
// (naming the holder), holds the lease for the run, and reports to the author a release that failed (owed and retried on
// page close) or a lease kept blocking because GPU work did not settle. unsettledWork is the app GPU host's ledger.
export function createPageGpuLease({post,unsettledWork,setInfo=()=>{},sleep,retryMs}){
  let current=null,owed=null;
  return {
    async run({label,route,signal=null,onPhase},run){
      let outcome;
      try{
        outcome=await withGreenroomLease({post,runId:globalThis.crypto.randomUUID(),route,signal,unsettledWork,
          ...(sleep?{sleep}:{}),...(retryMs!=null?{retryMs}:{}),
          onWait:wait=>{onPhase?.({phase:'waiting-for-gpu',heldBy:wait.heldBy});setInfo(`${label} waits for the GPU: Greenroom ${wait.heldBy?.length?`job ${wait.heldBy.join(', ')}`:'lease'} holds it`);}},
          held=>{current=held.status==='held'?held.leaseId:null;
            if(held.status==='unconfigured')setInfo(`${label} runs without a Greenroom lease: this server finds no Greenroom, so queued GPU jobs will not wait for it`);
            return run(held);});
      }catch(error){
        const handback=error?.greenroomHandback;current=null;
        if(handback?.state==='release-failed'){owed=handback.leaseId;setInfo(`Greenroom lease ${handback.leaseId} was not released (${handback.releaseError}); queued GPU jobs wait until it is`);}
        else if(handback?.state==='kept-blocking')setInfo(`Greenroom stays blocked: ${handback.reason}. Release lease ${handback.leaseId} once this page's GPU work has stopped`);
        throw error;
      }
      const {lease}=outcome;current=null;
      if(lease.state==='kept-blocking')setInfo(`Greenroom stays blocked: ${lease.releaseError}. Release lease ${lease.leaseId} once this page's GPU work has stopped`);
      else if(lease.releaseError){owed=lease.leaseId;setInfo(`Greenroom lease ${lease.leaseId} was not released (${lease.releaseError}); queued GPU jobs wait until it is`);}
      return outcome;
    },
    // Leases to release if the page closes: one held mid-run, one whose release is owed.
    pending:()=>[[current,'page closed during the run'],[owed,'page closed with a release owed']].filter(([id])=>id),
  };
}

// SF3D runs on its own foreground service, outside the app GPU host's ledger. Its run errors carry sf3dRun evidence; a
// null foregroundOpportunityReport there means the foreground finish failed, so its GPU work is not known settled.
export function sf3dFinishUnsettled(error){
  for(let e=error,depth=0;e&&depth<8;e=e.cause,depth++){
    if(e.sf3dRun)return e.sf3dRun.foregroundOpportunityReport==null?'SF3D foreground finish did not settle':null;
    for(const inner of e.errors??[])if(inner?.sf3dRun?.foregroundOpportunityReport===null)return 'SF3D foreground finish did not settle';
  }
  return null;
}

// A model service whose run takes the page's Greenroom lease first. While it waits for the GPU it reads as a stoppable
// loading state naming the holder (so the existing drawers show it) and counts as busy; Stop cancels the wait. Once
// the model runs, Stop and read are the service's own. unsettled(error) names GPU work a failed run left unsettled
// that the app GPU host's ledger cannot see; such a run keeps Greenroom blocked.
export function leasedService(service,{lease,label,route,changed=()=>{},unsettled=()=>null}){
  let waiting=null;
  const held=error=>{const reason=unsettled(error);if(!reason)return error;
    const marked=error instanceof Error&&Object.isExtensible(error)?error:new Error(String(error?.message||error),{cause:error});
    return Object.assign(marked,{gpuRouteHeld:true,gpuRouteHeldReason:reason});};
  return {...service,
    busy:()=>!!waiting||service.busy?.()===true,
    read(){const view=service.read();if(!waiting||waiting.started)return view;
      return {...view,status:'loading',canStop:true,error:null,stage:'Waiting for the GPU',percent:null,
        progress:`Waiting for the GPU: Greenroom ${waiting.heldBy?.length?`job ${waiting.heldBy.join(', ')}`:'work'} holds it`};},
    stop:()=>{if(waiting&&!waiting.started){waiting.abort.abort();changed();return true;}return service.stop();},
    async run(input){
      if(waiting||service.busy?.()===true)throw Error(`${label} is already running`);
      const state={abort:new AbortController(),started:false,heldBy:null};waiting=state;changed();
      try{
        const {result}=await lease.run({label,route,signal:state.abort.signal,onPhase:event=>{if(event?.phase==='waiting-for-gpu'){state.heldBy=event.heldBy;changed();}}},
          async()=>{state.started=true;changed();try{return await service.run(input);}catch(error){throw held(error);}});
        return result;
      }finally{if(waiting===state){waiting=null;changed();}}
    }};
}
