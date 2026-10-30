// Preserve a moved hand across a release between animation frames. Only an
// unsubmitted target needs a final physical step; ordinary frames clear it.
// Cancellation discards pending input. No GPU state is acquired here.
export function createFractureHandCommands(model){
 let target=null,dirty=false;
 function step(){model.step();dirty=false;}
 function cancel(){dirty=false;target=null;model.release();}
 return {
  set(...args){model.setSurfaceHand(...args);target={...args[1]};dirty=false;},
  move(point){model.moveHand(point);if(target&&['x','y','z'].some(k=>target[k]!==point[k]))dirty=true;target={...point};},
  step,
  release(){const submitted=dirty;try{if(dirty)step();return submitted;}finally{cancel();}},
  cancel,
 };
}
