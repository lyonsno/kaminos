import {Matrix4,Vector3,Quaternion,Euler} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
export const GROUP_TYPE='group';
export const identityGroupPose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
export function checkedGroupPose(raw){const pose=checkedPose(raw);if(pose.scale.some(v=>v===0))throw Error('A group frame must have nonzero scale');return pose;}
const matrix=pose=>new Matrix4().compose(new Vector3(...pose.position),new Quaternion().setFromEuler(new Euler(...pose.rotation)),new Vector3(...pose.scale));
export function moveGroupMembers(before,after,members,{pivot='median',orientation='world'}={}) {
 before=checkedGroupPose(before);after=checkedGroupPose(after);
 if(JSON.stringify(before)===JSON.stringify(after))return structuredClone(members);
 const delta=matrix(after).multiply(matrix(before).invert());
 return Object.fromEntries(Object.entries(members).map(([id,raw])=>{
  if(pivot==='individual'&&orientation==='local'){
   const base=checkedPose(raw),q=new Quaternion().setFromEuler(new Euler(...base.rotation));
   const localDelta=new Quaternion().setFromEuler(new Euler(...before.rotation)).invert().multiply(new Quaternion().setFromEuler(new Euler(...after.rotation)));
   const e=new Euler().setFromQuaternion(q.multiply(localDelta));
   return [id,{position:base.position.map((v,i)=>v+after.position[i]-before.position[i]),rotation:[e.x,e.y,e.z],scale:base.scale.map((v,i)=>v*after.scale[i]/before.scale[i])}];
  }
  const target=delta.clone().multiply(matrix(checkedPose(raw)));
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();target.decompose(position,rotation,scale);
  const euler=new Euler().setFromQuaternion(rotation);const pose={position:position.toArray(),rotation:[euler.x,euler.y,euler.z],scale:scale.toArray()};
  const reconstructed=matrix(pose);const extent=Math.max(1,...target.elements.map(Math.abs));
  if(target.elements.some((v,i)=>Math.abs(v-reconstructed.elements[i])>1e-7*extent))throw Error('This group scale introduces shear; use uniform scale or scale the child');
  if(pivot==='individual')pose.position=raw.position.map((v,i)=>v+after.position[i]-before.position[i]);
  return [id,pose];
 }));
}
export function checkedGroupEdit(raw){const pose=checkedGroupPose(raw),frame=checkedGroupPose(raw.frame);if(!raw.members||typeof raw.members!=='object'||Array.isArray(raw.members))throw Error('Group edit requires member poses');return {...pose,frame,members:Object.fromEntries(Object.entries(raw.members).map(([id,p])=>[id,checkedPose(p)]))};}
