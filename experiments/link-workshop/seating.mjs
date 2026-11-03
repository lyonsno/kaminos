import * as T from '../../lib/three.core.js';
import {previewMountMatrix,attachmentBase,matrixFrame,hingeAngle} from './mounts.mjs';

export function seatingFrame(root,model,objectId,t,entries){
 const binding=model.attachments?.find(a=>a.objectId===objectId&&a.targetMount);
 if(!binding)throw Error('Choose an existing fastening');
 return previewMountMatrix(root,model,binding.sourceMount,t,entries);
}
// Adjust the contact frame in the receiving mount's tangent plane. Existing
// tilt and normal offset are retained, so entering edit never silently reseats
// an older freely positioned connection. This is a plane, not detected face bounds.
export function adjustSeating(root,model,objectId,t,entries,requested){
 const next=structuredClone(model),a=next.attachments?.find(a=>a.objectId===objectId&&a.targetMount);
 if(!a)throw Error('Choose an existing fastening');
 for(const k of ['position','rotation'])if(!requested[k]?.every(Number.isFinite)||requested[k].length!==3)throw Error('Finite seating transform required');
 const poseT=Array.isArray(a.hinge)&&(requested.mode==='A'||requested.mode==='B')?(requested.mode==='B'?1:0):t;
 const target=previewMountMatrix(root,model,a.targetMount,poseT,entries),source=seatingFrame(root,model,objectId,poseT,entries);
 const targetQ=new T.Quaternion().setFromRotationMatrix(target),normal=new T.Vector3(0,0,1).applyQuaternion(targetQ);
 const oldP=new T.Vector3().setFromMatrixPosition(source),oldQ=new T.Quaternion().setFromRotationMatrix(source);
 const delta=new T.Vector3(...requested.position).sub(oldP);delta.addScaledVector(normal,-delta.dot(normal));
 const turn=new T.Quaternion().setFromEuler(new T.Euler(...requested.rotation)).multiply(oldQ.clone().invert());
 if(turn.w<0)turn.set(-turn.x,-turn.y,-turn.z,-turn.w);
 const axial=turn.x*normal.x+turn.y*normal.y+turn.z*normal.z,mag=Math.hypot(turn.x,turn.y,turn.z);
 const dir=Math.abs(axial)>1e-3*mag?Math.sign(axial):Math.sign(turn.z||turn.y||turn.x||1);
 const angle=Math.hypot(mag,turn.w)<1e-12?0:2*dir*Math.atan2(mag,turn.w);
 const q=new T.Quaternion().setFromAxisAngle(normal,angle).multiply(oldQ);
 if(Array.isArray(a.hinge)&&(requested.mode==='A'||requested.mode==='B'))a.hinge[requested.mode==='B'?1:0]+=angle;
 const unhingedQ=new T.Quaternion().setFromAxisAngle(normal,-hingeAngle(a,poseT)).multiply(q);
 const m=next.mounts.find(m=>m.id===a.sourceMount),objectQ=unhingedQ.multiply(new T.Quaternion().setFromEuler(new T.Euler(...m.rotation)).invert());
 const scale=new T.Vector3(...a.offset.scale),position=oldP.add(delta).sub(new T.Vector3(...m.position).multiply(scale).applyQuaternion(objectQ));
 const world=new T.Matrix4().compose(position,objectQ,scale);
 a.offset=matrixFrame(attachmentBase(root,next,a,poseT,entries,scale,{unhinged:true}).invert().multiply(world));
 return next;
}
