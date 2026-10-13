// The application's GPU host: the shared device, one borrowed kit inference session and
// one app-owned kit foreground service for the whole page. A model starts its run with
// beginRun(runId, {routeId}) (one at a time; the run carries the model's identity) and
// the frame owner (the ordinary scene or the fire scene's volume prototype) sends its
// frames through the same service, so model duties and scene frames interleave.
// Models call beginRun inside their own admitted operation, never around a queue.
export const APP_FOREGROUND_ROUTE_ID='kaminos.app';

export function createAppGpuHost({sharedGpu,host,kit,frameOwner,install=null,sessionId=`kaminos-app:${globalThis.crypto?.randomUUID?.()??Date.now()}`}){
  const device=sharedGpu?.device;
  if(!device||sharedGpu.queue&&sharedGpu.queue!==device.queue)throw Error('the app GPU host needs the shared GPU device and its queue');
  const queue=device.queue;
  const foreground=kit.createWebGpuForegroundService({routeId:APP_FOREGROUND_ROUTE_ID,device,queue});
  // The frame owner's frames are requested through the app service; inside a model run
  // they wait for the run's duty boundaries, outside one they are served at once.
  const requester=request=>foreground.request({...request,run:service=>host.runForegroundFrame(()=>request.run(service))});
  let session=null,installedOn=null;
  async function ensureFrames(){
    const owner=frameOwner();
    if(!owner)throw Error('no frame owner for the app GPU host');
    // With an install hook (the authoring foreground handoff) the hook re-activates the
    // app requester each run, since another producer may have taken the frames meanwhile.
    if(install){await install(requester,owner);host.setForegroundServiceActive(true);installedOn=owner;return;}
    if(installedOn===owner)return;
    owner.setForegroundOpportunityRequester(requester);
    host.setForegroundServiceActive(true);installedOn=owner;
  }
  return {
    adapter:sharedGpu.adapter,device,queue,foreground,requester,frameOwner,
    session(){
      return session||=kit.createWebGpuInferenceSession({sessionId,adapter:sharedGpu.adapter,device,queue,
        adapterName:sharedGpu.adapter?.info?.description||sharedGpu.adapter?.info?.device||'kaminos-shared-device',deviceOwnership:'borrowed'});
    },
    async beginRun(runId,{routeId}={}){
      if(typeof routeId!=='string'||!routeId)throw Error('a model run needs its route id');
      await ensureFrames();
      return foreground.beginRun(runId,{routeId});
    },
    // A different owner took the frames (e.g. a producer that installs its own requester).
    released(){installedOn=null;},
    snapshot:()=>({foreground:foreground.snapshot(),framesOn:installedOn?.foregroundGpuContext?.().renderer??null}),
  };
}
