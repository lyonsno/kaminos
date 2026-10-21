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
export function createWanderMotion({THREE,adapter,walking,sourceKey,area,position,direction,seed=1,snapshot,pathSnapshot,travel='source'}={}) {
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
 let elapsed=0,heldFrame=null,path;
 if(snapshot!==undefined) {
  if(snapshot?.schema!=='kaminos.creature-wander-motion.v1'||snapshot.sourceKey!==sourceKey||!Number.isFinite(snapshot.elapsed)||snapshot.elapsed<0||(snapshot.heldFrame!==null&&(!Number.isInteger(snapshot.heldFrame)||snapshot.heldFrame<0||snapshot.heldFrame>=adapter.frames)))throw Error('Wander snapshot has invalid time, frame or source identity');
  if((snapshot.travel??'source')!==travel)throw Error('Wander snapshot travel policy differs from requested travel');
  elapsed=snapshot.elapsed;heldFrame=snapshot.heldFrame;path=createWanderPath({snapshot:snapshot.path});
 } else path=pathSnapshot?createWanderPath({snapshot:pathSnapshot}):createWanderPath({area,position,direction,seed});
 function timing(time=elapsed) {
  const sourceFrames=time*adapter.fps,nearest=Math.round(sourceFrames);
  const stableFrames=Math.abs(sourceFrames-nearest)<=16*Number.EPSILON*Math.max(1,sourceFrames)?nearest:sourceFrames;
  const cycle=Math.floor(stableFrames/(adapter.frames-1)),fractional=stableFrames-cycle*(adapter.frames-1),index=Math.floor(fractional),next=Math.min(adapter.frames-1,index+1);
  return {cycle,frame:Math.min(adapter.frames-2,index),distance:travel==='stance'?time*transport.unitsPerSecond:cycle*sourceDistance+distances[index]+(distances[next]-distances[index])*(fractional-index)};
 }
 function read(){const t=timing();return {elapsed,cycle:t.cycle,frame:heldFrame??t.frame,period,sourceDistance,sourceKey,travel:structuredClone(transport),path:path.read()};}
 function advance(delta) {
  if(!Number.isFinite(delta)||delta<0)throw Error('Wander time delta must be finite and nonnegative');
  const previousElapsed=elapsed,before=timing().distance,pathBefore=path.read().distance;elapsed+=delta;heldFrame=null;
  const distance=timing().distance-before;if(distance< -1e-8)throw Error('Wander source distance moved backwards');
  path.advance(Math.max(0,distance));
  const consumed=path.read().distance-pathBefore;
  if(consumed<distance-1e-10){
   // Stop the retained gait at the same travelled distance as the root.
   let low=previousElapsed,high=elapsed;
   for(let i=0;i<48;i++){const mid=(low+high)/2;if(timing(mid).distance-before<consumed)low=mid;else high=mid;}
   elapsed=(low+high)/2;
  }
  return read();
 }
 function frame(index) {
  const pose=walking.frame(index,{mode:'cycle',cycle:0}),state=path.read(),point=roots[index];
  const yaw=Math.atan2(state.direction[0],state.direction[1])-Math.atan2(forward[0],forward[1]);
  const warp=new THREE.Matrix4().makeTranslation(state.position[0],0,state.position[1]).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeTranslation(-point[0],0,-point[2]));
  return {...pose,actorMatrix:warp.multiply(new THREE.Matrix4().fromArray(pose.actorMatrix)).toArray(),derived:true};
 }
 function seek(index) {
  if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw Error('Wander source frame is outside retained motion');
  elapsed=timing().cycle*period+index/adapter.fps;heldFrame=index;return read();
 }
 function save(){return {schema:'kaminos.creature-wander-motion.v1',sourceKey,elapsed,heldFrame,travel,path:path.snapshot()};}
 return Object.freeze({frame,read,advance,seek,setDestination:next=>path.setDestination(next),setArea:next=>path.setArea(next),setAreas:next=>path.setAreas(next),snapshot:save});
}
