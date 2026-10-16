import * as THREE from '../../lib/three.core.js';
import {loadFullBodySkin} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createSkinCaseSelection} from './skin-case-selection.mjs';

// A controlled articulation contribution to the actual Workbench, not another
// creature editor or a substitute for in-scene Bone selection. Motion and the
// ordinary creature's operator interface remain with their existing owners.
export default {
 id:'mushfinger/complete-paw-binding',title:'Corrected paw binding · analytical articulation',
 async create({host,inputs,record}){
  const data=await loadFullBodySkin(inputs);
  if(data.manifest.bones.length!==32||!data.manifest.bindingRule?.zeroInfluenceEndpoints?.length)throw Error('The corrected32 paw package is required');
  const runtime=createFullBodyRuntime({THREE,...data}),session=await host.scene.open();
  let asset,selection,disposed=false;
  const saved=new Map([...runtime.bones].map(([name,b])=>[name,b.quaternion.clone()]));
  const read=()=>({route:'shared-workbench-analytical-paw-articulation',objectId:asset.id,sourceCaseSha256:selection?.read().current.case_sha256??data.source.caseSha256,skin:runtime.read(),pose:[...runtime.bones].map(([name,b])=>({name,quaternion:b.quaternion.toArray()})),view:session.readView()});
  const active=()=>{if(disposed)throw Error('Paw articulation is disposed');};
  const refresh=()=>{runtime.update();session.redraw();return read();};
  try{
   asset=await session.attach(runtime.group,{owned:true,metadata:{type:'experiment',fileName:'Corrected paw creature',label:'Corrected32 · analytical pose, not generated gait',source:inputs.case}});
   if(inputs.choices)selection=createSkinCaseSelection({runtime,choices:inputs.choices,currentCaseSha256:data.source.caseSha256,onApplied:()=>session.redraw()});
   if(inputs.view)session.setView(inputs.view);
   const operations={
    pose(request={}){
     active();const entries=Object.entries(request);
     for(const [name,angles] of entries)if(!runtime.bones.has(name)||!Array.isArray(angles)||angles.length!==3||!angles.every(Number.isFinite))throw Error('Pose requires existing Bone names and finite XYZ radians');
     for(const [name,bone]of runtime.bones){bone.quaternion.copy(saved.get(name));const a=request[name];if(a)bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...a,'XYZ')));}
     const effective=refresh();record({kind:'paw-articulation.pose',requested:request,effective});return effective;
    },
    inspect(){active();runtime.group.updateMatrixWorld(true);return {...read(),positions:Array.from(runtime.mesh.geometry.attributes.position.array),rootMatrix:runtime.group.matrixWorld.toArray(),registration:globalThis.window?.kaminosSceneObjectDebugState?.()??null};},
    async skin(request){active();if(!selection)throw Error('No cast choices supplied');return selection.select(request);},
    frame(){active();return session.setView(inputs.view??{position:[-5,0,1],target:[.18,-.65,-1]});},
   };
   return {read,operations,mount({root,document,invoke}){
    const note=document.createElement('p');note.textContent='Controlled corrected-paw articulation. This is not generated motion. Use the ordinary scene camera and viewport helpers; source bones, casts and old motion are untouched.';
    const button=document.createElement('button');button.textContent='Frame creature';button.onclick=()=>invoke('frame');root.append(note,button);
   },async dispose(){if(disposed)return;disposed=true;selection?.dispose();await session.dispose();}};
  }catch(error){selection?.dispose();await session.dispose();if(!asset)runtime.dispose();throw error;}
 },
};
