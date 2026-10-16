import * as THREE from '../../lib/three.webgpu.js';
import {FUSE_SAMPLES,FUSE_IDENTITY} from '../../fuse-core.mjs';
import {createFuseGpu} from '../../fuse-gpu.mjs';
import {createLogGasSourceGpu} from '../../live-log-gas-source.mjs';
import {createLogBurnIndicator} from '../../live-log-indicator.mjs';

export default {id:'curved-fuse',title:'Curved fuse propagation',async create({host,inputs={},record}){
  const session=await host.scene.open();let field,gas,detach,indicator,asset,panel,disposed=false;
  let paused=true,lighter=false,started=false,flameVisible=true;
  const runtime=()=>host.volume.get();
  try{
    await host.volume.ready;
    const settings=host.fire.settings();if(!settings.source?.presetId)throw Error('Fuse requires an explicitly mounted saved basin');
    await host.fire.add(settings.source.presetId);runtime().setSimulationPaused(true);host.fire.setEnabled(false);
    host.rendering.gi({mode:'combined',steps:4,slices:3});
    const state=runtime().debugState();if(state.simGrid!==32||state.gridHeight.heightCells!==32)throw Error('Fuse preview requires32cubed');
    for(const [id,value] of [['volume-steps',28],['volume-immersed-radius',.1]])if(Number(host.fire.settings().domControls[id]?.value)!==value)throw Error('Fuse preview setting mismatch: '+id);
    const renderer=host.scene.renderer(),context=await runtime().borrowThermalGpuContext();
    const path=inputs.points??[[0,0,0],[.3,0,0],[.5,0,.23],[.8,0,.25]];
    if(!Array.isArray(path)||path.length<2||!path.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Fuse path requires finite XYZ points');
    const curve=new THREE.CatmullRomCurve3(path.map(p=>new THREE.Vector3(...p)));
    const radius=inputs.radius??.025;
    if(!Number.isFinite(radius)||radius<=0)throw Error('Fuse radius must be positive');
    const geometry=new THREE.TubeGeometry(curve,FUSE_SAMPLES-1,radius,10,false);
    const material=new THREE.MeshStandardNodeMaterial({roughness:.82,metalness:0});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='Curved fuse';mesh.position.fromArray(inputs.position??[0,-.35,0]);
    asset=await session.attach(mesh,{owned:true,metadata:{type:'mesh',label:'Curved fuse',source:FUSE_IDENTITY,collision:{enabled:true,domainId:'flame-field'}}});
    host.scene.refreshPresentation(asset);globalThis.kaminosSceneCollision.set(true);
    field=await createFuseGpu({renderer,mesh,points:curve.getSpacedPoints(FUSE_SAMPLES-1),length:curve.getLength(),radius});
    const T=THREE.TSL,s=field.stateNode;
    const braid=T.sin(T.uv().x.mul(550).add(T.uv().y.mul(38))).mul(.5).add(.5);
    const virgin=T.vec3(.12,.085,.035).mul(braid.mul(.2).add(.8));
    material.colorNode=T.mix(virgin,T.vec3(.008,.009,.008),T.smoothstep(.02,.5,s.y));
    material.roughnessNode=T.mix(T.float(.82),T.float(.95),s.y.clamp(0,1));
    material.emissiveNode=T.vec3(1,.12,.008).mul(s.x.sub(.5).max(0).mul(s.z.clamp(0,1).mul(3).add(.15)));
    indicator=createLogBurnIndicator({object:mesh,fields:[field],document:host.controls.document});
    gas=await createLogGasSourceGpu(context);
    const exists=()=>host.scene.objects().some(r=>r.object===mesh);
    const assertActive=()=>{if(disposed||!exists())throw Error('Fuse removed or disposed');if(!host.fire.read().authoredPresent)throw Error('Lighter source removed');};
    const read=()=>({identity:FUSE_IDENTITY,status:disposed?'disposed':!exists()?'unavailable':!started?'cold':paused?'paused':'live',paused,lighter,
      attempt,objectId:asset.id,basin:settings.source,field:field.read(),gas:gas.read(),flameVisible,
      recipe:{points:curve.points.map(p=>p.toArray()),radius,position:mesh.position.toArray()},fluid:{grid:runtime().debugState().simGrid,backend:runtime().debugState().backend,step:runtime().debugState().simStepCount}});
    let attempt=crypto.randomUUID();
    const emit=(name,args={})=>record({kind:'sinter.fuse.'+name,target:asset.id,phase:'applied',requested:args,effective:read()});
    const update=()=>{if(!panel)return;panel.querySelector('[role=status]').textContent=!started?'Cold · paused':paused?'Paused':lighter?'Lighter on':'Lighter off';panel.querySelector('[data-action=pause]').textContent=paused?'Resume':'Pause';};
    detach=runtime().bindGpuThermalConsumer({device:context.device,gasSource:gas.descriptor,
      prepareSource(encoder,frame){gas.begin(encoder);if(!disposed&&exists())field.encodeGasSource(encoder,frame,gas);gas.resolve(encoder);},
      encode(encoder,frame){if(disposed||!exists()){runtime().setSimulationPaused(true);return;}field.encode(encoder,frame);session.redraw();},read});
    runtime().resetThermalExperimentFluid();await runtime().setActive(true);host.scene.enterWorkbench();host.scene.select(asset.id);host.scene.frame([mesh]);session.redraw();
    const operations={
      run(){assertActive();lighter=true;started=true;paused=false;host.fire.setEnabled(true);runtime().setSimulationPaused(false);emit('run');update();return read();},
      lighterOff(){assertActive();lighter=false;host.fire.setEnabled(false);emit('lighter-off');update();return read();},
      pause(){assertActive();paused=!paused;runtime().setSimulationPaused(paused);emit('pause');update();return read();},
      reset(){assertActive();runtime().setSimulationPaused(true);host.fire.setEnabled(false);lighter=false;started=false;paused=true;field.reset();gas.reset();runtime().resetThermalExperimentFluid();attempt=crypto.randomUUID();emit('reset');update();session.redraw();return read();},
      move({position}={}){assertActive();if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Fuse position requires finite XYZ');host.scene.setTransform(asset.id,{position});emit('move',{position});return read();},
      frame(){assertActive();host.scene.frame([mesh]);return read();},
      flameView({visible}={}){assertActive();if(typeof visible!=='boolean')throw Error('Flame visibility requires boolean');flameVisible=visible;host.fire.setVisible(visible);emit('flame-view',{visible});return read();},
      async sample(){assertActive();return {state:read(),cells:await field.sample()};},
    };
    return {read,operations,mount({document,root,invoke}){
      panel=document.createElement('section');panel.className='panel';panel.id='curved-fuse';
      panel.innerHTML='<h3>Curved fuse</h3><p role="status">Cold · paused</p><div class="burn-table-actions"><button data-action="run">Lighter on</button><button data-action="lighterOff">Lighter off</button><button data-action="pause">Resume</button><button data-action="reset">Reset</button><button data-action="frame">Frame fuse</button></div><label><input type="checkbox" name="show-flame" checked>Visible flame</label>';
      root.prepend(panel);for(const b of panel.querySelectorAll('[data-action]'))b.onclick=()=>void invoke(b.dataset.action).catch(e=>{panel.querySelector('[role=status]').textContent=e.message;});
      panel.querySelector('[name=show-flame]').onchange=e=>invoke('flameView',{visible:e.target.checked});update();return {dispose:()=>panel?.remove()};
    },async dispose(){if(disposed)return;disposed=true;detach?.();indicator?.dispose();panel?.remove();runtime().setSimulationPaused(true);host.fire.setEnabled(false);await runtime().setActive(false);field.dispose();gas.dispose();await session.dispose();}};
  }catch(error){detach?.();indicator?.dispose();field?.dispose();gas?.dispose();panel?.remove();await session.dispose();throw error;}
}};
