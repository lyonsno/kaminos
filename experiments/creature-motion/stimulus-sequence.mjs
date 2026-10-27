// A deterministic event clock. It schedules world edits, never creature actions.
// Consumers exercise every returned segment on their existing simulation clock.
export function validateStimulusProgram(program){
 if(!program||!Number.isFinite(program.duration)||program.duration<=0||!Array.isArray(program.events))throw Error('Stimulus program requires positive duration and events');
 let previous=-Infinity;
 for(const event of program.events){
  if(!Number.isFinite(event?.at)||event.at<0||event.at>=program.duration)throw Error('Event time must be inside program duration');
  if(event.at<previous)throw Error('Stimulus events must be in time order');previous=event.at;
  if(typeof event.source!=='string'||!event.source||!event.patch||typeof event.patch!=='object'||Array.isArray(event.patch))throw Error('Event requires a source and patch');
 }
 return structuredClone(program);
}
export function createStimulusSequence(input){
 const program=validateStimulusProgram(input);let time=0,cycle=0,index=0;
 const read=()=>({schema:'kaminos.creature-stimulus-sequence.v1',clock:'scene simulation seconds',time,cycle:Math.floor(time/program.duration),program:structuredClone(program)});
 function advance(seconds){
  if(!Number.isFinite(seconds)||seconds<0)throw Error('Sequence advance requires finite nonnegative seconds');
  const target=time+seconds;if(!Number.isFinite(target))throw Error('Sequence time overflow');
  const rows=[],epsilon=16*Number.EPSILON*Math.max(1,target);let cursor=time;
  while(program.events.length){
   const event=program.events[index],at=cycle*program.duration+event.at;if(at>target+epsilon)break;
   const boundary=Math.min(target,Math.max(cursor,at));
   if(boundary>cursor)rows.push({seconds:boundary-cursor,time:boundary,events:[]});
   rows.push({seconds:0,time:boundary,events:[{...structuredClone(event),cycle,time:at}]});cursor=boundary;
   if(++index===program.events.length){index=0;cycle++;}
  }
  if(target>cursor||!rows.length)rows.push({seconds:target-cursor,time:target,events:[]});time=target;return rows;
 }
 return Object.freeze({read,advance,repeat(){time=0;cycle=0;index=0;return advance(0);}});
}
