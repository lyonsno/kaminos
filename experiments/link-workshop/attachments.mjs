import * as T from '../../lib/three.core.js';
import {registerSceneObjectPoseHistory} from '../../scene-object-pose-history.mjs';
import {frames} from './model.mjs';
const pose=m=>{const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();m.decompose(p,q,s);const e=new T.Euler().setFromQuaternion(q);return {position:p.toArray(),rotation:[e.x,e.y,e.z],scale:s.toArray()};};
const matrix=p=>new T.Matrix4().compose(new T.Vector3(...p.position),new T.Quaternion().setFromEuler(new T.Euler(...p.rotation)),new T.Vector3(...p.scale));
// A joint carries a rigid mounting frame. Scaling the construction changes joint
// positions, not the independently authored dimensions of a carried scene object.
export function jointMatrix(root,model,joint,t){
 const f=frames(model,t)[joint];if(!f)throw Error('Choose a joint');root.updateWorldMatrix(true,false);
 const position=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),rotation=root.getWorldQuaternion(new T.Quaternion()).normalize().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle));
 return new T.Matrix4().compose(position,rotation,new T.Vector3(1,1,1));
}
export function attachmentFrame(root,model,joint,t,object){object.updateWorldMatrix(true,false);return pose(jointMatrix(root,model,joint,t).invert().multiply(object.matrixWorld));}
// History belongs to the scene relationship, not to a transient controller.
// Weak keys let a destroyed payload release its adapter naturally. An unattached
// payload uses ordinary pose history; reattachment reuses the same adapter.
const historyOwners=new WeakMap(),liveFrames=new WeakMap();
function retainHistory(object,objectId,objects){
 let owner=historyOwners.get(object);if(owner){owner.objects=objects;return owner;}
 owner={objects,last:null};
 const binding=()=>{
  for(const entry of owner.objects()){
   const root=entry.object,model=root?.userData.linkMechanism,a=model?.attachments?.find(v=>v.objectId===objectId);
   if(a)return {root,model,a,t:liveFrames.get(root)??0};
  }
  return null;
 };
 registerSceneObjectPoseHistory(object,{
  capture(value){const b=binding();if(!b)return value;object.parent.updateWorldMatrix(true,false);const world=object.parent.matrixWorld.clone().multiply(matrix(value));return {...value,linkAttachment:pose(jointMatrix(b.root,b.model,b.a.joint,b.t).invert().multiply(world))};},
  restore(value){if(!value.linkAttachment)return value;const b=binding();if(!b)throw Error('Restore the attachment before replaying its offset');b.a.offset=structuredClone(value.linkAttachment);const world=jointMatrix(b.root,b.model,b.a.joint,b.t).multiply(matrix(b.a.offset));object.parent.updateWorldMatrix(true,false);owner.last=world.clone();return pose(object.parent.matrixWorld.clone().invert().multiply(world));}
 });historyOwners.set(object,owner);return owner;
}
export function createAttachmentFollower(root,objects){
 const tracked=new Map();
 // Standalone followers can omit the construction from their lookup; the app
 // supplies it under its durable scene ID so reconstruction resolves a new root.
 const entries=objects().some(e=>e.object===root)?objects:()=>[...objects(),{id:root.uuid,object:root}];
 return {reset(){for(const owner of tracked.values())owner.last=null;},dispose(){liveFrames.delete(root);tracked.clear();},update(model,t){
  root.userData.linkMechanism=model;liveFrames.set(root,t);const all=entries(),present=new Set();let changed=false;
  for(const a of model.attachments??[]){const entry=all.find(e=>e.id===a.objectId),object=entry?.object;if(!object?.parent)continue;present.add(a.objectId);
   const owner=retainHistory(object,a.objectId,entries);tracked.set(a.objectId,owner);object.updateWorldMatrix(true,false);
   if(owner.last&&!object.matrixWorld.equals(owner.last))a.offset=attachmentFrame(root,model,a.joint,t,object);
   const world=jointMatrix(root,model,a.joint,t).multiply(matrix(a.offset));object.parent.updateWorldMatrix(true,false);
   if(!object.matrixWorld.equals(world))changed=true;
   const local=object.parent.matrixWorld.clone().invert().multiply(world);local.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);owner.last=object.matrixWorld.clone();
  }
  for(const id of tracked.keys())if(!present.has(id))tracked.delete(id);return changed;
 }};
}
