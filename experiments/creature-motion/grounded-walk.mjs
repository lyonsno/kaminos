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

export function createGroundedWalk({THREE,walking,baseFrame,forward,speed,initial,time=0,snapshot}){
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
  leg.ground=heights[0];leg.offset=samples[0][j].hip;
  leg.mean=samples.reduce((sum,row)=>sum.map((v,k)=>v+(row[j].relative[k]-row[j].hip[k])/samples.length),[0,0,0]);
  leg.stance=samples.map((s,i)=>{
   const prev=samples[(i+samples.length-1)%samples.length][j].relative,next=samples[(i+1)%samples.length][j].relative;
   return s[j].toe[1]<=threshold&&(next[0]-prev[0])*forward[0]+(next[2]-prev[2])*forward[1]<=0;
  });
  if(!leg.stance.some(Boolean)||leg.stance.every(Boolean))throw Error(`No alternating support/swing interval in ${leg.name}`);
 }
 let state={schema:'kaminos.grounded-walk.v1',frontTime:time,rearTime:time,baseTime:time,legTimes:Object.fromEntries(legs.map(l=>[l.name,time])),velocities:{},feet:{}};
 const phase=t=>((t%period)+period)%period*walking.fps;
 const localPose=(base)=>sampleLegGroups({THREE,walking,base,front:state.frontTime,rear:state.rearTime,legTimes:state.legTimes});
 function update(path){
  load(localPose(baseFrame(state.baseTime,path)));
  for(const leg of legs){
   let clock=state.legTimes[leg.name],f=phase(clock),index=Math.floor(f),stance=leg.stance[index],earlyLift=false;
   const previous=state.feet[leg.name],reach=at(leg.chain[0]).distanceTo(at(leg.chain[1]))+at(leg.chain[1]).distanceTo(at(leg.chain[2]))+at(leg.chain[2]).distanceTo(at(leg.chain[3]));
   if(stance&&previous?.stance&&at(leg.chain[0]).distanceTo(new THREE.Vector3(...previous.anchor))>reach*.95){
    let skip=0;while(leg.stance[(index+skip)%leg.stance.length])skip++;
    state.legTimes[leg.name]+=(skip-(f-index))/walking.fps;clock=state.legTimes[leg.name];f=phase(clock);index=(index+skip)%leg.stance.length;stance=false;earlyLift=true;
    load(localPose(baseFrame(state.baseTime,path)));
   }
   const hip=at(leg.chain[0]),source=at(leg.chain[3]),axis=new THREE.Vector3(0,1,0),bodyYaw=Math.atan2(path.direction[0],path.direction[1])-Math.atan2(forward[0],forward[1]);
   const mean=new THREE.Vector3(...leg.mean).applyAxisAngle(axis,bodyYaw),variation=source.clone().sub(hip).sub(mean),velocity=state.velocities[leg.name];
   if(velocity&&Math.hypot(...velocity)>1e-12){const direction=Math.atan2(velocity[0],velocity[1]),bodyDirection=Math.atan2(path.direction[0],path.direction[1]);variation.applyAxisAngle(axis,direction-bodyDirection);source.copy(hip).add(mean).add(variation);}
   const old=state.feet[leg.name];let anchor=old?.anchor??null,release=old?.release??null,releaseTime=old?.releaseTime??clock;
   if(stance&&!old?.stance){anchor=source.clone().setY(leg.ground).toArray();release=null;}
   if(!stance&&old?.stance){release=new THREE.Vector3(...old.target).sub(source).toArray();releaseTime=clock;anchor=null;}
   let target=source.clone();
   if(stance)target.fromArray(anchor);
   else if(release){
    // Decay the release correction through this clip's measured swing interval.
    let frames=0;const start=Math.floor(phase(releaseTime));while(frames<leg.stance.length&&!leg.stance[(start+frames)%leg.stance.length])frames++;
    const duration=Math.max(1,frames)/walking.fps,u=Math.min(1,Math.max(0,(clock-releaseTime)/duration)),weight=1-u*u*(3-2*u);
    target.addScaledVector(new THREE.Vector3(...release),weight);
   }
   if(target.y<leg.ground)target.y=leg.ground;
   state.feet[leg.name]={stance,earlyLift,anchor,release,releaseTime,target:target.toArray(),phase:f/(walking.frames-1)};
  }
 }
 function restore(value){
  if(value?.schema!=='kaminos.grounded-walk.v1'||!Number.isFinite(value.baseTime)||!Number.isFinite(value.frontTime)||value.frontTime<0||!Number.isFinite(value.rearTime)||value.rearTime<0||legs.some(l=>{
   const f=value.feet?.[l.name];return !f||typeof f.stance!=='boolean'||!Number.isFinite(value.legTimes?.[l.name])||!Number.isFinite(f.releaseTime)||!Number.isFinite(f.phase)||['target',...(f.stance?['anchor']:[]),...(f.release?['release']:[])].some(k=>!Array.isArray(f[k])||f[k].length!==3||!f[k].every(Number.isFinite));
  }))throw Error('Invalid grounded walk snapshot');
  state=structuredClone(value);
 }
 if(snapshot)restore(snapshot);else update(initial);
 function advance(from,to,baseTime=state.baseTime){
  const yaw=p=>Math.atan2(p.direction[0],p.direction[1]),start=yaw(from),delta=Math.atan2(Math.sin(yaw(to)-start),Math.cos(yaw(to)-start));
  if(Math.hypot(...to.position.map((v,i)=>v-from.position[i]))===0&&delta===0)return;
  const sourceYaw=Math.atan2(forward[0],forward[1]);
  const hip=(path,leg)=>new THREE.Vector3(...leg.offset).applyAxisAngle(new THREE.Vector3(0,1,0),yaw(path)-sourceYaw).add(new THREE.Vector3(path.position[0],0,path.position[1]));
  // Resolve each source-frame-sized phase increment, including delayed ticks.
  const bound=Math.hypot(...to.position.map((v,i)=>v-from.position[i]))+Math.abs(delta)*Math.max(...legs.map(l=>Math.hypot(l.offset[0],l.offset[2])));
  const steps=Math.max(1,Math.ceil(bound/speed*walking.fps));let previous=from;
  for(let step=1;step<=steps;step++){
   const t=step/steps,angle=start+delta*t,next={position:to.position.map((v,i)=>from.position[i]+(v-from.position[i])*t),direction:[Math.sin(angle),Math.cos(angle)]};
   for(const leg of legs){const v=hip(next,leg).sub(hip(previous,leg));state.velocities[leg.name]=[v.x,v.z];}
   for(const name of ['front','rear']){
    const pair=legs.filter(l=>l.group===name),distance=pair.reduce((sum,l)=>sum+hip(previous,l).distanceTo(hip(next,l)),0)/pair.length;
    state[name+'Time']+=distance/speed;for(const leg of pair)state.legTimes[leg.name]+=distance/speed;
   }
   state.baseTime+=(baseTime-state.baseTime)/(steps-step+1);update(next);previous=next;
  }
 }
 function frame(base){
  const pose=localPose(base);load(pose);const diagnostics={};
  for(const leg of legs)diagnostics[leg.name]=solveLegTarget({THREE,chain:leg.chain,target:new THREE.Vector3(...state.feet[leg.name].target)});
  const rows=pose.bones.map(row=>{const bone=bones.get(row.name);bone.updateMatrix();return {...row,localMatrix:bone.matrix.toArray(),worldMatrix:bone.matrixWorld.toArray()};});
  return {...pose,bones:rows,grounding:{space:'authored-placement',feet:diagnostics}};
 }
 return {advance,frame,restore,snapshot:()=>structuredClone(state),read:()=>({...structuredClone(state),space:'authored-placement',support:'clip-derived flat-ground foot targets',ground:legs.map(l=>({name:l.name,height:l.ground}))})};
}
