export function burnJointState(bond,section){
 if(![bond.area,bond.linearStiffness,bond.rotationalStiffness].every(x=>Number.isFinite(x)&&x>0))throw Error('Finite positive material section coefficients required');
 if(typeof section?.mapped!=='boolean')throw Error('Material section mapping must be explicit');
 const fraction=section.mapped?section.fraction:1;
 if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw Error('Remaining material fraction must be finite and between zero and one');
 return {active:fraction>0,fraction:section.mapped?fraction:null,area:bond.area*fraction,
  linearStiffness:bond.linearStiffness*fraction,rotationalStiffness:bond.rotationalStiffness*fraction*fraction};
}

export const BURN_FRACTURE_IDENTITY='kaminos.burn-fracture.resident-cohesive.v1';
export function checkBurnFractureInput(prepared,sections,supports){
 if(!prepared?.cells?.length||!prepared.bonds?.length)throw Error('Prepared whole-object material graph required');
 if(sections?.count!==prepared.bonds.length||!sections?.buffer||!sections?.device)throw Error('Same-topology resident material sections required');
 if(sections.mapping?.connections?.length!==prepared.bonds.length||sections.mapping.connections.some((c,i)=>c.id!==prepared.bonds[i].id||c.a!==prepared.bonds[i].a||c.b!==prepared.bonds[i].b))throw Error('Material section topology differs from the mechanics graph');
 if(!Array.isArray(supports)||new Set(supports).size!==supports.length||supports.some(i=>!Number.isInteger(i)||i<0||i>=prepared.cells.length))throw Error('Explicit valid support region indices required');
}

// Keep elapsed simulation time, but never enqueue a second physics batch while
// the first is outstanding. Exact offline advancement remains a separate path.
export function createBurnFracturePlayback({stepSeconds,advance,completed,onError}){
 if(!Number.isFinite(stepSeconds)||stepSeconds<=0||![advance,completed,onError].every(f=>typeof f==='function'))throw Error('Playback requires a positive fixed timestep and submission/completion callbacks');
 let pendingSeconds=0,inFlight=null,error=null;
 return {
  tick(dt){
   if(error)throw error;
   if(!Number.isFinite(dt)||dt<0||!Number.isFinite(pendingSeconds+dt))throw Error('Finite nonnegative playback duration required');
   pendingSeconds+=dt;
   if(inFlight||pendingSeconds+Number.EPSILON<stepSeconds)return;
   advance(stepSeconds);pendingSeconds=Math.max(0,pendingSeconds-stepSeconds);
   inFlight=Promise.resolve().then(completed).catch(cause=>{error=cause;onError(cause);}).finally(()=>{inFlight=null;});
  },
  read:()=>({pendingSeconds,inFlight:inFlight!==null,policy:'one-fixed-step-per-frame-with-gpu-backpressure-no-time-discard'}),
  settled:()=>inFlight??Promise.resolve(),
 };
}
