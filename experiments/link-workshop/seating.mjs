import {copyMechanism} from './recipe-state.mjs';
import * as T from '../../lib/three.core.js';
import {previewMountMatrix,attachmentBase,frameMatrix,matrixFrame,hingeAngle,hingeWorldFrame} from './mounts.mjs';
import {hingeMountFrames} from './hinge-primitives.mjs';

export function seatingFrame(root,model,objectId,t,entries){
 const binding=model.attachments?.find(a=>a.objectId===objectId&&a.targetMount);
 if(!binding)throw Error('Choose an existing fastening');
 return previewMountMatrix(root,model,binding.sourceMount,t,entries);
}
// Adjust the contact frame in its mating face's tangent plane. Existing
// tilt and normal offset are retained, so entering edit never silently reseats
// an older freely positioned connection. This is a plane, not detected face bounds.
export function adjustSeating(root,model,objectId,t,entries,requested){
 const next=copyMechanism(model),a=next.attachments?.find(a=>a.objectId===objectId&&a.targetMount);
 if(!a)throw Error('Choose an existing fastening');
 for(const k of ['position','rotation'])if(!requested[k]?.every(Number.isFinite)||requested[k].length!==3)throw Error('Finite seating transform required');
 const poseT=Array.isArray(a.hinge)&&(requested.mode==='A'||requested.mode==='B')?(requested.mode==='B'?1:0):t;
 const target=previewMountMatrix(root,model,a.targetMount,poseT,entries),source=seatingFrame(root,model,objectId,poseT,entries);
 const targetQ=new T.Quaternion().setFromRotationMatrix(target);
 const face=a.hardware?.mounting==='part-frames'?hingeWorldFrame(root,model,a,poseT,entries).multiply(new T.Matrix4().makeRotationZ(hingeAngle(a,poseT))).multiply(frameMatrix(hingeMountFrames(a.hardware).moving)):target;
 const normal=new T.Vector3(0,0,1).transformDirection(face);
 const oldP=new T.Vector3().setFromMatrixPosition(source),oldQ=new T.Quaternion().setFromRotationMatrix(source);
 const delta=new T.Vector3(...requested.position).sub(oldP);delta.addScaledVector(normal,-delta.dot(normal));
 const turn=new T.Quaternion().setFromEuler(new T.Euler(...requested.rotation)).multiply(oldQ.clone().invert());
 if(turn.w<0)turn.set(-turn.x,-turn.y,-turn.z,-turn.w);
 const hasAxle=a.axle||a.hardware?.mounting==='part-frames',hingeNormal=hasAxle?new T.Vector3(0,0,1).transformDirection(hingeWorldFrame(root,model,a,poseT,entries)):normal;
 const axial=turn.x*hingeNormal.x+turn.y*hingeNormal.y+turn.z*hingeNormal.z,mag=Math.hypot(turn.x,turn.y,turn.z);
 const dir=Math.abs(axial)>1e-3*mag?Math.sign(axial):Math.sign(turn.z||turn.y||turn.x||1);
 const angle=Math.hypot(mag,turn.w)<1e-12?0:2*dir*Math.atan2(mag,turn.w);
 if(hasAxle&&(requested.mode==='A'||requested.mode==='B')){
  a.hinge[requested.mode==='B'?1:0]+=angle;
  const base=attachmentBase(root,next,a,poseT,entries),bq=new T.Quaternion().setFromRotationMatrix(base).invert();
  const localDelta=delta.applyQuaternion(bq);a.offset.position=a.offset.position.map((x,i)=>x+localDelta.getComponent(i));return next;
 }
 const q=new T.Quaternion().setFromAxisAngle(normal,angle).multiply(oldQ);
 if(a.hardware?.mounting==='part-frames'){
  const sourceMount=next.mounts.find(m=>m.id===a.sourceMount),objectQ=q.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(...sourceMount.rotation)).invert()),scale=new T.Vector3(...a.offset.scale),position=oldP.clone().add(delta).sub(new T.Vector3(...sourceMount.position).multiply(scale).applyQuaternion(objectQ));
  a.offset=matrixFrame(attachmentBase(root,next,a,poseT,entries,scale).invert().multiply(new T.Matrix4().compose(position,objectQ,scale)));return next;
 }
 if(Array.isArray(a.hinge)&&(requested.mode==='A'||requested.mode==='B'))a.hinge[requested.mode==='B'?1:0]+=angle;
 const unhingedQ=new T.Quaternion().setFromAxisAngle(hingeNormal,-hingeAngle(a,poseT)).multiply(q);
 const m=next.mounts.find(m=>m.id===a.sourceMount),objectQ=unhingedQ.multiply(new T.Quaternion().setFromEuler(new T.Euler(...m.rotation)).invert());
 const scale=new T.Vector3(...a.offset.scale),contact=oldP.add(delta);
 if(a.axle){const r=new T.Vector3(...a.axle.position).applyQuaternion(targetQ);contact.sub(r).add(r.clone().applyAxisAngle(hingeNormal,hingeAngle(a,poseT)));}
 const position=contact.sub(new T.Vector3(...m.position).multiply(scale).applyQuaternion(objectQ));
 const world=new T.Matrix4().compose(position,objectQ,scale);
 a.offset=matrixFrame(attachmentBase(root,next,a,poseT,entries,scale,{unhinged:true}).invert().multiply(world));
 return next;
}
