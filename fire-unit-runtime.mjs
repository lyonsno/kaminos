import {createKaminosVolumePrototype} from './volume-core.js';
import {checkedFireUnitRecord,checkedFireUnitPose,fireUnitFrame,moveLinkedFireEmitter} from './fire-unit-record.mjs';
import {resolveWorldRegions} from './volume-region-controls.mjs';
import {resolveGridHeight} from './volume-grid-shape.mjs';
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
 let failed=null,lastPaused=null,authoringRevision=0;
 const runtime=createKaminosVolumePrototype({THREE,viewport,camera,controls:null,getControls:()=>({...data.controls,lookFreeze:0}),sharedGpuContext,getSceneDepth,
  transparentCanvas:true,canvasId:'kaminos-fire-unit-'+record.id,externalProductTransform:fireUnitFrame(accepted),
  onStatus:value=>{status=value;if(value.error){failed=value.error;onError(Error(value.error));}}});
 runtime.setCoreEmitterSourceMode('analytic-only');
 runtime.setRaymarchSmokePresentationMode(data.settings?.presentationControls?.['raymarch-smoke-presentation']?.value??'on');
 const initialFrame=fireUnitFrame(accepted);runtime.repositionOrdinaryUnit(initialFrame.translate,initialFrame.scale);
 const canvas=runtime.canvasElement();canvas.classList.add('kaminos-fire-unit-canvas');canvas.dataset.fireUnit=record.id;canvas.style.background='transparent';
 emitter.userData.kaminosEditorHelper=true;
 function placeEmitter(){
  root.updateMatrixWorld(true);emitter.position.copy(root.worldToLocal(new THREE.Vector3(...data.emitter.position)));
  emitter.scale.setScalar(data.emitter.scale[0]/accepted.scale[0]);proxy.position.fromArray(data.emitter.position);proxy.rotation.set(...data.emitter.rotation);proxy.scale.fromArray(data.emitter.scale);
 }
 function supply(){
  const frame=fireUnitFrame(accepted),pose=flamePoseToDomain(data.emitter,frame.translate,frame.scale);
  const next=immersedControlsForFlamePose(data.controls,pose,data.emissionEnabled!==false,data.controls,{worldSource:data.controls.worldSmoke==='on'});
  // The collection owns supply independently from the prototype's legacy source.
  runtime.setImmersedSources([{id:record.id+':emitter',worldSource:data.controls.worldSmoke==='on',controls:next}]);
 }
 function updateBounds(){
  const width=Number(data.controls.resolution),height=resolveGridHeight(data.controls,width).heightCells;
  fine.box.min.set(-1,-1,-1);fine.box.max.set(1,2*height/width-1,1);
  const world=data.controls.worldSmoke==='on'?resolveWorldRegions(data.controls,[width,height,width]).world:null;
  if(world){outer.box.min.fromArray(world.min);outer.box.max.fromArray(world.max);}else outer.box.copy(fine.box);
 }

 const owner={root,emitter,proxy,runtime,
  get authoringRevision(){return authoringRevision;},
  linkState:()=>({moveEmitterWithGrid:data.moveEmitterWithGrid,emissionEnabled:data.emissionEnabled!==false}),
  pose:()=>({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()}),
  setPose(value){const pose=checkedFireUnitPose(value);root.position.fromArray(pose.position);root.rotation.set(...pose.rotation);root.scale.fromArray(pose.scale);owner.syncPose();},
  capture(){owner.syncPose();return structuredClone(data);},
  read(){return {id:record.id,transform:structuredClone(accepted),fireUnit:owner.capture(),active,desired,present:root.parent!==null,error:failed,runtime:runtime.debugState()};},
  setData(value){const next=checkedFireUnitRecord({...record,transform:accepted,fireUnit:value}).fireUnit;
   if(next.controls.emitterSourceLaw!=='immersed-source')throw Error('Independent fire units require the immersed source law');
   runtime.validateGridControls(next.controls);
   const before=data,changed=JSON.stringify(next.controls)!==JSON.stringify(before.controls);data=next;try{if(changed)runtime.setControls({...data.controls,lookFreeze:0});runtime.setRaymarchSmokePresentationMode(data.settings?.presentationControls?.['raymarch-smoke-presentation']?.value??'on');if(changed||data.emissionEnabled!==before.emissionEnabled)supply();placeEmitter();if(changed)updateBounds();authoringRevision++;}catch(error){data=before;if(changed)runtime.setControls({...before.controls,lookFreeze:0});supply();placeEmitter();updateBounds();throw error;}},
  setEmitter(value){const next=checkedFireUnitRecord({...record,transform:accepted,fireUnit:{...data,emitter:value}}).fireUnit.emitter;
   const before=data.emitter;data.emitter=next;try{supply();placeEmitter();}catch(error){data.emitter=before;placeEmitter();throw error;}},
  syncPose(){
   let next;try{next=checkedFireUnitPose({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()});}
   catch(error){root.position.fromArray(accepted.position);root.rotation.set(...accepted.rotation);root.scale.fromArray(accepted.scale);throw error;}
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
   root.visible=visible;fine.visible=helpers;outer.visible=helpers;emitter.visible=helpers;
   if(paused!==lastPaused){runtime.setSimulationPaused(paused);lastPaused=paused;}if(visible!==desired)void owner.setVisible(visible);
  },
  async dispose(){if(disposed)return;disposed=true;desired=false;await activity.catch(()=>{});await runtime.dispose();active=false;root.removeFromParent();proxy.removeFromParent();
   for(const h of [fine,outer,emitter]){h.geometry.dispose();h.material.dispose();}},
 };
 root.userData.fireUnitOwner=owner;placeEmitter();updateBounds();return owner;
}
