import {createWanderPath} from './wander-path.mjs';
import {deriveStanceTravel} from './stance-travel.mjs';

export function wanderAreaInPlacement({THREE,areaRoot,placement}) {
 placement.updateMatrixWorld(true);areaRoot.updateMatrixWorld(true);
 const m=new THREE.Matrix4().copy(placement.matrixWorld).invert().multiply(areaRoot.matrixWorld).elements;
 const [ux,uz,vx,vz]=[m[0],m[2],m[8],m[10]],det=ux*vz-uz*vx;
 if(!m.every(Number.isFinite)||det===0)throw Error('Wander area has a collapsed projected footprint');
 const a=ux*ux+vx*vx,b=uz*uz+vz*vz,c=ux*uz+vx*vz;
 const high=(a+b+Math.hypot(a-b,2*c))/2,low=det*det/high;
 if(!(low>0)||!Number.isFinite(high))throw Error('Wander area footprint is not representable');
 return {center:[m[12],m[14]],radii:[Math.sqrt(high),Math.sqrt(low)],yaw:.5*Math.atan2(2*c,a-b)};
}

// The owner supplies elapsed active time. This adapter creates no clock, makes
// no new joint motion and leaves source vertical action/local Bone poses intact.
export function createWanderMotion({THREE,adapter,walking,sourceKey,area,position,direction,seed=1,snapshot,pathSnapshot,pathReverse=false,pathFacing=null,travel='source'}={}) {
 if(typeof sourceKey!=='string'||!sourceKey)throw Error('Wander requires explicit motion/bind source identity');
 if(!Number.isInteger(adapter?.frames)||adapter.frames<2||!(adapter.fps>0))throw Error('Wander requires a retained multi-frame pose source');
 const poses=Array.from({length:adapter.frames},(_,i)=>adapter.frame(i));
 const root=poses[0].bones.findIndex(b=>b.parent===null);
 if(root<0)throw Error('Wander source has no actor root');
 const roots=poses.map(p=>p.bones[root].worldMatrix.slice(12,15)),distances=[0];
 for(let i=1;i<roots.length;i++)distances.push(distances[i-1]+Math.hypot(roots[i][0]-roots[i-1][0],roots[i][2]-roots[i-1][2]));
 const period=(adapter.frames-1)/adapter.fps;
 if(!['source','stance'].includes(travel))throw Error('Unknown wander travel policy');
 const sourceDistance=distances.at(-1),sourceForward=[roots.at(-1)[0]-roots[0][0],roots.at(-1)[2]-roots[0][2]];
 const transport=travel==='stance'?deriveStanceTravel({poses,fps:adapter.fps}):{kind:'source-root-distance',unitsPerSecond:sourceDistance/period,forward:sourceForward,contactSolver:false};
 const forward=transport.forward;
 if(!(transport.unitsPerSecond>0)||!(Math.hypot(...forward)>0))throw Error('Wander source has no horizontal root travel/direction');
 let elapsed=0,phase=0,reverse=false,heldFrame=null,path,facing=null,contactRate=1;
 if(snapshot!==undefined) {
  if(snapshot?.schema!=='kaminos.creature-wander-motion.v1'||snapshot.sourceKey!==sourceKey||!Number.isFinite(snapshot.elapsed)||snapshot.elapsed<0||(snapshot.heldFrame!==null&&(!Number.isInteger(snapshot.heldFrame)||snapshot.heldFrame<0||snapshot.heldFrame>=adapter.frames)))throw Error('Wander snapshot has invalid time, frame or source identity');
  if((snapshot.travel??'source')!==travel)throw Error('Wander snapshot travel policy differs from requested travel');
  if(snapshot.phase!==undefined&&!Number.isFinite(snapshot.phase)||snapshot.reverse!==undefined&&typeof snapshot.reverse!=='boolean')throw Error('Wander snapshot has invalid reverse phase');
  contactRate=snapshot.contactRate??1;if(!Number.isFinite(contactRate)||contactRate<0||contactRate>1)throw Error('Invalid physical gait rate');
  elapsed=snapshot.elapsed;phase=snapshot.phase??elapsed;reverse=snapshot.reverse??false;heldFrame=snapshot.heldFrame;facing=snapshot.facing??null;if(facing!==null&&!Number.isFinite(facing))throw Error('Invalid facing snapshot');path=createWanderPath({snapshot:snapshot.path});
 } else {
  if(typeof pathReverse!=='boolean')throw Error('Restored path reverse state must be a boolean');
  path=pathSnapshot?createWanderPath({snapshot:pathSnapshot}):createWanderPath({area,position,direction,seed});
  // A new retained clip resets its phase, but the existing travel tangent
  // still has the same relationship to the body's facing direction.
  reverse=pathSnapshot?pathReverse:false;
  if(pathFacing!==null&&!Number.isFinite(pathFacing))throw Error('Invalid path facing');facing=pathSnapshot?pathFacing:null;
 }
 function timing(time=phase) {
  const sourceFrames=time*adapter.fps,nearest=Math.round(sourceFrames);
  const stableFrames=Math.abs(sourceFrames-nearest)<=16*Number.EPSILON*Math.max(1,sourceFrames)?nearest:sourceFrames;
  const cycle=Math.floor(stableFrames/(adapter.frames-1)),fractional=stableFrames-cycle*(adapter.frames-1),index=Math.floor(fractional),next=Math.min(adapter.frames-1,index+1);
  return {cycle,frame:Math.min(adapter.frames-2,index),distance:travel==='stance'?time*transport.unitsPerSecond:cycle*sourceDistance+distances[index]+(distances[next]-distances[index])*(fractional-index)};
 }
 function read(){const t=timing();return {elapsed,phase,reverse,facing,cycle:Math.floor(elapsed/period),frame:heldFrame??t.frame,period,sourceDistance,sourceKey,contactRate,travel:structuredClone(transport),path:path.read()};}
 function advance(delta,{distanceScale=1,direction=null,admit=null,gaitScale=1}={}) {
  if(!Number.isFinite(delta)||delta<0)throw Error('Wander time delta must be finite and nonnegative');
  if(!Number.isFinite(distanceScale)||distanceScale<0||distanceScale>1)throw Error('Travel scale must be in [0,1]');
  if(!Number.isFinite(gaitScale)||gaitScale<0||gaitScale>1)throw Error('Gait scale must be in [0,1]');
  const prior=admit?save():null,from=admit?path.read():null;
  if(direction)path.redirect(direction);
  const previousElapsed=elapsed,previousPhase=phase,sign=reverse?-1:1,before=timing().distance,pathBefore=path.read().distance;elapsed+=delta;phase+=sign*delta;heldFrame=null;
  const distance=sign*(timing().distance-before);if(distance< -1e-8)throw Error('Wander source distance moved against the selected gait direction');
  path.advance(Math.max(0,distance)*distanceScale);
  const consumed=path.read().distance-pathBefore;
  if(consumed<distance-1e-10){
   // Stop the retained gait at the same travelled distance as the root.
   let low=previousElapsed,high=elapsed;
   for(let i=0;i<48;i++){const mid=(low+high)/2;if(sign*(timing(previousPhase+sign*(mid-previousElapsed)).distance-before)<consumed)low=mid;else high=mid;}
   elapsed=consumed===0?previousElapsed:(low+high)/2;phase=previousPhase+sign*(elapsed-previousElapsed);
  }
  elapsed=previousElapsed+(elapsed-previousElapsed)*gaitScale;phase=previousPhase+sign*(elapsed-previousElapsed);
  if(admit){
   const to=path.read(),allowed=admit({from,to,turnOnly:false});
   if(!Number.isFinite(allowed)||allowed<0||allowed>1)throw Error('Motion admission must return a fraction in [0,1]');
   if(allowed<1){
    path=createWanderPath({snapshot:prior.path});elapsed=prior.elapsed;phase=prior.phase;heldFrame=prior.heldFrame;
    const angle=Math.atan2(from.direction[0]*to.direction[1]-from.direction[1]*to.direction[0],from.direction[0]*to.direction[0]+from.direction[1]*to.direction[1]);
    const fraction=admit({from,to:{...from,direction:to.direction},turnOnly:true});
    if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw Error('Motion admission must return a fraction in [0,1]');
    if(fraction>0&&angle!==0){const c=Math.cos(angle*fraction),s=Math.sin(angle*fraction);path.redirect([c*from.direction[0]-s*from.direction[1],s*from.direction[0]+c*from.direction[1]]);}
   }
  }
  return read();
 }
 function contact(before,{position,direction,facing:acceptedFacing}){
  if(acceptedFacing!==undefined&&!Number.isFinite(acceptedFacing))throw Error('Finite accepted facing required');
  if(acceptedFacing!==undefined)facing=acceptedFacing;
  const start=before.path,prior=createWanderPath({snapshot:start}).read(),proposed=path.read();
  const wanted=proposed.position.map((x,i)=>x-prior.position[i]),actual=position.map((x,i)=>x-prior.position[i]);
  const length2=wanted.reduce((n,x)=>n+x*x,0),fraction=length2>1e-16?Math.max(0,Math.min(1,actual.reduce((n,x,i)=>n+x*wanted[i],0)/length2)):1;
  contactRate=fraction;path.contact(position,direction,start.distance+(proposed.distance-start.distance)*fraction);return read();
 }
 function frame(index,proposedPath=null,proposedFacing=facing) {
  const pose=walking.frame(index,{mode:'cycle',cycle:0}),state=proposedPath??path.read(),point=roots[index];
  const yaw=(proposedFacing??Math.atan2(state.direction[0],state.direction[1])+(reverse?Math.PI:0))-Math.atan2(forward[0],forward[1]);
  const warp=new THREE.Matrix4().makeTranslation(state.position[0],0,state.position[1]).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeTranslation(-point[0],0,-point[2]));
  return {...pose,actorMatrix:warp.multiply(new THREE.Matrix4().fromArray(pose.actorMatrix)).toArray(),derived:true};
 }
 function seek(index) {
  if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw Error('Wander source frame is outside retained motion');
  elapsed=Math.floor(elapsed/period)*period+index/adapter.fps;phase=timing().cycle*period+index/adapter.fps;heldFrame=index;return read();
 }
 function setReverse(value){if(typeof value!=='boolean')throw Error('Reverse gait requires a boolean');if(value!==reverse){const direction=path.read().direction,dot=facing===null?null:direction[0]*Math.sin(facing)+direction[1]*Math.cos(facing);if(dot===null||(value?dot>0:dot<0))path.reverse();reverse=value;}return read();}
 // A brief body turn brings a remembered/observed bearing within neck range.
 // Travel still follows the existing route; facing is explicit during the turn.
 // On release it rejoins the route continuously rather than snapping back.
 function face(point,delta){
  if(point!==null&&(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))||!Number.isFinite(delta)||delta<0)throw Error('Facing requires a finite point or null and nonnegative time');
  const state=path.read(),tangent=Math.atan2(state.direction[0],state.direction[1])+(reverse?Math.PI:0);
  if(point===null&&facing===null)return read();
  const current=facing??tangent,dx=point?point[0]-state.position[0]:0,dz=point?point[1]-state.position[1]:0;
  if(point&&Math.hypot(dx,dz)<1e-9)return read();
  const desired=point?Math.atan2(dx,dz):tangent,error=Math.atan2(Math.sin(desired-current),Math.cos(desired-current));
  const turn=Math.sign(error)*Math.min(Math.max(0,Math.abs(error)-(point ? .45 : 0)),4*delta);
  if(point)facing=current+turn;
  else facing=Math.abs(error)<=4*delta?null:current+turn;
  return read();
 }
 function save(){return {schema:'kaminos.creature-wander-motion.v1',sourceKey,elapsed,phase,reverse,facing,heldFrame,contactRate,travel,path:path.snapshot()};}
 return Object.freeze({frame,read,advance,contact,seek,setReverse,face,setFacing:value=>{if(value!==null&&!Number.isFinite(value))throw Error('Finite facing or null required');facing=value;return read();},setDestination:(next,options)=>path.setDestination(next,options),setArea:next=>path.setArea(next),setAreas:next=>path.setAreas(next),snapshot:save});
}
