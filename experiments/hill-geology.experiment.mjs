import * as THREE from '../lib/three.core.js';
import {createTerrainGPU} from './hill-terrain/gpu.mjs';
import {formationConfig,encodeFormation} from './hill-terrain/formation.mjs';
import {requestFormation} from './hill-terrain/formation-cache.mjs';
import {registerExportGeometrySnapshot} from '../scene-export-geometry.mjs';
export default {
 id:'hill-geology',title:'Hill · formed landscape',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  let config=formationConfig(inputs),formed=null,error=null,pending=null,job=null,epoch=0,disposed=false,playing=false,remainder=0,sync=()=>{};
  const n=config.resolution,geometry=new THREE.BufferGeometry(),indices=new Uint32Array((n-1)**2*6);
  for(let z=0,k=0;z<n-1;z++)for(let x=0;x<n-1;x++){const a=z*n+x;indices.set([a,a+n,a+1,a+1,a+n,a+n+1],k);k+=6;}
  geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.boundingBox=new THREE.Box3(new THREE.Vector3(-config.width/2,-2,-config.length/2),new THREE.Vector3(config.width/2,config.relief+1,config.length/2));geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const gpu=createTerrainGPU(geometry,{resolution:n,width:config.width,length:config.length,uplift:0,repose:34,transport:1.6});
  const root=new THREE.Group();root.name='Hill · formed rock and earth';
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.name='Weathered hillside';mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.userData.kaminosDynamicGeometry=true;root.add(mesh);mesh.visible=false;
  registerExportGeometrySnapshot(mesh,()=>{throw Error('GPU terrain export requires an explicit frozen snapshot; formation cache preserves the initial landscape');});
  const session=await host.scene.open();let asset,unsubscribe;
  const frame=()=>session.setView(inputs.view??{position:[11,9,14],target:[0,1.2,0],fov:43});
  const read=()=>({route:'kaminos/hill/geological-formation-v1',config:{...config},formation:formed?{version:formed.version,config:formed.config,steps:formed.steps,metrics:formed.metrics,cache:formed.cache,bytes:formed.bytes,warning:formed.warning}:null,pending,error,playing,gpu:gpu.read(),objectId:asset?.id,view:session.readView(),presentation:{materialType:mesh.material.type,vertexColors:mesh.material.vertexColors,rootMatrix:Array.from(root.matrixWorld.elements)},preparationBackend:'cpu-worker-or-cache; no live geological solver',runtimeReadback:false});
  const regenerate=async(patch={})=>{
   const next=formationConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require reopening the experiment');
   job?.cancel();const own=++epoch;config=next;playing=false;pending={step:0,total:config.iterations};error=null;sync();updateInputs({...config});
   job=requestFormation(config,{onProgress:p=>{if(own===epoch){pending=p;sync();}}});
   try{const value=await job.promise;if(disposed||own!==epoch)return read();gpu.loadFormation(value);formed=value;pending=null;remainder=0;mesh.visible=true;error=null;session.redraw();sync();record({kind:'hill-geology.formation',effective:read()});return read();}
   catch(e){if(disposed||own!==epoch)return read();pending=null;error=e.message;sync();throw e;}
  };
  mesh.onBeforeRender=renderer=>{if(disposed||error||!formed)return;try{gpu.flush(renderer);}catch(e){error=e.message;playing=false;sync();}};
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:{route:'kaminos/hill/geological-formation-v1'}}});frame();
   unsubscribe=session.onFrame(({deltaSeconds})=>{if(!playing||!formed||pending||error||disposed)return;if(!Number.isFinite(deltaSeconds)||deltaSeconds<0){error='Invalid host frame time';playing=false;sync();return;}remainder+=deltaSeconds;const ticks=Math.floor((remainder+1e-10)/.05);if(ticks){gpu.advance(ticks);remainder=Math.max(0,remainder-ticks*.05);}gpu.present(Math.min(1,remainder/.05));session.redraw();});
   await regenerate();
  }catch(e){job?.cancel();unsubscribe?.();gpu.dispose();await session.dispose();throw e;}
  const diagnostic={read,snapshot:options=>gpu.snapshot(options),gpu:()=>{root.updateWorldMatrix(true,false);return{...gpu.surface(),localToWorld:Array.from(root.matrixWorld.elements)};}};
  if(globalThis.window)window.kaminosHillGeology=diagnostic;
  return{read,operations:{regenerate,frame,play(value){if(typeof value!=='boolean')throw Error('Boolean playback required');if(pending||error||!formed)throw Error('Landscape is not available');playing=value;sync();record({kind:'hill-geology.play',value});return read();},setInfluence(patch){gpu.configure(patch);sync();return read();},advance(count=1){if(pending||error)throw Error('Landscape is not available');gpu.advance(count);gpu.present(1);session.redraw();return read();},recipe:()=>({schema:'kaminos.hill-geology.recipe.v1',inputs:config}),cache:()=>encodeFormation(formed)},
  mount({root:panel,document,invoke}){
   const intro=document.createElement('p');intro.textContent='Layered rock, cut by drainage. Weathering supplies loose earth; slopes and streams move it into deposits. Formation is saved separately from play.';panel.append(intro);
   const status=document.createElement('p'),fields=new Map();let timer,draft={};
   for(const [key,title,step]of [['seed','Landscape seed',1],['iterations','Formation age · steps',20],['relief','Initial relief',.1],['tilt','Rock-bed tilt',.02],['bedThickness','Rock-bed thickness',.02],['hardness','Bed resistance contrast',.2],['channelArea','Channel source area',.02],['incision','Stream incision',.005],['weathering','Weathering rate',.0005]]){
    const line=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=title+' ';input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label',title);fields.set(key,input);line.append(grip,input);panel.append(line);host.controls.installNumberDrag({input,grip,step});
    input.addEventListener('input',()=>{if(!input.value.trim()||!Number.isFinite(Number(input.value)))return;draft[key]=Number(input.value);clearTimeout(timer);status.textContent='Formation settings changed…';timer=setTimeout(()=>{const patch=draft;draft={};invoke('regenerate',patch).catch(e=>{status.textContent=e.message;});},350);});
   }
   const frameButton=document.createElement('button');frameButton.textContent='Frame landscape';frameButton.onclick=()=>invoke('frame');panel.append(frameButton);
   const play=document.createElement('button');play.onclick=()=>invoke('play',!playing);panel.append(play);
   const note=document.createElement('p');note.textContent='Idle terrain keeps its shape. Run settling to redistribute the loose cover. Formation settings rebuild the starting landscape; previous results remain visible while it forms.';panel.append(note,status);
   sync=()=>{for(const [key,input]of fields)if(document.activeElement!==input||input.readOnly)input.value=String(config[key]);play.textContent=playing?'Pause settling':'Run settling';play.disabled=Boolean(pending||error);status.textContent=error??(pending?'Forming landscape · '+pending.step+' / '+pending.total:(formed?'Landscape stored · '+Math.round(formed.bytes/1024)+' KiB · '+formed.cache+(formed.warning?' · '+formed.warning:''):''));};sync();this._cleanup=()=>clearTimeout(timer);
  },
  async dispose(){if(disposed)return;disposed=true;epoch++;job?.cancel();this._cleanup?.();unsubscribe?.();sync=()=>{};gpu.dispose();await session.dispose();if(globalThis.window?.kaminosHillGeology===diagnostic)delete window.kaminosHillGeology;}
  };
 }
};
