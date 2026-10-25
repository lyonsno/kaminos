const point=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

// Persistent game intent, independent of the body's rig and attention novelty.
// Target observations are live scene state, not a claim about visual perception.
export function createGoinTask({target,arrivalRadius=.35,theft=null}={}){
 if(typeof target!=='function'||!Number.isFinite(arrivalRadius)||arrivalRadius<=0)throw Error('Goin task requires a target reader and positive arrival radius');
 if(theft&&(!theft.carrierId||typeof theft.carrierId!=='string'||typeof theft.escape!=='function'))throw Error('Theft requires a carrier identity and escape reader');
 let time=0,until=0,lastEvent=null,wet=false,state={phase:'waiting-target',target:null,destination:null,distance:null};
 let custody={phase:'hoarded',goinId:null,carrierId:null,revision:0},transition=null;
 const events=new Set();
 const observe=()=>{const value=target();if(value!==null&&(!value||typeof value.id!=='string'||!value.id||!point(value.position)))throw Error('Invalid live goin observation');return value;};
 const read=()=>({source:'lerms.goin-task.v1',...structuredClone(state),time,interruption:lastEvent?{...lastEvent,until}:null,...theft?{custody:{...custody},transition:structuredClone(transition)}:{}});
 return {
  read,
  setWaterExposure(active){if(typeof active!=='boolean')throw Error('Water exposure must be boolean');wet=active;},
  interrupt(event){
   if(!event||typeof event.id!=='string'||!event.id||typeof event.source!=='string'||!event.source||!Number.isFinite(event.time)||!Number.isFinite(event.seconds)||event.seconds<=0)throw Error('Interruption requires event id, source, owner time and positive seconds');
   if(events.has(event.id))return read();
   if(event.time<time||event.time<(lastEvent?.time??0))throw Error('Interruption requires monotonic owner time');
   const observed=theft?observe():null;
   if(custody.carrierId&&observed?.id!==custody.goinId)throw Error('Cannot release a carried goin without its live position');
   events.add(event.id);until=Math.max(until,event.time+event.seconds);lastEvent={id:event.id,source:event.source,time:event.time};state.phase='interrupted';
   if(custody.carrierId){
    transition={kind:'drop',goinId:custody.goinId,carrierId:custody.carrierId,position:[...observed.position],time:event.time,eventId:event.id,source:event.source,cause:event.cause??'scripted_fixture'};
    custody={...custody,phase:'dropped',carrierId:null,revision:custody.revision+1};
   }
   return read();
  },
  update({time:next,from=time,position}){
   if(!Number.isFinite(next)||next<time||!Number.isFinite(from)||from<time||from>next||!point(position))throw Error('Goin task requires a monotonic interval and a world position');
   const motionStart=Math.min(next,Math.max(from,until));time=next;const observed=observe();
   let destination=observed?.position??null,distance=destination?Math.hypot(position[0]-destination[0],position[2]-destination[2]):null;
   let phase=time<until?'interrupted':wet?'water-exposed':!observed?'waiting-target':distance<=arrivalRadius?(observed.claimable===false?'waiting-goin-support':'at-goin'):'approaching';
   if(theft&&observed&&time>=until&&!wet){
    const escape=theft.escape();if(!point(escape))throw Error('Theft requires a finite live escape point');
    if(custody.carrierId&&custody.goinId!==observed.id)throw Error('Carried goin identity changed');
    if(!custody.carrierId&&phase==='at-goin'){
     custody={phase:'carried',goinId:observed.id,carrierId:theft.carrierId,revision:custody.revision+1};
     transition={kind:'claim',goinId:observed.id,carrierId:theft.carrierId,position:[...observed.position],time};
    }
    if(custody.carrierId){destination=escape;distance=Math.hypot(position[0]-escape[0],position[2]-escape[2]);phase=distance<=arrivalRadius?'holding-goin':'fleeing-with-goin';}
   }
   state={phase,target:observed?.id??null,destination:destination?[...destination]:null,distance};
   return {source:'lerms.goin-task.v1',destination:state.destination,hold:!['approaching','fleeing-with-goin'].includes(phase),motionStart};
  }
 };
}
