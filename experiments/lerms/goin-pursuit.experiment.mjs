import * as THREE from '../../lib/three.core.js';
import {createWalkingCreature} from '../creature-motion/walking.experiment.mjs';
import {sceneObjectInterests} from '../creature-motion/creature-attention.mjs';
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
 const physicsInput=inputs.physics??null;
 if(physicsInput&&(!theft||!point(physicsInput.support?.size)||physicsInput.support.size.some(x=>x<=0)||!point(physicsInput.support.position)))throw Error('Goin physics requires theft and an explicit box support size and position');
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
 if(physicsInput){const mark=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshStandardMaterial({color:0x553c14}));mark.position.set(.2,.09,0);goin.add(mark);}
 let asset,actor,seating,escapeAsset,stopCarry,stopPose,stopEdits,disposed=false,serial=0,revision=0,refresh=()=>{},goinInterests=()=>[];
 const edits=host.scene.edits;
 let held=false,editHeld=false,presentedPose=null;
 let physics,supportAsset,physicsFailure=null;
 const support=physicsInput?new THREE.Mesh(new THREE.BoxGeometry(...physicsInput.support.size),new THREE.MeshStandardMaterial({color:0x547b72,roughness:.9})):null;
 if(support){support.name='Goin support';support.position.fromArray(physicsInput.support.position);support.receiveShadow=true;}
 let water,receiver,stopWater,waterPending=null,waterFailure=null,wet=false,waterState={status:waterInput?'opening':'not-requested'};
 const escape=theft?new THREE.Mesh(new THREE.ConeGeometry(.2,.5,12),new THREE.MeshStandardMaterial({color:0x41b99a})):null;
 if(escape){escape.name='Escape point';escape.position.fromArray(theft.escape);}
 const task=createGoinTask({arrivalRadius:inputs.arrivalRadius??.45,theft:theft?{carrierId:inputs.lermId??goin.uuid,escape:()=>escape.getWorldPosition(new THREE.Vector3()).toArray()}:null,target:()=>{
  if(!goin.parent)return null;
  for(let node=goin;node;node=node.parent)if(!node.visible)return null;
  const physical=physics?.read();
  return {id:asset.id,position:goin.getWorldPosition(new THREE.Vector3()).toArray(),claimable:!physical?.active||physical.contactCount>0||physical.phase==='settled'};
 }});
 const worldPose=()=>({position:goin.getWorldPosition(new THREE.Vector3()).toArray(),quaternion:goin.getWorldQuaternion(new THREE.Quaternion()).toArray(),scale:goin.getWorldScale(new THREE.Vector3()).toArray()});
 const rememberPose=()=>{presentedPose=JSON.stringify(worldPose());};
 function physicalPose(){
  const pose=worldPose(),rebuilt=new THREE.Matrix4().compose(new THREE.Vector3(...pose.position),new THREE.Quaternion(...pose.quaternion),new THREE.Vector3(...pose.scale));
  if(goin.matrixWorld.elements.some((x,i)=>Math.abs(x-rebuilt.elements[i])>1e-6))throw Error('Sheared goin transform is unsupported');return pose;
 }
 const receipt=()=>{const state=task.read();if(state.custody&&state.custody.revision!==revision){
  if(physics&&state.transition.kind==='drop')physicsCall(()=>physics.release({time:state.transition.time,...physicalPose()}));
  revision=state.custody.revision;record({kind:'lerms.goin.custody',phase:'applied',revision,...state.transition});}refresh();};
 function physicsCall(action){
  if(!physics)return;
  if(physicsFailure)throw Error('Goin physics failed; reopen before resuming');
  try{return action();}catch(error){physicsFailure=error;actor?.operations.pause();throw error;}
 }
 function advancePhysics(time){
  return physicsCall(()=>{
   physics.setScale(physicalPose().scale);
   const state=physics.advance(time);
   if(state.active){
    if(!goin.parent)throw Error('Dynamic goin was removed');
    goin.position.copy(goin.parent.worldToLocal(new THREE.Vector3(...state.position)));
    goin.quaternion.copy(goin.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion(...state.quaternion)));
    goin.updateMatrixWorld(true);rememberPose();session.redraw();
   }
  });
 }
 function presentCarry(){
  if(disposed||!actor||!theft||physicsFailure)return;
  if(!task.read().custody.carrierId){advancePhysics(actor.read().action.time);return;}
  if(!goin.parent)return;
  const snapshot=actor.pose({bones:[theft.socket.bone]});
  const world=new THREE.Vector3(...theft.socket.offset).applyMatrix4(new THREE.Matrix4().fromArray(snapshot.bones[0].matrix));
  goin.position.copy(goin.parent.worldToLocal(world));goin.updateMatrixWorld(true);rememberPose();session.redraw();
  physicsCall(()=>physics.carried({time:actor.read().action.time,...physicalPose()}));
 }
 const waterHealthy=()=>{if(waterFailure)throw Error('Water receiver failed; reopen before resuming');};
 const healthy=()=>{waterHealthy();if(physicsFailure)throw Error('Goin physics failed; reopen before resuming');};
 function setHeld(value,source){
  active();healthy();if(value===held)return;
  const time=actor.read().action.time;
  if(value)physicsCall(()=>physics.reset(time));
  else physicsCall(()=>physics.release({time,...physicalPose()}));
  task.setHeld({held:value,time});held=value;rememberPose();receipt();
  record({kind:'lerms.goin.manipulation',phase:value?'grabbed':'released',source,time,goin:{id:asset.id,...worldPose()}});
 }
 function editsGoin(edit){
  for(let node=goin;node;node=node.parent){const id=node===goin?asset.id:node.userData?.kaminosSceneObject?.id;
   if(id&&(edit?.id===id||Object.hasOwn(edit?.before?.roots??{},id)))return true;}
  return false;
 }
 function observeEdit(state){
  if(disposed||!actor)return;
  if(editsGoin(state.active)){setHeld(true,'shared-scene-edit');editHeld=true;return;}
  if(editHeld){setHeld(false,'shared-scene-edit');editHeld=false;return;}
  if(held)return;
  // Undo/redo and ancestor transforms publish after writing, without begin.
  if(presentedPose!==JSON.stringify(worldPose())){setHeld(true,'shared-scene-history');setHeld(false,'shared-scene-history');}
 }
 const steering={read:task.read,
  attention(){const state=task.read(),interests=state.custody?.carrierId||!goin.parent?[]:goinInterests().filter(x=>x.active);return {id:interests.length?asset.id:null,interests};},
  update(context){
   healthy();advancePhysics(context.time);
   const reachPosition=inputs.creature.attention&&actor?actor.pose({bones:['head']}).bones[0].matrix.slice(12,15):context.position;
   const intent=task.update({...context,reachPosition});receipt();return intent;
  }};
 const invokeActor=(name,input)=>{
  active();if(name!=='pause')healthy();
  if(physics&&name==='floor'&&input?.visible)throw Error('Physical goin support replaces the decorative walking floor');
  const finish=value=>{if(actor.read().playback.status!=='playing')host.scene.refreshPresentation(asset);return value;};
  const result=actor.operations[name](input);return result?.then?result.then(finish):finish(result);
 };
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
 async function dispose(){if(disposed)return;disposed=true;stopEdits?.();if(editsGoin(edits?.state().active))edits.cancel();stopWater?.();stopCarry?.();stopPose?.();physics?.dispose();seating?.dispose();refresh=()=>{};
  try{try{await receiver?.dispose();}finally{await water?.dispose();}}finally{
   try{await actor?.dispose();}finally{try{await session.dispose();}finally{if(!asset){goin.geometry.dispose();goin.material.dispose();}if(escape&&!escapeAsset){escape.geometry.dispose();escape.material.dispose();}if(support&&!supportAsset){support.geometry.dispose();support.material.dispose();}}}
  }
 }
 const read=()=>({schema:'lerms.goin-pursuit.v1',route:'shared-owner-scene',task:task.read(),creature:actor.read(),
  goin:{id:asset.id,...worldPose(),mounted:Boolean(goin.parent),visible:goin.visible},
  physics:physics?{...physics.read(),failure:physicsFailure?.message??null}:null,
  interaction:{held,nativePlacement:Boolean(edits),pickupWhileHeld:false},
  theft:theft?{socket:structuredClone(theft.socket),attachment:'provisional-source-bone-offset',escape:{id:escapeAsset.id,position:escape.getWorldPosition(new THREE.Vector3()).toArray()},release:physics?'rigid-body fall and contact on authored box support':'world-position detach; no fall or rolling solver'}:null,
  water:structuredClone(waterState),interruptionRoute:waterInput?'gpu-liquid-volume-sphere-overlap; finite water':'explicit-test-operation; no fluid receiver attached'});
 try{
  asset=await session.attach(goin,{owned:true,metadata:{label:'Goin',source:'lerms:provisional-goin-geometry',type:'experiment'}});
  goinInterests=sceneObjectInterests({THREE,root:()=>{let node=goin;while(node.parent)node=node.parent;return node;},
   specs:[{object:asset.id,interest:1,anchor:'center',label:'Goin'}]});
  if(support){
   supportAsset=await session.attach(support,{owned:true,metadata:{label:'Goin support',source:'lerms:authored-box-support',type:'experiment'}});
   const {createGoinPhysics}=await import('./goin-physics.mjs');
   physics=createGoinPhysics({support:()=>{
    for(let node=support;node;node=node.parent)if(!node.visible)return null;
    if(!support.parent)return null;support.updateWorldMatrix(true,false);
    const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();support.matrixWorld.decompose(p,q,s);
    const rebuilt=new THREE.Matrix4().compose(p,q,s);if(support.matrixWorld.elements.some((x,i)=>Math.abs(x-rebuilt.elements[i])>1e-6))throw Error('Sheared goin support is unsupported');
    return {id:supportAsset.id,position:p.toArray(),quaternion:q.toArray(),size:physicsInput.support.size.map((x,i)=>x*s.toArray()[i])};
   }});
  }
  if(escape)escapeAsset=await session.attach(escape,{owned:true,metadata:{label:'Escape point',source:'lerms:authored-escape-target',type:'experiment'}});
  const attention=inputs.creature.attention?{...inputs.creature.attention,engage:false}:undefined;
  actor=await createWalkingCreature({host,record,inputs:{...inputs.creature,attention,actor_root:'live',action:'wander',play:false}},
   {...dependencies,publishInspector:false,steering});
  if(physics&&actor.read().referenceFloor)actor.operations.floor({visible:false});
  if(theft){actor.pose({bones:[theft.socket.bone]});stopPose=actor.observePose(presentCarry);stopCarry=session.onFrame(presentCarry);presentCarry();}
  rememberPose();if(edits)stopEdits=edits.subscribe(observeEdit);
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
    healthy();
    const alreadyHeld=held;if(!alreadyHeld)setHeld(true,'agent-placement');
    goin.position.copy(goin.parent.worldToLocal(new THREE.Vector3(...input.position)));goin.updateMatrixWorld(true);rememberPose();
    if(!alreadyHeld)setHeld(false,'agent-placement');host.scene.refreshPresentation(asset);session.redraw();
    const result=read();record({kind:'lerms.goin.move',phase:'applied',effective:result.goin});return result;
   },
   beginGoinGrab(){setHeld(true,'agent-grab');return read();},
   endGoinGrab(){setHeld(false,'agent-grab');return read();},
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
    properties.append(status);
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
