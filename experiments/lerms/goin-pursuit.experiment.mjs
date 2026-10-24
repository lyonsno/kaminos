import * as THREE from '../../lib/three.core.js';
import {createWalkingCreature} from '../creature-motion/walking.experiment.mjs';
import {createGoinTask} from './goin-task.mjs';

const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export async function createGoinPursuit({host,inputs={},record=()=>{}},dependencies={}){
 if(!inputs.creature)throw Error('Goin pursuit requires an explicit source-identified creature recipe');
 const position=inputs.goin?.position??[2,.4,0];
 if(!point(position))throw Error('Goin position must be a finite world point');
 if(inputs.arrivalRadius!==undefined&&(!Number.isFinite(inputs.arrivalRadius)||inputs.arrivalRadius<=0))throw Error('Arrival radius must be positive');
 const session=await host.scene.open();
 const goin=new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,.16,32),new THREE.MeshStandardMaterial({color:0xe9b939,metalness:.65,roughness:.3}));
 goin.name='Goin';goin.rotation.x=Math.PI/2;goin.position.fromArray(position);goin.castShadow=true;
 let asset,actor,seating,disposed=false,serial=0,refresh=()=>{};
 const task=createGoinTask({arrivalRadius:inputs.arrivalRadius??.45,target:()=>{
  if(!goin.parent)return null;
  for(let node=goin;node;node=node.parent)if(!node.visible)return null;
  return {id:asset.id,position:goin.getWorldPosition(new THREE.Vector3()).toArray()};
 }});
 const steering={read:task.read,update(context){const intent=task.update(context);refresh();return intent;}};
 const active=()=>{if(disposed)throw Error('Goin pursuit is disposed');};
 async function dispose(){if(disposed)return;disposed=true;seating?.dispose();refresh=()=>{};
  try{await actor?.dispose();}finally{try{await session.dispose();}finally{if(!asset){goin.geometry.dispose();goin.material.dispose();}}}
 }
 const read=()=>({schema:'lerms.goin-pursuit.v1',route:'shared-owner-scene',task:task.read(),creature:actor.read(),
  goin:{id:asset.id,position:goin.getWorldPosition(new THREE.Vector3()).toArray(),mounted:Boolean(goin.parent),visible:goin.visible},
  interruptionRoute:'explicit-test-operation; no fluid receiver attached'});
 try{
  asset=await session.attach(goin,{owned:true,metadata:{label:'Goin',source:'lerms:provisional-goin-geometry',type:'experiment'}});
  const attention=inputs.creature.attention?{...inputs.creature.attention,engage:false,interests:[...inputs.creature.attention.interests,{object:asset.id,interest:1,anchor:'center',label:'Goin'}]}:undefined;
  actor=await createWalkingCreature({host,record,inputs:{...inputs.creature,attention,actor_root:'live',action:'wander',play:false}},
   {...dependencies,publishInspector:false,steering});
  const operations={
   moveGoin(input){active();if(!point(input?.position))throw Error('Goin position must be a finite world point');
    goin.position.fromArray(input.position);host.scene.refreshPresentation(asset);session.redraw();
    const result=read();record({kind:'lerms.goin.move',phase:'applied',effective:result.goin});return result;
   },
   interruptTest(input={}){active();const event={id:`manual-${++serial}`,source:'explicit-test-operation',seconds:input.seconds??1.5};
    task.interrupt(event);record({kind:'lerms.interruption',phase:'applied',event});return read();
   },
   setRunning(input){active();if(typeof input?.running!=='boolean')throw Error('Running must be boolean');actor.operations[input.running?'play':'pause']();return read();},
   advance(input){active();actor.operations.advance(input);return read();},
   selectGoin(){active();globalThis.window?.selectSceneObject?.(asset.id);return read();},
  };
  if(inputs.view)session.setView(inputs.view);
  if(inputs.running!==false)actor.operations.play();
  return {read,operations,dispose,inspect:actor.inspect,
   mount({root,document,invoke}){
    const properties=document.createElement('div'),status=document.createElement('output');
    const interrupt=document.createElement('button');interrupt.type='button';interrupt.textContent='Interrupt test';
    interrupt.addEventListener('click',()=>Promise.resolve(invoke('interruptTest',{})).catch(e=>status.textContent=e.message));
    properties.append(interrupt,status);
    refresh=()=>{status.textContent=task.read().phase;};refresh();
    if(host.controls.mountObject)seating=host.controls.mountObject({asset,properties});else root.append(properties);
    actor.mount({root,invoke:(name,input)=>actor.operations[name](input),reopen:recipe=>globalThis.window.kaminosWorkbenchExperiments.open('lerms/goin-pursuit',{
     ...inputs,creature:recipe,goin:{position:goin.position.toArray()},running:recipe.play})});
    return {dispose(){seating?.dispose();refresh=()=>{};}};
   }
  };
 }catch(error){await dispose();throw error;}
}
export default {id:'lerms/goin-pursuit',title:'Lerms - goin pursuit',create:createGoinPursuit};
