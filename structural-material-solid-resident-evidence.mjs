import { graphTetrahedron,microelasticBonds } from './structural-material-solid-reference.mjs';

export function inspectResidentCoverage(models,results){
 const errors=[];if(!Array.isArray(results)||results.length!==models.length)return['Resident candidate coverage incomplete'];
 for(const model of models){const matches=results.filter(r=>r.kind===model.kind);if(matches.length!==1){errors.push(`Resident ${model.kind} missing or duplicated`);continue;}
  const stages=matches[0].stages;if(!Array.isArray(stages)||stages.length!==5||['rest','loaded','damaged','post-damage','released'].some(name=>stages.filter(s=>s.name===name).length!==1))errors.push(`Resident ${model.kind} stage coverage incomplete`);
 }return errors;
}

export function inspectResidentEvaluation(model,observed){
 const errors=[],n=model.positions.length;
 if(observed?.route!=='kaminos.deformable-material.colored-vbd.webgpu.v0'||observed.kind!==model.kind)errors.push('Effective resident material route mismatch');
 if(!Array.isArray(observed.state)||observed.state.length!==n*16||!observed.state.every(Number.isFinite)||!Array.isArray(observed.bonds)||observed.bonds.length!==model.bonds.length*4||!Array.isArray(observed.diagnostics)||observed.diagnostics.length!==n*24||!observed.diagnostics.every(Number.isFinite))return[...errors,'Complete finite resident state required'];
 const positions=model.positions.map((_,i)=>observed.state.slice(i*16+4,i*16+7)),forces=model.positions.map(()=>[0,0,0]),live=model.bonds.map((pair,i)=>{
  if(observed.bonds[i*4]!==pair[0]||observed.bonds[i*4+1]!==pair[1]||![0,1].includes(observed.bonds[i*4+2]))errors.push(`Effective bond ${i} identity/liveness mismatch`);
  return observed.bonds[i*4+2]===1;
 });
 if(model.kind==='graph')model.elements.forEach((ids,i)=>{const result=graphTetrahedron(ids.map(j=>model.positions[j]),model.material).evaluate(ids.map(j=>positions[j]),model.elementBonds[i].map(j=>live[j]));ids.forEach((node,k)=>result.forces[k].forEach((value,a)=>forces[node][a]+=value));});
 else{const result=microelasticBonds(model.positions,model.bonds,{...model.material,volumes:model.volumes}).evaluate(positions,live);result.forces.forEach((force,i)=>force.forEach((value,a)=>forces[i][a]+=value));}
 const dt=observed.settings?.timeStep;if(!(dt>0&&Number.isFinite(dt)))return[...errors,'Effective resident timestep missing'];
 for(let i=0;i<n;i++){
  const mass=observed.state[i*16+3];if(Math.abs(mass-model.masses[i])>2e-6*Math.max(1,model.masses[i]))errors.push(`Point ${i} mass changed`);
  if(observed.diagnostics[i*24+3]!==0)errors.push(`Point ${i} invalid constitutive domain`);
  for(let a=0;a<3;a++){
   const inertia=mass/(dt*dt)*(positions[i][a]-observed.state[i*16+12+a]),grip=observed.grip?.index===i?observed.grip.stiffness*(positions[i][a]-observed.grip.target[a]):0;
   const gradient=-forces[i][a]+inertia+grip,roundingScale=Math.max(1,Math.abs(forces[i][a])+Math.abs(inertia)+Math.abs(grip));
   if(Math.abs(gradient-observed.diagnostics[i*24+a])>3e-5*roundingScale)errors.push(`Point ${i}:${a} energy gradient differs: ${observed.diagnostics[i*24+a]} vs ${gradient} (component scale ${roundingScale})`);
  }
 }
 return errors;
}
