import {createWanderPath} from './wander-path.mjs';
import {deriveStanceTravel} from './stance-travel.mjs';
import {createWanderLocomotion} from './wander-locomotion.mjs';

export function readWanderPath(snapshot){
 return snapshot?.schema==='kaminos.creature-wander-locomotion.v1'
  ?createWanderLocomotion({snapshot,bodyLength:snapshot.bodyLength,referenceSpeed:snapshot.referenceSpeed}).read()
  :createWanderPath({snapshot}).read();
}

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
export function createWanderMotion({THREE,adapter,walking,sourceKey,area,position,direction,seed=1,snapshot,pathSnapshot,travel='source',locomotion=false}={}) {
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
 // Use the source axial span rather than the size of an authored region. Small
 // synthetic/root-only adapters use their measured stride as an explicit scale.
 const head=poses[0].bones.findIndex(b=>b.name==='head'),axial=head>=0?head:poses[0].bones.findIndex(b=>b.name==='spine-chest');
 const spans=axial<0?[]:poses.map((p,i)=>Math.hypot(p.bones[axial].worldMatrix[12]-roots[i][0],p.bones[axial].worldMatrix[14]-roots[i][2])).filter(x=>x>0).sort((a,b)=>a-b);
 const sourceLength=spans.length?spans[Math.floor(spans.length/2)]:transport.unitsPerSecond*period;
 const inherited=snapshot?.path??pathSnapshot;
 const navigation=Boolean(locomotion)||inherited?.schema==='kaminos.creature-wander-locomotion.v1';
 const bodyLength=locomotion?.bodyLength??inherited?.bodyLength??sourceLength;
 const pathFrom=options=>navigation?createWanderLocomotion({...options,bodyLength,referenceSpeed:transport.unitsPerSecond}):createWanderPath(options);
 let elapsed=0,heldFrame=null,path,contactRate=1;
 if(snapshot!==undefined) {
  if(snapshot?.schema!=='kaminos.creature-wander-motion.v1'||snapshot.sourceKey!==sourceKey||!Number.isFinite(snapshot.elapsed)||snapshot.elapsed<0||(snapshot.heldFrame!==null&&(!Number.isInteger(snapshot.heldFrame)||snapshot.heldFrame<0||snapshot.heldFrame>=adapter.frames)))throw Error('Wander snapshot has invalid time, frame or source identity');
  if((snapshot.travel??'source')!==travel)throw Error('Wander snapshot travel policy differs from requested travel');
  contactRate=snapshot.contactRate??1;if(!Number.isFinite(contactRate)||contactRate<0||contactRate>1)throw Error('Invalid physical gait rate');
  elapsed=snapshot.elapsed;heldFrame=snapshot.heldFrame;path=pathFrom({snapshot:snapshot.path});
 } else path=pathSnapshot?pathFrom({snapshot:pathSnapshot}):pathFrom({area,position,direction,seed});
 function timing(time=elapsed) {
  const sourceFrames=time*adapter.fps,nearest=Math.round(sourceFrames);
  const stableFrames=Math.abs(sourceFrames-nearest)<=16*Number.EPSILON*Math.max(1,sourceFrames)?nearest:sourceFrames;
  const cycle=Math.floor(stableFrames/(adapter.frames-1)),fractional=stableFrames-cycle*(adapter.frames-1),index=Math.floor(fractional),next=Math.min(adapter.frames-1,index+1);
  return {cycle,frame:Math.min(adapter.frames-2,index),distance:travel==='stance'?time*transport.unitsPerSecond:cycle*sourceDistance+distances[index]+(distances[next]-distances[index])*(fractional-index)};
 }
 function read(){const t=timing();return {elapsed,cycle:t.cycle,frame:heldFrame??t.frame,period,sourceDistance,sourceKey,contactRate,travel:structuredClone(transport),path:path.read()};}
 function advance(delta,{distanceScale=1,direction=null,admit=null,gaitScale=1}={}) {
  if(!Number.isFinite(delta)||delta<0)throw Error('Wander time delta must be finite and nonnegative');
  if(!Number.isFinite(distanceScale)||distanceScale<0||distanceScale>1)throw Error('Travel scale must be in [0,1]');
  if(!Number.isFinite(gaitScale)||gaitScale<0||gaitScale>1)throw Error('Gait scale must be in [0,1]');
  const prior=admit?{path:path.snapshot(),elapsed,heldFrame}:null,from=admit?path.read():null;
  if(direction)path.redirect(direction);
  const previousElapsed=elapsed,before=timing().distance,pathBefore=path.read().distance;elapsed+=delta;heldFrame=null;
  const distance=timing().distance-before;if(distance< -1e-8)throw Error('Wander source distance moved backwards');
  path.advance(Math.max(0,distance)*distanceScale,{seconds:delta});
  const consumed=path.read().distance-pathBefore;
  if(consumed<distance-1e-10){
   // Stop the retained gait at the same travelled distance as the root.
   let low=previousElapsed,high=elapsed;
   for(let i=0;i<48;i++){const mid=(low+high)/2;if(timing(mid).distance-before<consumed)low=mid;else high=mid;}
   elapsed=consumed===0?previousElapsed:(low+high)/2;
  }
  // Physical feedback is causal: prior achieved travel sets this step's gait.
  // The requested root drive stays active even when the gait is blocked.
  elapsed=previousElapsed+(elapsed-previousElapsed)*gaitScale;
  if(admit){
   const to=path.read(),allowed=admit({from,to,turnOnly:false});
   if(!Number.isFinite(allowed)||allowed<0||allowed>1)throw Error('Motion admission must return a fraction in [0,1]');
   if(allowed<1){
    path=pathFrom({snapshot:prior.path});elapsed=prior.elapsed;heldFrame=prior.heldFrame;
    // A blocked journey may still turn out of contact. Keep its gait held and
    // admit that rotation separately; never apply a fraction of an unchecked
    // rebuilt curve or silently consume its random state.
    const angle=Math.atan2(from.direction[0]*to.direction[1]-from.direction[1]*to.direction[0],from.direction[0]*to.direction[0]+from.direction[1]*to.direction[1]);
    const fraction=admit({from,to:{...from,direction:to.direction},turnOnly:true});
    if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw Error('Motion admission must return a fraction in [0,1]');
    if(fraction>0&&angle!==0){const c=Math.cos(angle*fraction),s=Math.sin(angle*fraction),heading=[c*from.direction[0]-s*from.direction[1],s*from.direction[0]+c*from.direction[1]];if(navigation)path.contact(from.position,heading,from.distance);else path.redirect(heading);}
   }
  }
  return read();
 }
 function contact(before,{position,direction}){
  const start=before.path,prior=pathFrom({snapshot:start}).read(),proposed=path.read();
  const wanted=proposed.position.map((x,i)=>x-prior.position[i]),actual=position.map((x,i)=>x-prior.position[i]);
  const length2=wanted.reduce((n,x)=>n+x*x,0),fraction=length2>1e-16?Math.max(0,Math.min(1,actual.reduce((n,x,i)=>n+x*wanted[i],0)/length2)):1;
  // A stationary source interval has no travel to obstruct; allow its next
  // frame to arrive. Actual holds still govern advance() before this feedback.
  // Never change the pose after contacts have been solved against it. A shove
  // does not accelerate the gait; lost progress slows the following step.
  contactRate=fraction;
  path.contact(position,direction,start.distance+(proposed.distance-start.distance)*fraction);return read();
 }
 function frame(index,proposedPath=null) {
  const pose=walking.frame(index,{mode:'cycle',cycle:0}),state=proposedPath??path.read(),point=roots[index];
  const yaw=Math.atan2(state.direction[0],state.direction[1])-Math.atan2(forward[0],forward[1]);
  const warp=new THREE.Matrix4().makeTranslation(state.position[0],0,state.position[1]).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeTranslation(-point[0],0,-point[2]));
  return {...pose,actorMatrix:warp.multiply(new THREE.Matrix4().fromArray(pose.actorMatrix)).toArray(),derived:true};
 }
 function seek(index) {
  if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw Error('Wander source frame is outside retained motion');
  elapsed=timing().cycle*period+index/adapter.fps;heldFrame=index;return read();
 }
 function save(){return {schema:'kaminos.creature-wander-motion.v1',sourceKey,elapsed,heldFrame,contactRate,travel,path:path.snapshot()};}
 return Object.freeze({frame,read,advance,contact,seek,setDestination:next=>path.setDestination(next),setArea:next=>path.setArea(next),setAreas:next=>path.setAreas(next),snapshot:save});
}
