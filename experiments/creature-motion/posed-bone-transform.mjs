import {Matrix4,Vector3,Quaternion,Euler} from '../../lib/three.core.js';
import {checkedPose} from '../../scene-edit-session.mjs';
export function boneWorldPose(bone){bone.updateWorldMatrix(true,false);const p=new Vector3(),q=new Quaternion(),s=new Vector3();bone.matrixWorld.decompose(p,q,s);const e=new Euler().setFromQuaternion(q);return {position:p.toArray(),rotation:[e.x,e.y,e.z],scale:s.toArray()};}
export function checkedBoneWorldPose(bone,pose){
 pose=checkedPose(pose);bone.parent?.updateWorldMatrix(true,false);
 const world=new Matrix4().compose(new Vector3(...pose.position),new Quaternion().setFromEuler(new Euler(...pose.rotation)),new Vector3(...pose.scale));
 const parent=bone.parent?.matrixWorld??new Matrix4();if(Math.abs(parent.determinant())<1e-10)throw Error('Posing requires an invertible parent frame');
 const local=parent.clone().invert().multiply(world),p=new Vector3(),q=new Quaternion(),scale=new Vector3();local.decompose(p,q,scale);
 const rigid=new Matrix4().compose(p,q,new Vector3(1,1,1));
 if(local.elements.some((v,i)=>Math.abs(v-rigid.elements[i])>1e-6))throw Error('Posed Bones use rigid transforms; change proportions in the rest-skeleton editor');
 return {pose,p,q};
}
export function applyBoneWorldPose(bone,pose){const {p,q}=checkedBoneWorldPose(bone,pose);bone.position.copy(p);bone.quaternion.copy(q);bone.scale.set(1,1,1);bone.updateWorldMatrix(true,true);}
