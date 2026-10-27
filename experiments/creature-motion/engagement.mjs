import {behaviorSettings} from './behavior-settings.mjs';
// Source-specific investigation and distance-seeking motives. All positions
// arrive through observations/events; a gap cannot reveal a hidden transform.
export function createEngagement({behavior:initialBehavior}={}){
 let behavior=behaviorSettings(initialBehavior);
 let current=null,lastTime=null,previouslyObserved=new Set(),records=new Map(),cooldowns=new Map(),state={phase:'wandering',hold:false,destination:null};
 const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
 const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 const read=()=>structuredClone(state);
 const idle=()=>{state={phase:'wandering',hold:false,destination:null};return read();};
 function reset(){current=null;lastTime=null;previouslyObserved.clear();records.clear();cooldowns.clear();return idle();}
 const record=id=>{if(!records.has(id))records.set(id,{id,drive:0,aversion:0,caution:0,standOff:1,lastSeen:-Infinity,alarmAt:-Infinity,cessationAt:-Infinity,holdUntil:-Infinity,quiet:false,observed:false,eventAt:-Infinity,familiarity:0});return records.get(id);};
 function begin(m,time){current={id:m.id,point:[...m.point],since:time,lastSeen:m.lastSeen};}
 function update({time,position,observed=[],focus=null,alarm=null,cessation=null,interrupted=false,arrived=false}){
  if(!Number.isFinite(time)||!point(position))throw Error('Engagement requires finite time and position');
  const seconds=lastTime===null?0:Math.max(0,time-lastTime),dt=seconds/behavior.recoveryTime;lastTime=time;
  for(const m of records.values()){
   m.aversion*=Math.exp(-dt/(m.quiet?.5:8));m.caution*=Math.exp(-dt/6);
   // Familiar unchanged experience spends interest; unseen uncertainty also fades.
   const rate=m.quiet?1:m.familiarity;
   m.drive*=Math.exp(-seconds*behavior.habituation*(previouslyObserved.has(m.id)?rate/6:1/12));
  }
  for(const seen of observed){
   if(!point(seen.point))continue;
   const m=record(seen.id);m.point=[...seen.point];m.lastSeen=time;m.approach=seen.approach!==false;m.standOff=seen.standOff??1;
   m.familiarity=Math.max(0,Math.min(1,seen.familiarity??0));
   if(!m.observed){m.drive=seen.drive??1;m.observed=true;}
   // Re-seeing a known source preserves satisfaction. Only a fresh observed
   // change renews it; one event timestamp cannot replenish every frame.
   if(Number.isFinite(seen.eventAt)&&seen.eventAt>m.eventAt){
    m.eventAt=seen.eventAt;m.quiet=false;
    m.drive=Math.max(m.drive,(seen.eventStrength??seen.drive??1)*(1-.8*m.familiarity));
   }
  }
  previouslyObserved=new Set(observed.filter(x=>point(x.point)).map(x=>x.id));
  if(alarm&&point(alarm.point)){
   const m=record(alarm.id);
   if(alarm.since>m.alarmAt){
    const strength=alarm.stimulusStrength??alarm.strength,familiarity=alarm.familiarity??0;
    m.alarmAt=alarm.since;m.point=[...alarm.point];m.lastSeen=time;m.quiet=false;
    m.drive=Math.max(m.drive,1+.7*strength*(1-familiarity));
    m.aversion=Math.max(m.aversion,2.5*strength);m.caution=Math.max(m.caution,strength);
    m.holdUntil=time+(.25+.35*strength)*behavior.recoveryTime;m.rememberUntil=time+(1+3*strength)*behavior.recoveryTime;
    begin(m,time);
   }
  }
  if(cessation&&point(cessation.point)){
   const m=record(cessation.id);
   if(cessation.since>m.cessationAt){
    m.cessationAt=cessation.since;m.point=[...cessation.point];m.lastSeen=time;m.quiet=true;
    m.aversion*=.2;m.drive=Math.max(m.drive*.4,1.4*cessation.surprise);
    m.caution=Math.max(m.caution,.5*cessation.surprise);m.rememberUntil=cessation.until+8*behavior.recoveryTime;
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
   const wary=!m.quiet&&(m.aversion+m.caution)*behavior.aversion>.15;
   if((time-current.lastSeen>2&&!(time<m.rememberUntil))||m.drive<.15&&m.aversion<.15){
    cooldowns.set(current.id,time+12);current=null;return idle();
   }
  }
  const selected=focus&&observed.find(x=>x.id===focus.id&&x.approach!==false);
  if(!current&&selected&&time>=(cooldowns.get(selected.id)??-Infinity)){const m=record(selected.id);if(m.drive>=.15||(m.aversion+m.caution)*behavior.aversion>.15)begin(m,time);}
  if(!current)return idle();
  const m=records.get(current.id),drive=m.drive*behavior.curiosity,aversion=m.aversion*behavior.aversion,caution=m.caution*behavior.aversion,motivation={drive,aversion,caution,remembered:!observed.some(x=>x.id===m.id)};
  const standOff=m.standOff+aversion+.5*caution,d=distance(position,current.point);
  // Fear and interest may cancel approach without canceling the need to watch.
  // The watch carries only observed coordinates and its real observation time.
  const concern=aversion+caution,watch=!m.quiet&&concern>.15?{id:m.id,point:[...current.point],strength:concern/(1+concern),lastObservedAt:current.lastSeen,until:Math.max(current.lastSeen+2,m.rememberUntil??-Infinity),remembered:motivation.remembered}:null;
  const emit=(phase,hold,destination=null)=>{
   const shortfall=Math.max(0,(standOff-d)/standOff);
   const pace=phase==='withdrawing'?1+2*aversion/(1+aversion)*shortfall:phase==='approaching'?1/(1+.75*caution):1;
   state={phase,id:m.id,hold,destination,point:[...current.point],standOff,motivation,watch,pace};return read();
  };
  if(time<m.holdUntil)return emit('cautious',true);
  const balance=drive-aversion-.5*caution;
  if(current.retreating&&(balance>.25||d>=standOff-.03))current.retreating=false;
  if(aversion>drive+.1&&d<standOff-.1)current.retreating=true;
  if(current.retreating){
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
   if(!watch&&time-current.inspectAt>=2){cooldowns.set(current.id,time+12);m.drive=0;current=null;return idle();}
   return emit('inspecting',true);
  }
  delete current.inspectAt;
  return emit('approaching',false,[current.point[0]+(position[0]-current.point[0])/d*standOff,current.point[1],current.point[2]+(position[2]-current.point[2])/d*standOff]);
 }
 return Object.freeze({update,read,reset,setBehavior:value=>{behavior=behaviorSettings(value);}});
}
