import {createKaminosVolumePrototype} from './volume-core.js';
import {checkedFireUnitRecord,checkedFireUnitPose,fireUnitFrame,moveLinkedFireEmitter} from './fire-unit-record.mjs';
import {flamePoseToDomain,immersedControlsForFlamePose} from './scene-flame-emitter.mjs';

// One owner, one nested solver, one ordinary native canvas. No CPU gas copies.
export function createFireUnitObject({THREE,record,camera,controls,viewport,sharedGpuContext,getSceneDepth,onError=()=>{}}){
 record=checkedFireUnitRecord(record);
 let data=structuredClone(record.fireUnit),accepted=structuredClone(record.transform),disposed=false,active=false,desired=false,activity=Promise.resolve(),status=null;
 const root=new THREE.Group();root.name=record.label||'Fire simulation';
 root.position.fromArray(accepted.position);root.scale.fromArray(accepted.scale);
 const fineDims=data.controls.gridHeightRatio??2;
 const fine=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,2*fineDims-1,1)),0xe4ba73);
 const outer=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,2*fineDims-1,1)),0x5bd8f5);
 for(const helper of [fine,outer]){helper.userData.kaminosEditorHelper=true;helper.material.depthTest=false;helper.renderOrder=1000;root.add(helper);}
 const emitter=new THREE.Mesh(new THREE.SphereGeometry(.1,12,8),new THREE.MeshBasicMaterial({color:0xffae48,wireframe:true,depthTest:false}));
 emitter.name='Fire emitter';emitter.renderOrder=1001;root.add(emitter);
 const proxy=new THREE.Object3D();proxy.name='Fire emitter';proxy.userData.kaminosEditorHelper=true;
 let hasWorld=false,failed=null;
 const runtime=createKaminosVolumePrototype({THREE,viewport,camera,controls,getControls:()=>data.controls,sharedGpuContext,getSceneDepth,
  transparentCanvas:true,canvasId:'kaminos-fire-unit-'+record.id,externalProductTransform:fireUnitFrame(accepted),
  onStatus:value=>{status=value;if(value.error){failed=value.error;onError(Error(value.error));}}});
 const canvas=runtime.canvasElement();canvas.classList.add('kaminos-fire-unit-canvas');canvas.dataset.fireUnit=record.id;
 function placeEmitter(){
  root.updateMatrixWorld(true);emitter.position.copy(root.worldToLocal(new THREE.Vector3(...data.emitter.position)));
  emitter.scale.setScalar(data.emitter.scale[0]);proxy.position.fromArray(data.emitter.position);proxy.rotation.set(...data.emitter.rotation);proxy.scale.fromArray(data.emitter.scale);
 }
 function supply(){
  const frame=fireUnitFrame(accepted),pose=flamePoseToDomain(data.emitter,frame.translate,frame.scale);
  const next=immersedControlsForFlamePose(data.controls,pose,true,data.controls,{worldSource:data.controls.worldSmoke==='on'});
  // The collection owns supply independently from the prototype's legacy source.
  runtime.setImmersedSources([{id:record.id+':emitter',worldSource:data.controls.worldSmoke==='on',controls:next}]);
 }
 function updateBounds(){
  const state=runtime.debugState(),w=state.worldSmoke;
  hasWorld=w?.effective!=='off'&&Array.isArray(w?.renderMin);
  // The actual runtime plan is authoritative; before its first frame use the authored extent.
  if(w?.anchor&&w?.flowDims){const extent=Number(data.controls.worldSmokeExtent)||4;
   const height=w.flowDims[1]/w.flowDims[0];outer.box.min.set(-extent,-extent,-extent);outer.box.max.set(extent,(2*height-1)*extent,extent);hasWorld=true;}
  else outer.box.copy(fine.box);
 }
 const owner={root,emitter,proxy,runtime,
  capture(){owner.syncPose();return structuredClone(data);},
  read(){return {id:record.id,transform:structuredClone(accepted),fireUnit:owner.capture(),active,desired,error:failed,runtime:runtime.debugState()};},
  setData(value){const next=checkedFireUnitRecord({...record,transform:accepted,fireUnit:value}).fireUnit;
   const before=data;data=next;try{runtime.setControls(data.controls);supply();placeEmitter();}catch(error){data=before;throw error;}},
  setEmitter(value){const next=checkedFireUnitRecord({...record,transform:accepted,fireUnit:{...data,emitter:value}}).fireUnit.emitter;
   const before=data.emitter;data.emitter=next;try{supply();placeEmitter();}catch(error){data.emitter=before;placeEmitter();throw error;}},
  syncPose(){
   const next=checkedFireUnitPose({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()});
   if(next.position.every((v,i)=>v===accepted.position[i])&&next.scale[0]===accepted.scale[0])return;
   const emitterNext=moveLinkedFireEmitter(data.emitter,accepted,next,data.moveEmitterWithGrid),frame=fireUnitFrame(next);
   runtime.repositionOrdinaryUnit(frame.translate,frame.scale);accepted=next;data.emitter=emitterNext;supply();placeEmitter();
  },
  setVisible(value){desired=!!value;
   activity=activity.catch(()=>{}).then(async()=>{if(disposed||desired===active)return;await runtime.setActive(desired);active=desired;});
   activity.catch(onError);return activity;
  },
  async initialize(){supply();placeEmitter();await owner.setVisible(true);updateBounds();},
  sync({visible=true,helpers=true,paused=false}={}){if(disposed)return;
   owner.syncPose();root.visible=visible;fine.visible=helpers;outer.visible=helpers;emitter.visible=helpers;
   runtime.setSimulationPaused(paused);if(visible!==desired)void owner.setVisible(visible);
  },
  async dispose(){if(disposed)return;disposed=true;desired=false;await activity.catch(()=>{});await runtime.dispose();active=false;root.removeFromParent();proxy.removeFromParent();
   for(const h of [fine,outer,emitter]){h.geometry.dispose();h.material.dispose();}},
 };
 root.userData.fireUnitOwner=owner;placeEmitter();return owner;
}
