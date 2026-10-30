export function burnJointState(bond,section){
 if(![bond.area,bond.linearStiffness,bond.rotationalStiffness].every(x=>Number.isFinite(x)&&x>0))throw Error('Finite positive material section coefficients required');
 if(typeof section?.mapped!=='boolean')throw Error('Material section mapping must be explicit');
 const fraction=section.mapped?section.fraction:1;
 if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw Error('Remaining material fraction must be finite and between zero and one');
 return {active:fraction>0,fraction:section.mapped?fraction:null,area:bond.area*fraction,
  linearStiffness:bond.linearStiffness*fraction,rotationalStiffness:bond.rotationalStiffness*fraction*fraction};
}

// Provisional isotropic material, not a calibrated wood species. Units are
// meters, kilograms, seconds and pascals; elasticity remains in the source graph.
export const BURN_MATERIAL=Object.freeze({tension:3e6,compression:12e6,shear:2.4e6,charStrength:.1,density:500});
export function checkedBurnMaterial(material=BURN_MATERIAL){
 if(!['tension','compression','shear','density'].every(k=>Number.isFinite(material[k])&&material[k]>0)
  ||!Number.isFinite(material.charStrength)||material.charStrength<=0||material.charStrength>1)throw Error('Finite positive material strengths/density and residual char strength in (0,1] required');
 return Object.fromEntries(Object.keys(BURN_MATERIAL).map(k=>[k,material[k]]));
}
const vector=(value,n)=>Array.isArray(value)&&value.length===n&&value.every(Number.isFinite);
export function burnConnectionResponse({area,fraction,char,normal,force,torque},material=BURN_MATERIAL){
 material=checkedBurnMaterial(material);
 if(!Number.isFinite(area)||area<=0||!Number.isFinite(fraction)||fraction<0||fraction>1
  ||!Number.isFinite(char)||char<0||char>1||![normal,force,torque].every(v=>vector(v,3))||Math.hypot(...normal)===0)throw Error('Finite material section, damage and load required');
 const remainingArea=area*fraction,radius=Math.sqrt(remainingArea/Math.PI),sectionModulus=Math.PI*radius**3/4;
 if(fraction===0)return {broken:true,reason:'consumed',utilization:null,remainingArea,sectionModulus};
 const n=normal.map(v=>v/Math.hypot(...normal)),dot=v=>v.reduce((s,x,k)=>s+x*n[k],0);
 const axial=dot(force),twist=dot(torque),bending=Math.hypot(...torque.map((v,k)=>v-twist*n[k]));
 const transverse=Math.hypot(...force.map((v,k)=>v-axial*n[k]));
 const stresses={tension:Math.max(0,-axial/remainingArea+bending/sectionModulus),
  compression:Math.max(0,axial/remainingArea+bending/sectionModulus),
  shear:4*transverse/(3*remainingArea)+Math.abs(twist)/(2*sectionModulus)};
 const strengthFactor=1-char*(1-material.charStrength),ratios=Object.fromEntries(Object.entries(stresses).map(([k,v])=>[k,v/(material[k]*strengthFactor)]));
 const mode=Object.keys(ratios).reduce((a,b)=>ratios[b]>ratios[a]?b:a),utilization=ratios[mode];
 return {broken:utilization>1,reason:utilization>1?mode:null,utilization,ratios,stresses,remainingArea,sectionModulus,strengthFactor};
}

export function checkedBurnSupport(support){
 if(!support||!vector(support.position,3)||!vector(support.halfExtents,3)||support.halfExtents.some(v=>v<=0)
  ||!vector(support.quaternion,4)||Math.hypot(...support.quaternion)===0||!Number.isFinite(support.friction)||support.friction<0)throw Error('Finite support box, orientation and nonnegative friction required');
 return {position:[...support.position],halfExtents:[...support.halfExtents],quaternion:support.quaternion.map(v=>v/Math.hypot(...support.quaternion)),friction:support.friction};
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
