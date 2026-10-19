// Shared scheduling only. The producer owns its solver, render and source reads;
// the sink owns durable output. No retained simulation-state history is created.
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};
const canonical=value=>JSON.stringify(value);
function clockOf(state){
 const c=state?.clock;
 requireValue(typeof c?.runId==='string'&&c.runId&&Number.isSafeInteger(c.step)&&c.step>=0&&Number.isFinite(c.dt)&&c.dt>0&&typeof c.paused==='boolean','Effective simulation clock is missing');
 requireValue(typeof c.backend==='string'&&c.backend&&typeof c.renderer==='string'&&c.renderer,'Effective backend and renderer are missing');
 return c;
}
function fixedIdentity(state){
 const c=clockOf(state);
 requireValue(state.source&&Object.keys(state.source).length&&state.conditions&&state.view,'Effective source, starting conditions and view are required');
 return canonical({runId:c.runId,dt:c.dt,backend:c.backend,renderer:c.renderer,source:state.source,conditions:state.conditions,view:state.view});
}
export function sequenceSchedule({startSeconds,endSeconds,fps},dt){
 requireValue(Number.isFinite(fps)&&fps>0,'Export fps must be positive and finite');
 requireValue(Number.isFinite(startSeconds)&&startSeconds>=0&&Number.isFinite(endSeconds)&&endSeconds>=startSeconds,'Export requires an ordered nonnegative time range');
 requireValue(Number.isFinite(dt)&&dt>0,'Physics timestep must be positive and finite');
 const count=Math.floor((endSeconds-startSeconds)*fps+1e-10)+1;
 requireValue(Number.isSafeInteger(count)&&count>0,'Requested frame count is not representable');
 requireValue(Number.isSafeInteger(Math.round(endSeconds/dt)),'Requested target step is not representable');
 return {count,dt,startSeconds,endSeconds,fps,
  *frames(){for(let index=0;index<count;index++){
   const targetSeconds=startSeconds+index/fps,step=Math.round(targetSeconds/dt);
   yield {index,targetSeconds,step,timeSeconds:step*dt};
  }}
 };
}
export async function renderSequence({adapter,sink,request,signal,onProgress=()=>{}}){
 let phase='begin',completedFrames=0,lastTrustworthyFrame=null,initial=null;
 const summary=()=>({completedFrames,lastTrustworthyFrame});
 // The sink exists before any source read or runtime operation, including errors.
 await sink.begin({request});
 try{
  phase='validate';
  for(const key of ['read','hold','advanceToStep','render','capture'])requireValue(typeof adapter?.[key]==='function','Sequence adapter requires '+key);
  sequenceSchedule(request,1); // validate the request before changing live water
  phase='hold';await adapter.hold();initial=await adapter.read();
  const c=clockOf(initial),identity=fixedIdentity(initial),plan=sequenceSchedule(request,c.dt);
  requireValue(c.paused,'Sequence runtime did not pause');
  requireValue(Math.round(request.startSeconds/c.dt)>=c.step,'Sequence start precedes current state; restart explicitly before export');
  await sink.initial({initial,schedule:{count:plan.count,dt:plan.dt,startSeconds:plan.startSeconds,endSeconds:plan.endSeconds,fps:plan.fps,sampling:'nearest-fixed-step'}});
  const check=(state,step)=>{
   requireValue(fixedIdentity(state)===identity,'Sequence source, run, settings or view changed');
   requireValue(state.clock.paused&&state.clock.step===step,'Sequence did not hold the requested completed step');
  };
  for(const frame of plan.frames()){
   if(signal?.aborted){await sink.finish({status:'cancelled',complete:false,...summary(),phase:'cancelled'});return summary();}
   phase='advance';const before=await adapter.read();check(before,before.clock.step);
   requireValue(before.clock.step<=frame.step,'Sequence clock passed the requested frame');
   if(frame.step>before.clock.step)await adapter.advanceToStep(frame.step);
   check(await adapter.read(),frame.step);
   phase='render';const receipt=await adapter.render();
   requireValue(receipt?.step===frame.step,'Renderer did not confirm the requested simulation step');
   phase='capture';const image=await adapter.capture();check(await adapter.read(),frame.step);
   phase='write';await sink.frame({...frame,image,runId:c.runId});
   completedFrames++;lastTrustworthyFrame=frame.index;
   await onProgress({...summary(),requestedFrames:plan.count,timeSeconds:frame.timeSeconds});
  }
  phase='complete';await sink.finish({status:'complete',complete:true,...summary(),phase});return summary();
 }catch(error){
  await sink.finish({status:'failed',complete:false,...summary(),failurePhase:phase,failure:String(error.stack||error)});
  throw error;
 }
}
