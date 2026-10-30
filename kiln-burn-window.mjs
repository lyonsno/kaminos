// The authored burner valve uses visible elapsed time. Simulation time remains
// the authority for heating, combustion and transport after the valve closes.
export function checkedBurnerSeconds(value=5){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Burner duration must be a finite number of seconds, zero or greater');
 return value;
}
export function createKilnBurnWindow({seconds=5,clock=()=>performance.now()}={}){
 seconds=checkedBurnerSeconds(seconds);let elapsed=0,since=null,started=false;
 const read=()=>{const elapsedSeconds=Math.min(seconds,(elapsed+(since===null?0:Math.max(0,clock()-since)))/1000);return {seconds,started,elapsedSeconds,emitting:started&&elapsedSeconds<seconds,progress:seconds===0?1:elapsedSeconds/seconds};};
 return {read,start(){elapsed=0;since=clock();started=true;},pause(){if(since!==null){elapsed+=Math.max(0,clock()-since);since=null;}},resume(){if(started&&since===null)since=clock();}};
}
