import {Matrix4,Vector3,Quaternion,Euler} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
import {normalizeBurner} from './annular-burner.mjs';
export const BURNER_BED_TYPE='burner-bed';
export const BURNER_BED_SOURCE='kaminos:annular-bed';
export const BURNER_ASSEMBLY_TYPE='burner-assembly';
export const identityAssemblyPose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
export function checkedAssemblyPose(value) {
 const pose=checkedPose(value),scale=pose.scale[0];
 if(!(scale>0)||pose.scale.some(v=>Math.abs(v-scale)>1e-10*scale))throw Error('Assembly requires positive uniform scale; use S without an axis');
 return pose;
}
export function checkedBurnerBed(record) {
 if(record.source!==BURNER_BED_SOURCE)throw Error('Unsupported burner bed source');
 const burner=normalizeBurner(record.burner);
 if(!burner)throw Error('Burner bed requires its geometry recipe');
 return {...record,transform:checkedAssemblyPose(record.transform),burner};
}
const matrix=pose=>new Matrix4().compose(new Vector3(...pose.position),new Quaternion().setFromEuler(new Euler(...pose.rotation)),new Vector3(...pose.scale));
export function moveAssemblyMembers(before,after,members) {
 before=checkedAssemblyPose(before);after=checkedAssemblyPose(after);
 if(JSON.stringify(before)===JSON.stringify(after))return structuredClone(members);
 const delta=matrix(after).multiply(matrix(before).invert());
 return Object.fromEntries(Object.entries(members).map(([id,pose])=>{
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
  delta.clone().multiply(matrix(checkedPose(pose))).decompose(position,rotation,scale);
  const euler=new Euler().setFromQuaternion(rotation);
  return [id,{position:position.toArray(),rotation:[euler.x,euler.y,euler.z],scale:scale.toArray()}];
 }));
}
export function checkedAssemblyEdit(value) {
 const pose=checkedAssemblyPose(value),frame=checkedAssemblyPose(value.frame);
 if(!value.members||typeof value.members!=='object'||Array.isArray(value.members))throw Error('Assembly edit requires member poses');
 return {...pose,frame,members:Object.fromEntries(Object.entries(value.members).map(([id,pose])=>[id,checkedPose(pose)]))};
}
