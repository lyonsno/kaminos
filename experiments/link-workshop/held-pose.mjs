import * as T from '../../lib/three.core.js';
import {copyMechanism} from './recipe-state.mjs';
import {previewMountMatrix,frameMatrix,hingeWorldFrame} from './mounts.mjs';
import {reachChain} from './planar-reach.mjs';
import {frames} from './model.mjs';
const position=m=>new T.Vector3().setFromMatrixPosition(m),rotation=m=>new T.Quaternion().setFromRotationMatrix(m),axis=m=>new T.Vector3(0,0,1).transformDirection(m);
// Keep solver math in matrices; Euler's broad gimbal threshold must not erase
// a small physical rotation. Use the exact XYZ branch until the actual pole.
function rigidFrame(m){
 const q=rotation(m).normalize(),e=new T.Matrix4().makeRotationFromQuaternion(q).elements,cy=Math.hypot(e[0],e[4]);
 return {position:position(m).toArray(),rotation:[cy>1e-12?Math.atan2(-e[9],e[10]):Math.atan2(e[6],e[5]),Math.atan2(e[8],cy),cy>1e-12?Math.atan2(-e[4],e[0]):0],scale:[1,1,1]};
}
function heldMatrix(root,model,objectId,t,entries){
 const a=model.attachments.find(a=>a.objectId===objectId);if(!a?.sourceMount)throw Error('Choose a mounted panel');
 const world=previewMountMatrix(root,model,a.sourceMount,t,entries);
 // Older saved holds refer to the source mounting frame. New panel holds use
 // the body frame, so editing that source mount cannot move the held target.
 if(model.poseHold?.space==='object'){
  const source=model.mounts.find(m=>m.id===a.sourceMount),local=frameMatrix({...source,position:source.position.map((v,i)=>v*a.offset.scale[i]),scale:[1,1,1]});world.multiply(local.invert());
 }
 return world;
}
export function holdFrame(root,model,objectId,t,entries){return rigidFrame(heldMatrix(root,model,objectId,t,entries));}
export function heldChain(model,edited){
 const result=[],seen=new Set();let id=model.poseHold?.objectId;
 while(id){if(seen.has(id))return [];seen.add(id);const a=model.attachments?.find(a=>a.objectId===id);if(!a)break;result.unshift(a);id=model.mounts.find(m=>m.id===a.targetMount)?.owner.objectId;}
 return result.some(a=>a.objectId===edited)?result:[];
}
export function heldPoseState(root,model,t,entries){
 if(!model.poseHold)return null;
 try{const desired=frameMatrix(model.poseHold.target),actual=heldMatrix(root,model,model.poseHold.objectId,t,entries),positionError=position(desired).distanceTo(position(actual)),angleError=rotation(desired).angleTo(rotation(actual));return {objectId:model.poseHold.objectId,pose:model.poseHold.pose,target:model.poseHold.target,actual:rigidFrame(actual),positionError,angleError,status:positionError<1e-6&&angleError<1e-6?'held':'unreachable'};}catch(error){return {objectId:model.poseHold.objectId,status:'missing',reason:error.message};}
}
// Hold the full downstream mounting pose by changing actual revolute angles.
// Finite planar reach preserves rigid spans between parallel axes; the final
// hinge restores orientation. Offsets and body geometry are never rewritten.
export function accommodateHeldPose(root,model,edited,t,entries){
 const next=copyMechanism(model),chain=heldChain(next,edited),state=()=>heldPoseState(root,next,t,entries);
 if(!next.poseHold||!chain.length||t!==(next.poseHold.pose==='B'?1:0))return {recipe:next,...state(),status:'unaffected'};
 const unsupported=reason=>({recipe:next,...state(),status:'unsupported',reason});
 if(chain.some(a=>!a.hinge||a.hardware?.mounting!=='part-frames'))return unsupported('Hold pose needs a chain of mounted revolute hinges');
 const joints=()=>chain.map(a=>hingeWorldFrame(root,next,a,t,entries)),initial=joints(),normal=axis(initial[0]),x=new T.Vector3(1,0,0).transformDirection(initial[0]),y=normal.clone().cross(x),origin=position(initial[0]),points=initial.map(position),last=chain.at(-1),current=heldMatrix(root,next,last.objectId,t,entries),desired=frameMatrix(next.poseHold.target);
 if(initial.some(m=>axis(m).dot(normal)<1-1e-7))return unsupported('Hinge axes must be parallel and point the same way');
 const turn=rotation(desired).multiply(rotation(current).invert());
 if(normal.clone().applyQuaternion(turn).dot(normal)<1-1e-7)return unsupported('The held orientation requires a non-planar hinge axis');
 const wanted=position(desired).sub(position(current).sub(points.at(-1)).applyQuaternion(turn)),xy=p=>{const d=p.clone().sub(origin);return [d.dot(x),d.dot(y)];};
 if(chain.length>1){
  const old=points.map(xy),virtual={nodes:[{parent:null,point:[0,0]}]};let parentAngle=0;
  for(let i=1;i<old.length;i++){const dx=old[i][0]-old[i-1][0],dy=old[i][1]-old[i-1][1],length=Math.hypot(dx,dy);if(length<1e-7)return unsupported('Separate the intervening hinge centers');const angle=Math.atan2(dy,dx);virtual.nodes.push({parent:i-1,length,angles:[angle-parentAngle,angle-parentAngle]});parentAngle=angle;}
  const solved=frames(reachChain(virtual,old.length-1,xy(wanted),'A'),0).map(f=>origin.clone().addScaledVector(x,f.point[0]).addScaledVector(y,f.point[1]));
  for(let i=0;i<chain.length-1;i++){const live=joints(),from=position(live[i+1]).sub(position(live[i])),to=solved[i+1].clone().sub(solved[i]);from.addScaledVector(normal,-from.dot(normal)).normalize();to.normalize();const delta=Math.atan2(normal.dot(from.clone().cross(to)),from.dot(to));chain[i].hinge[t]+=delta;}
 }
 const actual=heldMatrix(root,next,last.objectId,t,entries),q=rotation(desired).multiply(rotation(actual).invert());if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);
 last.hinge[t]+=2*Math.atan2(q.x*normal.x+q.y*normal.y+q.z*normal.z,q.w);
 return {recipe:next,...state()};
}
