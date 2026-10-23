// A run's intermediate motions remain one history, not extra finished clips.
export function createRefinementHistory(){
 const runs=[];let active=null;
 return {runs,get active(){return active;},
  begin(metadata){if(active)throw Error('A refinement is already running');active={...metadata,status:'running',samples:[]};runs.push(active);return active;},
  append(sample){if(!active)throw Error('No active refinement');if(!Number.isFinite(sample.t)||sample.t<0||sample.t>1||sample.t<=(active.samples.at(-1)?.t??-Infinity))throw Error('Refinement time must advance');active.samples.push(sample);},
  finish(status){if(!active||!['completed','stopped','failed'].includes(status))throw Error('Invalid refinement completion');active.status=status;const run=active;active=null;return run;},
 };
}
