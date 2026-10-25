import {createPhysicalEncounterWorld} from './physical-body.mjs';
const unit=p=>{const n=Math.hypot(...p);return n?p.map(v=>v/n):[0,1];};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const dot3=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
export function capsuleGap(one,two){
 const raw=[sub(one.b,one.a),sub(two.b,two.a),sub(one.a,two.a)],scale=Math.max(...raw.flat().map(Math.abs))||1,[u,v,r]=raw.map(p=>p.map(x=>x/scale));
 const pointSegment=(p,d)=>{const length=Math.hypot(...d);if(length===0)return Math.hypot(...p);const axis=d.map(x=>x/length),along=Math.max(0,Math.min(length,dot3(p,axis)));return Math.hypot(...p.map((x,i)=>x-along*axis[i]));};
 const cross=(a,b)=>a.map((_,i)=>a[(i+1)%3]*b[(i+2)%3]-a[(i+2)%3]*b[(i+1)%3]);
 let distance=Math.min(pointSegment(r,v),pointSegment(r.map((x,i)=>x+u[i]),v),pointSegment(r.map(x=>-x),u),pointSegment(v.map((x,i)=>x-r[i]),u));
 // Boundary minima cover parallel and zero-length segments. A nonparallel
 // interior minimum uses cross products, avoiding a dimensional epsilon and
 // the cancellation in |u|²|v|²-(u.v)² for nearly parallel segments.
 const normal=cross(u,v),length=Math.hypot(...normal);
 if(length>0){const axis=normal.map(x=>x/length),s=dot3(cross(v,r),axis)/length,t=dot3(cross(u,r),axis)/length;if(s>=0&&s<=1&&t>=0&&t<=1)distance=Math.min(distance,Math.abs(dot3(r,axis)));}
 return distance*scale-one.radius-two.radius;
}
export function materialContactGap(one,two){
 const gaps=[];
 for(const [body,obstacle]of [[one,two],[two,one]])for(const point of body.nodes??[])for(const capsule of obstacle.capsules??[])gaps.push(capsuleGap({a:point,b:point,radius:0},capsule));
 return gaps.length?Math.min(...gaps):one.capsules?.length&&two.capsules?.length?Math.min(...one.capsules.flatMap(a=>two.capsules.map(b=>capsuleGap(a,b)))):Math.hypot(...one.position.map((v,i)=>v-two.position[i]))-one.radius-two.radius;
}
const hasCores=(a,b)=>a.movementCores?.length&&b.movementCores?.length;
export function movementContactGap(one,two){return hasCores(one,two)?Math.min(...one.movementCores.flatMap(a=>two.movementCores.map(b=>capsuleGap(a,b)))):materialContactGap(one,two);}

// Swept admission for the commanded rigid torso motion, independently of the
// soft residual solve. A bound on every support point's speed makes endpoint-
// clear rotations and long translations observable without a fixed sample cap.
function rotate(p,axis,angle){const c=Math.cos(angle),s=Math.sin(angle),d=dot3(p,axis);return p.map((v,i)=>c*v+s*(axis[(i+1)%3]*p[(i+2)%3]-axis[(i+2)%3]*p[(i+1)%3])+(1-c)*d*axis[i]);}
function movedPoint(p,{pivot,translation,angle,axis=[0,-1,0]},fraction){return rotate(sub(p,pivot),axis,angle*fraction).map((v,i)=>v+pivot[i]+translation[i]*fraction);}
export function moveTorso(body,motion,fraction=1){
 const {pivot}=motion,point=p=>movedPoint(p,motion,fraction);
 return {...body,position:point([body.position[0],pivot[1],body.position[1]]).filter((_,i)=>i!==1),nodes:body.nodes?.map(point),capsules:body.capsules?.map(q=>({...q,a:point(q.a),b:point(q.b)})),movementCores:body.movementCores?.map(q=>({...q,a:point(q.a),b:point(q.b)}))};
}
export function limitTorsoMotion(self,others,motion,nextBody=null){
 if(![motion.pivot,motion.translation].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Number.isFinite(motion.angle)||motion.axis&&(!Array.isArray(motion.axis)||motion.axis.length!==3||!motion.axis.every(Number.isFinite)||Math.abs(Math.hypot(...motion.axis)-1)>1e-10))throw Error('Finite torso motion required');
 const axis=motion.axis??[0,-1,0],supports=[...(self.nodes??[]),...(self.capsules??[]).flatMap(c=>[c.a,c.b]),...(self.movementCores??[]).map(c=>c.a)],radial=p=>{const r=sub(p,motion.pivot),d=dot3(r,axis);return Math.hypot(...r.map((v,i)=>v-d*axis[i]));},extent=Math.max(0,...supports.map(radial)),travel=Math.hypot(...motion.translation),omega=Math.abs(motion.angle);
 if(nextBody&&nextBody.movementCores?.length!==self.movementCores?.length)throw Error('Proposed movement supports differ from the current body');
 const cores=(self.movementCores??[]).map((c,i)=>{if(c.a.some((v,j)=>v!==c.b[j]))throw Error('Movement supports must be spheres');const end=nextBody?.movementCores[i],delta=end?sub(end.a,movedPoint(c.a,motion,1)):[0,0,0];return {at:t=>movedPoint(c.a,motion,t).map((v,j)=>v+delta[j]*t),radius:Math.max(c.radius,end?.radius??c.radius),acceleration:omega*omega*radial(c.a),drift:Math.hypot(...delta)};});
 const speed=travel+omega*extent+Math.max(0,...cores.map(c=>c.drift));
 let fraction=1,probes=0,blockedBy=null;
 if(speed===0)return {fraction,probes,blockedBy};
 for(const other of others){
  if(other.id===self.id)continue;
  if(hasCores(self,other)){
   const tolerance=1e-5*(self.radius+other.radius),floor=Math.min(0,movementContactGap(self,other))-tolerance,pending=[[0,fraction]];
   while(pending.length){const [a,b]=pending.pop();let lower=Infinity;for(const c of cores){const chord={a:c.at(a),b:c.at(b),radius:c.radius+c.acceleration*(b-a)**2/8};for(const obstacle of other.movementCores)lower=Math.min(lower,capsuleGap(chord,obstacle));}probes++;if(lower>=floor)continue;const mid=(a+b)/2;if((b-a)*speed<=tolerance*.1||mid===a||mid===b){fraction=a;blockedBy=other.id;break;}pending.push([mid,b],[a,mid]);}
   continue;
  }
  const radius=self.radius+other.radius,tolerance=1e-5*radius,initial=materialContactGap(self,other),floor=Math.min(-.04*radius,initial)-tolerance;
  if((self.nodes?.length&&other.capsules?.length)||(other.nodes?.length&&self.capsules?.length)){
   // A twice differentiable trajectory stays within maxAcceleration*h²/8 of
   // its endpoint chord. Segment/capsule distance therefore supplies a lower
   // bound over the WHOLE interval, including a compressed tangential slide.
   // Inverse motion turns the opposite node/capsule term into the same test.
   const inverse=(p,t)=>rotate(sub(p,motion.pivot).map((v,i)=>v-motion.translation[i]*t),axis,-motion.angle*t).map((v,i)=>v+motion.pivot[i]);
   const forward=(self.nodes??[]).map(p=>({at:t=>movedPoint(p,motion,t),acceleration:omega*omega*radial(p),capsules:other.capsules??[]}));
   const backward=(other.nodes??[]).map(p=>({at:t=>inverse(p,t),acceleration:omega*omega*(radial(p)+travel)+2*omega*travel,capsules:self.capsules??[]}));
   const terms=[...forward,...backward].filter(p=>p.capsules.length);
   function bound(a,b){let gap=Infinity;for(const term of terms){const chord={a:term.at(a),b:term.at(b),radius:term.acceleration*(b-a)**2/8};for(const capsule of term.capsules)gap=Math.min(gap,capsuleGap(chord,capsule));}probes++;return gap;}
   const pending=[[0,fraction]];
   while(pending.length){const [a,b]=pending.pop();if(bound(a,b)>=floor)continue;const mid=(a+b)/2;if((b-a)*speed<=tolerance*.1||mid===a||mid===b){fraction=a;blockedBy=other.id;break;}pending.push([mid,b],[a,mid]);}
   continue;
  }
  let t=0;
  while(t<fraction){
   const gap=materialContactGap(moveTorso(self,motion,t),other);probes++;
   const clearance=gap-floor;
   if(clearance<=tolerance*.1){fraction=t;blockedBy=other.id;break;}
   const step=clearance/speed*.8;
   if(t+step>=fraction){const end=materialContactGap(moveTorso(self,motion,fraction),other);probes++;if(end>=floor)break;}
   if(t+step===t){fraction=t;blockedBy=other.id;break;}
   t=Math.min(fraction,t+step);
  }
 }
 return {fraction,probes,blockedBy};
}
export function encounterSteering(self,others,{seconds,avoidance=true}={}){
 if(!Number.isFinite(seconds)||seconds<0)throw Error('Encounter time must be finite and nonnegative');
 const original=unit(self.direction),force=[...original],right=[original[1],-original[0]];let scale=1,touching=false,neighbours=0;
 for(const other of others){
  if(other.id===self.id)continue;
  const delta=other.position.map((v,i)=>v-self.position[i]),distance=Math.hypot(...delta),radius=self.radius+other.radius;
  const relative=other.direction.map((v,i)=>v*other.speed-original[i]*self.speed),r2=dot(relative,relative),approach=r2>1e-12?Math.max(0,Math.min(1.5,-dot(delta,relative)/r2)):0;
  const closest=delta.map((v,i)=>v+relative[i]*approach),miss=Math.hypot(...closest),shaped=hasCores(self,other),gap=movementContactGap(self,other),overlap=gap<0;
  touching||=materialContactGap(self,other)<0;
  const future=shaped?movementContactGap(moveTorso(self,{pivot:[0,0,0],translation:[original[0]*self.speed*approach,0,original[1]*self.speed*approach],angle:0}),moveTorso(other,{pivot:[0,0,0],translation:[other.direction[0]*other.speed*approach,0,other.direction[1]*other.speed*approach],angle:0})):null;
  if(!overlap&&(!avoidance||(shaped?future>=0:miss>=radius*1.2)||dot(delta,original)<0))continue;
  neighbours++;touching||=overlap;
  const away=distance>1e-9?delta.map(v=>-v/distance):(self.id<other.id?[1,0]:[-1,0]);
  if(overlap){for(let a=0;a<2;a++)force[a]+=away[a]*(2+4*Math.max(0,-gap/radius));if(gap<-.04*radius&&dot(original,away)<-.2)scale=0;else scale=Math.min(scale,.45);}
  else{const urgency=(1-miss/(radius*1.2))/(1+approach);for(let a=0;a<2;a++)force[a]+=urgency*(right[a]*2+away[a]*.45);scale=Math.min(scale,Math.max(.2,Math.min(1,(distance-radius)/(radius*.6))));}
 }
 const desired=unit(force),angle=Math.atan2(original[0]*desired[1]-original[1]*desired[0],dot(original,desired)),turn=Math.max(-1.8*seconds,Math.min(1.8*seconds,angle)),c=Math.cos(turn),s=Math.sin(turn);
 return {direction:[c*original[0]-s*original[1],s*original[0]+c*original[1]],distanceScale:scale,touching,neighbours};
}

// One timestamp means one shared observation, independent of actor callback
// order. No timer, pose authority or private simulation is owned here.
export function createEncounterWorld({avoidance=true,response='admission'}={}){
 if(!['physical','admission'].includes(response))throw Error('Unknown encounter response');
 const physics=response==='physical'?createPhysicalEncounterWorld():null;let staged=new Map();
 const actors=new Map();let stamp=null,snapshot=[],last=new Map(),committed=new Map();
 function observe(time){if(time!==stamp){snapshot=[...actors].map(([id,stack])=>({id,...stack.at(-1)()})).filter(a=>a.mounted);committed=new Map();staged=new Map();stamp=time;}return snapshot;}
 function finishStep(){
  if(!physics||!staged.size)return;
  const commands=[...staged.values()],seconds=commands[0].seconds;
  if(commands.some(c=>Math.abs(c.seconds-seconds)>1e-9))throw Error('Encounter actors must share physical elapsed time');
  const result=physics.solve(snapshot,commands,seconds);staged=new Map();
  // Apply every root before any actor samples colliders or advances flesh.
  for(const c of commands)c.accept(result.motions.get(c.id));
  committed=new Map([...actors].map(([id,stack])=>[id,{id,...stack.at(-1)()}]));
  for(const c of commands)c.after();
 }
 return {finishStep,beginStep(){const observation={};observe(observation);return observation;},setAvoidance(value){if(typeof value!=='boolean')throw Error('Boolean avoidance required');avoidance=value;stamp=null;},read:()=>({avoidance,response,physics:physics?.read()??null,actors:actors.size,last:[...last].map(([id,state])=>({id,...state}))}),
  actor(id){return {response,finishStep,stage(command){observe(command.time);if(staged.has(id))throw Error('Duplicate physical command');staged.set(id,{...command,id});},register(get){const stack=actors.get(id)??[];stack.push(get);actors.set(id,stack);stamp=null;return()=>{const i=stack.indexOf(get);if(i>=0)stack.splice(i,1);if(!stack.length){actors.delete(id);last.delete(id);}stamp=null;};},
   steer({time,seconds,direction,speed}){const rows=observe(time),self=rows.find(r=>r.id===id);if(!self)return {direction,distanceScale:1};const result=encounterSteering({...self,direction,speed},rows,{seconds,avoidance});last.set(id,result);return result;},
   limit({time,body,motion,nextBody=null,turnOnly=false}){const rows=observe(time).map(r=>committed.get(r.id)??r),result=limitTorsoMotion({id,...body},rows,motion,nextBody),prior=last.get(id);last.set(id,{...prior,motion:{...prior?.motion,[turnOnly?'turn':'travel']:{...result,...motion,shape:body.movementCores?.length?'axial-inner-spheres':'torso-material-targets',proposedPose:Boolean(nextBody)}}});return result;},
   commit(time,body){observe(time);committed.set(id,{id,...body});},
   contacts(time){return observe(time).map(r=>committed.get(r.id)??r).filter(r=>r.id!==id).flatMap(r=>r.capsules);},
  };},dispose(){physics?.dispose();staged.clear();actors.clear();snapshot=[];last.clear();},
 };
}

export {createPhysicalEncounterWorld} from './physical-body.mjs';
