import * as THREE from './lib/three.webgpu.js';
import {BURN_TABLE_ASSET} from './burn-table-core.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';
import {createLiveLogHeatGpu} from './live-log-heat-gpu.mjs';
import {LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';

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
  let disposed=false,object=null,detach=null,unsubscribeFire=null,mounted=null,phase='loading',running=false,burner=false,paused=true,flameVisible=fire?.read().visible??false;
  const canvas=runtime.canvasElement?.();const originalOpacity=canvas?.style.opacity;
  if(canvas&&!fire)canvas.style.opacity='0';
  const fields=[],bindings=[],restores=[];let elapsed=0,attempt=crypto.randomUUID();
  const membership=()=>object&&scene.objects().some(entry=>entry.object===object);
  const fireAvailable=()=>!fire||(fire.availability?fire.availability():fire.read()).status==='mounted';
  function assertActive(){if(disposed)throw Error('Live log experiment disposed');if(!membership())throw Error('Live log removed from scene');if(!fireAvailable())throw Error('Fire source removed or replaced; reconnect fire');}
  const read=()=>({identity:LIVE_LOG_HEAT_IDENTITY,status:disposed?'disposed':!membership()||!fireAvailable()?'unavailable':phase,
    unavailableReason:!membership()?'log':!fireAvailable()?'fire':null,
    running,burner:fire?fire.read().enabled:burner,paused,flameVisible:fire?.read().visible??flameVisible,fire:fire?.read()??null,attempt,asset:BURN_TABLE_ASSET,source,objectId:scene.objects().find(entry=>entry.object===object)?.id||null,
    physicalWoodCalibration:false,selfEmission:false,fields:fields.map(field=>field.read()),materials:bindings.map(binding=>binding.read()),
    fluid:{backend:runtime.debugState().backend,active:runtime.debugState().active,simStepCount:runtime.debugState().simStepCount,grid:runtime.debugState().simGrid},
    position:object?.position.toArray(),rotation:object?.rotation.toArray()});
  const emit=(name,effective,requested={})=>record({kind:'sinter.live-log.'+name,target:scene.objects().find(entry=>entry.object===object)?.id||'live-log',phase:'applied',requested,effective:{...effective,attempt}});
  const updateUI=()=>{if(!mounted)return;const state=read();mounted.status.textContent=state.status==='cold'?'Cold · paused':state.status==='unavailable'?state.unavailableReason==='fire'?'Fire source removed or replaced':'Log removed':`${state.burner?'Heating':'Cooling'}${paused?' · paused':''}`;mounted.run.disabled=disposed||!membership()||!fireAvailable();mounted.reconnect.hidden=state.unavailableReason!=='fire';mounted.pause.disabled=!running;mounted.pause.textContent=paused?'Resume':'Pause';};
  try {
    object=await scene.load(source,{clear:false,arrival:'append',isCurrent:()=>!disposed,metadata:{label:'Live log / local heat',fileName:BURN_TABLE_ASSET.path}});
    object.position.fromArray(inputs.position??(fire?[2.5,-.35,0]:[.5,-.35,0]));object.rotation.set(0,Math.PI/2,0);object.scale.multiplyScalar(.55);
    object.updateWorldMatrix(true,true);
    const meshes=[];object.traverse(child=>{if(child.isMesh)meshes.push(child);});
    if(!meshes.length)throw Error('Live log asset has no mesh');
    for(const mesh of meshes){
      mesh.geometry.computeBoundingBox();const bounds=mesh.geometry.boundingBox;
      const field=await createLiveLogHeatGpu({renderer,mesh,bounds});fields.push(field);
      const original=mesh.material;const originals=Array.isArray(original)?original:[original];
      const converted=originals.map(material=>{const binding=createBurnMaterial({renderer,original:material,bounds,settings:{heat:0,char:0,reaction:0},stateNode:field.stateNode,stateIdentity:LIVE_LOG_HEAT_IDENTITY});bindings.push(binding);return binding.material;});
      restores.push({mesh,original});mesh.material=Array.isArray(original)?converted:converted[0];
    }
    const consumer={device:context.device,encode(encoder,frame){
      if(disposed||!membership()||!fireAvailable()){running=false;paused=true;runtime.setSimulationPaused(true);phase='unavailable';updateUI();return;}
      for(const field of fields)field.encode(encoder,frame);elapsed+=frame.dt;for(const binding of bindings)binding.update(elapsed);
      scene.dirty();
    },read:()=>({identity:LIVE_LOG_HEAT_IDENTITY,attempt,fields:fields.map(field=>field.read())})};
    detach=runtime.bindGpuThermalConsumer(consumer);
    runtime.resetThermalExperimentFluid();await runtime.setActive(true);
    phase='cold';scene.enterWorkbench();
    unsubscribeFire=fire?.subscribe?.(updateUI);
    const sourceObject=fire&&scene.objects().find(entry=>entry.id===fire.read().objectId)?.object;
    scene.frame([object,...(sourceObject?[sourceObject]:[])]);
    const entry=scene.objects().find(entry=>entry.object===object);if(entry)scene.select(entry.id);scene.dirty();
    const operations={
      run(){assertActive();setSource(true);burner=true;running=true;paused=false;runtime.setSimulationPaused(false);phase='heating';emit('run',read());updateUI();return read();},
      burnerOff(){if(disposed)throw Error('Live log experiment disposed');setSource(false);burner=false;phase=running?'cooling':'cold';emit('burner-off',read());updateUI();return read();},
      pause(){assertActive();paused=!paused;runtime.setSimulationPaused(paused);emit('pause',read());updateUI();return read();},
      reset(){assertActive();runtime.setSimulationPaused(true);setSource(false);for(const field of fields)field.reset();
        const fluid=runtime.resetThermalExperimentFluid();elapsed=0;for(const binding of bindings)binding.update(0);burner=false;running=false;paused=true;phase='cold';attempt=crypto.randomUUID();emit('reset',{...read(),reset:fluid});updateUI();scene.dirty();return read();},
      move({position,rotation}={}){assertActive();for(const values of [position,rotation])if(values&&(!Array.isArray(values)||values.length!==3||!values.every(Number.isFinite)))throw Error('Log pose requires finite XYZ');
        if(scene.setTransform)scene.setTransform(scene.objects().find(entry=>entry.object===object).id,{...(position?{position}:{}),...(rotation?{rotation}:{})});
        else {if(position)object.position.fromArray(position);if(rotation)object.rotation.set(...rotation);}
        object.updateWorldMatrix(true,true);scene.dirty();emit('move',read(),{position,rotation});return read();},
      frame(){assertActive();scene.frame([object]);return read();},
      flameView({visible}={}){if(disposed)throw Error('Live log experiment disposed');if(typeof visible!=='boolean')throw Error('Flame view requires a boolean');flameVisible=visible;if(fire)fire.setVisible(visible);else if(canvas)canvas.style.opacity=visible?'1':'0';emit('flame-view',read(),{visible});return read();},
      selectFire(){if(!fire)throw Error('No scene fire fixture');return fire.select();},
      basins(){if(!fire)throw Error('No scene fire fixture');return fire.showLibrary();},
      reconnectFire(){if(disposed)throw Error('Live log experiment disposed');if(!fire)throw Error('No scene fire fixture');fire.reacquire();phase=fields.some(field=>field.read().steps>0)?'cooling':'cold';updateUI();return read();},
    };
    return {read,operations,
      mount({document,container,invoke}){
        const panel=document.createElement('section');panel.id='live-log-heat';panel.className='panel';
        panel.innerHTML='<h3>Burning log</h3><p role="status">Cold · paused</p><div class="burn-table-actions"><button type="button" data-action="run">Run</button><button type="button" data-action="pause">Pause</button><button type="button" data-action="reset">Reset</button><button type="button" data-action="frame">Frame log</button><button type="button" data-action="selectFire">Select fire</button><button type="button" data-action="basins">Basin library</button><button type="button" data-action="reconnectFire" hidden>Reconnect fire</button></div>';
        container.prepend(panel);
        mounted={panel,status:panel.querySelector('[role=status]'),run:panel.querySelector('[data-action=run]'),pause:panel.querySelector('[data-action=pause]'),reconnect:panel.querySelector('[data-action=reconnectFire]')};
        for(const button of panel.querySelectorAll('[data-action]'))button.onclick=()=>void invoke(button.dataset.action).then(updateUI).catch(error=>{mounted.status.textContent=error.message;console.error('Live log operation:',error);});
        updateUI();return {dispose:()=>panel.remove()};
      },
      dispose(){if(disposed)return;disposed=true;const errors=[];let stopped;
        const clean=action=>{try{action();}catch(error){errors.push(error);}};
        clean(()=>unsubscribeFire?.());clean(()=>detach?.());clean(()=>runtime.setSimulationPaused(true));
        if(!fire)clean(()=>setSource(false));
        clean(()=>{stopped=runtime.setActive(false);});clean(()=>mounted?.panel.remove());
        for(const {mesh,original} of restores)clean(()=>{mesh.material=original;});
        for(const binding of bindings)clean(()=>binding.dispose());for(const field of fields)clean(()=>field.dispose());
        clean(()=>{if(fire)fire.dispose();else if(canvas)canvas.style.opacity=originalOpacity;});
        if(object)object.visible=false;clean(()=>scene.dirty());
        return Promise.resolve(stopped).catch(error=>errors.push(error)).then(()=>{if(errors.length)throw new AggregateError(errors,'Live log cleanup failed');});},
    };
  }catch(error){detach?.();for(const {mesh,original} of restores)mesh.material=original;for(const binding of bindings)binding.dispose();for(const field of fields)field.dispose();runtime.setSimulationPaused(true);runtime.setActive(false);if(fire)fire.dispose();else if(canvas)canvas.style.opacity=originalOpacity;if(object)object.visible=false;throw error;}
}
