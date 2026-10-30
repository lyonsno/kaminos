import * as T from '../../lib/three.core.js';
import {frames} from './model.mjs';
const pose=m=>{const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();m.decompose(p,q,s);const e=new T.Euler().setFromQuaternion(q);return {position:p.toArray(),rotation:[e.x,e.y,e.z],scale:s.toArray()};};
const matrix=p=>new T.Matrix4().compose(new T.Vector3(...p.position),new T.Quaternion().setFromEuler(new T.Euler(...p.rotation)),new T.Vector3(...p.scale));
export function jointMatrix(root,model,joint,t){const f=frames(model,t)[joint];if(!f)throw Error('Choose a joint');root.updateWorldMatrix(true,false);return root.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(...f.point,0)).multiply(new T.Matrix4().makeRotationZ(f.angle));}
export function attachmentFrame(root,model,joint,t,object){object.updateWorldMatrix(true,false);return pose(jointMatrix(root,model,joint,t).invert().multiply(object.matrixWorld));}
// Objects retain their scene registration and native transform editing. A changed
// native transform becomes an edited offset; motion writes never enter history.
export function createAttachmentFollower(root,objects){
 const last=new Map();
 return {reset(){last.clear();},update(model,t){
  const entries=objects(),present=new Set();let changed=false;
  for(const a of model.attachments??[]){const entry=entries.find(e=>e.id===a.objectId),object=entry?.object;if(!object?.parent)continue;present.add(a.objectId);
   object.updateWorldMatrix(true,false);const previous=last.get(a.objectId);
   if(previous&&previous.object===object&&!object.matrixWorld.equals(previous.matrix))a.offset=attachmentFrame(root,model,a.joint,t,object);
   const world=jointMatrix(root,model,a.joint,t).multiply(matrix(a.offset));object.parent.updateWorldMatrix(true,false);
   if(!object.matrixWorld.equals(world))changed=true;
   const local=object.parent.matrixWorld.clone().invert().multiply(world);local.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);
   last.set(a.objectId,{object,matrix:object.matrixWorld.clone()});
  }
  for(const id of last.keys())if(!present.has(id))last.delete(id);return changed;
 }};
}
