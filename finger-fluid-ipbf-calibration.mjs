import {evaluateIPBF} from './finger-fluid-ipbf-reference.mjs';
/** One global coefficient bracket from an explicit finite compressed lattice.
 * No adaptive per-particle stiffness and no dynamics/visual-default claim. */
export function deriveIPBFSoftnessReference({particleVolume,radius,dt}){
 for(const [name,v] of Object.entries({particleVolume,radius,dt}))if(!Number.isFinite(v)||v<=0)throw Error('Invalid calibration '+name);
 const spacing=Math.cbrt(particleVolume),compressedSpacing=.95*spacing;
 // Fixed 7³ local reference; large supports can visibly fail its admission.
 const positions=[];
 for(let z=-3;z<=3;z++)for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)positions.push([x*compressedSpacing,y*compressedSpacing,z*compressedSpacing]);
 const index=171;positions[index][0]=.05*spacing;
 const state={positions,inertial:positions.map(p=>p.slice()),masses:positions.map(()=>particleVolume),restDensity:1,supportRadius:radius,dt,compliance:0};
 const base=evaluateIPBF(state),H=base.hessians[index],normal=base.updates[index];
 if(!(base.constraints[index]>0)||!(Math.abs(normal[0])>0)||!(H[0][0]>0))throw Error('Reference has no active compression response at this support');
 if(Math.hypot(normal[1],normal[2])>1e-8*Math.abs(normal[0])||Math.abs(H[0][1])+Math.abs(H[0][2])>1e-8*H[0][0])throw Error('Reference pressure mode is not axis aligned');
 const brackets=[.9,.5,.1].map(updateFraction=>({updateFraction,alternativeCompliance:H[0][0]*(1/updateFraction-1)*dt*dt/particleVolume}));
 return {schema:'kaminos.ipbf-softness-reference.v1',particleVolume,radius,dt,spacing,compressedSpacing,compressionFraction:.05,centerOffsetFraction:.05,
  particleCount:positions.length,index,state,constraint:base.constraints[index],directionalPressureHessian:H[0][0],normalUpdate:normal,brackets,
  claimLimit:'Predicted global alternate-compliance response in this declared compressed reference; no visual/material default or adaptive coefficient.'};
}
