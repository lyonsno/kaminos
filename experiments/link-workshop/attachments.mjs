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
// Objects retain scene registration and native editing. History records offsets
// and restores them through the current joint frame, independent of playback.
export function createAttachmentFollower(root,objects){
 const last=new Map(),histories=new Map();let current=null,fraction=0;
 const relative=(a,world)=>pose(jointMatrix(root,current,a.joint,fraction).invert().multiply(world));
 const worldFor=a=>jointMatrix(root,current,a.joint,fraction).multiply(matrix(a.offset));
 function release(id){histories.get(id)?.release();histories.delete(id);last.delete(id);}
 return {reset(){last.clear();},dispose(){for(const id of histories.keys())release(id);},update(model,t){
  current=model;fraction=t;const entries=objects(),present=new Set();let changed=false;
  for(const a of model.attachments??[]){const entry=entries.find(e=>e.id===a.objectId),object=entry?.object;if(!object?.parent)continue;present.add(a.objectId);
   if(histories.get(a.objectId)?.object!==object){release(a.objectId);const binding=()=>current.attachments.find(v=>v.objectId===a.objectId);
    const releaseHistory=registerSceneObjectPoseHistory(object,{
     capture(value){object.parent.updateWorldMatrix(true,false);return {...value,linkAttachment:relative(binding(),object.parent.matrixWorld.clone().multiply(matrix(value)))};},
     restore(value){if(!value.linkAttachment)return value;const bound=binding();bound.offset=structuredClone(value.linkAttachment);const world=worldFor(bound);object.parent.updateWorldMatrix(true,false);last.set(a.objectId,{object,matrix:world.clone()});return pose(object.parent.matrixWorld.clone().invert().multiply(world));}
    });histories.set(a.objectId,{object,release:releaseHistory});
   }
   object.updateWorldMatrix(true,false);const previous=last.get(a.objectId);
   if(previous&&previous.object===object&&!object.matrixWorld.equals(previous.matrix))a.offset=relative(a,object.matrixWorld);
   const world=worldFor(a);object.parent.updateWorldMatrix(true,false);
   if(!object.matrixWorld.equals(world))changed=true;
   const local=object.parent.matrixWorld.clone().invert().multiply(world);local.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);
   last.set(a.objectId,{object,matrix:object.matrixWorld.clone()});
  }
  for(const id of histories.keys())if(!present.has(id))release(id);return changed;
 }};
}
