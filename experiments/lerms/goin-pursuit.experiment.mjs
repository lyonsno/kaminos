import * as THREE from '../../lib/three.core.js';
import {createWalkingCreature} from '../creature-motion/walking.experiment.mjs';
import {createGoinTask} from './goin-task.mjs';
import {createWaterExposure} from './water-exposure.mjs';

const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export async function createGoinPursuit({host,inputs={},record=()=>{}},dependencies={}){
 if(!inputs.creature)throw Error('Goin pursuit requires an explicit source-identified creature recipe');
 const position=inputs.goin?.position??[2,.4,0];
 if(!point(position))throw Error('Goin position must be a finite world point');
 if(inputs.arrivalRadius!==undefined&&(!Number.isFinite(inputs.arrivalRadius)||inputs.arrivalRadius<=0))throw Error('Arrival radius must be positive');
 const theft=inputs.theft??null;
 if(theft&&(!point(theft.escape)||!theft.socket||typeof theft.socket.bone!=='string'||!point(theft.socket.offset)))throw Error('Theft requires an escape point and explicit source Bone socket');
 const waterInput=inputs.water??null;
 if(waterInput){
  if(typeof host.fluid?.open!=='function')throw Error('Requested water requires the shared fluid capability');
  const r=waterInput.receiver;
  if(!r||typeof r.bone!=='string'||!point(r.offset)||!Number.isFinite(r.radius)||r.radius<=0)throw Error('Water receiver requires an explicit Bone sphere');
  if(waterInput.interruptionSeconds!==undefined&&(!Number.isFinite(waterInput.interruptionSeconds)||waterInput.interruptionSeconds<=0))throw Error('Water interruption duration must be positive');
 }
 const session=await host.scene.open();
 const goin=new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,.16,32),new THREE.MeshStandardMaterial({color:0xe9b939,metalness:.65,roughness:.3}));
 goin.name='Goin';goin.rotation.x=Math.PI/2;goin.position.fromArray(position);goin.castShadow=true;
 let asset,actor,seating,escapeAsset,stopCarry,stopPose,disposed=false,serial=0,revision=0,refresh=()=>{};
 let water,receiver,stopWater,waterPending=null,waterFailure=null,wet=false,waterState={status:waterInput?'opening':'not-requested'};
 const escape=theft?new THREE.Mesh(new THREE.ConeGeometry(.2,.5,12),new THREE.MeshStandardMaterial({color:0x41b99a})):null;
 if(escape){escape.name='Escape point';escape.position.fromArray(theft.escape);}
 const task=createGoinTask({arrivalRadius:inputs.arrivalRadius??.45,theft:theft?{carrierId:inputs.lermId??goin.uuid,escape:()=>escape.getWorldPosition(new THREE.Vector3()).toArray()}:null,target:()=>{
  if(!goin.parent)return null;
  for(let node=goin;node;node=node.parent)if(!node.visible)return null;
  return {id:asset.id,position:goin.getWorldPosition(new THREE.Vector3()).toArray()};
 }});
 const receipt=()=>{const state=task.read();if(state.custody&&state.custody.revision!==revision){revision=state.custody.revision;record({kind:'lerms.goin.custody',phase:'applied',revision,...state.transition});}refresh();};
 function presentCarry(){
  if(disposed||!actor||!theft||!task.read().custody.carrierId||!goin.parent)return;
  const snapshot=actor.pose({bones:[theft.socket.bone]});
  const world=new THREE.Vector3(...theft.socket.offset).applyMatrix4(new THREE.Matrix4().fromArray(snapshot.bones[0].matrix));
  goin.position.copy(goin.parent.worldToLocal(world));goin.updateMatrixWorld(true);session.redraw();
 }
 const waterHealthy=()=>{if(waterFailure)throw Error('Water receiver failed; reopen before resuming');};
 const steering={read:task.read,update(context){waterHealthy();const intent=task.update(context);receipt();return intent;}};
 const invokeActor=(name,input)=>{active();if(name!=='pause')waterHealthy();return actor.operations[name](input);};
 function sampleWater(){
  if(waterFailure)return Promise.reject(Error('Water receiver failed; reopen before resuming'));
  if(waterPending)return waterPending;
  if(disposed||!receiver)return Promise.resolve(waterState);
  const r=waterInput.receiver,pose=actor.pose({bones:[r.bone]}),matrix=new THREE.Matrix4().fromArray(pose.bones[0].matrix);
  const center=new THREE.Vector3(...r.offset).applyMatrix4(matrix).toArray();
  // Radius is authored in world units; a source Bone supplies only its center.
  const sampledOwnerTime=actor.read().action.time;
  waterPending=receiver.sample({center,radius:r.radius}).then(observed=>{
   if(disposed)return observed;
   waterState={...observed,sampledOwnerTime};
   if(observed.status!=='observed')return waterState;
   const hit=observed.overlap>0;task.setWaterExposure(hit);
   if(hit&&!wet){
    const event={id:`water-${++serial}`,source:observed.source,cause:'juice_hit',time:actor.read().action.time,seconds:waterInput.interruptionSeconds??1.5,observation:waterState};
    presentCarry();task.interrupt(event);receipt();record({kind:'lerms.interruption',phase:'applied',event});
   }
   wet=hit;return waterState;
  }).catch(error=>{if(!disposed){waterFailure=error;waterState={status:'failed',error:error.message};actor.operations.pause();stopWater?.();record({kind:'lerms.water',phase:'failed',error:error.message});}throw error;}).finally(()=>{waterPending=null;});
  return waterPending;
 }
 const active=()=>{if(disposed)throw Error('Goin pursuit is disposed');};
 async function dispose(){if(disposed)return;disposed=true;stopWater?.();stopCarry?.();stopPose?.();seating?.dispose();refresh=()=>{};
  try{try{await receiver?.dispose();}finally{await water?.dispose();}}finally{
   try{await actor?.dispose();}finally{try{await session.dispose();}finally{if(!asset){goin.geometry.dispose();goin.material.dispose();}if(escape&&!escapeAsset){escape.geometry.dispose();escape.material.dispose();}}}
  }
 }
 const read=()=>({schema:'lerms.goin-pursuit.v1',route:'shared-owner-scene',task:task.read(),creature:actor.read(),
  goin:{id:asset.id,position:goin.getWorldPosition(new THREE.Vector3()).toArray(),mounted:Boolean(goin.parent),visible:goin.visible},
  theft:theft?{socket:structuredClone(theft.socket),attachment:'provisional-source-bone-offset',escape:{id:escapeAsset.id,position:escape.getWorldPosition(new THREE.Vector3()).toArray()},release:'world-position detach; no fall or rolling solver'}:null,
  water:structuredClone(waterState),interruptionRoute:waterInput?'gpu-liquid-volume-sphere-overlap; finite water':'explicit-test-operation; no fluid receiver attached'});
 try{
  asset=await session.attach(goin,{owned:true,metadata:{label:'Goin',source:'lerms:provisional-goin-geometry',type:'experiment'}});
  if(escape)escapeAsset=await session.attach(escape,{owned:true,metadata:{label:'Escape point',source:'lerms:authored-escape-target',type:'experiment'}});
  const attention=inputs.creature.attention?{...inputs.creature.attention,engage:false,interests:[...inputs.creature.attention.interests,...theft?[]:[{object:asset.id,interest:1,anchor:'center',label:'Goin'}]]}:undefined;
  actor=await createWalkingCreature({host,record,inputs:{...inputs.creature,attention,actor_root:'live',action:'wander',play:false}},
   {...dependencies,publishInspector:false,steering});
  if(theft){actor.pose({bones:[theft.socket.bone]});stopPose=actor.observePose(presentCarry);stopCarry=session.onFrame(presentCarry);presentCarry();}
  if(waterInput){
   actor.pose({bones:[waterInput.receiver.bone]});
   const {lazarusFiniteSetup}=await import('../lazarus-fluid/contributions.mjs');
   const setup=lazarusFiniteSetup(waterInput.finite);setup.solver.liquidFireContactCoverage='active-liquid-particles';
   water=await host.fluid.open(setup);
   receiver=await createWaterExposure({descriptor:()=>water.getContactRecordDescriptor()});
   waterState={status:'awaiting-sample',route:'shared-finite-fluid',receiver:structuredClone(waterInput.receiver)};
   stopWater=session.onFrame(()=>{if(!waterPending)sampleWater().catch(()=>{});});
   if(waterInput.running===true)water.setPaused(false);
  }
  const operations={
   moveGoin(input){active();if(!point(input?.position))throw Error('Goin position must be a finite world point');
    if(task.read().custody?.carrierId)throw Error('A carried goin is placed by its carrier; interrupt before moving it');
    goin.position.fromArray(input.position);host.scene.refreshPresentation(asset);session.redraw();
    const result=read();record({kind:'lerms.goin.move',phase:'applied',effective:result.goin});return result;
   },
   moveEscape(input){active();if(!escape||!point(input?.position))throw Error('Escape point must be a finite world point');escape.position.fromArray(input.position);host.scene.refreshPresentation(escapeAsset);session.redraw();return read();},
   async sampleWater(){active();if(!receiver)throw Error('Water is not mounted');await sampleWater();return read();},
   setWaterRunning(input){active();if(!water||typeof input?.running!=='boolean')throw Error('Mounted water and running boolean required');if(input.running)waterHealthy();water.setPaused(!input.running);return read();},
   async advanceWater(input){active();waterHealthy();if(!water)throw Error('Water is not mounted');await water.advanceTo(input?.step);await sampleWater();return read();},
   async restartWater(){active();waterHealthy();if(!water)throw Error('Water is not mounted');if(waterPending)await waterPending;await water.restart();wet=false;task.setWaterExposure(false);waterState={status:'awaiting-sample'};return read();},
   interruptTest(input={}){active();const event={id:`manual-${++serial}`,source:'explicit-test-operation',time:actor.read().action.time,seconds:input.seconds??1.5};
    presentCarry();task.interrupt(event);receipt();record({kind:'lerms.interruption',phase:'applied',event});return read();
   },
   setRunning(input){active();if(typeof input?.running!=='boolean')throw Error('Running must be boolean');invokeActor(input.running?'play':'pause');return read();},
   advance(input){invokeActor('advance',input);return read();},
   selectGoin(){active();globalThis.window?.selectSceneObject?.(asset.id);return read();},
  };
  if(inputs.view)session.setView(inputs.view);
  if(inputs.running!==false)invokeActor('play');
  return {read,operations,dispose,inspect:actor.inspect,
   mount({root,document,invoke}){
    const properties=document.createElement('div'),status=document.createElement('output');
    const interrupt=document.createElement('button');interrupt.type='button';interrupt.textContent='Interrupt test';
    interrupt.addEventListener('click',()=>Promise.resolve(invoke('interruptTest',{})).catch(e=>status.textContent=e.message));
    properties.append(interrupt,status);
    if(water){
     const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=waterInput.running===true;
     const name=document.createElement('span');name.textContent='Water';label.append(toggle,name);
     toggle.addEventListener('change',()=>Promise.resolve(invoke('setWaterRunning',{running:toggle.checked})).catch(e=>status.textContent=e.message));properties.append(label);
    }
    refresh=()=>{status.textContent=task.read().phase;};refresh();
    if(host.controls.mountObject)seating=host.controls.mountObject({asset,properties});else root.append(properties);
    actor.mount({root,invoke:invokeActor,reopen:recipe=>globalThis.window.kaminosWorkbenchExperiments.open('lerms/goin-pursuit',{
     ...inputs,creature:recipe,goin:{position:goin.position.toArray()},running:recipe.play})});
    return {dispose(){seating?.dispose();refresh=()=>{};}};
   }
  };
 }catch(error){await dispose();throw error;}
}
export default {id:'lerms/goin-pursuit',title:'Lerms - goin pursuit',create:createGoinPursuit};
