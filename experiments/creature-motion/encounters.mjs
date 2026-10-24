const unit=p=>{const n=Math.hypot(...p);return n?p.map(v=>v/n):[0,1];};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const dot3=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),clamp=x=>Math.max(0,Math.min(1,x));
export function capsuleGap(one,two){
 const d1=sub(one.b,one.a),d2=sub(two.b,two.a),r=sub(one.a,two.a),a=dot3(d1,d1),e=dot3(d2,d2),f=dot3(d2,r);let s=0,t=0;
 if(a<=1e-12){t=e>1e-12?clamp(f/e):0;}else{const c=dot3(d1,r);if(e<=1e-12)s=clamp(-c/a);else{const b=dot3(d1,d2),denom=a*e-b*b;s=denom>1e-12?clamp((b*f-c*e)/denom):0;t=(b*s+f)/e;if(t<0){t=0;s=clamp(-c/a);}else if(t>1){t=1;s=clamp((b-c)/a);}}}
 return Math.hypot(...r.map((v,i)=>v+s*d1[i]-t*d2[i]))-one.radius-two.radius;
}
export function materialContactGap(one,two){
 const gaps=[];
 for(const [body,obstacle]of [[one,two],[two,one]])for(const point of body.nodes??[])for(const capsule of obstacle.capsules??[])gaps.push(capsuleGap({a:point,b:point,radius:0},capsule));
 return gaps.length?Math.min(...gaps):one.capsules?.length&&two.capsules?.length?Math.min(...one.capsules.flatMap(a=>two.capsules.map(b=>capsuleGap(a,b)))):Math.hypot(...one.position.map((v,i)=>v-two.position[i]))-one.radius-two.radius;
}

// Swept admission for the commanded rigid torso motion, independently of the
// soft residual solve. A bound on every support point's speed makes endpoint-
// clear rotations and long translations observable without a fixed sample cap.
export function moveTorso(body,{pivot,translation,angle},fraction=1){
 const c=Math.cos(angle*fraction),s=Math.sin(angle*fraction),point=p=>{const x=p[0]-pivot[0],z=p[2]-pivot[2];return[pivot[0]+c*x-s*z+translation[0]*fraction,p[1]+translation[1]*fraction,pivot[2]+s*x+c*z+translation[2]*fraction];};
 return {...body,position:point([body.position[0],pivot[1],body.position[1]]).filter((_,i)=>i!==1),nodes:body.nodes?.map(point),capsules:body.capsules?.map(q=>({...q,a:point(q.a),b:point(q.b)}))};
}
export function limitTorsoMotion(self,others,motion){
 if(![motion.pivot,motion.translation].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Number.isFinite(motion.angle))throw Error('Finite torso motion required');
 const supports=[...(self.nodes??[]),...(self.capsules??[]).flatMap(c=>[c.a,c.b])],extent=Math.max(0,...supports.map(p=>Math.hypot(p[0]-motion.pivot[0],p[2]-motion.pivot[2]))),speed=Math.hypot(...motion.translation)+Math.abs(motion.angle)*extent;
 let fraction=1,probes=0,blockedBy=null;
 if(speed===0)return {fraction,probes,blockedBy};
 for(const other of others){
  if(other.id===self.id)continue;
  const radius=self.radius+other.radius,tolerance=1e-5*radius,initial=materialContactGap(self,other),floor=Math.min(-.04*radius,initial)-tolerance;
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
  const closest=delta.map((v,i)=>v+relative[i]*approach),miss=Math.hypot(...closest),gap=materialContactGap(self,other),overlap=gap<0;
  if(!overlap&&(!avoidance||miss>=radius*1.2||dot(delta,original)<0))continue;
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
export function createEncounterWorld({avoidance=true}={}){
 const actors=new Map();let stamp=null,snapshot=[],last=new Map(),committed=new Map();
 function observe(time){if(time!==stamp){snapshot=[...actors].map(([id,stack])=>({id,...stack.at(-1)()})).filter(a=>a.mounted);committed=new Map();stamp=time;}return snapshot;}
 return {beginStep(){const observation={};observe(observation);return observation;},setAvoidance(value){if(typeof value!=='boolean')throw Error('Boolean avoidance required');avoidance=value;stamp=null;},read:()=>({avoidance,actors:actors.size,last:[...last].map(([id,state])=>({id,...state}))}),
  actor(id){return {register(get){const stack=actors.get(id)??[];stack.push(get);actors.set(id,stack);stamp=null;return()=>{const i=stack.indexOf(get);if(i>=0)stack.splice(i,1);if(!stack.length){actors.delete(id);last.delete(id);}stamp=null;};},
   steer({time,seconds,direction,speed}){const rows=observe(time),self=rows.find(r=>r.id===id);if(!self)return {direction,distanceScale:1};const result=encounterSteering({...self,direction,speed},rows,{seconds,avoidance});last.set(id,result);return result;},
   limit({time,body,motion,turnOnly=false}){const rows=observe(time).map(r=>committed.get(r.id)??r),result=limitTorsoMotion({id,...body},rows,motion),prior=last.get(id);last.set(id,{...prior,motion:{...prior?.motion,[turnOnly?'turn':'travel']:{...result,...motion}}});return result;},
   commit(time,body){observe(time);committed.set(id,{id,...body});},
   contacts(time){return observe(time).filter(r=>r.id!==id).flatMap(r=>r.capsules);},
  };},dispose(){actors.clear();snapshot=[];last.clear();},
 };
}
