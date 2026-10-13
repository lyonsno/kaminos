import * as THREE from './lib/three.webgpu.js';
import {BURN_TABLE_ASSET} from './burn-table-core.mjs';
import {createBurnMaterial} from './burn-table-material.mjs';
import {createLiveLogHeatGpu} from './live-log-heat-gpu.mjs';
import {LIVE_LOG_HEAT_IDENTITY} from './live-log-heat-core.mjs';

export async function createLiveLogExperiment({host,inputs={},record}) {
  const {scene,volume}=host;
  await Promise.all([scene.ready,volume.ready]);
  const runtime=volume.get(),renderer=scene.renderer();
  runtime.setSimulationPaused(true);volume.burner(false);
  const context=await runtime.borrowThermalGpuContext();
  if(context.device!==renderer.backend.device)throw Error('Live log and scene must share the fluid GPU device');
  if(![32,48].includes(context.dimensions[0]))throw Error('Live log experiment requires the agreed 32/48 basin');
  const source=`/api/read?root=${BURN_TABLE_ASSET.root}&path=${encodeURIComponent(BURN_TABLE_ASSET.path)}`;
  let disposed=false,object=null,detach=null,mounted=null,phase='loading',running=false,burner=false,paused=true;
  const fields=[],bindings=[],restores=[];let elapsed=0,attempt=crypto.randomUUID();
  const membership=()=>object&&scene.objects().some(entry=>entry.object===object);
  function assertActive(){if(disposed)throw Error('Live log experiment disposed');if(!membership())throw Error('Live log removed from scene');}
  const read=()=>({identity:LIVE_LOG_HEAT_IDENTITY,status:disposed?'disposed':!membership()?'unavailable':phase,
    running,burner,paused,attempt,asset:BURN_TABLE_ASSET,source,objectId:scene.objects().find(entry=>entry.object===object)?.id||null,
    physicalWoodCalibration:false,selfEmission:false,fields:fields.map(field=>field.read()),materials:bindings.map(binding=>binding.read()),
    fluid:{backend:runtime.debugState().backend,active:runtime.debugState().active,simStepCount:runtime.debugState().simStepCount,grid:runtime.debugState().simGrid},
    position:object?.position.toArray(),rotation:object?.rotation.toArray()});
  const emit=(name,effective,requested={})=>record({kind:'sinter.live-log.'+name,target:scene.objects().find(entry=>entry.object===object)?.id||'live-log',phase:'applied',requested,effective:{...effective,attempt}});
  const updateUI=()=>{if(!mounted)return;const state=read();mounted.status.textContent=state.status==='cold'?'Cold · heat off':state.status==='unavailable'?'Log removed':`${burner?'Heating':'Cooling'}${paused?' · paused':''}`;mounted.run.disabled=disposed||!membership();mounted.pause.disabled=!running;mounted.pause.textContent=paused?'Resume':'Pause';mounted.off.disabled=!burner;};
  try {
    object=await scene.load(source,{clear:false,arrival:'append',isCurrent:()=>!disposed,metadata:{label:'Live log / local heat',fileName:BURN_TABLE_ASSET.path}});
    object.position.set(.5,-.35,0);object.rotation.set(0,Math.PI/2,0);object.scale.multiplyScalar(.55);
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
      if(disposed||!membership()){running=false;runtime.setSimulationPaused(true);phase='unavailable';updateUI();return;}
      for(const field of fields)field.encode(encoder,frame);elapsed+=frame.dt;for(const binding of bindings)binding.update(elapsed);
      scene.dirty();
    },read:()=>({identity:LIVE_LOG_HEAT_IDENTITY,attempt,fields:fields.map(field=>field.read())})};
    detach=runtime.bindGpuThermalConsumer(consumer);
    runtime.resetThermalExperimentFluid();await runtime.setActive(true);
    phase='cold';scene.enterWorkbench();scene.frame([object]);
    const entry=scene.objects().find(entry=>entry.object===object);if(entry)scene.select(entry.id);scene.dirty();
    const operations={
      run(){assertActive();volume.burner(true);burner=true;running=true;paused=false;runtime.setSimulationPaused(false);phase='heating';emit('run',read());updateUI();return read();},
      burnerOff(){assertActive();volume.burner(false);burner=false;phase=running?'cooling':'cold';emit('burner-off',read());updateUI();return read();},
      pause(){assertActive();paused=!paused;runtime.setSimulationPaused(paused);emit('pause',read());updateUI();return read();},
      reset(){assertActive();runtime.setSimulationPaused(true);volume.burner(false);for(const field of fields)field.reset();
        const fluid=runtime.resetThermalExperimentFluid();elapsed=0;for(const binding of bindings)binding.update(0);burner=false;running=false;paused=true;phase='cold';attempt=crypto.randomUUID();emit('reset',{...read(),reset:fluid});updateUI();scene.dirty();return read();},
      move({position,rotation}={}){assertActive();for(const values of [position,rotation])if(values&&(!Array.isArray(values)||values.length!==3||!values.every(Number.isFinite)))throw Error('Log pose requires finite XYZ');
        if(position)object.position.fromArray(position);if(rotation)object.rotation.set(...rotation);object.updateWorldMatrix(true,true);scene.dirty();emit('move',read(),{position,rotation});return read();},
      frame(){assertActive();scene.frame([object]);return read();},
    };
    return {read,operations,
      mount({document,container,invoke}){
        const panel=document.createElement('section');panel.id='live-log-heat';panel.className='panel';
        panel.innerHTML='<h3>Live log</h3><p role="status">Cold · heat off</p><div class="burn-table-actions"><button type="button" data-action="run">Heat log</button><button type="button" data-action="burnerOff">Heat off</button><button type="button" data-action="pause">Pause</button><button type="button" data-action="reset">Reset</button><button type="button" data-action="frame">Frame log</button></div><label>Contact position <input data-position="x" type="range" min="-1.5" max="1.5" step="0.01" value="0.5"></label><details><summary>State</summary><pre></pre></details>';
        container.prepend(panel);
        mounted={panel,status:panel.querySelector('[role=status]'),run:panel.querySelector('[data-action=run]'),off:panel.querySelector('[data-action=burnerOff]'),pause:panel.querySelector('[data-action=pause]')};
        for(const button of panel.querySelectorAll('[data-action]'))button.onclick=()=>void invoke(button.dataset.action).then(()=>{panel.querySelector('pre').textContent=JSON.stringify(read(),null,2);}).catch(error=>{mounted.status.textContent=error.message;console.error('Live log operation:',error);});
        const x=panel.querySelector('[data-position=x]');x.oninput=()=>void invoke('move',{position:[Number(x.value),object.position.y,object.position.z]}).catch(console.error);
        updateUI();return {dispose:()=>panel.remove()};
      },
      dispose(){if(disposed)return;disposed=true;detach?.();runtime.setSimulationPaused(true);volume.burner(false);runtime.setActive(false);
        mounted?.panel.remove();for(const {mesh,original} of restores)mesh.material=original;for(const binding of bindings)binding.dispose();for(const field of fields)field.dispose();
        if(object)object.visible=false;scene.dirty();},
    };
  }catch(error){detach?.();for(const {mesh,original} of restores)mesh.material=original;for(const binding of bindings)binding.dispose();for(const field of fields)field.dispose();runtime.setSimulationPaused(true);runtime.setActive(false);if(object)object.visible=false;throw error;}
}
