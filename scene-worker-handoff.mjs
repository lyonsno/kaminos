// Persistent scene-worker transport. GPU resources and synchronous frame
// callbacks stay inside createRuntime; only authored data/results cross port.
export const SCENE_WORKER_REQUEST='kaminos.scene-worker.request.v0';
export const SCENE_WORKER_REPLY='kaminos.scene-worker.reply.v0';
const parts=['scene','load','device'];
const initialEpoch=()=>({scene:0,load:0,device:0});
function copyEpoch(value){
  if(!value||!parts.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0))throw Error('Invalid scene worker epoch');
  return Object.fromEntries(parts.map(key=>[key,value[key]]));
}
const equalEpoch=(a,b)=>parts.every(key=>a[key]===b[key]);
const namedError=(name,message,fields={})=>Object.assign(Error(message),{name,...fields});
const abortError=reason=>namedError('AbortError',String(reason?.message??reason??'Scene operation canceled'));
function errorRecord(error){return {name:String(error?.name??'Error'),message:String(error?.message??error),gpuRouteHeld:error?.gpuRouteHeld===true};}
function checkPort(port){
  for(const name of ['postMessage','addEventListener','removeEventListener'])if(typeof port?.[name]!=='function')throw Error(`Scene worker port requires ${name}`);
}

export function createSceneWorkerClient({port,sessionId=globalThis.crypto.randomUUID()}={}){
  checkPort(port);
  if(typeof sessionId!=='string'||!sessionId)throw Error('Scene worker sessionId required');
  let epoch=initialEpoch(),serial=0,controlSerial=0,closed=false,error=null;
  const pending=new Map(),pendingControls=new Map(),observerErrors=[];
  function disconnect(cause=Error('Scene worker transport disconnected')){
    if(closed)return;
    closed=true;error=String(cause.message??cause);
    port.removeEventListener('message',message);
    port.removeEventListener('error',failed);port.removeEventListener('messageerror',failed);
    for(const entry of [...pending.values(),...pendingControls.values()]){
      entry.cleanup();entry.reject(Object.assign(Error(error),{gpuRouteHeld:true}));
    }
    pending.clear();pendingControls.clear();
  }
  function failed(event){disconnect(Error(event?.message??'Scene worker transport failed; settlement unknown'));}
  function adopt(next){
    const value=copyEpoch(next);
    if(parts.some(key=>value[key]<epoch[key]))throw Error('Scene worker epoch regressed');
    epoch=value;
  }
  function message(event){
    const data=event?.data;
    try{
      if(!data||data.schema!==SCENE_WORKER_REPLY||data.sessionId!==sessionId)throw Error('Invalid scene worker response identity');
      if(data.kind==='epoch'){adopt(data.epoch);return;}
      if(data.kind==='fault')throw Error(data.error?.message??'Scene worker protocol failed');
      if(data.kind==='control-result'){
        const control=pendingControls.get(data.controlId);
        if(!control)return;
        adopt(data.epoch);
        if(data.requestId!==control.requestId||typeof data.ok!=='boolean'||data.authority!=='worker-handler-returned')throw Error('Invalid scene worker control result');
        if(!data.ok&&typeof data.error?.message!=='string')throw Error('Missing scene worker control failure');
        pendingControls.delete(data.controlId);
        if(data.ok)control.resolve(data);
        else control.reject(namedError(data.error.name??'Error',data.error.message,{gpuRouteHeld:data.error.gpuRouteHeld===true}));
        return;
      }
      const entry=pending.get(data.requestId);
      if(!entry)return; // A duplicate cannot modify current state or a new request.
      adopt(data.epoch);
      if(data.kind==='progress'){
        if(!Number.isSafeInteger(data.sequence)||data.sequence!==entry.progress.length+1)throw Error('Invalid scene worker progress sequence');
        entry.progress.push(data);
        try{entry.onProgress?.(data);}catch(cause){observerErrors.push(errorRecord(cause));}
        return;
      }
      if(data.kind!=='result'||typeof data.ok!=='boolean')throw Error('Invalid scene worker result');
      if(!data.ok&&(!data.error||typeof data.error.message!=='string'))throw Error('Missing scene worker failure');
      if(data.ok&&data.authority!=='worker-handler-returned')throw Error('Invalid scene worker completion authority');
      entry.cleanup();pending.delete(data.requestId);
      if(data.ok)entry.resolve(data);
      else entry.reject(namedError(data.error.name??'Error',data.error.message,{gpuRouteHeld:data.error.gpuRouteHeld===true,epoch:copyEpoch(data.epoch)}));
    }catch(cause){disconnect(cause);}
  }
  port.addEventListener('message',message);
  port.addEventListener('error',failed);port.addEventListener('messageerror',failed);port.start?.();
  function request(operation,payload=null,{epoch:expected=epoch,signal,transfer=[],onProgress}={}){
    if(typeof operation!=='string'||!operation)throw Error('Scene worker operation required');
    const ticket=operation==='initialize'?null:copyEpoch(expected);
    const requestId=`${sessionId}:${++serial}`,progress=[];
    let resolve,reject;
    const completion=new Promise((a,b)=>{resolve=a;reject=b;});
    const cancel=reason=>{
      if(!pending.has(requestId))return false;
      try{port.postMessage({schema:SCENE_WORKER_REQUEST,sessionId,kind:'cancel',requestId,reason:String(reason?.message??reason??'cancel requested')});}
      catch(cause){disconnect(cause);}
      return true;
    };
    const abort=()=>cancel(signal.reason);
    const entry={resolve,reject,progress,onProgress,cleanup:()=>signal?.removeEventListener('abort',abort)};
    const control=(action,value=null)=>{
      if(typeof action!=='string'||!action)throw Error('Scene worker control action required');
      const controlId=`${sessionId}:control:${++controlSerial}`;let accept,decline;
      const done=new Promise((a,b)=>{accept=a;decline=b;});
      if(closed||!pending.has(requestId))decline(Error('Scene worker operation is no longer pending'));
      else{
        pendingControls.set(controlId,{resolve:accept,reject:decline,requestId,cleanup(){}});
        try{port.postMessage({schema:SCENE_WORKER_REQUEST,sessionId,kind:'control',requestId,controlId,action,payload:value});}
        catch(cause){pendingControls.delete(controlId);decline(cause);}
      }
      return Object.freeze({controlId,completion:done});
    };
    const handle=Object.freeze({requestId,completion,cancel,control,get progress(){return [...progress];}});
    if(closed){reject(namedError('Error',error??'Scene worker disconnected',{gpuRouteHeld:true}));return handle;}
    if(signal?.aborted){reject(abortError(signal.reason));return handle;}
    pending.set(requestId,entry);signal?.addEventListener('abort',abort,{once:true});
    try{port.postMessage({schema:SCENE_WORKER_REQUEST,sessionId,kind:'request',requestId,operation,epoch:ticket,payload},transfer);}
    catch(cause){entry.cleanup();pending.delete(requestId);reject(cause);}
    return handle;
  }
  return Object.freeze({request,initialize:(payload,options)=>request('initialize',payload,options),disconnect,
    read:()=>({sessionId,epoch:{...epoch},closed,error,pending:[...pending.keys()],pendingControls:[...pendingControls.keys()],observerErrors:[...observerErrors]}),
  });
}

export function installSceneWorkerHost({port=globalThis,createRuntime}={}){
  checkPort(port);
  if(typeof createRuntime!=='function')throw Error('Scene worker runtime factory required');
  let sessionId=null,epoch=initialEpoch(),runtime=null,phase='uninitialized',active=null,pumping=false,disconnected=false,lastError=null;
  let lifetime=new AbortController();
  const queue=[],entries=new Map(),foregroundFrames=new Set(),controls=new Set();
  let lastSequence=0,lastControlSequence=0,frameTail=Promise.resolve(),controlTail=Promise.resolve();
  const send=(data,transfer=[])=>port.postMessage({schema:SCENE_WORKER_REPLY,sessionId,...data,epoch:{...epoch}},transfer);
  function advance(part,owner=null){
    if(!parts.includes(part))throw Error('Unknown scene worker epoch component');
    if(epoch[part]===Number.MAX_SAFE_INTEGER)throw Error('Scene worker epoch exhausted');
    epoch={...epoch,[part]:epoch[part]+1};
    const reason=namedError('StaleSceneWorkerEpochError',`Scene worker epoch advanced: ${part}`);
    lifetime.abort(reason);lifetime=new AbortController();
    for(const entry of entries.values())if(entry!==owner)entry.controller.abort(reason);
    if(owner)owner.ticket={...epoch};
    phase='invalidated';
    if(sessionId&&!disconnected)send({kind:'epoch'});
    return {...epoch};
  }
  const lifecycle=Object.freeze({get signal(){return lifetime.signal;},epoch:()=>({...epoch}),invalidate:part=>advance(part)});
  function context(entry){
    const assertCurrent=()=>{
      if(!equalEpoch(entry.ticket,epoch))throw namedError('StaleSceneWorkerEpochError','Scene worker command belongs to an old epoch');
      if(entry.controller.signal.aborted)throw entry.controller.signal.reason;
      if(disconnected)throw Error('Scene worker transport disconnected');
    };
    return Object.freeze({requestId:entry.data.requestId,signal:entry.controller.signal,lifecycle,assertCurrent,
      epoch:()=>({...epoch}),advanceEpoch:part=>{assertCurrent();return advance(part,entry);},
      activate(){assertCurrent();phase='active';},
      withFrames(run){
        assertCurrent();
        if(typeof run!=='function'||entry.framesAllowed)throw Error('Invalid cooperative frame scope');
        if(typeof runtime?.requestFrame!=='function')throw Error('Cooperative frame admission adapter required');
        entry.framesAllowed=true;admitFrames();
        const scope=Promise.resolve().then(run).finally(()=>{entry.framesAllowed=false;});
        (entry.frameScopes??=[]).push(scope);
        scope.catch(()=>{}); // The command boundary observes failures, even if its adapter forgets to await.
        return scope;
      },
      transfer(values){assertCurrent();if(!Array.isArray(values))throw Error('Result transfer list must be an array');entry.transfer=values;},
      report(value,{transfer=[]}={}){assertCurrent();send({kind:'progress',requestId:entry.data.requestId,sequence:++entry.progress,value},transfer);},
    });
  }
  function requireSettled(){
    if(!runtime?.host?.unsettledRuns)return;
    const runs=runtime.host.unsettledRuns();
    if(!Array.isArray(runs))throw Error('Invalid unsettled inference ledger');
    if(runs.length)throw namedError('GpuRouteHeldError','Scene worker has unsettled inference runs',{gpuRouteHeld:true});
  }
  async function execute(entry){
    const {operation,payload}=entry.data;
    entry.ticket=operation==='initialize'?{...epoch}:copyEpoch(entry.data.epoch);
    const ctx=context(entry);ctx.assertCurrent();let output;
    if(operation==='initialize'){
      if(runtime)throw Error('Scene worker already initialized');
      phase='starting';
      runtime=await createRuntime({payload,context:ctx,lifecycle});
      if(!runtime||typeof runtime!=='object')throw Error('Scene worker factory returned no runtime');
      ctx.assertCurrent();phase='active';output={initialized:true};
    }else if(operation==='retire'){
      if(!runtime)throw Error('Scene worker not initialized');
      requireSettled();phase='retiring';
      output=await runtime.retire?.(ctx);
      ctx.assertCurrent();requireSettled();runtime=null;
      advance('device',entry);phase='retired';
    }else{
      if(!runtime)throw Error('Scene worker not initialized');
      if(operation==='frame'){
        if(phase!=='active')throw Error('Scene worker frame is not active after invalidation');
        if(typeof runtime.frame!=='function')throw Error('Scene worker runtime has no frame transaction');
        const draw=()=>{
          ctx.assertCurrent();
          const result=runtime.frame(payload,ctx);
          if(result&&typeof result.then==='function'){
            Promise.resolve(result).catch(()=>{});
            throw Error('Scene worker frame transaction must be synchronous');
          }
          return result;
        };
        // Admission may await the existing Kit foreground window. Its actual
        // draw/depth/source transaction remains synchronous inside that window.
        output=typeof runtime.requestFrame==='function'?await runtime.requestFrame(payload,ctx,draw):draw();
      }else{
        if(!Object.hasOwn(runtime.commands??{},operation)||typeof runtime.commands[operation]!=='function')throw Error(`Unknown scene worker operation: ${operation}`);
        try{output=await runtime.commands[operation](payload,ctx);}
        finally{await Promise.all(entry.frameScopes??[]);}
      }
    }
    ctx.assertCurrent();
    send({kind:'result',requestId:entry.data.requestId,ok:true,authority:'worker-handler-returned',output},entry.transfer);
  }
  async function settle(entry){
    try{await execute(entry);}
    catch(cause){
      lastError=errorRecord(cause);
      if(entry.data.operation==='retire')lastError.gpuRouteHeld=true;
      if(phase==='starting')phase='failed';
      send({kind:'result',requestId:entry.data.requestId,ok:false,error:lastError});
    }finally{entries.delete(entry.data.requestId);}
  }
  function control(data){
    const prefix=`${sessionId}:control:`,suffix=String(data.controlId).slice(prefix.length),sequence=Number(suffix);
    if(typeof data.controlId!=='string'||!data.controlId.startsWith(prefix)||!Number.isSafeInteger(sequence)||sequence<=lastControlSequence||String(sequence)!==suffix||typeof data.action!=='string'||!data.action)throw Error('Invalid scene worker control identity');
    lastControlSequence=sequence;
    const entry=entries.get(data.requestId);
    const task=controlTail.then(async()=>{
      try{
        if(!entry||entry!==active||!entries.has(data.requestId))throw Error('Scene worker control target is not active');
        if(typeof runtime?.control!=='function')throw Error('Scene worker runtime does not support controls');
        const ctx=context(entry);ctx.assertCurrent();
        const {signal,assertCurrent,report,epoch:readEpoch}=ctx;
        const output=await runtime.control(data.action,data.payload,Object.freeze({requestId:data.requestId,signal,assertCurrent,report,epoch:readEpoch}));
        ctx.assertCurrent();
        send({kind:'control-result',controlId:data.controlId,requestId:data.requestId,ok:true,authority:'worker-handler-returned',output});
      }catch(cause){send({kind:'control-result',controlId:data.controlId,requestId:data.requestId,ok:false,authority:'worker-handler-returned',error:errorRecord(cause)});}
    });
    controls.add(task);
    controlTail=task.catch(cause=>{lastError=errorRecord(cause);phase='transport-failed';});
    task.finally(()=>controls.delete(task)).catch(()=>{});
  }
  function admitFrames(){
    // Only the active command explicitly opens a foreground window. A queued
    // authored mutation stays ahead of later frames; no request is discarded.
    while(active?.framesAllowed&&queue[0]?.data.operation==='frame'){
      const entry=queue.shift();foregroundFrames.add(entry);
      entry.settlement=frameTail.then(()=>settle(entry)).finally(()=>foregroundFrames.delete(entry));
      frameTail=entry.settlement.catch(cause=>{lastError=errorRecord(cause);phase='transport-failed';});
    }
  }
  async function pump(){
    if(pumping)return;
    pumping=true;
    try{
      while(queue.length){
        active=queue.shift();
        try{await settle(active);}
        finally{
          // A subsequent replacement/retirement cannot overtake admitted GPU
          // frame opportunities, even if the model command returns first.
          await Promise.allSettled([...foregroundFrames].map(entry=>entry.settlement));
          await Promise.allSettled([...controls]);
          active=null;
        }
      }
    }finally{pumping=false;}
  }
  function message(event){
    const data=event?.data;
    try{
      if(disconnected)return;
      if(!data||data.schema!==SCENE_WORKER_REQUEST||typeof data.sessionId!=='string'||!data.sessionId||typeof data.requestId!=='string'||!data.requestId)throw Error('Invalid scene worker request identity');
      if(sessionId&&sessionId!==data.sessionId)throw Error('Scene worker session mismatch');
      if(data.kind==='cancel'){
        if(!sessionId)return;
        entries.get(data.requestId)?.controller.abort(abortError(data.reason));return;
      }
      if(data.kind==='control'){if(!sessionId)throw Error('Scene worker not initialized');control(data);return;}
      if(data.kind!=='request'||typeof data.operation!=='string'||!data.operation)throw Error('Invalid scene worker request');
      if(!sessionId){if(data.operation!=='initialize')throw Error('First scene worker request must initialize');sessionId=data.sessionId;}
      const prefix=`${sessionId}:`,suffix=data.requestId.slice(prefix.length),sequence=Number(suffix);
      if(!data.requestId.startsWith(prefix)||!Number.isSafeInteger(sequence)||sequence<=lastSequence||String(sequence)!==suffix)throw Error('Duplicate or invalid scene worker request identity');
      if(data.operation!=='initialize')copyEpoch(data.epoch);
      lastSequence=sequence;
      const entry={data,controller:new AbortController(),progress:0,transfer:[]};entries.set(data.requestId,entry);queue.push(entry);
      admitFrames();
      pump().catch(cause=>{lastError=errorRecord(cause);phase='transport-failed';});
    }catch(cause){lastError=errorRecord(cause);if(sessionId)send({kind:'fault',error:lastError});}
  }
  port.addEventListener('message',message);port.start?.();
  return Object.freeze({invalidate:part=>advance(part),lifecycle,
    read:()=>({sessionId,epoch:{...epoch},phase,active:active?.data.requestId??null,pending:queue.map(entry=>entry.data.requestId),foregroundFrames:[...foregroundFrames].map(entry=>entry.data.requestId),pendingControls:controls.size,error:lastError}),
    disconnect(){
      if(disconnected)return;
      disconnected=true;port.removeEventListener('message',message);
      lifetime.abort(abortError('Scene worker transport disconnected'));
      for(const entry of entries.values())entry.controller.abort(abortError('Scene worker transport disconnected'));
    },
  });
}
