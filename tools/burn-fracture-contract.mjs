import assert from 'node:assert/strict';
import {BURN_FRACTURE_IDENTITY} from '../burn-fracture-core.mjs';
export function checkBurnFractureObservation(read,snapshot,{requireStressFailure=false}={}){
 assert.equal(read.identity,'kaminos.burn-fracture.replay.v1');assert.equal(read.effective.backend,'WebGPU');assert.equal(read.effective.adapter?.vendor,'apple');
 assert.equal(read.thermal,'frozen-not-live-coupled');assert.equal(read.mechanics.identity,BURN_FRACTURE_IDENTITY);assert.equal(read.mechanics.runtimeReadbacks,0);
 if(read.sceneContact==='finite-editable-support'){
  assert.deepEqual(read.mechanics.supports,[],'No material region may be artificially pinned');
  assert.ok(read.mechanics.finiteSupports.length>0,'A finite support must exist');
  assert.equal(read.mechanics.contact,'finite-support-boxes-no-piece-self-contact');
  assert.equal(read.mechanics.failureModel,'equivalent-circular-section-brittle-max-stress-char-strength');
 }
 const n=read.mechanics.regions,m=read.mechanics.connections;
 assert.ok(n>1&&m>0);assert.equal(snapshot.matrices.length,n*16);assert.ok(snapshot.matrices.every(Number.isFinite));
 for(let i=0;i<n;i++){const a=snapshot.matrices.slice(i*16,i*16+16);assert.ok(Math.abs(a[15]-1)<1e-6&&[3,7,11].every(j=>Math.abs(a[j])<1e-6),'Resident presentation matrix must be affine, not blank');
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(Math.hypot(...a.slice(axis*4,axis*4+3))-1)<1e-3,'Resident rigid pose must preserve unit basis vectors');
 }
 for(const name of ['positions','quaternions','velocities','angularVelocities']){assert.equal(snapshot[name].length,n*4);assert.ok(snapshot[name].every(Number.isFinite));}
 assert.equal(snapshot.alive.length,m);assert.equal(snapshot.geometry.length,m*12);assert.ok(snapshot.geometry.every(Number.isFinite));
 for(let i=0;i<n;i++)assert.ok(Math.abs(Math.hypot(...snapshot.quaternions.slice(i*4,i*4+4))-1)<1e-3);
 const failures=snapshot.damage?burnFailureEvidence(snapshot):null;
 if(requireStressFailure)assert.ok(failures?.stress.length>0,'Surviving material must have a recorded stress failure');
 return {regions:n,connections:m,broken:snapshot.alive.filter(x=>!x).length,seconds:snapshot.state.seconds,failures};
}

export function burnFailureEvidence(snapshot){
 const count=snapshot.alive.length;
 for(const name of ['geometry','damage']){assert.equal(snapshot[name]?.length,count*12);assert.ok(snapshot[name].every(Number.isFinite));}
 const result={stress:[],consumed:[],inactiveWithoutFailure:[]};
 for(let i=0;i<count;i++){
  const [force,torque,utilization,step]=snapshot.damage.slice(i*12,i*12+4),area=snapshot.geometry[i*12];
  if(step>0){
   assert.equal(snapshot.alive[i],false,'A failure event must actually disable its connection');
   assert.ok(Number.isInteger(step)&&step<=snapshot.state.steps&&area>0&&utilization>1&&(force>0||torque>0),'Stress failure requires surviving material and an overload in this run');
   result.stress.push({connection:i,area,force,torque,utilization,step,char:snapshot.damage[i*12+11]});
  }else if(!snapshot.alive[i])result[area===0?'consumed':'inactiveWithoutFailure'].push(i);
 }
 return result;
}

export function checkBurnMaterialContrast(rows){
 assert.deepEqual(rows.map(r=>r.name),['intact','charred','unloaded']);
 const [intact,charred,unloaded]=rows;
 for(const row of rows){
  assert.deepEqual(row.before.alive,[true],'The tested section must start connected');
  assert.equal(row.before.geometry[0],intact.before.geometry[0]);
  assert.ok(row.before.geometry[0]>0);
  assert.deepEqual(row.after.state.material,intact.after.state.material);
  assert.deepEqual(row.after.state.regionMasses,intact.after.state.regionMasses);
  row.failures=burnFailureEvidence(row.after);
  assert.deepEqual(row.failures.consumed,[],'This check must not consume its section');
  assert.deepEqual(row.failures.inactiveWithoutFailure,[]);
 }
 assert.deepEqual(charred.after.state.gravity,intact.after.state.gravity);
 assert.deepEqual(unloaded.after.state.gravity,[0,0,0]);
 assert.deepEqual(intact.after.alive,[true],'The intact connection must carry the applied load');
 assert.deepEqual(unloaded.after.alive,[true],'Char alone must not script a break without load');
 assert.equal(charred.failures.stress.length,1,'The same load must break the surviving charred section through the production failure kernel');
 assert.equal(intact.after.damage[11],0);assert.equal(charred.after.damage[11],1);assert.equal(unloaded.after.damage[11],1);
 return rows.map(({name,failures})=>({name,failures}));
}
