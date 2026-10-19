import {checkedRenderOutput,outputPixels,checkedRecordingOptions} from './render-output.mjs';
export function checkedRecording(raw={}){
 const keys=['frames','fps','format','columns','tileWidth'],options=checkedRecordingOptions({...raw.recording,...Object.fromEntries(keys.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]]))}),value=checkedRenderOutput({...raw,kind:'recording',recording:options});
 return {...value,...Object.fromEntries(keys.map(key=>[key,options[key]]))};
}
// Capture callbacks run inside the actual renderer's presentation task. Nothing
// here advances, holds, or resets a simulation or creates another render loop.
export function createViewportRecording({host,makeSink,now=()=>performance.now()}){
 let active=null,last={status:'idle'};
 return {
  state:()=>structuredClone(active?.state??last),
  stop(){if(active){active.stopRequested=true;active.finish?.();}},
  cancel(){active?.abort.abort(new DOMException('Recording cancelled','AbortError'));},
  async start(raw,{signal,onProgress=()=>{}}={}){
   if(active)throw Error('A recording is already in progress');
   const settings=checkedRecording(raw),pixels=outputPixels(settings),abort=new AbortController();
   const run={abort,state:{status:'starting',frameCount:0,settings,pixels}};active=run;
   const cancel=()=>abort.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
   let session,sink,unsubscribe,result,failure;
   try{
    abort.signal.throwIfAborted();session=await host.begin({settings,pixels,signal:abort.signal});abort.signal.throwIfAborted();
    sink=await makeSink({settings,pixels});abort.signal.throwIfAborted();
    let start=null,next=0,missed=0,elapsed=0;const receipts=[];
    await new Promise((resolve,reject)=>{
     const stopped=()=>reject(abort.signal.reason);abort.signal.addEventListener('abort',stopped,{once:true});
     run.finish=()=>{run.state.status='encoding';abort.signal.removeEventListener('abort',stopped);resolve();};
     run.state.status='recording';onProgress(structuredClone(run.state));
     unsubscribe=session.subscribe(()=>{
      try{
       if(run.state.status!=='recording')return;abort.signal.throwIfAborted();const at=now();if(start===null)start=at;elapsed=at-start;
       if(elapsed+0.001<next)return;
       const frame=session.capture();
       sink.add(frame.canvas,run.state.frameCount);receipts.push({...frame.receipt,atMs:elapsed});
       missed+=Math.max(0,Math.floor((elapsed-next+0.001)/(1000/settings.fps)));
       next=elapsed+1000/settings.fps;
       run.state.frameCount++;run.state.sourceElapsedMs=elapsed;run.state.missedIntervals=missed;
       onProgress(structuredClone(run.state));if(run.state.frameCount>=settings.frames)run.finish();
      }catch(error){abort.signal.removeEventListener('abort',stopped);reject(error);}
     });
     if(run.stopRequested)run.finish();
    });
    unsubscribe?.();unsubscribe=null;
    await session.release();session=null;
    abort.signal.throwIfAborted();if(!run.state.frameCount)throw Error('No frames were recorded');
    run.state.status='encoding';onProgress(structuredClone(run.state));
    result=await sink.finish(run.state.frameCount);abort.signal.throwIfAborted();
    if(!(result?.blob instanceof Blob)||result.blob.size===0||result.frameCount!==run.state.frameCount)throw Error('Encoder did not return all recorded frames');
    result={...result,...run.state,status:'complete',receipts,durationSeconds:run.state.frameCount/settings.fps};
   }catch(error){failure=error;}
   finally{
    unsubscribe?.();try{await session?.release();}catch(error){failure=failure?new AggregateError([failure,error],'Recording failed and restoration failed'):error;}
    try{sink?.dispose();}catch(error){failure??=error;}
    signal?.removeEventListener('abort',cancel);last={...run.state,status:failure?(failure.name==='AbortError'?'cancelled':'failed'):'complete',error:failure?.message??null};active=null;
   }
   if(failure)throw failure;return result;
  },
 };
}
