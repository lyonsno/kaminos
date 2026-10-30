// A browser idle turn supplies the available work budget. Pending model time
// stays explicit and unbounded; no physical steps or elapsed request are dropped.
export function createCrustClock({advance,onChange=()=>{},onError=error=>{throw error;},requestIdle=callback=>requestIdleCallback(callback),cancelIdle=id=>cancelIdleCallback(id)}){
 let pending=0,playing=false,rate=0,task=null,closed=false,generation=0;
 const due=()=>pending+1e-10>=.1;
 const schedule=()=>{if(!closed&&playing&&rate>0&&due()&&task===null){const token=generation;task=requestIdle(deadline=>{
  if(closed||token!==generation)return;task=null;if(!playing||rate===0)return;
  let changed=false;try{while(due()&&deadline.timeRemaining()>0){advance(.1);pending=Math.max(0,pending-.1);changed=true;}if(changed)onChange();schedule();}catch(error){fail(error);}
 });}};
 const cancel=()=>{generation++;if(task!==null){cancelIdle(task);task=null;}};
 const fail=error=>{playing=false;cancel();onError(error);};
 return {
  frame(delta){if(!closed&&playing&&rate>0){const next=pending+delta*rate;if(!Number.isFinite(next)){fail(Error("Pending model time overflows the numeric representation"));return;}pending=next;schedule();}},
  configure(p,r){playing=Boolean(p);rate=r;if(!playing||rate===0)cancel();else schedule();},
  read:()=>({pendingModelSeconds:pending,scheduled:task!==null}),
  reset(value=0){if(!Number.isFinite(value)||value<0)throw Error("Invalid pending model time");cancel();pending=value;},dispose(){closed=true;playing=false;cancel();},
 };
}
