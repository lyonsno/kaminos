export function createFlameWorkbench({readSettings,applySettings,readRuntime,readScene,readView,
  applyBasin,listBasins,select,frame,subscribe}) {
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
      next[axis][id]={...next[axis][id],value,rawValue:String(value)};
    }
    applySettings(next,'Edit Flame Workbench controls');return read();
  }
  return Object.freeze({read,setControls,applyBasin,listBasins,select,frame,subscribe,
    setPaused(paused){if(typeof paused!=='boolean')throw Error('Pause requires a Boolean');return setControls({'volume-look-freeze':paused?1:0});},
  });
}
// Subscribe to source operations, not animation ticks. Aliased inspector fields
// and agent edits reach this same channel without recording their wrappers twice.
export function observeFlameInvestigation({read,subscribe,channel}) {
  let previous=read();
  return subscribe(()=>{
    const current=read();
    for(const [key,kind,target] of [['settings','flame.settings','flame'],['view','camera.pose','camera'],['scene','scene.edit','scene']]) {
      if(JSON.stringify(current[key])!==JSON.stringify(previous[key]))channel.emit({kind,phase:'applied',target,
        effective:current[key],clock:current.clock});
    }
    previous=current;
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
