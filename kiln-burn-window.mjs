// A valve schedule; heating, combustion and transport remain simulation-owned.
export function checkedBurnerSeconds(value=5){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Burner duration must be a finite number of seconds, zero or greater');
 return value;
}
export function checkedBurnerFlares(value=3){
 if(!Number.isSafeInteger(value)||value<1)throw Error('Burner flares must be a positive whole number');
 return value;
}
export function createKilnBurnWindow({seconds=5,flares=1,pauseSeconds=1,clock=()=>performance.now()}={}){
 seconds=checkedBurnerSeconds(seconds);flares=checkedBurnerFlares(flares);pauseSeconds=checkedBurnerSeconds(pauseSeconds);
 const duration=seconds===0?0:seconds+(flares-1)*pauseSeconds,onSeconds=seconds/flares,cycle=onSeconds+pauseSeconds;
 if(!Number.isFinite(duration))throw Error('Burner schedule duration must be finite');
 let elapsed=0,since=null,started=false;
 const read=()=>{
  const elapsedSeconds=Math.min(duration,(elapsed+(since===null?0:Math.max(0,clock()-since)))/1000),done=started&&elapsedSeconds>=duration;
  const pulse=Math.min(flares-1,Math.floor(elapsedSeconds/cycle)||0),within=elapsedSeconds-pulse*cycle;
  const emitting=started&&!done&&within<onSeconds;
  const nextBoundary=done?duration:Math.min(duration,pulse*cycle+(emitting?onSeconds:cycle));
  return {seconds,flares,pauseSeconds,duration,started,elapsedSeconds,emitting,done,nextChangeSeconds:Math.max(0,nextBoundary-elapsedSeconds),progress:duration===0?1:elapsedSeconds/duration};
 };
 return {read,start(){elapsed=0;since=clock();started=true;},pause(){if(since!==null){elapsed+=Math.max(0,clock()-since);since=null;}},resume(){if(started&&since===null)since=clock();}};
}
