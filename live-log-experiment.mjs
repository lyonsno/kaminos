import * as THREE from './lib/three.webgpu.js';
import {BURN_TABLE_ASSET} from './burn-table-core.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';
import {createLiveLogHeatGpu} from './live-log-heat-gpu.mjs';
import {createLogGasSourceGpu} from './live-log-gas-source.mjs';
import {LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';
import {createLogBurnIndicator} from './live-log-indicator.mjs';
import {createMaterialMotionGpu} from './material-motion-gpu.mjs';
import {createLogDebrisGpu} from './log-debris-gpu.mjs';

export async function createLiveLogExperiment({host,inputs={},record}) {
  const {scene,volume,fire}=host;
  await Promise.all([scene.ready,volume.ready]);
  const runtime=volume.get(),renderer=scene.renderer();
  const setSource=value=>fire?fire.setEnabled(value):volume.burner(value);
  runtime.setSimulationPaused(true);setSource(false);
  const context=await runtime.borrowThermalGpuContext();
  if(context.device!==renderer.backend.device)throw Error('Live log and scene must share the fluid GPU device');
  if(![32,48].includes(context.dimensions[0]))throw Error('Live log experiment requires the agreed 32/48 basin');
  const source=`/api/read?root=${BURN_TABLE_ASSET.root}&path=${encodeURIComponent(BURN_TABLE_ASSET.path)}`;
  let disposed=false,object=null,detach=null,unsubscribeFire=null,mounted=null,indicator=null,view='beauty',phase='loading',running=false,burner=false,paused=true,flameVisible=fire?.read().visible??false;
  const canvas=runtime.canvasElement?.();const originalOpacity=canvas?.style.opacity;
  if(canvas&&!fire)canvas.style.opacity='0';
  const fields=[],bindings=[],restores=[],debris=[];let elapsed=0,attempt=crypto.randomUUID(),gasSource=null,motion=null,releaseFollowing=null;
  const membership=()=>object&&scene.objects().some(entry=>entry.object===object);
  const fireAvailable=()=>!fire||(fire.availability?fire.availability():fire.read()).status==='mounted';
  function assertActive(){if(disposed)throw Error('Live log experiment disposed');if(!membership())throw Error('Live log removed from scene');if(!fireAvailable())throw Error('Fire source removed or replaced; reconnect fire');}
  const read=()=>({identity:LIVE_LOG_HEAT_IDENTITY,status:disposed?'disposed':!membership()||!fireAvailable()?'unavailable':phase,
    unavailableReason:!membership()?'log':!fireAvailable()?'fire':null,
    running,burner:fire?fire.read().enabled:burner,paused,flameVisible:fire?.read().visible??flameVisible,fire:fire?.read()??null,attempt,asset:BURN_TABLE_ASSET,source,objectId:scene.objects().find(entry=>entry.object===object)?.id||null,
    physicalWoodCalibration:false,selfEmission:!!gasSource,gasSource:gasSource?.read()??null,burnStatusAuthority:'resident-gpu-peak-reaction',view,fields:fields.map(field=>field.read()),materials:bindings.map(binding=>binding.read()),
    fluid:{backend:runtime.debugState().backend,active:runtime.debugState().active,simStepCount:runtime.debugState().simStepCount,grid:runtime.debugState().simGrid},
    position:object?.position.toArray(),rotation:object?.rotation.toArray(),followingDomain:runtime.debugState().followingDomain??null,motion:motion?.read()??null,debris:debris.map(item=>item.read())});
  const emit=(name,effective,requested={})=>record({kind:'sinter.live-log.'+name,target:scene.objects().find(entry=>entry.object===object)?.id||'live-log',phase:'applied',requested,effective:{...effective,attempt}});
  const updateUI=()=>{if(!mounted)return;const state=read();mounted.status.textContent=state.status==='cold'?'Cold · paused':state.status==='unavailable'?state.unavailableReason==='fire'?'Fire source removed or replaced':'Log removed':`${state.burner?'Burner on':'Burner off'}${paused?' · paused':''}`;mounted.run.disabled=disposed||!membership()||!fireAvailable();mounted.reconnect.hidden=state.unavailableReason!=='fire';mounted.pause.disabled=!running;mounted.pause.textContent=paused?'Resume':'Pause';const feed=mounted.panel.querySelector('[name=wood-fuel-feed]');if(feed)feed.checked=state.gasSource.enabled;mounted.panel.querySelectorAll('[name=burn-view]').forEach(input=>{input.checked=input.value===state.view;});};
  try {
    object=await scene.load(source,{clear:false,arrival:'append',isCurrent:()=>!disposed,metadata:{label:'Live log / local heat',fileName:BURN_TABLE_ASSET.path,collision:{domainId:'flame-field',enabled:true}}});
    object.position.fromArray(inputs.position??[.45,-.65,0]);object.rotation.set(0,Math.PI/2,0);object.scale.multiplyScalar(.35);
    object.updateWorldMatrix(true,true);
    const meshes=[];object.traverse(child=>{if(child.isMesh)meshes.push(child);});
    if(!meshes.length)throw Error('Live log asset has no mesh');
    if(inputs.disintegrate&&meshes.length!==1)throw Error('The first disintegration fixture requires one consumable mesh; ordinary heat remains available');
    for(const mesh of meshes){
      mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
      const field=await createLiveLogHeatGpu({renderer,mesh,bounds,disintegrate:inputs.disintegrate===true});fields.push(field);
      const original=mesh.material;const originals=Array.isArray(original)?original:[original];
      const converted=originals.map(material=>{const binding=createBurnMaterial({renderer,original:material,bounds,settings:{heat:0,char:0,reaction:0},stateNode:field.stateNode,stateIdentity:LIVE_LOG_HEAT_IDENTITY,presenceNode:inputs.disintegrate?field.stateNode.w:null});bindings.push(binding);return binding.material;});
      restores.push({mesh,original});mesh.material=Array.isArray(original)?converted:converted[0];
      if(inputs.disintegrate){const item=await createLogDebrisGpu({renderer,field,ground:scene.ground()});debris.push(item);await scene.attach(item.root,{owned:true,metadata:{label:'Char residue'}});}
    }
    indicator=createLogBurnIndicator({object,fields,document:host.controls?.document??globalThis.document});
    gasSource=await createLogGasSourceGpu(context);
    if(inputs.followObject===true){
      if(!volume.followObject)throw Error('Moving log requires shared object-following domain host');
      releaseFollowing=await volume.followObject(object);
      motion=await createMaterialMotionGpu({renderer,object});
    }
    const consumer={device:context.device,gasSource:gasSource.descriptor,
    materialMasks:()=>inputs.disintegrate?fields.map(field=>field.materialMask(scene.objects().find(entry=>entry.object===object)?.id)):[],
    prepareSource(encoder,frame){
      gasSource.begin(encoder);
      if(!disposed&&membership()&&fireAvailable())for(const field of fields)field.encodeGasSource(encoder,frame,gasSource);
      gasSource.resolve(encoder);
      motion?.encode(encoder,frame,gasSource);
    },encode(encoder,frame){
      if(disposed||!membership()||!fireAvailable()){running=false;paused=true;runtime.setSimulationPaused(true);phase='unavailable';updateUI();return;}
      for(const field of fields)field.encode(encoder,frame);for(const item of debris)item.encode(encoder,frame);elapsed+=frame.dt;for(const binding of bindings)binding.update(elapsed);
      scene.dirty();
    },read:()=>({identity:LIVE_LOG_HEAT_IDENTITY,attempt,gasSource:gasSource.read(),fields:fields.map(field=>field.read())})};
    detach=runtime.bindGpuThermalConsumer(consumer);
    runtime.resetThermalExperimentFluid();await runtime.setActive(true);
    phase='cold';scene.enterWorkbench();
    unsubscribeFire=fire?.subscribe?.(updateUI);
    const sourceObject=fire&&scene.objects().find(entry=>entry.id===fire.read().objectId)?.object;
    scene.frame([object,...(sourceObject?[sourceObject]:[])]);
    const entry=scene.objects().find(entry=>entry.object===object);if(entry)scene.select(entry.id);scene.dirty();
    const operations={
      view({mode}={}){if(!['beauty','char','heat'].includes(mode))throw Error('Invalid material view');host.inspection?.(mode!=='beauty');for(const binding of bindings)binding.setView(mode);view=mode;scene.dirty();emit('view',read(),{mode});updateUI();return read();},
      run(){assertActive();setSource(true);burner=true;running=true;paused=false;runtime.setSimulationPaused(false);phase='heating';emit('run',read());updateUI();return read();},
      burnerOff(){if(disposed)throw Error('Live log experiment disposed');setSource(false);burner=false;phase=running?'cooling':'cold';emit('burner-off',read());updateUI();return read();},
      fuelFeed({enabled}={}){assertActive();gasSource.setEnabled(enabled);emit('fuel-feed',read(),{enabled});updateUI();return read();},
      pause(){assertActive();paused=!paused;runtime.setSimulationPaused(paused);emit('pause',read());updateUI();return read();},
      reset(){assertActive();runtime.setSimulationPaused(true);setSource(false);for(const field of fields)field.reset();
        gasSource.setEnabled(true);gasSource.reset();motion?.reset();
        for(const item of debris)item.reset();
        const fluid=runtime.resetThermalExperimentFluid();elapsed=0;for(const binding of bindings)binding.update(0);burner=false;running=false;paused=true;phase='cold';attempt=crypto.randomUUID();emit('reset',{...read(),reset:fluid});updateUI();scene.dirty();return read();},
      move({position,rotation}={}){assertActive();for(const values of [position,rotation])if(values&&(!Array.isArray(values)||values.length!==3||!values.every(Number.isFinite)))throw Error('Log pose requires finite XYZ');
        if(scene.setTransform)scene.setTransform(scene.objects().find(entry=>entry.object===object).id,{...(position?{position}:{}),...(rotation?{rotation}:{})});
        else {if(position)object.position.fromArray(position);if(rotation)object.rotation.set(...rotation);}
        object.updateWorldMatrix(true,true);scene.dirty();emit('move',read(),{position,rotation});return read();},
      frame(){assertActive();scene.frame([object]);return read();},
      async snapshot(){if(!paused)throw Error('Pause before material/debris diagnosis');return Promise.all(debris.map(item=>item.snapshot()));},
      flameView({visible}={}){if(disposed)throw Error('Live log experiment disposed');if(typeof visible!=='boolean')throw Error('Flame view requires a boolean');flameVisible=visible;if(fire)fire.setVisible(visible);else if(canvas)canvas.style.opacity=visible?'1':'0';emit('flame-view',read(),{visible});return read();},
      selectFire(){if(!fire)throw Error('No scene fire fixture');return fire.select();},
      basins(){if(!fire)throw Error('No scene fire fixture');return fire.showLibrary();},
      async reconnectFire(){if(disposed)throw Error('Live log experiment disposed');if(!fire)throw Error('No scene fire fixture');runtime.setSimulationPaused(true);paused=true;running=false;await fire.reacquire();burner=false;phase=fields.some(field=>field.read().steps>0)?'cooling':'cold';updateUI();return read();},
    };
    return {read,operations,
      mount({document,container,root,invoke}){
        container??=root;
        const panel=document.createElement('section');panel.id='live-log-heat';panel.className='panel';
        panel.innerHTML='<h3>Log combustion</h3><p role="status">Cold · paused</p><div class="burn-table-actions"><button type="button" data-action="run">Run</button><button type="button" data-action="burnerOff">Burner off</button><button type="button" data-action="pause">Pause</button><button type="button" data-action="reset">Reset</button><button type="button" data-action="frame">Frame log</button><button type="button" data-action="selectFire">Select fire</button><button type="button" data-action="reconnectFire" hidden>Reconnect fire</button></div><label><input type="checkbox" name="wood-fuel-feed" checked>Wood fuel feed</label><fieldset class="burn-view"><legend>Surface</legend><label><input type="radio" name="burn-view" value="beauty" checked>Material</label><label><input type="radio" name="burn-view" value="char">Char</label><label><input type="radio" name="burn-view" value="heat">Heat</label></fieldset>';
        container.prepend(panel);
        mounted={panel,status:panel.querySelector('[role=status]'),run:panel.querySelector('[data-action=run]'),pause:panel.querySelector('[data-action=pause]'),reconnect:panel.querySelector('[data-action=reconnectFire]')};
        for(const button of panel.querySelectorAll('[data-action]'))button.onclick=()=>void invoke(button.dataset.action).then(updateUI).catch(error=>{mounted.status.textContent=error.message;console.error('Live log operation:',error);});
        panel.querySelectorAll('[name=burn-view]').forEach(input=>input.onchange=()=>invoke('view',{mode:input.value}));
        const feed=panel.querySelector('[name=wood-fuel-feed]');if(feed)feed.onchange=()=>invoke('fuelFeed',{enabled:feed.checked});
        updateUI();return {dispose:()=>panel.remove()};
      },
      dispose(){if(disposed)return;disposed=true;const errors=[];let stopped;
        const clean=action=>{try{action();}catch(error){errors.push(error);}};
        clean(()=>host.inspection?.(false));clean(()=>unsubscribeFire?.());clean(()=>detach?.());clean(()=>releaseFollowing?.());clean(()=>motion?.dispose());clean(()=>indicator?.dispose());clean(()=>runtime.setSimulationPaused(true));
        if(!fire)clean(()=>setSource(false));
        clean(()=>{stopped=runtime.setActive(false);});clean(()=>mounted?.panel.remove());
        for(const {mesh,original} of restores)clean(()=>{mesh.material=original;});
        for(const item of debris)clean(()=>item.dispose());for(const binding of bindings)clean(()=>binding.dispose());for(const field of fields)clean(()=>field.dispose());clean(()=>gasSource?.dispose());
        clean(()=>{if(fire)fire.dispose();else if(canvas)canvas.style.opacity=originalOpacity;});
        if(object)object.visible=false;clean(()=>scene.dirty());
        return Promise.resolve(stopped).catch(error=>errors.push(error)).then(()=>{if(errors.length)throw new AggregateError(errors,'Live log cleanup failed');});},
    };
  }catch(error){detach?.();releaseFollowing?.();motion?.dispose();indicator?.dispose();for(const {mesh,original} of restores)mesh.material=original;for(const item of debris)item.dispose();for(const binding of bindings)binding.dispose();for(const field of fields)field.dispose();gasSource?.dispose();runtime.setSimulationPaused(true);runtime.setActive(false);if(fire)fire.dispose();else if(canvas)canvas.style.opacity=originalOpacity;if(object)object.visible=false;throw error;}
}
