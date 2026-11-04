// Drive the existing mechanism's authored A→B half-cycle once, then hold.
// The mechanism's attachment follower owns payload transforms throughout.
export function createCarriageRun({write,arrive=()=>{}}){
 let state=null;
 return {
  start(from,target,seconds){
   if(!Number.isFinite(from)||from<0||from>.5||![0,.5].includes(target)||!Number.isFinite(seconds)||seconds<=0)throw Error('Carrier needs a position in its A–B half-cycle, an endpoint, and positive seconds');
   state={from,target,seconds,elapsed:0,moving:true};
  },
  advance(dt){
   if(!Number.isFinite(dt)||dt<0)throw Error('Invalid carrier elapsed time');
   if(!state?.moving)return;
   state.elapsed=Math.min(state.seconds,state.elapsed+dt);
   write(state.from+(state.target-state.from)*state.elapsed/state.seconds);
   if(state.elapsed===state.seconds){state.moving=false;arrive();}
  },
  cancel(){if(state)state.moving=false;},read:()=>state?{...state}:null,
 };
}
