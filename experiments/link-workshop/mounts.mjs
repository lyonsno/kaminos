import * as T from '../../lib/three.core.js';
import {frames} from './model.mjs';
export const identityFrame=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
export const frameMatrix=p=>new T.Matrix4().compose(new T.Vector3(...p.position),new T.Quaternion().setFromEuler(new T.Euler(...p.rotation)),new T.Vector3(...(p.scale??[1,1,1])));
export function matrixFrame(m){const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();m.decompose(p,q,s);const e=new T.Euler().setFromQuaternion(q);return {position:p.toArray(),rotation:[e.x,e.y,e.z],scale:s.toArray()};}
export function rigidMatrix(object){object.updateWorldMatrix(true,false);return new T.Matrix4().compose(object.getWorldPosition(new T.Vector3()),object.getWorldQuaternion(new T.Quaternion()).normalize(),new T.Vector3(1,1,1));}
export function jointMatrix(root,model,joint,t){const f=frames(model,t)[joint];if(!f)throw Error('Choose a joint');root.updateWorldMatrix(true,false);return new T.Matrix4().compose(new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),root.getWorldQuaternion(new T.Quaternion()).normalize().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle)),new T.Vector3(1,1,1));}
export function mountOwnerMatrix(root,model,mount,t,entries){
 if(mount.owner.joint!==undefined)return jointMatrix(root,model,mount.owner.joint,t);
 const object=entries.find(e=>e.id===mount.owner.objectId)?.object;if(!object)throw Error(`Missing mount object: ${mount.owner.objectId}`);object.updateWorldMatrix(true,false);return object.matrixWorld.clone();
}
export function mountMatrix(root,model,id,t,entries){const m=model.mounts?.find(m=>m.id===id);if(!m)throw Error('Unknown mount');const full=mountOwnerMatrix(root,model,m,t,entries).multiply(frameMatrix(m)),p=new T.Vector3().setFromMatrixPosition(full);let q;
 if(m.owner.joint!==undefined)q=new T.Quaternion().setFromRotationMatrix(jointMatrix(root,model,m.owner.joint,t));else q=entries.find(e=>e.id===m.owner.objectId).object.getWorldQuaternion(new T.Quaternion()).normalize();q.multiply(new T.Quaternion().setFromEuler(new T.Euler(...m.rotation)));return new T.Matrix4().compose(p,q,new T.Vector3(1,1,1));}
export function attachmentBase(root,model,a,t,entries,scaleOverride){
 if(!a.targetMount)return jointMatrix(root,model,a.joint,t);
 const target=mountMatrix(root,model,a.targetMount,t,entries),source=model.mounts.find(m=>m.id===a.sourceMount),object=entries.find(e=>e.id===a.objectId)?.object;if(!source||!object)throw Error('Missing fastening source');
 object.updateWorldMatrix(true,false);const scale=scaleOverride??object.getWorldScale(new T.Vector3()),q=new T.Quaternion().setFromRotationMatrix(target).multiply(new T.Quaternion().setFromEuler(new T.Euler(...source.rotation)).invert()),p=new T.Vector3().setFromMatrixPosition(target).sub(new T.Vector3(...source.position).multiply(scale).applyQuaternion(q));return new T.Matrix4().compose(p,q,new T.Vector3(1,1,1));
}
// Edges express who must be positioned first. This handles mount owners as well
// as mechanism roots; cycles require a solver and cannot be fastened kinematically.
export function connectionOrder(entries,overrideRoot,overrideModel){
 const edges=new Map(entries.map(e=>[e.id,new Set()])),attached=new Set();
 for(const entry of entries){const m=entry.object===overrideRoot?overrideModel:entry.object?.userData.linkMechanism;if(!m)continue;
  for(const a of m.attachments??[]){if(attached.has(a.objectId))throw Error('Object is already attached');attached.add(a.objectId);const target=a.targetMount?m.mounts.find(v=>v.id===a.targetMount):null,dependency=target?.owner.objectId??entry.id;if(dependency===a.objectId)throw Error('A fastening cannot attach an object to itself');edges.get(a.objectId)?.add(dependency);}
 }
 const order=[],visiting=new Set(),done=new Set();function visit(id){if(visiting.has(id))throw Error('Connection would create a cycle; detach a connection first');if(done.has(id))return;visiting.add(id);for(const d of edges.get(id)??[])visit(d);visiting.delete(id);done.add(id);order.push(id);}for(const id of edges.keys())visit(id);return order;
}
export const checkConnections=(root,model,entries)=>connectionOrder(entries,root,model);

// Preview this construction's authored pose without mutating the live scene.
// Objects driven elsewhere retain their current placement for this preview.
export function previewMountMatrix(root,model,id,t,entries){
 const resolving=new Set(),cache=new Map();
 function ownerWorld(objectId){if(cache.has(objectId))return cache.get(objectId);if(resolving.has(objectId))throw Error('Mount preview cycle');resolving.add(objectId);const entry=entries.find(e=>e.id===objectId);if(!entry)throw Error('Missing preview object');entry.object.updateWorldMatrix(true,false);const a=model.attachments?.find(a=>a.objectId===objectId);let world=entry.object.matrixWorld.clone();
  if(a){if(a.targetMount){const target=resolve(a.targetMount),source=model.mounts.find(m=>m.id===a.sourceMount),scale=new T.Vector3(...a.offset.scale),q=new T.Quaternion().setFromRotationMatrix(target).multiply(new T.Quaternion().setFromEuler(new T.Euler(...source.rotation)).invert()),p=new T.Vector3().setFromMatrixPosition(target).sub(new T.Vector3(...source.position).multiply(scale).applyQuaternion(q));world=new T.Matrix4().compose(p,q,new T.Vector3(1,1,1)).multiply(frameMatrix(a.offset));}else world=jointMatrix(root,model,a.joint,t).multiply(frameMatrix(a.offset));}
  resolving.delete(objectId);cache.set(objectId,world);return world;
 }
 function resolve(mid){const m=model.mounts.find(m=>m.id===mid);if(!m)throw Error('Unknown preview mount');const owner=m.owner.joint!==undefined?jointMatrix(root,model,m.owner.joint,t):ownerWorld(m.owner.objectId),p=new T.Vector3(...m.position).applyMatrix4(owner),q=new T.Quaternion(),scale=new T.Vector3();owner.decompose(new T.Vector3(),q,scale);q.normalize().multiply(new T.Quaternion().setFromEuler(new T.Euler(...m.rotation)));return new T.Matrix4().compose(p,q,new T.Vector3(1,1,1));}
 return resolve(id);
}
