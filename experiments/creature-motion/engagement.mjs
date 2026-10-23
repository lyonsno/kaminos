// Source-specific investigation and distance-seeking motives. All positions
// arrive through observations/events; a gap cannot reveal a hidden transform.
export function createEngagement(){
 let current=null,lastTime=null,records=new Map(),cooldowns=new Map(),state={phase:'wandering',hold:false,destination:null};
 const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
 const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 const read=()=>structuredClone(state);
 const idle=()=>{state={phase:'wandering',hold:false,destination:null};return read();};
 function reset(){current=null;lastTime=null;records.clear();cooldowns.clear();return idle();}
 const record=id=>{if(!records.has(id))records.set(id,{id,drive:0,aversion:0,caution:0,standOff:1,lastSeen:-Infinity,alarmAt:-Infinity,cessationAt:-Infinity,holdUntil:-Infinity,quiet:false});return records.get(id);};
 function begin(m,time){current={id:m.id,point:[...m.point],since:time,lastSeen:m.lastSeen};}
 function update({time,position,observed=[],focus=null,alarm=null,cessation=null,interrupted=false,arrived=false}){
  if(!Number.isFinite(time)||!point(position))throw Error('Engagement requires finite time and position');
  const dt=lastTime===null?0:Math.max(0,time-lastTime);lastTime=time;
  for(const m of records.values()){
   m.aversion*=Math.exp(-dt/(m.quiet?.5:8));m.caution*=Math.exp(-dt/6);
   if(m.quiet)m.drive*=Math.exp(-dt/6);
  }
  for(const seen of observed){
   if(!point(seen.point))continue;
   const m=record(seen.id);m.point=[...seen.point];m.lastSeen=time;m.approach=seen.approach!==false;m.standOff=seen.standOff??1;
   // Mere presence cannot renew a completed event, or create a new alarm.
   if(!m.quiet&&m.drive===0)m.drive=seen.drive??1;
  }
  if(alarm&&point(alarm.point)){
   const m=record(alarm.id);
   if(alarm.since>m.alarmAt){
    const strength=alarm.strength,familiarity=alarm.familiarity??0;
    m.alarmAt=alarm.since;m.point=[...alarm.point];m.lastSeen=time;m.quiet=false;
    m.drive=Math.max(m.drive,1+.7*strength*(1-familiarity));
    m.aversion=Math.max(m.aversion,2.5*strength);m.caution=Math.max(m.caution,strength);
    m.holdUntil=time+.25+.35*strength;m.rememberUntil=time+1+3*strength;
    begin(m,time);
   }
  }
  if(cessation&&point(cessation.point)){
   const m=record(cessation.id);
   if(cessation.since>m.cessationAt){
    m.cessationAt=cessation.since;m.point=[...cessation.point];m.lastSeen=time;m.quiet=true;
    m.aversion*=.2;m.drive=Math.max(m.drive*.4,1.4*cessation.surprise);
    m.caution=Math.max(m.caution,.5*cessation.surprise);m.rememberUntil=cessation.until+8;
    m.holdUntil=cessation.until;
    // Another source falling quiet cannot erase an existing strong aversion.
    const prior=current&&records.get(current.id);
    if(!prior||prior.id===m.id||prior.aversion<m.drive)begin(m,time);
   }
  }
  if(interrupted){
   if(!cessation){if(current)cooldowns.set(current.id,time+6);current=null;return idle();}
   state={phase:'cautious',id:cessation.id,hold:true,destination:null};return read();
  }
  if(current){
   const m=records.get(current.id),seen=observed.find(x=>x.id===current.id);
   if(seen){if(distance(seen.point,current.point)>.1){arrived=false;delete current.inspectAt;}current.point=[...seen.point];current.lastSeen=time;}
   if((time-current.lastSeen>2&&!(time<m.rememberUntil))||time-current.since>10||m.drive<.15&&m.aversion<.15){
    cooldowns.set(current.id,time+12);current=null;return idle();
   }
  }
  const selected=focus&&observed.find(x=>x.id===focus.id&&x.approach!==false);
  if(!current&&selected&&time>=(cooldowns.get(selected.id)??-Infinity))begin(record(selected.id),time);
  if(!current)return idle();
  const m=records.get(current.id),motivation={drive:m.drive,aversion:m.aversion,caution:m.caution,remembered:!observed.some(x=>x.id===m.id)};
  const standOff=m.standOff+m.aversion+.5*m.caution,d=distance(position,current.point);
  const emit=(phase,hold,destination=null)=>{state={phase,id:m.id,hold,destination,point:[...current.point],standOff,motivation};return read();};
  if(time<m.holdUntil)return emit('cautious',true);
  const balance=m.drive-m.aversion-.5*m.caution;
  if(m.aversion>m.drive+.1&&d<standOff-.1){
   delete current.inspectAt;
   // The existing locomotion consumer owns the route and zone boundaries.
   // At a coincident point choose a deterministic escape bearing.
   const away=d>1e-6?[(position[0]-current.point[0])/d,(position[2]-current.point[2])/d]:[1,0];
   return emit('withdrawing',false,[current.point[0]+away[0]*standOff,position[1],current.point[2]+away[1]*standOff]);
  }
  if(balance<.15||m.approach===false){delete current.inspectAt;return emit('cautious',true);}
  if(time-current.since<1&&!m.quiet)return emit('watching',false);
  if(arrived||d<=standOff+.1){
   current.inspectAt??=time;
   if(time-current.inspectAt>=2){cooldowns.set(current.id,time+12);m.drive=0;current=null;return idle();}
   return emit('inspecting',true);
  }
  delete current.inspectAt;
  return emit('approaching',false,[current.point[0]+(position[0]-current.point[0])/d*standOff,current.point[1],current.point[2]+(position[2]-current.point[2])/d*standOff]);
 }
 return Object.freeze({update,read,reset});
}
