const point=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

// Persistent game intent, independent of the body's rig and attention novelty.
// Target observations are live scene state, not a claim about visual perception.
export function createGoinTask({target,arrivalRadius=.35}={}){
 if(typeof target!=='function'||!Number.isFinite(arrivalRadius)||arrivalRadius<=0)throw Error('Goin task requires a target reader and positive arrival radius');
 let time=0,until=0,lastEvent=null,state={phase:'waiting-target',target:null,destination:null,distance:null};
 const events=new Set();
 const read=()=>({source:'lerms.goin-task.v1',...structuredClone(state),time,interruption:lastEvent?{...lastEvent,until}:null});
 return {
  read,
  interrupt(event){
   if(!event||typeof event.id!=='string'||!event.id||typeof event.source!=='string'||!event.source||!Number.isFinite(event.seconds)||event.seconds<=0)throw Error('Interruption requires event id, source and positive seconds');
   if(events.has(event.id))return read();
   events.add(event.id);until=Math.max(until,time+event.seconds);lastEvent={id:event.id,source:event.source};return read();
  },
  update({time:next,position}){
   if(!Number.isFinite(next)||next<time||!point(position))throw Error('Goin task requires monotonic time and a world position');
   const motionStart=Math.min(next,Math.max(time,until));time=next;const observed=target();
   if(observed!==null&&(!observed||typeof observed.id!=='string'||!observed.id||!point(observed.position)))throw Error('Invalid live goin observation');
   const destination=observed?.position??null,distance=destination?Math.hypot(position[0]-destination[0],position[2]-destination[2]):null;
   const phase=time<until?'interrupted':!observed?'waiting-target':distance<=arrivalRadius?'at-goin':'approaching';
   state={phase,target:observed?.id??null,destination:destination?[...destination]:null,distance};
   return {source:'lerms.goin-task.v1',destination:state.destination,hold:phase!=='approaching',motionStart};
  }
 };
}
