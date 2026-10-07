import {createWebGpuInferenceSession,createWebGpuForegroundService} from '../../webgpu-inference-kit/src/core.js';
import {GENERATION_ROUTE} from './sparse-generation-witness-checks.js';

const boundPrototypes=new WeakSet();
const throwIfStopped=signal=>{
  if(!signal?.aborted)return;
  const reason=signal.reason;
  if(reason instanceof Error&&reason.name==='AbortError')throw reason;
  throw new DOMException(String(reason?.message??reason??'TRELLIS stopped'),'AbortError');
};

// Model-private attachment to the existing composition seam. The caller keeps
// the scene/device/session; this bridge owns only its route and frame-service
// connection. It does not request a device, run a fixture model, or claim frame
// latency. Consume resident fields before finish releases the owned route.
export async function createTrellisSharedHost({sharedGpu,host,prototype,session:providedSession,sessionId}={}){
  const device=sharedGpu?.device,queue=sharedGpu?.queue,context=prototype?.foregroundGpuContext?.();
  if(!device||queue!==device.queue||typeof queue.submit!=='function'||typeof queue.onSubmittedWorkDone!=='function')
    throw Error('TRELLIS requires the same host device and exact queue with completion observation');
  if(host?.device!==device||context?.device!==device||context?.queue!==queue)
    throw Error('TRELLIS shared host/renderer device or queue mismatch');
  if(context.renderer!=='ordinary-volume'||context.productFrameOwner!=='prototype')
    throw Error('TRELLIS foreground service requires the actual ordinary renderer');
  if(typeof host.setForegroundServiceActive!=='function'||typeof host.runForegroundFrame!=='function'||
    typeof prototype.setForegroundOpportunityRequester!=='function')throw Error('actual host foreground bridge required');
  if(boundPrototypes.has(prototype))throw Error('TRELLIS foreground bridge already owns this renderer connection');
  if(providedSession&&(providedSession.device!==device||providedSession.queue!==queue))
    throw Error('provided inference session must borrow the same host device and queue');
  if(providedSession?.snapshot().routes.some(r=>r.routeId===GENERATION_ROUTE))
    throw Error('provided session already has a TRELLIS route');
  const name=sharedGpu.adapter?.info?.description||sharedGpu.adapter?.info?.device||sharedGpu.adapter?.info?.vendor;
  if(!providedSession&&(!sessionId||!name))throw Error('explicit session id and observed host adapter identity required');
  // Reserve before the asynchronous session factory yields.
  boundPrototypes.add(prototype);
  let session,foreground,connecting=false;
  let active=null,disposed=false;
  const assertOpen=()=>{if(disposed)throw Error('TRELLIS host bridge disposed');};
  const requestForegroundOpportunity=request=>{
    assertOpen();
    return foreground.request({...request,run:service=>{
      if(service.device!==device||service.queue!==queue)throw Error('TRELLIS foreground service device mismatch');
      return host.runForegroundFrame(()=>request.run(service));
    }});
  };
  try{
    session=providedSession??await createWebGpuInferenceSession({
      sessionId,adapter:sharedGpu.adapter,device,queue,adapterName:name,deviceOwnership:'borrowed'});
    foreground=createWebGpuForegroundService({routeId:GENERATION_ROUTE,device,queue});
    connecting=true;
    prototype.setForegroundOpportunityRequester(requestForegroundOpportunity);
    host.setForegroundServiceActive(true);
  }catch(error){
    boundPrototypes.delete(prototype);
    const failures=[];
    for(const cleanup of [
      ()=>connecting&&prototype.setForegroundOpportunityRequester(null),
      ()=>connecting&&host.setForegroundServiceActive(false),
      ()=>foreground?.dispose(),
      ()=>!providedSession&&session?.close(),
    ])try{await cleanup();}catch(secondary){failures.push(secondary);}
    if(failures.length)throw new AggregateError([error,...failures],'TRELLIS host construction and cleanup failed');
    throw error;
  }
  return Object.freeze({
    device,queue,session,requestForegroundOpportunity,
    snapshot(){return{session:session.snapshot(),foreground:foreground.snapshot(),disposed,
      activeRun:active?{runId:active.runId,status:active.status,error:active.error}:null};},
    async beginRun({runId,signal}={}){
      assertOpen();if(active)throw Error('TRELLIS host has an active or held run');
      if(typeof runId!=='string'||!runId.trim())throw Error('explicit TRELLIS run id required');
      if(signal!==undefined&&typeof signal?.aborted!=='boolean')throw Error('actual abort signal required');
      throwIfStopped(signal);
      const state={runId,status:'starting',error:null};active=state;
      let frameRun,route;
      try{
        frameRun=await foreground.beginRun(runId);
        route=await session.registerRoute({routeId:GENERATION_ROUTE,runtimeOptions:{
          kernel:{profile:'trellis2-shared-host-v0'},foregroundOpportunities:frameRun.foregroundOpportunities}});
      }catch(error){
        state.status='held';state.error=error.message;
        if(frameRun){
          try{await frameRun.finish();active=null;}catch(secondary){
            throw new AggregateError([error,secondary],'TRELLIS route admission and foreground settlement failed');
          }
        }else if(!foreground.snapshot().activeRun)active=null;
        throw error;
      }
      const runtime=Object.freeze({...route.runtime,
        async runKernel(kernel,options={}){
          throwIfStopped(signal);
          const dispatch=options.dispatch;
          // Runtime resolves dispatch after servicing foreground work and
          // immediately before encoding: Stop can arrive during that service.
          return route.runtime.runKernel(kernel,{...options,dispatch:boundary=>{
            throwIfStopped(signal);return typeof dispatch==='function'?dispatch(boundary):dispatch;
          }});
        },
        readTensor(tensor,options){throwIfStopped(signal);return route.runtime.readTensor(tensor,options);},
      });
      state.status='active';let finishing;
      return Object.freeze({
        runId,route:Object.freeze({...route,runtime}),
        withForeground(phase,work){
          throwIfStopped(signal);return frameRun.withForeground(phase,work);
        },
        finish(){
          if(finishing)return finishing;
          finishing=(async()=>{
            try{
              await route.drain();
              const report=await frameRun.finish();
              await queue.onSubmittedWorkDone();
              session.unregisterRoute(GENERATION_ROUTE);
              active=null;state.status='released';
              return{status:'released',runId,foreground:report,gpuSettled:true,
                meaning:'route-resource release; not model success, cancellation, or presented-frame certification'};
            }catch(error){state.status='held';state.error=error.message;throw error;}
          })();
          return finishing;
        },
      });
    },
    async dispose(){
      if(disposed)return;
      if(active)throw Error('finish the active or held TRELLIS run before disposal');
      await foreground.dispose();
      prototype.setForegroundOpportunityRequester(null);host.setForegroundServiceActive(false);
      if(!providedSession){await session.drain();session.close();}
      boundPrototypes.delete(prototype);disposed=true;
    },
  });
}
