import {createSceneRenderObjects} from './scene-render-bootstrap.mjs';
import {createSceneRenderResources} from './scene-render-resources.mjs';
import {createSceneWorkerView} from './scene-worker-view.mjs';
import {createOffscreenVolumeSurface} from './volume-runtime-surface.mjs';
import {createAppGpuHost} from './app-gpu-host.mjs';
import {createVolumeWorkerFrameBinding} from './volume-worker-frame-binding.mjs';
import {createSceneWorkerMutationBinding} from './scene-worker-mutation-binding.mjs';
import {createKleinSceneWorkerAdapter} from './authoring-image-worker-adapter.mjs';
import {sharedDeviceHostRequirements} from './authoring-image-operation.mjs';
import {createDeviceRecovery} from './scene-device-recovery.mjs';

const reserved=new Set(['initialize','retire','frame']);
function register(...maps){
 const commands=Object.create(null);
 for(const map of maps)for(const [name,handler] of Object.entries(map??{})){
  if(reserved.has(name)||Object.hasOwn(commands,name))throw Error(`scene worker command collision or reserved operation: ${name}`);
  if(typeof handler!=='function')throw Error(`scene worker command is not callable: ${name}`);
  commands[name]=handler;
 }
 return commands;
}

// This factory and its domain constructor live inside the Worker. Only plain
// initialization data and transferred canvases cross the message boundary.
// createSceneResources returns its cleanup-capable shell before allocating;
// its initialize/attachVolume methods construct the actual local domain graph.
// There is deliberately no basic-renderer or alternate-device fallback.
export function createSceneWorkerRuntimeFactory({THREE,createSceneResources,imageOptions=null,samRequirements=null,services={}}={}){
 if(!THREE||typeof createSceneResources!=='function')throw Error('scene worker needs its Three namespace and actual scene resource constructor');
 return ({payload,lifecycle})=>{
  let shared=null,renderResources=null,view=null,sceneResources=null,volume=null,appHost=null,frames=null,mutations=null,image=null;
  let commands=null,foregroundCommands=null,started=false,queueSettled=false,appRetired=false;
  let recovery=null,recoverySnapshot=null,recoveryHeld=false,makeVolume=null,makeHost=null,acquireDevice=null,failedCandidate=null,recoveryUi=null;
  const retiredDevices=new Set();
  let appliedViewport={...payload.viewport},appliedControls=structuredClone(payload.flameControls);
  const surfaceState={active:false,transparent:false};
  const viewport=()=>appliedViewport;
  function applyFrameInputs(input,context){
   if(Object.hasOwn(input,'flameControls'))throw Error('authored flame settings require the flame.controls command');
   view.apply(input,context);
   return sceneResources.applyFrameInputs(input,context);
  }
  function applyFlameControls(input,context){
   context.assertCurrent();const next=structuredClone(input);
   if(volume)volume.setControls(next);
   appliedControls={...appliedControls,...next};
   return {acceptedControls:structuredClone(appliedControls)};
  }
  function runtimeUi(extra={}){
   const live=sceneResources?.readUi?.()??{};
   return {...live,...extra,...(recovery?{rendererRecovery:recovery.state()}:{}),surfaces:{...live.surfaces,...extra.surfaces,
    volume:{...live.surfaces?.volume,...extra.surfaces?.volume,...surfaceState}}};
  }
  function current(){if(!frames)throw Error('scene worker runtime is not initialized');if(recoveryHeld)throw Error('Scene worker GPU recovery is holding rendering and mutation');}
  function requireSceneHook(name){if(typeof sceneResources?.[name]!=='function')throw Error('Scene worker recovery requires '+name);return sceneResources[name].bind(sceneResources);}
  async function releaseFailedCandidate(ctx){
   if(!failedCandidate)return;
   await requireSceneHook('releaseVolume')({volume,context:ctx});ctx.assertCurrent();
   if(volume){await volume.dispose();volume=null;}
   await requireSceneHook('releaseRendererPresentation')(ctx);ctx.assertCurrent();
   await renderResources.retireRenderer();failedCandidate.device.destroy();if(shared===failedCandidate)shared=null;failedCandidate=null;for(const device of retiredDevices){device.destroy();retiredDevices.delete(device);}
  }
  async function rebuild({watch,assertCurrent}){
   const ctx=recoveryCommand;assertCurrent();
   if(appHost?.unsettledRuns().length)throw Object.assign(Error('Scene worker has unsettled inference runs'),{gpuRouteHeld:true});
   await releaseFailedCandidate(ctx);assertCurrent();
   if(image)await image.retire();assertCurrent();
   if(appHost&&!appRetired){await appHost.retire();appRetired=true;}assertCurrent();
   await requireSceneHook('releaseVolume')({volume,context:ctx});assertCurrent();
   if(volume){await volume.dispose();volume=null;}assertCurrent();
   await requireSceneHook('releaseRendererPresentation')(ctx);assertCurrent();
   const previous=shared;if(previous)retiredDevices.add(previous.device);
   const next=await acquireDevice();failedCandidate=next;
   let detach;
   try{
    assertCurrent();if(!next?.device||next.queue&&next.queue!==next.device.queue)throw Error('Scene worker recovery requires one shared device and queue');
    detach=watch(next.device);shared=next;queueSettled=false;
    await renderResources.replaceRenderer(next,ctx);assertCurrent();
    for(const device of retiredDevices)if(device!==next.device){device.destroy();retiredDevices.delete(device);}
    await requireSceneHook('restoreRendererPresentation')(ctx);assertCurrent();
    appHost=makeHost();appRetired=false;volume=makeVolume();
    await requireSceneHook('prepareVolume')({volume,context:ctx});assertCurrent();
    volume.setSimulationPaused(recoverySnapshot.paused);await volume.setActive(recoverySnapshot.active);assertCurrent();
    frames=createVolumeWorkerFrameBinding({appHost,volume,applyFrameInputs,allowDormant:!recoverySnapshot.active});mutations=createSceneWorkerMutationBinding({appHost});
    const attached=await requireSceneHook('reattachVolume')({volume,appHost,context:ctx});assertCurrent();recoveryUi=attached?.ui??null;failedCandidate=null;
   }catch(error){detach?.();volume?.retireLostDevice?.();throw error;}
  }
  let recoveryCommand=null;
  async function recover(action,ctx){
   ctx.assertCurrent();if(!recovery)throw Error('Scene worker shared device loss observation unavailable');
   if(recoveryCommand)throw Error('Scene worker recovery already in progress');recoveryCommand=ctx;
   try{await recovery[action](ctx);ctx.assertCurrent();if(recovery.state().phase!=='active')throw Error('Scene worker recovery did not become active');recoveryHeld=false;recoverySnapshot=null;ctx.activate();return {...recovery.state(),ui:runtimeUi(recoveryUi??{})};}
   finally{recoveryCommand=null;}
  }
  return {
   get host(){return appHost;},get commands(){return commands;},get foregroundCommands(){return foregroundCommands;},
   async initialize(ctx){
    if(started)throw Error('scene worker runtime initialization already attempted');started=true;ctx.assertCurrent();
    const api=services.requestDevice&&services.createVolume?null:await import('./volume-core.js');
    const kit=services.kit??await import('./webgpu-inference-kit/src/core.js');ctx.assertCurrent();
    acquireDevice=()=> (services.requestDevice??api.requestKaminosSharedWebGpuDevice)({hostRequirements:sharedDeviceHostRequirements({sam:samRequirements})});
    shared=await acquireDevice();
    ctx.assertCurrent();
    if(!shared?.device||shared.queue&&shared.queue!==shared.device.queue)throw Error('scene worker acquisition did not return one shared device and queue');
    const objects=(services.createRenderObjects??createSceneRenderObjects)({THREE,viewport});
    renderResources=(services.createRenderResources??createSceneRenderResources)({THREE,...objects,canvas:payload.sceneCanvas,
     readViewport:viewport,readSharedGpu:()=>shared,readRendererOptions:()=>({exposure:payload.exposure??1}),
     // Domain state exists before lighting is constructed; the shell retains
     // each actual allocation even if construction of that graph fails.
     readLightingOptions:()=>sceneResources.lightingOptions});
    if(typeof renderResources?.initializeRenderer!=='function'||typeof renderResources?.retire!=='function')throw Error('scene worker requires its retained renderer resource owner');
    await renderResources.initializeRenderer(ctx);
    ctx.assertCurrent();
    view=createSceneWorkerView({camera:objects.camera,renderResources,readViewport:viewport,writeViewport:value=>{appliedViewport=value;}});
    view.apply({camera:payload.camera},ctx);

    sceneResources=createSceneResources({...objects,THREE,renderer:renderResources.renderer,pmremGenerator:renderResources.pmremGenerator,
     renderResources,sharedGpu:shared,readSharedGpu:()=>shared,payload,lifecycle,viewport,
     readFlameControls:()=>appliedControls,applyFlameControls,readAppHost:()=>appHost});
    if(typeof sceneResources?.retire!=='function'||typeof sceneResources?.initialize!=='function')throw Error('scene resource shell requires initialize and retire');
    await sceneResources.initialize(ctx);ctx.assertCurrent();
    if(!renderResources.lighting)throw Error('scene worker requires the actual initialized lighting graph');
    const sceneFrames=sceneResources.frames;
    if(typeof sceneFrames?.runForegroundFrame!=='function'||typeof sceneFrames?.setForegroundServiceActive!=='function')throw Error('scene worker requires the actual ordinary scene frame runtime');
    if(typeof sceneResources.applyFrameInputs!=='function')throw Error('scene worker requires the actual frame input consumer');
    makeHost=()=>createAppGpuHost({sharedGpu:shared,host:sceneResources.frames,kit,frameOwner:()=>frames});
    appHost=makeHost();
    makeVolume=()=> (services.createVolume??api.createKaminosVolumePrototype)({...sceneResources.volumeOptions,
     THREE,camera:objects.camera,getControls:()=>appliedControls,
     presentationSurface:createOffscreenVolumeSurface({canvas:payload.volumeCanvas,readViewport:viewport,
      onActive:value=>{surfaceState.active=Boolean(value);},onTransparent:value=>{surfaceState.transparent=Boolean(value);}}),
     sharedGpuContext:shared,frameScheduleOwner:'host',productFrameOwner:'prototype'});
    volume=makeVolume();
    if(sceneResources.prepareVolume){await sceneResources.prepareVolume({volume,context:ctx});ctx.assertCurrent();}
    await volume.setActive(sceneResources.initialVolumeActive??true);ctx.assertCurrent();
    frames=createVolumeWorkerFrameBinding({appHost,volume,applyFrameInputs,allowDormant:sceneResources.initialVolumeActive===false});
    mutations=createSceneWorkerMutationBinding({appHost});
    if(typeof sceneResources.attachVolume!=='function')throw Error('scene worker requires actual scene/flame source and transport attachment');
    await sceneResources.attachVolume({volume,appHost,context:ctx});ctx.assertCurrent();
    if(imageOptions)image=createKleinSceneWorkerAdapter({...imageOptions,context:()=>({sharedGpu:shared,prototype:volume,host:sceneResources.frames}),appHost:()=>appHost,kit:()=>kit});
    commands=register(sceneResources.commands,image?.commands);
    for(const [name,handler]of Object.entries(commands))commands[name]=(...args)=>{if(recoveryHeld)throw Error('Scene worker GPU recovery is holding operations');return handler(...args);};
    commands=register(commands,{'renderer.read':(_input,context)=>{context.assertCurrent();return {...(recovery?.state()??{phase:'unavailable'}),ui:runtimeUi()};},'renderer.recover':(_input,context)=>recover('recover',context),'renderer.retry':(_input,context)=>recover('retry',context)});
    foregroundCommands=register({'flame.controls':applyFlameControls},sceneResources.foregroundCommands);
    for(const name of Object.keys(foregroundCommands))if(Object.hasOwn(commands,name))throw Error(`scene worker command collision: ${name}`);
    ctx.assertCurrent();
    if(shared.device.lost?.then)recovery=createDeviceRecovery({device:shared.device,automatic:false,rebuild,stop(){
     recoverySnapshot??={active:Boolean(volume?.isActive()),paused:Boolean(volume?.debugState().simulationPaused)};recoveryHeld=true;
     lifecycle.invalidate('device');requireSceneHook('stopRendererResources')();sceneResources.frames.setForegroundServiceActive(false);volume?.retireLostDevice();
    }});
    ctx.report({ui:runtimeUi()});
   },
   frame(input,ctx){
    current();let local=input;
    if(Object.hasOwn(input,'timeOrigin')){
     if(!Number.isFinite(input.now)||!Number.isFinite(input.timeOrigin))throw Error('frame clock requires finite now and timeOrigin');
     local={...input,now:input.now+input.timeOrigin-(services.timeOrigin??performance.timeOrigin)};
    }
    const result=frames.frame(local,ctx);return {...result,ui:runtimeUi()};
   },
   async requestFrame(input,ctx,draw){
    current();const receipt=await frames.requestFrame(input,ctx,draw);
    return {...receipt,ui:receipt.result.ui};
   },
   async requestMutation(operation,input,ctx,apply){
    current();const receipt=await mutations.requestMutation(operation,input,ctx,apply);
    return {...receipt,ui:runtimeUi(receipt.value?.ui)};
   },
   control(action,input,ctx){current();if(!image)throw Error('scene worker has no image operation');return image.control(action,input,ctx);},
   async retire(ctx){
    if(appHost?.unsettledRuns().length)throw Object.assign(Error('scene worker still has unsettled inference runs'),{gpuRouteHeld:true});
    recovery?.dispose();
    await releaseFailedCandidate(ctx);
    // Clear handles only after their cleanup succeeds. A failure leaves this
    // same retained shell available to explicit retirement retry.
    if(image){await image.retire();image=null;}
    if(appHost&&!appRetired){await appHost.retire();appRetired=true;}
    if(shared&&!queueSettled){await shared.device.queue.onSubmittedWorkDone();queueSettled=true;}
    if(sceneResources){await sceneResources.retire(ctx);sceneResources=null;}
    if(volume){await volume.dispose();volume=null;}
    if(renderResources){await renderResources.retire();renderResources=null;}
    if(shared){shared.device.destroy();retiredDevices.delete(shared.device);shared=null;}for(const device of retiredDevices){device.destroy();retiredDevices.delete(device);}
    appHost=null;frames=null;mutations=null;view=null;commands=null;foregroundCommands=null;
    return {retired:true};
   },
  };
 };
}
