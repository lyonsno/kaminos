// Adapted from Sinter f8fdd48:burnInitialJointPenalties. These are numerical
// starting penalties, not replacements for the authored material maxima.
// Match the initial coupling to the pair's inertial scale so a stiff internal
// constraint cannot freeze its shared gravitational mode in finite iterations.
export function coarseInitialJointPenalties({masses,halfExtents,timeStep,linearStiffness,rotationalStiffness,torqueArm}){
 if(!Array.isArray(masses)||masses.length!==2||!masses.every(x=>Number.isFinite(x)&&x>=0)
  ||!Array.isArray(halfExtents)||halfExtents.length!==2||!halfExtents.every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&x>0))
  ||![timeStep,linearStiffness,rotationalStiffness,torqueArm].every(x=>Number.isFinite(x)&&x>0))throw Error('Finite pair masses, box extents, timestep and joint coefficients required');
 const inverseMass=masses.map(m=>m>0?1/m:0),sum=inverseMass[0]+inverseMass[1],dt2=timeStep*timeStep;
 return {linear:Math.min(linearStiffness,sum>0?1/(sum*dt2):1),angular:[0,1,2].map(axis=>{
  const inverseMoment=halfExtents.reduce((s,r,i)=>s+3*inverseMass[i]/(r[(axis+1)%3]**2+r[(axis+2)%3]**2),0);
  return Math.min(rotationalStiffness,inverseMoment>0?1/(inverseMoment*dt2*torqueArm*torqueArm):1);
 })};
}
