import {chooseWanderZone,createWanderPath} from './wander-path.mjs';

const pair=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const clone=x=>structuredClone(x);
const separation=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const heading=p=>{if(!pair(p)||!(Math.hypot(...p)>0))throw Error('Locomotion requires a finite nonzero heading');const n=Math.hypot(...p);return p.map(x=>x/n);};
const angle=(a,b)=>Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
function validArea(a){
 if(!pair(a?.center)||!pair(a.radii)||a.radii.some(x=>x<=0)||!Number.isFinite(a.yaw))throw Error('Locomotion requires a finite positive wander area');
 return clone(a);
}
function validAreas(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('Locomotion requires an active wander zone');
 const ids=new Set();
 const result=rows.map(r=>{
  if(typeof r.id!=='string'||!r.id||ids.has(r.id)||!Number.isFinite(r.preference)||r.preference<0)throw Error('Invalid locomotion zone identity or preference');
  ids.add(r.id);return {...r,area:validArea(r.area)};
 });
 if(!result.some(r=>r.preference>0))throw Error('Locomotion requires a positive zone preference');
 return result;
}
function local(p,a){const x=p[0]-a.center[0],z=p[1]-a.center[1],c=Math.cos(a.yaw),s=Math.sin(a.yaw);return [(c*x+s*z)/a.radii[0],(-s*x+c*z)/a.radii[1]];}
const inside=(p,a)=>Math.hypot(...local(p,a))<=1+1e-12;
function project(p,a){const q=local(p,a),n=Math.max(1,Math.hypot(...q)),x=q[0]/n*a.radii[0],z=q[1]/n*a.radii[1],c=Math.cos(a.yaw),s=Math.sin(a.yaw);return [a.center[0]+c*x-s*z,a.center[1]+s*x+c*z];}
function admitted(start,end,area){
 if(!inside(start,area)||inside(end,area))return 1;
 const a=local(start,area),b=local(end,area),d=b.map((x,i)=>x-a[i]);
 const aa=d[0]**2+d[1]**2,bb=2*(a[0]*d[0]+a[1]*d[1]),cc=a[0]**2+a[1]**2-1;
 return aa?Math.max(0,Math.min(1,(-bb+Math.sqrt(Math.max(0,bb*bb-4*aa*cc)))/(2*aa))):0;
}

// Zones choose places; they do not prescribe a spline or a turn radius.
// The unicycle drive changes heading at a body/pace-scaled rate and reduces
// forward walking when the desired direction is across or behind the body.
export function createWanderLocomotion({area,areas,position,direction,seed=1,snapshot,bodyLength,referenceSpeed}={}){
 if(!(bodyLength>0)||!Number.isFinite(bodyLength)||!(referenceSpeed>0)||!Number.isFinite(referenceSpeed))throw Error('Locomotion requires finite positive body length and source pace');
 const retained=snapshot?.schema==='kaminos.creature-wander-locomotion.v1';
 let rng=seed,goal,destination=null,total=0,segments=0,zoneId=null,intent=null;
 if(snapshot?.schema==='kaminos.creature-wander-path.v1'){
  const legacy=createWanderPath({snapshot}),state=legacy.read();
  area=state.area;areas=snapshot.areas;position=state.position;direction=state.direction;goal=state.target;
  rng=snapshot.rng;destination=snapshot.destination??null;total=snapshot.distance;segments=snapshot.segments;zoneId=snapshot.zoneId??null;
 }else if(snapshot!==undefined){
  if(snapshot?.schema!=='kaminos.creature-wander-locomotion.v1'||!pair(snapshot.position)||!pair(snapshot.goal)||!Number.isInteger(snapshot.rng)||snapshot.rng<0||snapshot.rng>0xffffffff||!Number.isFinite(snapshot.distance)||snapshot.distance<0||!Number.isSafeInteger(snapshot.segments)||snapshot.segments<0||snapshot.destination!==null&&!pair(snapshot.destination))throw Error('Invalid locomotion snapshot');
  ({area,areas,position,direction,goal,rng,destination,segments,zoneId}=clone(snapshot));total=snapshot.distance;
 }
 area=validArea(area);if(areas)areas=validAreas(areas);
 if(!pair(position)||!Number.isInteger(rng)||rng<0||rng>0xffffffff)throw Error('Invalid locomotion position or random state');
 position=[...position];
 if(retained){if(!pair(direction)||Math.abs(Math.hypot(...direction)-1)>1e-8)throw Error('Invalid locomotion snapshot heading');direction=[...direction];}
 else direction=heading(direction);
 if(areas&&snapshot!==undefined&&!areas.some(r=>r.id===zoneId))throw Error('Locomotion snapshot has an unknown zone');
 const maxYawRate=2*referenceSpeed/bodyLength,stepSeconds=bodyLength/referenceSpeed/128;
 const arrivalRadius=()=>Math.min(bodyLength*.05,Math.min(...area.radii)*.05);
 function random(){rng=(rng+0x6d2b79f5)>>>0;let t=rng;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
 function chooseArea(){if(areas){const row=chooseWanderZone(areas,random());area=clone(row.area);zoneId=row.id;}}
 function chooseGoal(selectArea=true){
  if(selectArea)chooseArea();const radius=Math.sqrt(random()),a=random()*2*Math.PI,c=Math.cos(area.yaw),s=Math.sin(area.yaw),x=radius*Math.cos(a)*area.radii[0],z=radius*Math.sin(a)*area.radii[1];
  goal=[area.center[0]+c*x-s*z,area.center[1]+s*x+c*z];
 }
 if(!goal)chooseGoal();
 const arrived=()=>separation(position,goal)<=arrivalRadius();
 function read(){
  const delta=goal.map((x,i)=>x-position[i]),error=Math.hypot(...delta)?angle(direction,heading(delta)):0;
  return {position:[...position],direction:[...direction],area:clone(area),...(areas?{zoneId}:{}),target:[...goal],distance:total,segments,status:destination&&arrived()?'arrived':inside(position,area)?'wandering':'returning-to-area',navigation:{kind:'goal-steering',bodyLength,referenceSpeed,maxYawRate,arrivalRadius:arrivalRadius(),phase:destination&&arrived()?'arrived':Math.cos(error)<=0?'turning':'walking'}};
 }
 function advance(distance,{seconds=distance/referenceSpeed,drive=null,maxStepSeconds=stepSeconds}={}){
  if(!Number.isFinite(distance)||distance<0||!Number.isFinite(seconds)||seconds<0)throw Error('Locomotion needs finite nonnegative distance and time');
  if(!(maxStepSeconds>0)||!Number.isFinite(maxStepSeconds)||drive!==null&&typeof drive!=='function')throw Error('Invalid locomotion integration drive');
  if(!seconds){if(distance)throw Error('Positive locomotion distance requires elapsed time');intent=null;return read();}
  const speed=distance/seconds;let remaining=seconds;
  while(remaining>0){
   const h=Math.min(remaining,stepSeconds,maxStepSeconds);remaining=Math.max(0,remaining-h);
   if(arrived()){
    if(destination)break;
    chooseGoal();segments++;
    // A tiny zone can legitimately offer only already-reached places. Consume
    // this integration interval without inventing travel or retrying forever.
    if(arrived())continue;
   }
   const delta=goal.map((x,i)=>x-position[i]),desired=intent??heading(delta),error=angle(direction,desired);
   const omega=Math.max(-maxYawRate,Math.min(maxYawRate,error*4*referenceSpeed/bodyLength));
   const walkingFraction=Math.max(0,Math.cos(error))**2;
   // The motion owner integrates its nonuniform source phase here, in the
   // SAME time step as steering. A source-distance plateau still consumes
   // active phase, whereas reorientation without forward walking does not.
   const source=drive?.({seconds:h,walkingFraction});
   if(source&&(!Number.isFinite(source.distance)||source.distance<0||typeof source.accept!=='function'))throw Error('Invalid locomotion source drive');
   const travel=Math.min(source?source.distance:speed*walkingFraction*h,separation(position,goal)),turn=omega*h,c=Math.cos(turn),s=Math.sin(turn);
   // Exact constant-twist integration keeps the root moving along its heading,
   // including during turns. No lateral seek vector is applied to the body.
   const along=Math.abs(turn)>1e-12?travel*Math.sin(turn)/turn:travel;
   const across=Math.abs(turn)>1e-12?travel*(1-Math.cos(turn))/turn:0;
   const next=[position[0]+direction[0]*along-direction[1]*across,position[1]+direction[1]*along+direction[0]*across];
   const fraction=admitted(position,next,area);
   position=position.map((x,i)=>x+(next[i]-x)*fraction);
   direction=heading([c*direction[0]-s*direction[1],s*direction[0]+c*direction[1]]);
   total+=travel*fraction;
   source?.accept(travel*fraction);
  }
  intent=null;return read();
 }
 function contact(p,d,distance){
  if(!pair(p)||!Number.isFinite(distance)||distance<0)throw Error('Invalid accepted locomotion pose');
  const next=heading(d),tolerance=64*Number.EPSILON*Math.max(1,bodyLength,...position.map(Math.abs),...p.map(Math.abs));
  if(separation(position,p)<=tolerance&&separation(direction,next)<=64*Number.EPSILON){total=distance;return read();}
  position=[...p];direction=next;total=distance;return read();
 }
 function redirect(d){const next=heading(d);intent=separation(next,direction)>1e-12?next:null;return read();}
 function setDestination(next){
  if(next!==null&&!pair(next))throw Error('Destination must be a finite pair or null');
  if(JSON.stringify(next)===JSON.stringify(destination))return read();
  destination=next?[...next]:null;
  if(destination)goal=project(destination,area);else chooseGoal();
  intent=null;segments++;return read();
 }
 function setArea(next){area=validArea(next);goal=destination?project(destination,area):(chooseGoal(false),goal);segments++;return read();}
 function setAreas(next){
  next=validAreas(next);if(JSON.stringify(next)===JSON.stringify(areas))return read();
  areas=next;chooseArea();if(destination)goal=project(destination,area);else chooseGoal(false);segments++;return read();
 }
 function save(){return {schema:'kaminos.creature-wander-locomotion.v1',area:clone(area),...(areas?{areas:clone(areas)}:{}),position:[...position],direction:[...direction],goal:[...goal],destination:destination?[...destination]:null,rng,distance:total,segments,zoneId,bodyLength,referenceSpeed};}
 return Object.freeze({read,advance,contact,redirect,setArea,setAreas,setDestination,snapshot:save});
}
