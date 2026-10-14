import * as THREE from '../../lib/three.core.js';
import {loadFullBodySkin} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {givenSourceSoleHeight} from './given-motion-source.mjs';

export async function createCreatureBinding({host,inputs={},record=()=>{}},{loadSkin=loadFullBodySkin}={}) {
 if(!host?.scene?.open||!host.controls?.document)throw Error('Creature binding requires the shared Workbench');
 const data=await loadSkin(inputs),document=host.controls.document;
 let session,runtime,asset,stop,closed=false,preset='rest',expected='',refresh=()=>{},restoreGround=()=>{};
 const matrices=()=>[...runtime.bones.values()].map(b=>{b.updateMatrix();return b.matrix.elements.join(',');}).join(';');
 const read=()=>({source:structuredClone(data.source),host:{id:asset.id,route:'shared-owner-scene'},skin:runtime.read(),preset,
  editedSincePreset:matrices()!==expected,view:session.readView(),scope:'automatic bind and editable poses; not generated motion'});
 const dispose=async()=>{if(closed)return;closed=true;stop?.();restoreGround();if(session)await session.dispose();else runtime?.dispose();};
 try {
  session=await host.scene.open();runtime=createFullBodyRuntime({THREE,...data});
  asset=await session.attach(runtime.group,{owned:true,metadata:{fileName:'Creature · attachment candidate',source:inputs.case,label:'Automatic bind · not generated motion'}});
  if(inputs.ground==='source-start') {
   const height=document.getElementById('composition-ground-height');if(!height)throw Error('Shared ground control is unavailable');
   runtime.group.updateMatrixWorld(true);const previous=height.value,value=String(givenSourceSoleHeight(runtime.mesh.geometry.attributes.position.array,runtime.mesh.matrixWorld.elements));
   height.value=value;height.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(height.value===value){height.value=previous;height.dispatchEvent(new Event('change'));}};
   data.source.groundReference={kind:'source-start-surface-minimum',height:Number(value),animated:false,contactSolver:false};
  }
  const pose=input=>{
   if(closed)throw Error('Creature binding is disposed');
   const next=data.manifest.presets.find(p=>p.name===input?.name);if(!next)throw Error('Unknown binding preset');
   const world=new Map(data.manifest.bones.map(b=>[b.name,new THREE.Matrix4().set(...next.palette[data.manifest.channels.indexOf(b.name)].flat()).multiply(new THREE.Matrix4().set(...b.restMatrix.flat()))]));
   for(const b of data.manifest.bones) {
    const local=b.parent?world.get(b.parent).clone().invert().multiply(world.get(b.name)):world.get(b.name);
    local.decompose(runtime.bones.get(b.name).position,runtime.bones.get(b.name).quaternion,runtime.bones.get(b.name).scale);
   }
   runtime.update();preset=next.name;expected=matrices();session.redraw();refresh();
   record({kind:'creature.binding.pose',name:preset,caseSha256:data.source.caseSha256});return read();
  };
  expected=matrices();
  stop=session.onFrame(()=>{if(closed)return;const before=runtime.read().updates;runtime.update();if(runtime.read().updates!==before){session.redraw();refresh();}});
  if(inputs.view)session.setView(inputs.view);
  if(inputs.pose)pose({name:inputs.pose});
  globalThis.window?.selectSceneObject?.(asset.id);
  return {read,operations:{pose},dispose,mount({root,invoke}) {
   const panel=document.createElement('section'),title=document.createElement('h3'),note=document.createElement('p'),status=document.createElement('output'),select=document.createElement('select');
   title.textContent='Creature · automatic attachment';note.textContent='Actual joint poses on the retained mesh. Pose presets test attachment; they are not generated gait.';
   select.setAttribute('aria-label','Binding pose');
   for(const p of data.manifest.presets){const option=document.createElement('option');option.value=p.name;option.textContent=p.name;select.append(option);}
   select.onchange=async()=>{try{await invoke('pose',{name:select.value});}catch(e){status.textContent=e.message;}};
   refresh=()=>{select.value=preset;status.textContent=`${preset}${matrices()!==expected?' · edited':''} · ${data.manifest.bones.length} joints · ${data.manifest.vertices} vertices`;};
   panel.append(title,note,select,status);root.append(panel);refresh();return {dispose(){refresh=()=>{};panel.remove();}};
  }};
 } catch(e) {await dispose();throw e;}
}
export default {id:'marionette/creature-binding',title:'Creature · automatic attachment',create:createCreatureBinding};
