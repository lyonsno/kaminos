import {LOG_RESIDUE,LOG_MATERIAL_EPSILON} from './log-consumption.mjs';

// CPU reference for the resident remaining-material reduction. Contact and
// inertia use a coarse surviving-material box, not the original hollow shell.
export function remainingBurnBody({points,fuel,pitch,mass,bounds}){
 if(!Array.isArray(points)||!points.length||points.some(p=>p.length!==3||!p.every(Number.isFinite))||fuel.length!==points.length||!fuel.every(x=>Number.isFinite(x)&&x>=0&&x<=1)||pitch.length!==3||!pitch.every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(mass)||mass<=0)throw Error('Complete finite remaining material required');
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let remaining=0;
 points.forEach((p,i)=>{if(fuel[i]<=LOG_RESIDUE+LOG_MATERIAL_EPSILON)return;remaining+=fuel[i];for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]-pitch[k]/2);hi[k]=Math.max(hi[k],p[k]+pitch[k]/2);}});
 if(!remaining)return null;
 if(bounds)for(let k=0;k<3;k++){lo[k]=Math.max(lo[k],bounds.min[k]);hi[k]=Math.min(hi[k],bounds.max[k]);}
 if(lo.some((v,k)=>v>=hi[k]))return null;
 const currentMass=mass*remaining/points.length,halfExtents=lo.map((v,k)=>(hi[k]-v)/2);
 return {mass:currentMass,center:lo.map((v,k)=>(hi[k]+v)/2),halfExtents,inverseInertia:halfExtents.map((_,k)=>3/(currentMass*(halfExtents[(k+1)%3]**2+halfExtents[(k+2)%3]**2)))};
}
export function recenterBurnBody({position,quaternion,oldCenter,newCenter}){
 const [x,y,z,w]=quaternion,v=newCenter.map((a,k)=>a-oldCenter[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],q=[x,y,z],c=cross(q,v),d=cross(q,c.map((a,k)=>a+w*v[k]));
 return position.map((a,k)=>a+v[k]+2*d[k]);
}

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
export function burnMechanicsLocalScale(prepared,scale,material){
 if(!Number.isFinite(scale)||scale<=0)throw Error('Positive uniform mechanical scale required');
 material=checkedBurnMaterial(material);
 // Keep the solver in source coordinates: F_local=F_world/s and
 // torque_local=torque_world/s^2. Source geometry itself is unchanged.
 return {material:{...material,tension:material.tension*scale,compression:material.compression*scale,shear:material.shear*scale,density:material.density*scale**3},
  prepared:{...prepared,bonds:prepared.bonds.map(b=>({...b,linearStiffness:b.linearStiffness*scale,rotationalStiffness:b.rotationalStiffness*scale}))}};
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
