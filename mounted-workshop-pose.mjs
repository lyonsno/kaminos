import {Matrix4,Vector3,Quaternion,Euler} from './lib/three.core.js';
const matrix=pose=>new Matrix4().compose(new Vector3().fromArray(pose.position),new Quaternion().setFromEuler(new Euler(...pose.rotation)),new Vector3().fromArray(pose.scale));
function pose(matrix){const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();matrix.decompose(position,rotation,scale);const euler=new Euler().setFromQuaternion(rotation);return {position:position.toArray(),rotation:[euler.x,euler.y,euler.z],scale:scale.toArray()};}
export function mountedWorldPose(root){root.updateWorldMatrix(true,false);return pose(root.matrixWorld);}
export function mountedLocalPose(root,value){root.parent?.updateWorldMatrix(true,false);return pose(root.parent?root.parent.matrixWorld.clone().invert().multiply(matrix(value)):matrix(value));}
function localToWorld(root,value){root.parent?.updateWorldMatrix(true,false);return pose(root.parent?root.parent.matrixWorld.clone().multiply(matrix(value)):matrix(value));}

// The selection proxy is in world coordinates. Its history keeps mounted roots
// in authored coordinates, so moving the presentation frame cannot rewrite Undo.
export function createMountedSelectionHistory(find){
 return {
  capture(value){const result=structuredClone(value),ids=[];for(const [id,p]of Object.entries(result.roots??{})){const root=find(id);if(root?.userData.kaminosMountedWorkshop){result.roots[id]=mountedLocalPose(root,p);ids.push(id);}}if(ids.length)result.mountedLocalRoots=ids;return result;},
  restore(value){const result=structuredClone(value);for(const id of result.mountedLocalRoots??[]){const root=find(id);if(!root)throw Error('Mounted selection root is absent');result.roots[id]=localToWorld(root,result.roots[id]);}if(result.mountedLocalRoots?.length){result.frame={position:[...result.position],rotation:[...result.rotation],scale:[...result.scale]};delete result.mountedLocalRoots;}return result;},
 };
}
