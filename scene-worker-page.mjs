import {createSceneWorkerClient} from './scene-worker-handoff.mjs';

const copy=value=>structuredClone(value);
function viewport(value){
 if(!value||!['width','height','pixelRatio'].every(key=>Number.isFinite(value[key])&&value[key]>0))throw Error('Worker viewport requires positive finite dimensions and pixel ratio');
 return {width:value.width,height:value.height,pixelRatio:value.pixelRatio};
}
export function captureSceneWorkerCamera(camera,target){
 if(!camera?.isPerspectiveCamera)throw Error('Worker page camera requires the existing perspective camera');
 camera.updateMatrixWorld();
 const result={type:'PerspectiveCamera',position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),target:target.toArray(),
  fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,zoom:camera.zoom,filmGauge:camera.filmGauge,filmOffset:camera.filmOffset,
  projectionMatrix:camera.projectionMatrix.toArray()};
 if([...result.position,...result.quaternion,...result.up,...result.target,...result.projectionMatrix,...['fov','aspect','near','far','zoom','filmGauge','filmOffset'].map(key=>result[key])].some(value=>!Number.isFinite(value)))throw Error('Worker page camera contains non-finite values');
 return result;
}
// UI messages are partial projections within one epoch. Explicit null values
// clear metadata; omission cannot erase current bounds or invent surface flags.
export function mergeSceneWorkerUi(previous,update){
 if(!update||typeof update!=='object'||Array.isArray(update))throw Error('Worker UI projection must be an object');
 const next=copy(update),merged={...(previous??{}),...next};
 if(Object.hasOwn(next,'surfaces')){
  if(!next.surfaces||typeof next.surfaces!=='object'||Array.isArray(next.surfaces))throw Error('Worker surfaces must be an object');
  merged.surfaces={...previous?.surfaces,...next.surfaces};
  for(const name of ['scene','volume','telemetry'])if(Object.hasOwn(next.surfaces,name)){
   const value=next.surfaces[name];if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Worker surface state must be an object');
   merged.surfaces[name]={...previous?.surfaces?.[name],...value};
  }
 }
 if(Object.hasOwn(next,'initialization')){
  if(!next.initialization||typeof next.initialization!=='object'||Array.isArray(next.initialization))throw Error('Worker initialization projection must be an object');
  merged.initialization={...previous?.initialization,...next.initialization};
 }
 return merged;
}
export function applySceneWorkerSurfaces(canvases,surfaces){
 if(!surfaces||typeof surfaces!=='object'||Array.isArray(surfaces))throw Error('Worker surfaces must be an object');
 for(const [name,state] of Object.entries(surfaces)){
  if(!canvases[name])continue;
  if(!state||typeof state!=='object'||['active','transparent','visible'].some(key=>Object.hasOwn(state,key)&&typeof state[key]!=='boolean'))throw Error('Worker surface flags must be actual booleans');
 }
 for(const [name,state] of Object.entries(surfaces)){
  const canvas=canvases[name];if(!canvas)continue;
  if(Object.hasOwn(state,'active')){canvas.classList.toggle('active',state.active);canvas.hidden=!state.active;}
  if(Object.hasOwn(state,'transparent'))canvas.style.background=state.transparent?'transparent':'';
  if(Object.hasOwn(state,'visible'))canvas.style.visibility=state.visible?'':'hidden';
 }
}

// The existing page owns input, DOM canvases and this frame-demand loop. The
// canonical worker facade owns operations; no page GPU host or domain clone is
// constructed here. Camera snapshots coalesce; authored commands never do.
export function createSceneWorkerPage({entryUrl='/scene-worker.entry.bundle.mjs',createWorker=url=>new Worker(url,{type:'module'}),
 sceneCanvas,volumeCanvas,telemetryCanvas=null,readViewport,readCamera,readFlameControls,initializePayload={},
 applyUi=()=>{},validateInitialization=()=>{},onProgress=()=>{},onError=()=>{},onPhase=()=>{},beforeFrame=()=>{},
 requestAnimationFrame:raf=callback=>globalThis.requestAnimationFrame(callback),cancelAnimationFrame:caf=id=>globalThis.cancelAnimationFrame(id),
 now=()=>performance.now(),timeOrigin=globalThis.performance?.timeOrigin,sessionId}={}){
 if([readViewport,readCamera,readFlameControls,createWorker,raf,caf].some(value=>typeof value!=='function'))throw Error('Worker page requires input readers and scheduling callbacks');
 const canvases={scene:sceneCanvas,volume:volumeCanvas,...(telemetryCanvas?{telemetry:telemetryCanvas}:{})};
 let worker=null,client=null,startPromise=null,retirePromise=null,rafId=null,pendingFrame=null,epoch=null,projectionError=null;
 const pending=new Map(),listeners=[];
 function listen(type,callback){worker.addEventListener(type,callback);listeners.push([type,callback]);}
 function detach(){for(const [type,callback] of listeners)worker?.removeEventListener(type,callback);listeners.length=0;}
 const state={phase:'new',initialized:false,entryUrl,initializations:0,frameRequests:0,frameCompletions:0,error:null,lastFrame:null,ui:null,observerErrors:[]};
 function observe(callback,...args){try{callback(...args);}catch(error){state.observerErrors.push(String(error?.message??error));}}
 const phase=value=>{state.phase=value;observe(onPhase,value);};
 function stopFrames(){if(rafId!==null){caf(rafId);rafId=null;}}
 function fail(error){state.error=String(error?.message??error);if(!['retiring','closed','retired'].includes(state.phase))phase('held');stopFrames();observe(onError,error);}
 function epochChanged(){
  if(!client)return;
  const next=client.read().epoch,key=JSON.stringify(next);
  if(epoch!==null&&epoch!==key){state.ui=null;if(!['retiring','retired','closed'].includes(state.phase)){phase('held');stopFrames();}}
  epoch=key;
 }
 function project(ui,meta){
  if(ui==null)return;
  if(typeof ui!=='object'||Array.isArray(ui))throw Error('Worker UI projection must be an object');
  const next=mergeSceneWorkerUi(state.ui,ui);applyUi(copy(ui),meta);state.ui=next;
 }
 function progress(event){
  epochChanged();
  try{project(event.value?.ui,{kind:'progress',requestId:event.requestId,epoch:event.epoch});observe(onProgress,event);}
  catch(error){projectionError=error;fail(error);}
 }
 function track(handle,kind){
  const completion=handle.completion.then(result=>{
   epochChanged();
   try{project(result.output?.ui??result.output?.result?.ui,{kind,requestId:handle.requestId,epoch:result.epoch});}
   catch(error){error.workerResult=result;fail(error);throw error;}
   return result;
  }).finally(()=>pending.delete(handle.requestId));
  // The owner may observe later; keep transport failures from becoming global
  // unhandled rejections without replacing the caller's completion Promise.
  completion.catch(()=>{});pending.set(handle.requestId,{handle,completion});
  return Object.freeze({requestId:handle.requestId,completion,cancel:handle.cancel,control:handle.control,get progress(){return handle.progress;}});
 }
 function schedule(){if(state.phase==='active'&&rafId===null)rafId=raf(frame);}
 function frame(){
  rafId=null;if(state.phase!=='active')return;
  schedule();
  try{
   beforeFrame();
   if(pendingFrame)return;
   const stamp=now();if(!Number.isFinite(stamp)||!Number.isFinite(timeOrigin))throw Error('Worker page frame clock must be finite');
   const input={now:stamp,timeOrigin,viewport:viewport(readViewport()),camera:copy(readCamera())};
   const handle=track(client.request('frame',input),'frame');pendingFrame=handle;state.frameRequests++;
   handle.completion.then(result=>{state.lastFrame=result;state.frameCompletions++;},fail).finally(()=>{pendingFrame=null;});
  }catch(error){fail(error);}
 }
 function start(){
  if(startPromise)return startPromise;
  startPromise=(async()=>{
   phase('initializing');
   try{
    const initialViewport=viewport(readViewport());
    if(Object.values(canvases).some(canvas=>typeof canvas?.transferControlToOffscreen!=='function'))throw Error('Worker rendering requires transferable HTML canvases');
    worker=createWorker(entryUrl);client=createSceneWorkerClient({port:worker,sessionId});
    const message=()=>{epochChanged();if(client.read().closed&&!['closed','retired'].includes(state.phase))fail(Error(client.read().error));};
    listen('message',message);
    listen('error',()=>fail(Error(client.read().error??'Worker entry failed; settlement unknown')));
    listen('messageerror',()=>fail(Error('Worker message transfer failed; settlement unknown')));
    const transferred=Object.fromEntries(Object.entries(canvases).map(([name,canvas])=>[`${name}Canvas`,canvas.transferControlToOffscreen()]));
    const payload={...copy(initializePayload),...transferred,viewport:initialViewport,flameControls:copy(readFlameControls())};
    state.initializations++;
    const result=await track(client.initialize(payload,{transfer:Object.values(transferred),onProgress:progress}),'initialize').completion;
    if(projectionError)throw projectionError;
    validateInitialization(result,state.ui);
    epochChanged();
    if(!['retiring','closed','retired'].includes(state.phase)){state.initialized=true;phase('active');schedule();}
    return result;
   }catch(error){fail(error);throw error;}
  })();startPromise.catch(()=>{});return startPromise;
 }
 function request(operation,payload=null,options={}){
  if(!client||!state.initialized||!['active','held'].includes(state.phase))throw Error('Worker page is not initialized for commands');
  const observer=options.onProgress;
  return track(client.request(operation,payload,{...options,onProgress:event=>{progress(event);observer?.(event);}}),'command');
 }
 function retire(){
  if(retirePromise)return retirePromise;
  retirePromise=(async()=>{
   stopFrames();phase('retiring');
   for(const {handle} of pending.values())handle.cancel('Page retirement requested');
   await Promise.allSettled([...pending.values()].map(entry=>entry.completion));
   if(!client)throw Error('Worker page has no initialized transport to retire');
   const result=await client.request('retire').completion;
   client.disconnect();detach();worker.terminate?.();state.initialized=false;phase('retired');return result;
  })().catch(error=>{if(!['closed','retired'].includes(state.phase))phase('held');fail(error);retirePromise=null;throw error;});
  retirePromise.catch(()=>{});return retirePromise;
 }
 return Object.freeze({start,request,retire,
  holdFrames(reason='Worker frame requests held'){if(['retiring','retired','closed'].includes(state.phase))return;stopFrames();state.error=reason;phase('held');},
  resumeFrames(){if(!client||client.read().closed||!state.initialized||state.phase!=='held')throw Error('Worker page cannot resume frame requests');state.error=null;phase('active');schedule();},
  disconnect(){stopFrames();client?.disconnect();detach();phase('closed');},
  read:()=>({...state,pendingFrame:pendingFrame?.requestId??null,transport:client?.read()??null}),
 });
}
