// A short-lived intention, separate from momentary gaze. Positions supplied
// here are observations; after losing sight only the last seen place survives.
export function createEngagement(){
 let current=null,lastAlarm=null,caution=null,cooldowns=new Map(),state={phase:'wandering',hold:false,destination:null};
 const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
 const read=()=>structuredClone(state);
 function reset(){current=null;caution=null;lastAlarm=null;cooldowns.clear();state={phase:'wandering',hold:false,destination:null};return read();}
 function update({time,position,observed=[],focus=null,alarm=null,interrupted=false,arrived=false}){
  if(!Number.isFinite(time)||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Engagement requires finite time and position');
  if(interrupted){if(current)cooldowns.set(current.id,time+6);current=null;state={phase:'wandering',hold:false,destination:null};return read();}
  if(alarm&&alarm.since!==lastAlarm){lastAlarm=alarm.since;caution={id:alarm.id,since:time,until:time+1+3*alarm.strength,strength:alarm.strength};current=null;}
  if(caution&&time<caution.until){state={phase:'cautious',id:caution.id,hold:true,destination:null,standOff:1+2*caution.strength};return read();}
  if(current){
   const seen=observed.find(x=>x.id===current.id);
   if(seen){if(distance(seen.point,current.point)>.1){arrived=false;delete current.inspectAt;}current.point=[...seen.point];current.lastSeen=time;}
   if(time-current.lastSeen>2||time-current.since>10||(current.inspectAt!==undefined&&time-current.inspectAt>=2)){
    cooldowns.set(current.id,time+12);current=null;state={phase:'wandering',hold:false,destination:null};return read();
   }
  }
  const selected=focus&&observed.find(x=>x.id===focus.id&&x.approach!==false);
  if(!current&&selected&&time>=(cooldowns.get(selected.id)??-Infinity))current={...selected,point:[...selected.point],since:time,lastSeen:time,standOff:selected.standOff??1};
  if(!current){state={phase:'wandering',hold:false,destination:null};return read();}
  const extra=caution?.id===current.id?2*caution.strength*Math.exp(-(time-caution.until)/10):0;
  const standOff=current.standOff+extra,d=distance(position,current.point);
  if(time-current.since<1){state={phase:'watching',id:current.id,hold:false,destination:null,standOff};return read();}
  if(arrived||d<=standOff+.1){current.inspectAt??=time;state={phase:'inspecting',id:current.id,hold:true,destination:null,standOff,point:[...current.point]};return read();}
  const destination=[current.point[0]+(position[0]-current.point[0])/d*standOff,current.point[1],current.point[2]+(position[2]-current.point[2])/d*standOff];
  state={phase:'approaching',id:current.id,hold:false,destination,point:[...current.point],standOff};return read();
 }
 return Object.freeze({update,read,reset});
}
