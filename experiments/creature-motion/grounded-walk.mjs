// Local limb sampling leaves the shared spine and physical actor authoritative.
export function sampleLegGroups({THREE,walking,base,front,rear,legTimes={}}){
 const sample=time=>{
  const f=((time*walking.fps)%(walking.frames-1)+(walking.frames-1))%(walking.frames-1),i=Math.floor(f),t=f-i;
  return [walking.frame(i,{mode:'cycle'}),walking.frame(i+1,{mode:'cycle'}),t];
 };
 const samples={front:sample(front),rear:sample(rear)};
 const mix=(a,b,t)=>{
  const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(),bp=p.clone(),bq=q.clone(),bs=s.clone();
  new THREE.Matrix4().fromArray(a).decompose(p,q,s);new THREE.Matrix4().fromArray(b).decompose(bp,bq,bs);
  return new THREE.Matrix4().compose(p.lerp(bp,t),q.slerp(bq,t),s.lerp(bs,t)).toArray();
 };
 return {...base,bones:base.bones.map(row=>{
  const group=row.name.startsWith('forelimb-')?'front':row.name.startsWith('hindlimb-')?'rear':null;
  if(!group)return {...row};
  const prefix=row.name.split('-').slice(0,2).join('-');
  const [a,b,t]=legTimes[prefix]===undefined?samples[group]:sample(legTimes[prefix]),aa=a.bones.find(b=>b.name===row.name),bb=b.bones.find(b=>b.name===row.name);
  const {worldMatrix,skinMatrix,...local}=row;
  return {...local,localMatrix:mix(aa.localMatrix,bb.localMatrix,t)};
 })};
}

// Two articulated segments, with the distal foot orientation retained. Only
// rotations change: unreachable targets remain explicit residuals.
export function solveLegTarget({THREE,chain,target}){
 const [a,b,c,toe]=chain,position=o=>o.getWorldPosition(new THREE.Vector3());
 a.updateWorldMatrix(true,true);
 const pa=position(a),pb=position(b),pc=position(c),pt=position(toe),orientation=c.getWorldQuaternion(new THREE.Quaternion());
 const goal=target.clone().sub(pt.clone().sub(pc)),l1=pa.distanceTo(pb),l2=pb.distanceTo(pc),distal=pc.distanceTo(pt);
 let ankleAdjusted=false;
 if(goal.distanceTo(pa)>l1+l2&&distal>0){
  // Use the ankle's articulation before declaring a contact unreachable.
  const axis=target.clone().sub(pa),d=axis.length(),radius=l1+l2-1e-8;axis.normalize();
  if(d>=radius+distal)goal.copy(pa).addScaledVector(axis,radius);
  else{
   const along=(d*d+radius*radius-distal*distal)/(2*d),pole=goal.clone().sub(pa).addScaledVector(axis,-goal.clone().sub(pa).dot(axis));
   if(pole.lengthSq()<1e-12)pole.copy(pb).sub(pa).addScaledVector(axis,-pb.clone().sub(pa).dot(axis));
   pole.normalize();goal.copy(pa).addScaledVector(axis,along).addScaledVector(pole,Math.sqrt(Math.max(0,radius*radius-along*along)));
  }
  ankleAdjusted=true;
 }
 const offset=goal.clone().sub(pa),distance=offset.length();
 if(!(l1>0&&l2>0))throw Error('Grounded leg has a zero-length segment');
 const axis=distance>1e-12?offset.divideScalar(distance):pc.clone().sub(pa).normalize();
 if(axis.lengthSq()<1e-12)axis.set(0,-1,0);
 const pole=pb.clone().sub(pa).addScaledVector(axis,-pb.clone().sub(pa).dot(axis));
 if(pole.lengthSq()<1e-12){pole.set(1,0,0).addScaledVector(axis,-axis.x);if(pole.lengthSq()<1e-12)pole.set(0,0,1).addScaledVector(axis,-axis.z);}
 pole.normalize();
 const reach=Math.max(Math.abs(l1-l2)+1e-9,Math.min(l1+l2-1e-9,distance)),along=(l1*l1+reach*reach-l2*l2)/(2*reach),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 const elbow=pa.clone().addScaledVector(axis,along).addScaledVector(pole,height),end=pa.clone().addScaledVector(axis,reach);
 const orient=(bone,child,desired)=>{
  const origin=position(bone),from=position(child).sub(origin).normalize(),to=desired.clone().sub(origin).normalize();
  const q=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));bone.updateWorldMatrix(false,true);
 };
 orient(a,b,elbow);orient(b,c,end);
 if(ankleAdjusted)orient(c,toe,target);else{c.quaternion.copy(c.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));c.updateWorldMatrix(false,true);}
 return {residual:position(toe).distanceTo(target),reached:position(toe).toArray(),target:target.toArray()};
}

export function createGroundedWalk({THREE,walking,baseFrame,forward,speed,initial,time=0,groundHeight,snapshot}){
 if(!Number.isFinite(groundHeight))throw Error('Grounded walk requires an explicit flat support height');
 if(!(speed>0))throw Error('Grounded walk requires a measured positive stride speed');
 const period=(walking.frames-1)/walking.fps,group=new THREE.Group(),bones=new Map(),spec=walking.frame(0,{mode:'cycle'}).bones;
 for(const row of spec){const b=new THREE.Bone();b.name=row.name;bones.set(row.name,b);}
 for(const row of spec)(row.parent===null?group:bones.get(row.parent)).add(bones.get(row.name));
 const legs=[];
 for(const kind of ['forelimb','hindlimb'])for(const side of ['left','right']){
  const parts=kind==='forelimb'?['shoulder','elbow','wrist','toe']:['hip','stifle','hock','toe'],names=parts.map(p=>`${kind}-${side}-${p}`);
  if(names.some(n=>!bones.has(n))||names.slice(1).some((n,i)=>bones.get(n).parent!==bones.get(names[i])))throw Error('Grounded walk requires four named two-segment leg chains and distal toes');
  legs.push({name:`${kind}-${side}`,group:kind==='forelimb'?'front':'rear',chain:names.map(n=>bones.get(n))});
 }
 const at=b=>b.getWorldPosition(new THREE.Vector3());
 function load(pose){
  new THREE.Matrix4().fromArray(pose.actorMatrix).decompose(group.position,group.quaternion,group.scale);
  for(const row of pose.bones)new THREE.Matrix4().fromArray(row.localMatrix).decompose(bones.get(row.name).position,bones.get(row.name).quaternion,bones.get(row.name).scale);
  group.updateMatrixWorld(true);
 }
 const samples=Array.from({length:walking.frames-1},(_,i)=>{
  load(walking.frame(i,{mode:'cycle'}));const root=at(bones.get('pelvis'));
  return legs.map(leg=>({toe:at(leg.chain[3]).toArray(),relative:at(leg.chain[3]).sub(root).toArray(),hip:at(leg.chain[0]).sub(root).toArray()}));
 });
 for(const [j,leg] of legs.entries()){
  const heights=samples.map(s=>s[j].toe[1]).sort((a,b)=>a-b),threshold=heights[Math.floor(heights.length*.6)];
  leg.sourceGround=heights[0];leg.ground=groundHeight;leg.offset=samples[0][j].hip;
  leg.mean=samples.reduce((sum,row)=>sum.map((v,k)=>v+(row[j].relative[k]-row[j].hip[k])/samples.length),[0,0,0]);
  leg.stance=samples.map((s,i)=>{
   const prev=samples[(i+samples.length-1)%samples.length][j].relative,next=samples[(i+1)%samples.length][j].relative;
   return s[j].toe[1]<=threshold&&(next[0]-prev[0])*forward[0]+(next[2]-prev[2])*forward[1]<=0;
  });
  if(!leg.stance.some(Boolean)||leg.stance.every(Boolean))throw Error(`No alternating support/swing interval in ${leg.name}`);
 }
 // Workspaces come from this cast's retained gait, in its forward/lateral
 // frame. The allowance is a tenth of the articulated leg length: room to
 // steer, without turning the source's sagittal stride into a lateral sweep.
 const axis=new THREE.Vector3(0,1,0),sourceYaw=Math.atan2(forward[0],forward[1]);
 for(const [j,leg] of legs.entries()){
  load(walking.frame(0,{mode:'cycle'}));
  leg.reach=leg.chain.slice(1).reduce((n,b,i)=>n+at(b).distanceTo(at(leg.chain[i])),0);
  const offsets=samples.map(row=>new THREE.Vector3(...row[j].relative).sub(new THREE.Vector3(...row[j].hip)).applyAxisAngle(axis,-sourceYaw));
  leg.side=Math.sign(new THREE.Vector3(...leg.offset).applyAxisAngle(axis,-sourceYaw).x);
  leg.lateral=[Math.min(...offsets.map(v=>v.x))-leg.reach*.1,Math.max(...offsets.map(v=>v.x))+leg.reach*.1];
  leg.longitudinal=[Math.min(...offsets.map(v=>v.z))-leg.reach*.1,Math.max(...offsets.map(v=>v.z))+leg.reach*.1];
  leg.samples=offsets;
 }
 const sourceFloors=legs.map(l=>l.sourceGround).sort((a,b)=>a-b),sourceFloor=(sourceFloors[1]+sourceFloors[2])/2;
 let state={schema:'kaminos.grounded-walk.v1',groundHeight,frontTime:time,rearTime:time,baseTime:time,legTimes:Object.fromEntries(legs.map(l=>[l.name,time])),velocities:{},feet:{}};
 const phase=t=>{
  const raw=((t%period)+period)%period*walking.fps,nearest=Math.round(raw);
  // Frame boundaries carry discrete contact meaning. Modulo of an accumulated
  // clock may land one ulp below a boundary, including a release we just set.
  // Snap only arithmetic roundoff, not a finite interval of the source motion.
  const tolerance=16*Number.EPSILON*Math.max(1,Math.abs(t*walking.fps),walking.frames-1);
  return Math.abs(raw-nearest)<=tolerance?nearest%(walking.frames-1):raw;
 };
 const localPose=(base)=>sampleLegGroups({THREE,walking,base,front:state.frontTime,rear:state.rearTime,legTimes:state.legTimes});
 function coordinates(path,hip,target){
  return target.clone().sub(hip).applyAxisAngle(axis,-Math.atan2(path.direction[0],path.direction[1]));
 }
 function feasible(path,leg,hip,target){
  const yaw=Math.atan2(path.direction[0],path.direction[1]),local=coordinates(path,hip,target);
  local.x=Math.max(leg.lateral[0],Math.min(leg.lateral[1],local.x));
  local.z=Math.max(leg.longitudinal[0],Math.min(leg.longitudinal[1],local.z));
  // Keep the landing on this attachment's side of the body's sagittal plane.
  const root=new THREE.Vector3(path.position[0],hip.y,path.position[1]);
  const hipSide=coordinates(path,root,hip).x;
  if(leg.side)local.x=leg.side*Math.max(leg.side*(hipSide+local.x),Math.abs(hipSide)*.5)-hipSide;
  // Intersect with the nonstretching leg's ground-plane reach disk. If
  // the attachment itself is too high, leave the residual visible to IK.
  const height=hip.y-sourceFloor,radius=Math.sqrt(Math.max(0,(leg.reach*.98)**2-height*height));
  const horizontal=Math.hypot(local.x,local.z);
  if(horizontal>radius){local.x*=radius/horizontal;local.z*=radius/horizontal;}
  return local.applyAxisAngle(axis,yaw).add(hip).setY(groundHeight);
 }
 function update(path){
  load(localPose(baseFrame(state.baseTime,path)));
  for(const leg of legs){
   let clock=state.legTimes[leg.name],f=phase(clock),index=Math.floor(f),stance=leg.stance[index],earlyLift=false;
   const previous=state.feet[leg.name],hip=at(leg.chain[0]),seatedHip=hip.clone().add(new THREE.Vector3(0,groundHeight-sourceFloor,0));
   const anchor=previous?.stance?new THREE.Vector3(...previous.anchor):null;
   const outside=anchor?anchor.distanceTo(feasible(path,leg,hip,anchor)):0;
   const otherSupport=legs.some(other=>other!==leg&&state.feet[other.name]?.stance);
   if(stance&&previous?.stance&&otherSupport&&(outside>1e-8||seatedHip.distanceTo(anchor)>leg.reach*.9)){
    let skip=0;while(leg.stance[(index+skip)%leg.stance.length])skip++;
    state.legTimes[leg.name]+=(skip-(f-index))/walking.fps;clock=state.legTimes[leg.name];f=phase(clock);index=(index+skip)%leg.stance.length;stance=false;earlyLift=true;
    load(localPose(baseFrame(state.baseTime,path)));
   }
   const source=at(leg.chain[3]);source.y+=groundHeight-leg.sourceGround;
   let target,plan=previous?.step??null,release=previous?.release??null,releaseTime=previous?.releaseTime??clock;
   // Use the same retained landing offset as the approaching swing. The
   // current torso plus independently sampled limb can have another toe pose.
   const landingNow=()=>feasible(path,leg,at(leg.chain[0]),leg.samples[index].clone().applyAxisAngle(axis,Math.atan2(path.direction[0],path.direction[1])).add(at(leg.chain[0])));
   if(stance){
    target=previous?.stance?new THREE.Vector3(...previous.anchor):plan?landingNow():feasible(path,leg,at(leg.chain[0]),source);
    plan=null;release=null;
   }else{
    const count=leg.stance.length;let before=0,after=1;
    while(!leg.stance[(index-before+count)%count])before++;
    while(!leg.stance[(index+after)%count])after++;
    const duration=(before-1+after)/walking.fps,u=(before-1+f-index)/(before-1+after),remaining=(after-(f-index))/walking.fps;
    const landingIndex=(index+after)%count,yaw=Math.atan2(path.direction[0],path.direction[1]);
    const landing=leg.samples[landingIndex].clone().applyAxisAngle(axis,yaw).add(at(leg.chain[0]));
    // Predict the attachment at touchdown from accepted travel per unit of
    // this leg's phase; project that prediction into its current workspace.
    const velocity=plan?.velocity??state.phaseVelocities?.[leg.name];
    if(velocity)landing.add(new THREE.Vector3(velocity[0]*remaining,0,velocity[1]*remaining));
    const end=feasible(path,leg,at(leg.chain[0]),landing);
    if(!plan||previous?.stance){
     const start=previous?new THREE.Vector3(...previous.target):source.clone().setY(groundHeight);
     plan={start:start.toArray(),landing:end.toArray(),velocity:velocity?[...velocity]:[0,0]};release=start.clone().sub(source).toArray();releaseTime=clock-u*duration;
    }
    plan.landing=end.toArray();
    const weight=u*u*(3-2*u);target=feasible(path,leg,at(leg.chain[0]),new THREE.Vector3(...plan.start).lerp(end,weight));
    target.y=groundHeight+Math.max(0,source.y-groundHeight)*Math.sin(Math.PI*u);
   }
   state.feet[leg.name]={stance,earlyLift,anchor:stance?target.toArray():null,release,releaseTime,target:target.toArray(),step:plan,phase:f/(walking.frames-1)};
  }
 }
 function restore(value){
  if(value?.schema!=='kaminos.grounded-walk.v1'||value.groundHeight!==groundHeight||!Number.isFinite(value.baseTime)||!Number.isFinite(value.frontTime)||value.frontTime<0||!Number.isFinite(value.rearTime)||value.rearTime<0||legs.some(l=>{
   const f=value.feet?.[l.name];return !f||typeof f.stance!=='boolean'||!Number.isFinite(value.legTimes?.[l.name])||!Number.isFinite(f.releaseTime)||!Number.isFinite(f.phase)||(f.swingDirection!==undefined&&!Number.isFinite(f.swingDirection))||(f.step!=null&&(['start','landing'].some(k=>!Array.isArray(f.step[k])||f.step[k].length!==3||!f.step[k].every(Number.isFinite))||!Array.isArray(f.step.velocity)||f.step.velocity.length!==2||!f.step.velocity.every(Number.isFinite)))||(value.phaseVelocities?.[l.name]!==undefined&&(!Array.isArray(value.phaseVelocities[l.name])||value.phaseVelocities[l.name].length!==2||!value.phaseVelocities[l.name].every(Number.isFinite)))||['target',...(f.stance?['anchor']:[]),...(f.release?['release']:[])].some(k=>!Array.isArray(f[k])||f[k].length!==3||!f[k].every(Number.isFinite));
  }))throw Error('Invalid grounded walk snapshot');
  state=structuredClone(value);
 }
 if(snapshot)restore(snapshot);else update(initial);
 function advance(from,to,baseTime=state.baseTime,activeSeconds=0){
  if(!Number.isFinite(activeSeconds)||activeSeconds<0)throw Error('Grounded walk needs finite nonnegative active time');
  if(activeSeconds<=64*Number.EPSILON*Math.max(1,...Object.values(state.legTimes).map(Math.abs)))activeSeconds=0;
  const yaw=p=>Math.atan2(p.direction[0],p.direction[1]),start=yaw(from),delta=Math.atan2(Math.sin(yaw(to)-start),Math.cos(yaw(to)-start));
  const pendingSwing=()=>legs.some(l=>!state.feet[l.name].stance);
  if(Math.hypot(...to.position.map((v,i)=>v-from.position[i]))===0&&delta===0&&(!activeSeconds||!pendingSwing()))return;
  const sourceYaw=Math.atan2(forward[0],forward[1]);
  const hip=(path,leg)=>new THREE.Vector3(...leg.offset).applyAxisAngle(new THREE.Vector3(0,1,0),yaw(path)-sourceYaw).add(new THREE.Vector3(path.position[0],0,path.position[1]));
  // Resolve each source-frame-sized phase increment, including delayed ticks.
  const bound=Math.hypot(...to.position.map((v,i)=>v-from.position[i]))+Math.abs(delta)*Math.max(...legs.map(l=>Math.hypot(l.offset[0],l.offset[2])));
  // A floating-point remainder is not a new contact decision. Scale the
  // threshold to coordinate arithmetic, far below meaningful foot travel.
  const roundoff=64*Number.EPSILON*Math.max(1,...from.position.map(Math.abs),...to.position.map(Math.abs),...legs.flatMap(l=>l.offset.map(Math.abs)));
  if(bound<=roundoff&&(!activeSeconds||!pendingSwing()))return;
  const steps=Math.max(1,Math.ceil(Math.max(bound/speed,activeSeconds)*walking.fps));let previous=from;
  for(let step=1;step<=steps;step++){
   const t=step/steps,angle=start+delta*t,next={position:to.position.map((v,i)=>from.position[i]+(v-from.position[i])*t),direction:[Math.sin(angle),Math.cos(angle)]};
   for(const leg of legs){const v=hip(next,leg).sub(hip(previous,leg));if(v.length()>64*Number.EPSILON*Math.max(1,...next.position.map(Math.abs),...leg.offset.map(Math.abs)))state.velocities[leg.name]=[v.x,v.z];}
   for(const name of ['front','rear']){
    const pair=legs.filter(l=>l.group===name),distance=pair.reduce((sum,l)=>sum+hip(previous,l).distanceTo(hip(next,l)),0)/pair.length;
    state[name+'Time']+=distance/speed;
    for(const leg of pair){
     // A swing already in flight completes on active time even when support
     // holds the body. Stance remains clocked by accepted body travel.
     const phaseAdvance=state.feet[leg.name].stance?distance/speed:Math.max(distance/speed,activeSeconds/steps);
     state.legTimes[leg.name]+=phaseAdvance;
     if(phaseAdvance>0){const v=hip(next,leg).sub(hip(previous,leg));(state.phaseVelocities??={})[leg.name]=[v.x/phaseAdvance,v.z/phaseAdvance];}
    }
   }
   state.baseTime+=(baseTime-state.baseTime)/(steps-step+1);update(next);previous=next;
  }
 }
 function frame(base){
  const pose=localPose(base);pose.actorMatrix=new THREE.Matrix4().makeTranslation(0,groundHeight-sourceFloor,0).multiply(new THREE.Matrix4().fromArray(base.actorMatrix)).toArray();load(pose);const diagnostics={};
  for(const leg of legs)diagnostics[leg.name]=solveLegTarget({THREE,chain:leg.chain,target:new THREE.Vector3(...state.feet[leg.name].target)});
  const rows=pose.bones.map(row=>{const bone=bones.get(row.name);bone.updateMatrix();return {...row,localMatrix:bone.matrix.toArray(),worldMatrix:bone.matrixWorld.toArray()};});
  return {...pose,bones:rows,grounding:{space:'authored-placement',feet:diagnostics}};
 }
 function turnScale(path){
  load(localPose(baseFrame(state.baseTime,path)));
  let strain=0;
  for(const leg of legs){
   const foot=state.feet[leg.name];if(!foot.stance)continue;
   const local=coordinates(path,at(leg.chain[0]),new THREE.Vector3(...foot.anchor));
   const lateral=(leg.lateral[0]+leg.lateral[1])/2,longitudinal=(leg.longitudinal[0]+leg.longitudinal[1])/2;
   strain=Math.max(strain,Math.abs(local.x-lateral)/((leg.lateral[1]-leg.lateral[0])/2),Math.abs(local.z-longitudinal)/((leg.longitudinal[1]-leg.longitudinal[0])/2));
  }
  // Smoothly ease turning near a support boundary. A positive rate permits
  // the release/handoff clock to progress even during an in-place pivot.
  return 1/(1+strain**4);
 }
 function setGroundHeight(next){
  if(!Number.isFinite(next))throw Error('Grounded walk requires an explicit flat support height');
  const delta=next-groundHeight;if(delta===0)return;groundHeight=next;state.groundHeight=next;
  for(const leg of legs){leg.ground=next;const foot=state.feet[leg.name];foot.target[1]+=delta;if(foot.anchor)foot.anchor[1]+=delta;if(foot.step){foot.step.start[1]+=delta;foot.step.landing[1]+=delta;}}
 }
 return {advance,frame,restore,setGroundHeight,turnScale,snapshot:()=>structuredClone(state),read:()=>({...structuredClone(state),space:'authored-placement',support:'explicit flat-ground foot targets',bodySeatingOffset:groundHeight-sourceFloor,ground:legs.map(l=>({name:l.name,height:l.ground}))})};
}
