const unit=p=>{const n=Math.hypot(...p);return n?p.map(v=>v/n):[0,1];};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
export function encounterSteering(self,others,{seconds,avoidance=true}={}){
 if(!Number.isFinite(seconds)||seconds<0)throw Error('Encounter time must be finite and nonnegative');
 const original=unit(self.direction),force=[...original],right=[original[1],-original[0]];let scale=1,touching=false,neighbours=0;
 for(const other of others){
  if(other.id===self.id)continue;
  const delta=other.position.map((v,i)=>v-self.position[i]),distance=Math.hypot(...delta),radius=self.radius+other.radius;
  const relative=other.direction.map((v,i)=>v*other.speed-original[i]*self.speed),r2=dot(relative,relative),approach=r2>1e-12?Math.max(0,Math.min(1.5,-dot(delta,relative)/r2)):0;
  const closest=delta.map((v,i)=>v+relative[i]*approach),miss=Math.hypot(...closest),overlap=distance<radius;
  if(!overlap&&(!avoidance||miss>=radius*1.2||dot(delta,original)<0))continue;
  neighbours++;touching||=overlap;
  const away=distance>1e-9?delta.map(v=>-v/distance):(self.id<other.id?[1,0]:[-1,0]);
  if(overlap){for(let a=0;a<2;a++)force[a]+=away[a]*(2+4*(1-distance/radius));if(dot(original,away)<-.2)scale=0;else scale=Math.min(scale,.45);}
  else{const urgency=(1-miss/(radius*1.2))/(1+approach);for(let a=0;a<2;a++)force[a]+=urgency*(right[a]*2+away[a]*.45);scale=Math.min(scale,Math.max(.2,Math.min(1,(distance-radius)/(radius*.6))));}
 }
 const desired=unit(force),angle=Math.atan2(original[0]*desired[1]-original[1]*desired[0],dot(original,desired)),turn=Math.max(-1.8*seconds,Math.min(1.8*seconds,angle)),c=Math.cos(turn),s=Math.sin(turn);
 return {direction:[c*original[0]-s*original[1],s*original[0]+c*original[1]],distanceScale:scale,touching,neighbours};
}

// One timestamp means one shared observation, independent of actor callback
// order. No timer, pose authority or private simulation is owned here.
export function createEncounterWorld({avoidance=true}={}){
 const actors=new Map();let stamp=null,snapshot=[],last=new Map();
 function observe(time){if(time!==stamp){snapshot=[...actors].map(([id,stack])=>({id,...stack.at(-1)()})).filter(a=>a.mounted);stamp=time;}return snapshot;}
 return {setAvoidance(value){if(typeof value!=='boolean')throw Error('Boolean avoidance required');avoidance=value;stamp=null;},read:()=>({avoidance,actors:actors.size,last:[...last].map(([id,state])=>({id,...state}))}),
  actor(id){return {register(get){const stack=actors.get(id)??[];stack.push(get);actors.set(id,stack);stamp=null;return()=>{const i=stack.indexOf(get);if(i>=0)stack.splice(i,1);if(!stack.length){actors.delete(id);last.delete(id);}stamp=null;};},
   steer({time,seconds,direction,speed}){const rows=observe(time),self=rows.find(r=>r.id===id);if(!self)return {direction,distanceScale:1};const result=encounterSteering({...self,direction,speed},rows,{seconds,avoidance});last.set(id,result);return result;},
   contacts(time){return observe(time).filter(r=>r.id!==id).flatMap(r=>r.capsules);},
  };},dispose(){actors.clear();snapshot=[];last.clear();},
 };
}
