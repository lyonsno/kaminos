export function createFlameWorkbench({readSettings,applySettings,readRuntime,readScene,readView,
  applyBasin,saveBasin,listBasins,select,frame,subscribe,borrowSceneClock}) {
  const read=()=>{
    const runtime=readRuntime(),settings=readSettings();
    return {active:runtime?.active===true,paused:Number(settings.domControls['volume-look-freeze']?.value)>=0.5,
      settings,runtime,scene:readScene(),view:readView(),
      clock:{frameCount:runtime?.frameCount??null,simStepCount:runtime?.simStepCount??null,
        backend:runtime?.backend??null,effectiveRoute:runtime?.effectiveRoute??null},
      continuation:{kind:'live-runtime',settingsReopenable:true,evolvedFieldCheckpoint:false}};
  };
  function setControls(patch) {
    if(!readRuntime()?.active)throw Error('Flame runtime is not active');
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length)throw Error('Flame controls require a nonempty object');
    const next=readSettings();
    for(const [id,value] of Object.entries(patch)) {
      const axis=['domControls','rendererControls','presentationControls'].find(key=>Object.hasOwn(next[key],id));
      if(!axis)throw Error('Unknown flame control: '+id);
      if(!['number','string','boolean'].includes(typeof value)||(typeof value==='number'&&!Number.isFinite(value)))throw Error('Invalid flame control: '+id);
      next[axis][id]={...next[axis][id],value,rawValue:typeof value==='boolean'?value:String(value)};
    }
    applySettings(next,'Edit Flame Workbench controls');return read();
  }
  return Object.freeze({borrowSceneClock(){if(typeof borrowSceneClock!=='function')throw Error('Flame scene clock is unavailable');return borrowSceneClock();},read,setControls,applyBasin,saveBasin,listBasins,select,frame,subscribe,
    setPaused(paused){if(typeof paused!=='boolean')throw Error('Pause requires a Boolean');return setControls({'volume-look-freeze':paused?1:0});},
  });
}
// Subscribe to source operations, not animation ticks. Aliased inspector fields
// and agent edits reach this same channel without recording their wrappers twice.
export function observeFlameInvestigation({read,subscribe,channel}) {
  const runtimeState=runtime=>({active:runtime?.active,backend:runtime?.backend,effectiveRoute:runtime?.effectiveRoute,
    controls:runtime?.controls,simGridDimensions:runtime?.simGridDimensions,gridHeight:runtime?.gridHeight});
  const signatures=current=>Object.fromEntries(['settings','view','scene'].map(key=>[key,JSON.stringify(current[key])])
    .concat([['runtime',JSON.stringify(runtimeState(current.runtime))]]));
  let previous=signatures(read());
  return subscribe(()=>{
    const current=read(),next=signatures(current);
    const changed=key=>next[key]!==previous[key];
    const emit=(kind,target,effective)=>channel.emit({kind,phase:'observed',target,effective,
      effectiveRuntimeControls:current.runtime?.controls??null,effectiveRuntime:runtimeState(current.runtime),clock:current.clock});
    // Settings also occur in authored Flame scene records. Keep their context
    // together so one source intervention is not emitted again as a scene edit.
    if(changed('settings')||changed('runtime')) {
      channel.emit({kind:changed('settings')?'flame.settings':'flame.runtime',phase:'observed',target:'flame',
        effective:changed('settings')?current.settings:runtimeState(current.runtime),authoredScene:current.scene,
        effectiveRuntimeControls:current.runtime?.controls??null,effectiveRuntime:runtimeState(current.runtime),clock:current.clock});
    } else if(changed('scene')) {
      emit('scene.edit','scene',current.scene);
    }
    if(changed('view'))emit('camera.pose','camera',current.view);
    previous=next;
  });
}
import {createInvestigationRecording,investigationOperations} from './investigation-recording.mjs';
import {createInvestigationGuide} from './investigation-guide.mjs';


export function createFlameInvestigation({flame,document,id,source,request,mount,guide={},guideFactory=createInvestigationGuide}) {
  const initial=flame.read();
  if(!initial.active)throw Error('Flame runtime is not active');
  const recorder=createInvestigationRecording({id,source,initial,
    startingConditions:{kind:'live-runtime',reconstructAfterRestart:false,authoredSettings:initial.settings,
      evolvedFieldCheckpoint:false}});
  let stop=()=>{},ui,frozen;
  const finish=()=>{
    if(!frozen){stop();frozen={recording:recorder.finish(),context:flame.read()};ui?.freeze('Recording stopped');}
    return structuredClone(frozen);
  };
  try {
    stop=observeFlameInvestigation({read:flame.read,subscribe:flame.subscribe,channel:investigationOperations});
    ui=guideFactory({document,
      question:guide.question??'Explore the flame',
      tryThis:guide.tryThis??'Select the emitter or simulation box, change a setting, and orbit the scene. Capture a view worth discussing.',
      whyThisMatters:guide.whyThisMatters??'The retained view and effective edits let us investigate the same flame. Saved settings reopen its authored setup, not its evolved fluid state.',
      onCapture:note=>request({action:'capture',note}),onFinish:note=>request({action:'finish',note})});
    mount(ui.node);
    return {read:()=>({recording:recorder.snapshot(),context:flame.read()}),finish,
      disconnect(message){finish();ui.disconnect(message);},saveFailed:message=>ui.saveFailed(message),
      isPresent:()=>ui.node.isConnected};
  } catch(error){stop();recorder.finish();ui?.disconnect('Investigation setup failed');throw error;}
}
